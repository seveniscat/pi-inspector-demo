#!/usr/bin/env bash
# 在演示目录（setup.sh 复制出来的那个）里一键回到起点：
# 代码回滚到 demo-start 标签，删除演示中生成的文件（含 .pi/extensions/）和 try-html 分支
set -euo pipefail
cd "$(dirname "$0")/.."

# 安全检查：只在 setup.sh 创建的独立演示仓库里执行，绝不动别的仓库
if [ ! -f .pi-coding-demo ] || [ "$(git rev-parse --show-toplevel 2>/dev/null)" != "$(pwd)" ]; then
  echo "❌ 这里不是演示目录。先运行 coding-demo/scripts/setup.sh，再到复制出来的目录里执行本脚本。"
  exit 1
fi

git switch -q -f main
git reset -q --hard demo-start
git clean -fdq
git branch -D try-html >/dev/null 2>&1 || true
echo "✅ 已回到演示起点。npm test 应该是 5 pass / 2 fail。"
