// 清空演示产物，回到干净状态。
//   npm run reset          清 research/ report/ logs/ 和 mock 缓存
//   npm run reset -- --all 连 live 录制的缓存一起清（之后 replay 模式就没数据了）
import fs from "node:fs";

const root = new URL("..", import.meta.url);
const targets = ["workspace/research", "workspace/report", "logs", ".demo.pid", "data/cache/mock"];
if (process.argv.includes("--all")) targets.push("data/cache/live");
for (const p of targets) {
  fs.rmSync(new URL(p, root), { recursive: true, force: true });
  console.log(`已清理 ${p}`);
}
console.log("\n下次请用 npm run start:new 开新会话。");
console.log("旧的会话文件在 ~/.pi/agent/sessions/ 下与 workspace 路径对应的目录里，可按需手动删除。");
