# sentiment-kit

Pi 编码演示用的小项目：舆情帖子统计 CLI，零依赖，Node ≥ 22.19 直接运行 TypeScript。

演示时不要在仓库里直接操作，先 `bash coding-demo/scripts/setup.sh` 复制到 `~/pi-coding-demo`，详见 DEMO.md。

```bash
npm test                                  # 跑测试（初始状态有 2 个故意埋的 bug）
node src/cli.ts data/posts.csv summary    # 按平台汇总
node src/cli.ts data/posts.csv top 3      # 互动量 Top N
```

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
