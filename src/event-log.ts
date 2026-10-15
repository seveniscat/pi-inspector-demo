/**
 * 事件总线：所有可视化事件都从这里过。
 * - 持久化到 logs/events.jsonl（进程被 kill 后，重启的 UI 仍能看到上一轮发生了什么）
 * - 通过 SSE 实时推给浏览器
 * - 高频的流式 delta 只推送不落盘（message_end 里有完整文本）
 */
import fs from "node:fs";
import path from "node:path";
import type { ServerResponse } from "node:http";

export type DemoEvent = Record<string, unknown> & { type: string };

const EPHEMERAL = new Set(["text_delta", "thinking_delta"]);

export function clip(value: unknown, max = 1500, depth = 0): unknown {
  if (typeof value === "string") return value.length > max ? value.slice(0, max) + `…(+${value.length - max})` : value;
  if (Array.isArray(value)) {
    const arr = value.slice(0, 50).map((v) => clip(v, max, depth + 1));
    if (value.length > 50) arr.push(`…(+${value.length - 50} items)`);
    return arr;
  }
  if (value && typeof value === "object") {
    if (depth > 5) return "[object]";
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === "function") continue;
      out[k] = clip(v, max, depth + 1);
    }
    return out;
  }
  return value;
}

export class EventLog {
  private seq = 0;
  private clients = new Set<ServerResponse>();
  private listeners: Array<(e: DemoEvent) => void> = [];

  private file: string;

  constructor(file: string) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      this.seq = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).length;
    }
  }

  on(fn: (e: DemoEvent) => void) {
    this.listeners.push(fn);
  }

  emit = (event: Record<string, unknown>) => {
    const rec = { seq: ++this.seq, ts: Date.now(), pid: process.pid, ...event } as DemoEvent;
    if (!EPHEMERAL.has(rec.type)) {
      fs.appendFileSync(this.file, JSON.stringify(rec) + "\n");
    }
    const line = `data: ${JSON.stringify(rec)}\n\n`;
    for (const c of this.clients) c.write(line);
    for (const fn of this.listeners) {
      try {
        fn(rec);
      } catch {}
    }
  };

  /** 新连接：先发 reset，再回放历史，再接实时 */
  attach(res: ServerResponse) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`event: reset\ndata: {}\n\n`);
    if (fs.existsSync(this.file)) {
      for (const line of fs.readFileSync(this.file, "utf8").split("\n")) {
        if (line.trim()) res.write(`data: ${line}\n\n`);
      }
    }
    res.write(`event: replayed\ndata: {}\n\n`);
    this.clients.add(res);
    res.on("close", () => this.clients.delete(res));
  }
}

/** 把 Pi 的 session 事件整理成 UI 好渲染的形状；原始字段尽量保留 */
export function normalizePiEvent(ev: any): DemoEvent | null {
  switch (ev?.type) {
    case "message_update": {
      const a = ev.assistantMessageEvent ?? {};
      if (a.type === "text_delta" || a.type === "thinking_delta") return { type: a.type, delta: a.delta };
      return null;
    }
    case "message_start":
      return { type: "message_start", role: ev.message?.role };
    case "message_end": {
      const m = ev.message ?? {};
      return {
        type: "message_end",
        role: m.role,
        provider: m.provider,
        model: m.model,
        stopReason: m.stopReason,
        errorMessage: m.errorMessage,
        usage: m.usage,
        text: clip(textOf(m), 4000),
        thinking: clip(thinkingOf(m), 2000),
        toolCalls: Array.isArray(m.content)
          ? m.content.filter((c: any) => c?.type === "toolCall").map((c: any) => c.name)
          : undefined,
      };
    }
    case "tool_execution_start":
      return { type: ev.type, toolCallId: ev.toolCallId, toolName: ev.toolName, args: clip(ev.args) };
    case "tool_execution_update":
      return null;
    case "tool_execution_end":
      return {
        type: ev.type,
        toolCallId: ev.toolCallId,
        toolName: ev.toolName,
        isError: ev.isError,
        cached: ev.result?.details?.cached,
        result: clip(textOf(ev.result) || ev.result),
      };
    default:
      return clip({ ...ev }) as DemoEvent;
  }
}

function textOf(m: any): string {
  if (!m) return "";
  if (typeof m.content === "string") return m.content;
  if (!Array.isArray(m.content)) return "";
  return m.content
    .filter((c: any) => c?.type === "text")
    .map((c: any) => c.text)
    .join("");
}

function thinkingOf(m: any): string {
  if (!Array.isArray(m?.content)) return "";
  return m.content
    .filter((c: any) => c?.type === "thinking")
    .map((c: any) => c.thinking ?? c.text ?? "")
    .join("");
}
