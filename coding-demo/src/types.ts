export interface Post {
  id: string;
  platform: string;
  author: string;
  content: string;
  likes: number;
  comments: number;
  /** 格式：YYYY-MM-DD HH:mm */
  createdAt: string;
}

export interface PlatformSummary {
  platform: string;
  posts: number;
  likes: number;
  comments: number;
  avgEngagement: number;
}
