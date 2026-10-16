import type { Post } from "./types.ts";

/**
 * 极简 CSV 解析：支持双引号包裹的字段（字段内可含逗号）。
 * 规则遵循 RFC 4180：引号字段内用两个双引号 "" 表示一个字面量双引号。
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function loadPosts(text: string): Post[] {
  const [header, ...rows] = parseCsv(text.trim());
  const col = (name: string) => {
    const idx = header.indexOf(name);
    if (idx === -1) throw new Error(`CSV 缺少列: ${name}`);
    return idx;
  };
  const c = {
    id: col("id"),
    platform: col("platform"),
    author: col("author"),
    content: col("content"),
    likes: col("likes"),
    comments: col("comments"),
    createdAt: col("created_at"),
  };

  return rows.map((r) => ({
    id: r[c.id],
    platform: r[c.platform],
    author: r[c.author],
    content: r[c.content],
    likes: Number(r[c.likes]),
    comments: Number(r[c.comments]),
    createdAt: r[c.createdAt],
  }));
}
