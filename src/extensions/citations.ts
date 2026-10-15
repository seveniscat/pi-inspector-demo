/** 从报告里提取 [ID] 形式的引用（排除 markdown 链接 [text](url)）。独立成文件，回放脚本也能用 */
export function extractCitations(md: string): string[] {
  const ids = new Set<string>();
  for (const m of md.matchAll(/\[([A-Za-z0-9_-]{2,40})\](?!\()/g)) ids.add(m[1]);
  return [...ids];
}
