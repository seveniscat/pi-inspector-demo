# sentiment-kit

Pi 编码演示用的小项目：舆情帖子统计 CLI，零依赖，Node ≥ 22.19 直接运行 TypeScript。

<!-- demo-only:start -->
演示在副本里做，不在本仓库操作，见下方「现场演示速查」。

<!-- demo-only:end -->

```bash
npm test                                  # 跑测试（初始状态有 2 个故意埋的 bug）
node src/cli.ts data/posts.csv summary    # 按平台汇总
node src/cli.ts data/posts.csv top 3      # 互动量 Top N
```

<!-- demo-only:start -->
## 现场演示速查

第 7 页 + 第 15 页，同一个 pi 会话。完整版见 DEMO.md。

### 准备

```bash
bash coding-demo/scripts/setup.sh         # 在仓库根目录执行
cd ~/pi-coding-demo && npm test           # 应为 pass 5 / fail 2
pi
```

进 pi 后：信任项目（`/trust`）；`/scoped-models` 勾两家模型。

### 第 7 页

Round 0

```
!!npm run -s top
```

Round 1

```
先别改任何代码。快速读一下这个项目，用 5 行以内告诉我：它是干什么的、入口在哪、测试怎么跑、有哪些项目约定。
```

Round 2

```
跑一下测试，把失败的修好。规则：只改 src/，不许改 test/。修完再跑一遍确认全绿，最后用两句话说清两个 bug 的根因。
```

它还在干活时输入并回车：

```
修完顺便跑一下 top 3 给我看
```

Round 4：先按 Ctrl+P 切模型

```
/review 重点看两个 bug 的修法，有没有漏掉的边界情况
```

做完不要退出 pi。

### 第 15 页

Round 6

```
给你自己写一个 Pi 扩展，路径 .pi/extensions/guard-tests.ts：监听 tool_call 事件，拦截所有对 test/ 目录的 write 和 edit，返回 block，reason 写"测试文件受保护，请修改实现代码"，同时用 ctx.ui.notify 弹一个 warning。API 不确定就先看你自己的文档和 extensions 示例。只写这一个文件，写完不要做别的。
```

```
!!cat .pi/extensions/guard-tests.ts
```

```
/reload
```

```
把 test/stats.test.ts 里 topPosts 那个用例的期望值改成 ["p05", "p13", "p17"]。
```

### 兜底与复原

| 情况 | 操作 |
|---|---|
| 启动头没有 skill / template | `/trust` 后重启 pi |
| 卡住或跑偏 | Esc，改一句重发 |
| 扩展写崩 | `!!cp demo-assets/guard-tests.ts .pi/extensions/`，再 `/reload` |
| 复原 | 退出 pi，`cd ~/pi-coding-demo && ./scripts/reset.sh` |
<!-- demo-only:end -->

## 命令

| 命令 | 说明 |
|---|---|
| `summary` | 按平台汇总发帖量与互动 |
| `top [n]` | 互动量最高的 n 条帖子（默认 3） |

## 目录

```
src/          types / csv / stats / format / cli
test/         node:test 用例
data/         演示数据（虚构品牌，21 条帖子）
.pi/skills/   项目 skill：add-command
.pi/prompts/  项目 prompt template：/review
demo-assets/  现场翻车时的兜底文件
scripts/      setup.sh 复制到独立目录并初始化；reset.sh 在副本里一键复原
DEMO.md       演示脚本与提示词
```
