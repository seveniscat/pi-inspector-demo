# pi-inspector-demo

Pi 技术分享的演示项目：用 Pi SDK 嵌入 agent，做一个可中断、可恢复的舆情 research bot，配 Web UI（Pi Agent Inspector）可视化执行过程。完整说明见 README.md。

## 演示要覆盖的 6 个能力（改动不能削弱任何一个）

① Agent Loop ② Extension ③ Session 树（kill 后恢复）④ 多模型切换 ⑤ Compaction ⑥ Skills。
另外第三部分会对照官方实验版 Pi Durable。`resume` extension 是手搓的恢复，不是 Pi Durable，代码和文案里都不能混用这两个名字。

## 结构

- `src/server.ts`：SDK 组装、SSE、控制接口（/api/prompt、steer、resume、model、compact、abort）
- `src/extensions/social.ts`：舆情服务 → `social_search` / `get_post` / `social_trend`
- `src/extensions/resume.ts`：checkpoint、恢复、悬空 toolCall 修补、观测事件（`resume_*`）
- `src/social/`：数据层。`mock`（data/corpus.json）/ `live`（真实服务，字段映射待填）/ `replay`（只读缓存）；`cache.ts` 按请求缓存
- `public/index.html`：Inspector，单文件无构建；事件类型改动要同时改这里的 `render()`
- `workspace/`：agent 的 cwd。skill 在 `.pi/skills/opinion-research/`，项目约定在 `AGENTS.md`
- `data/corpus.json` 由 `scripts/build-corpus.py` 生成，**改语料改脚本，不要手改 JSON**

## 改完必须做

1. `npm test`：数据层冒烟测试（不需要模型 key）
2. 语法检查：`for f in src/*.ts src/*/*.ts; do node --experimental-strip-types --check $f; done`
3. 改了 UI：抽出 `<script>` 用 `node --check` 检查，最好用 Playwright 截图看一眼
4. README 的"演示脚本"和"自检清单"跟着更新

## 约束

- Pi 包是 `@earendil-works/pi-coding-agent`，基线 1.1.0。API 以官方仓库 earendil-works/pi 的 docs 为准，不确定的地方用 `as any` 并在 README 自检清单里加一条
- 演示语料是虚构品牌，页面和报告里要能看出是演示数据
- 不要提交 `.env`、`data/cache/`、`logs/`、`workspace/research/`、`workspace/report/`
- 提交信息用中文，conventional commits 前缀（feat/fix/docs/chore）
