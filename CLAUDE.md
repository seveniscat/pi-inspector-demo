# pi-inspector-demo

Pi 技术分享的演示项目：用 Pi SDK 嵌入 agent，做一个可中断、可恢复的舆情分析助手（输入"分析一下最近 7 天的舆情" → 按监测话题深挖 + 风险扫描 → 带引用的报告），配 Web UI（Pi Agent Inspector）可视化执行过程。完整说明和链路见 README.md。

## 演示要覆盖的 6 个能力（改动不能削弱任何一个）

① Agent Loop ② Extension ③ Session 树（kill 后恢复）④ 多模型切换 ⑤ Compaction ⑥ Skills。
另外第三部分会对照官方实验版 Pi Durable。`resume` extension 是手搓的恢复，不是 Pi Durable，代码和文案里都不能混用这两个名字。

## 结构

- `src/server.ts`：SDK 组装、SSE、控制接口（/api/prompt、steer、resume、model、compact、abort）
- `src/extensions/social.ts`：数据 → 5 个工具 `dataset_info` / `social_search` / `get_post` / `search_comments` / `social_trend`
- `src/extensions/guard.ts`：权限护栏，`tool_call` 拦截（读原始数据、越界写、bash 联网 / 删除）
- `src/extensions/resume.ts`：checkpoint、恢复、悬空 toolCall 修补、观测事件（`resume_*`）
- `social.ts` 里还有：定点崩溃（`CrashSwitch`）、报告引用核验（`tool_result` 钩子）
- `scripts/replay.ts` + `scripts/save-run.mjs`：演示存档与倍速回放（`runs/` 不入库）
- `src/social/`：数据层，"帖子 + 评论"两张表模型（types.ts）。`local`（data/<dataset>/posts.json + comments.json）/ `live`（远程接口，字段映射待填）/ `replay`（只读缓存）；`cache.ts` 按请求缓存
- `public/index.html`：Inspector，单文件无构建；事件类型改动要同时改这里的 `render()`
- `workspace/`：agent 的 cwd。skill 在 `.pi/skills/opinion-research/`，项目约定在 `AGENTS.md`
- `data/demo/` 由 `scripts/build-corpus.py` 生成（虚构品牌），**改演示数据改脚本，不要手改 JSON**
- `data/real/` 由 `scripts/import-excel.py` 从用户的 Excel 导入，**真实数据，绝不提交**

## 改完必须做

1. `npm test`：数据层冒烟测试（不需要模型 key）；有 data/real 时再跑 `SMOKE_DATASET=real npm test`
2. 语法检查：`for f in src/*.ts src/*/*.ts; do node --experimental-strip-types --check $f; done`
3. 改了 UI：抽出 `<script>` 用 `node --check` 检查，最好用 Playwright 截图看一眼
4. README 的"演示脚本"和"自检清单"跟着更新

## 约束

- Pi 包是 `@earendil-works/pi-coding-agent`，基线 1.1.0。API 以官方仓库 earendil-works/pi 的 docs 为准，不确定的地方用 `as any` 并在 README 自检清单里加一条
- 演示语料是虚构品牌，页面和报告里要能看出是演示数据
- 不要提交 `.env`、`data/real/`、`*.xlsx`、`data/cache/`、`logs/`、`runs/`、`workspace/research/`、`workspace/report/`
- 工具输出不带评论作者（脱敏）；报告不写评论用户昵称
- 提交信息用中文，conventional commits 前缀（feat/fix/docs/chore）
