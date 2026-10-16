/**
 * 兜底版本：Round 5 现场让 Pi 自己写，写崩了就
 *   cp demo-assets/guard-tests.ts .pi/extensions/ 然后 /reload
 *
 * 作用：拦截对 test/ 目录的 write / edit 工具调用。
 * 被拦截的调用会变成一条错误的 tool result，模型能看到 reason 并自行调整。
 */
import { relative, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "write" && event.toolName !== "edit") return undefined;

    const target = relative(ctx.cwd, resolve(ctx.cwd, String(event.input.path ?? "")));
    if (!target.startsWith("test/") && !target.startsWith("test\\")) return undefined;

    if (ctx.hasUI) ctx.ui.notify(`🛡️ 已拦截对 ${target} 的 ${event.toolName}`, "warning");
    return { block: true, reason: `测试文件受保护（${target}），请修改实现代码而不是测试` };
  });
}
