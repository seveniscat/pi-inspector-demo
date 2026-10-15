/**
 * 离线语料实现：在 data/corpus.json 上做检索。用于彩排、现场兜底，以及没有真实服务时的演示。
 * 语料是虚构品牌的虚构帖子，页面和报告里要标明"演示数据"。
 */
import fs from "node:fs";
import type { Post, SearchQuery, SearchResult, SocialProvider, TrendPoint, TrendQuery } from "./types.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function matchKeyword(post: Post, keyword?: string): boolean {
  if (!keyword?.trim()) return true;
  const hay = (post.text + " " + post.topics.join(" ")).toLowerCase();
  // "a b" = 同时包含；"a|b" = 任一；可组合："栖木 异物|塑料"
  return keyword
    .trim()
    .split(/\s+/)
    .every((group) => group.split("|").some((w) => w && hay.includes(w.toLowerCase())));
}

export function filterPosts(posts: Post[], q: SearchQuery | TrendQuery): Post[] {
  return posts.filter((p) => {
    if (!matchKeyword(p, q.keyword)) return false;
    if (q.topic && !p.topics.some((t) => t.includes(q.topic!))) return false;
    if (q.platforms?.length && !q.platforms.includes(p.platform)) return false;
    const d = p.created_at.slice(0, 10);
    if (q.start && d < q.start) return false;
    if (q.end && d > q.end) return false;
    return true;
  });
}

const heat = (p: Post) => p.likes + p.comments_count * 3 + p.shares * 5;

export class MockProvider implements SocialProvider {
  readonly mode = "mock";
  private posts: Post[];
  private latency: number;

  constructor(corpusFile: string, latencyMs = 0) {
    this.posts = JSON.parse(fs.readFileSync(corpusFile, "utf8"));
    this.latency = latencyMs;
  }

  async search(q: SearchQuery): Promise<SearchResult> {
    await sleep(this.latency);
    const hits = filterPosts(this.posts, q);
    hits.sort((a, b) => (q.sort === "latest" ? b.created_at.localeCompare(a.created_at) : heat(b) - heat(a)));
    const offset = q.offset ?? 0;
    const limit = Math.min(q.limit ?? 10, 20);
    return { total: hits.length, items: hits.slice(offset, offset + limit) };
  }

  async getPost(id: string): Promise<Post | null> {
    await sleep(this.latency);
    return this.posts.find((p) => p.id === id) ?? null;
  }

  async trend(q: TrendQuery): Promise<TrendPoint[]> {
    await sleep(this.latency);
    const byDay = new Map<string, TrendPoint>();
    for (const p of filterPosts(this.posts, q)) {
      const date = p.created_at.slice(0, 10);
      const t = byDay.get(date) ?? { date, count: 0, positive: 0, neutral: 0, negative: 0, engagement: 0 };
      t.count++;
      t[p.sentiment ?? "neutral"]++;
      t.engagement += p.likes + p.comments_count + p.shares;
      byDay.set(date, t);
    }
    return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
}
