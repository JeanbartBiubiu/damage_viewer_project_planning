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

### Entity / attribute `imageUri` 引用（revisioned URI，非版本化字节）

`game_entities` 与 `attribute_definitions`（及对应 `_log`）可挂可选 `image_uri`，复合 FK `(game_id, image_uri) → images(game_id, uri)`。Public / Admin 读写暴露 `imageUri`。Admin 写入：省略保留既有关联（新行 null）；JSON `null` 或空白清除；非空须同游戏 `images` 精确存在；非文本或缺失引用在 revision 分配前 `400.INVALID_BODY`（`details.path=/imageUri`）。实体 `:batch` 顶层同样允许 `imageUri`。URI 随行 `change_revision` 版本化；`images` 字节本身不进 log、不版本化。

**新库**：`schema.sql` 已含四表可空 `image_uri` 与命名 FK（`fk_game_entities_image` / `fk_game_entities_log_image` / `fk_attribute_definitions_image` / `fk_attribute_definitions_log_image`）。

**已有库**：按需执行 `db/game_manage/migrations/compatibility/generic_combat_data_image_reference_compatibility_migration.sql`（幂等：`ADD COLUMN IF NOT EXISTS` + `DO $$` / `pg_constraint` 守卫；不 DELETE / DROP / CASCADE / 数据改写 / publish）。不要把该 migration 当作新库必跑步骤。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=GenericCombatDataImageReferenceDbContractSqlTest test
```

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

### Provider lifecycle tick_anchor 成对字段合同

为 `provider_lifecycles` / `provider_lifecycles_log` 增加可选成对字段 `tick_anchor_scope_type_id` + `tick_anchor_state_key`（二者同为 NULL 或同非空；scope FK → `reserved_type`；初始语义支持 `state_scope/provider_target`）。Backend 只做配对校验与透传，不校验完整 Wasm state-schema。

**新库**：`schema.sql` 已包含上述列与配对 CHECK。

**已有库**：执行 `db/game_manage/migrations/compatibility/generic_tick_anchor_compatibility_migration.sql`（幂等：`ADD COLUMN IF NOT EXISTS` + 守卫式 CHECK/FK；不 DELETE / DROP / CASCADE / publish）。

Admin/Public JSON：`tickAnchorScopeTypeId` / `tickAnchorStateKey`；省略对 = null；半对 → `400.INVALID_BODY`。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=GenericTickAnchorDbContractSqlTest,ProviderCombatDataServiceTest test
```

### LoL Guinsoo H+K 升级 seed（叠攻速 / 时长 / 满层每第三次 phantom）

在 Guinsoo H+K DDL 合同已就绪，且 `lol_adc_item_on_hit_passives_seed.sql`（`provider_item_3124_guinsoos`）与 `lol_formula_on_hit_mechanisms_seed.sql`（破败 / 纳什 / 界弓伤害行）已写入后，本批按顺序执行：

1. `db/game_manage/migrations/compatibility/generic_guinsoo_hk_compatibility_migration.sql`（若已有库尚未补齐合同）
2. `db/game_manage/triggers.sql`
3. `db/game_manage/seeds/reserved_types_seed.sql`
4. `db/game_manage/seeds/lol_guinsoo_hk_seed.sql`
5. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

该 seed 会：单事务锁定 `game_data_state`；复用既有 `provider_item_3124_guinsoos`（不重建 provider）；写入 `guinsoos_seething_strike` 状态（`max_value=4` / `duration_ms=3000` / `refresh_policy/refresh_duration`）；每层 `+8%` `attack_speed` percent_add；另写 `guinsoos_phantom_hit_counter`（`max_value=3` / `3000ms` / refresh-on-write），在**已满 4 层**时按每第三次攻击 `register repeat(copyable_on_hit / phantom_hit)`（到达第 4 层的那次攻击不计入；连续攻击下 1–6 无 phantom，7 / 10 / 13… 各一次）；仅将鬼索 / 破败 / 纳什 / 界弓四条 on-hit 伤害标为 `copyable_on_hit`。live 旧 cadence（seething=1 / phantom=2）升级到最终 0/1/2/3/4 前，若 owned step 的 `step_order` 与目标不一致，会先按序列当前 `MAX(step_order)` 做碰撞安全临时重排，再条件 upsert（已对齐则跳过；重跑不推进 revision）。有 material change 时才推进候选 revision；不 DELETE、不自动 publish。

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

### LoL generic Varus Blighted Quiver seed（韦鲁斯 W 枯萎箭袋 / Phase-A v2）

在 reserved types、Batch-B `hero_varus` 普攻闭环，以及 `lol_adc_item_on_hit_passives_seed.sql` 写入的 `step_hero_varus_basic_attack_emit_hit` / `event_ref_hero_varus_basic_attack_hit` 已就绪后，按顺序执行（**不**重建/替换 `provider_hero_varus_basic_attack`、不重复 emit；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20100`/`20110`/`20111`/`20120`/`20130`/`20142`/`20150`/`20160`/`20170`/`20172`/`20181`/`20190`/`20211`/`20212`/`20220`/`20221`/`20250`/`20252`/`20260`）
2. `db/game_manage/seeds/lol_batch_b_adc_entities_seed.sql`（若 Batch-B / `hero_varus` 尚未写入）
3. `db/game_manage/seeds/lol_adc_item_on_hit_passives_seed.sql`（若 Varus `basic_attack_hit` emit 尚未写入）
4. `db/game_manage/seeds/lol_generic_varus_blighted_quiver_seed.sql`
5. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-varus-blighted-quiver-phase-a-v2-20260721`（seed 不负责 publish）。候选整体语义为已批准 **Phase-A rank-5 固定 max-charge 主目标边界**：

`fixed_max_charge_primary_target; q_carrier_ordering_scaffold_only; q_physical_then_w_active_post_q_pre_blight_then_blight_detonation; rank5; no_equipment_interop`

该 seed 会：锁定 `game_data_state`；fail-closed 校验 Batch-B Varus 实体/普攻图/mount 与既有 on-hit emit；幂等投影 reserved → `types`；向 `hero_varus` **仅** mount 独立 `provider_hero_varus_w_blighted_quiver_phase_a`（保留既有 mounts）；写入 `blight_stacks`（provider_target / max3 / 6000ms / refresh_on_write）与 `blighted_quiver_active`（provider / max1 / 5500ms / refresh_on_write）；Vayne/TF 式 `basic_attack_hit`+`source_owner` listener（max once/event）按序结算魔法 on-hit `40 + 0.15*max(0, bonusAD) + 0.25*AP` 再 `blight_stacks += 1`；W active `ability_hero_varus_w_blighted_quiver_active`（`ability_key=blighted_quiver_phase_a_active`；**无** cost/CD 行）impact 直接 override active=1；W-scoped Q ordering carrier `ability_hero_varus_w_piercing_arrow_max_charge_carrier`（`ability_key=blighted_quiver_q_max_charge_carrier`）五步序 physical →（active）missing-HP magic →（blight）detonate → reset blight → reset active。Wiki 权威：page1309980 / rev4026472 / SHA256 `16307174c4039d8ce71e639396328b2473f4a7e16247a7b2f8a183599b0901d2`；只读 sidecar `数据参考/lol-wiki-current-champions/normalized/generic/varus-w.json`。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

**排除**：ranks1-4、可变 Q 蓄力、W cooldown/recast/death/CC、Q mana/CD/channel/projectile/multi-target、Blight cooldown refund、其它技能消费者、野怪上限、shields/blind/block/dodge、Spellblade/on-cast suppression、Guinsoo phantom/repeat、装备/loadouts、live migration、publish、完整对局保真；不 claim 真实 Varus Q 完成。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericVarusBlightedQuiverSeedSqlTest test
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

### Generic repeat delay_ms 数据库合同（repeat_effect_details）

在 generic combat-data / Guinsoo H+K（含 `repeat_effect_details`）基线已就绪的库上，为 repeat detail 补齐可选延迟毫秒：

**新库**：`schema.sql` 已包含 `delay_ms int NOT NULL DEFAULT 0 CHECK (delay_ms >= 0)`（main + log）。

**已有库**：按需执行 `db/game_manage/migrations/compatibility/generic_repeat_delay_compatibility_migration.sql`（幂等：`ADD COLUMN IF NOT EXISTS` + 命名非负 CHECK；不 DELETE / DROP / CASCADE / publish）。不要把该 migration 当作新库必跑步骤；本仓库文档不宣称已对其执行或已 publish。

API 字段为 `delayMs`：请求省略或 `null` 归一为 `0`（旧客户端仍合法）；读取旧行暴露数值 `0`。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=GenericRepeatDelayDbContractSqlTest test
```

### LoL generic Dusk and Dawn Spellblade seed（黄昏与黎明 item_2510）

在 reserved types、Batch-C `item_2510`（静态 `ap=60` / `hp=300` 为既有输入）、basic_attack_hit emit 基线，以及 repeat `delay_ms` 合同已就绪后，按顺序执行（不依赖 `hero_vayne` / tumble / `ability/basic_attack` / `lol_generic_spellblade_seed.sql` / `item_3100` / `item_3508`；本脚本不做 live migration、不自动 publish）：

1. `db/game_manage/migrations/compatibility/generic_repeat_delay_compatibility_migration.sql`（若已有库尚未补齐 `delay_ms`）
2. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20151`/`20161`/`20263`/`20205`/`20211`/`20212`/`20221`/`20190`/`20250` 等）
3. `db/game_manage/seeds/lol_batch_c_adc_items_seed.sql`（若 Batch-C / `item_2510` 尚未写入）
4. `db/game_manage/seeds/lol_adc_item_on_hit_passives_seed.sql`（或等价 `event/basic_attack_hit` emit）
5. `db/game_manage/seeds/lol_generic_dusk_and_dawn_spellblade_seed.sql`

该 seed 会：锁定 `game_data_state`；校验 `item_2510` 及其静态 `ap=60` / `hp=300` 与 `ad`·`ap` attribute_definitions（不 mutate/recreate Batch-C）；幂等投影所需 reserved（含 heal `20151` / repeat `20161` / `repeat_scope/copyable_on_hit` `20263`）→ `types`；向 `item_2510` 独占 mount `provider_item_2510_dusk_and_dawn_spellblade`，只监听已存在的 `ability_started` / `basic_attack_hit` / `source_owner` 事件；含 `spellblade_ready`（10s）/ `spellblade_icd`（1.5s）、ability_started 武装 listener（`mul(eq(ready,0), eq(icd,0))` 数值门控，仅武装 ready，**不**在武装时开 ICD）、basic_attack_hit 触发 listener（五步均 `condition_formula_key='spellblade_ready_armed'`；顺序：`0 damage` → `1 heal` → `2 repeat(+200ms)` → `3 arm icd` → `4 consume ready`；伤害 `0.75 * event.entry_source.attr.ad.base + 0.10 * event.entry_source.attr.ap.resolved` 魔法 `20221`，`copyable_on_hit=false`；heal `0.10 * event.entry_source.attr.ap.resolved + 0.03 * max(0, event.entry_source.attr.hp.max - event.entry_source.attr.hp.base)` 对 self；repeat scope `20263` / count 1 / tag `dusk_and_dawn_delayed_on_hit` / `trigger_state_key=spellblade_icd` / threshold 1 / `delay_ms=200`；ICD 以强化攻击消耗时开始）。live 旧 0/1/2 顺序升级到 0..4 前，若 owned step 的 `step_order` 与目标不一致，会先按序列当前 `MAX(step_order)` 做碰撞安全临时重排，再条件 upsert（已对齐则跳过；重跑不推进 revision）。**排除**：resource/mana restore、provider_modifiers、Vayne/tumble/62003/generic-spellblade 依赖、live migration、自动 publish。有 material change 时才推进候选 revision；不 DELETE。Wiki 注释引用 current-items item 2510 revid `4030984` / SHA `e7818eff…`，无运行时外部依赖。

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

### LoL generic Linked Effects seed（黑色切割者 item_3071 Carve v2）

在 reserved types、Batch-C `item_3071`、`attribute_definitions.armor`，以及 `provider_state_fields` / `provider_modifiers` / state detail 合同已就绪后，按顺序执行：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20100`/`20113`/`20122`/`20160`/`20170`/`20173`/`20181`/`20190`/`20200`/`20212`/`20214`/`20252` 等）
2. `db/game_manage/seeds/lol_batch_c_adc_items_seed.sql`（若 Batch-C / `item_3071` 尚未写入）
3. `db/game_manage/seeds/lol_generic_linked_effects_seed.sql`
4. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish；不做 live migration）

建议发布版本：`lol-generic-linked-effects-v2-20260715`（seed 不负责 publish）。

**数据真值（Carve）**：每次合格的 root 物理伤害帧叠 1 层目标绑定 `carve_stacks`（最多 5 层）；每层削减目标护甲 **6%**（满层 30%）；整窗 **6000ms**，`refresh_on_write`（reserved `20190` / `refresh_policy/refresh_duration`）全窗刷新；第 6 次命中仍写入并刷新过期（runtime max 封顶）。事件边界为 root 物理 `damage_dealt`（不再要求 `basic_attack`）。

该 seed 会：锁定 `game_data_state`；幂等投影所需 reserved → `types`；向 `item_3071` mount 稳定 provider `provider_item_3071_black_cleaver_carve`（equipment `20122`）；写入 `provider_state_fields.carve_stacks`（number / max=5 / 6000ms / 20190）；写入对手 `armor` `percent_add` modifier，公式 `-0.06 * provider.target_state.carve_stacks`（保留 source provider 溯源、无 condition）；source-owner ALL listener（matcher 精确为 `20200`/`20214`/`20212`，`max_triggers_per_event=1`）挂到 **v2** sequence（仅一步无 condition 的 `state_change`：`provider_target`/`carve_stacks` +1）。历史永久 flat `-4` sequence/step/formula 行可保留为孤儿证据，不 DELETE；唯一升级例外是 scoped `DELETE` 清理该 listener 上过时的 `20181`/`20215` matcher，并按 ROW_COUNT 标记 `v_changed`。不改 `item_3071` 静态属性或 `adc_completed_item` tag；有 material change 时才推进候选 revision；不自动 publish。

**排除**：装备被动「热烈」（+20 移速 / 2s）仍属独立 `blocked_runtime` 机制，不在本 seed 建模。

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

### LoL generic Jak'Sho Voidborn Resilience seed（千变者贾修 item_6665）

在 reserved types、以及基线 `attribute_definitions` 的 `hp` / `armor` / `magic_resist` 已就绪后，按顺序执行（本脚本自包含写入 `item_6665`、合成 `bonus_armor` / `bonus_magic_resist` 属性定义，以及 `tag/loadout_equipment` eligibility；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20100`/`20110`/`20120`/`20160`/`20170`/`20172`/`20250`）
2. 基线战斗属性定义（至少 `hp`/`armor`/`magic_resist`；通常随 generic combat bootstrap / Admin 已写入）
3. `db/game_manage/seeds/lol_generic_jaksho_voidborn_resilience_seed.sql`
4. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-jaksho-voidborn-resilience-v1-20260715`（seed 不负责 publish）。Seed 侧保持 item-owned 合同：`provider_item_6665_jaksho_voidborn_resilience` 仅挂 `item_6665`；2026-07-21 跨层 target-loadout + bonus 抗性投影已完成，但仍未执行 live migration / publish。

该 seed 会：锁定 `game_data_state`；校验所需 reserved 与 `hp`/`armor`/`magic_resist`；幂等投影 reserved → `types`；ensure `bonus_armor`/`bonus_magic_resist` 属性定义；写入 `item_6665` 静态 `hp=350` / `armor=45` / `magic_resist=45`；ensure game-local `62011` / `tag/loadout_equipment`（`reserved_type_id=NULL`，双向 collision fail-closed）并幂等 `type_relations` → `entity/item_6665`（Wiki current-items / source item 6665 / revid 4030984 / content SHA；role `loadout_equipment`）；挂载 passive provider，含 untimed `full_stack`（max1，runtime 默认 0）、lifecycle `tick_interval_ms=5000` / `start_delay_ms=5000`、`provider_tick_sequences` 单步 `state_change` override/set `full_stack=1`（重复 tick 幂等），以及两条 owner-self `value_policy/add` modifier：`0.30 * max(0, $owner.attr.bonus_*.resolved) * provider.state.full_stack`。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

**排除**：不把 `item_6665` 写入 `tag/adc_completed_item` / Batch-C；不在 Backend 写 item 静态 `bonus_armor`/`bonus_magic_resist`（bonus 桶投影由 Web target-loadout 装配负责）；自动战斗态检测（超出「run 起算即在战斗」假设）；旧 DPS lane / 开局即满层；5 层逐秒叠层；live migration；publish；不写 damage / listener / ability 行。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericJakshoVoidbornResilienceSeedSqlTest test
```

### LoL generic Wiki-ready items seed（专横 / 弩箭 / 荆棘）

在 reserved types、基线 `attribute_definitions`（`hp`/`ad`/`armor`/`attack_speed`/`crit_chance`），以及 Bolt/Thorns 运行时所需的 `basic_attack_hit` emit 基线已就绪后，按顺序执行（本脚本自包含 ensure `item_2501` / `item_3097` / `item_3075` 与 `bonus_armor`；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20100`/`20110`/`20111`/`20113`/`20120`/`20150`/`20160`/`20170`/`20172`/`20181`/`20211`/`20212`/`20213`/`20221`/`20250`）
2. 基线战斗属性定义（至少 `hp`/`ad`/`armor`/`attack_speed`/`crit_chance`；通常随 generic combat bootstrap / Admin 已写入）
3. `db/game_manage/seeds/lol_adc_item_on_hit_passives_seed.sql`（或等价 `event/basic_attack_hit` emit；Bolt/Thorns 运行时依赖，本 seed 不重建普攻图）
4. `db/game_manage/seeds/lol_generic_wiki_ready_items_seed.sql`
5. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-wiki-ready-items-v1-20260716`（seed 不负责 publish）。

该 seed 会：锁定 `game_data_state`；校验所需 reserved 与属性定义；幂等投影 reserved → `types`；按 Jak'Sho 模式 ensure `bonus_armor`；ensure 三件装备最低必要静态面板；挂载三条独立 passive：

- **item_2501 Tyranny / 专横**：owner-self `ad` add = `0.025 * max(0, $owner.attr.hp.max - $owner.attr.hp.base)`
- **item_3097 Bolt / 弩箭**：仅预充能窗口（`assumes_charge_at_threshold_before_dps_window`）。`energized_charge` max=100（schema 无 default 列；窗口开始前由 runtime/测试快照置 100）。`basic_attack_hit` + `source_owner` ALL listener：ready 时 100 魔法伤害且 `copyable_on_hit=false` → override 消费为 0。充能恢复是 remaining gap，不写虚构 `charge_add` / 移动充能速率。
- **item_3075 Thorns / 荆棘**：target-owned `basic_attack_hit` + `source_opponent` ALL listener；对 owner-relative `selector/target`（原攻击者）造成 `20 + 0.10 * $owner.attr.bonus_armor.resolved` 魔法伤害，`copyable_on_hit=false`。重伤分支本批不实现。

有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish；不写无关既有 item 行。

**排除**：虚构 Energize 充能速率、Bolt 移动充能、Thorns 重伤、Retribution（2501 pass2）、live migration、publish、legacy `single_attacker_dps` / `energized_charge_and_consume`。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericWikiReadyItemsSeedSqlTest test
```

### LoL generic Kayle Radiant Blast seed（耀焰冲击 Q / Phase-A rank-5 主目标边界完成）

在 reserved types 与所需 `attribute_definitions`（`hp`/`mana`/`ad`/`ap`/`attack_speed`/`armor`/`magic_resist`/`hp_regen`/`mana_regen`）已就绪后，按顺序执行（**自包含** ensure `hero_kayle` 最低必要实体/level-1 面板/mana 资源 + 可 cast 的 Q active；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20100`/`20110`/`20111`/`20113`/`20120`/`20130`/`20142`/`20150`/`20160`/`20170`/`20172`/`20173`/`20190`/`20221`/`20252`/`20260`）
2. `db/game_manage/seeds/lol_generic_kayle_radiant_blast_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-kayle-radiant-blast-v1-20260720`（seed 不负责 publish）。候选 `hero_skill|hero_kayle|Q|耀焰冲击` 整体语义为本任务冻结的 **Phase-A rank-5 主目标边界完成 / full boundary**：100 mana / 8000ms CD / magic `180 + 0.60*bonus AD + 0.50*AP`，伤害后 `kayle_q_sundered` 目标护甲/魔抗各 `percent_add -15%`（4000ms / refresh_on_write）。

该 seed 会：锁定 `game_data_state`；校验所需 reserved / 属性定义；幂等投影 reserved → `types`；fail-closed 冲突的既有 modifier/ability 绑定；ensure `hero_kayle`（`ON CONFLICT DO NOTHING`，不覆盖既有实体元数据）与 level-1 面板（hp670 / mana330 / ad50 / ap0 / AS0.625 / armor26 / MR22 / hpregen5 / manaregen8；自包含 bootstrap，溯源 Module:ChampionData/data rev `4042886`，**不作** Q 完成证据）、`resource_definitions.mana` 与 `entity_resource_values`（330/330）；向 `hero_kayle` 独占 mount `provider_hero_kayle_radiant_blast`，含 `provider_target` 态 `kayle_q_sundered`、两条 target `percent_add` 击碎 modifier、active `ability_hero_kayle_q_radiant_blast`（`ability_key=radiant_blast`）、`ability_costs` 100 mana、`ability_cooldowns` 8000ms、impact 两步（magic damage → source-owned state override=1）。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。Q 机制数值注释引用 League Wiki `Template:Data Kayle/Radiant Blast` rev `4005105` / contentSha256 `ded516de4861d88de21ba54de9a8723b654f424f1cc3f9dac30d06382ee1a87c`（`kayle-q.json`）。

**排除**：减速/控制、弹道/施法延迟、多目标/十字扩张、其它 rank、死亡后持续、listener / production probe、live migration、publish。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericKayleRadiantBlastSeedSqlTest test
```

### LoL generic Graves New Destiny seed（格雷福斯 P 新命运 / Phase-A point-blank 边界完成）

在 reserved types 与所需 `attribute_definitions`（`hp`/`mana`/`ad`/`attack_speed`/`armor`/`magic_resist`/`hp_regen`/`mana_regen`/`champion_level`/`crit_chance`/`crit_damage`）已就绪后，按顺序执行（**自包含** ensure `hero_graves` 最低必要实体/Wiki level-1 面板/mana 资源 + 普攻图；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20100`/`20110`/`20111`/`20120`/`20130`/`20142`/`20150`/`20158`/`20170`/`20172`/`20211`/`20220`/`20252`/`20260`/`20264`/`20265`/`20266`/`20269`/`20277`/`20279`/`20280`）
2. `db/game_manage/seeds/lol_generic_graves_new_destiny_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-graves-new-destiny-v1-20260720`（seed 不负责 publish）。候选 `hero_skill|hero_graves|P|新命运` 整体语义为本任务冻结的 **Phase-A point-blank 最大弹丸合并边界完成 / full boundary**：单次物理伤害 `AD * F(x) * (1 + 3*s)`（`s=0.33302`，`F(x)=0.6895 + 0.01765*x*(0.595 + 0.0225*(x-1))`），`crit_eligible=true`，以及 source-owned `basic_damage` 管道 natural/forced 暴击乘区 `value_policy/override`：`((1 + 5*s) / (1 + 3*s)) * (1 + 0.5*(crit_damage.resolved - 1))`。

该 seed 会：锁定 `game_data_state`；校验所需 reserved / 属性定义；幂等投影 reserved → `types`（fail-closed 冲突；正确元数据不覆盖）；fail-closed ensure game-local `62003 ability/basic_attack` 并关联 `ability_hero_graves_basic_attack`；ensure `hero_graves`（`ON CONFLICT DO NOTHING`，不覆盖既有实体元数据）与 Wiki-only level-1 面板（hp625 / mana325 / ad66 / AS0.475 / armor33 / MR30 / hpregen8 / manaregen8；溯源 Module:ChampionData/data rev `4042886` / SHA256 `98094d20…`，**不作** P 机制完成证据）、`resource_definitions.mana` 与 `entity_resource_values`（325/325）、`champion_level` scalar 1..18、运行时 EAV `crit_chance=0` / `crit_damage=2.0`（非 P 数值真理）；向 `hero_graves` 独占 mount `provider_hero_graves_new_destiny`（拥有 `ability_hero_graves_basic_attack`），impact 两步（merged physical damage → `emit_event(event/basic_attack_hit)`），伤害与 emit 均为 `copyable_on_hit=false`。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。P 机制数值注释仅引用 League Wiki `Template:Data Graves/New Destiny` rev `4038342` / contentSha256 `553bda22…`（`graves-p.json` / `reviewed-contracts.json#graves-p`）；不以 DDragon / Meraki / 截图 / OCR 作为机制真理。

**已完成边界**：点空白合并物理普攻、natural+forced 暴击乘区 override、`ability/basic_attack` 类型关系、唯一 `basic_attack_hit` emit。

**排除**：装填/节奏、弹丸实例、弹道/距离、多目标、on-hit 重放、建筑/守卫、生命偷取、击退、RNG、英雄特化 runtime 代码、live migration、publish。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericGravesNewDestinySeedSqlTest test
```

### LoL generic Graves Quickdraw max-stack seed（格雷福斯 E 快速拔枪 / Phase-A 满层 True Grit）

在 reserved types 与基线面板 `attribute_definitions`（`hp`/`mana`/`ad`/`attack_speed`/`armor`/`magic_resist`/`hp_regen`/`mana_regen`）已就绪后，按顺序执行（**自包含** ensure `hero_graves` 最低必要实体/Wiki level-1 面板/mana 资源，并按 Jak'Sho/wiki-ready 模式 ensure `bonus_armor`/`bonus_magic_resist` + hero EAV=0；**不**覆盖既有 Graves P 图；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20100`/`20110`/`20120`/`20130`/`20142`/`20160`/`20170`/`20172`/`20250`/`20260`）
2. `db/game_manage/seeds/lol_generic_graves_quickdraw_max_stack_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-graves-quickdraw-max-stack-v1-20260720`（seed 不负责 publish）。候选 `hero_skill|hero_graves|E|快速拔枪` 整体语义为用户批准的 **Phase-A rank-5 最大 True Grit 满层近似**：施法 impact 以 `value_policy/override` 直接写入 `true_grit_stacks=8`（max8 / untimed），四条 owner-self flat-add：`armor`/`bonus_armor` = `19 * provider.state.true_grit_stacks`，`magic_resist`/`bonus_magic_resist` = `9.5 * provider.state.true_grit_stacks`（满层 +152 / +76）；mana 40、CD 12000ms。

该 seed 会：锁定 `game_data_state`；校验所需 reserved / 面板属性定义；幂等投影 reserved → `types`（fail-closed 冲突；正确元数据不覆盖）；ensure `hero_graves`（`ON CONFLICT DO NOTHING`）与 Wiki-only level-1 面板（hp625 / mana325 / ad66 / AS0.475 / armor33 / MR30 / hpregen8 / manaregen8；溯源 Module:ChampionData/data rev `4042886` / SHA256 `98094d20…`，**仅 bootstrap**，与 E 机制真理分离）、mana 325/325、`bonus_armor`/`bonus_magic_resist` 定义与 EAV=0；向 `hero_graves` 独立 mount `provider_hero_graves_quickdraw_max_stack`（拥有 `ability_hero_graves_quickdraw`），**不**写入/重挂 `provider_hero_graves_new_destiny` / `ability_hero_graves_basic_attack`。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。E 机制数值注释仅引用 League Wiki `Template:Data Graves/Quickdraw` rev `4007744` / contentSha256 `ff4c65c5…`（`graves-e.json`）；不以 DDragon / Meraki / 截图 / OCR 作为机制真理。

**已完成边界**：直接满层 True Grit 写入、四条解析抗性加成、主动技能 cost/CD、独立 E provider mount。

**排除**：伤害、装填/弹药、普攻重置、弹丸减 CD、冲刺几何、方向判定、瞄准/碰撞/多目标、计时刷新/过期、中间叠层、live migration、publish。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericGravesQuickdrawMaxStackSeedSqlTest test
```

### LoL generic Kog'Maw Caustic Spittle seed（腐蚀唾液 Q / rank-5 被动攻速）

在 reserved types、Batch-B `hero_kogmaw`、以及 `attribute_definitions.attack_speed` 已就绪后，按顺序执行（**不**重建普攻 / W Bio-Arcane Barrage；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20110`/`20120`/`20173`）
2. `db/game_manage/seeds/lol_batch_b_adc_entities_seed.sql`（若 Batch-B / `hero_kogmaw` 尚未写入）
3. `db/game_manage/seeds/lol_generic_kogmaw_caustic_spittle_seed.sql`
4. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-kogmaw-caustic-spittle-v1-20260714`（seed 不负责 publish）。候选整体语义 **partial**：仅 rank5 被动 `+25%` AS。

该 seed 会：锁定 `game_data_state`；校验 `hero_kogmaw` / `attack_speed` / 所需 reserved；幂等投影 reserved → `types`；向 `hero_kogmaw` 独占 mount `provider_hero_kogmaw_caustic_spittle`，含 `attack_speed` `percent_add` 常量 `0.25`。不写 ability / listener / state / effect / damage。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

**排除**：Q 主动魔法伤害、护甲/魔抗击碎、cast/cooldown/rotation、其它 rank、W/普攻重建、live migration、publish。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericKogmawCausticSpittleSeedSqlTest test
```

### LoL generic Twisted Fate Stacked Deck seed（卡牌大师 E / rank-5）

在 reserved types 与所需 `attribute_definitions`（`hp`/`ad`/`ap`/`attack_speed`/`armor`/`magic_resist`）已就绪后，按顺序执行（**自包含** `hero_twistedfate` + 通用普攻图 + `basic_attack_hit` emit；不依赖 Batch-B；本脚本不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20100`/`20110`/`20111`/`20120`/`20130`/`20142`/`20150`/`20158`/`20160`/`20170`/`20172`/`20173`/`20181`/`20211`/`20212`/`20220`/`20221`/`20250`/`20260`）
2. `db/game_manage/seeds/lol_generic_twisted_fate_stacked_deck_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-twisted-fate-stacked-deck-v1-20260714`（seed 不负责 publish）。

该 seed 会：锁定 `game_data_state`；校验所需 reserved / 属性定义；幂等投影所需 reserved → `types`；幂等写入 `hero_twistedfate` 基线实体与 level-1 面板、通用普攻闭环，并在伤害步骤后追加 `emit_event(event/basic_attack_hit)`；向 `hero_twistedfate` mount 独立 `provider_hero_twistedfate_stacked_deck`（与普攻 provider 并存），含常驻 `attack_speed` `percent_add` `0.50`、`stacked_deck_hits` provider 状态、`basic_attack_hit` + `source_owner` ALL listener（`max_triggers_per_event=1`）、三步结算（计数 → 条件魔法伤害 → 条件重置）。proc 公式为 `165 + 0.20*(ad.resolved-ad.base) + 0.40*ap.resolved`，`damage/magic`（`20221`，走目标 MR pipeline），`copyable_on_hit=false`。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

**排除**：建筑物 50% 减伤、其它 rank 数值表、主动技能（Q/W/R）、live migration、publish。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericTwistedFateStackedDeckSeedSqlTest test
```

### LoL generic Draven Spinning Axe seed（德莱文 Q / rank-5 初次飞斧）

在 reserved types 与所需 `attribute_definitions`（`hp`/`mana`/`ad`/`attack_speed`/`armor`/`magic_resist`/`hp_regen`/`mana_regen`）已就绪后，按顺序执行（**自包含** `hero_draven` + 通用普攻图 + `basic_attack_hit` emit + 可 cast 的 Q active；不依赖 Batch-B；本脚本不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20100`/`20110`/`20111`/`20120`/`20130`/`20142`/`20150`/`20158`/`20160`/`20170`/`20172`/`20181`/`20190`/`20205`/`20211`/`20212`/`20220`/`20250`/`20260`）
2. `db/game_manage/seeds/lol_generic_draven_spinning_axe_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-draven-spinning-axe-v1-20260714`（seed 不负责 publish）。

该 seed 会：锁定 `game_data_state`；校验所需 reserved / 属性定义；幂等投影所需 reserved → `types`；幂等写入 `hero_draven` 基线实体与 level-1 面板（hp675 / mana361 / ad62 / AS0.679 / armor29 / MR30 / hpregen3.75 / manaregen8.05）、通用普攻闭环，并在伤害步骤后追加 `emit_event(event/basic_attack_hit)`（普攻**不**发 `ability_started`）；挂载可 cast 的 active `ability_hero_draven_q_spinning_axe`（成功 cast 由既有 runtime 发出 `event/ability_started`）；向 `hero_draven` mount 独立 `provider_hero_draven_q_spinning_axe`（与普攻 provider 并存），含 timed `spinning_axe_ready`（max1 / `duration_ms=5800` / `refresh_duration`）、`ability_started` + `source_owner` ALL listener 武装 ready=1，以及 `basic_attack_hit` + `source_owner` ALL listener（`max_triggers_per_event=1`）两步结算（条件物理伤害 → 条件消费 ready）。proc 公式为 `60 + 1.15*(ad.resolved-ad.base)`，`damage/physical`（`20220`），`copyable_on_hit=false`。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。数值注释引用 2026-07-14 Meraki/Riot latest `Draven.json`。

**排除**：接斧后重新武装、双斧上限、45 mana、8s CD、其它 rank、移动落点、live migration、publish。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericDravenSpinningAxeSeedSqlTest test
```

### LoL generic Draven Blood Rush seed（德莱文 W / rank-5 攻速窗 partial）

在 reserved types 与所需 `attribute_definitions`（`hp`/`mana`/`ad`/`attack_speed`/`armor`/`magic_resist`/`hp_regen`/`mana_regen`）已就绪后，按顺序执行（**自包含** ensure `hero_draven` 最低必要实体/level-1 面板/mana 资源 + 可 cast 的 W active；与既有 Q / 普攻 provider 并存，不重建/替换；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20100`/`20110`/`20120`/`20130`/`20160`/`20172`/`20173`/`20181`/`20190`/`20205`/`20212`/`20250`）
2. `db/game_manage/seeds/lol_generic_draven_blood_rush_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-draven-blood-rush-v1-20260716`（seed 不负责 publish）。候选整体语义 **partial**：20 mana / 12s CD / 3s +40% AS。

该 seed 会：锁定 `game_data_state`；校验所需 reserved / 属性定义；幂等投影 reserved → `types`；ensure `hero_draven`（`ON CONFLICT DO NOTHING`，不覆盖既有实体元数据）与 level-1 面板（hp675 / mana361 / ad62 / AS0.679 / armor29 / MR30 / hpregen3.75 / manaregen8.05）、`resource_definitions.mana` 与 `entity_resource_values`（361/361）；向 `hero_draven` mount 独立 `provider_hero_draven_w_blood_rush`（与 `provider_hero_draven_q_spinning_axe` / `provider_hero_draven_basic_attack` 并存），含 active `ability_hero_draven_w_blood_rush`（`ability_key=blood_rush`）、`ability_costs` 20 mana、`ability_cooldowns` 12000ms、timed `blood_rush_active`（max1 / `duration_ms=3000` / `refresh_duration`）、`ability_started` + `source_owner` + 同一 ability ALL listener 武装 active=1（override），以及 AS `percent_add` `0.40 * provider.state.blood_rush_active`。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。数值注释引用 2026-07-14 Meraki/Riot latest `Draven.json`。

**排除**：移速/衰减移速/幽灵态、接住旋转飞斧刷新 W cooldown、其它 rank、live migration、publish、`single_attacker_dps`。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericDravenBloodRushSeedSqlTest test
```

### LoL generic Draven Stand Aside seed（德莱文 E / Phase-A v2 主目标 impact）

在 reserved types 与所需 `attribute_definitions`（`hp`/`mana`/`ad`/`attack_speed`/`armor`/`magic_resist`/`hp_regen`/`mana_regen`）已就绪后，按顺序执行（**自包含** ensure `hero_draven` 最低必要实体/level-1 面板/mana 资源 + 可 cast 的 E active；与既有 Q / W / 普攻 provider 并存，不重建/替换；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20220`/`20260`）
2. `db/game_manage/seeds/lol_generic_draven_stand_aside_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-draven-stand-aside-phase-a-v2-20260722`（seed 不负责 publish）。候选 `hero_skill|hero_draven|E|开道利斧` 冻结为 **Phase-A rank-5 立即主目标 impact scaffold**（`FROZEN_PLAN_REV=draven-e-stand-aside-phase-a-v2`）：

`rank5_primary_target_single_hit; immediate_impact_scaffold; physical_215_plus_0_50_bonus_ad; no_cast_time_control_geometry_or_multitarget`

该 seed 会：锁定 `game_data_state`；校验所需 reserved / 属性定义；幂等投影 reserved → `types`；ensure `hero_draven`（`ON CONFLICT DO NOTHING`）与 level-1 面板（hp675 / mana361 / ad62 / AS0.679 / armor29 / MR30 / hpregen3.75 / manaregen8.05）、`resource_definitions.mana` 与 `entity_resource_values`（361/361）；向 `hero_draven` **仅** mount 独立 `provider_hero_draven_e_stand_aside`（与 `provider_hero_draven_q_spinning_axe` / `provider_hero_draven_w_blood_rush` / `provider_hero_draven_basic_attack` 并存），含 active `ability_hero_draven_e_stand_aside`（`ability_key=stand_aside`）、`ability_costs` 70 mana、`ability_cooldowns` 12000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 physical damage `215 + 0.50*(ad.resolved-ad.base)`（`copyable_on_hit=false`，非 crit）。Wiki：page1307070 / rev4034694 / SHA256 `7bb6ebdc19413ef908e78fea01576d1184a66bc62fd6148120845573c1468e8d`；sidecar `normalized/generic/draven-e.json`。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

**排除**：Wiki 250ms cast / effect-at-end（ABI 无 cast-delay 字段，不编码 delay phase）、listener/state、`basic_attack_hit`/emit、CC/knock/slow、projectile/几何/多目标、equipment/loadout、其它 rank、live migration、publish；不依赖 Q/W 发布顺序。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericDravenStandAsideSeedSqlTest test
```

### LoL generic Quinn Heightened Senses seed（奎因 W / rank-5 攻速 partial）

在 reserved types 与所需 `attribute_definitions`（`hp`/`mana`/`ad`/`attack_speed`/`armor`/`magic_resist`/`hp_regen`/`mana_regen`）已就绪后，按顺序执行（**自包含** ensure `hero_quinn` 最低必要实体/level-1 面板/通用普攻闭环 + `basic_attack_hit` emit；与普攻 provider 并存；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20100`/`20110`/`20111`/`20120`/`20130`/`20142`/`20150`/`20158`/`20160`/`20170`/`20172`/`20173`/`20181`/`20190`/`20211`/`20212`/`20220`/`20250`/`20252`/`20260`）
2. `db/game_manage/seeds/lol_generic_quinn_heightened_senses_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-quinn-heightened-senses-v1-20260716`（seed 不负责 publish）。候选整体语义 **partial**：易损目标普攻命中 → 2s +40% AS。

该 seed 会：锁定 `game_data_state`；校验所需 reserved / 属性定义；幂等投影 reserved → `types`；ensure `hero_quinn`（`ON CONFLICT DO NOTHING`，不覆盖既有实体元数据）与 level-1 面板（hp565 / mana269 / ad59 / AS0.668 / armor28 / MR30 / hpregen5.5 / manaregen7）、通用普攻闭环，并在伤害步骤后追加 `emit_event(event/basic_attack_hit)`；向 `hero_quinn` mount 独立 `provider_hero_quinn_heightened_senses`（与 `provider_hero_quinn_basic_attack` 并存），含 `provider_target` 契约态 `harrier_vulnerable`（max1 / untimed；缺省 0；**本 seed 不伪造写入**，供未来 P/Q/E）、timed `heightened_senses_active`（max1 / `duration_ms=2000` / `refresh_duration`）、`basic_attack_hit` + `source_owner` ALL listener（条件 `provider.target_state.harrier_vulnerable >= 1`）武装 active=1（override），以及 AS `percent_add` `0.40 * provider.state.heightened_senses_active`。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。数值注释引用 Data Dragon `Quinn.json`；攻速窗按本合同 partial（与 live wiki rank 表可能不同）。

**排除 / gap**：W 主动视野、移速分支、Harrier 额外伤害、易损标记生成/消费、其它 rank、live migration、publish、`single_attacker_dps`。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericQuinnHeightenedSensesSeedSqlTest test
```

### LoL generic Kai'Sa Supercharge seed（卡莎 E / rank-5 攻速窗）

在 reserved types、Batch-B `hero_kaisa`、以及 `attribute_definitions` 的 `mana` / `attack_speed` 已就绪后，按顺序执行（**不**重建 Batch-B / 普攻；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20100`/`20110`/`20120`/`20130`/`20160`/`20172`/`20173`/`20181`/`20190`/`20205`/`20212`/`20250`）
2. `db/game_manage/seeds/lol_batch_b_adc_entities_seed.sql`（若 Batch-B / `hero_kaisa` 尚未写入）
3. `db/game_manage/seeds/lol_generic_kaisa_supercharge_seed.sql`
4. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-kaisa-supercharge-v1-20260715`（seed 不负责 publish）。候选整体语义 **partial**：30 mana / 10s CD / 4s +80% AS；`ability_started` 在本合同近似「充能完成」（不建 cast-time scheduler）。

该 seed 会：锁定 `game_data_state`；校验 `hero_kaisa` / `mana`·`attack_speed` / 所需 reserved；幂等投影 reserved → `types`、`resource_definitions.mana` 与 `hero_kaisa` `entity_resource_values`（345/345）；向 `hero_kaisa` mount 独立 `provider_hero_kaisa_supercharge`，含 active `ability_hero_kaisa_e_supercharge`（`ability_key=supercharge`）、`ability_costs` 30 mana、`ability_cooldowns` 10000ms、timed `supercharge_active`（max1 / `duration_ms=4000` / `refresh_duration`）、`ability_started` + `source_owner` + 同一 ability listener 武装 active=1，以及 AS `percent_add` `0.80 * provider.state.supercharge_active`。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

**排除**：移速/幽灵/attack-windup、普攻减 CD/cooldown refund、进化隐身、damage/shred、cast-time scheduler、其它 rank、live migration、publish。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericKaisaSuperchargeSeedSqlTest test
```

### LoL generic Xayah Deadly Plumage seed（逆羽 W / Phase-A rank-5 1v1 边界完成）

在 reserved types 与所需 `attribute_definitions`（`hp`/`mana`/`ad`/`attack_speed`/`armor`/`magic_resist`/`hp_regen`/`mana_regen`）已就绪后，按顺序执行（**自包含** ensure `hero_xayah` 最低必要实体/level-1 面板/mana 资源 + 可 cast 的 W active；与未来普攻 / feather provider 并存，不重建/替换；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20100`/`20110`/`20120`/`20130`/`20160`/`20171`/`20172`/`20173`/`20181`/`20190`/`20205`/`20212`/`20250`/`20264`/`20265`/`20266`/`20267`/`20269`）
2. `db/game_manage/seeds/lol_generic_xayah_deadly_plumage_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-xayah-deadly-plumage-v1-20260716`（seed 不负责 publish）。候选整体语义为已批准 **Phase-A rank-5 1v1 边界完成**：40 mana / 14s CD / 4s +55% AS，以及 W 激活期间 source-owned `basic_damage` pipeline multiply `1 + 0.25 * provider.state.deadly_plumage_active`（条件排除 `damage.trait.on_hit` / `damage.trait.proc`；合并普攻倍率，非第二伤害实例）。

该 seed 会：锁定 `game_data_state`；校验所需 reserved / 属性定义；幂等投影 reserved → `types`；fail-closed ensure game-local `62006 damage_trait/on_hit` 与 `62009 damage_trait/proc`（`reserved_type_id=NULL`）；ensure `hero_xayah`（`ON CONFLICT DO NOTHING`，不覆盖既有实体元数据）与 level-1 面板（hp630 / mana340 / ad60 / AS0.658 / armor25 / MR30 / hpregen3.25 / manaregen8.25；自包含 bootstrap，非 Wiki W 数值真理）、`resource_definitions.mana` 与 `entity_resource_values`（340/340）；向 `hero_xayah` mount 独立 `provider_hero_xayah_w_deadly_plumage`（与未来 `provider_hero_xayah_basic_attack` / feather providers 并存），含 active `ability_hero_xayah_w_deadly_plumage`（`ability_key=deadly_plumage`）、`ability_costs` 40 mana、`ability_cooldowns` 14000ms、timed `deadly_plumage_active`（max1 / `duration_ms=4000` / `refresh_duration`）、`ability_started` + `source_owner` + 同一 ability ALL listener 武装 active=1（override）、AS `percent_add` `0.55 * provider.state.deadly_plumage_active`，以及 pipeline modifier `modifier_hero_xayah_w_deadly_plumage_basic_damage`（kind `20264` / command `20265` / channel `20266` / bucket `20269` / stage `20267` / multiply `20171`）。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。W 机制数值注释引用 League Wiki `Template:Data Xayah/Deadly Plumage` rev `4010669` / contentSha256 `09d5476533722311e85c4ca79813cd0bec2cf35d105be894b80dac14478845a7`（`xayah-w.json`）；不以 Meraki / DataDragon 作为 W 数值真理。

**排除**：移速、Rakan/洛联动、多目标/Runaan、projectile/in-flight/ward/blind/dodge/block 细节、独立次级羽刃 missile / 第二伤害操作、其它 rank、live migration、publish、完整技能保真。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericXayahDeadlyPlumageSeedSqlTest test
```

### LoL generic Twitch Deadly Venom seed（图奇 P 死亡毒液 / anchored tick）

前置 DDL：`provider_lifecycles` / `_log` 已含可选成对字段 `tick_anchor_scope_type_id` + `tick_anchor_state_key`（新库见 `schema.sql`；已有库先跑 `db/game_manage/migrations/compatibility/generic_tick_anchor_compatibility_migration.sql`）。在 reserved types 与所需 `attribute_definitions`（至少 `ad`/`ap`）就绪后按顺序执行（**自包含**；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20100`/`20110`/`20111`/`20120`/`20130`/`20142`/`20150`/`20158`/`20160`/`20170`/`20181`/`20190`/`20211`/`20212`/`20220`/`20222`/`20252`/`20260`）
2. `db/game_manage/seeds/lol_generic_twitch_deadly_venom_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-twitch-deadly-venom-v1-20260721`（seed 不负责 publish）。

该 seed 会：锁定 `game_data_state`；幂等投影 reserved → `types`；fail-closed ensure game-local `62004 damage_trait/dot` 与 `62009 damage_trait/proc`；ensure `hero_twitch`（`ON CONFLICT DO NOTHING`）与 `champion_level` base+stages 1..18（缺失才写入，不覆盖权威既有值）；ensure 通用普攻图并恰好一次 `emit_event(event/basic_attack_hit)`；向 `hero_twitch` 挂载独立 `provider_hero_twitch_deadly_venom`（与普攻 provider 并存）：`deadly_venom_stacks`（max6 / 6000ms / refresh_on_write）、source-owner `basic_attack_hit` listener（`max_triggers_per_event=1`）`state_change add 1`、lifecycle `tick_interval_ms=1000` / `start_delay_ms=0` / `tick_anchor_scope_type_id=20252` / `tick_anchor_state_key=deadly_venom_stacks`、on-tick 五条互斥等级段真实伤害 `(flat + 0.03 * AP.resolved) * stacks`（flat 1/2/3/4/5；非暴击、不可复制；挂 dot/proc traits）。有 material change 时才推进候选 revision。

Wiki 数值权威：`Template:Data Twitch/Deadly Venom` rev `4013286` / content SHA256 `1567c0efec7f9e9021f6dc02410f92262dfa30128acc457c531199dbc9121b44`。

**排除**：Expunge、Runaan/多目标、建筑、隐身交互、英雄专用 runtime、legacy DPS、live migration、publish。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=GenericTickAnchorDbContractSqlTest,LolGenericTwitchDeadlyVenomSeedSqlTest,ProviderCombatDataServiceTest test
```

### LoL generic Malzahar Malefic Visions seed（玛尔扎哈 E 恶咒降临 / anchored DoT Phase-A）

前置 DDL：同 Twitch，需 `provider_lifecycles` tick_anchor 成对字段。在 reserved types 与所需 `attribute_definitions`（`hp`/`mana`/`ad`/`ap`/`attack_speed`/`armor`/`magic_resist`/`hp_regen`/`mana_regen`）就绪后按顺序执行（**自包含**；不做 live migration、不自动 publish、不连 live DB 执行本 seed）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20100`/`20110`/`20111`/`20120`/`20130`/`20142`/`20150`/`20160`/`20170`/`20172`/`20190`/`20221`/`20252`/`20260`）
2. `db/game_manage/seeds/lol_generic_malzahar_malefic_visions_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-malzahar-malefic-visions-v1-20260721`（seed 不负责 publish）。候选 `hero_skill|hero_malzahar|E|恶咒降临` 冻结为 **Phase-A rank-5 anchored DoT**（`FROZEN_PLAN_REV=malzahar-e-anchored-dot-phase-a-v2`）：mana100 / CD7000ms；`malefic_visions_active` max1 / 4000ms / refresh_on_write；lifecycle `tick_interval_ms=250` / `start_delay_ms=0` / anchor `20252`+`malefic_visions_active`；每 tick 魔法 `13.75 + 0.05*AP`（合计 `220 + 0.80*AP`）。

该 seed 会：锁定 `game_data_state`；幂等投影 reserved → `types`；fail-closed ensure game-local `62004 damage_trait/dot`；ensure `hero_malzahar`（`ON CONFLICT DO NOTHING`）与 level-1 面板/mana 资源；向 `hero_malzahar` 独占 mount `provider_hero_malzahar_malefic_visions`；active `malefic_visions` impact **仅**一步 `state_change` override=1（`provider_target`），无施法直伤；on-tick 单条魔法伤害（非暴击、不可复制、挂 dot）。有 material change 时才推进候选 revision。

Wiki 数值权威：request `Template:Data Malzahar/E` → resolved `Template:Data Malzahar/Malefic Visions`；wikiPageId `1308233` / rev `4015185` / `2026-05-03T16:59:57Z`；upstream LF bytes `2228` / content SHA256 `9098ee2fbe7dfb33d1ca375bbce0c68788fd60378780aa4ddab8afc46736ba84`（`数据参考/lol-wiki-extra-mechanisms/normalized/generic/malzahar-e.json`）。

**排除**：Q/R 刷新；死亡扩散/弹跳/多目标；2% 最大法力回复；小兵斩杀；净化/免疫；indirect/spell-effect；ranks1-4；施法时间/射程；Batch-J 历史 `tick_damage` 5.6/1000ms；live migration；publish；E2E。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericMalzaharMaleficVisionsSeedSqlTest,GenericTickAnchorDbContractSqlTest test
```

### LoL generic Ashe Ranger's Focus seed（寒冰射手 Q / rank-5 部分 ABI）

前置 DDL：`ability_definitions.cast_condition_formula_key` 已存在（新库见 `schema.sql`；已有库先跑 `db/game_manage/migrations/compatibility/generic_ability_cast_condition_compatibility_migration.sql`）。在 reserved types 与所需 `attribute_definitions`（`hp`/`mana`/`ad`/`attack_speed`/`armor`/`magic_resist`/`hp_regen`/`mana_regen`）就绪后按顺序执行（**自包含**；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20100`/`20110`/`20111`/`20120`/`20130`/`20142`/`20150`/`20158`/`20160`/`20170`/`20172`/`20173`/`20181`/`20190`/`20205`/`20211`/`20212`/`20220`/`20250`/`20260`）
2. `db/game_manage/seeds/lol_generic_ashe_rangers_focus_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-ashe-rangers-focus-v1-20260714`（seed 不负责 publish）。

该 seed 会：锁定 `game_data_state`；幂等投影 reserved → `types`、`resource_definitions.mana` 与 `hero_ashe` `entity_resource_values`（280/280）；写入 level-1 面板（hp610 / mana280 / ad59 / AS0.658 / armor26 / MR30 / hpregen3.5 / manaregen7）；单一共享 `provider_hero_ashe_rangers_focus` 承载 Q + 普攻；四槽 timed Focus（4000/5000/6000/7000ms）+ `flurry_active` 6000ms；Q `cast_condition_formula_key`（Focus≥4）+ `ability_costs` 30 mana；AS `percent_add` `0.75 * provider.state.flurry_active`（`condition_formula_key` 为 NULL）；Flurry 首发 6 / 后续 5 × 0.28 total AD；每次普攻末尾恰好一次 `emit_event(event/basic_attack_hit)`。有 material change 时才推进候选 revision。

**排除**：攻击计时器重置、箭矢飞行、冰霜射击、生命偷取、建筑物/多目标、技能轮转/节奏、其它 rank、live migration、publish。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericAsheRangersFocusSeedSqlTest test
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
