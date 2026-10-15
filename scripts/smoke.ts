/**
 * 冒烟测试：不依赖 Pi、不调模型，只验证数据层（mock 语料 + 缓存）。
 * 运行：npm test（或 node --experimental-strip-types scripts/smoke.ts）
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CachedProvider, stableKey } from "../src/social/cache.ts";
import { MockProvider } from "../src/social/mock.ts";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const corpus = path.join(root, "data", "corpus.json");
const posts = JSON.parse(fs.readFileSync(corpus, "utf8"));

// 语料完整性
const ids = new Set(posts.map((p: any) => p.id));
assert.equal(ids.size, posts.length, "帖子 ID 不能重复");
for (const p of posts) {
  assert.ok(p.id && p.platform && p.created_at && p.text, `字段缺失：${p.id}`);
  assert.ok(["positive", "neutral", "negative"].includes(p.sentiment), `情绪标签非法：${p.id}`);
}

const mock = new MockProvider(corpus, 0);

// 搜索：AND / OR、平台、时间、翻页
const risk = await mock.search({ keyword: "栖木 塑料|异物", limit: 20 });
assert.ok(risk.total >= 10, "风险事件应能被关键词搜到");
const xhs = await mock.search({ keyword: "栖木", platforms: ["xiaohongshu"], limit: 20 });
assert.ok(xhs.items.every((p) => p.platform === "xiaohongshu"), "平台过滤失效");
const day = await mock.search({ keyword: "栖木", start: "2026-10-12", end: "2026-10-12", limit: 20 });
assert.ok(day.items.every((p) => p.created_at.startsWith("2026-10-12")), "日期过滤失效");
const p1 = await mock.search({ keyword: "栖木", limit: 5 });
const p2 = await mock.search({ keyword: "栖木", limit: 5, offset: 5 });
assert.ok(!p1.items.some((a) => p2.items.some((b) => a.id === b.id)), "翻页结果重叠");

// 趋势：10-12 应是互动量峰值（风险事件发酵）
const trend = await mock.trend({ keyword: "栖木", start: "2026-10-08", end: "2026-10-14" });
const peak = trend.reduce((a, b) => (b.engagement > a.engagement ? b : a));
assert.equal(peak.date, "2026-10-12", "互动量峰值应在 10-12");

// 单帖
assert.ok((await mock.getPost("DY-55201"))?.comments?.length, "关键帖子应带热评");
assert.equal(await mock.getPost("NOPE-1"), null);

// 缓存：同一请求第二次命中；参数顺序不影响 key
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-demo-cache-"));
const cached = new CachedProvider(dir, mock, "mock");
const q = { keyword: "鹿岛", limit: 5 };
assert.equal((await cached.run("search", q)).cached, false);
assert.equal((await cached.run("search", { limit: 5, keyword: "鹿岛" })).cached, true);
assert.equal(stableKey("search", { a: 1, b: undefined }), stableKey("search", { a: 1 }));

// replay：命中可读，未命中报错
const replay = new CachedProvider(dir, null, "replay");
assert.equal((await replay.run("search", q)).cached, true);
await assert.rejects(() => replay.run("search", { keyword: "从没查过" }), /replay/);
fs.rmSync(dir, { recursive: true, force: true });

console.log(`smoke ok：${posts.length} 条语料，峰值 ${peak.date}，风险帖 ${risk.total} 条`);
