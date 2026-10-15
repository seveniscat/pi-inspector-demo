/**
 * Demo 主程序：用 Pi SDK 把 agent 嵌进自己的 Node 服务，再用 SSE 把每一步推给 Web UI。
 *
 *   npm start        继续最近的会话（kill 之后用这个恢复）
 *   npm run start:new   开一个新会话
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { EventLog, normalizePiEvent } from "./event-log.ts";
import { createResumeExtension } from "./extensions/resume.ts";
import { createSocialExtension } from "./extensions/social.ts";
import { readSessionTree } from "./session-tree.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE = path.join(ROOT, "workspace");

try {
  (process as any).loadEnvFile?.(path.join(ROOT, ".env"));
} catch {
  console.warn("[demo] 没找到 .env，使用当前环境变量");
}

const FRESH = process.argv.includes("--new");
const PORT = Number(process.env.PORT || 5173);
const MODEL_A = process.env.MODEL_A || "";
const MODEL_B = process.env.MODEL_B || "";
const STEP_DELAY = Number(process.env.DEMO_STEP_DELAY_MS || 0);
const COMPACT_AT = Number(process.env.DEMO_COMPACT_AT_TOKENS || 0);
const KEEP_RECENT = Number(process.env.DEMO_KEEP_RECENT_TOKENS || 0);
// 数据源：local（本地数据集，默认）/ live（远程接口）/ replay（回放 live 录制）。旧值 mock 等同 local + demo
const RAW_MODE = process.env.SOCIAL_MODE || "local";
const SOCIAL_MODE = (RAW_MODE === "mock" ? "local" : RAW_MODE) as "local" | "live" | "replay";
const SOCIAL_DATASET = RAW_MODE === "mock" ? "demo" : process.env.SOCIAL_DATASET || "demo";
const DEFAULT_TASK =
  process.env.DEMO_TASK ||
  (SOCIAL_MODE === "local" && SOCIAL_DATASET === "demo"
    ? "关于栖木咖啡桂花燕麦拿铁的舆情"
    : "关于英雄令的舆情");

fs.writeFileSync(path.join(ROOT, ".demo.pid"), String(process.pid));
const bus = new EventLog(path.join(ROOT, "logs", "events.jsonl"));

// ── 1. 模型层：内置 provider + models.json 里的自定义 provider ──
const modelRuntime = await ModelRuntime.create({ modelsPath: path.join(ROOT, "models.json") });

function resolveModel(spec: string) {
  const i = spec.indexOf("/");
  if (i < 0) throw new Error(`模型格式应为 provider/modelId，收到：${spec}`);
  const model = (modelRuntime as any).getModel(spec.slice(0, i), spec.slice(i + 1));
  if (!model) throw new Error(`找不到模型 ${spec}。检查 models.json 或运行 npx pi --list-models`);
  return model;
}

// ── 2. 设置：调低压缩阈值，现场才看得到自动 compaction ──
const settingsManager = SettingsManager.create(WORKSPACE);
const compactionOverrides: Record<string, unknown> = {};
if (COMPACT_AT > 0) {
  const window = MODEL_A ? (resolveModel(MODEL_A).contextWindow ?? 128000) : 128000;
  compactionOverrides.enabled = true;
  compactionOverrides.reserveTokens = Math.max(1024, window - COMPACT_AT);
}
if (KEEP_RECENT > 0) compactionOverrides.keepRecentTokens = KEEP_RECENT;
if (Object.keys(compactionOverrides).length) {
  (settingsManager as any).applyOverrides({ compaction: compactionOverrides });
}

// ── 3. 资源：两个 inline extension + 工作区里的 skill / AGENTS.md ──
//    social：把舆情查询服务包成 3 个工具；resume：checkpoint + 崩溃恢复
const resourceLoader = new DefaultResourceLoader({
  cwd: WORKSPACE,
  settingsManager,
  extensionFactories: [
    {
      name: "social",
      factory: createSocialExtension(bus.emit, {
        mode: SOCIAL_MODE,
        dataDir: path.join(ROOT, "data"),
        dataset: SOCIAL_DATASET,
        apiBase: process.env.SOCIAL_API_BASE,
        apiToken: process.env.SOCIAL_API_TOKEN,
        latencyMs: Number(process.env.SOCIAL_LATENCY_MS || process.env.SOCIAL_MOCK_LATENCY_MS || 0),
      }),
    },
    { name: "resume", factory: createResumeExtension(bus.emit, { stepDelayMs: STEP_DELAY, trustedCwd: WORKSPACE }) },
  ],
} as any);
await resourceLoader.reload();

const skillsResult: any = (resourceLoader as any).getSkills?.();
const skills: any[] = Array.isArray(skillsResult) ? skillsResult : (skillsResult?.skills ?? []);

// ── 4. 会话：新建 or 接着最近一次 ──
let busy = false;
let lastProgress: unknown = null;
let lastSessionStart: any = null;

bus.on((e) => {
  if (e.type === "agent_start") busy = true;
  if (e.type === "agent_end") busy = false;
  if (e.type === "resume_progress") lastProgress = e;
  if (e.type === "resume_session_start") {
    lastSessionStart = e;
    if ((e as any).progress) lastProgress = (e as any).progress;
  }
});

const sessionManager = FRESH ? SessionManager.create(WORKSPACE) : SessionManager.continueRecent(WORKSPACE);
const hasHistory = ((sessionManager as any).getEntries?.() ?? []).length > 0;

bus.emit({
  type: "process_start",
  mode: FRESH ? "new" : "continue",
  models: { A: MODEL_A, B: MODEL_B },
  socialMode: SOCIAL_MODE,
  socialDataset: SOCIAL_DATASET,
  skills: skills.map((s) => ({ name: s.name, description: s.description, filePath: s.filePath })),
  compaction: compactionOverrides,
  stepDelayMs: STEP_DELAY,
});

let session: any;
try {
  const created = await createAgentSession({
    cwd: WORKSPACE,
    modelRuntime,
    // 新会话用 MODEL_A；继续已有会话时不传 model，让 Pi 从 JSONL 恢复上次用的模型
    ...(MODEL_A && !hasHistory ? { model: resolveModel(MODEL_A) } : {}),
    sessionManager,
    settingsManager,
    resourceLoader,
  } as any);
  session = created.session;
  if (created.modelFallbackMessage) bus.emit({ type: "warning", message: created.modelFallbackMessage });
  const ext: any = created.extensionsResult;
  bus.emit({
    type: "session_ready",
    sessionFile: session.sessionFile,
    sessionId: session.sessionId,
    model: currentModel(),
    extensions: (ext?.extensions ?? []).map((e: any) => e.name ?? e.path ?? "?"),
    extensionErrors: ext?.errors,
  });
} catch (err: any) {
  bus.emit({ type: "error", where: "createAgentSession", message: String(err?.message ?? err) });
  console.error(err);
}

function currentModel() {
  const m = session?.model ?? session?.agent?.state?.model;
  return m ? `${m.provider}/${m.id}` : null;
}

// ── 5. 订阅 Pi 的事件流 → 可视化 ──
session?.subscribe((ev: any) => {
  const n = normalizePiEvent(ev);
  if (n) bus.emit(n);
});

function send(text: string) {
  if (!session) throw new Error("session 未创建成功");
  const opts = busy ? { streamingBehavior: "followUp" } : undefined;
  bus.emit({ type: "user_prompt", text, mode: busy ? "followUp" : "prompt" });
  session.prompt(text, opts).catch((err: any) => {
    bus.emit({ type: "error", where: "prompt", message: String(err?.message ?? err) });
  });
}

// ── 6. HTTP：静态页 + SSE + 控制接口 ──
const RESUME_PROMPT =
  "进程刚才被意外终止，现在已经恢复。请先查看 research/plan.md 以及 research/、report/ 目录，确认研究范围和哪些问题已经完成，" +
  "然后从中断处继续舆情研究，不要重新界定范围，也不要重复已完成的问题。";

async function readBody(req: http.IncomingMessage): Promise<any> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(path.join(ROOT, "public", "index.html")));
      return;
    }
    if (req.method === "GET" && url.pathname === "/events") return bus.attach(res);

    if (req.method === "GET" && url.pathname === "/api/state") {
      return json(res, 200, {
        pid: process.pid,
        busy,
        sessionFile: session?.sessionFile,
        model: currentModel(),
        models: { A: MODEL_A, B: MODEL_B },
        progress: lastProgress,
        sessionStart: lastSessionStart,
        skills: skills.map((s) => s.name),
        socialMode: SOCIAL_MODE,
        socialDataset: SOCIAL_DATASET,
        defaultTask: DEFAULT_TASK,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/tree") {
      const leafId = session?.sessionManager?.getLeafId?.() ?? null;
      return json(res, 200, readSessionTree(session?.sessionFile, leafId));
    }

    if (req.method === "POST" && url.pathname === "/api/prompt") {
      const { text } = await readBody(req);
      if (!text) return json(res, 400, { error: "text 不能为空" });
      send(text);
      return json(res, 200, { ok: true, queued: busy });
    }

    // steer：agent 运行中插话纠偏，尽快在当前循环里生效；follow-up（/api/prompt 在运行中调用时）等本轮结束再处理
    if (req.method === "POST" && url.pathname === "/api/steer") {
      const { text } = await readBody(req);
      if (!text) return json(res, 400, { error: "text 不能为空" });
      if (!busy) {
        send(text);
        return json(res, 200, { ok: true, mode: "prompt" });
      }
      bus.emit({ type: "user_prompt", text, mode: "steer" });
      Promise.resolve(session.steer(text)).catch((err: any) =>
        bus.emit({ type: "error", where: "steer", message: String(err?.message ?? err) }),
      );
      return json(res, 200, { ok: true, mode: "steer" });
    }

    if (req.method === "POST" && url.pathname === "/api/resume") {
      send(RESUME_PROMPT);
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/model") {
      const { spec } = await readBody(req);
      const model = resolveModel(spec);
      const ok = await session.setModel(model);
      bus.emit({ type: "model_switch_request", spec, ok: ok !== false, model: currentModel() });
      return json(res, 200, { ok: ok !== false, model: currentModel() });
    }

    if (req.method === "POST" && url.pathname === "/api/compact") {
      if (busy) return json(res, 409, { error: "agent 正在运行，等它停下再压缩" });
      bus.emit({ type: "manual_compact_request" });
      session
        .compact("保留研究范围（对象、别名、排除词、时间、平台）、4 个研究问题及完成状态、关键证据的帖子 / 评论 ID、风险事件时间线。")
        .then((r: any) => bus.emit({ type: "manual_compact_done", tokensBefore: r?.tokensBefore }))
        .catch((err: any) => bus.emit({ type: "error", where: "compact", message: String(err?.message ?? err) }));
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/abort") {
      await session?.abort?.();
      return json(res, 200, { ok: true });
    }

    res.writeHead(404).end();
  } catch (err: any) {
    bus.emit({ type: "error", where: url.pathname, message: String(err?.message ?? err) });
    json(res, 500, { error: String(err?.message ?? err) });
  }
});

server.listen(PORT, () => {
  console.log(`\n  Pi demo 已启动  →  http://localhost:${PORT}`);
  console.log(`  pid ${process.pid}（npm run kill 可模拟崩溃）`);
  console.log(`  会话文件 ${session?.sessionFile ?? "(未创建)"}\n`);
});

// 终端兜底日志：网页出问题时，终端里也能看到每一步
bus.on((e) => {
  if (e.type === "text_delta" || e.type === "thinking_delta") return;
  const t = new Date(e.ts as number).toLocaleTimeString();
  const brief =
    e.type === "tool_execution_start"
      ? `${e.toolName} ${JSON.stringify(e.args).slice(0, 100)}`
      : e.type === "tool_execution_end"
        ? `${e.toolName} ${e.isError ? "✗" : "✓"}`
        : e.type === "message_end"
          ? `${e.role} ${String(e.text ?? "").slice(0, 80).replace(/\n/g, " ")}`
          : "";
  console.log(`${t}  ${String(e.type).padEnd(24)} ${brief}`);
});
