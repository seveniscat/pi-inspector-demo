/**
 * Guard extension —— 给 agent 画边界。
 *
 * Pi 默认没有权限系统，内置工具以启动用户的身份直接执行。AGENTS.md 里写"不要做 X"是软约束，
 * 模型可能遵守也可能不遵守；这里用 tool_call 钩子做硬约束：工具真正执行前检查参数，违规直接拦下，
 * 拦截原因会作为工具结果返回给模型，模型会据此换一种做法。
 *
 * 规则（针对舆情 demo）：
 *   1. 不许绕过 social 工具直接读原始数据（data/ 目录、*.xlsx、posts.json、comments.json）
 *   2. 写文件只能写到 research/ 和 report/
 *   3. bash 不许访问网络、不许删除
 */
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type Emit = (event: Record<string, unknown>) => void;

export interface GuardOptions {
  workspace: string;
  writableDirs?: string[]; // 相对 workspace
}

const RAW_DATA = /(^|[\s/'"=])(\.\.\/)*data\/|\.xlsx\b|\bposts\.json\b|\bcomments\.json\b/i;
const NETWORK = /\b(curl|wget|nc|ssh|scp)\b|https?:\/\//i;
const DESTRUCTIVE = /\brm\s+(-\w*[rf]\w*\s+)+|\bmkfs\b|\bdd\s+if=|>\s*\/dev\/sd/i;

export function checkToolCall(
  toolName: string,
  input: any,
  opts: GuardOptions,
): { block: true; reason: string } | null {
  const ws = path.resolve(opts.workspace);
  const writable = (opts.writableDirs ?? ["research", "report"]).map((d) => path.join(ws, d) + path.sep);
  const p = String(input?.path ?? input?.file_path ?? "");
  const abs = p ? path.resolve(ws, p) : "";

  if (toolName === "bash") {
    const cmd = String(input?.command ?? "");
    if (RAW_DATA.test(cmd)) return { block: true, reason: "不允许用 bash 直接读原始数据，请用 social_search / search_comments 等工具查询" };
    if (NETWORK.test(cmd)) return { block: true, reason: "不允许访问网络" };
    if (DESTRUCTIVE.test(cmd)) return { block: true, reason: "不允许删除或破坏性操作" };
    return null;
  }
  if (toolName === "read") {
    if (/(^|\/)SKILL\.md$/.test(p)) return null; // skill 正文可能在全局目录，放行
    if (!abs.startsWith(ws + path.sep) && abs !== ws) return { block: true, reason: `不允许读工作区之外的文件：${p}` };
    if (RAW_DATA.test(p)) return { block: true, reason: "不允许直接读原始数据文件，请用 social 工具查询" };
    return null;
  }
  if (toolName === "write" || toolName === "edit") {
    if (!writable.some((d) => abs.startsWith(d))) return { block: true, reason: `只允许写入 research/ 和 report/，拒绝写入：${p}` };
    return null;
  }
  return null;
}

export function createGuardExtension(emit: Emit, opts: GuardOptions) {
  return function guard(pi: ExtensionAPI) {
    pi.on("tool_call", (event: any) => {
      const verdict = checkToolCall(event.toolName, event.input, opts);
      if (!verdict) return undefined;
      emit({ type: "guard_block", toolName: event.toolName, toolCallId: event.toolCallId, input: event.input, reason: verdict.reason });
      return verdict;
    });
  };
}
