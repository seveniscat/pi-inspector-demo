import type { PlatformSummary, Post } from "./types.ts";

/** 互动量：评论比点赞更能代表讨论热度，权重 x2 */
export function engagement(post: Post): number {
  return post.likes + post.comments * 2;
}

/** 互动量最高的前 n 条帖子（从高到低） */
export function topPosts(posts: Post[], n = 3): Post[] {
  return [...posts].sort((a, b) => engagement(a) - engagement(b)).slice(0, n);
}

/** 按平台汇总，按平台总互动量从高到低排序 */
export function summarizeByPlatform(posts: Post[]): PlatformSummary[] {
  const groups = new Map<string, Post[]>();
  for (const p of posts) {
    const list = groups.get(p.platform) ?? [];
    list.push(p);
    groups.set(p.platform, list);
  }

  const result: PlatformSummary[] = [];
  for (const [platform, list] of groups) {
    const likes = list.reduce((s, p) => s + p.likes, 0);
    const comments = list.reduce((s, p) => s + p.comments, 0);
    const total = list.reduce((s, p) => s + engagement(p), 0);
    result.push({
      platform,
      posts: list.length,
      likes,
      comments,
      avgEngagement: Math.round(total / list.length),
    });
  }
  return result.sort((a, b) => b.avgEngagement * b.posts - a.avgEngagement * a.posts);
}
