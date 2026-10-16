import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadPosts } from "../src/csv.ts";
import { engagement, summarizeByPlatform, topPosts } from "../src/stats.ts";

const posts = loadPosts(readFileSync(new URL("../data/posts.csv", import.meta.url), "utf8"));

test("engagement: 点赞 + 评论 x2", () => {
  assert.equal(engagement(posts[0]), 1820 + 233 * 2);
});

test("topPosts: 按互动量从高到低取前 3", () => {
  const ids = topPosts(posts, 3).map((p) => p.id);
  assert.deepEqual(ids, ["p13", "p05", "p17"]);
});

test("topPosts: 不修改原数组", () => {
  const before = posts.map((p) => p.id);
  topPosts(posts, 5);
  assert.deepEqual(
    posts.map((p) => p.id),
    before,
  );
});

test("summarizeByPlatform: 三个平台，帖子数合计 21", () => {
  const summary = summarizeByPlatform(posts);
  assert.equal(summary.length, 3);
  assert.equal(
    summary.reduce((s, x) => s + x.posts, 0),
    21,
  );
  assert.equal(summary[0].platform, "抖音");
});
