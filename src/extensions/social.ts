/**
 * Social extension —— 把舆情数据服务包成 5 个 Pi 工具。
 *
 * 这一段是"Pi 怎么接我们自己的系统"的答案：内核只有 read / write / edit / bash，
 * 业务能力通过 extension 的 registerTool 加进来，模型看到的就是普通工具。
 *
 * 设计要点：
 * - 每个工具对应数据服务的一个接口（本地数据集 / 远程接口 / 回放，三选一）
 * - 只返回精简文本，原始 JSON 不进上下文；评论作者不输出（脱敏），帖子作者保留（用来识别官方 / KOL）
 * - 每次调用都过缓存（social/cache.ts）：恢复后重复查询直接命中，不重复打外部服务
 * - details 里带 cached / mode / ms，Inspector 据此显示"缓存命中"
 */
import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { CachedProvider, type Op } from "../social/cache.ts";
import { extractCitations } from "./citations.ts";
export { extractCitations };
import { LiveProvider } from "../social/live.ts";
import { LocalProvider } from "../social/local.ts";
import {
  SENTIMENT_CN,
  type Comment,
  type CommentQuery,
  type DatasetInfo,
  type Page,
  type Post,
  type PostDetail,
  type PostQuery,
  type TrendQuery,
  type TrendRow,
} from "../social/types.ts";

export type Emit = (event: Record<string, unknown>) => void;

/** 定点崩溃开关：armed 时，下一次查询在"结果已写入缓存、还没返回给模型"的时刻 SIGKILL 自己 */
export interface CrashSwitch {
  armed: boolean;
}

export interface CitationCheck {
  path: string;
  total: number;
  valid: string[];
  invalid: string[];
  at: string;
}

export interface SocialOptions {
  mode: "local" | "live" | "replay";
  dataDir: string; // data/
  dataset?: string; // local 模式下的数据集目录名：demo / real
  apiBase?: string;
  apiToken?: string;
  latencyMs?: number;
  crash?: CrashSwitch;
  /** 引用核验结果回调（server 用来给报告面板） */
  onCitationCheck?: (c: CitationCheck) => void;
}


/** 本地数据集的 ID 索引，用于引用核验；live / replay 模式没有全量数据，不核验 */
function loadIdIndex(opts: SocialOptions): { posts: Set<string>; comments: Set<string> } | null {
  if (opts.mode !== "local") return null;
  const dir = path.join(opts.dataDir, opts.dataset || "demo");
  try {
    const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { id: string }[];
    return { posts: new Set(read("posts.json").map((p) => p.id)), comments: new Set(read("comments.json").map((c) => c.id)) };
  } catch {
    return null;
  }
}

export function createProvider(opts: SocialOptions): CachedProvider {
  const dataset = opts.dataset || "demo";
  if (opts.mode === "replay") return new CachedProvider(path.join(opts.dataDir, "cache", "live"), null, "replay");
  if (opts.mode === "live") {
    return new CachedProvider(path.join(opts.dataDir, "cache", "live"), new LiveProvider(opts.apiBase ?? "", opts.apiToken ?? ""), "live");
  }
  return new CachedProvider(
    path.join(opts.dataDir, "cache", `local-${dataset}`),
    new LocalProvider(path.join(opts.dataDir, dataset), opts.latencyMs ?? 0),
    `local:${dataset}`,
  );
}

// ── 输出格式 ──
const oneLine = (s: string, n: number) => {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
};
// 源数据只有日期时不显示时分
const when = (iso: string) => (iso || "").slice(5, iso?.includes("T") ? 16 : 10).replace("T", " ");
const kv = (m: Record<string, number>) => Object.entries(m).map(([k, v]) => `${k}(${v})`).join("、") || "无";
const shortUrl = (u?: string) => (u ? u.split("?")[0] : "");
const sent = (s?: string) => (s ? SENTIMENT_CN[s as keyof typeof SENTIMENT_CN] : "未标注");
const pct = (a: number, total: number) => (total ? Math.round((a / total) * 100) + "%" : "-");

export function formatInfo(i: DatasetInfo): string {
  return [
    `数据集：${i.name}`,
    `帖子 ${i.posts} 条，评论 ${i.comments} 条`,
    `平台：${i.platforms.join("、")}`,
    `帖子发布时间：${i.start} ~ ${i.end}；评论发布时间：${i.comment_start} ~ ${i.comment_end}`,
    `监测词 / 来自搜索（帖子数）：${kv(i.source_queries)}`,
    `相关性取值（帖子数）：${kv(i.relevance)}`,
  ].join("\n");
}

function postLine(p: Post): string {
  const cs = p.comment_sentiment;
  const total = cs.positive + cs.neutral + cs.negative;
  return (
    `- [${p.id}] ${p.platform} ${when(p.published_at)} 作者:${oneLine(p.author, 16)} 评论${p.comment_count}` +
    ` 帖子情绪:${sent(p.sentiment)} 评论情绪 积${cs.positive}/中${cs.neutral}/消${cs.negative}（消极${pct(cs.negative, total)}）` +
    `${p.relevance !== undefined && p.relevance !== null ? ` 相关性:${p.relevance}` : ""}` +
    `${p.source_query ? ` 来自搜索:${p.source_query}` : ""}\n  ${oneLine(p.title, 80)}`
  );
}

function commentLine(c: Comment, withPost = true): string {
  return (
    `- [${c.id}] ${withPost ? `帖子${c.post_id} ` : ""}${c.platform} ${when(c.published_at)} 赞${c.likes}` +
    `${c.reply_count ? ` 回复${c.reply_count}` : ""} ${sent(c.sentiment)}${c.is_reply ? " (楼中楼)" : ""}\n  ${oneLine(c.content, 120)}`
  );
}

export function formatPosts(q: PostQuery, r: Page<Post>): string {
  const sortCn = { comments: "评论数", negative: "消极评论数", latest: "时间" }[q.sort ?? "comments"];
  const lines = [`共 ${r.total} 条帖子，返回 ${r.items.length} 条（offset ${q.offset ?? 0}，按${sortCn}排序）`, ...r.items.map(postLine)];
  if (r.total > (q.offset ?? 0) + r.items.length) lines.push("（还有更多，可用 offset 翻页）");
  return lines.join("\n");
}

export function formatPost(d: PostDetail): string {
  const p = d.post;
  const cs = p.comment_sentiment;
  return [
    `[${p.id}] ${p.platform} ${p.published_at.replace("T", " ").slice(0, 16).replace(/ 00:00$/, "")}`,
    `标题：${p.title}`,
    `作者：${p.author}${p.url ? `　链接：${shortUrl(p.url)}` : ""}`,
    `评论数 ${p.comment_count}；帖子情绪 ${sent(p.sentiment)}；评论情绪 积极 ${cs.positive} / 中性 ${cs.neutral} / 消极 ${cs.negative}`,
    `相关性：${p.relevance ?? "-"}；来自搜索：${p.source_query || "-"}`,
    "",
    `高赞评论（${d.top_comments.length} 条，按点赞排序，作者已脱敏）：`,
    ...d.top_comments.map((c) => commentLine(c, false)),
  ].join("\n");
}

export function formatComments(q: CommentQuery, r: Page<Comment>): string {
  const lines = [
    `共 ${r.total} 条评论，返回 ${r.items.length} 条（按${q.sort === "latest" ? "时间" : "点赞"}排序，作者已脱敏）`,
    ...r.items.map((c) => commentLine(c, !q.post_id)),
  ];
  if (r.total > (q.offset ?? 0) + r.items.length) lines.push("（还有更多，可用 offset 翻页）");
  return lines.join("\n");
}

export function formatTrend(q: TrendQuery, rows: TrendRow[]): string {
  if (!rows.length) return "该条件下没有数据";
  const head = { platform: "平台", query: "监测词", day: "日期" }[q.group_by ?? "day"];
  const sum = rows.reduce((s, r) => ({ p: s.p + r.posts, c: s.c + r.comments }), { p: 0, c: 0 });
  const lines = [`${head} | 新帖 | 新评论 | 评论情绪 积/中/消 | 消极占比（合计帖子 ${sum.p}，评论 ${sum.c}）`];
  for (const r of rows) {
    lines.push(`${r.key} | ${r.posts} | ${r.comments} | ${r.positive}/${r.neutral}/${r.negative} | ${pct(r.negative, r.positive + r.neutral + r.negative)}`);
  }
  return lines.join("\n");
}

// ── 参数 schema ──
const Platforms = Type.Optional(Type.Array(Type.String(), { description: "平台过滤，取值见 dataset_info，如 抖音 / 小红书 / 微博；不传表示全部" }));
const DateStr = (d: string) => Type.Optional(Type.String({ description: d + "，格式 YYYY-MM-DD" }));
const QueryP = Type.Optional(Type.String({ description: "监测词，即「来自搜索」字段的取值（见 dataset_info），精确匹配" }));
const RelevanceP = Type.Optional(Type.String({ description: "相关性标签，取值见 dataset_info，如「相关」" }));
const SentimentP = Type.Optional(
  Type.Union([Type.Literal("positive"), Type.Literal("neutral"), Type.Literal("negative")], { description: "情绪过滤" }),
);

export function createSocialExtension(emit: Emit, opts: SocialOptions) {
  return function social(pi: ExtensionAPI) {
    const provider = createProvider(opts);

    async function run<T>(tool: string, op: Op, params: any) {
      const r = await provider.run<T>(op, params);
      emit({ type: "social_call", tool, params, cached: r.cached, mode: provider.mode, ms: r.ms });
      if (opts.crash?.armed && op !== "info") {
        // 演示用：数据已经查到并落进缓存，但结果还没交给模型 —— 这一刻进程被杀
        opts.crash.armed = false;
        emit({ type: "crash_fired", tool, params, cachedBefore: r.cached });
        await new Promise((res) => setTimeout(res, 400)); // 给 SSE 一点时间把事件推出去
        process.kill(process.pid, "SIGKILL");
        await new Promise(() => {}); // 等死，不返回
      }
      return r;
    }

    // ── 引用核验：写 / 改报告后，检查里面的 ID 是否真实存在，并把结果回馈给模型 ──
    let idIndex: ReturnType<typeof loadIdIndex> | undefined;
    pi.on("tool_result", (event: any, ctx: any) => {
      if (event.toolName !== "write" && event.toolName !== "edit") return undefined;
      const rel = String(event.input?.path ?? event.input?.file_path ?? "");
      if (!/(^|\/)report\/[^/]+\.md$/.test(rel) || event.isError) return undefined;
      if (idIndex === undefined) idIndex = loadIdIndex(opts);
      if (!idIndex) return undefined;
      let md = "";
      try {
        md = fs.readFileSync(path.resolve(ctx?.cwd ?? process.cwd(), rel), "utf8");
      } catch {
        return undefined;
      }
      const ids = extractCitations(md);
      const valid = ids.filter((id) => idIndex!.posts.has(id) || idIndex!.comments.has(id));
      const invalid = ids.filter((id) => !valid.includes(id));
      const check: CitationCheck = { path: rel, total: ids.length, valid, invalid, at: new Date().toISOString() };
      emit({ type: "citation_check", ...check });
      opts.onCitationCheck?.(check);
      const note = invalid.length
        ? `[引用核验] 报告中共 ${ids.length} 个 ID，${valid.length} 个在数据中存在；以下 ${invalid.length} 个不存在，请核对后修正或删除：${invalid.join("、")}`
        : `[引用核验] 报告中共 ${ids.length} 个 ID，全部在数据中存在。`;
      return { content: [...(event.content ?? []), { type: "text", text: note }] };
    });
    const meta = (r: { cached: boolean; ms: number }, extra: object = {}) => ({ cached: r.cached, mode: provider.mode, ms: r.ms, ...extra });

    pi.registerTool({
      name: "dataset_info",
      label: "数据概况",
      description:
        "查看舆情数据集概况：帖子 / 评论总量、平台、时间范围、监测词（来自搜索）及帖子数、相关性取值。" +
        "研究开始时先调用一次：数据是按监测词抓取的，监测词决定了研究对象和话题划分。",
      parameters: Type.Object({}),
      async execute() {
        const r = await run<DatasetInfo>("dataset_info", "info", {});
        return { content: [{ type: "text", text: formatInfo(r.value) }], details: meta(r) };
      },
    } as any);

    pi.registerTool({
      name: "social_search",
      label: "搜索帖子",
      description:
        "按关键词 / 平台 / 时间 / 情绪搜索帖子，返回摘要列表（ID、平台、时间、作者、评论数、评论情绪分布、相关性、来自搜索、标题）。" +
        "关键词匹配标题和来自搜索字段，空格表示同时包含，| 表示任一。需要看评论时用 get_post 或 search_comments。",
      parameters: Type.Object({
        keyword: Type.Optional(Type.String({ description: "关键词，如「英雄令」「英雄令 退款|充值」" })),
        platforms: Platforms,
        start: DateStr("开始日期"),
        end: DateStr("结束日期（含）"),
        query: QueryP,
        sentiment: SentimentP,
        relevance: RelevanceP,
        sort: Type.Optional(
          Type.Union([Type.Literal("comments"), Type.Literal("negative"), Type.Literal("latest")], {
            description: "comments=评论数最多（默认），negative=消极评论最多，latest=最新",
          }),
        ),
        limit: Type.Optional(Type.Number({ description: "返回条数，默认 10，最多 20" })),
        offset: Type.Optional(Type.Number({ description: "翻页偏移" })),
      }),
      async execute(_id: string, params: PostQuery) {
        const r = await run<Page<Post>>("social_search", "searchPosts", params);
        return {
          content: [{ type: "text", text: formatPosts(params, r.value) }],
          details: meta(r, { total: r.value.total, ids: r.value.items.map((p) => p.id) }),
        };
      },
    } as any);

    pi.registerTool({
      name: "get_post",
      label: "读取帖子",
      description: "按帖子 ID 读取帖子详情和高赞评论（按点赞排序）。",
      parameters: Type.Object({
        id: Type.String({ description: "帖子 ID，来自 social_search 的结果" }),
        top_comments: Type.Optional(Type.Number({ description: "返回多少条高赞评论，默认 10，最多 20" })),
      }),
      async execute(_id: string, params: { id: string; top_comments?: number }) {
        const r = await run<PostDetail | null>("get_post", "getPost", params);
        if (!r.value) throw new Error(`没有找到帖子 ${params.id}`);
        return { content: [{ type: "text", text: formatPost(r.value) }], details: meta(r, { id: params.id }) };
      },
    } as any);

    pi.registerTool({
      name: "search_comments",
      label: "搜索评论",
      description:
        "在评论里按关键词 / 情绪 / 平台 / 时间 / 所属帖子搜索，返回评论列表（作者已脱敏）。" +
        "用来找具体观点和证据，比如「消极评论里提到最多的问题」「某个帖子下关于退款的讨论」。",
      parameters: Type.Object({
        keyword: Type.Optional(Type.String({ description: "匹配评论内容，规则同 social_search" })),
        post_id: Type.Optional(Type.String({ description: "只看某个帖子下的评论" })),
        query: QueryP,
        relevance: RelevanceP,
        platforms: Platforms,
        start: DateStr("开始日期"),
        end: DateStr("结束日期（含）"),
        sentiment: SentimentP,
        sort: Type.Optional(Type.Union([Type.Literal("likes"), Type.Literal("latest")], { description: "likes=点赞最多（默认），latest=最新" })),
        limit: Type.Optional(Type.Number({ description: "返回条数，默认 15，最多 30" })),
        offset: Type.Optional(Type.Number({ description: "翻页偏移" })),
      }),
      async execute(_id: string, params: CommentQuery) {
        const r = await run<Page<Comment>>("search_comments", "searchComments", params);
        return {
          content: [{ type: "text", text: formatComments(params, r.value) }],
          details: meta(r, { total: r.value.total }),
        };
      },
    } as any);

    pi.registerTool({
      name: "social_trend",
      label: "声量趋势",
      description:
        "统计新帖数、新评论数和评论情绪分布，可按天（默认）、按平台、按监测词（来自搜索）分组。" +
        "用来看走势、找评论突增或消极占比升高的日子、比较各监测话题的声量和情绪。",
      parameters: Type.Object({
        keyword: Type.Optional(Type.String({ description: "按帖子标题 / 来自搜索过滤，规则同 social_search" })),
        query: QueryP,
        relevance: RelevanceP,
        platforms: Platforms,
        start: DateStr("开始日期"),
        end: DateStr("结束日期（含）"),
        group_by: Type.Optional(
          Type.Union([Type.Literal("day"), Type.Literal("platform"), Type.Literal("query")], {
            description: "day=按天（默认），platform=按平台，query=按监测词",
          }),
        ),
      }),
      async execute(_id: string, params: TrendQuery) {
        const r = await run<TrendRow[]>("social_trend", "trend", params);
        return { content: [{ type: "text", text: formatTrend(params, r.value) }], details: meta(r, { rows: r.value.length }) };
      },
    } as any);
  };
}
