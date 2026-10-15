/**
 * 舆情数据层的统一接口。数据模型按真实数据的"帖子 + 评论"两张表设计：
 *   帖子：ID 平台 平台ID 标题 作者 URL 评论数 情绪标签 积极/中性/消极评论数 相关性 来自搜索 发布时间 抓取时间
 *   评论：ID 帖子ID 所属帖子标题 平台 平台ID 作者 内容 点赞数 情绪标签 是否回复 回复数 发布时间 抓取时间
 * local / live / replay 三种实现都返回这里的形状，工具层（extensions/social.ts）只依赖这些类型。
 */

export type Sentiment = "positive" | "neutral" | "negative";

export interface Post {
  id: string;
  platform: string;
  platform_id?: string;
  title: string;
  author: string;
  url?: string;
  comment_count: number;
  sentiment?: Sentiment;
  comment_sentiment: { positive: number; neutral: number; negative: number };
  relevance?: number | string; // 原始相关性：数值或标签
  source_query?: string; // 抓取时用的搜索词
  published_at: string; // ISO8601；源数据只有日期时为 YYYY-MM-DD
  crawled_at?: string;
}

export interface Comment {
  id: string;
  post_id: string;
  post_title?: string;
  platform: string;
  author: string;
  content: string;
  likes: number;
  sentiment?: Sentiment;
  is_reply: boolean;
  reply_count: number;
  published_at: string;
}

export interface PostQuery {
  keyword?: string; // 匹配标题和来自搜索；空格 = 同时包含，| = 任一
  platforms?: string[];
  start?: string; // YYYY-MM-DD
  end?: string; // YYYY-MM-DD（含）
  query?: string; // 按"来自搜索"（监测词）精确过滤
  sentiment?: Sentiment;
  relevance?: string; // 按相关性标签精确过滤，如「相关」
  sort?: "comments" | "negative" | "latest";
  limit?: number;
  offset?: number;
}

export interface CommentQuery {
  keyword?: string; // 匹配评论内容
  post_id?: string;
  query?: string; // 只看某个监测词（来自搜索）下帖子的评论
  relevance?: string; // 只看相关性为该标签的帖子下的评论
  platforms?: string[];
  start?: string;
  end?: string;
  sentiment?: Sentiment;
  sort?: "likes" | "latest";
  limit?: number;
  offset?: number;
}

export interface Page<T> {
  total: number;
  items: T[];
}

export interface PostDetail {
  post: Post;
  top_comments: Comment[];
}

export interface TrendQuery {
  keyword?: string; // 匹配帖子标题和来自搜索；评论按所属帖子计入
  query?: string; // 只统计某个监测词
  relevance?: string; // 只统计相关性为该标签的帖子
  platforms?: string[];
  start?: string;
  end?: string;
  group_by?: "day" | "platform" | "query";
}

export interface TrendRow {
  key: string; // 日期 / 平台 / 监测词
  posts: number;
  comments: number;
  positive: number; // 评论情绪
  neutral: number;
  negative: number;
}

export interface DatasetInfo {
  name: string;
  posts: number;
  comments: number;
  platforms: string[];
  start: string;
  end: string;
  source_queries: Record<string, number>; // 来自搜索 → 帖子数
  relevance: Record<string, number>; // 相关性取值 → 帖子数
  comment_start: string;
  comment_end: string;
}

export interface SocialProvider {
  readonly mode: string;
  info(): Promise<DatasetInfo>;
  searchPosts(q: PostQuery): Promise<Page<Post>>;
  getPost(id: string, topComments?: number): Promise<PostDetail | null>;
  searchComments(q: CommentQuery): Promise<Page<Comment>>;
  trend(q: TrendQuery): Promise<TrendRow[]>;
}

export const SENTIMENT_CN: Record<Sentiment, string> = { positive: "积极", neutral: "中性", negative: "消极" };
