/**
 * 本地数据集实现：读 data/<dataset>/posts.json + comments.json，在内存里检索和聚合。
 *
 * 数据集来源：
 *   - data/demo/：虚构品牌演示语料（scripts/build-corpus.py 生成，可入库）
 *   - data/real/：真实导出数据（scripts/import-excel.py 从 Excel 导入，已 gitignore，不入库）
 */
import fs from "node:fs";
import path from "node:path";
import type {
  Comment,
  CommentQuery,
  DatasetInfo,
  Page,
  Post,
  PostDetail,
  PostQuery,
  SocialProvider,
  TrendQuery,
  TrendRow,
} from "./types.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const day = (iso: string) => (iso || "").slice(0, 10);

/** "a b" = 同时包含；"a|b" = 任一；可组合："英雄令 退款|充值" */
export function matchKeyword(hay: string, keyword?: string): boolean {
  if (!keyword?.trim()) return true;
  const h = hay.toLowerCase();
  return keyword
    .trim()
    .split(/\s+/)
    .every((group) => group.split("|").some((w) => w && h.includes(w.toLowerCase())));
}

function inRange(iso: string, start?: string, end?: string) {
  const d = day(iso);
  return (!start || d >= start) && (!end || d <= end);
}

export class LocalProvider implements SocialProvider {
  readonly mode = "local";
  private name: string;
  private posts: Post[];
  private comments: Comment[];
  private byPost = new Map<string, Comment[]>();
  private postById = new Map<string, Post>();
  private latency: number;

  constructor(dir: string, latencyMs = 0) {
    const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    this.name = path.basename(dir);
    this.posts = read("posts.json");
    this.comments = read("comments.json");
    this.latency = latencyMs;
    for (const p of this.posts) this.postById.set(p.id, p);
    for (const c of this.comments) {
      const list = this.byPost.get(c.post_id) ?? [];
      list.push(c);
      this.byPost.set(c.post_id, list);
    }
  }

  private matchPost(
    p: Post,
    q: { keyword?: string; query?: string; relevance?: string; platforms?: string[]; start?: string; end?: string },
  ) {
    if (!matchKeyword(`${p.title} ${p.source_query ?? ""}`, q.keyword)) return false;
    if (q.query && (p.source_query ?? "") !== q.query) return false;
    if (q.relevance && String(p.relevance ?? "") !== q.relevance) return false;
    if (q.platforms?.length && !q.platforms.includes(p.platform)) return false;
    return inRange(p.published_at, q.start, q.end);
  }

  async info(): Promise<DatasetInfo> {
    const dates = this.posts.map((p) => day(p.published_at)).filter(Boolean).sort();
    const cdates = this.comments.map((c) => day(c.published_at)).filter(Boolean).sort();
    const count = (xs: (string | undefined)[]) => {
      const m: Record<string, number> = {};
      for (const x of xs) if (x !== undefined && x !== "") m[x] = (m[x] ?? 0) + 1;
      return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
    };
    return {
      name: this.name,
      posts: this.posts.length,
      comments: this.comments.length,
      platforms: [...new Set(this.posts.map((p) => p.platform))],
      start: dates[0] ?? "",
      end: dates.at(-1) ?? "",
      comment_start: cdates[0] ?? "",
      comment_end: cdates.at(-1) ?? "",
      source_queries: count(this.posts.map((p) => p.source_query)),
      relevance: count(this.posts.map((p) => (p.relevance === undefined || p.relevance === null ? undefined : String(p.relevance)))),
    };
  }

  async searchPosts(q: PostQuery): Promise<Page<Post>> {
    await sleep(this.latency);
    const hits = this.posts.filter((p) => this.matchPost(p, q) && (!q.sentiment || p.sentiment === q.sentiment));
    const sorters = {
      comments: (a: Post, b: Post) => b.comment_count - a.comment_count,
      negative: (a: Post, b: Post) => b.comment_sentiment.negative - a.comment_sentiment.negative,
      latest: (a: Post, b: Post) => b.published_at.localeCompare(a.published_at),
    };
    hits.sort(sorters[q.sort ?? "comments"]);
    const offset = q.offset ?? 0;
    const limit = Math.min(q.limit ?? 10, 20);
    return { total: hits.length, items: hits.slice(offset, offset + limit) };
  }

  async getPost(id: string, topComments = 10): Promise<PostDetail | null> {
    await sleep(this.latency);
    const post = this.postById.get(id);
    if (!post) return null;
    const top = [...(this.byPost.get(id) ?? [])].sort((a, b) => b.likes - a.likes).slice(0, Math.min(topComments, 20));
    return { post, top_comments: top };
  }

  async searchComments(q: CommentQuery): Promise<Page<Comment>> {
    await sleep(this.latency);
    const pool = q.post_id ? (this.byPost.get(q.post_id) ?? []) : this.comments;
    const postOk = (c: Comment) => {
      if (!q.query && !q.relevance) return true;
      const p = this.postById.get(c.post_id);
      return !!p && this.matchPost(p, { query: q.query, relevance: q.relevance });
    };
    const hits = pool.filter(
      (c) =>
        postOk(c) &&
        matchKeyword(c.content, q.keyword) &&
        (!q.platforms?.length || q.platforms.includes(c.platform)) &&
        (!q.sentiment || c.sentiment === q.sentiment) &&
        inRange(c.published_at, q.start, q.end),
    );
    hits.sort(q.sort === "latest" ? (a, b) => b.published_at.localeCompare(a.published_at) : (a, b) => b.likes - a.likes);
    const offset = q.offset ?? 0;
    const limit = Math.min(q.limit ?? 15, 30);
    return { total: hits.length, items: hits.slice(offset, offset + limit) };
  }

  async trend(q: TrendQuery): Promise<TrendRow[]> {
    await sleep(this.latency);
    const by = q.group_by ?? "day";
    const keyOf = (date: string, platform: string, query?: string) =>
      by === "day" ? day(date) : by === "platform" ? platform : query || "(无)";
    const rows = new Map<string, TrendRow>();
    const row = (key: string) => {
      let r = rows.get(key);
      if (!r) rows.set(key, (r = { key, posts: 0, comments: 0, positive: 0, neutral: 0, negative: 0 }));
      return r;
    };
    const postIds = new Set<string>();
    for (const p of this.posts) {
      if (!this.matchPost(p, { keyword: q.keyword, query: q.query, relevance: q.relevance, platforms: q.platforms })) continue;
      postIds.add(p.id);
      if (inRange(p.published_at, q.start, q.end)) row(keyOf(p.published_at, p.platform, p.source_query)).posts++;
    }
    for (const c of this.comments) {
      if (!postIds.has(c.post_id) || !inRange(c.published_at, q.start, q.end)) continue;
      const r = row(keyOf(c.published_at, c.platform, this.postById.get(c.post_id)?.source_query));
      r.comments++;
      r[c.sentiment ?? "neutral"]++;
    }
    return [...rows.values()].sort((a, b) => (by === "day" ? a.key.localeCompare(b.key) : b.comments - a.comments));
  }
}
