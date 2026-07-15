TASK_KEY: server-lol-batch-b-adc-entities
DOC_TYPE: 测试记录
WORKSTREAM: server/game-manage
STATUS: done
EXECUTION_MODEL: cursor-grok-4.5-plus-codex-review
LAST_TRACKED_AT: 2026-07-12

# LoL Batch-B ADC 实体与等级属性迁移验证记录（2026-07-12）

关联设计：[LoL-Batch-B-ADC 实体与等级属性迁移设计](../../../详细设计/server/game_manage/LoL-Batch-B-ADC实体与等级属性迁移设计.md)。

## 1. 环境

- database：`test0221`
- user：`postgres`
- 凭据不记录在本文。
- Web 页面：`http://127.0.0.1:5173/#/wasm-validation-generic`
- ABI：generic `compile / run / release`（非 legacy `single_attacker_dps`）

## 2. 数据与静态核对

| 检查 | 结果 |
| --- | --- |
| UTF-8 源文件 | `最小验证/V2-Batch-B-hero-passives.seed.json` |
| 四 worktree 同名文件 SHA256 | `CDDCB52A24A611E93A09C1B38EBB4A7FEC006643794783B61C312DC6E85325D1`（一致） |
| `statsByLevel` 语义 | 相对一级基础值的累计成长增量 |
| stage 绝对值公式 | `baseStats[attr] + statsByLevel[attr][level-1]` |
| 源 JSON → SQL 全量机器比对 | `ENTITY_ROWS=9`，`BASE_ROWS=108`，`STAGE_ROWS=864`，`ERRORS=0` |
| `mvn -Dtest=LolBatchBAdcEntitiesSeedSqlTest clean test` | 8 tests，0 failures |

## 3. 真实 PostgreSQL（seed）

执行 `db/game_manage/seeds/lol_batch_b_adc_entities_seed.sql`：

| 步骤 | 结果 |
| --- | --- |
| 最终 ROLLBACK 演练变体 | 成功；revision `6→6`，目标实体 `2→2`，stage `0→0`；无数据落库 |
| 正式执行 | revision `6→7` |
| 原样第二次执行 | revision 保持 `7`（幂等） |
| 正式库目标数据计数 | 9 entities、108 entity attributes、864 stage rows、6 basic-attack providers、6 mounts |

## 4. API 与发布

Public combat-data API 抽查计数：目标实体 9、属性 108、stage 864、provider 6、ability 6。

L18 API 锚点：

| 实体 | hp | ad | attack_speed |
| --- | --- | --- | --- |
| Teemo | 2383 | 105 | 1.086474 |
| KogMaw | 2318 | 113.7 | 0.964583 |

Admin publish：

| 检查 | 结果 |
| --- | --- |
| versionCode | `lol-batch-b-adc-entities-v1-20260712` |
| changeRevision | 7 |
| 最终 state | `currentRevision=7`，`publishedRevision=7` |

## 5. 真实 Web → TinyGo V2 generic ABI

### Case 1

- source=`hero_teemo`，source stage=18，target=`target_dummy_tank`
- compile 成功（`generic-session-1`）
- run：`duration_reached`；1 次 basic_attack，damage=105；target HP `5000→4895`；warnings=0
- release 成功

### Case 2

- source=`hero_kogmaw`，source stage=18，target=`target_dummy_squishy`
- compile 成功（`generic-session-2`）
- run：`duration_reached`；1 次 basic_attack，damage=113.7；target HP `2000→1886.3`；warnings=0
- release 成功

浏览器 console error/warn：0。

## 6. 回归与治理

| 命令 / 动作 | 结果 |
| --- | --- |
| 后端 `mvn test` | 76 tests，0 failures |
| 后端 `mvn package` | BUILD SUCCESS（同样 76 tests） |
| Web `npm run test:wasm-generic` | 4 files / 24 tests 全过 |
| `git diff --check` | 通过 |
| `npx @colbymchenry/codegraph sync/status` | 同步 1 changed file，status up to date |
| `node tools/task-governance/cli.mjs rebuild` | tasks=40；当前任务可查询并映射详细设计 |

### 预存治理问题（与本任务无关）

以下问题在本任务收口前即已存在，本任务既未引入也未解决：

- 5 个 unassigned docs
- 1 个 missing doc

## 7. 范围边界 / 后续

本批已完成：6 ADC + 3 dummy、基础/等级属性、6 套通用普攻闭环。

不算当前任务残余失败的后续独立项：

- Vayne W listener/effect 未迁移
- Batch C 装备、破败、海妖、鬼索未迁移

明确不包含：

- entity type relations
- 恢复 legacy Bundle/Catalog/hero/item/skill 数据面
