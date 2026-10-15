// 模拟崩溃：SIGKILL，进程没有任何机会做清理
import fs from "node:fs";

const pidFile = new URL("../.demo.pid", import.meta.url);
if (!fs.existsSync(pidFile)) {
  console.log("没有找到 .demo.pid，demo 可能没在运行");
  process.exit(0);
}
const pid = Number(fs.readFileSync(pidFile, "utf8"));
try {
  process.kill(pid, "SIGKILL");
  console.log(`已发送 SIGKILL → pid ${pid}`);
} catch (e) {
  console.log(`pid ${pid} 不存在：${e.message}`);
}
