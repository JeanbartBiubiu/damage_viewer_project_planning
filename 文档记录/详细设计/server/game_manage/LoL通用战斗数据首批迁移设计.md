TASK_KEY: server-lol-generic-combat-bootstrap
DOC_TYPE: 详细设计
WORKSTREAM: server/game-manage
STATUS: done
EXECUTION_MODEL: cursor-grok-4.5-plus-codex-review
LAST_TRACKED_AT: 2026-07-12

# LoL 通用战斗数据首批迁移设计

本设计只负责建立可由当前 Web generic adapter 组装、并由 TinyGo V2 generic ABI 执行的首批数据闭环。通用表和接口契约见 [通用 1v1 战斗数据模型 DDL 与接口详细设计](./通用1v1战斗数据模型DDL与接口详细设计.md)。

## 1. 首批范围

数据源使用 `最小验证/V2-Batch-B-hero-passives.seed.json` 中已经回归过的基础数值：

- 攻击方：`hero_vayne`，一级 `hp=550`、`ad=60`、`attack_speed=0.658`、`armor=23`、`magic_resist=30`。
- 目标：`target_dummy_fighter`，`hp=3000`、`ad=0`、`attack_speed=0`、`armor=100`、`magic_resist=80`。
- 能力：一条通用主动普攻，通过 provider/formula/ability/phase/effect sequence/damage detail 表达。

首批不迁移 Vayne W、装备、等级成长、cost/cooldown、listener 或旧 `mechanicsConfig`。这些内容在基础 generic ABI 闭环稳定后按独立批次迁移。

## 2. 运行契约

当前 Web 走 `engine_compile → engine_run → engine_release_session` generic ABI，不使用 legacy `single_attacker_dps` 输入。

关键映射：

| 数据 | combat-data 表达 |
| --- | --- |
| Vayne / 战士假人 | `game_entities` |
| HP、AD、攻速、护甲、魔抗 | `entity_attribute_values` |
| 通用普攻所有者 | `provider_definitions` + `entity_provider_mounts` |
| 普攻伤害公式 | `provider_formulas.basic_attack_damage`，读取 `$owner.attr.ad` |
| 主动普攻 | `ability_definitions`，`ability_kind/active` |
| 生效阶段 | `ability_phases`，`ability_phase/impact` |
| 伤害操作 | `effect_sequences` + `effect_steps` + `damage_effect_details` |
| 阶段关联 | `ability_phase_effect_sequences` |

`hp` 必须写入 attribute。当前 generic runtime 从 `attributes["hp"]` 读取生命值，只写 resource 无法形成可执行快照。

实体不挂 `entity/champion` 或 `entity/target_dummy` type relation。当前 runtime matcher 不接受 `entity/*` domain；实体分类不属于首批执行必需数据。

## 3. Revision 与幂等策略

执行文件：`db/game_manage/seeds/lol_generic_combat_bootstrap_seed.sql`。

脚本行为：

1. 单事务执行并锁定 `game_data_state`。
2. 候选 revision 为锁定的 `current_revision + 1`。
3. 将兼容迁移遗留的 `attribute_definitions/types/type_relations.change_revision > current_revision` 归一到候选 revision，保证下一次 publish 能捕获基线。
4. 仅在业务数据插入、改变或精确清理无效 relation 时推进 revision。
5. 相同数据重复执行不推进 revision。
6. 不自动 publish；由 `POST /api/admin/games/lol/versions:publish` 发布。

## 4. 后续迁移顺序

1. 扩充 Batch B 的 6 ADC、3 个假人与等级属性。
2. 迁移 Vayne W，验证 listener/matcher/effect 组合。
3. 迁移 Batch C 的 ADC 成装静态属性。
4. 依次迁移破败、海妖、鬼索最终版本，再扩展其他已回归 Batch seed。
5. DDragon 全量英雄只迁移可靠的实体/属性；不能把未经人工确认的技能文本直接转换为可运行 effect。
