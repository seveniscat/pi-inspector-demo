/**
 * Resume extension —— 在普通 coding-agent 会话上，手搓"崩溃后接着做"。
 *
 * 注意：这不是官方的 Pi Durable（pi-durable 包）。官方是在存储层把每次输出、
 * 工具结果、队列都先落盘；这里只用 extension API，在 session JSONL 之上补齐同样的效果，
 * 用来展示 extension 能做到什么，以及恢复时真正难的地方在哪。
 *
 * 不改 Pi 一行源码，做到：
 *   1. checkpoint 工具：模型每完成一步就记录进度，进度写进 session JSONL（custom entry）
 *   2. session_start：重启后从 JSONL 重建进度，并找出"被 kill 打断的工具调用"
 *   3. context：发给模型前，给悬空的 toolCall 补一个"已中断"的 toolResult，
 *      让模型知道那一步可能只做了一半，需要先核实
 *   4. 观测：把 system prompt、模型切换、上下文压缩等内部时刻发给可视化 UI
 *
 * 同一个文件既能被 SDK 加载（src/server.ts），也能被 pi CLI 加载：
 *   cd workspace && pi -e ../src/extensions/resume.ts
 */
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export type Emit = (event: Record<string, unknown>) => void;

export interface ResumeOptions {
  /** 每次工具调用前停顿多久（毫秒），方便现场观看和 kill */
  stepDelayMs?: number;
  /** 自动信任这个目录，使 .pi/skills、AGENTS.md 等项目资源被加载 */
  trustedCwd?: string;
}

export interface OrphanToolCall {
  toolCallId: string;
  toolName: string;
  args: unknown;
  entryId: string;
}

const INTERRUPTED_TEXT =
  "[interrupted] 进程在这个工具执行完成之前被终止，结果未知。" +
  "如果这是写文件之类有副作用的操作，请先检查实际状态，再决定是否重做。";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function findLatestProgress(branch: any[]): Record<string, unknown> | null {
  for (let i = branch.length - 1; i >= 0; i--) {
    const e = branch[i];
    if (e?.type === "custom" && e.customType === "resume.progress") return e.data ?? null;
  }
  return null;
}

/** 在当前分支上找出：assistant 发起了 toolCall，但没有对应 toolResult 的调用 */
export function findOrphanToolCalls(branch: any[]): OrphanToolCall[] {
  const answered = new Set<string>();
  for (const e of branch) {
    const m = e?.type === "message" ? e.message : null;
    if (m?.role === "toolResult" && m.toolCallId) answered.add(m.toolCallId);
  }
  const orphans: OrphanToolCall[] = [];
  for (const e of branch) {
    const m = e?.type === "message" ? e.message : null;
    if (m?.role !== "assistant" || !Array.isArray(m.content)) continue;
    for (const c of m.content) {
      if (c?.type === "toolCall" && c.id && !answered.has(c.id)) {
        orphans.push({ toolCallId: c.id, toolName: c.name, args: c.arguments, entryId: e.id });
      }
    }
  }
  return orphans;
}

export function createResumeExtension(emit: Emit = () => {}, opts: ResumeOptions = {}) {
  return function resume(pi: ExtensionAPI) {
    let orphans: OrphanToolCall[] = [];
    let systemPromptSent = false;

    // ── 项目信任：SDK 模式下没有交互确认，直接信任 demo 工作区 ──
    pi.on("project_trust", (event: any) => {
      if (opts.trustedCwd && path.resolve(event.cwd) === path.resolve(opts.trustedCwd)) {
        return { trusted: "yes" };
      }
      return undefined;
    });

    // ── 1. checkpoint 工具：进度写进会话文件 ──
    pi.registerTool({
      name: "checkpoint",
      label: "Checkpoint",
      description:
        "记录任务进度。每完成一个子步骤后立刻调用一次。" +
        "进度会持久化到会话文件，进程崩溃重启后据此恢复。",
      parameters: Type.Object({
        task: Type.String({ description: "任务名称" }),
        done: Type.Array(Type.String(), { description: "已完成的子项列表（完整列表，不是增量）" }),
        total: Type.Number({ description: "子项总数" }),
        note: Type.Optional(Type.String({ description: "备注" })),
      }),
      async execute(_toolCallId: string, params: any) {
        const progress = { ...params, at: new Date().toISOString() };
        pi.appendEntry("resume.progress", progress);
        emit({ type: "resume_progress", ...progress });
        return {
          content: [{ type: "text", text: `checkpoint saved: ${params.done.length}/${params.total}` }],
          details: progress,
        };
      },
    } as any);

    // ── 2. 启动 / 恢复：从 JSONL 重建状态 ──
    pi.on("session_start", async (event: any, ctx: any) => {
      orphans = [];
      systemPromptSent = false;
      const branch: any[] = ctx.sessionManager.getBranch();
      const resumed = branch.some((e) => e?.type === "message");
      const progress = findLatestProgress(branch);
      orphans = findOrphanToolCalls(branch);

      emit({
        type: "resume_session_start",
        reason: event.reason,
        resumed,
        entries: branch.length,
        progress,
        orphans,
        sessionFile: ctx.sessionManager.getSessionFile?.(),
      });

      if (resumed) {
        // 在会话树上留一个"恢复点"标记（custom entry 不进 LLM 上下文）
        pi.appendEntry("resume.point", {
          at: new Date().toISOString(),
          reason: event.reason,
          progress,
          orphanToolCalls: orphans.map((o) => `${o.toolName}#${o.toolCallId}`),
        });
      }
    });

    // ── 3. 修补上下文：给悬空的 toolCall 补 toolResult ──
    pi.on("context", (event: any) => {
      if (orphans.length === 0) return undefined;
      const msgs: any[] = event.messages;
      let patched = 0;
      for (const o of orphans) {
        if (msgs.some((m) => m?.role === "toolResult" && m.toolCallId === o.toolCallId)) continue;
        const idx = msgs.findIndex(
          (m) =>
            m?.role === "assistant" &&
            Array.isArray(m.content) &&
            m.content.some((c: any) => c?.type === "toolCall" && c.id === o.toolCallId),
        );
        if (idx < 0) continue; // 已经被 compaction 总结掉了
        let insertAt = idx + 1;
        while (insertAt < msgs.length && msgs[insertAt]?.role === "toolResult") insertAt++;
        msgs.splice(insertAt, 0, {
          role: "toolResult",
          toolCallId: o.toolCallId,
          toolName: o.toolName,
          content: [{ type: "text", text: INTERRUPTED_TEXT }],
          isError: true,
          timestamp: Date.now(),
        });
        patched++;
      }
      if (patched === 0) return undefined;
      emit({ type: "resume_context_patched", patched, orphans: orphans.map((o) => o.toolName) });
      return { messages: msgs };
    });

    // ── 4. 节奏控制：每次工具调用前停顿一下 ──
    pi.on("tool_call", async () => {
      if (opts.stepDelayMs && opts.stepDelayMs > 0) await sleep(opts.stepDelayMs);
      return undefined;
    });

    // ── 5. 观测点 ──
    pi.on("before_agent_start", (event: any) => {
      if (!systemPromptSent && typeof event.systemPrompt === "string") {
        systemPromptSent = true;
        emit({ type: "resume_system_prompt", chars: event.systemPrompt.length, text: event.systemPrompt });
      }
      return undefined;
    });

    pi.on("model_select", (event: any) => {
      emit({
        type: "resume_model_select",
        model: event.model ? `${event.model.provider}/${event.model.id}` : null,
        previous: event.previousModel ? `${event.previousModel.provider}/${event.previousModel.id}` : null,
        source: event.source,
      });
    });

    pi.on("session_compact", (event: any) => {
      const c = event.compactionEntry ?? {};
      emit({
        type: "resume_compacted",
        reason: event.reason,
        tokensBefore: c.tokensBefore,
        firstKeptEntryId: c.firstKeptEntryId,
        summary: c.summary,
        details: c.details,
      });
    });
  };
}

/** 供 `pi -e` 直接加载：没有 UI，进度和恢复逻辑照常工作 */
export default createResumeExtension();
