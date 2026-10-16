# Pi 编码演示脚本（主线约 16 分钟，含可选环节约 17 分钟）

项目：`sentiment-kit`——舆情帖子统计 CLI，和舆情 bot 用同一主题，观众不用切换上下文。
零依赖，Node ≥ 22.19 原生跑 TS（Pi 本身也要求 22.19+，所以装了 Pi 的机器一定能跑）。

## 主线一览

| Round | 演示内容 | Pi 能力 | 时长 |
|---|---|---|---|
| 0 | 开场看 bug | 启动头信息、`!!` 隐藏命令 | 0.5′ |
| 1 | 让它读懂项目 | 极简工具集、AGENTS.md | 1.5′ |
| 2 | 测试驱动修 bug | **agent loop**、steering 消息 | 3′ |
| 3 | 加 `trend` 子命令 | **skill 渐进式加载** | 3′ |
| 4 | 换模型做 review | **多模型切换**、prompt template | 2′ |
| 5 | 方案走进死胡同，回到决策点重来 | **`/tree` + 分支摘要 + git** | 4′ |
| 6 | Pi 给自己写扩展 | **事件系统 / extension** | 3′ |
| 7（可选） | 进流水线 | `pi -p` 无头模式 | 0.5′ |

---

## 演示前准备

演示**不在仓库目录里做**：先把模板复制到独立目录（默认 `~/pi-coding-demo`），在那里 `git init`、打 `demo-start` 标签。现场的 git 操作和复原都只影响这个副本。

```bash
bash coding-demo/scripts/setup.sh    # 复制 + git init + 打标签，最后打印 pass 5 / fail 2
cd ~/pi-coding-demo
pi -v                                # 确认版本，讲前再看一眼 /changelog
```

- **先进一次 pi 处理项目信任**：有 `.pi/` 目录会弹 trust 提示，选信任（或进去后 `/trust`）。不信任的话 skill、prompt template、扩展都不会加载
- **准备两个不同厂商的模型**：`/scoped-models` 里勾选两个，现场 Ctrl+P 循环切换；主模型选你最稳的那个
- 终端字号调大，用 regular 模式（滚动更自然）
- 完整彩排一遍，然后在 `~/pi-coding-demo` 里执行 `./scripts/reset.sh` 复原（或重新跑一次 setup.sh），`/new` 或重开 pi 开新会话

---

## Round 0　开场看 bug（30 秒）

启动 `pi`，先指着启动头：**加载了 AGENTS.md、1 个 skill、1 个 prompt template**。

在 Pi 里输入：

```
!!npm run -s top
```

> 讲点：`!!` 跑 shell 但**不把输出发给模型**（单个 `!` 会发）。观众会看到"互动最高的帖子"是一个学生党的 816 互动——明显不对，引出下一步。

---

## Round 1　让它读懂项目（1.5 分钟）

```
先别改任何代码。快速读一下这个项目，用 5 行以内告诉我：它是干什么的、入口在哪、测试怎么跑、有哪些项目约定。
```

**看点**：`ls` / `read` 工具调用逐条出现；回答里会复述"零依赖、import 带 .ts、不改 test/"——这些来自 AGENTS.md。

> 讲点：Pi 的默认系统提示很短，内置工具只有 read / bash / edit / write / grep / find / ls。项目知识靠 AGENTS.md 注入（从当前目录向上逐级叠加，还有全局 `~/.pi/agent/AGENTS.md`），而不是堆 prompt。

---

## Round 2　测试驱动修 bug（3 分钟）

```
跑一下测试，把失败的修好。规则：只改 src/，不许改 test/。修完再跑一遍确认全绿，最后用两句话说清两个 bug 的根因。
```

**看点**：`bash(npm test)` → `read` → `edit`（带 diff）→ `bash(npm test)` 的循环；两个 bug 分别是排序方向反了、CSV 的 `""` 转义没处理。

**加分动作（steering）**：它还在干活时直接输入并回车：

```
修完顺便跑一下 top 3 给我看
```

> 讲点：这就是 agent loop——只要模型还在发 tool call，就执行、把结果追加回上下文、再调模型，直到它不再调用工具。回车发的是 steering 消息，在当前这轮工具执行完后插进去，不用打断重来；Alt+Enter 是等全部做完再发的 follow-up。

---

## Round 3　加 `trend` 子命令（3 分钟）

**故意不提 skill**，看它自己会不会用：

```
给 CLI 加一个 trend 子命令：按天统计每个平台的发帖数，行是日期，列是平台，最后一列是当天合计。
```

**看点**：它先 `read .pi/skills/add-command/SKILL.md`，然后按清单走：`stats.ts` 纯函数 → 新测试文件 → `cli.ts` → README → 跑测试 → 贴命令输出。

> 讲点：启动时只把 skill 的 name + description 放进系统提示，正文等任务匹配了才用 `read` 读进来——装 50 个 skill 也几乎不占上下文。skill 是"按需加载的操作手册"，AGENTS.md 是"永远在场的项目规矩"。

**兜底**：如果它没去读 skill，直接显式调用（后面的文字会作为 `User:` 附在 skill 正文后）：

```
/skill:add-command 加一个 trend 子命令：按天统计每个平台的发帖数，行是日期，列是平台，最后一列是当天合计
```

---

## Round 4　换个模型做 review（2 分钟）

按 **Ctrl+P** 切到另一家的模型（指一下 footer 里模型名变了），然后：

```
/review 重点看 trend 的日期分组和排序
```

**看点**：`/review` 是 `.pi/prompts/review.md`，展开成完整 review 指令，参数填进 `${@:-无}`；新模型直接接着同一段上下文干活。

> 讲点：同一个会话中途换厂商，上下文照样延续——底层 pi-ai 把各家消息格式统一了，换模型时做格式转换。实际用法就是"写代码用 A，review 用 B"，避免同一个模型给自己打分。prompt template 就是带参数的 Markdown，团队常用指令放进仓库一起版本管理。

---

## Round 5　方案走进死胡同：回到决策点重来（4 分钟）

**场景**：让 Pi 按方案 A 做完了，才发现方向错了。这是真实开发里最常见的返工。

- 不用 `/tree` 的话，你只能说"不要 A 了，改成 B"：A 的几千 token 代码和工具输出会一直留在上下文里，之后每次请求都要重发；模型还倾向于在 A 上打补丁，而不是重新思考。
- 用 `/tree`：回到下需求的那个点，把 A 压成一句教训带回来，A 的过程扔出上下文，但对话分支和代码都保留，随时能翻回去看。

**① 先给主线代码打个存档**（Round 3 的 trend 必须先提交，否则切分支时会跟着带走）

```
!!git add -A && git commit -qm "feat: trend"
```

**② 开一个代码分支做方案 A**（对话分支和代码分支一一对应）

```
!!git switch -c try-html
```

**③ 方案 A：做成 HTML 图表**

```
把 trend 的结果做成一个 report.html：用原生 SVG 画按天的折线图，每个平台一条线，零依赖，浏览器直接打开就能看。
```

**看点**：它会写一个很大的 HTML 文件。**指一下 footer 的上下文用量，记下这个数。**（时间够的话，可以用浏览器打开 report.html 给观众看 5 秒。）

**④ 口播转折**："做完我才想起来，trend 是给舆情 bot 调用的，bot 要的是机器可读的 JSON，HTML 这条路是死的。"

**⑤ 把方案 A 的代码存进分支，切回主线**

```
!!git add -A && git commit -qm "wip: html report" && git switch -q -
```

**⑥ 回到决策点**

```
/tree
```

- 按 Ctrl+O 切到 `user-only` 过滤，只看用户消息
- 选中**方案 A 那条需求消息**，Enter
- 摘要选项选 **自定义摘要（custom）**，输入：

```
只保留结论：HTML 报表方案已被否决，原因是 trend 的下游是舆情 bot 程序调用，需要机器可读的 JSON；方案 A 的代码保存在 git 分支 try-html。
```

**⑦ 方案 B**：编辑器里会出现方案 A 的原文，清空后粘贴：

```
trend 加一个 --json 参数，输出 JSON 数组给程序调用，每项包含 date 和各平台的发帖数。动手前先用一句话说明：之前哪个方案被否了，为什么。
```

**看点**：
- 它开口就能说出"HTML 被否，因为下游要 JSON"，说明教训带回来了
- 但 HTML 代码已经不在上下文里：**再指 footer，用量比 ③ 之后明显低**

**⑧ 收尾展示**

```
/tree
```

能看到两个分支并排挂着：HTML 分支（失败但保留）和 JSON 分支（当前）。可以在两个分支节点上各按一次 Shift+L，打上 `方案A-HTML`、`方案B-JSON` 标签。

> 讲点：模型的上下文 = 从根到当前叶子的那一条路径，每次请求都整条重发。`/tree` 改的是路径，不是历史：死胡同移出路径，从此不再花钱；摘要把"为什么不行"带回主线，避免重蹈覆辙；分支还在，审计和回看都不丢。
>
> 它只管对话不管磁盘，所以真实用法是**对话分支配 git 分支**：`try-html` ↔ 方案 A 分支。对比 Codex 的 `/fork`：那是复制出一个新会话，死胡同也一起复制过去，信息也不会流回来；Pi 是同一棵树里移动指针，还能带摘要回来。

---

## Round 6　让 Pi 给自己写扩展（3 分钟，高潮）

```
给你自己写一个 Pi 扩展，路径 .pi/extensions/guard-tests.ts：监听 tool_call 事件，拦截所有对 test/ 目录的 write 和 edit，返回 block，reason 写"测试文件受保护，请修改实现代码"，同时用 ctx.ui.notify 弹一个 warning。API 不确定就先看你自己的文档和 extensions 示例。只写这一个文件，写完不要做别的。
```

写完后，先把代码亮给观众看（`!!` 只显示，不进上下文）。大概 20 行，重点停在 `pi.on("tool_call", ...)` 和 `return { block: true, reason }`：

```
!!cat .pi/extensions/guard-tests.ts
```

热加载：

```
/reload
```

然后故意让它干"坏事"：

```
把 test/stats.test.ts 里 topPosts 那个用例的期望值改成 ["p05", "p13", "p17"]。
```

**看点**：黄色 🛡️ 警告弹出；那次 edit 变成错误的 tool result；模型读到 reason 后会解释改不了，或者反过来去看实现代码。

> 讲点：Pi 没有内置权限弹窗，官方立场是"缺什么让 Pi 自己写"。真实工作流就是：让 Pi 写 → 人 review → 提交到仓库的 `.pi/extensions/`，团队成员 clone 下来、信任项目后自动生效；通用的再打包成 Pi package，用 `pi install` 分发。`tool_call` 不是通知而是可变更的 hook——能 block，也能直接改 `event.input`；扩展还能注册工具、命令、快捷键、provider。
>
> 和第三部分 3.3 护栏的分工：这里讲"让 Pi 现场给自己写扩展"这个工作方式；3.3 讲护栏在真实系统里怎么设计（拦什么、被拒后模型如何改用工具）。这里点到为止，留个钩子："第三部分会看到一个完整的护栏"。

**兜底**（它写崩了或 API 用错了）：

```
!!cp demo-assets/guard-tests.ts .pi/extensions/
/reload
```

---

## Round 7（可选）　进流水线（30 秒）

退出 Pi，在普通终端：

```bash
git diff | pi -p "根据这些改动写一条 Conventional Commits 格式的 commit message，只输出 message 本身"
```

> 讲点：同一个 agent 有三种无头形态：`-p` 一次性输出、`--mode json` 输出事件流、`--mode rpc` 走 stdin/stdout 双向控制；再往上一层是 SDK，直接嵌进自己的服务。第三部分的舆情助手就是用 SDK 嵌进 Node 服务，订阅的是同一套事件。

---

## 翻车预案

| 情况 | 处理 |
|---|---|
| 启动头没有 skill / template | 项目没被信任：`/trust` 后重启 pi |
| Round 2 它改了 test/ | 顺势说"所以我们需要 Round 6"，提前进入扩展环节 |
| Round 3 没读 skill | 用 `/skill:add-command ...` 显式调用 |
| 模型卡住或跑偏 | Esc 中断，排队的消息会回到编辑器，改一句重发 |
| 扩展加载报错 | 用 `demo-assets/guard-tests.ts` 兜底 |
| 整体乱了 | 退出 → 在 `~/pi-coding-demo` 执行 `./scripts/reset.sh` → 重开 pi，从断点那一轮继续 |

## 讲完复原

```bash
cd ~/pi-coding-demo && ./scripts/reset.sh   # 回到 demo-start，清掉生成的文件、.pi/extensions/ 和 try-html 分支
```

演示会话本身留在 `~/.pi/agent/sessions/` 里，`pi -r` 能找回来，可以 `/export` 成 HTML 当分享材料附件。
