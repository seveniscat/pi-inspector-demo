/**
 * 远程舆情查询服务的适配器（当前演示用本地数据，这个文件留作以后接接口）。
 *
 * ⚠️ 待填：拿到接口文档后，只改本文件标了 TODO 的地方：
 *   1. 各接口路径与鉴权
 *   2. 查询参数映射
 *   3. 返回字段映射（目标形状见 types.ts，字段与本地 Excel 导出一致）
 * 工具层、缓存、UI 都不用动。
 *
 * 配置（.env）：SOCIAL_API_BASE、SOCIAL_API_TOKEN
 */
import { normSentiment } from "./normalize.ts";
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

// TODO(1)：接口路径
const PATHS = {
  info: "/dataset/info",
  posts: "/posts/search",
  post: (id: string) => `/posts/${encodeURIComponent(id)}`,
  comments: "/comments/search",
  trend: "/stats/trend",
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
      // TODO(1)：鉴权方式按服务实际修改
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!res.ok) throw new Error(`舆情服务返回 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  async info(): Promise<DatasetInfo> {
    return this.call(PATHS.info);
  }

  // TODO(2)(3)：参数与字段映射
  async searchPosts(q: PostQuery): Promise<Page<Post>> {
    const raw = await this.call(PATHS.posts, { ...q, platforms: q.platforms });
    return { total: raw.total ?? 0, items: (raw.items ?? []).map(fromPost) };
  }

  async getPost(id: string, topComments = 10): Promise<PostDetail | null> {
    const raw = await this.call(PATHS.post(id), { top_comments: topComments });
    return raw ? { post: fromPost(raw.post ?? raw), top_comments: (raw.comments ?? []).map(fromComment) } : null;
  }

  async searchComments(q: CommentQuery): Promise<Page<Comment>> {
    const raw = await this.call(PATHS.comments, { ...q });
    return { total: raw.total ?? 0, items: (raw.items ?? []).map(fromComment) };
  }

  async trend(q: TrendQuery): Promise<TrendRow[]> {
    return this.call(PATHS.trend, { ...q });
  }
}

function fromPost(r: any): Post {
  return {
    id: String(r.id),
    platform: r.platform,
    title: r.title ?? "",
    author: r.author ?? "",
    url: r.url,
    comment_count: Number(r.comment_count ?? 0),
    sentiment: normSentiment(r.sentiment),
    comment_sentiment: {
      positive: Number(r.positive_comments ?? 0),
      neutral: Number(r.neutral_comments ?? 0),
      negative: Number(r.negative_comments ?? 0),
    },
    relevance: r.relevance,
    source_query: r.source_query,
    published_at: r.published_at,
  };
}

function fromComment(r: any): Comment {
  return {
    id: String(r.id),
    post_id: String(r.post_id),
    post_title: r.post_title,
    platform: r.platform,
    author: r.author ?? "",
    content: r.content ?? "",
    likes: Number(r.likes ?? 0),
    sentiment: normSentiment(r.sentiment),
    is_reply: Boolean(r.is_reply),
    reply_count: Number(r.reply_count ?? 0),
    published_at: r.published_at,
  };
}
