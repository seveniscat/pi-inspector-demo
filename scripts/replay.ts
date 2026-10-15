/**
 * 倍速回放一次存档的演示：npm run replay -- runs/<name> [--speed 3] [--port 5173]
 *
 * 现场模型 / 网络出问题时的兜底：Inspector 页面和真实运行时一模一样，
 * 事件按原始时间间隔（除以倍速）推送，会话树随回放进度生长，报告在回放到写报告之后才出现。
 * 不调模型、不需要 key；控制按钮在回放模式下禁用。
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LocalProvider } from "../src/social/local.ts";
import { readSessionTree } from "../src/session-tree.ts";
import { extractCitations } from "../src/extensions/citations.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const runDir = path.resolve(args.find((a) => !a.startsWith("--")) ?? "");
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const SPEED = Number(opt("speed", "3"));
const PORT = Number(opt("port", "5173"));
const MAX_GAP_MS = 4000; // 原始间隔再长，回放时也最多停这么久（模型思考的空档会被压缩）

if (!fs.existsSync(path.join(runDir, "events.jsonl"))) {
  console.error("用法：npm run replay -- runs/<name> [--speed 3]（先用 npm run save-run 存档）");
  process.exit(1);
}
const events = fs
  .readFileSync(path.join(runDir, "events.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const meta = fs.existsSync(path.join(runDir, "meta.json")) ? JSON.parse(fs.readFileSync(path.join(runDir, "meta.json"), "utf8")) : {};
const dataDir = path.join(ROOT, "data", meta.dataset ?? "demo");
const evidence = fs.existsSync(path.join(dataDir, "posts.json")) ? new LocalProvider(dataDir) : null;

// 回放时钟：当前推送到的事件对应的原始时间戳
let clockTs = 0;
let reportReady = false;

function stream(res: http.ServerResponse) {
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write(`event: reset\ndata: {}\n\n`);
  res.write(`event: replayed\ndata: {}\n\n`); // 没有"历史"，直接进入实时模式，让 UI 播动画
  clockTs = 0;
  reportReady = false;
  let i = 0;
  let closed = false;
  res.on("close", () => (closed = true));
  const next = () => {
    if (closed || i >= events.length) {
      if (!closed) res.write(`data: ${JSON.stringify({ type: "replay_end", ts: Date.now() })}\n\n`);
      return;
    }
    const e = events[i++];
    clockTs = e.ts;
    if (e.type === "citation_check") reportReady = true;
    res.write(`data: ${JSON.stringify(e)}\n\n`);
    const gap = i < events.length ? Math.min(Math.max(events[i].ts - e.ts, 0), MAX_GAP_MS * SPEED) / SPEED : 0;
    setTimeout(next, gap);
  };
  setTimeout(next, 600);
}

const json = (res: http.ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(fs.readFileSync(path.join(ROOT, "public", "index.html")));
    }
    if (url.pathname === "/events") return stream(res);
    if (url.pathname === "/api/state") {
      const start = events.find((e) => e.type === "process_start") ?? {};
      return json(res, 200, { replay: { speed: SPEED, name: meta.name ?? path.basename(runDir) }, busy: false, models: start.models ?? {}, socialMode: start.socialMode, socialDataset: start.socialDataset });
    }
    if (url.pathname === "/api/tree") {
      return json(res, 200, readSessionTree(path.join(runDir, "session.jsonl"), null, clockTs || undefined));
    }
    if (url.pathname === "/api/report") {
      const file = path.join(runDir, "report", "report.md");
      const markdown = reportReady && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
      let citation = null;
      if (markdown && evidence) {
        const ids = extractCitations(markdown);
        const valid = ids.filter((id) => evidence.lookup(id));
        citation = { path: "report/report.md", total: ids.length, valid, invalid: ids.filter((id) => !valid.includes(id)) };
      }
      return json(res, 200, { markdown, citation, demo: meta.dataset === "demo" });
    }
    if (url.pathname === "/api/evidence") {
      const hit = evidence?.lookup(url.searchParams.get("id") ?? "");
      if (!hit) return json(res, 404, { error: "数据中没有这个 ID" });
      if (hit.kind === "comment") return json(res, 200, { ...hit, comment: { ...hit.comment, author: "（已脱敏）" } });
      return json(res, 200, hit);
    }
    if (req.method === "POST") return json(res, 409, { error: "回放模式下不能操作" });
    res.writeHead(404).end();
  })
  .listen(PORT, () => {
    console.log(`\n  回放 ${meta.name ?? runDir}（${events.length} 个事件，×${SPEED}）→ http://localhost:${PORT}\n  刷新页面会从头重播\n`);
  });
