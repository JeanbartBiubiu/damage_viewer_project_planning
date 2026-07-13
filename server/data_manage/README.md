# Damage Viewer Backend

`server/data_manage` 是 Damage Viewer 的 Java / Spring Boot 后端，负责游戏元数据、版本发布元数据、图片资源，以及通用 1v1 `combat-data` 结构化读写。

它在整条链路里的位置是：

1. 从 `db/**` 定义的 PostgreSQL 结构中读取和写入最新战斗数据主表，并在发布时把变化行写入对应 `_log`。
2. 对外提供 `games`、`current version`、`images`、`/combat-data/**` 公共读取接口。
3. 对内提供 Admin `combat-data` PUT、`images` PUT、`versions:publish`。
4. 不组装 Bundle / Wasm Catalog，不提供 owner-categories 或旧 hero/item/skill/status 专用资源接口。

## 开发范围

这个模块默认主写入范围：

- `server/data_manage/**`
- `db/**`
- `接口/**`
- 与后端直接相关的 `tools/**`

默认只读参考：

- `web/**`
- `wasm/**`
- `文档记录/**` 中与后端直接相关的设计说明

## 当前主要入口

- 启动入口：`src/main/java/xyz/game/datamanage/DataManageApplication.java`
- 默认配置：`src/main/resources/application.yml`
- 公共读取控制器：`src/main/java/xyz/game/datamanage/controller/publicapi/**`
- Admin 控制器：`src/main/java/xyz/game/datamanage/controller/adminapi/**`
- 薄 Facade：`src/main/java/xyz/game/datamanage/service/GameDataService.java`（games / current version / images）
- combat-data 读写与发布：`src/main/java/xyz/game/datamanage/service/combatdata/**`
- 启动依赖探测：`src/main/java/xyz/game/datamanage/config/StartupDependencyVerifier.java`

当前接口契约索引见 [接口定义](../../文档记录/详细设计/server/game_manage/接口定义.md)；DDL 与资源契约真源见 [通用 1v1 战斗数据模型 DDL 与接口详细设计](../../文档记录/详细设计/server/game_manage/通用1v1战斗数据模型DDL与接口详细设计.md)。

如果你是 agent 或首次进入当前目录，先读同目录的 `AGENTS.md`，再开始修改。

## 本地开发

### 前置要求

- JDK `21`
- Maven `3.9+`
- PostgreSQL
- Redis

默认端口沿用 Spring Boot 默认值：`8080`。

### 常用命令

| 命令 | 用途 | 备注 |
| --- | --- | --- |
| `mvn spring-boot:run` | 启动本地开发服务 | 默认读取 `src/main/resources/application.yml` |
| `mvn test` | 运行测试与基础回归 | 改 `controller/service/mapper/support` 时默认至少执行 |
| `mvn package` | 打包校验 | 改 `pom.xml`、配置、依赖或发布链时建议执行 |

### SQL 初始化与兼容迁移

**新库（fresh install）**：

1. `db/game_manage/schema.sql`
2. `db/game_manage/triggers.sql`
3. `db/game_manage/seeds/reserved_types_seed.sql`

三者覆盖当前基线 DDL、分区自动化与 reserved type 种子；不要把 `migrations/**` 当作新库必跑步骤。

**已有库（generic combat-data 切换）**：按顺序执行：

1. `db/game_manage/migrations/compatibility/generic_combat_data_model_compatibility_migration.sql`
2. `db/game_manage/triggers.sql`（刷新 `ensure_game_partitions`、effect-detail 约束与 state backfill）
3. `db/game_manage/migrations/compatibility/generic_combat_data_model_final_drop_legacy_tables_migration.sql`
4. `db/game_manage/seeds/reserved_types_seed.sql`

说明：`CREATE TABLE IF NOT EXISTS` 可创建缺失表，但不会改动已存在表的列类型、约束或索引；已有 schema 仍须执行上述显式兼容迁移。DROP migration 无 `CASCADE`；遇到未知依赖会安全回滚。最终 DROP 成功后建议再跑一次 `triggers.sql` 刷新分区清单。

更早的局部兼容迁移（如 `version_code_varchar64_compatibility_migration.sql`）仅在尚未完成 generic 切换的旧库上按需执行。

### Guinsoo H+K 数据库合同（provider state / copyable / repeat）

在 generic combat-data 基线已就绪的库上，为完整 Guinsoo H+K（状态字段上限与时长、伤害 `copyable_on_hit`、第十种 `repeat_effect_details`）补齐合同：

**新库**：`schema.sql` + `triggers.sql` + `reserved_types_seed.sql` 已包含上述列/表/分区/exactly-one 清单与 reserved（`20161` `operation/repeat`、`10025` `repeat_scope`、`20263` `repeat_scope/copyable_on_hit`；状态刷新复用既有 `20190`）。

**已有库**：按顺序执行：

1. `db/game_manage/migrations/compatibility/generic_guinsoo_hk_compatibility_migration.sql`（幂等：`ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`；不 DELETE / DROP / CASCADE）
2. `db/game_manage/triggers.sql`（刷新 `ensure_game_partitions` 与 effect-step exactly-one-detail，使 `repeat_effect_details` 进入分区与约束清单）
3. `db/game_manage/seeds/reserved_types_seed.sql`

说明：状态层到期用 `provider_state_fields.duration_ms` / `refresh_policy_type_id`（可空，兼容旧行）；**不要**用 `provider_lifecycles` 表达 stack 到期。`repeat_effect_details.threshold` 为 `numeric`（与 Wasm float64 合同一致）。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=GenericGuinsooHkDbContractSqlTest test
```

### LoL Guinsoo H+K 升级 seed（叠攻速 / 时长 / phantom copyable-on-hit）

在 Guinsoo H+K DDL 合同已就绪，且 `lol_adc_item_on_hit_passives_seed.sql`（`provider_item_3124_guinsoos`）与 `lol_formula_on_hit_mechanisms_seed.sql`（破败 / 纳什 / 界弓伤害行）已写入后，本批按顺序执行：

1. `db/game_manage/migrations/compatibility/generic_guinsoo_hk_compatibility_migration.sql`（若已有库尚未补齐合同）
2. `db/game_manage/triggers.sql`
3. `db/game_manage/seeds/reserved_types_seed.sql`
4. `db/game_manage/seeds/lol_guinsoo_hk_seed.sql`
5. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

该 seed 会：单事务锁定 `game_data_state`；复用既有 `provider_item_3124_guinsoos`（不重建 provider）；写入 `guinsoos_seething_strike` 状态（`max_value=4` / `duration_ms=3000` / `refresh_policy/refresh_duration`）；每层 `+8%` `attack_speed` percent_add；满层 `repeat(copyable_on_hit)` phantom hit；仅将鬼索 / 破败 / 纳什 / 界弓四条 on-hit 伤害标为 `copyable_on_hit`。有 material change 时才推进候选 revision；不 DELETE、不自动 publish。

当前 live 基线迁移预期（非 SQL 硬编码规则）：首次执行 `current/published` 自 `12/12` → `13/12`；无变化重跑保持 `13/12`。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGuinsooHkSeedSqlTest test
```

### LoL generic 基线 seed（Vayne + 战士假人 + 普攻）

在 reserved types 与所需 `attribute_definitions`（至少 `hp` / `ad` / `attack_speed` / `armor` / `magic_resist`）已就绪后，可重复执行：

1. `db/game_manage/seeds/lol_generic_combat_bootstrap_seed.sql`
2. Admin `POST /api/admin/games/lol/versions:publish`（脚本**不会**自动 publish）

该 seed 会：锁定 `game_data_state`；将 `attribute_definitions` / `types` / `type_relations` 中越界 `change_revision` 归一到本次候选 revision；幂等写入 `hero_vayne`、`target_dummy_fighter` 与 `basic_attack` 普攻闭环；并精确卸下 v1 挂到上述实体的 `entity/*` type_relations（不兼容当前 matcher domain；不删 types 行）。重复执行且数据无变化时不会无意义推进 `current_revision`。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericCombatBootstrapSeedSqlTest test
```

### LoL Batch-B ADC 实体与等级属性 seed

在首批 bootstrap（或等价基线）已存在，且 reserved types 与所需 16 个 `attribute_definitions`（ADC 13：`hp` / `ad` / `ap` / `attack_speed` / `attack_range` / `armor` / `magic_resist` / `mana` / `mana_regen` / `hp_regen` / `move_speed` / `crit_chance` / `crit_damage`；假人并集另 3：`ability_haste` / `physical_pen` / `magic_pen`）已就绪后，按顺序执行：

1. `db/game_manage/seeds/lol_generic_combat_bootstrap_seed.sql`（若基线尚未写入）
2. `db/game_manage/seeds/lol_batch_b_adc_entities_seed.sql`
3. Admin `POST /api/admin/games/lol/versions:publish`（本批脚本**不会**自动 publish）

该 seed 会：锁定 `game_data_state`；幂等写入 6 个 ADC + 3 个假人、ADC 的 13 项基础属性与 8×18 stage 绝对值、假人的 10 项源 `baseStats`（合计基础属性 108 行），以及每个 ADC 独立的通用普攻闭环；假人不挂 provider。重复执行且数据无变化时不会推进 `current_revision`。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolBatchBAdcEntitiesSeedSqlTest test
```

### LoL Vayne Silver Bolts（W）listener / effect-graph seed

在 reserved types 与 Batch-B（或等价）薇恩普攻闭环已就绪后，按顺序执行：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20211`/`20212`/`20213`/`20252`）
2. `db/game_manage/seeds/lol_batch_b_adc_entities_seed.sql`（若 Batch-B 尚未写入）
3. `db/game_manage/seeds/lol_vayne_silver_bolts_seed.sql`
4. Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

该 seed 会：锁定 `game_data_state`；幂等投影所需 reserved → `types`；在既有 `sequence_hero_vayne_basic_attack_damage` 伤害步骤后追加 `emit_event`（`event/basic_attack_hit`）；挂载独立 `provider_hero_vayne_silver_bolts`（不替换普攻 provider），并写入 `silver_bolts_hits` 状态、listener ALL matcher、三步结算序列。重复执行且数据无变化时不会推进 `current_revision`。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolVayneSilverBoltsSeedSqlTest test
```

### LoL Batch-C ADC 成品装备 seed

在 `public.games` 已有 `game_id=lol`，且源 JSON 用到的 16 个 `attribute_definitions`（`ad` / `ap` / `hp` / `mana` / `armor` / `magic_resist` / `ability_haste` / `attack_speed` / `crit_chance` / `crit_damage` / `life_steal` / `omnivamp` / `armor_pen_flat` / `armor_pen_percent` / `ms_pct` / `tenacity`）已就绪后，按顺序执行：

1. `db/game_manage/seeds/lol_generic_combat_bootstrap_seed.sql`（若基线尚未写入）
2. `db/game_manage/seeds/lol_batch_c_adc_items_seed.sql`
3. Admin `POST /api/admin/games/lol/versions:publish`（本批脚本**不会**自动 publish）

该 seed 会：锁定 `game_data_state`；幂等写入 53 个 `item_<id>` 实体、151 行非零 `entity_attribute_values`，以及 game-local tag `type_id=62002` / `type_key=tag/adc_completed_item` 到 `target_category=entity` 的 53 条 `type_relations`（`reserved_type_id=NULL`）。兼容 live placeholder：若已存在 `type_key=type/62002` 且 `reserved_type_id IS NULL`、name 为 `adc_completed_item`/`ADC completed item`，经正常 upsert 升级为最终 key；写入前仅删除 `type_id=62002` + `target_category=equipment` + 精确 53 个源数字 `target_id` 的 legacy 关系（删除计为 material change）。重复执行且数据无变化时不会再 DELETE，也不会推进 `current_revision`。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolBatchCAdcItemsSeedSqlTest test
```

### LoL ADC 装备 on-hit 被动 seed（破败 / 海妖 / 鬼索首批）

在 reserved types、Batch-B 六 ADC 普攻闭环与 Batch-C 三件装备实体已就绪后，按顺序执行：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20211`/`20212`/`20220`/`20221`/`20252` 等）
2. `db/game_manage/seeds/lol_batch_b_adc_entities_seed.sql`（若 Batch-B 尚未写入）
3. `db/game_manage/seeds/lol_batch_c_adc_items_seed.sql`（若 Batch-C 尚未写入）
4. （可选）`db/game_manage/seeds/lol_vayne_silver_bolts_seed.sql` — 与本 seed 共用薇恩 `emit_event` 稳定 ID，顺序可互换，幂等 upsert
5. `db/game_manage/seeds/lol_adc_item_on_hit_passives_seed.sql`
6. Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

该 seed 会：锁定 `game_data_state`；幂等投影所需 reserved → `types`；为六个 ADC 的 `sequence_hero_*_basic_attack_damage` 在伤害步骤后追加唯一 `emit_event(event/basic_attack_hit)`（`step_order=1`；薇恩同名行幂等）；分别向 `item_3153` / `item_6672` / `item_3124` mount 独立 passive provider，并写入 ALL matcher（`20211`+`20212`）listener 与 effect 图。

机制边界：

- 破败：`event.entry_target.attr.hp.current * 0.06` 物理伤害（父 execution frame 入口快照 / 基础普攻伤害前）。
- 海妖：`provider_target` 计数（缺省 0）；每第 3 次 `120 * (1 + clamp(missingHpRatio,0..1) * 0.75)` 物理伤害后重置；`missingHpRatio=(maxHP-currentHP)/max(maxHP,1)`，max/current 均读 `event.entry_target.attr.hp.*`（入口快照 / 基础普攻伤害前）。
- 鬼索首批：固定 30 魔法伤害；**不含**叠攻速、持续时间、满层或 phantom hit。
- 不 DELETE、不自动 publish、不写 legacy item/skill / Bundle / Catalog。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolAdcItemOnHitPassivesSeedSqlTest test
```

### LoL generic-formula on-hit 六机制 batch seed

在 reserved types、Batch-B（含 `hero_teemo` / `hero_kogmaw`）、Batch-C（含 `item_3115` / `item_3302` / `item_3181` / `item_3748`），以及 teemo/kogmaw 普攻 `emit_event(event/basic_attack_hit)` 已就绪后，按顺序执行：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20211`/`20212`/`20220`/`20221`/`20252` 等）
2. `db/game_manage/seeds/lol_batch_b_adc_entities_seed.sql`（若 Batch-B 尚未写入）
3. `db/game_manage/seeds/lol_batch_c_adc_items_seed.sql`（若 Batch-C 尚未写入）
4. `db/game_manage/seeds/lol_adc_item_on_hit_passives_seed.sql`（或等价 teemo/kogmaw basic_attack_hit emit）
5. `db/game_manage/seeds/lol_formula_on_hit_mechanisms_seed.sql`
6. Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

该 seed 会：锁定 `game_data_state`；幂等投影所需 reserved → `types`；分别向 `hero_kogmaw` / `hero_teemo` / `item_3115` / `item_3302` / `item_3181` / `item_3748` mount 六个独立 passive provider；统一 ALL matcher（`20211`+`20212`）、`max_triggers_per_event=1`，经 `listener_effect_sequences` 运行各自 effect 图。英雄 provider 不挂装备，装备 provider 不挂英雄；Kog/Teemo 以 always-on passive 表达，不新建 dedicated ability/phase。预计 fresh write 约 68 业务行（6 provider / 6 mount / 6 listener / 12 matcher / 6 sequence / 8 step / 1 state field / 9 formula 为核心计数）。重复执行且数据无变化时不会推进 `current_revision`。

机制边界：

- 克格莫 W 预开启 rank5 baseline：`event.entry_target.attr.hp.max * 0.06` 魔法；**不含**主动开启、8 秒到期、射程。
- 提莫 E rank5 即时：固定 65 魔法；**不含** DoT / tick / refresh / AP 系数。
- 纳什：`15 + event.entry_source.attr.ap.resolved * 0.15` 魔法。
- 界弓：固定 30 魔法；**不含**光暗交替、双抗、穿透。
- 破舰者远程近似：`provider_target` 计数 `hullbreaker_hits`（缺省 0）；每第 5 次 `ad.base * 0.84 + hp.max * 0.035` 物理后重置。`0.84` / `0.035` 为补充远程近似：**DataDragon 16.9.1 未提供该数值，不宣称版本精确**。
- 巨型九头蛇远程主目标：`event.entry_source.attr.hp.max * 0.005` 物理；**不含**后方锥形 AOE、主动刚斩。`0.005` 同上为补充远程近似，不宣称版本精确。
- live formula 只使用 `ad` / `ap` / `hp` 词根；不出现 `attack_damage`、`ability_power`、`ability.param`。
- 不 DELETE、不自动 publish、不写 legacy Bundle / Catalog / skill 表。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolFormulaOnHitMechanismsSeedSqlTest test
```

### LoL generic Spellblade seed（三相之力 item_3078）

在 reserved types、Batch-B 六 ADC 普攻 abilities、Batch-C `item_3078`，以及 basic_attack_hit emit 基线（`lol_adc_item_on_hit_passives_seed.sql` 或等价）已就绪后，按顺序执行：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20205`/`20211`/`20212`/`20220`/`20250`/`20190` 等）
2. `db/game_manage/seeds/lol_batch_b_adc_entities_seed.sql`（若 Batch-B 尚未写入）
3. `db/game_manage/seeds/lol_batch_c_adc_items_seed.sql`（若 Batch-C / `item_3078` 尚未写入）
4. `db/game_manage/seeds/lol_adc_item_on_hit_passives_seed.sql`（或等价 six-ADC `event/basic_attack_hit` emit）
5. `db/game_manage/seeds/lol_generic_spellblade_seed.sql`
6. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-spellblade-v1-20260713`（seed 不负责 publish）。

该 seed 会：锁定 `game_data_state`；幂等投影所需 reserved → `types`；写入 game-local `type_id=62003` / `type_key=ability/basic_attack`（`reserved_type_id=NULL`）并精确关联六个 ADC basic attack abilities；挂载最小 `provider_hero_vayne_tumble` / `ability_hero_vayne_tumble`（`ability_key=tumble`，active `20130`，不含完整 Q）；向 `item_3078` mount `provider_item_3078_spellblade`，含 `spellblade_ready`（10s）/ `spellblade_icd`（1.5s）、ability_started 武装 listener 与 basic_attack_hit 触发 listener（`2 * event.entry_source.attr.ad.base` 物理，`copyable_on_hit=false`）。有 material change 时才推进候选 revision；不 DELETE、不自动 publish。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericSpellbladeSeedSqlTest test
```

### LoL generic Lich Bane Spellblade seed（巫妖之祸 item_3100）

在 reserved types、Batch-B `hero_vayne`、Batch-C `item_3100`、`lol_generic_spellblade_seed.sql`（game-local `ability/basic_attack` + `ability_hero_vayne_tumble`）、以及 basic_attack_hit emit 基线已就绪后，按顺序执行：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20205`/`20211`/`20212`/`20221`/`20173`/`20190`/`20250` 等）
2. `db/game_manage/seeds/lol_batch_b_adc_entities_seed.sql`（若 Batch-B / `hero_vayne` 尚未写入）
3. `db/game_manage/seeds/lol_batch_c_adc_items_seed.sql`（若 Batch-C / `item_3100` 尚未写入）
4. `db/game_manage/seeds/lol_adc_item_on_hit_passives_seed.sql`（或等价 `event/basic_attack_hit` emit）
5. `db/game_manage/seeds/lol_generic_spellblade_seed.sql`（前置：`62003` / tumble）
6. `db/game_manage/seeds/lol_generic_lich_bane_spellblade_seed.sql`
7. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-lich-bane-spellblade-v1-20260713`（seed 不负责 publish）。

该 seed 会：锁定 `game_data_state`；校验 `item_3100` / `hero_vayne` / `ability_hero_vayne_tumble` / `ability/basic_attack` relation / `ad`·`ap`·`attack_speed`；幂等投影所需 reserved → `types`；向 `item_3100` mount `provider_item_3100_lich_bane_spellblade`，含 `spellblade_ready`（10s）/ `spellblade_icd`（1.5s）、ability_started 武装 listener、basic_attack_hit 触发 listener（`0.75 * event.entry_source.attr.ad.base + 0.45 * event.entry_source.attr.ap.resolved` 魔法，`copyable_on_hit=false`，顺序对齐 3078）、以及 `0.5 * provider.state.spellblade_ready` 的 `attack_speed` percent_add modifier。有 material change 时才推进候选 revision；不 DELETE、不自动 publish。数值注释引用 `damage_wasm_dev` 下 `current-items.normalized.json` item 3100，无运行时外部依赖。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericLichBaneSpellbladeSeedSqlTest test
```

### LoL generic Essence Reaver Spellblade seed（夺萃之镰 item_3508）

在 reserved types、Batch-C `item_3508`（静态 `ad=50` / `crit_chance=0.25`）、以及 basic_attack_hit emit 基线已就绪后，按顺序执行（不依赖 `hero_vayne` / tumble / `ability/basic_attack` / `lol_generic_spellblade_seed.sql`）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20205`/`20211`/`20212`/`20220`/`20190`/`20250` 等）
2. `db/game_manage/seeds/lol_batch_c_adc_items_seed.sql`（若 Batch-C / `item_3508` 尚未写入）
3. `db/game_manage/seeds/lol_adc_item_on_hit_passives_seed.sql`（或等价 `event/basic_attack_hit` emit）
4. `db/game_manage/seeds/lol_generic_essence_reaver_spellblade_seed.sql`
5. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-essence-reaver-spellblade-v1-20260713`（seed 不负责 publish）。

该 seed 会：锁定 `game_data_state`；校验 `item_3508` 及其静态 `ad=50` / `crit_chance=0.25` 与 `ad`·`crit_chance` attribute_definitions；幂等投影所需 reserved → `types`；向 `item_3508` mount `provider_item_3508_essence_reaver_spellblade`，只监听已存在的 `ability_started` / `basic_attack_hit` / `source_owner` 事件；含 `spellblade_ready`（10s）/ `spellblade_icd`（1.5s）、ability_started 武装 listener（`mul(eq(ready,0), eq(icd,0))` 数值门控，仅武装 ready，**不**在武装时开 ICD）、basic_attack_hit 触发 listener（`1.25 * event.entry_source.attr.ad.base + 50 * event.entry_source.attr.crit_chance.resolved` 物理，`copyable_on_hit=false`，顺序：damage → arm icd → consume ready，ICD 以强化攻击消耗时开始）。不实现 mana restore。有 material change 时才推进候选 revision；不 DELETE、不自动 publish。数值注释引用 `damage_wasm_dev` 下 `current-items.normalized.json` item 3508，无运行时外部依赖。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericEssenceReaverSpellbladeSeedSqlTest test
```

### LoL generic Dusk and Dawn Spellblade seed（黄昏与黎明 item_2510）

在 reserved types、Batch-C `item_2510`（静态 `ap=60` / `hp=300` 为既有输入）、以及 basic_attack_hit emit 基线已就绪后，按顺序执行（不依赖 `hero_vayne` / tumble / `ability/basic_attack` / `lol_generic_spellblade_seed.sql` / `item_3100` / `item_3508`；本脚本不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20205`/`20211`/`20212`/`20221`/`20190`/`20250` 等）
2. `db/game_manage/seeds/lol_batch_c_adc_items_seed.sql`（若 Batch-C / `item_2510` 尚未写入）
3. `db/game_manage/seeds/lol_adc_item_on_hit_passives_seed.sql`（或等价 `event/basic_attack_hit` emit）
4. `db/game_manage/seeds/lol_generic_dusk_and_dawn_spellblade_seed.sql`

该 seed 会：锁定 `game_data_state`；校验 `item_2510` 及其静态 `ap=60` / `hp=300` 与 `ad`·`ap` attribute_definitions（不 mutate/recreate Batch-C）；幂等投影所需 reserved → `types`；向 `item_2510` 独占 mount `provider_item_2510_dusk_and_dawn_spellblade`，只监听已存在的 `ability_started` / `basic_attack_hit` / `source_owner` 事件；含 `spellblade_ready`（10s）/ `spellblade_icd`（1.5s）、ability_started 武装 listener（`mul(eq(ready,0), eq(icd,0))` 数值门控，仅武装 ready，**不**在武装时开 ICD）、basic_attack_hit 触发 listener（`0.75 * event.entry_source.attr.ad.base + 0.10 * event.entry_source.attr.ap.resolved` 魔法 `20221`，`copyable_on_hit=false`，顺序：damage → arm icd → consume ready，ICD 以强化攻击消耗时开始）。**排除**：healing（0.10 AP + 0.03 bonus HP）、0.2s 延迟二次 on-hit、delayed/repeat/resource、provider_modifiers、Vayne/tumble/62003/generic-spellblade 依赖。有 material change 时才推进候选 revision；不 DELETE。数值注释引用 `damage_wasm_dev` 下 `current-items.normalized.json` item 2510，无运行时外部依赖。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericDuskAndDawnSpellbladeSeedSqlTest test
```

### LoL generic Energized seed（疾射火炮 item_3094）

在 reserved types、Batch-C `item_3094`，以及 basic_attack_hit emit 基线（`lol_adc_item_on_hit_passives_seed.sql` 或等价）已就绪后，按顺序执行：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20211`/`20212`/`20221`/`20250` 等）
2. `db/game_manage/seeds/lol_batch_c_adc_items_seed.sql`（若 Batch-C / `item_3094` 尚未写入）
3. `db/game_manage/seeds/lol_adc_item_on_hit_passives_seed.sql`（或等价 `event/basic_attack_hit` emit）
4. `db/game_manage/seeds/lol_generic_energized_seed.sql`
5. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-energized-v1-20260713`（seed 不负责 publish）。

该 seed 会：锁定 `game_data_state`；幂等投影所需 reserved → `types`；向 `item_3094` mount `provider_item_3094_energized`，含无时长 `energized_charge`（max=100）、单 `basic_attack_hit` listener 与单 sequence（ready 时 40 魔法伤害且 `copyable_on_hit=false` → override 消费为 0 → 无条件 add 25）。有 material change 时才推进候选 revision；不 DELETE、不自动 publish。不含移动/距离充能、射程、多目标弹射、slow、共享池。

live revision 预期（非 SQL 硬编码）：首跑 `current/published` 自 `14/14` → `15/14`；幂等重跑保持 `15/14`；显式 publish 后 `15/15`。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericEnergizedSeedSqlTest test
```

### LoL generic Statikk Shiv Energized seed（斯塔缇克电刃 item_3087）

独立于 `item_3094` 疾射火炮 seed：仅表达当前 generic ABI 可写的**单目标** Energized 行为。在 reserved types、Batch-C `item_3087`，以及 basic_attack_hit emit 基线已就绪后，按顺序执行：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20211`/`20212`/`20221`/`20250` 等）
2. `db/game_manage/seeds/lol_batch_c_adc_items_seed.sql`（若 Batch-C / `item_3087` 尚未写入）
3. `db/game_manage/seeds/lol_adc_item_on_hit_passives_seed.sql`（或等价 `event/basic_attack_hit` emit）
4. `db/game_manage/seeds/lol_generic_statikk_shiv_energized_seed.sql`
5. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-statikk-shiv-energized-v1-20260714`（seed 不负责 publish）。

该 seed 会：锁定 `game_data_state`；幂等投影所需 reserved → `types`；向 `item_3087` mount `provider_item_3087_statikk_shiv_energized`，含无时长 `energized_charge`（numeric，max/cap=100；schema 无 default 列，不发明初始值，runtime/测试可自行置 100 以测 ready）；单 `basic_attack_hit` + `source_owner` ALL listener（`max_triggers_per_event=1`）与单 sequence：ready 时 60 魔法伤害且 `copyable_on_hit=false` → override 消费为 0 → 无条件 add 15（由 max 钳制到 100）。有 material change 时才推进候选 revision；不 DELETE、不自动 publish。

**合同范围外（本 seed 明确不建模）**：移动/距离充能、非英雄 90 伤害、弹射/次级 on-hit、slow、共享 Energize 池、live migration、publish。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericStatikkShivEnergizedSeedSqlTest test
```

### Execute Threshold 数据库合同（execute_effect_details）

在 generic combat-data 基线已就绪的库上，为斩杀阈值（第十一 detail 族 `execute_effect_details`）补齐合同：

**新库**：`schema.sql` + `triggers.sql` + `reserved_types_seed.sql` 已包含上述表/分区/exactly-one 清单与 reserved（`20162` `operation/execute_threshold`，归属 operation `10015`）。

**已有库**：按顺序执行：

1. `db/game_manage/migrations/compatibility/generic_execute_threshold_compatibility_migration.sql`（幂等：`CREATE TABLE IF NOT EXISTS`；不 DELETE / DROP / CASCADE）
2. `db/game_manage/triggers.sql`（刷新 `ensure_game_partitions` 与 effect-step exactly-one-detail，使 `execute_effect_details` 进入分区与约束清单）
3. `db/game_manage/seeds/reserved_types_seed.sql`
4. `db/game_manage/seeds/lol_generic_execute_threshold_seed.sql`
5. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

说明：`execute_effect_details.threshold` 为 `numeric`，约束 `> 0 AND <= 1`（当前血量比例）。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=GenericExecuteThresholdDbContractSqlTest,LolGenericExecuteThresholdSeedSqlTest test
```

### LoL generic Execute Threshold seed（收集者 item_6676）

在 Execute Threshold DDL 合同、reserved types（含 `20162`）、Batch-C `item_6676`，以及 basic_attack_hit emit 基线已就绪后，按上节顺序执行 compatibility migration → triggers → reserved seed → execute seed → 显式 publish。

建议发布版本：`lol-generic-execute-v1-20260713`（seed 不负责 publish）。

该 seed 会：锁定 `game_data_state`；幂等投影所需 reserved → `types`；向 `item_6676` mount `provider_item_6676_collector_execute`，含单 `basic_attack_hit` + `source_owner` ALL listener、单 sequence、单 `operation/execute_threshold`（`20162`）对手目标 step，`execute_effect_details.threshold=0.05`。有 material change 时才推进候选 revision；不 DELETE、不自动 publish。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericExecuteThresholdSeedSqlTest test
```

### LoL generic Linked Effects seed（黑色切割者 item_3071 Carve）

在 reserved types（含 `20214`/`20215`）、Batch-C `item_3071`、`attribute_definitions.armor`，以及既有 attribute/state detail 合同已就绪后，按顺序执行：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20200`/`20212`/`20214`/`20215`/`20153`/`20160`/`20122`/`20252` 等）
2. `db/game_manage/seeds/lol_batch_c_adc_items_seed.sql`（若 Batch-C / `item_3071` 尚未写入）
3. `db/game_manage/seeds/lol_generic_linked_effects_seed.sql`
4. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-linked-effects-v1-20260713`（seed 不负责 publish）。

该 seed 会：锁定 `game_data_state`；幂等投影所需 reserved → `types`；向 `item_3071` mount `provider_item_3071_black_cleaver_carve`（equipment `20122`），含单 `damage_dealt` listener（ALL matcher：`20200`/`20214`/`20215`/`20212`，`max_triggers_per_event=1`）、单 sequence、两步固定顺序（`attribute_change` 目标 `armor` 常量 `-4` → `state_change` `provider_target`/`carve_stacks` 常量 `+1`），共用 condition `provider.target_state.carve_stacks < 5`。不写 `provider_state_fields` / `provider_modifiers`，不改 `item_3071` 静态属性或 `adc_completed_item` tag。有 material change 时才推进候选 revision；不 DELETE、不自动 publish。

live revision 预期（非 SQL 硬编码）：首跑 `current/published` 自 `16/16` → `17/16`；幂等重跑保持 `17/16`；显式 publish `lol-generic-linked-effects-v1-20260713` 后 `17/17`。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericLinkedEffectsSeedSqlTest test
```

### LoL generic Yun Tal Practice Makes Lethal seed（item_3032）

在 reserved types、Batch-C `item_3032`（静态 `ad=50` / `attack_speed=0.4`，本脚本不改）、`attribute_definitions.crit_chance`，以及 `basic_attack_hit` emit 基线已就绪后，按顺序执行：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20100`/`20110`/`20120`/`20160`/`20170`/`20181`/`20211`/`20212`/`20250`）
2. `db/game_manage/seeds/lol_batch_c_adc_items_seed.sql`（若 Batch-C / `item_3032` 尚未写入）
3. `db/game_manage/seeds/lol_adc_item_on_hit_passives_seed.sql`（或等价 `event/basic_attack_hit` emit）
4. `db/game_manage/seeds/lol_generic_yun_tal_practice_makes_lethal_seed.sql`
5. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-yun-tal-practice-makes-lethal-v1-20260714`（seed 不负责 publish）。

该 seed 会：锁定 `game_data_state`；校验 `item_3032` 与 `crit_chance`；幂等投影所需 reserved → `types`；向 `item_3032` 独占 mount `provider_item_3032_yun_tal_practice_makes_lethal`，含单 `basic_attack_hit` + `source_owner` ALL listener、单 sequence、单 capped `state_change` 叠层（`practice_crit_stacks` max 63、untimed、`const 1` + add policy）、以及 `crit_chance` add modifier，公式 AST 为 `min(0.25, mul(0.004, provider.state.practice_crit_stacks))`。不写 `game_entities` / `entity_attribute_values`，不给 `item_3032` 增加静态暴击。有 material change 时才推进候选 revision；不 DELETE、不自动 publish。

**排除**：Flurry / 疾风骤雨（30% 攻速、6s/30s 冷却与命中/暴击减 CD）、`event/basic_attack_started`、随机暴击事件、以及 attack_speed / cooldown 机制面。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericYunTalPracticeMakesLethalSeedSqlTest test
```

### LoL generic Wit's End Fray seed（智慧末刃 item_3091）

在 reserved types、Batch-C `item_3091`（静态 `attack_speed=0.5` / `magic_resist=45` / `tenacity=0.2`，本脚本不改）、`damage_effect_details.copyable_on_hit` 列已存在，以及 `basic_attack_hit` emit 基线已就绪后，按顺序执行：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20150`/`20170`/`20181`/`20211`/`20212`/`20221`）
2. `db/game_manage/seeds/lol_batch_c_adc_items_seed.sql`（若 Batch-C / `item_3091` 尚未写入）
3. `db/game_manage/seeds/lol_adc_item_on_hit_passives_seed.sql`（或等价 `event/basic_attack_hit` emit）
4. `db/game_manage/seeds/lol_generic_wits_end_fray_seed.sql`
5. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-wits-end-fray-v1-20260714`（seed 不负责 publish）。

该 seed 会：锁定 `game_data_state`；校验 `item_3091` 与所需 reserved types；幂等投影所需 reserved → `types`；向 `item_3091` 独占 mount `provider_item_3091_wits_end_fray`，含单 `basic_attack_hit` + `source_owner` ALL listener（`max_triggers_per_event=1`）、单 sequence、单对手目标 `operation/damage` step（常量 `45` 魔法、`value_policy/add`、`copyable_on_hit=true`）。不写 `game_entities` / `entity_attribute_values`，不改 Batch-C 静态属性。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

**排除**：metadata tag `OnHitAppliesLifeSteal` 的吸血/治疗语义、Energized、Spellblade、随机/RNG，以及其它非 Fray on-hit 效果。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericWitsEndFraySeedSqlTest test
```

### LoL generic Manamune Awe seed（魔宗 item_3004）

在 reserved types、Batch-C `item_3004`（静态 `ad=35` / `mana=500` / `ability_haste=15`，本脚本不改）、以及 `attribute_definitions` 的 `ad` / `mana` 已就绪后，按顺序执行：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20110`/`20120`/`20170`）
2. `db/game_manage/seeds/lol_batch_c_adc_items_seed.sql`（若 Batch-C / `item_3004` 尚未写入）
3. `db/game_manage/seeds/lol_generic_manamune_awe_seed.sql`
4. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-manamune-awe-v1-20260714`（seed 不负责 publish）。

该 seed 会：锁定 `game_data_state`；校验 `item_3004` 与 `ad`/`mana` 属性定义及所需 reserved types；幂等投影所需 reserved → `types`；向 `item_3004` 独占 mount `provider_item_3004_manamune_awe`（`provider_kind/passive`），含单 source-bound `ad` add modifier（`selector/self` + `value_policy/add`），公式 AST 为 `mul(0.02, source.attr.mana.max)`。不写 provider state / listener / effect sequence / effect step / damage detail，不写 `game_entities` / `entity_attribute_values`，不改 Batch-C 静态属性。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

**排除**：Manaflow 充能、on-hit/ability 法力获取、最大充能上限、Muramana 变形、资源修改、攻击事件、随机/RNG。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericManamuneAweSeedSqlTest test
```

### LoL generic Crit / Infinity Edge eligibility（crit_eligible）

在 generic combat-data 基线已就绪、Batch-B 六个 ADC 基础普攻 damage 行与 Batch-C `item_3031` 静态属性已写入后，为既有 `damage_effect_details` / `_log` 补齐 `crit_eligible`，并幂等标记恰好六个 ADC 基础普攻 damage 行：

**新库**：`schema.sql` 已包含 `crit_eligible boolean NOT NULL DEFAULT false`（main + log）。

**已有库**按顺序执行：

1. `db/game_manage/migrations/compatibility/generic_crit_eligible_compatibility_migration.sql`（幂等：`ADD COLUMN IF NOT EXISTS`；不 DELETE / DROP / CASCADE / publish）
2. `db/game_manage/seeds/lol_generic_crit_modifier_seed.sql`
3. 幂等重跑 / 静态校验复核（无 material change 时不推进 revision）
4. 显式 Admin `POST /api/admin/games/lol/versions:publish`，版本码 `lol-generic-crit-modifier-v1-20260713`（本脚本**不会**自动 publish）

该 seed 会：锁定 `game_data_state`；校验 `item_3031` 静态 `ad=75` / `crit_chance=0.25` / `crit_damage=0.3`（**复用不变**，不写 Infinity Edge provider / provider_modifiers）；仅将六个 ADC 基础普攻 damage detail（`step_hero_*_basic_attack_damage`）标为 `crit_eligible=true`，保留其余列；不标记 on-hit / listener / linked / repeat 伤害。有 material change 时才推进候选 revision。

live revision 预期（非 SQL 硬编码；基线仍为 17/17 时）：首跑 `current/published` 自 `17/17` → `18/17`；幂等重跑保持 `18/17`；显式 publish 后 `18/18`。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=GenericCritEligibleDbContractSqlTest,LolGenericCritModifierSeedSqlTest test
```

## 配置与环境变量

当前仓内 `src/main/resources/application.yml` 仍保留示例直连配置。**本地开发请优先使用环境变量或本机私有配置覆盖，不要把真实数据库、Redis、JWT 凭据写回仓库。**

常用覆盖项：

| 环境变量 | 用途 |
| --- | --- |
| `SPRING_DATASOURCE_URL` | 覆盖 PostgreSQL 连接串 |
| `SPRING_DATASOURCE_USERNAME` / `SPRING_DATASOURCE_PASSWORD` | 覆盖数据库账号密码 |
| `IT_DB_INIT_FAIL_TIMEOUT` | 调整 Hikari 初始化失败等待时间 |
| `IT_REDIS_HOST` / `IT_REDIS_PORT` / `IT_REDIS_PASSWORD` / `IT_REDIS_DATABASE` | 覆盖 Redis 连接配置 |
| `APP_STARTUP_FAIL_FAST` | 是否在启动阶段立即校验 PostgreSQL / Redis 可用性 |
| `APP_AUTH_JWT_DISABLED` | 是否关闭本地 Admin JWT 校验 |
| `IT_ADMIN_JWT_ES256_PUBLIC_KEY_PEM` | 启用 Admin JWT 时提供 ES256 公钥 |

补充说明：

- `APP_STARTUP_FAIL_FAST=true` 时，会在启动阶段主动探测 PostgreSQL 和 Redis；否则通常在第一次触发相关请求时才暴露依赖问题。
- CORS 当前只放开 `/api/**` 路径，并暴露 `ETag` 响应头；联调异常时先确认请求路径与响应头需求。

## 常用验证

### 最低验证标准

- 文档-only 变更：核对入口、命令、路径与 README 说明即可，可不跑 Maven。
- 代码变更：默认至少运行 `mvn test`。
- 配置、依赖、打包链路变更：在 `mvn test` 之外再运行 `mvn package`。

### 联调 / 发布回归清单

涉及接口、发布链、缓存或数据库结构时，至少回归：

1. `GET /api/games`
2. `GET /api/games/{gameId}/versions/current`
3. 至少一类 `GET /api/games/{gameId}/combat-data/**`
4. 至少一类 Admin `PUT /api/admin/games/{gameId}/combat-data/**`
5. `POST /api/admin/games/{gameId}/versions:publish`（响应含 `changeRevision`，不生成 Bundle/Catalog）

## 常见失败与排查

1. **启动成功但首个请求才报依赖错误**：检查是否把 `APP_STARTUP_FAIL_FAST` 保持为默认关闭；需要尽早暴露问题时显式设为 `true`。
2. **启动阶段直接失败**：优先核对 PostgreSQL / Redis 地址、账号密码和连通性，再看 `application.yml` 是否仍引用了不适合当前环境的示例值。
3. **Admin 接口返回 401 / 403**：检查 `APP_AUTH_JWT_DISABLED` 是否已关闭，以及是否同时提供了 `IT_ADMIN_JWT_ES256_PUBLIC_KEY_PEM`。
4. **发布后 revision 未更新**：优先回归 `CombatDataPublishService`、`game_data_state` 锁定与 `_log` 写入；本链路不再生成 Bundle 快照。
5. **改了 SQL 或 Mapper 后查询异常**：同步检查 `db/**`、`src/main/resources/mapper/combatdata/**/*.xml`、`mapper/combatdata/**`、`service/combatdata/**` 口径是否一致。
6. **旧 Bundle/Catalog/hero/item 路由 404**：预期行为；请改用 `/combat-data/**`。

## 协作说明

- 这不是独立仓，而是 monorepo 下的后端专用 worktree。
- 涉及 `web / server / wasm` 边界的改动，优先先把后端口径、接口契约和会话记录收口，再决定是否同步改其他模块。
- 长期协作规则见仓库根 `AGENTS.md`；当前目录的就近规则见 `AGENTS.md`。
