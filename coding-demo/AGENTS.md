# sentiment-kit

舆情帖子的小型统计 CLI：读取 `data/posts.csv`（3 个平台、近 7 天的帖子），输出平台汇总、热帖排行等。

## 运行

- Node ≥ 22.19，直接用 Node 原生类型擦除跑 TypeScript，**零依赖**
- 不要 `npm install` 任何包，不要引入构建步骤
- 测试：`npm test`
- 手动验证：`node src/cli.ts data/posts.csv <命令>`

## 代码约定

- import 路径必须带 `.ts` 后缀，类型用 `import type`
- 只用可擦除的 TS 语法：不用 `enum`、`namespace`、构造函数参数属性
- `src/stats.ts` 只放纯函数（无 IO）；文件读写和参数解析只在 `src/cli.ts`
- 表格输出统一用 `src/format.ts` 的 `renderTable`

## 工作规则

- 每次改完代码都要跑 `npm test`，全绿才算完成
- 默认不改 `test/` 下已有的用例；新增功能可以新增用例
- 回答用中文，简洁，先说结论
