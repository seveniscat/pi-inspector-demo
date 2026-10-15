// 把一次跑通的演示存档到 runs/<name>/，用于现场兜底回放：npm run save-run -- <name>
//   存：logs/events.jsonl、本次会话的 session JSONL、workspace/research、workspace/report
//   runs/ 已 gitignore（用真实数据跑出来的内容不入库）
import fs from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const name = process.argv[2] || new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const out = path.join(root, "runs", name);
const events = path.join(root, "logs", "events.jsonl");
if (!fs.existsSync(events)) {
  console.error("没有 logs/events.jsonl，先完整跑一遍演示");
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(events, path.join(out, "events.jsonl"));

// 从事件里找最后一次 session_ready 的会话文件
const lines = fs.readFileSync(events, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const ready = lines.filter((e) => e.type === "session_ready" && e.sessionFile).at(-1);
if (ready && fs.existsSync(ready.sessionFile)) fs.copyFileSync(ready.sessionFile, path.join(out, "session.jsonl"));
else console.warn("没找到会话文件，回放时会话树为空");

for (const dir of ["research", "report"]) {
  const src = path.join(root, "workspace", dir);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(out, dir), { recursive: true });
}
const dataset = lines.find((e) => e.type === "process_start")?.socialDataset ?? "demo";
fs.writeFileSync(path.join(out, "meta.json"), JSON.stringify({ name, savedAt: new Date().toISOString(), dataset, events: lines.length }, null, 2));
console.log(`已存档 → runs/${name}/（${lines.length} 个事件）\n回放：npm run replay -- runs/${name} --speed 3`);
