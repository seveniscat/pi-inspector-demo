# sentiment-kit

Pi 编码演示用的小项目：舆情帖子统计 CLI，零依赖，Node ≥ 22.19 直接运行 TypeScript。

<!-- demo-only:start -->
演示时不要在仓库里直接操作，先 `bash coding-demo/scripts/setup.sh` 复制到 `~/pi-coding-demo`，详见下方「现场演示速查」和 DEMO.md。

<!-- demo-only:end -->

```bash
npm test                                  # 跑测试（初始状态有 2 个故意埋的 bug）
node src/cli.ts data/posts.csv summary    # 按平台汇总
node src/cli.ts data/posts.csv top 3      # 互动量 Top N
```

<!-- demo-only:start -->
## 现场演示速查（分享用精简版，约 10 分钟）

和讲稿对应：第 7 页跑 Round 0、1、2、4，第 15 页跑 Round 6，**两段用同一个 pi 会话**。完整版（含 Round 3 skill、Round 5 `/tree`、Round 7 `pi -p`）见 DEMO.md。

### 0. 准备（上台前）

```bash
node -v                                   # ≥ 22.19
pi -v                                     # 1.1.0
bash coding-demo/scripts/setup.sh         # 在仓库根目录执行，复制到 ~/pi-coding-demo 并打 demo-start 标签
cd ~/pi-coding-demo && npm test           # 应为 pass 5 / fail 2
pi
```

进 pi 后：

- 出现 trust 提示选信任（或执行 `/trust`），否则 skill、`/review`、扩展都不加载
- `/scoped-models` 勾两家厂商的模型，现场用 Ctrl+P 切换
- 启动头应显示：AGENTS.md、1 个 skill、1 个 prompt template

### 1. 第 7 页 · 上手（约 7 分钟）

**Round 0 看 bug**：`!!` 只在终端跑，输出不发给模型。第一名是 816 互动，排序明显反了。

```
!!npm run -s top
```

**Round 1 读懂项目**：看 `ls` / `read` 调用，回答会复述 AGENTS.md 的约定。之后 Ctrl+O 展开一次工具输出再收起。

```
先别改任何代码。快速读一下这个项目，用 5 行以内告诉我：它是干什么的、入口在哪、测试怎么跑、有哪些项目约定。
```

**Round 2 测试驱动修 bug**：看 `bash → read → edit → bash` 循环。

```
跑一下测试，把失败的修好。规则：只改 src/，不许改 test/。修完再跑一遍确认全绿，最后用两句话说清两个 bug 的根因。
```

它还在干活时，直接输入并回车（steering；Alt+Enter 是 follow-up）：

```
修完顺便跑一下 top 3 给我看
```

**Round 4 换模型 review**：先按 Ctrl+P，指一下 footer 里模型名变了。

```
/review 重点看两个 bug 的修法，有没有漏掉的边界情况
```

做完**不要退出 pi**，第 15 页回到这个会话。

### 2. 第 15 页 · 让 Pi 给自己写扩展（约 3 分钟）

```
给你自己写一个 Pi 扩展，路径 .pi/extensions/guard-tests.ts：监听 tool_call 事件，拦截所有对 test/ 目录的 write 和 edit，返回 block，reason 写"测试文件受保护，请修改实现代码"，同时用 ctx.ui.notify 弹一个 warning。API 不确定就先看你自己的文档和 extensions 示例。只写这一个文件，写完不要做别的。
```

亮代码，重点停在 `pi.on("tool_call", …)` 和 `return { block: true, reason }`：

```
!!cat .pi/extensions/guard-tests.ts
```

热加载：

```
/reload
```

故意让它改测试，应弹出黄色警告，这次 edit 变成错误结果：

```
把 test/stats.test.ts 里 topPosts 那个用例的期望值改成 ["p05", "p13", "p17"]。
```

### 3. 翻车与复原

| 情况 | 处理 |
|---|---|
| 启动头没有 skill / template | `/trust` 后重启 pi |
| Round 2 改了 test/ | 顺势说"所以第 15 页要写扩展" |
| 模型卡住或跑偏 | Esc 中断，改一句重发 |
| 扩展写崩或 API 用错 | `!!cp demo-assets/guard-tests.ts .pi/extensions/`，再 `/reload` |
| 整体乱了 / 彩排完复原 | 退出 pi，`cd ~/pi-coding-demo && ./scripts/reset.sh`，重开 pi |
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
