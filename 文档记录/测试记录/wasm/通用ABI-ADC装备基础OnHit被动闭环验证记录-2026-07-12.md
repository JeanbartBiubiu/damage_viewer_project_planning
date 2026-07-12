TASK_KEY: wasm-generic-adc-item-passives-base
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-12

# 通用 ABI ADC 装备基础 On-Hit 被动闭环验证记录

详细设计：[通用 ABI ADC 装备基础 On-Hit 被动闭环详细设计](../../详细设计/wasm/通用ABI-ADC装备基础OnHit被动闭环详细设计.md)

## 1. 自动化验证

| 模块 | 命令 | 结果 |
| --- | --- | --- |
| Backend | `mvn -Dtest=LolAdcItemOnHitPassivesSeedSqlTest test` | 通过，12 tests |
| Backend | `mvn test` | 通过，109 tests |
| Web | `npm run lint` | 通过 |
| Web | `npm run typecheck` | 通过 |
| Web | `npm run test -- --run` | 通过，7 files / 64 tests；assembler 25 tests |
| Web | `npm run build` | 通过；仅既有 large-chunk warning |

## 2. Live DB 迁移与发布

目标：PostgreSQL `test0221` / 用户 `postgres`，凭据脱敏。

rollback dry-run：

- 迁移前 current/published=`9/9`
- 事务内 current/published=`10/9`
- 事务内：3 providers、3 item mounts、3 listeners、6 basic-attack hit emits
- rollback 后 current/published 恢复 `9/9`
- 新增 provider/mount 归零；薇恩原有 1 个 emit 保留

正式执行与幂等重跑：

| 阶段 | current/published | providers | mounts | listeners | emits |
| --- | --- | ---: | ---: | ---: | ---: |
| 正式执行 | `10/9` | 3 | 3 | 3 | 6 |
| 原脚本重跑 | `10/9` | 3 | 3 | 3 | 6 |
| publish 后 | `10/10` | 3 | 3 | 3 | 6 |

发布版本：`lol-adc-item-on-hit-v1-20260712`，`changeRevision=10`。

Public API 回读：

- `provider_item_3124_guinsoos`
- `provider_item_3153_ruined_king`
- `provider_item_6672_kraken`
- 三条 item entity mount 与三条 listener 均存在

## 3. 浏览器联调

页面：`http://127.0.0.1:5173/#/wasm-validation-generic`

输入：

- source：`hero_vayne`，stage 18
- target：`target_dummy_tank`
- equipment：`item_3153`、`item_3124`、`item_6672`
- ability：基础攻击
- repeat interval：1000 ms
- max repeats：3

装配与编译：

- revision / rulesHash：`10 / rev:10`
- source AD：`99.95 + 40 + 30 + 45 = 214.95`
- source AP：30
- compile 成功：`generic-session-1`
- metadata：2 combatants、10 providers、2 abilities、56 types、48 compiled formulas

运行结果：

- `duration_reached`
- warning：0
- 3 次 ability attempt / 3 次 cast / 0 skip
- 3 条 `event/basic_attack_hit` evidence，时间 0 / 1000 / 2000 ms
- 目标 HP：5000 → 3063.578
- source total damage：1936.422
- 第一次攻击累计伤害：532.053，等于基础攻击 214.95 + 破败 post-hit current HP 6%（287.103）+ 鬼索 30
- compile / run / release 均成功
- 浏览器 warn/error 日志为空

## 4. 结论与残余风险

三件装备的基础 provider 已完成数据迁移、source loadout 投影与通用 ABI 运行闭环；六个 Batch B ADC 均拥有统一普攻命中事件。

本记录不证明 gameplay parity：

1. 破败和海妖读取基础普攻伤害之后的 HP，不是 legacy `attack_start` 快照。
2. generic physical/magic damage 当前未应用护甲/魔抗；本次数值是 raw damage。
3. 鬼索只完成固定 30 魔法 on-hit，未实现叠攻速和 phantom hit。

后续先补 event snapshot 与 generic resistance pipeline，再做完整鬼索与组合级精确回归。
