---
name: add-command
description: 给 sentiment-kit 的 CLI 新增子命令时必须使用。包含本项目新增命令的固定步骤、代码位置和验收清单。
---

# 给 sentiment-kit 新增 CLI 子命令

按顺序完成，不要跳步。

## 步骤

1. **统计逻辑**：在 `src/stats.ts` 新增一个导出的纯函数
   - 入参是 `Post[]`，返回结构化数据，不做任何 IO、不打印
   - 需要新类型就加到 `src/types.ts`
2. **测试**：新建 `test/<命令名>.test.ts`
   - 基于 `data/posts.csv` 的真实数据断言，至少 2 个用例（正常结果 + 一个边界）
3. **接入 CLI**：在 `src/cli.ts`
   - `switch` 里加一个 `case`，输出统一用 `renderTable`
   - 同步更新顶部 `USAGE` 文本
4. **文档**：在 `README.md` 的「命令」表格里加一行

## 验收

- [ ] `npm test` 全绿
- [ ] 实际运行 `node src/cli.ts data/posts.csv <命令>`，把输出贴出来
- [ ] 没有新增任何依赖
- [ ] 最后用 3 行以内总结改了哪些文件
