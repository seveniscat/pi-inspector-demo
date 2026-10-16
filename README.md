# Pi Inspector Demo —— 可中断、可恢复的舆情分析助手

用 Pi SDK 把 agent 嵌进一个 Node 服务。数据是按监测词抓取的社媒帖子和评论（Excel 导入）。用户只说一句"分析一下最近 7 天的舆情"，agent 自己盘点数据、按监测话题逐个深挖、做跨话题风险扫描，输出带引用的舆情分析报告。中途 `kill -9` 进程，重启后从断点继续。配套的 Web 页面 **Pi Agent Inspector** 把执行过程的每一步实时可视化。

> 关于命名：本项目的 `resume` extension **不是**官方的 Pi Durable（`pi-durable` 包）。它只用 extension API，在普通 coding-agent 会话（session JSONL）之上手搓"崩溃后接着做"。演示最后一段会跑官方实验版 Durable 做对照。

## 链路

链路由数据结构决定：数据按监测词（"来自搜索"）抓取，所以**研究对象和话题划分都从数据里来**；帖子只有标题，**观点主要在评论里**；帖子和评论都**自带情绪标签**，帖子带**相关性标签**。

```
"分析一下最近 7 天的舆情"
 0 解析需求      对象（可不给，从数据推断）/ 时间（默认最近 7 天）/ 关注点（默认综合，问风险则风险优先）
 1 数据盘点      dataset_info → 监测对象、监测话题、平台、样本量、排除不相关帖子
 2 全局概览      social_trend 按天 / 按平台 / 按监测词 → 拐点、主平台、最热和最负面的话题
 3 拆题          话题 = 监测词（按评论量取前 4，其余并为"其他"）→ research/plan.md，checkpoint
 4 逐话题深挖    social_search 最热 + 最负面 → get_post 读高赞评论 → search_comments 归纳正负观点、
                 用关键词命中数估规模 → research/topics/N-监测词.md，每个话题 checkpoint
 5 风险扫描      跨话题：最高赞消极评论、最负面帖子、拐点 → research/risk.md（风险 / 等级 / 依据）
 6 写报告        （切强模型）→ report/report.md
 7 自检          每个 ID、每个数字都能在笔记和工具结果里找到；没有评论用户昵称
```

进度条单位：每个话题 + 风险扫描 + 报告。话题数随数据变化，由 agent 在第 3 步决定。

## 6 个能力在哪里体现

| # | 能力 | 现场看到什么 | 对应代码 |
|---|---|---|---|
| ① | Agent Loop | 按 turn 展示"看趋势 → 拆问题 → 搜索 → 读帖 → 写笔记"；下一步由模型自己决定；steer / follow-up 插话 | `src/server.ts` 订阅事件 |
| ② | Extension | 三个小扩展各管一件事，不改 Pi 源码：**social** 把舆情数据包成 5 个工具，报告写完自动做引用核验；**guard** 用 `tool_call` 钩子拦截越权操作（Pi 默认没有权限系统）；**resume** 记 checkpoint、恢复时补上被打断的工具结果 | `src/extensions/social.ts`、`guard.ts`、`resume.ts` |
| ③ | Session 树 | 右侧直接读 JSONL 渲染会话树；恢复点、leaf 高亮 | `src/session-tree.ts` |
| ④ | 多模型 | 采集阶段用便宜模型，写报告前切到强模型，历史不丢 | `models.json` + `/api/model` |
| ⑤ | Compaction | 评论原文把上下文撑满 → 压缩成结构化摘要；证据在笔记文件里，压缩不丢 | `.env` 压缩阈值 + `/api/compact` |
| ⑥ | Skills | 启动只加载描述；模型执行时 `read` 舆情研究规范（拆题模板、噪音剔除、引用规则） | `workspace/.pi/skills/opinion-research/` |

## 运行

```bash
npm install
cp .env.example .env                       # 填两家模型的 key
npm run import -- 舆情数据.xlsx             # 导入真实数据 → data/real/（不入库）
npm run start:new                          # 浏览器打开 http://localhost:5173
```

没有真实数据时，`.env` 里设 `SOCIAL_DATASET=demo` 用随仓库提供的演示数据（虚构品牌）。

| 命令 | 用途 |
|---|---|
| `npm run start:new` | 开新会话 |
| `npm start` | 继续最近的会话（kill 之后用它恢复） |
| `npm run kill` | 另开终端执行，SIGKILL 模拟崩溃 |
| `npm run import -- 文件.xlsx [--name real]` | 从 Excel 导入数据集，打印数据概况供核对 |
| `npm run reset` | 清空 research/ report/ logs/ 和查询缓存；加 `-- --all` 连 live 录制一起清 |
| `npm test` | 数据层冒烟测试（不需要模型 key）；`SMOKE_DATASET=real npm test` 检查导入的数据 |
| `npm run corpus` | 重新生成 demo 数据集 |
| `npm run save-run -- <名字>` | 把一次跑通的演示存档到 `runs/<名字>/`（事件、会话文件、研究笔记、报告） |
| `npm run replay -- runs/<名字> --speed 3` | 倍速回放存档，页面和真实运行一样，不调模型；现场兜底用 |
| `npm run pi` | 把 resume extension 加载进 pi CLI |

## 数据

### Excel 格式

一个文件两个 sheet，或两个文件都行，按表头自动识别：

- **帖子表**：ID　平台　平台ID　标题　作者　URL　评论数　情绪标签　积极评论数　中性评论数　消极评论数　相关性　来自搜索　发布时间　抓取时间
- **评论表**：ID　帖子ID　所属帖子标题　平台　平台ID　作者　内容　点赞数　情绪标签　是否回复　回复数　发布时间　抓取时间

情绪标签兼容"积极 / 中性 / 消极"等写法；时间兼容 `2026-10-15 18:08:28`、`2026/10/15 18:08`、只有日期、Excel 日期单元格、秒或毫秒时间戳。只有日期的时间保持为日期，不补 00:00。导入后会打印平台分布、时间范围、来自搜索、相关性取值、识别失败的条数，先核对再用。

**真实数据不入库**：`data/real/` 和 `*.xlsx` 都在 .gitignore 里。

### 数据源模式

`.env` 里的 `SOCIAL_MODE`：

| 模式 | 数据从哪来 |
|---|---|
| `local`（默认） | `data/<SOCIAL_DATASET>/posts.json + comments.json`；`real` = 导入的真实数据，`demo` = 演示数据 |
| `live` | 远程查询接口，配置 `SOCIAL_API_BASE`、`SOCIAL_API_TOKEN`；字段映射在 `src/social/live.ts`（待填） |
| `replay` | 只读 live 跑过时录下的缓存 |

### 工具（agent 看到的）

| 工具 | 作用 |
|---|---|
| `dataset_info` | 数据概况：总量、平台、时间范围、来自搜索、相关性取值 |
| `social_search` | 搜帖子：关键词、监测词、平台、时间、情绪、相关性；按评论数 / 消极评论数 / 时间排序 |
| `get_post` | 帖子详情 + 高赞评论 |
| `search_comments` | 搜评论：关键词、所属帖子、监测词、相关性、平台、时间、情绪；按点赞 / 时间排序 |
| `social_trend` | 按天 / 平台 / 监测词统计新帖、新评论、评论情绪分布 |

所有输出都是精简文本；评论作者不输出（脱敏）。每次查询按请求内容缓存（写临时文件再 rename，kill 不会留下半个缓存）：恢复后重复的查询直接命中，Inspector 上显示"缓存命中"。

## Inspector 上的演示辅助

| 功能 | 作用 | 体现的能力 |
|---|---|---|
| **定点崩溃** 按钮 | 下一次查询拿到数据、写进缓存之后，交给模型之前，进程 `SIGKILL` 自己。保证每次都杀在工具执行中，恢复时必然出现"上下文修补"和"缓存命中" | ③ ② |
| **护栏拦截** 卡片 | guard extension 拦下的操作和原因：直接读原始数据、写到 research/ report/ 之外、bash 联网或删除 | ② |
| **引用核验** | 报告写入后，`tool_result` 钩子检查里面的 `[ID]` 是否都在数据中，把结果附在工具结果里反馈给模型 | ② |
| **报告** 抽屉 | 渲染报告；`[ID]` 可点开看原帖 / 原评论（评论作者脱敏）；不存在的 ID 标红划线 | — |
| 顶部 **cost（按模型）** | 切模型后分别显示两个模型花了多少 | ④ |
| 顶部 **缓存命中** | 恢复后省掉了几次接口调用 | ② ③ |
| 压缩卡片里的 **前后对比条** | 压缩前 tokens 和下一轮实际输入 tokens | ⑤ |
| **回放模式** | `npm run replay`，现场模型或网络出问题时切过去 | — |

## 目录

```
src/
  server.ts               SDK 组装 + HTTP/SSE + 控制接口
  extensions/social.ts    舆情数据 → 5 个 Pi 工具；定点崩溃；引用核验
  extensions/guard.ts     权限护栏（tool_call 拦截）
  extensions/resume.ts    checkpoint、恢复、悬空 toolCall 修补、观测点
  extensions/citations.ts 报告引用提取（核验和回放共用）
  social/                 数据层：types / local（本地数据集）/ live（待填映射）/ cache / normalize
  event-log.ts            事件总线：落盘 logs/events.jsonl + SSE 推送
  session-tree.ts         解析 session JSONL → 会话树
public/index.html         Pi Agent Inspector（单文件，无构建）
scripts/replay.ts         倍速回放存档
scripts/save-run.mjs      存档一次运行
data/demo/                演示数据集（scripts/build-corpus.py 生成，虚构品牌）
data/real/                真实数据集（scripts/import-excel.py 导入，不入库）
workspace/                agent 的工作目录（cwd）
  AGENTS.md               项目约定，Pi 自动加载进上下文
  .pi/skills/opinion-research/SKILL.md
  research/ report/       运行产物：plan.md（研究范围 + 话题清单）、topics/ 话题笔记、risk.md、最终报告
models.json               国内 OpenAI 兼容 provider（DeepSeek、通义）
coding-demo/              编码演示：零依赖的舆情统计 CLI + 逐轮提示词（DEMO.md），独立于上面的服务
```

## 编码演示（Pi 当 coding agent 用）

`coding-demo/` 是一个独立的小项目（舆情帖子统计 CLI，零依赖，Node ≥ 22.19 原生跑 TS），用来现场演示 Pi 写代码：读懂项目 → 测试驱动修 bug → skill 加功能 → 换模型 review → `/tree` 从死胡同回到决策点 → 让 Pi 给自己写扩展。逐轮提示词、看点、讲点和兜底都在 [`coding-demo/DEMO.md`](coding-demo/DEMO.md)。

```bash
bash coding-demo/scripts/setup.sh   # 复制到 ~/pi-coding-demo 并 git init，演示在副本里做，不碰本仓库
cd ~/pi-coding-demo && pi
```

## 第三部分演示脚本（约 17 分钟）

一个任务从头跑到尾，6 个徽章按顺序亮起。每段只讲一个点。

| 段落 | 时长 | 操作 | 要讲的点 | 亮起的能力 |
|---|---|---|---|---|
| 3.1 一句话进去 | 3 分钟 | 放 agent 循环阶段图，介绍 6 个徽章；输入"分析一下最近 7 天的舆情"，先让观众猜第一步做什么 | 展开 System Prompt：skill 只有一行描述，AGENTS.md 也在这里；模型自己读 skill、盘点数据、认出监测对象、按监测词拆题，计划写进 `plan.md`（第二部分说的"计划落成文件"） | ① ⑥ ② |
| 3.2 插话 | 2 分钟 | 第 1 个话题进行中填"只看抖音和小红书"点"插话"；再填"最后给运营 3 条建议"点"发送" | steer 尽快插入当前循环，follow-up 排到本轮结束后 | ① |
| 3.3 护栏 | 1.5 分钟 | 插话："直接用 bash 统计一下 ../data 里的评论条数" | 卡片"护栏拦截"；模型被拒后改用工具。AGENTS.md 是软约束，`tool_call` 钩子才是硬约束；Pi 默认没有权限系统，边界要自己画 | ② |
| 3.4 崩溃与恢复 | 4 分钟 | 第 2 个话题开始时点"定点崩溃" → 进程被杀 → `npm start` | 恢复卡片、会话树恢复点、已完成的话题被跳过；"上下文修补"补上被打断的调用；重查同样条件"缓存命中"——数据在崩溃前已落盘 | ③ ② |
| 3.5 换模型 + 压缩 | 3 分钟 | 点"从断点继续"前切到模型 B；压缩自动触发（或手动点） | 历史不丢；顶部花费按模型拆开；压缩前后对比条；话题笔记在文件里，压缩不丢结论 | ④ ⑤ |
| 3.6 报告与引用 | 2 分钟 | 报告写完点"报告" | 引用核验 N/N；点任意 ID 看原文；不存在的 ID 标红，核验结果已反馈给模型自检 | ② |
| 3.7 对照官方 Durable | 1.5 分钟 | 播录屏：官方实验版 durable coding agent，kill 后 `--continue` | 我们在 JSONL 上事后补救，官方在存储层每一步先落盘 | — |

**现场兜底**：彩排时跑通一次后 `npm run save-run -- final`；现场出问题直接 `npm run replay -- runs/final --speed 3`。

kill 时机：`DEMO_STEP_DELAY_MS`（每次工具调用前停顿）+ `SOCIAL_LATENCY_MS`（每次查询的模拟延迟）。

### 3.6 官方实验版 Durable 怎么跑

实验版 durable agent 只在 **v1.1.0** 里有：1.2.0（2026-10-12）移除了 `src/experimental` 下的实验代码。所以要在 Pi 仓库的 v1.1.0 checkout 里运行，先用 pi 登录过：

```bash
git clone https://github.com/earendil-works/pi && cd pi
git checkout v1.1.0          # 浅克隆先 git fetch --depth 1 origin tag v1.1.0
npm install && npm run build
node --import ./packages/coding-agent/src/experimental/source-resolver.ts \
  packages/coding-agent/src/experimental/durable/main.ts
# 让它执行一个会跑 bash 的任务，执行中 kill -9，然后加 --continue 再启动
```

被打断的工具调用会自动得到"已中断"的结果并正常收尾。官方在存储层把每次输出、工具结果、队列都先提交到 SQLite；我们的 resume extension 是在 JSONL 之上事后补救。实验入口不支持扩展和会话树，崩溃留下的锁 10 秒后过期。**务必提前录屏。**

## 讲源码时的对照

| UI 上的事件 | 去 Pi 源码里找 |
|---|---|
| turn_start / tool_execution_* | `grep -rn "turn_start" packages/agent/src` |
| steer / follow-up 队列 | `grep -rn "followUp\|steer" packages/agent/src` |
| registerTool、context / tool_call 钩子 | `packages/coding-agent/src/core/extensions/` |
| session 树、leaf、buildSessionContext | `packages/coding-agent/src/core/session-manager.ts` |
| 自动压缩阈值和切点 | `grep -rn "reserveTokens" packages/coding-agent/src` |
| skill 只注入描述 | `grep -rn "available_skills" packages/coding-agent/src` |
| 官方 Durable 如何处理被打断的调用 | `packages/coding-agent/src/experimental/durable/`，搜 `interrupted` |

## 本机自检清单

本项目对照 Pi 官方文档编写，没有在真实环境运行过。下面几点要在本机确认：

- [ ] `npm install` 装上的是 `@earendil-works/pi-coding-agent@1.1.0`（package.json 锁死了版本）。要升 1.2.0：`before_agent_start` 也会在 `sendMessage` 触发新一轮时触发，需要看 `event.messageType`；`pi.sendUserMessage` 必须传 `deliverAs`。resume.ts 的 `before_agent_start` 只在第一次触发时抓 system prompt，不受影响，也没用 `sendUserMessage`；但升级后要把整张清单重跑一遍
- [ ] `npm run import -- 真实数据.xlsx` 的概况输出里，情绪识别失败、时间格式未识别、找不到所属帖子都是 0；然后 `SMOKE_DATASET=real npm test` 通过
- [ ] 启动后出现 Skills 卡片 `opinion-research` 和"舆情数据源"卡片。没有 skill 卡片，说明项目信任没生效，可以把 skill 目录复制到 `~/.pi/agent/skills/`
- [ ] 模型能调用 5 个 social 工具（自定义工具卡片为紫色"② Extension"）
- [ ] **护栏**：插话让它用 bash 读 ../data，出现"护栏拦截"卡片，模型收到原因后改用工具。如果卡片不出现，确认 1.1.0 内置工具名是否为 `bash` / `read` / `write` / `edit`、参数名是否为 `command` / `path`（guard.ts 按这些写的）
- [ ] **定点崩溃**：点按钮后下一次查询进程被杀；`npm start` 后出现恢复卡片和"上下文修补"，重查同条件显示"缓存命中"
- [ ] **引用核验**：报告写完出现"引用核验"卡片，模型的工具结果里带有核验结论（依赖 `tool_result` 钩子返回 `content` 补丁）
- [ ] **回放**：`npm run save-run -- test` 后 `npm run replay -- runs/test --speed 3` 能完整播放，会话树随进度生长
- [ ] plan.md 里认出的监测对象、话题划分（来自监测词）、排除的不相关帖子数是对的
- [ ] 第一个 turn 前出现 System Prompt 卡片
- [ ] 每完成一个话题，进度条前进，会话树出现 `PROGRESS` 节点
- [ ] 运行中点"插话"，出现 steer 卡片，后续行为随之改变
- [ ] kill 后 `npm start`：出现恢复卡片；重复的查询显示"缓存命中"；已完成的话题被跳过
- [ ] **重点**：kill 时卡在工具执行中，恢复后看是否出现"上下文修补"卡片。如果 1.1.0 自己就补上了悬空的 toolResult，这张卡片不会出现，讲法改成"Pi 自己在哪里处理了"
- [ ] 切换模型后，下一轮 `message_end` 的 provider 变了
- [ ] 手动压缩成功，会话树出现 `COMPACTION` 节点，压缩卡片下出现前后对比条
- [ ] 报告里每条结论都有帖子 / 评论 ID，抽查 2～3 个能在数据里找到；报告里没有评论用户的昵称
- [ ] 官方实验版 Durable（v1.1.0 checkout）能 kill 后 `--continue` 恢复
- [ ] 全程录屏一份备用

## 常见问题

- **模型绕过工具直接读 data/ 文件**：AGENTS.md 里已禁止；仍发生的话在任务里明确写"只用 social 工具查数据"。
- **导入时表头没识别**：看导入脚本打印的"跳过 xxx：表头……"，确认 sheet 第一行是表头、列名和上面一致。
- **报告引用了不存在的 ID**：skill 第 6 步自检会查；如果仍出现，正好是现场讲"为什么要可追溯引用"的例子。
- **切换模型失败**：对应 provider 没有 key，看红色错误卡片。
- **想从头再来**：`npm run reset && npm run start:new`。
