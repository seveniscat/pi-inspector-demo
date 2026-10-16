import { readFileSync } from "node:fs";
import { loadPosts } from "./csv.ts";
import { renderTable } from "./format.ts";
import { engagement, summarizeByPlatform, topPosts } from "./stats.ts";

const USAGE = `用法: node src/cli.ts <posts.csv> <命令> [参数]

命令:
  summary        按平台汇总发帖量与互动
  top [n]        互动量最高的 n 条帖子（默认 3）`;

const [file, command = "summary", ...args] = process.argv.slice(2);

if (!file) {
  console.error(USAGE);
  process.exit(1);
}

const posts = loadPosts(readFileSync(file, "utf8"));

switch (command) {
  case "summary": {
    const rows = summarizeByPlatform(posts).map((s) => [s.platform, s.posts, s.likes, s.comments, s.avgEngagement]);
    console.log(renderTable([["平台", "帖子数", "点赞", "评论", "平均互动"], ...rows]));
    break;
  }
  case "top": {
    const n = Number(args[0] ?? 3);
    const rows = topPosts(posts, n).map((p) => [p.id, p.platform, p.author, engagement(p), p.content]);
    console.log(renderTable([["ID", "平台", "作者", "互动", "内容"], ...rows]));
    break;
  }
  default:
    console.error(`未知命令: ${command}\n\n${USAGE}`);
    process.exit(1);
}
