/**
 * Social extension —— 把舆情查询服务包成 3 个 Pi 工具。
 *
 * 这一段是"Pi 怎么接我们自己的系统"的答案：内核只有 read / write / edit / bash，
 * 业务能力通过 extension 的 registerTool 加进来，模型看到的就是普通工具。
 *
 * 设计要点：
 * - 工具只返回精简文本（摘要列表 / 单帖详情 / 按天统计），原始大 JSON 不进上下文
 * - 每次调用都过缓存（social/cache.ts）：恢复后重复查询直接命中，不重复打外部服务
 * - 工具结果的 details 里带 cached / mode / ms，Inspector 据此显示"缓存命中"
 */
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { CachedProvider } from "../social/cache.ts";
import { LiveProvider } from "../social/live.ts";
import { MockProvider } from "../social/mock.ts";
import type { Post, SearchQuery, SearchResult, TrendPoint, TrendQuery } from "../social/types.ts";

export type Emit = (event: Record<string, unknown>) => void;

export interface SocialOptions {
  mode: "mock" | "live" | "replay";
  dataDir: string; // 放 corpus.json 和 cache/
  apiBase?: string;
  apiToken?: string;
  mockLatencyMs?: number;
}

const PLATFORM_CN: Record<string, string> = { xiaohongshu: "小红书", weibo: "微博", douyin: "抖音" };
const SENT_CN: Record<string, string> = { positive: "正面", neutral: "中性", negative: "负面" };
const AUTHOR_CN: Record<string, string> = { normal: "普通用户", kol: "KOL", official: "官方", marketing: "营销号", media: "媒体" };

export function createProvider(opts: SocialOptions): CachedProvider {
  const cacheDir = path.join(opts.dataDir, "cache", opts.mode === "mock" ? "mock" : "live");
  if (opts.mode === "replay") return new CachedProvider(cacheDir, null, "replay");
  const inner =
    opts.mode === "live"
      ? new LiveProvider(opts.apiBase ?? "", opts.apiToken ?? "")
      : new MockProvider(path.join(opts.dataDir, "corpus.json"), opts.mockLatencyMs ?? 0);
  return new CachedProvider(cacheDir, inner, opts.mode);
}

function fmtNum(n: number): string {
  return n >= 10000 ? (n / 10000).toFixed(1) + "w" : String(n);
}

function oneLine(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

function authorTag(p: Post): string {
  const a = p.author;
  return `${AUTHOR_CN[a.type] ?? a.type}${a.verified ? "·认证" : ""}·粉丝${fmtNum(a.followers)}`;
}

export function formatSearch(q: SearchQuery, r: SearchResult): string {
  const lines = [`共 ${r.total} 条，返回 ${r.items.length} 条（offset ${q.offset ?? 0}，按${q.sort === "latest" ? "时间" : "热度"}）`];
  for (const p of r.items) {
    lines.push(
      `- [${p.id}] ${PLATFORM_CN[p.platform] ?? p.platform} ${p.created_at.slice(5, 16).replace("T", " ")} ` +
        `${authorTag(p)} 赞${fmtNum(p.likes)} 评${fmtNum(p.comments_count)} 转${fmtNum(p.shares)}` +
        `${p.sentiment ? " " + SENT_CN[p.sentiment] : ""}\n  ${oneLine(p.text, 90)}`,
    );
  }
  if (r.total > (q.offset ?? 0) + r.items.length) lines.push(`（还有更多，可用 offset 翻页）`);
  return lines.join("\n");
}

export function formatPost(p: Post): string {
  const lines = [
    `[${p.id}] ${PLATFORM_CN[p.platform] ?? p.platform} ${p.created_at.replace("T", " ").slice(0, 16)}`,
    `作者：${p.author.name}（${authorTag(p)}）`,
    `互动：赞 ${p.likes} / 评论 ${p.comments_count} / 转发 ${p.shares}${p.sentiment ? ` / 情绪 ${SENT_CN[p.sentiment]}` : ""}`,
    `话题：${p.topics.map((t) => "#" + t).join(" ") || "无"}`,
    "",
    p.text,
  ];
  if (p.comments?.length) {
    lines.push("", "热评：");
    for (const c of p.comments.slice(0, 5)) lines.push(`- ${c.author}（赞${c.likes}）：${oneLine(c.text, 120)}`);
  }
  return lines.join("\n");
}

export function formatTrend(q: TrendQuery, rows: TrendPoint[]): string {
  if (!rows.length) return "该条件下没有数据";
  const total = rows.reduce((s, r) => s + r.count, 0);
  const lines = [`日期 | 帖子数 | 正/中/负 | 互动量（共 ${total} 条）`];
  for (const r of rows) lines.push(`${r.date} | ${r.count} | ${r.positive}/${r.neutral}/${r.negative} | ${fmtNum(r.engagement)}`);
  return lines.join("\n");
}

const PlatformList = Type.Optional(
  Type.Array(Type.String(), { description: "平台过滤：xiaohongshu / weibo / douyin，不传表示全部" }),
);
const DateStr = (d: string) => Type.Optional(Type.String({ description: d + "，格式 YYYY-MM-DD" }));

export function createSocialExtension(emit: Emit, opts: SocialOptions) {
  return function social(pi: ExtensionAPI) {
    const provider = createProvider(opts);

    async function run<T>(tool: string, op: "search" | "getPost" | "trend", params: any) {
      const r = await provider.run<T>(op, params);
      emit({ type: "social_call", tool, params, cached: r.cached, mode: provider.mode, ms: r.ms });
      return r;
    }

    pi.registerTool({
      name: "social_search",
      label: "舆情搜索",
      description:
        "按关键词 / 话题 / 平台 / 时间范围搜索社交媒体帖子，返回摘要列表（帖子 ID、平台、时间、作者类型、互动数、情绪、正文前 90 字）。" +
        "关键词里空格表示同时包含，| 表示任一。需要全文和评论时再用 get_post。",
      parameters: Type.Object({
        keyword: Type.Optional(Type.String({ description: "关键词，如「栖木 桂花」「异物|塑料」" })),
        topic: Type.Optional(Type.String({ description: "话题标签（不带 #）" })),
        platforms: PlatformList,
        start: DateStr("开始日期"),
        end: DateStr("结束日期（含）"),
        sort: Type.Optional(Type.Union([Type.Literal("hot"), Type.Literal("latest")], { description: "hot=按热度（默认），latest=按时间" })),
        limit: Type.Optional(Type.Number({ description: "返回条数，默认 10，最多 20" })),
        offset: Type.Optional(Type.Number({ description: "翻页偏移" })),
      }),
      async execute(_id: string, params: SearchQuery) {
        const r = await run<SearchResult>("social_search", "search", params);
        return {
          content: [{ type: "text", text: formatSearch(params, r.value) }],
          details: { cached: r.cached, mode: provider.mode, ms: r.ms, total: r.value.total, ids: r.value.items.map((p) => p.id) },
        };
      },
    } as any);

    pi.registerTool({
      name: "get_post",
      label: "读取帖子",
      description: "按帖子 ID 读取全文、作者信息、互动数和热门评论。",
      parameters: Type.Object({ id: Type.String({ description: "帖子 ID，来自 social_search 的结果" }) }),
      async execute(_id: string, params: { id: string }) {
        const r = await run<Post | null>("get_post", "getPost", params);
        if (!r.value) throw new Error(`没有找到帖子 ${params.id}`);
        return {
          content: [{ type: "text", text: formatPost(r.value) }],
          details: { cached: r.cached, mode: provider.mode, ms: r.ms, id: params.id },
        };
      },
    } as any);

    pi.registerTool({
      name: "social_trend",
      label: "声量趋势",
      description: "按天统计符合条件的帖子数、正/中/负情绪分布和互动量。用来看整体走势、发现突增的日子。",
      parameters: Type.Object({
        keyword: Type.Optional(Type.String({ description: "关键词，规则同 social_search" })),
        topic: Type.Optional(Type.String({ description: "话题标签（不带 #）" })),
        platforms: PlatformList,
        start: DateStr("开始日期"),
        end: DateStr("结束日期（含）"),
      }),
      async execute(_id: string, params: TrendQuery) {
        const r = await run<TrendPoint[]>("social_trend", "trend", params);
        return {
          content: [{ type: "text", text: formatTrend(params, r.value) }],
          details: { cached: r.cached, mode: provider.mode, ms: r.ms, days: r.value.length },
        };
      },
    } as any);
  };
}
