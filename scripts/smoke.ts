/**
 * 冒烟测试：不依赖 Pi、不调模型，只验证数据层（本地数据集 + 缓存 + 工具输出格式化）。
 * 默认测 demo 数据集；SMOKE_DATASET=real npm test 可以对导入的真实数据跑一遍基本检查。
 * 运行：npm test
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CachedProvider, stableKey } from "../src/social/cache.ts";
import { LocalProvider } from "../src/social/local.ts";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dataset = process.env.SMOKE_DATASET || "demo";
const dir = path.join(root, "data", dataset);
const posts = JSON.parse(fs.readFileSync(path.join(dir, "posts.json"), "utf8"));
const comments = JSON.parse(fs.readFileSync(path.join(dir, "comments.json"), "utf8"));

// ── 数据完整性（任何数据集都要满足）──
const ids = new Set(posts.map((p: any) => p.id));
assert.equal(ids.size, posts.length, "帖子 ID 不能重复");
for (const p of posts) assert.ok(p.id && p.platform && p.title !== undefined && p.published_at, `帖子字段缺失：${p.id}`);
assert.equal(new Set(comments.map((c: any) => c.id)).size, comments.length, "评论 ID 不能重复");
const orphan = comments.filter((c: any) => !ids.has(c.post_id)).length;
assert.ok(orphan / Math.max(comments.length, 1) < 0.05, `找不到所属帖子的评论过多：${orphan}`);

const local = new LocalProvider(dir, 0);
const info = await local.info();
assert.equal(info.posts, posts.length);
assert.ok(info.start && info.end, "时间范围为空，检查发布时间字段");

// 通用行为：平台 / 日期过滤、翻页不重叠、评论按点赞排序
const plat = info.platforms[0];
const byPlat = await local.searchPosts({ platforms: [plat], limit: 20 });
assert.ok(byPlat.items.every((p) => p.platform === plat), "平台过滤失效");
const d = await local.searchPosts({ start: info.end, end: info.end, limit: 20 });
assert.ok(d.items.every((p) => p.published_at.startsWith(info.end)), "日期过滤失效");
const p1 = await local.searchPosts({ limit: 5 });
const p2 = await local.searchPosts({ limit: 5, offset: 5 });
assert.ok(!p1.items.some((a) => p2.items.some((b) => a.id === b.id)), "翻页结果重叠");
const top = await local.searchComments({ limit: 10 });
assert.ok(top.items.every((c, i, a) => i === 0 || a[i - 1].likes >= c.likes), "评论应按点赞降序");
const detail = await local.getPost(p1.items[0].id, 5);
assert.ok(detail && detail.top_comments.every((c) => c.post_id === p1.items[0].id), "get_post 返回了别的帖子的评论");
assert.equal(await local.getPost("NOPE-1"), null);
const trend = await local.trend({});
assert.ok(trend.length > 0, "趋势为空");
const byPlatform = await local.trend({ group_by: "platform" });
assert.equal(byPlatform.reduce((s, r) => s + r.posts, 0), posts.length, "按平台统计的帖子数应等于总数");

// ── demo 数据集特有：埋好的线索能被找到 ──
if (dataset === "demo") {
  const risk = await local.searchPosts({ keyword: "塑料|异物|泵头", limit: 20 });
  assert.ok(risk.total >= 8, "风险事件应能被关键词搜到");
  const neg = await local.searchComments({ keyword: "封口膜", sentiment: "negative" });
  assert.ok(neg.total >= 1, "应能在消极评论里搜到'封口膜'");
  const peak = (await local.trend({ keyword: "栖木", start: "2026-10-08", end: "2026-10-14" }))
    .reduce((a, b) => (b.negative > a.negative ? b : a));
  assert.ok(["2026-10-12", "2026-10-13"].includes(peak.key), `消极评论峰值应在 10-12/13，实际 ${peak.key}`);
}

// ── 缓存：同一请求第二次命中；参数顺序不影响 key；replay 未命中报错 ──
const cdir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-demo-cache-"));
const cached = new CachedProvider(cdir, local, "local");
const q = { keyword: "a|b", limit: 5 };
assert.equal((await cached.run("searchPosts", q)).cached, false);
assert.equal((await cached.run("searchPosts", { limit: 5, keyword: "a|b" })).cached, true);
assert.equal(stableKey("x", { a: 1, b: undefined }), stableKey("x", { a: 1 }));
const replay = new CachedProvider(cdir, null, "replay");
assert.equal((await replay.run("searchPosts", q)).cached, true);
await assert.rejects(() => replay.run("searchPosts", { keyword: "从没查过" }), /replay/);
fs.rmSync(cdir, { recursive: true, force: true });

console.log(`smoke ok [${dataset}]：帖子 ${info.posts}，评论 ${info.comments}，平台 ${info.platforms.join("/")}，${info.start} ~ ${info.end}`);
