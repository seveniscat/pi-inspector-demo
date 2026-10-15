# Pi Inspector Demo —— 可中断、可恢复的舆情 Research Bot

用 Pi SDK 把 agent 嵌进一个 Node 服务，让它对一个品牌做舆情研究：自己拆研究问题、调用舆情查询服务、读帖子和评论、发现风险线索并追查，最后输出带引用的研究报告。中途 `kill -9` 进程，重启后从断点继续。配套的 Web 页面 **Pi Agent Inspector** 把执行过程的每一步实时可视化。

> 关于命名：本项目的 `resume` extension **不是**官方的 Pi Durable（`pi-durable` 包）。它只用 extension API，在普通 coding-agent 会话（session JSONL）之上手搓"崩溃后接着做"。演示最后一段会跑官方实验版 Durable 做对照。

## 6 个能力在哪里体现

| # | 能力 | 现场看到什么 | 对应代码 |
|---|---|---|---|
| ① | Agent Loop | 按 turn 展示"看趋势 → 拆问题 → 搜索 → 读帖 → 写笔记"；下一步由模型自己决定；steer / follow-up 插话 | `src/server.ts` 订阅事件 |
| ② | Extension | **social**：把舆情服务包成 `social_search` / `get_post` / `social_trend` 三个工具；**resume**：checkpoint + 恢复时补上被打断的工具结果 | `src/extensions/social.ts`、`resume.ts` |
| ③ | Session 树 | 右侧直接读 JSONL 渲染会话树；恢复点、leaf 高亮 | `src/session-tree.ts` |
| ④ | 多模型 | 采集阶段用便宜模型，写报告前切到强模型，历史不丢 | `models.json` + `/api/model` |
| ⑤ | Compaction | 帖子原文把上下文撑满 → 压缩成结构化摘要；证据在笔记文件里，压缩不丢 | `.env` 压缩阈值 + `/api/compact` |
| ⑥ | Skills | 启动只加载描述；模型执行时 `read` 舆情研究规范（拆题模板、噪音剔除、引用规则） | `workspace/.pi/skills/opinion-research/` |

## 运行

```bash
npm install
cp .env.example .env      # 填两家模型的 key；SOCIAL_MODE 默认 mock
npm run start:new         # 新会话，浏览器打开 http://localhost:5173
```

| 命令 | 用途 |
|---|---|
| `npm run start:new` | 开新会话 |
| `npm start` | 继续最近的会话（kill 之后用它恢复） |
| `npm run kill` | 另开终端执行，SIGKILL 模拟崩溃 |
| `npm run reset` | 清空 research/ report/ logs/ 和 mock 缓存；加 `-- --all` 连 live 录制一起清 |
| `npm run corpus` | 重新生成离线演示语料 |
| `npm run pi` | 把 resume extension 加载进 pi CLI |

## 数据源：mock / live / replay

`.env` 里的 `SOCIAL_MODE` 切换：

| 模式 | 数据从哪来 | 什么时候用 |
|---|---|---|
| `mock` | `data/corpus.json`：49 条虚构帖子（虚构品牌"栖木咖啡"新品上市一周） | 彩排、没有服务时、兜底 |
| `live` | 真实舆情查询服务，配置 `SOCIAL_API_BASE`、`SOCIAL_API_TOKEN` | 正式演示 |
| `replay` | 只读 live 跑过时录下的缓存（`data/cache/live/`），未录过的查询会报错 | 现场网络不可靠时 |

**接入真实服务**：只改 `src/social/live.ts` 里标了 TODO 的三处（接口路径与鉴权、查询参数映射、返回字段映射），工具层、缓存、UI 都不用动。建议正式演示前用 live 完整跑一遍，录好缓存，现场有问题直接切 replay。

**缓存与幂等**：每次查询按请求内容缓存（`src/social/cache.ts`，写临时文件再 rename，kill 不会留下半个缓存）。恢复后模型重复发起同样的查询会直接命中，Inspector 上显示"缓存命中"，不会重复访问外部服务。这正是 Pi Durable 提醒的"有副作用的步骤要幂等"的具体做法。

### 演示语料里埋了什么

- **口碑**：桂花香真实、燕麦奶顺；集中吐槽"太甜"；首周 19.9 元结束后的价格反弹
- **风险事件**：10-11 杭州一家门店有人喝出塑料片 → 10-12 第二家门店 + 抖音视频发酵 → 营销号夸大成"全国门店" → 10-13 媒体走访、官方说明（泵头配件破损，仅杭州两店）→ 10-14 回落
- **噪音**：KOL 合作帖、营销号、转发抽奖帖（抽奖帖按热度排在前面，看 agent 会不会被带偏）
- **竞品**：虚构的"鹿岛咖啡"10-10 上市，更便宜、更不甜

## 目录

```
src/
  server.ts               SDK 组装 + HTTP/SSE + 控制接口
  extensions/social.ts    舆情服务 → 3 个 Pi 工具
  extensions/resume.ts    checkpoint、恢复、悬空 toolCall 修补、观测点
  social/                 数据层：types / mock / live（待填映射）/ cache
  event-log.ts            事件总线：落盘 logs/events.jsonl + SSE 推送
  session-tree.ts         解析 session JSONL → 会话树
public/index.html         Pi Agent Inspector（单文件，无构建）
data/corpus.json          离线演示语料（scripts/build-corpus.py 生成）
workspace/                agent 的工作目录（cwd）
  AGENTS.md               项目约定，Pi 自动加载进上下文
  .pi/skills/opinion-research/SKILL.md
  research/ report/       运行产物：研究计划、4 份证据笔记、最终报告
models.json               国内 OpenAI 兼容 provider（DeepSeek、通义）
```

## 第三部分演示脚本（约 15 分钟）

| 段落 | 时长 | 操作 | 亮起的能力 |
|---|---|---|---|
| 3.1 地图 | 1 分钟 | 放 agent 循环阶段图，介绍 Inspector 的 6 个徽章 | — |
| 3.2 跑起来 | 3 分钟 | 先让观众猜 agent 第一步会做什么；点"发送"。展开 System Prompt；看它先 `read` skill，再用 `social_trend` 摸底、写研究计划 | ① ⑥ ② |
| 3.3 插话 | 2 分钟 | Q2 进行中填"抽奖帖和营销号的数量单独统计出来"点"插话（steer）"；再填"最后给品牌方 3 条应对建议"点"发送"（变 follow-up） | ① |
| 3.4 崩溃与恢复 | 4 分钟 | Q3 追查风险事件时 `npm run kill`；`npm start`；看恢复卡片、会话树恢复点、已完成的问题被跳过、重复查询显示"缓存命中"；看"上下文修补"卡片 | ③ ② |
| 3.5 换模型 + 压缩 | 3 分钟 | 写报告前切到模型 B；任务结束后点"压缩上下文"（或设 `DEMO_COMPACT_AT_TOKENS` 让它中途自动触发） | ④ ⑤ |
| 3.6 对照官方 Durable | 2 分钟 | 跑官方实验版 durable coding agent，工具执行中 kill，`--continue` 重启 | — |

kill 时机：`DEMO_STEP_DELAY_MS`（每次工具调用前停顿）+ `SOCIAL_MOCK_LATENCY_MS`（mock 查询延迟）。

### 3.6 官方实验版 Durable 怎么跑

在 Pi 仓库（github.com/earendil-works/pi）根目录，先用 pi 登录过：

```bash
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

- [ ] `npm install` 能装上 `@earendil-works/pi-coding-agent@^1.1.0`
- [ ] 启动后出现 Skills 卡片 `opinion-research` 和"舆情数据源"卡片。没有 skill 卡片，说明项目信任没生效，可以把 skill 目录复制到 `~/.pi/agent/skills/`
- [ ] 模型能调用 `social_search` 等三个工具（自定义工具卡片为紫色"② Extension"）
- [ ] 第一个 turn 前出现 System Prompt 卡片
- [ ] 每完成一个问题，进度条前进，会话树出现 `PROGRESS` 节点
- [ ] 运行中点"插话"，出现 steer 卡片，后续行为随之改变
- [ ] kill 后 `npm start`：出现恢复卡片；重复的查询显示"缓存命中"；已完成的问题被跳过
- [ ] **重点**：kill 时卡在工具执行中，恢复后看是否出现"上下文修补"卡片。如果 1.1.0 自己就补上了悬空的 toolResult，这张卡片不会出现，讲法改成"Pi 自己在哪里处理了"
- [ ] 切换模型后，下一轮 `message_end` 的 provider 变了
- [ ] 手动压缩成功，会话树出现 `COMPACTION` 节点
- [ ] 报告里每条结论都有帖子 ID，抽查 2～3 个 ID 能在语料里找到
- [ ] live 模式：接入真实服务后完整跑一遍，录好缓存；切 replay 再跑一遍确认能离线
- [ ] 官方实验版 Durable 能 kill 后 `--continue` 恢复
- [ ] 全程录屏一份备用

## 常见问题

- **模型不调用 social 工具、去用 bash curl**：AGENTS.md 里已禁止；仍发生的话在任务里明确写"只用 social_search 等工具"。
- **报告引用了不存在的帖子 ID**：skill 已要求不得编造；如果出现，正好是现场讲"为什么要可追溯引用"的例子。
- **切换模型失败**：对应 provider 没有 key，看红色错误卡片。
- **想从头再来**：`npm run reset && npm run start:new`。
