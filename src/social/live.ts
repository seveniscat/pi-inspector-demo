/**
 * 真实舆情查询服务的适配器。
 *
 * ⚠️ 待填：拿到服务的接口文档后，只需要改本文件里标了 TODO 的三处：
 *   1. 各接口的路径
 *   2. toXxxParams()：把我们的查询参数翻译成服务的参数
 *   3. fromXxx()：把服务的返回翻译成 types.ts 里的形状
 * 工具层、缓存、UI 都不用动。
 *
 * 配置（.env）：SOCIAL_API_BASE、SOCIAL_API_TOKEN、SOCIAL_API_TIMEOUT_MS
 */
import type { Post, SearchQuery, SearchResult, SocialProvider, TrendPoint, TrendQuery } from "./types.ts";

// TODO(1)：接口路径
const PATHS = {
  search: "/posts/search",
  post: (id: string) => `/posts/${encodeURIComponent(id)}`,
  trend: "/posts/trend",
};

export class LiveProvider implements SocialProvider {
  readonly mode = "live";
  private base: string;
  private token: string;
  private timeout: number;

  constructor(base: string, token: string, timeoutMs = 15000) {
    if (!base) throw new Error("SOCIAL_MODE=live 需要配置 SOCIAL_API_BASE");
    this.base = base.replace(/\/$/, "");
    this.token = token;
    this.timeout = timeoutMs;
  }

  private async call(path: string, params?: Record<string, unknown>): Promise<any> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, Array.isArray(v) ? v.join(",") : String(v));
    }
    const res = await fetch(url, {
      // TODO(1)：鉴权方式按服务实际修改（Bearer / 自定义 header / 签名）
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!res.ok) throw new Error(`舆情服务返回 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  async search(q: SearchQuery): Promise<SearchResult> {
    const raw = await this.call(PATHS.search, toSearchParams(q));
    return fromSearch(raw);
  }

  async getPost(id: string): Promise<Post | null> {
    const raw = await this.call(PATHS.post(id));
    return raw ? fromPost(raw) : null;
  }

  async trend(q: TrendQuery): Promise<TrendPoint[]> {
    const raw = await this.call(PATHS.trend, toTrendParams(q));
    return fromTrend(raw);
  }
}

// ── TODO(2)：查询参数映射 ──
function toSearchParams(q: SearchQuery): Record<string, unknown> {
  return {
    keyword: q.keyword,
    topic: q.topic,
    platform: q.platforms,
    start_date: q.start,
    end_date: q.end,
    sort: q.sort,
    page_size: q.limit ?? 10,
    offset: q.offset ?? 0,
  };
}

function toTrendParams(q: TrendQuery): Record<string, unknown> {
  return { keyword: q.keyword, topic: q.topic, platform: q.platforms, start_date: q.start, end_date: q.end, granularity: "day" };
}

// ── TODO(3)：返回字段映射 ──
function fromSearch(raw: any): SearchResult {
  const items = raw?.data?.items ?? raw?.items ?? [];
  return { total: raw?.data?.total ?? raw?.total ?? items.length, items: items.map(fromPost) };
}

function fromPost(r: any): Post {
  return {
    id: String(r.id),
    platform: r.platform,
    created_at: r.created_at ?? r.publish_time,
    author: {
      name: r.author?.name ?? r.author_name ?? "",
      followers: Number(r.author?.followers ?? r.fans ?? 0),
      verified: Boolean(r.author?.verified),
      type: r.author?.type ?? "normal",
    },
    text: r.text ?? r.content ?? "",
    topics: r.topics ?? r.tags ?? [],
    likes: Number(r.likes ?? r.like_count ?? 0),
    comments_count: Number(r.comments_count ?? r.comment_count ?? 0),
    shares: Number(r.shares ?? r.share_count ?? 0),
    sentiment: r.sentiment,
    comments: (r.comments ?? []).map((c: any) => ({ author: c.author ?? "", text: c.text ?? c.content ?? "", likes: Number(c.likes ?? 0) })),
  };
}

function fromTrend(raw: any): TrendPoint[] {
  const rows = raw?.data ?? raw ?? [];
  return rows.map((r: any) => ({
    date: r.date,
    count: Number(r.count ?? 0),
    positive: Number(r.positive ?? 0),
    neutral: Number(r.neutral ?? 0),
    negative: Number(r.negative ?? 0),
    engagement: Number(r.engagement ?? 0),
  }));
}
