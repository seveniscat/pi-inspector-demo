/**
 * 直接读取 Pi 的 session JSONL 文件，整理成会话树给 UI 渲染。
 * 刻意不走 SDK 的内部 API —— 现场要证明的就是"状态全在这个文件里"。
 */
import fs from "node:fs";

export interface TreeNode {
  id: string;
  parentId: string | null;
  type: string;
  kind: string;
  label: string;
  timestamp?: string;
  onBranch: boolean;
  summarized: boolean;
  isLeaf: boolean;
}

export function readSessionTree(file: string | undefined, leafId?: string | null) {
  if (!file || !fs.existsSync(file)) return { file, header: null, nodes: [] as TreeNode[] };
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  let header: any = null;
  const entries: any[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === "session") header = obj;
      else if (obj.id) entries.push(obj);
    } catch {
      // 最后一行可能写了一半（被 kill 时），跳过
    }
  }

  const byId = new Map(entries.map((e) => [e.id, e]));
  const leaf = leafId && byId.has(leafId) ? leafId : entries.at(-1)?.id;

  // 当前分支：从 leaf 一路沿 parentId 走到根
  const branch = new Set<string>();
  let cur = leaf ? byId.get(leaf) : undefined;
  while (cur) {
    branch.add(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }

  // 分支上最近一次 compaction 之前的节点 = 已被总结
  const branchOrdered = entries.filter((e) => branch.has(e.id));
  const lastCompaction = [...branchOrdered].reverse().find((e) => e.type === "compaction");
  const summarized = new Set<string>();
  if (lastCompaction?.firstKeptEntryId) {
    for (const e of branchOrdered) {
      if (e.id === lastCompaction.firstKeptEntryId) break;
      if (e.type === "message") summarized.add(e.id);
    }
  }

  const nodes: TreeNode[] = entries.map((e) => {
    const { kind, label } = describe(e);
    return {
      id: e.id,
      parentId: e.parentId ?? null,
      type: e.type,
      kind,
      label,
      timestamp: e.timestamp,
      onBranch: branch.has(e.id),
      summarized: summarized.has(e.id),
      isLeaf: e.id === leaf,
    };
  });

  return { file, header, nodes };
}

function preview(s: unknown, n = 80): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

function textOf(m: any): string {
  if (typeof m?.content === "string") return m.content;
  if (!Array.isArray(m?.content)) return "";
  return m.content.filter((c: any) => c?.type === "text").map((c: any) => c.text).join(" ");
}

function describe(e: any): { kind: string; label: string } {
  switch (e.type) {
    case "message": {
      const m = e.message ?? {};
      if (m.role === "user") return { kind: "user", label: preview(textOf(m)) };
      if (m.role === "assistant") {
        const calls = Array.isArray(m.content)
          ? m.content.filter((c: any) => c?.type === "toolCall").map((c: any) => c.name)
          : [];
        const text = preview(textOf(m), 60);
        const label = [text, calls.length ? `→ ${calls.join(", ")}` : ""].filter(Boolean).join(" ");
        return { kind: "assistant", label: label || `(${m.stopReason ?? "empty"})` };
      }
      if (m.role === "toolResult") {
        return { kind: m.isError ? "tool-error" : "tool", label: `${m.toolName}: ${preview(textOf(m), 60)}` };
      }
      return { kind: m.role ?? "message", label: preview(textOf(m)) };
    }
    case "model_change":
      return { kind: "model", label: `${e.provider}/${e.modelId}` };
    case "thinking_level_change":
      return { kind: "model", label: `thinking: ${e.thinkingLevel}` };
    case "compaction":
      return { kind: "compaction", label: `压缩 ${e.tokensBefore ?? "?"} tokens → ${preview(e.summary, 50)}` };
    case "branch_summary":
      return { kind: "compaction", label: `分支总结：${preview(e.summary, 60)}` };
    case "custom":
      if (e.customType === "resume.point") {
        const n = e.data?.orphanToolCalls?.length ?? 0;
        return { kind: "resume", label: `恢复点${n ? `（${n} 个中断的工具调用）` : ""}` };
      }
      if (e.customType === "resume.progress") {
        return { kind: "progress", label: `进度 ${e.data?.done?.length ?? "?"}/${e.data?.total ?? "?"}` };
      }
      return { kind: "custom", label: `${e.customType}` };
    case "custom_message":
      return { kind: "custom", label: `${e.customType}: ${preview(textOf(e), 60)}` };
    case "label":
      return { kind: "custom", label: `label → ${e.label}` };
    case "session_info":
      return { kind: "custom", label: `name: ${e.name}` };
    default:
      return { kind: e.type, label: "" };
  }
}
