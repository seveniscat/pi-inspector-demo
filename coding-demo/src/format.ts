/** 终端显示宽度：中日韩字符按 2 列计算 */
function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    w += (ch.codePointAt(0) ?? 0) > 0x2e80 ? 2 : 1;
  }
  return w;
}

function pad(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - displayWidth(s)));
}

/** 把二维数据渲染成对齐的纯文本表格，第一行是表头 */
export function renderTable(rows: (string | number)[][]): string {
  const cells = rows.map((r) => r.map(String));
  const widths = cells[0].map((_, i) => Math.max(...cells.map((r) => displayWidth(r[i] ?? ""))));
  const line = (r: string[]) => r.map((c, i) => pad(c, widths[i])).join("  ").trimEnd();
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  return [line(cells[0]), sep, ...cells.slice(1).map(line)].join("\n");
}
