---
description: Review 当前工作区的改动（git diff），只挑真问题
argument-hint: "[关注点]"
---
运行 `git status` 和 `git diff` 查看当前未提交的改动，做一次 code review。

要求：
- 只指出真正会出问题的地方（bug、边界情况、违反 AGENTS.md 约定），不要提风格偏好
- 最多 3 条，按严重程度排序；每条写：文件:行号、问题、为什么、建议改法
- 没有严重问题就直接说"没有阻塞问题"，不要硬凑
- 只 review，不要改代码
- 额外关注点：${@:-无}
