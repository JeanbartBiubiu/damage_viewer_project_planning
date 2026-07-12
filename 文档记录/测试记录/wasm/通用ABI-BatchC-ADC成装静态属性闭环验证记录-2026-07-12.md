TASK_KEY: wasm-generic-batch-c-adc-items
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-12

# 通用 ABI Batch C ADC 成装静态属性闭环验证记录

详细设计：[通用 ABI Batch C ADC 成装静态属性闭环详细设计](../../详细设计/wasm/通用ABI-BatchC-ADC成装静态属性闭环详细设计.md)

## 1. 自动化

| 模块 | 命令 | 结果 |
| --- | --- | --- |
| Backend | `mvn -Dtest=LolBatchCAdcItemsSeedSqlTest test` | 通过；11 tests |
| Backend | `mvn test` | 通过；97 tests |
| Web | `npm run lint` | 通过 |
| Web | `npm run typecheck` | 通过 |
| Web | `npm run test -- --run` | 通过；7 files / 60 tests，assembler 21 tests |
| Web | `npm run build` | 通过；仅既有 large-chunk warning |

## 2. Live DB 三阶段

目标：PostgreSQL `test0221` / 用户 `postgres`，凭据脱敏。执行前 current/published=`8/8`。

首次 rollback dry-run 发现既有 compatibility 占位 `62002 / type/62002` 和 53 条 legacy equipment 关系，脚本安全拒绝且未写数据。补充精确占位升级和 53-id cleanup 后重新 dry-run：

| 阶段 | current/published | entity | attr | entity relation | legacy relation | type key |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 事务内 | `9/8` | 53 | 151 | 53 | 0 | `tag/adc_completed_item` |
| rollback 后 | `8/8` | 0 | 0 | 0 | 53 | `type/62002` |
| 正式执行 | `9/8` | 53 | 151 | 53 | 0 | `tag/adc_completed_item` |
| 原脚本重跑 | `9/8` | 53 | 151 | 53 | 0 | `tag/adc_completed_item` |

锚点 SQL 回读与源一致：鬼索 3 行、破败 3 行、海妖 3 行；正式重跑未推进 revision。

发布版本：`lol-batch-c-adc-items-v1-20260712`，`changeRevision=9`。发布后 current/published=`9/9`。Public API 回读 53 个 `item_%` entity、53 条最终关系；破败 relation extend 包含 sourceVersion `16.9.1`、goldCost、iconUrl、sourceTags 和 statKeys。

## 3. 浏览器联调

页面：`http://127.0.0.1:5173/#/wasm-validation-generic`，API：`http://localhost:8082`。

验证输入：薇恩 18 级、目标 `target_dummy_tank`、装备 `item_3153` 破败、基础攻击。

结果：

- combatant 下拉只有英雄/假人，不出现 item；装备下拉恰好 53 件。
- source attributes：AD `99.95 + 40 = 139.95`；attack_speed `1.027138 + 0.25 = 1.277138`；新增 life_steal `0.1`。
- Compile 成功：session `generic-session-1`、revision 9、2 combatants、4 providers、2 abilities、55 types、22 formulas。
- Run 成功：`duration_reached`、warning 0、一次攻击造成 `139.95` 物理伤害，目标 5000 → 4860.05。
- Release 成功：`释放成功：generic-session-1`。
- 浏览器 warning/error 日志为空。

## 4. 结论与边界

Batch C 静态数据和 Web source loadout 已在通用 ABI 中闭环，可为后续装备机制提供真实初始属性。当前输出不包含破败当前生命值伤害、海妖第三击或鬼索 on-hit/幻影命中等被动。
