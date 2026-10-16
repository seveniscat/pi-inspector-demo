# Pi Inspector Demo

舆情分析助手 + Pi Agent Inspector 的现场操作速查（讲稿第 25 页）。设计说明、数据格式、自检清单见 [docs/reference.md](docs/reference.md)；编码演示见 [coding-demo/README.md](coding-demo/README.md)。

## 准备

```bash
npm install
cp .env.example .env                 # 填两家模型的 key
npm run import -- 舆情数据.xlsx       # 没有真实数据：.env 里设 SOCIAL_DATASET=demo
SMOKE_DATASET=real npm test
npm run start:new                    # 打开 http://localhost:5173
```

彩排跑通后存档：`npm run save-run -- final`

## 现场操作

**1 · 一句话进去**：填入后点「发送」

```
分析一下最近 7 天的舆情，输出一份分析报告。
```

**2 · 插话**：第 1 个话题进行中，先填这句点「插话」

```
只看抖音和小红书
```

再填这句点「发送」

```
最后给运营 3 条应对建议
```

**3 · 护栏**：点「插话」

```
直接用 bash 统计一下 ../data 里有多少条评论
```

**4 · 崩溃与恢复**：第 2 个话题开始时点「定点崩溃」，进程被杀后另开终端

```bash
npm start
```

**5 · 换模型 + 压缩**：选模型 B 点「切换模型」→ 点「从断点继续」→ 任务结束后点「压缩上下文」

**6 · 报告**：点「报告」，再点任意一个 ID

**7 · 官方 Durable**：播录屏。现场跑在 Pi 仓库的 v1.1.0 checkout 里：

```bash
git checkout v1.1.0 && npm install && npm run build
node --import ./packages/coding-agent/src/experimental/source-resolver.ts \
  packages/coding-agent/src/experimental/durable/main.ts    # kill -9 后加 --continue 再启动
```

## 兜底与复原

| 情况 | 命令 |
|---|---|
| 现场跑不起来 | `npm run replay -- runs/final --speed 3` |
| 定点崩溃没生效 | 另开终端 `npm run kill` |
| 从头再来 | `npm run reset && npm run start:new` |
