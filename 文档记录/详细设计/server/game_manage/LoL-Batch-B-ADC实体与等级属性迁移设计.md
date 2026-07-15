TASK_KEY: server-lol-batch-b-adc-entities
DOC_TYPE: 详细设计
WORKSTREAM: server/game-manage
STATUS: done
EXECUTION_MODEL: cursor-grok-4.5-plus-codex-review
LAST_TRACKED_AT: 2026-07-12

# LoL Batch-B ADC 实体与等级属性迁移设计

关联验证记录：[LoL-Batch-B-ADC 实体与等级属性迁移验证记录（2026-07-12）](../../../测试记录/server/game_manage/LoL-Batch-B-ADC实体与等级属性迁移验证记录-2026-07-12.md)。

本设计只负责把 `最小验证/V2-Batch-B-hero-passives.seed.json` 中的 6 个 ADC 与 3 个假人迁入当前 generic combat-data 表，并为每个 ADC 建立可运行的独立通用普攻闭环。首批基线见 [LoL 通用战斗数据首批迁移设计](./LoL通用战斗数据首批迁移设计.md)；表与接口契约见 [通用 1v1 战斗数据模型 DDL 与接口详细设计](./通用1v1战斗数据模型DDL与接口详细设计.md)。

## 1. 范围

实体：

| 类别 | entity_id |
| --- | --- |
| ADC | `hero_vayne`, `hero_teemo`, `hero_varus`, `hero_kaisa`, `hero_twitch`, `hero_kogmaw` |
| 假人 | `target_dummy_squishy`, `target_dummy_fighter`, `target_dummy_tank` |

写入内容：

1. `game_entities`：`display_name` / `description` 取自源 JSON 的 `name` / `title`。
2. `entity_attribute_values`：ADC 写入 13 项基础属性；假人写入源 JSON `baseStats` 的全部 10 项（不臆造缺失键）；合计 `6×13 + 3×10 = 108` 行。
3. `entity_attribute_stage_values`：仅 ADC；对 8 个成长属性写入 stage `1..18` 绝对值（`6×8×18 = 864`）。
4. 每个 ADC 一套独立普攻 provider / formula / ability / impact phase / effect sequence / damage step / detail / phase relation / entity mount。

## 2. 数据转换

ADC 基础属性（13）：`hp`, `ad`, `ap`, `attack_speed`, `attack_range`, `armor`, `magic_resist`, `mana`, `mana_regen`, `hp_regen`, `move_speed`, `crit_chance`, `crit_damage`。

假人基础属性（10，与源 JSON `baseStats` 一致）：`hp`, `ad`, `ap`, `attack_speed`, `armor`, `magic_resist`, `ability_haste`, `physical_pen`, `magic_pen`, `hp_regen`。

所需 `attribute_definitions` 并集（16）：上述 ADC 13 项，外加假人并集 `ability_haste`, `physical_pen`, `magic_pen`。缺失任一项即 `RAISE EXCEPTION` 回滚。

成长属性（8）：`hp`, `mana`, `ad`, `armor`, `magic_resist`, `hp_regen`, `mana_regen`, `attack_speed`。

绝对值公式：

```text
stage(level) = baseStats[attr] + statsByLevel[attr][level - 1]
```

约束：

1. `statsByLevel[attr][0] == 0`，因此 stage 1 等于 base。
2. 不迁移 `attack_speed_growth`，也不对攻速做二次成长叠加。
3. 源 JSON 中假人缺少的基础属性键不补写；源已给出的键（含值为 0）全部写入。

L18 防错锚点（绝对值）：

| 英雄 | hp | mana | ad | attack_speed |
| --- | --- | --- | --- | --- |
| Vayne | 2301 | 827 | 99.95 | 1.027138 |
| Teemo | 2383 | 759 | 105 | 1.086474 |
| Varus | 2385 | 1000 | 116.8 | 1.04951 |
| Kai'Sa | 2374 | 1025 | 103.2 | 0.841064 |
| Twitch | 2296 | 980 | 110 | 1.02529 |
| Kog'Maw | 2318 | 1005 | 113.7 | 0.964583 |

Vayne 额外核对：`armor=101.2`, `magic_resist=52.1`, `hp_regen=2.57`, `mana_regen=2.76`。

## 3. ID / 表契约

执行文件：`db/game_manage/seeds/lol_batch_b_adc_entities_seed.sql`（独立 seed，不并入首批 bootstrap）。

稳定 ID 规则（与首批一致）：

| 对象 | ID 模式 |
| --- | --- |
| provider | `provider_{entity_id}_basic_attack` |
| formula | `basic_attack_damage`，表达式读取 `$owner.attr.ad` |
| ability | `ability_{entity_id}_basic_attack`，`ability_kind/active` |
| phase | `phase_{entity_id}_basic_attack_impact`，`ability_phase/impact` |
| sequence | `sequence_{entity_id}_basic_attack_damage` |
| step | `step_{entity_id}_basic_attack_damage`，目标 `selector/opponent` |
| damage | `damage/physical` + `value_policy/add` |
| mount | `entity_provider_mounts` 挂到对应 ADC |

必需 reserved type：`20110/20111/20120/20130/20142/20150/20170/20220/20260`。缺失即 `RAISE EXCEPTION` 回滚；不伪造。

Revision：

1. 单事务；`game_id='lol'`；先 `ensure_game_partitions`，再 `FOR UPDATE` 锁 `game_data_state`。
2. `v_candidate = current_revision + 1`。
3. 业务表幂等 upsert；仅实际 INSERT/UPDATE 时置 `v_changed`；仅此时推进 `current_revision`。
4. relation/mount 使用带 `WHERE change_revision > v_locked_current` 的 `DO UPDATE`，避免越界 revision 永不过期，同时避免仅候选号漂移导致重复推进。
5. 不自动 publish。

## 4. 非目标

1. 不迁移 Vayne W 或任何英雄被动 listener/effect。
2. 不迁移装备、Batch C、破败、海妖、鬼索。
3. 不创建 `target_category='entity'` 的 type_relations，不恢复旧 `target_dummy` relation。
4. 不引用/恢复 legacy `public.heroes/items/skills`、`ownerCategories`、Bundle、Catalog 或 `single_attacker_dps`。
5. 不改 Java 业务代码、DDL、Web、Wasm、源 JSON、首批 seed/test/docs。
6. 不做 DELETE；不做首批那种越界 revision 三表清理。
7. 不执行 live DB 写入，不 publish，不提交 Git。

## 5. 验证步骤

离线静态契约：

```bash
cd server/data_manage
mvn -Dtest=LolBatchBAdcEntitiesSeedSqlTest test
```

治理索引：

```bash
node tools/task-governance/cli.mjs rebuild
node tools/task-governance/cli.mjs docs server-lol-batch-b-adc-entities
git diff --check
```

## 6. 发布边界

1. 先有首批 bootstrap（或等价基线），再执行本批 seed。
2. seed 只推进 `current_revision`，不调用 publish。
3. 需要对外可见时，由 Admin `POST /api/admin/games/lol/versions:publish` 发布。
4. 重复执行且数据无变化时，`current_revision` 不变。
