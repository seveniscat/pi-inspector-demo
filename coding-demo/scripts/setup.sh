#!/usr/bin/env bash
# 把 coding-demo 模板复制到一个独立目录，初始化 git 并打 demo-start 标签。
# 演示在复制出来的目录里进行，不会碰到 pi-inspector-demo 主仓库。
#
#   bash coding-demo/scripts/setup.sh            # 默认复制到 ~/pi-coding-demo
#   bash coding-demo/scripts/setup.sh /path/dir  # 自定义目录
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$HOME/pi-coding-demo}"
MARKER=".pi-coding-demo"

if [ -e "$DEST" ]; then
  if [ ! -f "$DEST/$MARKER" ]; then
    echo "❌ $DEST 已存在且不是本脚本创建的演示目录，换个路径或手动处理。"
    exit 1
  fi
  rm -rf "$DEST"
fi

mkdir -p "$DEST"
cp -R "$SRC/." "$DEST/"
rm -f "$DEST/scripts/setup.sh"
# 演示副本里去掉讲者材料：Round 1 会读 README，不能让模型提前看到提示词和 bug 线索
rm -f "$DEST/DEMO.md"
sed -i.bak -e '/<!-- demo-only:start -->/,/<!-- demo-only:end -->/d' -e '/^DEMO\.md /d' "$DEST/README.md"
rm -f "$DEST/README.md.bak"
touch "$DEST/$MARKER"

cd "$DEST"
git init -q -b main
git add -A
git -c user.name="${GIT_AUTHOR_NAME:-demo}" -c user.email="${GIT_AUTHOR_EMAIL:-demo@localhost}" commit -q -m "baseline"
git tag demo-start

echo "✅ 演示目录已就绪：$DEST"
npm test 2>&1 | grep -E "^# (pass|fail)" || true
echo "（应为 pass 5 / fail 2）下一步：cd $DEST && pi"
