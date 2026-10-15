/**
 * 舆情数据层的统一接口。
 * mock / live / replay 三种实现都返回这里的形状，工具层（extensions/social.ts）只依赖这些类型。
 */

export type Platform = "xiaohongshu" | "weibo" | "douyin" | string;
export type Sentiment = "positive" | "neutral" | "negative";
export type AuthorType = "normal" | "kol" | "official" | "marketing" | "media";

export interface Author {
  name: string;
  followers: number;
  verified: boolean;
  type: AuthorType;
}

export interface Comment {
  author: string;
  text: string;
  likes: number;
}

export interface Post {
  id: string;
  platform: Platform;
  created_at: string; // ISO8601，东八区
  author: Author;
  text: string;
  topics: string[];
  likes: number;
  comments_count: number;
  shares: number;
  sentiment?: Sentiment;
  comments?: Comment[];
}

export interface SearchQuery {
  keyword?: string; // 空格 = 同时包含；| = 任一
  topic?: string;
  platforms?: Platform[];
  start?: string; // YYYY-MM-DD
  end?: string; // YYYY-MM-DD（含）
  sort?: "hot" | "latest";
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  total: number;
  items: Post[];
}

export interface TrendQuery {
  keyword?: string;
  topic?: string;
  platforms?: Platform[];
  start?: string;
  end?: string;
}

export interface TrendPoint {
  date: string;
  count: number;
  positive: number;
  neutral: number;
  negative: number;
  engagement: number; // 点赞 + 评论 + 转发
}

export interface SocialProvider {
  readonly mode: string;
  search(q: SearchQuery): Promise<SearchResult>;
  getPost(id: string): Promise<Post | null>;
  trend(q: TrendQuery): Promise<TrendPoint[]>;
}
