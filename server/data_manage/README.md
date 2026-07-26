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

### LoL generic Manamune Awe + Manaflow direct-max-state Phase-A seed（魔宗 item_3004）

在 reserved types、Batch-C `item_3004`（静态 `ad=35` / `mana=500` / `ability_haste=15`，本脚本不改）、以及 `attribute_definitions` 的 `ad` / `mana` 已就绪后，按顺序执行：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20110`/`20120`/`20170`）
2. `db/game_manage/seeds/lol_batch_c_adc_items_seed.sql`（若 Batch-C / `item_3004` 尚未写入）
3. `db/game_manage/seeds/lol_generic_manamune_awe_seed.sql`
4. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-manamune-awe-manaflow-max-state-phase-a-v2-20260726`（seed 不负责 publish）。

Wiki-only 真源：Module:ItemData/data revid `4030984` / timestamp `2026-06-17T23:47:20Z` / content SHA `e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d`（item 静态 mana 500；Manaflow 上限 +360；Awe 2% maximum mana）。

该 seed 会：锁定 `game_data_state`；校验 `item_3004` 与 `ad`/`mana` 属性定义及所需 reserved types（check-only，不改静态行）；幂等投影所需 reserved → `types`；向 `item_3004` 独占 mount **两个隔离** passive providers：

1. `provider_item_3004_manamune_awe`：source-bound `ad` add（`selector/self` + `value_policy/add`），公式 `mul(0.02, source.attr.mana.resolved)`（**读 resolved，不读 max**）
2. `provider_item_3004_manamune_manaflow_max_state`：source-bound `mana` add，公式 `{"op":"const","value":360}`（直达最大态近似：始终 on 的 `mana.resolved += 360`）

每个 provider 恰好一公式 + 一 modifier。运行时依赖 two-pass（Manaflow 先贡献 `mana.resolved`，Awe 再读 resolved）；本近似用 resolved 而非 `mana.max` / resource mana。不写 provider state / listener / effect / ability / operation / lifecycle，不写 `game_entities` / `attribute_definitions` / `entity_attribute_values` / resource 表，不改 Batch-C 静态属性。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

**排除（完整保真外）**：8s 充能、四充能队列、on-hit/ability 触发、+3/+6 增量、per-cast throttle、Muramana 变形/替换、Base/Current/Max 或 resource mana 突变、资源花费、攻击事件、随机/RNG。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericManamuneAweSeedSqlTest,LolBatchCAdcItemsSeedSqlTest test
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

### LoL generic Graves Smoke Screen primary-hit seed（格雷福斯 W / Phase-A v2 主目标 impact）

在 reserved types 与所需 `attribute_definitions`（`hp`/`mana`/`ad`/`ap`/`attack_speed`/`armor`/`magic_resist`/`hp_regen`/`mana_regen`）已就绪后，按顺序执行（**自包含** ensure `hero_graves` 最低必要实体/level-1 面板/mana 资源 + 可 cast 的 W active；与既有 New Destiny P / Quickdraw E provider 并存，不重建/替换、不触碰 `bonus_armor`/`bonus_magic_resist`；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20221`/`20260`）
2. `db/game_manage/seeds/lol_generic_graves_smoke_screen_primary_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-graves-smoke-screen-primary-hit-phase-a-v2-20260722`（seed 不负责 publish）。候选 `hero_skill|hero_graves|W|烟幕弹` 冻结为 **Phase-A rank-5 立即主目标 impact scaffold**（`FROZEN_PLAN_REV=graves-w-smoke-screen-primary-hit-phase-a-v2`）：

`rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_60_ap; no_cast_delay_projectile_geometry_aoe_slow_smoke_cloud_nearsight_or_sight_reduction`

该 seed 会：锁定 `game_data_state`；校验所需 reserved / 恰好九键属性定义（含 AP）；幂等投影 reserved → `types`；ensure `hero_graves`（`ON CONFLICT DO NOTHING`，不改写既有 P/E 描述）与 level-1 面板（hp625 / mana325 / ad66 / ap0 / AS0.475 / armor33 / MR30 / hpregen8 / manaregen8；既有八键与 P/E 字节一致，仅新增 AP0；AP200 仅测试夹具、seed 不写）、`resource_definitions.mana` 与 `entity_resource_values`（325/325）；向 `hero_graves` **仅** mount 独立 `provider_hero_graves_w_smoke_screen_primary_hit`（与 `provider_hero_graves_new_destiny` / `provider_hero_graves_quickdraw_max_stack` 并存），含 active `ability_hero_graves_w_smoke_screen_primary_hit`（`ability_key=smoke_screen`）、`ability_costs` 90 mana、`ability_cooldowns` 18000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 magic damage `260 + 0.60*AP`（`copyable_on_hit=false`，非 crit；运行时类型 `20221`）。Wiki：request `Template:Data Graves/W` → resolved `Template:Data Graves/Smoke Screen`；page1307368 / rev3956197 / `2025-09-26T13:12:00Z` / canonical 2441 bytes / SHA256 `20348473fe3441eb32ab656423f577a62a415fadf33fbdc6fcf576bc8b1d210d`；sidecar `normalized/generic/graves-w.json`（siblings `pages/graves-w.json`、`raw/graves-w.wikitext`）。**same-length materialization caveat**：仓库 local raw 亦 2441 bytes 但 SHA256 `fa0bf66135a20fc34e704f2ba4fb12e7e811656dee28f03d1c44b101f35246b2`（CRLF=0）；canonical 身份以 sidecar/pages 为准，不断言 local raw hash 相等。夹具交叉核对（注释）：AP200=>raw380、MR100=>mitigated190；t0/t17999/t18000 恰好两命中+一冷却跳过；mana325->145、HP1000->620。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

**排除**：cast-delay/cast-completion、projectile/travel/collision/location/geometry/AOE/multitarget、slow、smoke cloud/field、nearsight/sight reduction/spellshield、ranks1–4、P/E/on-hit/equipment 耦合、listener/state/event/modifier/repeat、bonus_armor/bonus_magic_resist 读写、live migration、publish；不依赖既有 Graves P/E provider 发布顺序。

静态契约校验（不连 live DB；含邻近 Graves P/E）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericGravesSmokeScreenPrimaryHitSeedSqlTest,LolGenericGravesNewDestinySeedSqlTest,LolGenericGravesQuickdrawMaxStackSeedSqlTest test
```

### LoL generic Graves Collateral Damage primary-hit seed（格雷福斯 R / Phase-A v2 主目标 impact）

在 reserved types 与所需 `attribute_definitions`（`hp`/`mana`/`ad`/`ap`/`attack_speed`/`armor`/`magic_resist`/`hp_regen`/`mana_regen`）已就绪后，按顺序执行（**自包含** ensure `hero_graves` 最低必要实体/level-1 面板/mana 资源 + 可 cast 的 R active；与既有 New Destiny P / Quickdraw E / Smoke Screen W provider 并存，不重建/替换、不触碰 `bonus_armor`/`bonus_magic_resist`；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20220`/`20260`）
2. `db/game_manage/seeds/lol_generic_graves_collateral_damage_primary_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-graves-collateral-damage-primary-hit-phase-a-v2-20260723`（seed 不负责 publish）。候选 `hero_skill|hero_graves|R|终极爆弹` 冻结为 **Phase-A rank-3 立即主目标 impact scaffold**（`FROZEN_PLAN_REV=graves-r-collateral-damage-primary-hit-phase-a-v2`）：

`rank3_primary_target_single_hit; immediate_impact_scaffold; physical_575_plus_1_50_bonus_ad; no_cast_delay_recoil_projectile_geometry_line_multitarget_explosion_cone_or_reduced_damage`

该 seed 会：锁定 `game_data_state`；校验所需 reserved / 恰好九键属性定义（含 AP）；幂等投影 reserved → `types`；ensure `hero_graves`（`ON CONFLICT DO NOTHING`，不改写既有 P/E/W 描述）与 level-1 面板（hp625 / mana325 / ad66 / ap0 / AS0.475 / armor33 / MR30 / hpregen8 / manaregen8；九键与 P/E/W 字节一致，含 AP0；flat+54 AD / armor100 仅测试夹具、seed 不写）、`resource_definitions.mana` 与 `entity_resource_values`（325/325）；向 `hero_graves` **仅** mount 独立 `provider_hero_graves_r_collateral_damage_primary_hit`（与 `provider_hero_graves_new_destiny` / `provider_hero_graves_quickdraw_max_stack` / `provider_hero_graves_w_smoke_screen_primary_hit` 并存），含 active `ability_hero_graves_r_collateral_damage_primary_hit`（`ability_key=collateral_damage`）、`ability_costs` 100 mana、`ability_cooldowns` 60000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 physical damage `575 + 1.50*(ad.resolved - ad.base)`（`copyable_on_hit=false`，非 crit；运行时类型 `20220`）。主弹壳目标为完整直接伤害；爆炸锥 reduced damage 仅对额外敌人，本边界不建模。Wiki：request `Template:Data Graves/R` → resolved `Template:Data Graves/Collateral Damage`；sidecar 注释路径 `normalized/generic/graves-r.json`（siblings `pages/graves-r.json`、`raw/graves-r.wikitext`）。夹具交叉核对（注释）：base AD66 + flat54 => resolved120 / bonus54 / raw656；armor100 => mitigated328。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

**排除**：cast-delay/cast-completion、recoil/dash、projectile/travel/collision/direction/geometry/line/AOE/multitarget、explosion/cone/reduced damage、ranks1–2、P/E/W/basic/ammo/reload/True Grit/on-hit/equipment 耦合、listener/state/event/modifier/repeat、bonus_armor/bonus_magic_resist 读写、live migration、publish；不依赖既有 Graves P/E/W provider 发布顺序。

静态契约校验（不连 live DB；含邻近 Graves P/E/W）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericGravesCollateralDamagePrimaryHitSeedSqlTest,LolGenericGravesSmokeScreenPrimaryHitSeedSqlTest,LolGenericGravesQuickdrawMaxStackSeedSqlTest,LolGenericGravesNewDestinySeedSqlTest test
```

### LoL generic Graves End of the Line first outbound-pass seed（格雷福斯 Q / Phase-A v2 选定主冠军首段出站单次物理命中）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_graves)`、`attribute_definitions(ad)`、`entity_attribute_values(hero_graves,ad)`、`resource_definitions(mana)`、`entity_resource_values(hero_graves,mana)` 已存在后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**物化身份/面板/资源值——既有 Graves P/E/W/R/basic sibling seed 若已写入这些行仅作 ambient 供给，**不是**硬前置；不以 ensure-entity legacy seeds 为理由物化前置；仅挂载可 cast 的 Q active **选定主冠军首段出站单次物理命中**；与既有/未来 P（New Destiny）/ E（Quickdraw）/ W（Smoke Screen）/ R（Collateral Damage）/ basic **并存**但不依赖/不突变/不合成/不复制；本 seed **不得**含任何 E True Grit rows/modifiers；不做 live migration、不自动 publish、不连 live DB 执行本 seed；**本 seed 非自包含**）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20220`/`20260`；不含 `20230`）
2. `db/game_manage/seeds/lol_generic_graves_end_of_the_line_first_outbound_pass_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish；本任务亦不执行该可选 publish 步骤）

建议发布版本：`lol-generic-graves-end-of-the-line-first-outbound-pass-phase-a-v2-20260726`（seed 不负责 publish）。候选 `hero_skill|hero_graves|Q|穷途末路`（task `wasm-generic-graves-end-of-the-line-first-outbound-pass`）冻结为 **Phase-A rank-5 立即选定主冠军首段出站单次物理命中 impact scaffold**（`FROZEN_PLAN_REV=graves-q-end-of-the-line-first-outbound-pass-phase-a-v2`）：

`rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_scaffold; physical_150_plus_0_65_bonus_ad; no_cast_time_direction_range_width_line_geometry_projectile_travel_pass_through_multitarget_powder_trail_delayed_2s_or_terrain_0_2s_detonation_perpendicular_area_reverse_wave_second_pass_total_damage_once_per_pass_spellshield_windwall_terrain_interaction_other_ranks_or_full_fidelity`

Ordered tags：`ability_cost_cooldown` → `active_physical_damage` → `bonus_ad_ratio` → `immediate_impact_scaffold`。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_graves` / `ad` 定义与实体值 / `mana` 资源定义与实体资源值做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`）；幂等投影 reserved → `types`；向 `hero_graves` **仅** mount 独立 `provider_hero_graves_q_end_of_the_line_first_outbound_pass`（stable id `hero_graves_q_end_of_the_line_first_outbound_pass`；standalone；不创建/突变 P/E/W/R/basic），含 active `ability_hero_graves_q_end_of_the_line_first_outbound_pass`（`ability_key=end_of_the_line_first_outbound_pass`）、`ability_costs` 80 mana、`ability_cooldowns` 6000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 physical damage `150 + 0.65*(ad.resolved-ad.base)`（**bonus AD**；嵌套二元 `add(const 150, mul(const 0.65, sub(read …resolved, read …base)))`；每条 read path 恰好一次；`copyable_on_hit=false`，非 crit；运行时类型 `20220` + add policy `20170`；禁止可执行图/`required reserved` 使用 `20230=provider_action/apply`）；**零** provider state / modifiers / listeners / matchers / explicit events / repeats / control / secondary / channel / projectile / geometry / movement / powder trail / detonation 行；**不含** E True Grit / `true_grit_stacks` / `bonus_armor` / `bonus_magic_resist`。**Q 无 ability-specific game-local type**，不新增 Q 专用 62xxx type、不写 `type_relations`。Q/E isolation：test-only composition of independent graphs；Q does not alter True Grit；E produces no Q damage；Do not copy E into this seed。成功 cast 由 runtime 自动发出 `ability_started`（本 Q 图不添加 listener / event step）。Immediate selected-primary-champion first-outbound-pass physical hit 为 Phase-A scaffold，不是实际 cast time/direction/range/width/line/projectile/trail/detonation/second-pass/full-Q fidelity。Wiki：request `Template:Data Graves/Q` → resolved `Template:Data Graves/End of the Line`；page1307367 / rev4007501 / `2026-04-11T22:23:57Z` / canonical 2266 bytes / SHA256 `c18840004febd305484392c882680939efe9fc609d4f733f81824439741345c5`；sidecar `normalized/generic/graves-q.json` + pages sibling（Wasm repo authoritative）。**local raw materialization caveat**：仓库 local raw 2265 / `cd2744fb1f28e54bd3b5e25b96cb1d21babc0583bfd8e854d55c15ed83df0377`；同 size 不等于等价；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾（仅 materialization/serialization caveat）。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

确定性夹具（注释记录；不连 live / 不执行 runtime）：`base0/resolved0/armor0` raw/final150；`base60/resolved60/armor0` raw/final150；`base60/resolved160/armor0` raw/final215；same armor100 raw215/final107.5；`base60/resolved260/armor100` raw280/final140；`base0/resolved100` vs `base60/resolved160` at armor0 both raw/final215（bonusAD counterproof）；mana240/baseAD60/resolvedAD160/targetHP1000/armor100 在 t0/t5999/t6000 → success/cooldown skip/success、exactly two Q hits and automatic starts、readyAt6000、final mana80/HP785；mana79 → resource skip、unchanged mana/HP、no Q damage/start；Q/E isolation；standalone provider 不合成 P/E/W/R/basic。

**排除**（completed-boundary exclusions；不得实现或描述为近似）：cast time/direction/range/width/line geometry；projectile speed/travel/pass-through/multiple targets；powder trail persistence and terrain/collision model；delayed 2s or terrain 0.2s detonation/perpendicular area/reverse wave/second-pass/total damage；once-per-pass gate/spellshield/Wind Wall/Braum terrain interactions；ranks1–4；P/E/W/R/basic/loadout/crit/on-hit；identity/panel/resource bootstrap；listener/state/event/modifier/repeat/control/secondary/movement/geometry/trail/detonation/sibling；live migration；publish；E2E/live/full fidelity。One selected-target first-outbound-pass physical hit, not full Q。

静态契约校验（不连 live DB；含邻近 Graves R/W physical/magic primary-impact、Graves E/P sibling-preservation，以及 Tristana W selected-primary salvage / check-only 先例）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericGravesEndOfTheLineFirstOutboundPassSeedSqlTest,LolGenericGravesCollateralDamagePrimaryHitSeedSqlTest,LolGenericGravesSmokeScreenPrimaryHitSeedSqlTest,LolGenericGravesQuickdrawMaxStackSeedSqlTest,LolGenericGravesNewDestinySeedSqlTest,LolGenericTristanaRocketJumpPrimaryLandingHitSeedSqlTest test
```

### LoL generic Senna Last Embrace first-enemy-hit seed（赛娜 W / Phase-A v2 选定主冠军第一敌人单次物理命中）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_senna)`、`attribute_definitions(ad)`、`entity_attribute_values(hero_senna,ad)`、`resource_definitions(mana)`、`entity_resource_values(hero_senna,mana)` 已存在后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**物化身份/面板/资源值——当前仓库亦无 Senna P/Q/E/R/basic sibling seed / materializer；仅挂载可 cast 的独立 W active **选定主冠军第一敌人单次物理命中**；standalone sibling absence：不创建/突变/合成/复制 P/Q/E/R/basic；不做 live migration、不自动 publish、不连 live DB 执行本 seed；**本 seed 非自包含**）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20220`/`20260`；不含 `20230`）
2. `db/game_manage/seeds/lol_generic_senna_last_embrace_first_enemy_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish；本任务亦不执行该可选 publish 步骤）

建议发布版本：`lol-generic-senna-last-embrace-first-enemy-hit-phase-a-v2-20260726`（seed 不负责 publish）。候选 `hero_skill|hero_senna|W|无尽厮守`（task `wasm-generic-senna-last-embrace-first-enemy-hit`）冻结为 **Phase-A rank-5 立即选定主冠军第一敌人单次物理命中 impact scaffold**（`FROZEN_PLAN_REV=senna-w-last-embrace-first-enemy-hit-phase-a-v2`）：

`rank5_selected_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold; physical_230_plus_0_90_bonus_ad; no_cast_time_effect_at_cast_time_end_direction_range_width_line_geometry_projectile_travel_collision_first_enemy_acquisition_attachment_1s_target_death_early_spread_delayed_root_primary_or_surrounding_aoe_untargetable_interaction_spellshield_other_ranks_or_full_fidelity`

Ordered tags：`ability_cost_cooldown` → `active_physical_damage` → `bonus_ad_ratio` → `immediate_impact_scaffold`。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_senna` / `ad` 定义与实体值 / `mana` 资源定义与实体资源值做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`）；幂等投影 reserved → `types`；向 `hero_senna` **仅** mount 独立 `provider_hero_senna_w_last_embrace_first_enemy_hit`（stable id `hero_senna_w_last_embrace_first_enemy_hit`；standalone；不创建/突变/合成/复制 P/Q/E/R/basic），含 active `ability_hero_senna_w_last_embrace_first_enemy_hit`（`ability_key=last_embrace_first_enemy_hit`）、`ability_costs` 70 mana、`ability_cooldowns` 11000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 physical damage `230 + 0.90*(ad.resolved-ad.base)`（**bonus AD**；嵌套二元 `add(const 230, mul(const 0.90, sub(read …resolved, read …base)))`；每条 read path 恰好一次；`copyable_on_hit=false`，非 crit；运行时类型 `20220` + add policy `20170`；禁止可执行图/`required reserved` 使用 `20230=provider_action/apply`）；**零** provider state / modifiers / listeners / matchers / explicit events / repeats / control / secondary / channel / projectile / geometry / movement / attachment / root / AOE 行。**W 无 ability-specific game-local type**，不新增 W 专用 62xxx type、不写 `type_relations`。成功 cast 由 runtime 自动发出 `ability_started`（本 W 图不添加 listener / event step）。Immediate selected-primary-champion first-enemy physical hit 为 Phase-A scaffold，不是实际 cast time / Effect at cast time end / direction / range / width / line / projectile / collision / first-enemy acquisition / 1s attachment / target-death early spread / delayed root / surrounding AOE / untargetable / spellshield / full-W fidelity。Wiki：request `Template:Data Senna/W` → resolved `Template:Data Senna/Last Embrace`；page1409576 / rev4009139 / `2026-04-15T21:34:10Z` / canonical 1656 bytes / SHA256 `48698aa2864b79564b1ea0ed624de8fc7123c3127c1e56deaa002d1aad3c8492`；sidecar `normalized/generic/senna-w.json`（bytes 2120 / SHA256 `c570469e807dcf9a0713af6bb0da3ab8d3be1bc61f192a307b59e7a10a5fdc8b`）+ `pages/senna-w.json`（bytes 685 / SHA256 `7f9ffc935d079acb610a07925eccb865b2baf7ecabe16784960d34e2341f41f4`；Wasm repo authoritative）。**local raw materialization caveat**：仓库 local raw 1651 / `737cc69b6ea13da8d61437e3da37a799cc2779bd56516d166af5890dc6090d5e`；同 size 不等于等价；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾（仅 materialization/serialization caveat）。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

确定性夹具（注释记录；不连 live / 不执行 runtime）：`base0/resolved0/armor0` raw/final230；`base60/resolved60/armor0` raw/final230；`base60/resolved160/armor0` raw/final320；same armor100 raw320/final160；`base60/resolved260/armor100` raw410/final205；`base0/resolved100` vs `base60/resolved160` at armor0 both raw/final320（bonusAD counterproof）；mana210/baseAD60/resolvedAD160/targetHP1000/armor100 在 t0/t10999/t11000 → success/cooldown skip/success、exactly two W hits and automatic starts、readyAt11000、final mana70/HP680；mana69 → resource skip、unchanged mana/HP、no W damage/start；standalone isolation mounts only this W and synthesizes no P/Q/E/R/basic provider/state/modifier/listener/root/control/secondary-target structure（standalone sibling absence）。

**排除**（completed-boundary exclusions；不得实现或描述为近似）：cast time / Effect at cast time end；direction/range/width/line geometry；projectile speed/travel/collision/actual first-enemy acquisition；one-second attachment / target-death early spread；delayed root / primary or surrounding root / root duration；surrounding AOE / multiple targets；untargetable interaction / spellshield / projectile interception；ranks1–4；P/Q/E/R/basic/loadout/crit/on-hit；identity/panel/resource bootstrap；listener/state/event/modifier/repeat/control/secondary/movement/geometry/attachment/root/AOE/sibling；live migration；publish；E2E/live/full fidelity。One selected-primary-champion first-enemy single physical hit, not full W。

静态契约校验（不连 live DB；含邻近 Graves Q selected-primary physical bonus-AD immediate-impact，以及 Jinx W / Kalista Q / Caitlyn E first-enemy-impact 先例，另含最近 bonus-AD primary-hit）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericSennaLastEmbraceFirstEnemyHitSeedSqlTest,LolGenericGravesEndOfTheLineFirstOutboundPassSeedSqlTest,LolGenericJinxZapPrimaryHitSeedSqlTest,LolGenericKalistaPiercePrimaryHitSeedSqlTest,LolGenericCaitlyn90CaliberNetPrimaryHitSeedSqlTest,LolGenericGravesCollateralDamagePrimaryHitSeedSqlTest,LolGenericVarusHailOfArrowsPrimaryHitSeedSqlTest test
```

### LoL generic Senna Dawning Shadow primary-hit seed（赛娜 R / Phase-A v3 选定主敌方冠军单次物理命中）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_senna)`、`attribute_definitions(ad)`、`entity_attribute_values(hero_senna,ad)`、`attribute_definitions(ap)`、`entity_attribute_values(hero_senna,ap)`、`resource_definitions(mana)`、`entity_resource_values(hero_senna,mana)` 已存在后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**物化身份/面板/资源值——当前仓库亦无 Senna identity/panel/resource materializer；仅挂载可 cast 的独立 R active **选定主敌方冠军单次物理命中**；**preserve existing W** `provider_hero_senna_w_last_embrace_first_enemy_hit` / Last Embrace，不要求/突变/复制/合成 W；standalone sibling absence：不创建/突变/合成/复制 P/Q/W/E/basic；不做 live migration、不自动 publish、不连 live DB 执行本 seed；**本 seed 非自包含**）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20220`/`20260`；不含 `20230`）
2. `db/game_manage/seeds/lol_generic_senna_dawning_shadow_primary_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish；本任务亦不执行该可选 publish 步骤）

建议发布版本：`lol-generic-senna-dawning-shadow-primary-hit-phase-a-v3-20260726`（seed 不负责 publish）。候选 `hero_skill|hero_senna|R|暗影燎原`（task `wasm-generic-senna-dawning-shadow-primary-hit`）冻结为 **Phase-A rank-3 立即选定主敌方冠军单次物理命中 impact scaffold**（`FROZEN_PLAN_REV=senna-r-dawning-shadow-primary-hit-phase-a-v3`）：

`rank3_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold; physical_550_plus_1_15_bonus_ad_plus_0_70_ap; no_cast_time_effect_at_cast_time_start_queue_time_global_direction_broad_or_narrow_wave_geometry_width_projectile_travel_speed_destruction_aoe_multitarget_enemy_reveal_self_reveal_allied_or_self_shield_mist_scaling_mist_wraith_hits_path_sight_spellshield_other_ranks_or_full_fidelity`

Ordered tags：`ability_cost_cooldown` → `active_physical_damage` → `bonus_ad_ratio` → `ap_ratio` → `immediate_impact_scaffold`。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_senna` / `ad`+`ap` 定义与实体值 / `mana` 资源定义与实体资源值做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`）；幂等投影 reserved → `types`；向 `hero_senna` **仅** mount 独立 `provider_hero_senna_r_dawning_shadow_primary_hit`（stable id `hero_senna_r_dawning_shadow_primary_hit`；standalone；不创建/突变/合成/复制 P/Q/W/E/basic；与既有 Senna W Last Embrace 并存且不突变），含 active `ability_hero_senna_r_dawning_shadow_primary_hit`（`ability_key=dawning_shadow_primary_hit`）、`ability_costs` 100 mana、`ability_cooldowns` 100000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 physical damage `550 + 1.15*(ad.resolved-ad.base) + 0.70*ap.resolved`（**bonus AD** + AP；嵌套二元 `add(add(const 550, mul(const 1.15, sub(read …resolved, read …base))), mul(const 0.70, read …ap.resolved))`；每条 read path 恰好一次；`copyable_on_hit=false`，非 crit；运行时类型 `20220` + add policy `20170`；禁止可执行图/`required reserved` 使用 `20230=provider_action/apply`）；**零** provider state / modifiers / listeners / matchers / explicit events / repeats / control / projectile / shield / sight / reveal / Mist / Wraith 行。**R 无 ability-specific game-local type**，不新增 R 专用 62xxx type、不写 `type_relations`。成功 cast 由 runtime 自动发出 `ability_started`（本 R 图不添加 listener / event step）。Immediate selected-primary-enemy-champion physical hit 为 Phase-A scaffold，不是实际 cast time / Effect at cast time start / queue time / global / direction / broad or narrow wave geometry / width / projectile travel / speed / destruction AOE / multitarget / enemy reveal / self reveal / allied or self shield / Mist scaling / Mist Wraith hits / path sight / spellshield / full-R fidelity。Wiki：request `Template:Data Senna/R` → resolved `Template:Data Senna/Dawning Shadow`；page1409580 / rev4008033 / `2026-04-13T04:08:13Z` / canonical 2356 bytes / SHA256 `4de188cce3d04f172d37f07db4e7c8e240388c5346f56838c82a3e6205c9de36`；sidecar `normalized/generic/senna-r.json`（bytes 2597 / SHA256 `79ced482a8489f211cacba8cedd4fe0f02a87f0360c5bf95d824c1d735f66307`）+ `pages/senna-r.json`（bytes 689 / SHA256 `9b7fcb0a8e28dbbe38b6e890966421a6857772c2029315225e59bd041f9e704e`；Wasm repo authoritative）。**local raw materialization caveat**：仓库 local raw 2353 / `1b448ff48b9fe906a13056f2f510e38ff96fcad410462972a93dbd3bb93195dc`；同 size 不等于等价；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾（仅 materialization/serialization caveat）。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

确定性夹具（注释记录；不连 live / 不执行 runtime）：`base60/resolved60/AP0/armor0` raw/final550；`base60/resolved160/AP0/armor0` raw/final665；`base60/resolved60/AP100/armor0` raw/final620；`base60/resolved160/AP100/armor0` raw/final735；`base60/resolved140/AP100/armor100` raw712/final356；`base60/resolved220/AP100/armor100` raw804/final402；`base0/resolved100` vs `base60/resolved160` at AP0/armor0 both665（bonusAD counterproof）；mana300/base60/resolved140/AP100/HP1000/armor100 在 t0/t99999/t100000 → success/cooldown skip/success、exactly two R hits and automatic starts、readyAt100000、final mana100/HP288；mana99 → resource skip、unchanged mana/HP、no R damage/start；standalone isolation mounts only this R and synthesizes no P/Q/W/E/basic provider/state/modifier/listener/shield/control/secondary-target structure（standalone sibling absence）；preserve existing W，不要求 W。

**排除**（completed-boundary exclusions；不得实现或描述为近似）：cast time / Effect at cast time start / queue time；global/direction/broad or narrow wave geometry/width；projectile travel/speed/destruction AOE/multitarget；enemy reveal/self reveal/allied or self shield；Mist scaling/Mist Wraith hits/path sight/spellshield；ranks1–2；P/Q/W/E/basic/loadout/crit/on-hit；identity/panel/resource bootstrap；listener/state/event/modifier/repeat/control/projectile/shield/sight/reveal/Mist/Wraith/sibling；live migration；publish；E2E/live/full fidelity。One selected-primary-enemy-champion single physical hit, not full R。

静态契约校验（不连 live DB；含邻近 Senna W same-hero preservation/check-only physical，以及 Tristana R / Ezreal R / Corki Q / Tristana W / Quinn Q bonusAD+AP 或邻近 immediate-impact 先例）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericSennaDawningShadowPrimaryHitSeedSqlTest,LolGenericSennaLastEmbraceFirstEnemyHitSeedSqlTest,LolGenericEzrealTrueshotBarragePrimaryHitSeedSqlTest,LolGenericTristanaBusterShotPrimaryHitSeedSqlTest,LolGenericTristanaRocketJumpPrimaryLandingHitSeedSqlTest,LolGenericQuinnBlindingAssaultPrimaryHitSeedSqlTest,LolGenericCorkiPhosphorusBombPrimaryImpactSeedSqlTest test
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

### LoL generic Kog'Maw Void Ooze primary-hit seed（克格莫 E / Phase-A v1 主目标 impact）

在 reserved types 与所需 `attribute_definitions`（`hp`/`mana`/`ad`/`ap`/`attack_speed`/`armor`/`magic_resist`/`hp_regen`/`mana_regen`）已就绪后，按顺序执行（**自包含** ensure `hero_kogmaw` 最低必要实体/level-1 面板/mana 资源 + 可 cast 的 E active；与既有普攻 / Bio-Arcane Barrage / Caustic Spittle provider 并存，不重建/替换；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20221`/`20260`）
2. `db/game_manage/seeds/lol_generic_kogmaw_void_ooze_primary_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-kogmaw-void-ooze-primary-hit-phase-a-v1-20260722`（seed 不负责 publish）。候选 `hero_skill|hero_kogmaw|E|虚空淤泥` 冻结为 **Phase-A rank-5 立即主目标 impact scaffold**（`FROZEN_PLAN_REV=kogmaw-e-void-ooze-primary-hit-phase-a-v1`）：

`rank5_primary_target_single_hit; immediate_impact_scaffold; magic_230_plus_0_65_ap; no_projectile_geometry_multitarget_slow_field_or_duration`

该 seed 会：锁定 `game_data_state`；校验所需 reserved / 恰好九键属性定义（含 AP）；幂等投影 reserved → `types`；ensure `hero_kogmaw`（`ON CONFLICT DO NOTHING`）与 level-1 面板（hp635 / mana325 / ad61 / ap0 / AS0.665 / armor24 / MR30 / hpregen0.75 / manaregen1.75；AP100 仅测试夹具、seed 不写）、`resource_definitions.mana` 与 `entity_resource_values`（325/325）；向 `hero_kogmaw` **仅** mount 独立 `provider_hero_kogmaw_e_void_ooze_primary_hit`（与 `provider_hero_kogmaw_basic_attack` / `provider_hero_kogmaw_bio_arcane_barrage` / `provider_hero_kogmaw_caustic_spittle` 并存），含 active `ability_hero_kogmaw_e_void_ooze_primary_hit`（`ability_key=void_ooze`）、`ability_costs` 100 mana、`ability_cooldowns` 12000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 magic damage `230 + 0.65*AP`（`copyable_on_hit=false`，非 crit）。Wiki：page1307961 / rev3965135 / `2025-11-11T17:05:55Z` / 1356 bytes / SHA256 `1dd448ea1985237f002dec43e2bf93d860eb976f7c98e75883254cb3cf70794b`；sidecar `normalized/generic/kogmaw-e.json`。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

**排除**：missile/projectile/travel/collision/path/range/width/speed/geometry、all-enemies/multi-target、repeated hits、ooze field/path blobs/every125 units/3s duration、slow60%/0.25s ticks/linger、cast-delay phase（Wiki cast-time-start 仅兼容 scaffold）、ranks1–4、basic/Bio-Arcane/Caustic Spittle/on-hit/equipment 耦合、listener/state/event/modifier/repeat、live migration、publish；不依赖既有 Kog'Maw provider 发布顺序。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericKogmawVoidOozePrimaryHitSeedSqlTest test
```

### LoL generic Kog'Maw Living Artillery seed（克格莫 R / Phase-A v2 活体大炮）

在 reserved types、Batch-B `lol_batch_b_adc_entities_seed.sql`（`hero_kogmaw` + `hp`/`ad`/`ap`/`mana`/`magic_resist`），以及既有 `resource_definitions(mana)` / `entity_resource_values(hero_kogmaw,mana)` 已就绪后，按顺序执行（**前置为** reserved types + Batch-B + 既有 mana 资源行；mana 可由 Caustic Spittle / Void Ooze 等既有 seed 提供；**不** require basic/Bio-Arcane/Caustic Spittle/Void Ooze provider 为硬前置；seed **check-only**，不写身份/面板/成长/mana 资源；既有 Kog'Maw provider 若存在则保留；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20100`/`20110`/`20111`/`20120`/`20130`/`20142`/`20150`/`20160`/`20170`/`20190`/`20221`/`20250`/`20260`）
2. `db/game_manage/seeds/lol_batch_b_adc_entities_seed.sql`（若 Batch-B / `hero_kogmaw` / 所需属性尚未写入）
3. 既有 mana 资源行（例如先跑 `lol_generic_kogmaw_caustic_spittle_seed.sql` 或 `lol_generic_kogmaw_void_ooze_primary_hit_seed.sql`，若尚未投影）
4. `db/game_manage/seeds/lol_generic_kogmaw_living_artillery_seed.sql`
5. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-kogmaw-living-artillery-phase-a-v2-20260723`（seed 不负责 publish）。候选 `hero_skill|hero_kogmaw|R|活体大炮`（task `wasm-generic-kogmaw-living-artillery`）冻结为 **Phase-A rank-3 立即主目标 Living Artillery impact scaffold**（`FROZEN_PLAN_REV=kogmaw-r-living-artillery-phase-a-v2`）：

`rank3_primary_target_living_artillery; immediate_impact_scaffold; magic_180_plus_0_75_bonus_ad_plus_0_45_ap_with_missing_health_multiplier; escalating_mana_40_plus_40_per_stack_max9_for_8000ms; no_delay_location_geometry_multitarget_sight_reveal_or_stealth`

Ordered tags：`ability_cost_cooldown` → `active_magic_damage` → `bonus_ad_and_ap_ratio` → `missing_health_damage_multiplier` → `stack_escalating_mana_cost` → `timed_provider_state`。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_kogmaw` / `attribute_definitions(hp,ad,ap,mana,magic_resist)` / `entity_attribute_values(hero_kogmaw,…)` / `resource_definitions(mana)` / `entity_resource_values(hero_kogmaw,mana)` 做 **fail-closed check-only**（缺失即回滚；不写 `games` / `game_entities` / `attribute_definitions` / `entity_attribute_values` / `resource_definitions` / `entity_resource_values` / progression）；幂等投影 reserved → `types`；向 `hero_kogmaw` **仅** mount 独立 `provider_hero_kogmaw_r_living_artillery`（与既有 `provider_hero_kogmaw_basic_attack` / `provider_hero_kogmaw_bio_arcane_barrage` / `provider_hero_kogmaw_caustic_spittle` / `provider_hero_kogmaw_e_void_ooze_primary_hit` 并存，不更新/删除/重建；Q/E/W/basic **不是**硬前置），含 timed `living_artillery_stacks`（explicit default0 / max9 / `duration_ms=8000` / refresh_on_write）、active `ability_hero_kogmaw_r_living_artillery`（`ability_key=living_artillery`）、动态 `ability_costs` 公式 `40*(1+provider.state.living_artillery_stacks)`（不扁平为常量）、`ability_cooldowns` 1000ms，以及恰好一个 null-duration impact phase + on_enter sequence 上的有序两步：① magic damage `180+0.75*bonusAD+0.45*AP` × missing-health exact multiplier（Exactly40% HP→1.5；strictly below40%→2；`copyable_on_hit=false`，非 crit）；② provider-scope `state_change` add const1 到 `living_artillery_stacks`（**零** `provider_listeners` / **零** `event/ability_started`·`event/source_owner` scaffold）。Wiki：request `Template:Data Kog'Maw/R` → resolved `Template:Data Kog'Maw/Living Artillery`；page1307963 / rev4007636 / `2026-04-12T08:34:32Z` / canonical 2453 bytes / SHA256 `32f8dd8d875aaf95cec2be9cfe4a5a5526881b956f2f23e06ab87dc331ca8641`；sidecar `normalized/generic/kogmaw-r.json` 与 `pages/kogmaw-r.json`。**local raw materialization caveat**：2452 / `11db6c16391dcbfa2c091e81399bff4b2a0abffcd468f71ea5e9d89759d5e447`；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。不暗示 live 执行或发布；**不 claim** 全保真 Kog'Maw R。

**排除**：0.6s landing delay；target-location/range/radius/projectile/arc/collision/travel/area geometry；multi-target；sight/reveal/stealth；ranks1–2；P/Q/W/E/basic/combos；equipment/runes/loadout；spell shield；animation；ability_started/source_owner listener scaffold；live migration；publish；browser E2E/full-game fidelity。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericKogmawLivingArtillerySeedSqlTest test
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

### LoL generic Twisted Fate Wild Cards primary-hit seed（卡牌大师 Q / Phase-A v2 主目标 impact）

在 reserved types 与所需 `attribute_definitions`（`hp`/`mana`/`ad`/`ap`/`attack_speed`/`armor`/`magic_resist`/`hp_regen`/`mana_regen`）已就绪后，按顺序执行（**自包含** ensure `hero_twistedfate` 最低必要实体/level-1 九键面板/mana 资源 + 可 cast 的 Q active；与既有普攻 / Stacked Deck provider 并存，不重建/替换、不读写 Stacked Deck 状态；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20221`/`20260`）
2. `db/game_manage/seeds/lol_generic_twisted_fate_wild_cards_primary_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-twisted-fate-wild-cards-primary-hit-phase-a-v2-20260722`（seed 不负责 publish）。候选 `hero_skill|hero_twistedfate|Q|万能牌` 冻结为 **Phase-A rank-5 立即主目标 impact scaffold**（`FROZEN_PLAN_REV=twisted-fate-q-wild-cards-primary-hit-phase-a-v2`）：

`rank5_primary_target_single_hit; immediate_impact_scaffold; magic_240_plus_0_50_bonus_ad_plus_0_85_ap; no_cast_delay_fan_three_card_cone_projectile_geometry_collision_or_multitarget`

该 seed 会：锁定 `game_data_state`；校验所需 reserved / 恰好九键属性定义（含 AP）；幂等投影 reserved → `types`；ensure `hero_twistedfate`（`ON CONFLICT DO NOTHING`，不改写既有 Stacked Deck 描述）与 level-1 面板（hp604 / mana333 / ad52 / ap0 / AS0.625 / armor24 / MR30 / hpregen1.1 / manaregen1.6；六键与 Stacked Deck 字节一致）、`resource_definitions.mana` 与 `entity_resource_values`（333/333）；向 `hero_twistedfate` **仅** mount 独立 `provider_hero_twistedfate_q_wild_cards_primary_hit`（与 `provider_hero_twistedfate_basic_attack` / `provider_hero_twistedfate_stacked_deck` 并存），含 active `ability_hero_twistedfate_q_wild_cards_primary_hit`（`ability_key=wild_cards`）、`ability_costs` 100 mana、`ability_cooldowns` 5000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 magic damage `240 + 0.50*(ad.resolved-ad.base) + 0.85*ap.resolved`（`copyable_on_hit=false`，非 crit；运行时类型 `20221`）。Wiki：page1309741 / rev3950864 / `2025-08-31T01:31:17Z` / 1237 bytes / SHA256 `9cdd62cc18d41a4bbe1e42ac8202b40a776f7da51c67c6f2fea37f9ed1f0d597`；sidecar `normalized/generic/twistedfate-q.json`。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

**排除**：cast delay；fan/three-card/cone projectile geometry；travel/collision/pass 运行时保真（once-per-pass 仅正当化一次主目标直击）；AOE/multi-target/all-enemies/repeat；spellshield；ranks1–4；basic/Stacked Deck/on-hit/equipment 耦合；listener/state/event/modifier/repeat；live migration；publish；不依赖既有 basic/Stacked Deck provider 发布顺序。

静态契约校验（不连 live DB；可与 Stacked Deck 静态契约一并跑）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericTwistedFateWildCardsPrimaryHitSeedSqlTest,LolGenericTwistedFateStackedDeckSeedSqlTest test
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

### LoL generic Draven Whirling Death primary outbound-hit seed（德莱文 R / Phase-A v2 选定主冠军首段出站单次物理命中）

在 reserved types 与所需 `attribute_definitions`（`hp`/`mana`/`ad`/`attack_speed`/`armor`/`magic_resist`/`hp_regen`/`mana_regen`；恰好八键，不要求 AP）已就绪后，按顺序执行（**自包含** ensure `hero_draven` 最低必要实体/level-1 面板/mana 资源 + 可 cast 的 R active；与既有/未来 Q Spinning Axe / W Blood Rush / E Stand Aside / 普攻 provider **并存**，不重建/替换、不读/不依赖 sibling 发布；不做 live migration、不自动 publish、不连 live DB 执行本 seed）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20220`/`20260`）
2. `db/game_manage/seeds/lol_generic_draven_whirling_death_primary_outbound_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-draven-whirling-death-primary-outbound-hit-phase-a-v2-20260726`（seed 不负责 publish）。候选 `hero_skill|hero_draven|R|冷血追命` 冻结为 **Phase-A rank-3 立即选定主冠军首段出站单次物理命中 impact scaffold**（`FROZEN_PLAN_REV=draven-r-whirling-death-primary-outbound-hit-phase-a-v2`）：

`rank3_selected_primary_champion_single_first_outbound_pass_hit; immediate_impact_scaffold; physical_400_plus_1_50_bonus_ad; no_cast_time_direction_projectile_travel_collision_sight_recast_reversal_return_homing_second_pass_execute_adoration_threshold_multitarget_damage_falloff_reset_map_edge_once_per_pass_geometry_or_full_fidelity`

该 seed 会：锁定 `game_data_state`；校验所需 reserved / 恰好八键属性定义（不含 AP）；幂等投影 reserved → `types`；ensure `hero_draven`（`ON CONFLICT DO NOTHING`）与 level-1 面板（hp675 / mana361 / ad62 / AS0.679 / armor29 / MR30 / hpregen3.75 / manaregen8.05）、`resource_definitions.mana` 与 `entity_resource_values`（361/361）；向 `hero_draven` **仅** mount 独立 `provider_hero_draven_r_whirling_death_primary_outbound_hit`（stable id `hero_draven_r_whirling_death_primary_outbound_hit`；与 `provider_hero_draven_q_spinning_axe` / `provider_hero_draven_w_blood_rush` / `provider_hero_draven_e_stand_aside` / `provider_hero_draven_basic_attack` 并存），含 active `ability_hero_draven_r_whirling_death_primary_outbound_hit`（`ability_key=whirling_death_primary_outbound_hit`）、`ability_costs` 100 mana、`ability_cooldowns` 80000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 physical damage `400 + 1.50*(ad.resolved-ad.base)`（嵌套二元；每条 read path 恰好一次；`copyable_on_hit=false`，非 crit；运行时类型 `20220` + add policy `20170`）。**零** provider state / modifiers / listeners / matchers / explicit events / repeats / control / projectile / geometry / multitarget 行；成功 cast 由 runtime 自动发出 `ability_started`（本 R 图不添加 event step）。Wiki：request `Template:Data Draven/R` → resolved `Template:Data Draven/Whirling Death`；page1307072 / rev4040576 / `2026-07-06T14:27:37Z` / canonical 3079 bytes / SHA256 `e38551b6eeefa0306cd40a3e15473c8983075f88edbe007915e3d9213a08adce`；sidecar `normalized/generic/draven-r.json`。**local raw materialization caveat**：仓库 local Wasm raw sibling 亦 3079 / `1110179b1771c03c8ff67b428d6fa7a5b0ba42caf19e241ce512a199ef812059`；同 size 不等于等价；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾（仅 materialization/serialization caveat）。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

确定性夹具（注释记录；不连 live / 不执行 runtime）：`base0/resolved0/armor0` raw/final400；`base62/resolved62/armor0` raw/final400；`base62/resolved162/armor0` raw/final550；same armor100 raw550/final275；`base0/resolved100` vs `base62/resolved162` at armor0 both raw/final550（bonusAD counterproof）；mana361/baseAD62/resolvedAD162/targetHP1000/armor100 在 t0/t79999/t80000 → success/cooldown skip/success、exactly two R hits and automatic starts、readyAt80000、final mana261/HP725；mana99 → resource skip、unchanged mana/HP、no R damage/start。

**排除**（completed-boundary exclusions；不得实现或描述为近似；亦不否认游戏内折返/处决/多目标等行为——仅不对本边界建模）：cast time/direction；projectile/travel/collision/sight；recast/reversal/return/homing/second pass；execute/Adoration threshold；multitarget/damage falloff/reset/map edge/once-per-pass geometry；ranks1–2；Q/W/E/basic/equipment/loadout 耦合；listener/state/event/modifier/repeat/control；live migration；publish；full fidelity。One selected-target first-outbound-pass physical hit, not full R。

静态契约校验（不连 live DB；含邻近 Draven Q/W/E 与 Graves R primary-hit 先例）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericDravenWhirlingDeathPrimaryOutboundHitSeedSqlTest,LolGenericDravenStandAsideSeedSqlTest,LolGenericDravenBloodRushSeedSqlTest,LolGenericDravenSpinningAxeSeedSqlTest,LolGenericGravesCollateralDamagePrimaryHitSeedSqlTest test
```

### LoL generic Vayne Tumble next-basic-attack bonus seed（薇恩 Q / Phase-A v2 下次普攻加成）

在 reserved types、Batch-B `hero_vayne`（`ad`/`ap`/`mana` EAV）、mana 资源行、Batch-B 普攻图 + `basic_attack_hit` emit 基线（`lol_vayne_silver_bolts_seed.sql` 或等价）、以及 `lol_generic_spellblade_seed.sql` 最小 `provider_hero_vayne_tumble` / `ability_hero_vayne_tumble`（`ability_key=tumble`）已就绪后，按顺序执行（**enrich** 既有 Tumble 身份；**check-only** 前置，不物化 entity/panel/AP/AD/mana/basic/mount；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20100`/`20110`/`20111`/`20120`/`20130`/`20142`/`20150`/`20160`/`20170`/`20172`/`20181`/`20190`/`20211`/`20212`/`20220`/`20250`/`20260`）
2. `db/game_manage/seeds/lol_batch_b_adc_entities_seed.sql`（`hero_vayne` + `ad`/`ap`/`mana`）
3. mana 资源行（其它 seed ensure；本脚本 **check-only**，不写 resource）
4. `db/game_manage/seeds/lol_vayne_silver_bolts_seed.sql`（或等价 `step_hero_vayne_basic_attack_emit_hit` / `event_ref_hero_vayne_basic_attack_hit`）
5. `db/game_manage/seeds/lol_generic_spellblade_seed.sql`（最小 tumble provider/ability/mount）
6. `db/game_manage/seeds/lol_generic_vayne_tumble_next_basic_attack_bonus_seed.sql`
7. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-vayne-tumble-next-basic-attack-bonus-phase-a-v2-20260726`（seed 不负责 publish）。候选 `hero_skill|hero_vayne|Q|闪避突袭` 冻结为 **Phase-A rank-5 next-BA bonus**（`FROZEN_PLAN_REV=vayne-q-tumble-next-basic-attack-bonus-phase-a-v2`）：

`rank5_next_basic_attack_bonus; cast_arm_provider_state; physical_1_15_ad_plus_0_50_ap; mana30_cooldown2000ms; no_dash_ba_reset_invisibility_lifesteal_crit_rng_or_full_tumble`

Ordered tags：`ability_cost_cooldown` → `cast_triggered_next_ba_arm` → `basic_attack_hit_bonus_damage` → `provider_state_consume`。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_vayne` / `attribute_definitions(ad,ap,mana)` / `entity_attribute_values(hero_vayne,ad|ap|mana)` / mana 资源行 / Batch-B 普攻图 / emit 基线 / 精确 Tumble provider·ability（`tumble`/`20130`）·mount 做 **fail-closed check-only**（缺失即回滚；**不写** `games` / `game_entities` / `attribute_definitions` / `entity_attribute_values` / `resource_*` / basic emit / mount）；幂等投影 reserved → `types`；**enrich** 既有 `provider_hero_vayne_tumble` / `ability_hero_vayne_tumble`（稳定 ID/key/type；display 散文可改，**非**兼容不变量；旧 Spellblade seed 可先/后跑仅改 display）；追加 `tumble_empowered_attack_ready`（explicit default0 / max1 / `duration_ms=3000` / refresh_on_write；`state_scope/provider` 20250）、`ability_costs` 30 mana、`ability_cooldowns` 2000ms、null-duration impact 上一次 provider-scope override1（Q cast **无伤害**，runtime 自然发出一次 `ability_started`）、以及 `ability_id NULL` listener：ALL matcher 恰好 `event/basic_attack_hit` 20211 + `event/source_owner` 20212（**不得**加 `ability/basic_attack` 62003）；两步均门控 `gte(ready,1)`：对 opponent 一次 physical `add(mul(1.15, source.attr.ad.resolved), mul(0.50, source.attr.ap.resolved))`（`crit_eligible=false`；`copyable_on_hit=false`）再 override0；**无** `emit_event`。保留 Basic / W Silver Bolts / E / R / Spellblade。Wiki：request `Template:Data Vayne/Q` → resolved `Template:Data Vayne/Tumble`；page1309988 / rev4015566 / `2026-05-05T15:55:50Z` / 1735 bytes / SHA256 `5ae387c07aa6c510a9da57df976b6e6ba9d3b52490fa91ce59e1221813fe9dad`；sidecar `normalized/generic/vayne-q.json`。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。**不 claim** 全保真 Vayne Q / full Tumble。

**排除**：dash / movement / direction / distance / terrain / collision；BA reset / windup / cadence；invisibility / R integration；lifesteal / healing；crit / RNG / miss / dodge / full on-hit；multi-target / structures；other ranks / full Tumble；live migration；publish；E2E。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericVayneTumbleNextBasicAttackBonusSeedSqlTest test
```

### LoL generic Vayne Condemn primary-hit seed（薇恩 E / Phase-A v1 主目标 impact）

在 reserved types 与所需 `attribute_definitions`（`hp`/`mana`/`ad`/`attack_speed`/`armor`/`magic_resist`/`hp_regen`/`mana_regen`；本公式不要求 AP）已就绪后，按顺序执行（**自包含** ensure `hero_vayne` 最低必要实体/level-1 面板/mana 资源 + 可 cast 的 E active；与既有普攻 / Silver Bolts / tumble provider 并存，不重建/替换；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20220`/`20260`）
2. `db/game_manage/seeds/lol_generic_vayne_condemn_primary_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-vayne-condemn-primary-hit-phase-a-v1-20260722`（seed 不负责 publish）。候选 `hero_skill|hero_vayne|E|恶魔审判` 冻结为 **Phase-A rank-5 立即主目标 impact scaffold**（`FROZEN_PLAN_REV=vayne-e-condemn-primary-hit-phase-a-v1`）：

`rank5_primary_target_single_hit; immediate_impact_scaffold; physical_190_plus_0_50_bonus_ad; no_knockback_terrain_stun_wall_bonus_cast_or_projectile`

该 seed 会：锁定 `game_data_state`；校验所需 reserved / 恰好八键属性定义（无 AP）；幂等投影 reserved → `types`；ensure `hero_vayne`（`ON CONFLICT DO NOTHING`）与 level-1 面板（hp550 / mana232 / ad60 / AS0.658 / armor23 / MR30 / hpregen0.7 / manaregen1.4）、`resource_definitions.mana` 与 `entity_resource_values`（232/232）；向 `hero_vayne` **仅** mount 独立 `provider_hero_vayne_e_condemn_primary_hit`（与 `provider_hero_vayne_basic_attack` / `provider_hero_vayne_silver_bolts` / `provider_hero_vayne_tumble` 并存），含 active `ability_hero_vayne_e_condemn_primary_hit`（`ability_key=condemn`）、`ability_costs` 90 mana、`ability_cooldowns` 12000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 physical damage `190 + 0.50*(ad.resolved-ad.base)`（`copyable_on_hit=false`，非 crit）。Wiki：page1309990 / rev4008541 / `2026-04-14T23:45:40Z` / 2380 bytes / SHA256 `f2b2ba17b90ff5096a9a154f8d1fd4cc43ed3e1be4ebb502cb644acf17712c37`；sidecar `normalized/generic/vayne-e.json`。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

**排除**：knockback475 / terrain / wall bonus `285+0.75bAD` 与 total `475+1.25bAD` / stun1.5s / cast0.25 / projectile2200·2000 / range·geometry / Silver Bolts·普攻·on-hit·equipment 耦合 / ranks1–4 / listener·state·event·repeat / live migration / publish；不依赖既有 Vayne provider 发布顺序。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericVayneCondemnPrimaryHitSeedSqlTest test
```

### LoL generic Vayne Final Hour timed bonus-AD seed（薇恩 R / Phase-A v2 定时加成 AD）

在 reserved types 与 Batch-B `lol_batch_b_adc_entities_seed.sql`（`hero_vayne` + `ad`/`mana`）已就绪后，按顺序执行（**前置仅为** reserved types + Batch-B；**不**要求 Vayne basic/Tumble/Silver Bolts/Condemn；seed **ensure** mana 资源 232/232（从 Batch-B 面板 mana=232 基线投影，冲突既有值 fail-closed）；不改写 Batch-B 身份/AD·mana 面板；既有 Vayne provider 若存在则保留、非前置；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20100`/`20110`/`20120`/`20130`/`20142`/`20160`/`20170`/`20172`/`20190`/`20250`/`20260`）
2. `db/game_manage/seeds/lol_batch_b_adc_entities_seed.sql`（若 Batch-B / `hero_vayne` / `ad`/`mana` 尚未写入）
3. `db/game_manage/seeds/lol_generic_vayne_final_hour_timed_bonus_ad_seed.sql`
4. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-vayne-final-hour-timed-bonus-ad-phase-a-v2-20260723`（seed 不负责 publish）。候选 `hero_skill|hero_vayne|R|终极时刻` 冻结为 **Phase-A rank-3 direct timed bonus-AD self-buff**（`FROZEN_PLAN_REV=vayne-r-final-hour-timed-bonus-ad-phase-a-v2`）：

`rank3_timed_bonus_ad_self_buff; direct_provider_state_change; flat_ad_plus_65_for_12000ms; no_night_hunter_move_speed_tumble_cooldown_invisibility_takedown_extension_stealth_or_movement`

Ordered tags：`ability_cost_cooldown` → `cast_triggered_timed_bonus_ad` → `flat_ad_add` → `timed_provider_state`。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_vayne` / `attribute_definitions(ad,mana)` / `entity_attribute_values(hero_vayne,ad|mana)` 做 **fail-closed check-only**（缺失即回滚；不写 `games` / `game_entities` / `attribute_definitions` / `entity_attribute_values`）；幂等投影 reserved → `types`；**ensure** `resource_definitions.mana` 与 `entity_resource_values`（232/232；冲突 fail-closed）；向 `hero_vayne` **仅** mount 独立 `provider_hero_vayne_r_final_hour_timed_bonus_ad`（与既有 `provider_hero_vayne_basic_attack` / `provider_hero_vayne_silver_bolts` / `provider_hero_vayne_tumble` / `provider_hero_vayne_e_condemn_primary_hit` 并存，不更新/删除/重建；basic/Tumble/Silver Bolts/Condemn **不是**前置），含 active `ability_hero_vayne_r_final_hour_timed_bonus_ad`（`ability_key=final_hour`）、`ability_costs` 80 mana、`ability_cooldowns` 70000ms、timed `final_hour_active`（explicit default0 / max1 / `duration_ms=12000` / refresh_on_write）、source `ad` add `65 * provider.state.final_hour_active`，以及恰好一个 null-duration impact phase + on_enter sequence 上的一次 direct provider-scope `state_change` override const1（**零** `provider_listeners` / **零** `event/ability_started`·`event/source_owner` scaffold）。Wiki：request `Template:Data Vayne/R` → resolved `Template:Data Vayne/Final Hour`；page1309991 / rev3807995 / `2024-11-05T22:07:10Z` / canonical 2015 bytes / SHA256 `e417f1cfc5e8253fdfe8140c4659e8fe63441c38ca3aa1e37d69aa31e25d682d`；sidecar `normalized/generic/vayne-r.json`。**local raw materialization caveat**：2012 / `343d19e30f0edf70359f122abb2c6c8e7d2d16d5e4c6db46416428d72e7c7642`；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾。Fixture mana300 仅属未来 Wasm；Backend 保持 232/232。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。不暗示 live 执行或发布；**不 claim** 全保真 Vayne R。

**排除**：Night Hunter 移速；Tumble 冷却缩减；invisibility / stealth；takedown / extension；movement / dash / projectile；R damage / control / multitarget / geometry；cooldown-change（除 ability_cooldowns 行）；ability_started / source_owner listener scaffold；ranks1–2；Vayne P/Q/W/E/basic/on-hit/equipment/runes/loadout；live migration；publish；E2E/full fidelity。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericVayneFinalHourTimedBonusAdSeedSqlTest test
```

### LoL generic Varus Hail of Arrows primary-hit seed（韦鲁斯 E / Phase-A v1 主目标 impact）

在 reserved types 与所需 `attribute_definitions`（`hp`/`mana`/`ad`/`attack_speed`/`armor`/`magic_resist`/`hp_regen`/`mana_regen`；本公式不要求 AP）已就绪后，按顺序执行（**自包含** ensure `hero_varus` 最低必要实体/level-1 面板/mana 资源 + 可 cast 的 E active；与既有普攻 / W Blighted Quiver / Q carrier 并存，不重建/替换、不读写 Blight 状态；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20220`/`20260`）
2. `db/game_manage/seeds/lol_generic_varus_hail_of_arrows_primary_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-varus-hail-of-arrows-primary-hit-phase-a-v1-20260723`（seed 不负责 publish）。候选 `hero_skill|hero_varus|E|恶灵箭雨` 冻结为 **Phase-A rank-5 立即主目标 impact scaffold**（`FROZEN_PLAN_REV=varus-e-hail-of-arrows-primary-hit-phase-a-v1`）：

`rank5_primary_target_single_hit; immediate_impact_scaffold; physical_180_plus_0_90_bonus_ad; no_landing_delay_geometry_multitarget_field_slow_grievous_wounds_or_blight_detonation`

该 seed 会：锁定 `game_data_state`；校验所需 reserved / 恰好八键属性定义（无 AP）；幂等投影 reserved → `types`；ensure `hero_varus`（`ON CONFLICT DO NOTHING`）与 level-1 面板（hp600 / mana320 / ad59 / AS0.658 / armor24 / MR30 / hpregen0.7 / manaregen1.6）、`resource_definitions.mana` 与 `entity_resource_values`（320/320）；向 `hero_varus` **仅** mount 独立 `provider_hero_varus_e_hail_of_arrows_primary_hit`（与 `provider_hero_varus_basic_attack` / `provider_hero_varus_w_blighted_quiver_phase_a` 及其 Q carrier 并存），含 active `ability_hero_varus_e_hail_of_arrows_primary_hit`（`ability_key=hail_of_arrows`）、`ability_costs` 90 mana、`ability_cooldowns` 10000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 physical damage `180 + 0.90*(ad.resolved-ad.base)`（`copyable_on_hit=false`，非 crit；运行时类型 `20220`）。Wiki：page1309978 / rev3969402 / `2025-11-24T16:03:58Z` / 1750 bytes / SHA256 `7b4be71bcc26ba933dff0235882d272c14e406abbf505290018ba15a5ba658e9`；sidecar `normalized/generic/varus-e.json`。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

**源矛盾策略**：同一 Wiki revision 的 description + labeled rank table 明确 physical `60 to 180 (+90% bonus AD)`，孤立 `damagetype=Magic` 字段错误；本边界以 description/rank table 为准，仅在 seed/JUnit/README 披露矛盾，**绝不**把 `damagetype=Magic` 写入运行时 `damage_effect_details`（禁止 `20221`）。

**排除**：cast0.2419 / landing0.5 / travel；target-location/projectile/range925/radius300/collision/geometry；all-enemies/multi-target/repeat；4s field；slow30–50%/0.25s linger；Grievous Wounds；Blight stack 消耗/~0.3s 二次引爆/W·Q·普攻·on-hit 耦合；ranks1–4；equipment/loadout；listener/state/event/repeat；live migration；publish；不依赖既有 Varus W / Batch-B provider 发布顺序。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericVarusHailOfArrowsPrimaryHitSeedSqlTest test
```

### LoL generic Varus Chain of Corruption primary-hit seed（韦鲁斯 R / Phase-A v1 主冠军命中）

在 reserved types 与 Batch-B `lol_batch_b_adc_entities_seed.sql`（`hero_varus` + `ap`）已就绪后，按顺序执行（**前置仅为** reserved types + Batch-B；**不**要求 Varus E/W；seed **ensure** mana 资源 320/320（从 Batch-B 面板 mana=320 基线投影，非 Batch-B resource 行 check-only）；不改写 Batch-B 身份/面板；E/W 若存在则保留、非前置；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20221`/`20260`）
2. `db/game_manage/seeds/lol_batch_b_adc_entities_seed.sql`（若 Batch-B / `hero_varus` / `ap` 尚未写入）
3. `db/game_manage/seeds/lol_generic_varus_chain_of_corruption_primary_hit_seed.sql`
4. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-varus-chain-of-corruption-primary-hit-phase-a-v1-20260723`（seed 不负责 publish）。候选 `hero_skill|hero_varus|R|腐败锁链`（task `wasm-generic-varus-chain-of-corruption-primary-hit`）冻结为 **Phase-A rank-3 立即主冠军命中 impact scaffold**（`FROZEN_PLAN_REV=varus-r-chain-of-corruption-primary-hit-phase-a-v1`）：

`rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_350_plus_1_00_ap; no_cast_delay_projectile_travel_collision_geometry_direction_root_reveal_blight_stack_schedule_tendril_seek_spread_or_multitarget`

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_varus` / `attribute_definitions(ap)` / `entity_attribute_values(hero_varus,ap)` 做 **fail-closed check-only**（缺失即回滚；不写 `games` / `game_entities` / `attribute_definitions` / `entity_attribute_values`）；幂等投影 reserved → `types`；**ensure** `resource_definitions.mana` 与 `entity_resource_values`（320/320）；向 `hero_varus` **仅** mount 独立 `provider_hero_varus_r_chain_of_corruption_primary_hit`（与既有 `provider_hero_varus_basic_attack` / `provider_hero_varus_w_blighted_quiver_phase_a` / E Hail of Arrows 并存，不更新/删除/重建；E/W **不是**前置），含 active `ability_hero_varus_r_chain_of_corruption_primary_hit`（`ability_key=chain_of_corruption`）、`ability_costs` 100 mana、`ability_cooldowns` 60000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 magic damage `350 + 1.00*AP`（`copyable_on_hit=false`，非 crit；运行时类型 `20221`）。Wiki：request `Template:Data Varus/R` → resolved `Template:Data Varus/Chain of Corruption`；page1309977 / rev4008213 / `2026-04-14T05:44:24Z` / canonical 5223 bytes / SHA256 `62b397cc7133a767427e00a1a5b435fcb3fd94b4ec5021be4a7869837683e4ed`；sidecar `normalized/generic/varus-r.json`。**local raw materialization caveat**：5222 / `aa50685e07a4a974baa7f4a3bf43689f930dd20ac144fa03b72886daf8242207`；trim LF →5221 / `a5b638836ce4976afc3e79852655826b82ecb357f2c54d36a0c885202129b585`；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾。夹具交叉核对（注释）：AP200=>raw550、MR100=>mitigated275；t0 success / t59999 cooldown skip / t60000 success；mana300->100、HP1000->450。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。不暗示 live 执行或发布。

**排除**：unspecified cast delay / Wiki Effect at cast time end；projectile/travel/speed/collision/global geometry/direction/facing/interception/spell-shield/untargetable；root/reveal/tenacity/cleanse/CC immunity；Blight stack creation 与 0.65/1.2/1.75s schedule、rank-0 fallback、W coupling/detonation/state mutation；tendril ground anchor、0.25s seeking、range/area、secondary infection/repeat spread/multitarget ordering；ranks1–2；Varus P/Q/W/E/basic/on-hit/equipment/runes/loadout；live migration；publish；E2E/full fidelity。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericVarusChainOfCorruptionPrimaryHitSeedSqlTest test
```

### LoL generic Teemo Blinding Dart seed（提莫 Q / Phase-A v1 主目标 impact）

在 reserved types 与所需 `attribute_definitions`（`hp`/`mana`/`ad`/`ap`/`attack_speed`/`armor`/`magic_resist`/`hp_regen`/`mana_regen`）已就绪后，按顺序执行（**自包含** ensure `hero_teemo` 最低必要实体/level-1 面板/mana 资源 + 可 cast 的 Q active；与既有普攻 / Toxic Shot provider 并存，不重建/替换；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20221`/`20260`）
2. `db/game_manage/seeds/lol_generic_teemo_blinding_dart_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-teemo-blinding-dart-phase-a-v1-20260722`（seed 不负责 publish）。候选 `hero_skill|hero_teemo|Q|致盲吹箭` 冻结为 **Phase-A rank-5 立即主目标 impact scaffold**（`FROZEN_PLAN_REV=teemo-q-blinding-dart-phase-a-v1`）：

`rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_70_ap; no_blind_cast_time_projectile_or_geometry`

该 seed 会：锁定 `game_data_state`；校验所需 reserved / 属性定义；幂等投影 reserved → `types`；ensure `hero_teemo`（`ON CONFLICT DO NOTHING`）与 level-1 面板（hp615 / mana334 / ad54 / ap0 / AS0.69 / armor24 / MR30 / hpregen1.1 / manaregen1.92）、`resource_definitions.mana` 与 `entity_resource_values`（334/334）；向 `hero_teemo` **仅** mount 独立 `provider_hero_teemo_q_blinding_dart`（与 `provider_hero_teemo_basic_attack` / `provider_hero_teemo_toxic_shot` 并存），含 active `ability_hero_teemo_q_blinding_dart`（`ability_key=blinding_dart`）、`ability_costs` 90 mana、`ability_cooldowns` 7000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 magic damage `260 + 0.70*AP`（`copyable_on_hit=false`，非 crit）。Wiki：page1308208 / rev3948425 / `2025-08-19T15:37:23Z` / 1639 bytes / SHA256 `4e3c475ed55ec865f6a9060c8ad0b2665e5379b3ae7e9e5cb644f83212b240a7`；sidecar `normalized/generic/teemo-q.json`。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

**排除**：Wiki blind/control 及 2–3s 持续、0.25s cast、projectile/speed 2500、range/geometry/collision、listener/state/modifier、`basic_attack_hit`/emit、Toxic Shot/普攻耦合、equipment/loadout、其它 rank、live migration、publish；不依赖 basic/Toxic Shot 发布顺序。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericTeemoBlindingDartSeedSqlTest test
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

### LoL generic Quinn P Harrier pre-marked consume seed（奎因 P / Phase-A v2 预标记消耗）

在 reserved types 与 `lol_generic_quinn_heightened_senses_seed.sql`（`hero_quinn` + `ad` EAV + `provider_hero_quinn_basic_attack` 含 `basic_attack_hit` emit + `provider_hero_quinn_heightened_senses` 含 `harrier_vulnerable`/`heightened_senses_active`、W arm 条件/武装公式、W AS modifier、W basic-attack listener）已就绪后，按仓库注册顺序执行（**Accepted 顺序** **W → P → Q(resource) → E**；**P 仅需 W**；Q/E 为后续独立 seed，**不是** P 硬前置；seed **fail-closed** check-only 上述 W 前置；**不**新建/改写 provider、mount、身份/面板/资源、W state/modifier/listener/sequence；仅向既有 W provider 追加 P-owned 公式/listener/三步序；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20110`/`20111`/`20150`/`20160`/`20170`/`20172`/`20181`/`20211`/`20212`/`20220`/`20250`/`20252`）
2. `db/game_manage/seeds/lol_generic_quinn_heightened_senses_seed.sql`（若 Quinn W / basic / `hero_quinn` / `ad` 尚未写入）
3. `db/game_manage/seeds/lol_generic_quinn_p_harrier_premarked_consume_seed.sql`
4. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-quinn-p-harrier-premarked-consume-phase-a-v2-20260724`（seed 不负责 publish）。候选 `hero_skill|hero_quinn|P|侵扰`（task `wasm-generic-quinn-harrier-premarked-consume`）冻结为 **Phase-A level-18 预标记普攻消耗 scaffold**（`FROZEN_PLAN_REV=quinn-p-harrier-premarked-consume-phase-a-v2`）：

`level18_preexisting_harrier_target_single_basic_attack_consume; bonus_physical_120_plus_0_40_bonus_ad; preserve_heightened_senses_arm; no_mark_generation_ability_application_duration_reveal_valor_targeting_monster_bonus_r_disable_parry_or_other_levels`

Ordered tags：`on_hit` → `formula_on_hit` → `bonus_ad_ratio` → `copyable_on_hit_false` → `provider_target_state_consume`。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `attribute_definitions(ad)` / `hero_quinn` / `entity_attribute_values(hero_quinn,ad)` / `provider_hero_quinn_basic_attack`（含 `basic_attack_hit` emit 路径）/ `provider_hero_quinn_heightened_senses` 及其 `harrier_vulnerable`（provider_target/max1/untimed）与 `heightened_senses_active`（provider/max1/2000ms/refresh_duration）、W formulas `heightened_senses_arm_condition`/`heightened_senses_active_arm`、W modifier、W basic-attack listener 做 **fail-closed check-only**；幂等投影 reserved → `types`；向既有 W provider **仅**追加 P formulas `harrier_p_level18_bonus_damage`（嵌套二元 `120+0.40*bonusAD`）与 `harrier_p_mark_clear=0`、恰好一个 listener `listener_hero_quinn_p_harrier_premarked_consume`（`basic_attack_hit`+`source_owner` ALL，max1，无 ability）、一个三步 sequence（均条件 `heightened_senses_arm_condition`）：（1）self+provider scope 武装 `heightened_senses_active=1`；（2）opponent physical `120+0.40*bonusAD`（non-crit，`copyable_on_hit=false`）；（3）self+`provider_target` scope 清零 `harrier_vulnerable`（运行时按帧战斗目标键存；禁止 opponent+provider_target）。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。Wiki：request `Template:Data Quinn/I` → `Template:Data Quinn/Harrier`；pageId 1308953 / rev 4024765 / `2026-06-03T00:49:03Z`；canonical 2390B SHA `740debfb…798c`；sidecar `normalized/generic/quinn-p.json` + pages；local raw 2390B SHA `08853c2c…a731`（canonical 以 sidecar/pages 为准；不断言等价/源矛盾）。

**排除 / gap**：mark 生成/application/duration/reveal、Valor targeting、monster bonus、R disable、parry、其它等级、主动 ability/cost/CD、Q/E/R、live migration、publish、E2E/full fidelity。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericQuinnPHarrierPremarkedConsumeSeedSqlTest test
```

### LoL generic Quinn Blinding Assault primary-hit seed（奎因 Q / Phase-A v1 主冠军命中）

在 reserved types、`lol_generic_quinn_heightened_senses_seed.sql`（`hero_quinn` + `ad`/`mana` EAV + `provider_hero_quinn_basic_attack` + `provider_hero_quinn_heightened_senses`），以及 **额外 ambient** `attribute_definitions(ap)`（超出 W seed 所需属性）已就绪后，按顺序执行（**前置为** W seed + ambient `ap` 定义；seed **fail-closed** check-only 上述前置；**不**重建/改写 Quinn 身份/其它属性/普攻·W 图；最小中性写入仅在缺席时 `ON CONFLICT DO NOTHING` 插入 `hero_quinn/ap` base0、共享 `resource_definitions(mana)` 中性默认、以及从既有 Quinn `mana` 属性派生的 `entity_resource_values`——**永不 UPDATE** 既有 AP/resource 行、不硬编码面板 mana；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20220`/`20260`）
2. `db/game_manage/seeds/lol_generic_quinn_heightened_senses_seed.sql`（若 Quinn W / basic / `hero_quinn` / `ad`·`mana` 尚未写入）
3. ambient：确保 `attribute_definitions(ap)` 已存在（W seed **不**提供）
4. `db/game_manage/seeds/lol_generic_quinn_blinding_assault_primary_hit_seed.sql`
5. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-quinn-blinding-assault-primary-hit-phase-a-v1-20260724`（seed 不负责 publish）。候选 `hero_skill|hero_quinn|Q|炫目攻势`（task `wasm-generic-quinn-blinding-assault-primary-hit`）冻结为 **Phase-A rank-5 立即主冠军命中 impact scaffold**（`FROZEN_PLAN_REV=quinn-q-blinding-assault-phase-a-v1`）：

`rank5_primary_champion_single_hit; immediate_impact_scaffold; physical_205_plus_1_00_bonus_ad_plus_0_50_ap; no_valor_projectile_travel_collision_geometry_aoe_monster_double_damage_harrier_mark_nearsight_disarm_or_other_ranks`

Ordered tags：`ability_cost_cooldown` → `active_physical_damage` → `ap_ratio` → `bonus_ad_ratio` → `immediate_impact_scaffold`。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `attribute_definitions(ad,mana,ap)` / `hero_quinn` / `entity_attribute_values(hero_quinn,ad|mana)` / `provider_hero_quinn_basic_attack` / `provider_hero_quinn_heightened_senses` 做 **fail-closed check-only**；幂等投影 reserved → `types`；仅缺席时中性插入 `entity_attribute_values(hero_quinn,ap)=0`、`resource_definitions.mana`、以及派生自既有 mana 属性的 `entity_resource_values`（均为 `DO NOTHING`，无 upsert-update）；向 `hero_quinn` **仅** mount 独立 `provider_hero_quinn_q_blinding_assault_primary_hit`（与既有 basic / W 并存，不更新/删除/重建），含 active `ability_hero_quinn_q_blinding_assault_primary_hit`（`ability_key=blinding_assault_primary_hit`）、`ability_costs` 70 mana、`ability_cooldowns` 9000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 physical damage `205 + 1.00*(ad.resolved-ad.base) + 0.50*AP`（嵌套二元 `add`，非三元；`copyable_on_hit=false`，非 crit；运行时类型 `20220`）；**零** provider state / modifiers / listeners / matchers / event-effect / repeat / control / `emit_event`（`NB-ZERO-EMITTED-EVENTS-SCOPE`：本 Q 图不能 emit `basic_attack_hit`，不压制运行时合成 `ability_started`）。Wiki：request `Template:Data Quinn/Q` → resolved `Template:Data Quinn/Blinding Assault`；page1308954 / rev4024766 / `2026-06-03T00:49:42Z` / canonical 1742 bytes / SHA256 `abce6abdc2eefd069beba2d4297a1c9da5b1a675a426edb747346d9679d8085d`；sidecar `normalized/generic/quinn-q.json`。**local raw materialization caveat**：1742 / `be8878560c7d6541440d952788e40aeba0bef25a49955379df26f45ec82737bd`；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。不暗示 live 执行或发布；**不 claim** 全保真 Quinn Q。

**排除**：Valor 实体/AI；cast delay；direction/projectile/speed/travel/collision/range/width/radius/geometry/AOE/multitarget；monster double damage；Harrier mark/P/W interaction；nearsight/disarm/sight/control/death persistence；ranks1–4；P/W/E/R/basic 行为；loadout/crit/on-hit；live migration；publish；E2E/full fidelity。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericQuinnBlindingAssaultPrimaryHitSeedSqlTest test
```

### LoL generic Quinn Vault primary-hit seed（奎因 E / Phase-A v1 主冠军命中）

在 reserved types、`lol_generic_quinn_heightened_senses_seed.sql`（`hero_quinn` + `ad` EAV + `provider_hero_quinn_basic_attack` + `provider_hero_quinn_heightened_senses`），以及 `lol_generic_quinn_blinding_assault_primary_hit_seed.sql` 提供的中性 mana 资源行（`resource_definitions(mana)` + `entity_resource_values(hero_quinn,mana)`）已就绪后，按顺序执行（**Accepted `NB-MANA-RESOURCE-SEED-ORDER`**：仓库注册顺序 **W → Q(resource) → E**；mana 资源行为 **check-only**；**不断言** Q provider——Q provider **不是**功能硬前置；seed **fail-closed** check-only 上述前置；**不**重建/改写 Quinn 身份/面板/AP/资源/成长/普攻·W·Q 图；若 Q provider 已存在则保留；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20220`/`20260`）
2. `db/game_manage/seeds/lol_generic_quinn_heightened_senses_seed.sql`（若 Quinn W / basic / `hero_quinn` / `ad` 尚未写入）
3. `db/game_manage/seeds/lol_generic_quinn_blinding_assault_primary_hit_seed.sql`（中性 mana 资源；W → Q(resource) → E）
4. `db/game_manage/seeds/lol_generic_quinn_vault_primary_hit_seed.sql`
5. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-quinn-vault-primary-hit-phase-a-v1-20260724`（seed 不负责 publish）。候选 `hero_skill|hero_quinn|E|旋翔掠杀`（task `wasm-generic-quinn-vault-primary-hit`）冻结为 **Phase-A rank-5 立即主冠军命中 impact scaffold**（`FROZEN_PLAN_REV=quinn-e-vault-phase-a-v1`）：

`rank5_primary_champion_single_hit; immediate_impact_scaffold; physical_140_plus_0_20_bonus_ad; no_dash_tracking_bounce_geometry_knockback_slow_harrier_mark_basic_attack_reset_auto_attack_or_other_ranks`

Ordered tags：`ability_cost_cooldown` → `active_physical_damage` → `bonus_ad_ratio` → `immediate_impact_scaffold`。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `attribute_definitions(ad)` / `hero_quinn` / `entity_attribute_values(hero_quinn,ad)` / `resource_definitions(mana)` / `entity_resource_values(hero_quinn,mana)` / `provider_hero_quinn_basic_attack` / `provider_hero_quinn_heightened_senses` 做 **fail-closed check-only**（缺失即回滚；不写身份/面板/AP/资源/成长）；幂等投影 reserved → `types`；向 `hero_quinn` **仅** mount 独立 `provider_hero_quinn_e_vault_primary_hit`（与既有 basic / W / 若存在的 Q 并存，不更新/删除/重建），含 active `ability_hero_quinn_e_vault_primary_hit`（`ability_key=vault_primary_hit`）、`ability_costs` 50 mana、`ability_cooldowns` 8000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 physical damage `140 + 0.20*(ad.resolved-ad.base)`（二元 `add`；`copyable_on_hit=false`，非 crit；运行时类型 `20220`）；**零** provider state / modifiers / listeners / matchers / event-effect / repeat / control / `emit_event`（`NB-ZERO-EMITTED-EVENTS-SCOPE`：本 E 图不能 emit `basic_attack_hit`，不压制运行时合成 `ability_started`）。Wiki：request `Template:Data Quinn/E` → resolved `Template:Data Quinn/Vault`；page1308957 / rev4024768 / `2026-06-03T00:51:11Z` / canonical 2649 bytes / SHA256 `9f6baba1d062b473d41586cd8323f31bd7c1c4d865db134a783c19ae998e7714`；sidecar `normalized/generic/quinn-e.json`。**local raw materialization caveat**：2649 / `317ac3ccf31e53ba17255dbb15c856ba5499d9257fbe0c9faa91b43f8438e24b`；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。不暗示 live 执行或发布；**不 claim** 全保真 Quinn E。

**排除**：dash/tracking/bounce/range/speed/wall/geometry/grounded/knockdown；knockback/airborne/slow/control/facing/windup；Harrier mark/P/W interaction；basic-attack reset/fuzzy delay/autoattack；failed-too-far；spellshield/callforhelp；ranks1–4；P/Q/W/R/basic 行为；loadout/crit/on-hit；live migration；publish；E2E/full fidelity。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericQuinnVaultPrimaryHitSeedSqlTest test
```

### LoL generic Kai'Sa Void Seeker primary-hit seed（卡莎 W / Phase-A v2 主目标 impact）

在 reserved types 与所需 `attribute_definitions`（`hp`/`mana`/`ad`/`ap`/`attack_speed`/`armor`/`magic_resist`/`hp_regen`/`mana_regen`）已就绪后，按顺序执行（**自包含** ensure `hero_kaisa` 最低必要实体/level-1 面板/mana 资源 + 可 cast 的 W active；与既有普攻/Second Skin / Supercharge provider 并存，不重建/替换、不读写 Plasma/Caustic Wounds/Supercharge 状态；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20221`/`20260`）
2. `db/game_manage/seeds/lol_generic_kaisa_void_seeker_primary_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-kaisa-void-seeker-primary-hit-phase-a-v2-20260722`（seed 不负责 publish）。候选 `hero_skill|hero_kaisa|W|虚空索敌` 冻结为 **Phase-A rank-5 立即主目标 impact scaffold**（`FROZEN_PLAN_REV=kaisa-w-void-seeker-primary-hit-phase-a-v2`）：

`rank5_primary_target_single_hit; immediate_impact_scaffold; magic_130_plus_1_30_total_ad_plus_0_45_ap; no_cast_delay_projectile_geometry_sight_reveal_plasma_evolution_or_cooldown_refund`

该 seed 会：锁定 `game_data_state`；校验所需 reserved / 恰好九键属性定义（含 AP）；幂等投影 reserved → `types`；ensure `hero_kaisa`（`ON CONFLICT DO NOTHING`）与 level-1 面板（hp640 / mana345 / ad59 / ap0 / AS0.644 / armor25 / MR30 / hpregen0.8 / manaregen1.64）、`resource_definitions.mana` 与 `entity_resource_values`（345/345）；向 `hero_kaisa` **仅** mount 独立 `provider_hero_kaisa_w_void_seeker_primary_hit`（与 `provider_hero_kaisa_basic_attack` / `provider_hero_kaisa_supercharge` 并存），含 active `ability_hero_kaisa_w_void_seeker_primary_hit`（`ability_key=void_seeker`）、`ability_costs` 75 mana、`ability_cooldowns` 14000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 magic damage `130 + 1.30*source.attr.ad.resolved + 0.45*source.attr.ap.resolved`（**total AD**，非 bonus AD；`copyable_on_hit=false`，非 crit；运行时类型 `20221`，禁止 `20220`）。Wiki：page1353553 / rev4034696 / `2026-06-23T21:14:14Z` / 1843 bytes / SHA256 `aa4ba76c6fa345c711651fa56d9b914d4ea8b7eb3ddfae79d7feb25470d7e3d1`；sidecar `normalized/generic/kaisa-w.json`。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

**排除**：Wiki 0.4s cast / Effect at cast time end（立即 scaffold 明确排除而非近似）；projectile/travel/collision/first-enemy/target-location/range3000/width200/speed1750/geometry/spellshield；trajectory sight；target reveal/true sight4s；applying2 Plasma；Second Skin/Plasma/Caustic Wounds 状态与引爆耦合；item AP100 evolution / applying3 Plasma / champion-hit75% cooldown refund；ranks1–4；equipment/loadout；listener/state/event/repeat；live migration；publish；不依赖既有 basic/Second Skin/Supercharge provider 发布顺序。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericKaisaVoidSeekerPrimaryHitSeedSqlTest test
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

### LoL generic Xayah Deadly Plumage seed（逆羽 W / Phase-A rank-5 1v1 + ability-type listener isolation）

在 reserved types 与所需 `attribute_definitions`（`hp`/`mana`/`ad`/`attack_speed`/`armor`/`magic_resist`/`hp_regen`/`mana_regen`）已就绪后，按顺序执行（**自包含** ensure `hero_xayah` 最低必要实体/level-1 面板/mana 资源 + 可 cast 的 W active；与未来普攻 / feather / Q provider 并存，不重建/替换；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20100`/`20110`/`20120`/`20130`/`20160`/`20171`/`20172`/`20173`/`20181`/`20190`/`20205`/`20212`/`20250`/`20264`/`20265`/`20266`/`20267`/`20269`）
2. `db/game_manage/seeds/lol_generic_xayah_deadly_plumage_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-xayah-deadly-plumage-v1-20260716`（seed 不负责 publish）。候选整体语义为已批准 **Phase-A rank-5 1v1 边界完成**：40 mana / 14s CD / 4s +55% AS，以及 W 激活期间 source-owned `basic_damage` pipeline multiply `1 + 0.25 * provider.state.deadly_plumage_active`（条件排除 `damage.trait.on_hit` / `damage.trait.proc`；合并普攻倍率，非第二伤害实例）。

**Ability-type listener isolation（必选校正）**：Web 把非空 `provider_listeners.ability_id` 映射为 `ListenerDefinition.abilityRef`，runtime 会把已填充 AbilityRef 当作 `castAbilityAt` 子施法，而不是事件过滤。因此本 seed 将 W listener 的 `ability_id` 置为 `NULL`，并 fail-closed ensure game-local `62012 ability/xayah_deadly_plumage`（`reserved_type_id=NULL`；双向 id↔key collision guards；同 Hexplate `62010` ability-specific type 模式），写入 `type_relations(lol,62012,'ability','ability_hero_xayah_w_deadly_plumage',...)`（在 listener matching 前物化，参与 material-change-only revision），并为 ALL matcher 保留 `20205 ability_started` + `20212 source_owner` 且新增 `62012`。不得把该 type 写入 `ability_kind_type_id`，不改变 W 分类，不新增 AbilityRef。保留既有 W 数值/state/formula/modifier/cost/CD/provider/ability/mount 身份。

该 seed 会：锁定 `game_data_state`；校验所需 reserved / 属性定义；幂等投影 reserved → `types`；fail-closed ensure game-local `62006 damage_trait/on_hit` 与 `62009 damage_trait/proc`（`reserved_type_id=NULL`）以及上述 `62012`；ensure `hero_xayah`（`ON CONFLICT DO NOTHING`，不覆盖既有实体元数据）与 level-1 面板（hp630 / mana340 / ad60 / AS0.658 / armor25 / MR30 / hpregen3.25 / manaregen8.25；自包含 bootstrap，非 Wiki W 数值真理）、`resource_definitions.mana` 与 `entity_resource_values`（340/340）；向 `hero_xayah` mount 独立 `provider_hero_xayah_w_deadly_plumage`（与未来 `provider_hero_xayah_basic_attack` / feather / Q providers 并存），含 active `ability_hero_xayah_w_deadly_plumage`（`ability_key=deadly_plumage`）、`ability_costs` 40 mana、`ability_cooldowns` 14000ms、timed `deadly_plumage_active`（max1 / `duration_ms=4000` / `refresh_duration`）、`ability_started` + `source_owner` + `ability/xayah_deadly_plumage` ALL listener 武装 active=1（override；`ability_id IS NULL`）、AS `percent_add` `0.55 * provider.state.deadly_plumage_active`，以及 pipeline modifier `modifier_hero_xayah_w_deadly_plumage_basic_damage`（kind `20264` / command `20265` / channel `20266` / bucket `20269` / stage `20267` / multiply `20171`）。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。W 机制数值注释引用 League Wiki `Template:Data Xayah/Deadly Plumage` rev `4010669` / contentSha256 `09d5476533722311e85c4ca79813cd0bec2cf35d105be894b80dac14478845a7`（`xayah-w.json`）；不以 Meraki / DataDragon 作为 W 数值真理。

**排除**：移速、Rakan/洛联动、多目标/Runaan、projectile/in-flight/ward/blind/dodge/block 细节、独立次级羽刃 missile / 第二伤害操作、其它 rank、live migration、publish、完整技能保真。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericXayahDeadlyPlumageSeedSqlTest test
```

### LoL generic Xayah Double Daggers primary two-hit seed（逆羽 Q / Phase-A v3 主冠军两羽）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_xayah)`、`attribute_definitions(ad)`、`entity_attribute_values(hero_xayah,ad)`、`resource_definitions(mana)`、`entity_resource_values(hero_xayah,mana)`，以及校正后的 W isolation 行（`types(62012,ability/xayah_deadly_plumage,reserved_type_id=NULL)`、`type_relations → ability_hero_xayah_w_deadly_plumage`、W listener `ability_id IS NULL`、ALL match 恰好 `{20205,20212,62012}`）已由 `lol_generic_xayah_deadly_plumage_seed.sql`（或等价既有行）提供后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**复制 W 身份 bootstrap，**不**从本 Q seed 突变 W 图；仅挂载可 cast 的 Q active；不做 live migration、不自动 publish、不连 live DB 执行本 seed）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20220`/`20260`）
2. `db/game_manage/seeds/lol_generic_xayah_deadly_plumage_seed.sql`（校正后的 W；提供 Xayah 既有数据与 ability-type listener isolation）
3. `db/game_manage/seeds/lol_generic_xayah_double_daggers_primary_two_hit_seed.sql`
4. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-xayah-double-daggers-primary-two-hit-phase-a-v3-20260725`（seed 不负责 publish）。候选 `hero_skill|hero_xayah|Q|双刃`（task `wasm-generic-xayah-double-daggers-primary-two-hit`）冻结为 **Phase-A rank-5 立即主冠军两羽 impact scaffold**（`FROZEN_PLAN_REV=xayah-q-double-daggers-primary-two-hit-phase-a-v3`）：

`rank5_primary_champion_two_feather_hits; immediate_impact_scaffold; two_physical_hits_each_105_plus_0_50_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation; no_cast_time_attack_lockout_direction_range_width_projectile_travel_interception_spellshield_secondary_target_reduction_feather_generation_ground_state_or_other_ranks`

Ordered tags：`ability_cost_cooldown` → `active_physical_damage` → `bonus_ad_ratio` → `immediate_impact_scaffold`。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_xayah` / `ad` 定义与实体值 / `mana` 资源定义与实体资源值 / 校正后 W isolation 做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`；不写 W listener/type_relations）；幂等投影 reserved → `types`；向 `hero_xayah` **仅** mount 独立 `provider_hero_xayah_q_double_daggers_primary_two_hit`（与既有 `provider_hero_xayah_w_deadly_plumage` 并存，不更新/删除/重建；不创建 P/E/R/basic），含 active `ability_hero_xayah_q_double_daggers_primary_two_hit`（`ability_key=double_daggers_primary_two_hit`）、`ability_costs` 35 mana、`ability_cooldowns` 8000ms、恰好一个 null-duration impact phase + on_enter sequence，以及两次有序 physical damage（左右稳定 step/detail ID；共享 formula key `double_daggers_damage` = `105 + 0.50*(ad.resolved-ad.base)`；二元算术树；`copyable_on_hit=false`，非 crit；运行时类型 `20220`）。成功 cast 由 runtime 自动发出恰好一次 `ability_started`（非显式 seed event step）。**零** provider state / modifiers / listeners / matchers / explicit events / repeats / control / projectile / AOE / feather-ground / movement 行。有 material change 时才推进候选 revision。

Wiki 身份：request `Template:Data Xayah/Q` → resolved `Template:Data Xayah/Double Daggers`；resolved pageId `1324541` / rev `4008615` / `2026-04-15T00:26:21Z`；canonical bytes `2615` / SHA256 `8010e567d2366730c5eb6cd0a31baec09c7f5137018ab2ca15fd84f167d990fd`（`数据参考/lol-wiki-current-champions/normalized/generic/xayah-q.json` + pages sibling）。live redirect request detail（非本地 sidecar 内容，仅注释记录，never claim the local sidecar contains it）：pageId `1324536` / rev `2864045`。local raw materialization caveat：`raw/xayah-q.wikitext` bytes `2615` / SHA256 `6a1fde0a18de0b6f28e55be7df27e58f99c91d49310e79ae81a9e95384f974de`；不断言与 canonical 字节等价，亦不主张源矛盾。

确定性 runtime 校验夹具（注释/文档记录；本 seed 不连 live / 不执行）：

- baseAD60/resolvedAD60：each raw105, total210；armor0 total210；armor100 each52.5,total105
- baseAD60/resolvedAD110：each raw130,total260；armor0 total260；armor100 each65,total130
- mana105/HP1000/bonusAD50/armor100 at t0/t7999/t8000：success, cooldown skip, success；per success two damage items totaling130 mitigated；final mana35/HP740；two total `ability_started` events；W state remains inactive/baseline AS
- mana34 resource skip：unchanged mana/HP，zero damage/events，no W state/AS change
- W success while Q mounted：W becomes active/current AS changes，with zero Q damage

**排除**：cast time/attack lockout/Effect-at-cast-end；direction/range/width/geometry；projectile/travel/collision/interception/spell shield；later-target 50% reduction；multitarget/formation/area；feather generation/ground state/E interaction；ranks1-4；P/W/E/R/basic graph expansion；equipment/runes/loadout/crit/on-hit；identity bootstrap；live migration；publish；E2E/full fidelity。本 Q 条目**不**自称自包含。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericXayahDoubleDaggersPrimaryTwoHitSeedSqlTest,LolGenericXayahDeadlyPlumageSeedSqlTest test
```

### LoL generic Xayah Featherstorm primary-hit seed（逆羽 R / Phase-A v2 主冠军 damage quantum）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_xayah)`、`attribute_definitions(ad)`、`entity_attribute_values(hero_xayah,ad)`、`resource_definitions(mana)`、`entity_resource_values(hero_xayah,mana)`，以及校正后的 W isolation 行（`types(62012,ability/xayah_deadly_plumage,reserved_type_id=NULL)`、`type_relations → ability_hero_xayah_w_deadly_plumage`、W listener `ability_id IS NULL`、ALL match 恰好 `{20205,20212,62012}`）已由 `lol_generic_xayah_deadly_plumage_seed.sql`（或等价既有行）提供后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**复制 W 身份 bootstrap，**不**从本 R seed 突变 W 图；**不** require/insert/update/delete/rebuild Q；仅挂载可 cast 的 R active；不做 live migration、不自动 publish、不连 live DB 执行本 seed）。**W** 是共享身份与 ability-type listener isolation 前置；**Q** 与 **R** 为独立 sibling（Q 可选，非本 R 前置）。

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20220`/`20260`）
2. `db/game_manage/seeds/lol_generic_xayah_deadly_plumage_seed.sql`（校正后的 W；提供 Xayah 既有数据与 ability-type listener isolation）
3. （可选）`db/game_manage/seeds/lol_generic_xayah_double_daggers_primary_two_hit_seed.sql`（独立 Q sibling；非本 R 前置）
4. `db/game_manage/seeds/lol_generic_xayah_featherstorm_primary_hit_seed.sql`
5. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-xayah-featherstorm-primary-hit-phase-a-v2-20260725`（seed 不负责 publish）。候选 `hero_skill|hero_xayah|R|暴风羽刃`（task `wasm-generic-xayah-featherstorm-primary-hit`）冻结为 **Phase-A rank-3 立即主冠军一次物理 damage quantum impact scaffold**（`FROZEN_PLAN_REV=xayah-r-featherstorm-primary-hit-phase-a-v2`）：

`rank3_primary_champion_one_physical_damage_quantum; immediate_impact_scaffold; quantum_amount_400_plus_1_00_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation_and_double_daggers_isolation; no_claim_of_whole_r_single_total_hit_or_wiki_proven_once_only; no_multi_feather_same_target_stacking_leap_ghosted_untargetable_one_second_delay_attack_or_cast_lockout_direction_cone_range_projectile_multitarget_feather_generation_ground_state_e_dependency_other_ranks_or_full_fidelity`

Ordered tags：`ability_cost_cooldown` → `active_physical_damage` → `bonus_ad_ratio` → `immediate_impact_scaffold`。

**语义 framing**：Phase-A 将 leveling-labeled 数值 `400 + 100% bonus AD` 恰好一次施加到所选主冠军，作为有界 **damage quantum**；不证明完整 Featherstorm 仅有一次总命中；不建模五次 damage ops；明确排除同目标多羽叠加/基数与五个投射物身份。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_xayah` / `ad` 定义与实体值 / `mana` 资源定义与实体资源值 / 校正后 W isolation 做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`；不写 W listener/type_relations；不写 Q 行）；幂等投影 reserved → `types`；向 `hero_xayah` **仅** mount 独立 `provider_hero_xayah_r_featherstorm_primary_hit`（与既有 W、可选 Q 并存，不更新/删除/重建；不创建 P/E/basic），含 active `ability_hero_xayah_r_featherstorm_primary_hit`（`ability_key=featherstorm_primary_hit`）、`ability_costs` 100 mana、`ability_cooldowns` 100000ms、恰好一个 null-duration impact phase + on_enter sequence，以及恰好一次 direct-opponent physical damage（stable step/detail ID；formula key `featherstorm_primary_hit_damage` = `400 + 1.00*(ad.resolved-ad.base)`；二元算术树；`copyable_on_hit=false`，非 crit；运行时类型 `20220`）。成功 cast 由 runtime 自动发出恰好一次 `ability_started`（非显式 seed event step）。**零** R provider state / modifiers / listeners / matchers / explicit events / repeats / control / projectile / AOE / feather-ground / movement / untargetable 行。有 material change 时才推进候选 revision。

Wiki 身份：request `Template:Data Xayah/R` → resolved `Template:Data Xayah/Featherstorm`；resolved pageId `1324544` / rev `4008617` / `2026-04-15T00:26:44Z`；canonical bytes `1761` / SHA256 `cb5c8ba5486a55027e7c2252589fa8e5d821d346cc44afa99243de71ce5b3077`（`数据参考/lol-wiki-current-champions/normalized/generic/xayah-r.json` + pages sibling）。local raw materialization caveat：`raw/xayah-r.wikitext` bytes `1761` / SHA256 `debf23b0213a4d9669a29f6c415a6f67d582b7093d25059b7765745bed43ace1`；不断言与 canonical 字节等价，亦不主张源矛盾。

确定性 runtime 校验夹具（注释/文档记录；本 seed 不连 live / 不执行；SQL 测试亦不执行 runtime）：

- baseAD60/resolvedAD60：raw400；armor0=400；armor100=200
- baseAD60/resolvedAD110：raw450；armor0=450；armor100=225
- mana300/HP1000/baseAD60/resolvedAD110/armor100 at t0/t99999/t100000：success, cooldown skip, success；two total R damage-quantum items；final mana100/HP550；two automatic R `ability_started` events
- mana99 resource skip：unchanged mana/HP，no R damage/event，no W arm
- W/Q/R isolation：W listener isolation 与可选 Q Double Daggers 图保持不变；R 不 cross-arm W

**排除**：multi-feather same-target stacking/cardinality；five projectile identities / five damage ops；claim of whole-R single total hit or Wiki-proven once-only；leap/ghosted/untargetable；one-second delay；attack or cast lockout；direction/cone/range/geometry；projectile/travel/collision/multitarget；feather generation/ground state/E dependency；other ranks；P/W/Q/E/basic graph expansion；equipment/runes/loadout/crit/on-hit；identity bootstrap；live migration；publish；E2E/full fidelity。本 R 条目**不**自称自包含。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericXayahFeatherstormPrimaryHitSeedSqlTest,LolGenericXayahDoubleDaggersPrimaryTwoHitSeedSqlTest,LolGenericXayahDeadlyPlumageSeedSqlTest test
```

### LoL generic Xayah Clean Cuts three-attack budget seed（逆羽 P / Phase-A v2 攻击次数预算）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_xayah)`、`attribute_definitions(ad)`、`entity_attribute_values(hero_xayah,ad)`、`resource_definitions(mana)`、`entity_resource_values(hero_xayah,mana)`，以及校正后的 W isolation 行（`types(62012,ability/xayah_deadly_plumage,reserved_type_id=NULL)`、`type_relations → ability_hero_xayah_w_deadly_plumage`、W listener `ability_id IS NULL`、ALL match 恰好 `{20205,20212,62012}`）已由 `lol_generic_xayah_deadly_plumage_seed.sql`（或等价既有行）提供后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**复制 W 身份 bootstrap，**不**从本 P seed 突变 W/Q/R 图；仅挂载独立 P provider；不做 live migration、不自动 publish、不连 live DB 执行本 seed）。**W** 是共享身份与 ability-type listener isolation 前置；**Q** 与 **R** 为可选 sibling（非本 P 前置，本脚本不 require/mutate）。

1. `db/game_manage/seeds/reserved_types_seed.sql`
2. `db/game_manage/seeds/lol_generic_xayah_deadly_plumage_seed.sql`（校正后的 W；提供 Xayah 既有数据与 ability-type listener isolation）
3. （可选）`db/game_manage/seeds/lol_generic_xayah_double_daggers_primary_two_hit_seed.sql` / `lol_generic_xayah_featherstorm_primary_hit_seed.sql`（独立 Q/R sibling；非本 P 前置）
4. `db/game_manage/seeds/lol_generic_xayah_clean_cuts_three_attack_budget_seed.sql`

建议发布版本：`lol-generic-xayah-clean-cuts-three-attack-budget-phase-a-v2-20260726`（seed 不负责 publish）。候选 `hero_skill|hero_xayah|P|锐切`（task `wasm-generic-xayah-clean-cuts-three-attack-budget`）冻结为 **Phase-A 攻击次数预算**（`FROZEN_PLAN_REV=xayah-p-clean-cuts-three-attack-budget-phase-a-v2`）：

`attack_count_budget_only; direct_post_cast_arm_gives_3; successful_source_ba_damage_instance_consumes_1; state_sequence_arm_plus_4ba_0_3_2_1_0_0; preserve_wqr_and_w_ability_type_listener_isolation; no_true_qwer_wiring_add_refresh_max5_8s_timer_geometry_feathers_secondary_damage_secondary_crit_e_dependency_miss_dodge_cadence_projectile_rng_expected_crit_on_hit_proc_or_full_ba_clean_cuts_fidelity`

Ordered tags：`attack_count_budget` / `direct_post_cast_arm_override_3` / `basic_attack_damage_instance_consume_1` / `untimed_max3_state_no_default_column`。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_xayah` / `ad` 定义与实体值 / `mana` 资源定义与实体资源值 / 校正后 W isolation 做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`；不写 W/Q/R listener/type_relations）；幂等投影 reserved → `types`；Graves 式 fail-closed ensure game-local `62003 ability/basic_attack`（`reserved_type_id=NULL`；双向 id↔key collision）；向 `hero_xayah` **仅** mount 独立 `provider_hero_xayah_p_clean_cuts_three_attack_budget`（与既有 W、可选 Q/R 并存，不更新/删除/重建）：`clean_cuts_attacks_remaining`（max3 / `duration_ms=NULL` / refresh NULL；schema 无 default 列，缺失状态 runtime=0 直至 arm）；无 cost/CD arm `ability_hero_xayah_p_clean_cuts_direct_post_cast_arm`（`ability_key=clean_cuts_direct_post_cast_arm`；provider-scope override const3）；无 cost/CD BA `ability_hero_xayah_p_clean_cuts_basic_attack`（`ability_key=clean_cuts_basic_attack`；`type_relations`→62003；物理 `read source.attr.ad.resolved`；`crit_eligible=false`；`copyable_on_hit=false`）；listener `ability_id IS NULL`，ALL 恰好 `{20217,62003,20212}`，`max_triggers_per_event=1`，guarded `gt(provider.state.clean_cuts_attacks_remaining,0)` 后 provider-scope add `-1`。不添加共享 Xayah 技能 type_relations。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

Wiki 身份：resolved `Template:Data Xayah/Clean Cuts`；pageId `1324540` / rev `3967343` / `2025-11-18T20:49:46Z`；canonical bytes `4068` / SHA256 `5cfe6e5e30cdc8e6fde07791288f5a85e5ef01f543670ce2248323ccb6ead171`（`数据参考/lol-wiki-current-champions/normalized/generic/xayah-p.json`）。Wiki on-attack 由成功 `damage_instance` 近似。

**排除**：true Q/W/E/R wiring；add/refresh/max5；8s timer；geometry/feathers/secondary damage/secondary crit/E dependency；miss/dodge；cadence/projectile；RNG/expected crit/on-hit/proc；full BA/Clean Cuts fidelity；identity bootstrap；live migration；自动 publish；E2E。本条目不主张 live DB 执行、publish 或 runtime 保真。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericXayahCleanCutsThreeAttackBudgetSeedSqlTest,LolGenericXayahFeatherstormPrimaryHitSeedSqlTest,LolGenericXayahDoubleDaggersPrimaryTwoHitSeedSqlTest,LolGenericXayahDeadlyPlumageSeedSqlTest test
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

### LoL generic Ashe shared P/Q Ranger's Focus seed（寒冰射手 P 冰霜射击 expectation-only Phase-A + Q 射手的专注 / 共享普攻图）

前置 DDL：`ability_definitions.cast_condition_formula_key` 已存在（新库见 `schema.sql`；已有库先跑 `db/game_manage/migrations/compatibility/generic_ability_cast_condition_compatibility_migration.sql`）。在 reserved types 与所需 `attribute_definitions`（`hp`/`mana`/`ad`/`attack_speed`/`armor`/`magic_resist`/`hp_regen`/`mana_regen`/`crit_chance`/`crit_damage`）就绪后按顺序执行（**自包含**；不做 live migration、不自动 publish；**不**新建 P provider/ability）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20100`/`20110`/`20111`/`20120`/`20130`/`20142`/`20150`/`20158`/`20160`/`20170`/`20172`/`20173`/`20181`/`20190`/`20205`/`20211`/`20212`/`20220`/`20250`/`20260`）
2. `db/game_manage/seeds/lol_generic_ashe_rangers_focus_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-ashe-rangers-focus-v1-20260714`（seed 不负责 publish）。本 seed 为 **共享 P/Q 普攻图**：Q 边界仍为既有 Ranger's Focus rank-5 部分 ABI；P 候选 `hero_skill|hero_ashe|P|冰霜射击` 冻结为 **expectation-only Phase-A**（`FROZEN_PLAN_REV=ashe-p-frost-shot-expected-basic-attack-phase-a-v3`）：

`normal_basic_attack_expected_physical_damage; separate_ability_basic_attack; total_ad_times_one_plus_clamped_crit_chance_times_total_crit_multiplier_minus_one; generic_expected_crit_settlement; q_flurry_inactive_normal_attack_branch_only; exactly_one_basic_attack_hit_event; no_rng_crit_sequence_on_crit_event_frost_slow_critical_slow_duration_decay_randuins_specific_acceptance_runaans_cheap_shot_q_flurry_damage_integration_projectile_travel_attack_cadence_other_abilities_or_full_fidelity`

该 seed 会：锁定 `game_data_state`；幂等投影 reserved → `types`、`resource_definitions.mana` 与 `hero_ashe` `entity_resource_values`（280/280）；写入 level-1 面板（hp610 / mana280 / ad59 / AS0.658 / armor26 / MR30 / hpregen3.5 / manaregen7）与运行时 EAV `crit_chance=0` / `crit_damage=2.0`（Patch 26.1 总暴击倍率基线；不写 Infinity Edge）；fail-closed ensure game-local `62003 ability/basic_attack`（`reserved_type_id=NULL`）并 `type_relations` 绑定 `ability_hero_ashe_basic_attack`（`extend.role=basic_attack`）；单一共享 `provider_hero_ashe_rangers_focus` 承载 Q + 普攻；四槽 timed Focus（4000/5000/6000/7000ms）+ `flurry_active` 6000ms；Q `cast_condition_formula_key`（Focus≥4）+ `ability_costs` 30 mana；AS `percent_add` `0.75 * provider.state.flurry_active`（`condition_formula_key` 为 NULL）；普通分支 `step_hero_ashe_ba_normal_damage` 物理伤害公式仍 `$owner.attr.ad` 且 `crit_eligible=true`；Flurry 首发 6 / 后续 5 × 0.28 total AD 且全部 `crit_eligible=false` / `copyable_on_hit=false`；每次普攻末尾恰好一次 `emit_event(event/basic_attack_hit)`。有 material change 时才推进候选 revision。

Wiki（P）：request `Template:Data Ashe/I` → `Template:Data Ashe/Frost Shot`；page1306803 / rev4038216 / `2026-06-30T07:27:41Z`；canonical 1880 / SHA256 `def2547f…`；normalized 2485 / `575de3e4…`；pages 672 / `a8e2f81d…`；**local raw caveat**：local raw 1880 / `5da5112e…`，不断言与 canonical 等价。

**排除（P expectation-only 仍排除）**：Frost Shot / Critical Slow 减速与持续衰减、RNG 暴击序列 / on-crit、Randuin's / Runaan's / Cheap Shot、Q-Flurry 与 P 伤害集成、箭矢飞行、攻击节奏、其它能力或 full-fidelity。**Q 已完成边界仍排除 Frost Shot 保真**；共享同一 seed/fixture **不**扩大 Q 的完成声明。另排除：攻击计时器重置、生命偷取、建筑物/多目标、技能轮转、其它 rank、live migration、publish。

静态契约校验（不连 live DB；含邻近 Ashe W/R 与 generic crit）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericAsheRangersFocusSeedSqlTest,LolGenericAsheVolleySeedSqlTest,LolGenericAsheEnchantedCrystalArrowPrimaryHitSeedSqlTest,LolGenericCritModifierSeedSqlTest test
```

### LoL generic Ashe Enchanted Crystal Arrow primary-hit seed（寒冰射手 R / Phase-A 主目标 impact）

在 reserved types 与所需 `attribute_definitions`（`hp`/`mana`/`ad`/`ap`/`attack_speed`/`armor`/`magic_resist`/`hp_regen`/`mana_regen`）已就绪后，按顺序执行（**自包含** ensure `hero_ashe` 最低必要实体/level-1 面板/mana 资源 + 可 cast 的 R active；与既有 Ranger's Focus Q / Volley W provider 并存，不重建/替换；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20221`/`20260`）
2. `db/game_manage/seeds/lol_generic_ashe_enchanted_crystal_arrow_primary_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-ashe-enchanted-crystal-arrow-primary-hit-phase-a-v1-20260723`（seed 不负责 publish）。候选 `hero_skill|hero_ashe|R|魔法水晶箭` 冻结为 **Phase-A rank-3 立即主目标 impact scaffold**（`FROZEN_PLAN_REV=ashe-r-enchanted-crystal-arrow-primary-hit-phase-a-v1`）：

`rank3_primary_target_single_hit; immediate_impact_scaffold; magic_600_plus_1_20_ap; no_cast_delay_projectile_travel_collision_geometry_distance_stun_aoe_frost_or_sight`

该 seed 会：锁定 `game_data_state`；校验所需 reserved / 恰好九键属性定义（含 AP）；幂等投影 reserved → `types`；ensure `hero_ashe`（`ON CONFLICT DO NOTHING`，不改写既有 Q/W 描述）与 level-1 面板（hp610 / mana280 / ad59 / ap0 / AS0.658 / armor26 / MR30 / hpregen3.5 / manaregen7；既有八键与 Ashe Q/W 字节一致，仅新增 AP0；AP200 仅测试夹具、seed 不写）、`resource_definitions.mana` 与 `entity_resource_values`（280/280）；向 `hero_ashe` **仅** mount 独立 `provider_hero_ashe_r_enchanted_crystal_arrow_primary_hit`（与 `provider_hero_ashe_rangers_focus` / `provider_hero_ashe_w_volley` 并存），含 active `ability_hero_ashe_r_enchanted_crystal_arrow_primary_hit`（`ability_key=enchanted_crystal_arrow`）、`ability_costs` 100 mana、`ability_cooldowns` 60000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 magic damage `600 + 1.20*AP`（`copyable_on_hit=false`，非 crit；运行时类型 `20221`）。Wiki：request `Template:Data Ashe/R` → resolved `Template:Data Ashe/Enchanted Crystal Arrow`；page1306811 / rev4026934 / `2026-06-10T19:09:50Z` / canonical 2394 bytes / SHA256 `1d9ccefa98a41e57a088e76aaca16f7a78141e7373616520e2d6ba13f450664f`；sidecar `normalized/generic/ashe-r.json`（siblings `pages/ashe-r.json`、`raw/ashe-r.wikitext`）。**local raw materialization caveat**：仓库 local raw 为非规范 2393-byte materialization，SHA256 `2bce161be04aa2cbe770a7402651929cfb3a7781d7a7ca828b93d1de68d4bb28`；既不裁剪末端 LF、也不插入 CR 能复现 canonical；canonical 身份以 sidecar/pages 为准，不断言 local raw 等价、亦不主张源矛盾。夹具交叉核对（注释）：AP200=>raw840、MR100=>mitigated420；t0 success / t59999 cooldown skip / t60000 success；mana280->80、HP1000->160。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

**排除**：Wiki cast time=0.25 / Effect at cast time start（立即 scaffold 明确排除而非近似）；projectile/travel/speed/collision/first-champion acquisition/range/geometry/interception/spellshield；distance-traveled stun/crowd-control/tenacity；surrounding-enemy same-damage AOE；Frost Shot/slow；sight/reveal；ranks1–2；Q/W/P/basic Focus-Flurry/on-hit/equipment/loadout；listener/state/event/modifier/repeat/control；live migration；publish；不依赖既有 Ashe Q/W provider 发布顺序。

静态契约校验（不连 live DB；含邻近 Ashe Q/W 与 Graves W magic primary-hit）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericAsheEnchantedCrystalArrowPrimaryHitSeedSqlTest,LolGenericAsheVolleySeedSqlTest,LolGenericAsheRangersFocusSeedSqlTest,LolGenericGravesSmokeScreenPrimaryHitSeedSqlTest test
```

### LoL generic Ezreal Trueshot Barrage primary-hit seed（探险家 R / Phase-A v2 主冠军命中）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_ezreal)`、`attribute_definitions(ad/ap)`、`entity_attribute_values(hero_ezreal,ad/ap)`、`resource_definitions(mana)`、`entity_resource_values(hero_ezreal,mana)` 已存在后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**物化身份/面板/资源值，**不**物化 Ezreal ad/ap/mana 行——当前仓库亦无 seed 负责物化这些行；与较旧 Rising Spell Force seed 共享同一外部实体依赖；仅挂载可 cast 的 R active；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20221`/`20260`）
2. `db/game_manage/seeds/lol_generic_ezreal_trueshot_barrage_primary_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-ezreal-trueshot-barrage-primary-hit-phase-a-v2-20260723`（seed 不负责 publish）。候选 `hero_skill|hero_ezreal|R|精准弹幕`（task `wasm-generic-ezreal-trueshot-barrage-primary-hit`）冻结为 **Phase-A rank-3 立即主冠军命中 impact scaffold**（`FROZEN_PLAN_REV=ezreal-r-trueshot-barrage-primary-hit-phase-a-v2`）：

`rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_750_plus_1_00_bonus_ad_plus_1_10_ap; no_cast_delay_queue_projectile_travel_collision_geometry_direction_multitarget_sight_minion_or_monster_modified_damage`

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_ezreal` / `ad`+`ap` 定义与实体值 / `mana` 资源定义与实体资源值做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`）；幂等投影 reserved → `types`；向 `hero_ezreal` **仅** mount 独立 `provider_hero_ezreal_r_trueshot_barrage_primary_hit`（与既有 `provider_hero_ezreal_rising_spell_force` 并存，不更新/删除/重建；不创建 Q/W/E），含 active `ability_hero_ezreal_r_trueshot_barrage_primary_hit`（`ability_key=trueshot_barrage`）、`ability_costs` 100 mana、`ability_cooldowns` 90000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 magic damage `750 + 1.00*(ad.resolved-ad.base) + 1.10*ap.resolved`（`copyable_on_hit=false`，非 crit；运行时类型 `20221`）。Wiki：request `Template:Data Ezreal/R` → resolved `Template:Data Ezreal/Trueshot Barrage`；page1307113 / rev4013235 / `2026-04-28T21:20:36Z` / canonical 1453 bytes / SHA256 `e9d7f9d7411bcbb1ab00aeb89fe03a4fb8511625fc0a64266f5f63ced53580e0`；sidecar `normalized/generic/ezreal-r.json`。**local raw materialization caveat**：仓库 local raw 1450 / `ddc984665670fe9aee859ec740d63c101b04c7f504f610952f94fe67a014f943`；trim LF →1449 / `57a04bc0b2e42505bd9ec1b324fed4192aecb213ea22dade56f4e77ed553f3ce`；前置 BOM →1453 / `27fbea33e254bd4b139e49ca0bbface059f490d25fa74cd33b19846596a1c639`；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾。夹具交叉核对（注释）：baseAD60 / resolvedAD110 / bonusAD50 / AP200 => raw1020；MR100 =>510；t0 success / t89999 cooldown skip / t90000 success；两次成功后 mana300->100、HP1500->480。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

**排除**：Wiki cast time=1s / queue=0.5s / Effect-at-cast-start；projectile/travel/speed/collision/global path/geometry/direction/interception/spellshield；multitarget/pass-through/order；sight/minimap；minion/non-epic-monster modified rank3 `300+1.00 bonusAD+1.10 AP`；ranks1–2；P/Q/W/E/basic/equipment/runes/loadout/on-hit/crit；identity/base-stat bootstrap；listener/state/event/modifier/repeat/control/projectile/AOE；live migration；publish。

静态契约校验（不连 live DB；可与 Rising Spell Force 静态契约一并跑）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericEzrealTrueshotBarragePrimaryHitSeedSqlTest,LolGenericEzrealRisingSpellForceSeedSqlTest test
```

### LoL generic Ezreal Arcane Shift primary-hit seed（探险家 E / Phase-A v3 主冠军命中）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_ezreal)`、`attribute_definitions(ad/ap)`、`entity_attribute_values(hero_ezreal,ad/ap)`、`resource_definitions(mana)`、`entity_resource_values(hero_ezreal,mana)` 已存在后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**物化身份/面板/资源值，**不**物化 Ezreal ad/ap/mana 行——当前仓库亦无 seed 负责物化这些行；与较旧 Rising Spell Force / Trueshot Barrage seeds 共享同一外部实体依赖；仅挂载可 cast 的 E active；不做 live migration、不自动 publish）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20221`/`20260`）
2. `db/game_manage/seeds/lol_generic_ezreal_arcane_shift_primary_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-ezreal-arcane-shift-primary-hit-phase-a-v3-20260724`（seed 不负责 publish）。候选 `hero_skill|hero_ezreal|E|奥术跃迁`（task `wasm-generic-ezreal-arcane-shift-primary-hit`）冻结为 **Phase-A rank-5 立即主冠军命中 impact scaffold**（`FROZEN_PLAN_REV=ezreal-e-arcane-shift-primary-hit-phase-a-v3`）：

`rank5_primary_champion_single_hit; immediate_impact_scaffold; magic_280_plus_0_60_bonus_ad_plus_0_75_ap; preserve_rising_spell_force_one_stack_on_successful_hit; no_blink_homing_target_selection_visibility_essence_flux_priority_projectile_travel_reveal_or_other_ranks`

Ordered tags：`ability_cost_cooldown` → `active_magic_damage` → `bonus_ad_ratio` → `ap_ratio` → `immediate_impact_scaffold`。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_ezreal` / `ad`+`ap` 定义与实体值 / `mana` 资源定义与实体资源值做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`）；幂等投影 reserved → `types`；向 `hero_ezreal` **仅** mount 独立 `provider_hero_ezreal_e_arcane_shift_primary_hit`（与既有 `provider_hero_ezreal_rising_spell_force` / `provider_hero_ezreal_r_trueshot_barrage_primary_hit` 并存，不更新/删除/重建；不创建 Q/W），含 active `ability_hero_ezreal_e_arcane_shift_primary_hit`（`ability_key=arcane_shift_primary_hit`）、`ability_costs` 70 mana、`ability_cooldowns` 14000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 magic damage `280 + 0.60*(ad.resolved-ad.base) + 0.75*ap.resolved`（嵌套二元 `add`，外层 `add(内层 add(base, bonusAD), AP)`，非历史 R 三元 add；`copyable_on_hit=false`，非 crit；运行时类型 `20221`）；**零** provider state / modifiers / listeners / matchers / event-effect / repeat / control / projectile / AOE / blink / movement 行。成功非普攻 E cast 可参与既有自动 `ability_started` 表面（Rising Spell Force 叠一层），本 E 图不添加 listener 行。Wiki：request `Template:Data Ezreal/E` → resolved `Template:Data Ezreal/Arcane Shift`；page1307111 / rev3989862 / `2026-02-03T23:19:20Z` / canonical 1661 bytes / SHA256 `7ac83f7eaa237641c478f2e3ffa1a2714f7da0644c8a488ab6a6f47b67e27347`；sidecar `normalized/generic/ezreal-e.json` + pages sibling。**local raw materialization caveat**：仓库 local raw 1661 / `f48a32706234b0c1ef1abab4b7f90e4ee88944623827fb22a41e23bdfac01792`；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

**排除**：blink/displacement/location/range/cast time/terrain/geometry/direction；homing/nearest-enemy/visibility/unseen/Essence Flux priority or detonation；projectile/travel/collision/interception/spell shield/reveal；miss/cancel/death；multitarget/minions/monsters；ranks1–4；P cap/expiry/refresh beyond coexistence；Q/W/R/basic；equipment/runes/loadout/crit/on-hit；identity/base-stat bootstrap；listener/state/event/modifier/repeat/control/projectile/AOE/movement；live migration；publish；E2E/full fidelity。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericEzrealArcaneShiftPrimaryHitSeedSqlTest test
```

### LoL generic Ezreal Mystic Shot primary-hit seed（探险家 Q / Phase-A v2 选定主敌方冠军单次物理命中）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_ezreal)`、`attribute_definitions(ad/ap)`、`entity_attribute_values(hero_ezreal,ad/ap)`、`resource_definitions(mana)`、`entity_resource_values(hero_ezreal,mana)` 已存在后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**物化身份/面板/资源值，**不**物化 Ezreal ad/ap/mana 行——当前仓库亦无 Ezreal identity materializer；与既有 Rising Spell Force / Arcane Shift / Trueshot Barrage seeds 共享同一外部实体依赖；仅挂载可 cast 的独立 Q active **选定主敌方冠军单次物理命中**；保留既有 `provider_hero_ezreal_rising_spell_force` / `provider_hero_ezreal_e_arcane_shift_primary_hit` / `provider_hero_ezreal_r_trueshot_barrage_primary_hit`，不更新/删除/重建；不创建 W；不做 live migration、不自动 publish、不连 live DB 执行本 seed；**本 seed 非自包含**）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20220`/`20260`；不含 `20230`）
2. `db/game_manage/seeds/lol_generic_ezreal_mystic_shot_primary_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish；本任务亦不执行该可选 publish 步骤）

建议发布版本：`lol-generic-ezreal-mystic-shot-primary-hit-phase-a-v2-20260726`（seed 不负责 publish）。候选 `hero_skill|hero_ezreal|Q|秘术射击`（task `wasm-generic-ezreal-mystic-shot-primary-hit`）冻结为 **Phase-A rank-5 立即选定主敌方冠军单次物理命中 impact scaffold**（`FROZEN_PLAN_REV=ezreal-q-mystic-shot-primary-hit-phase-a-v2`）：

`rank5_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold; physical_120_plus_1_30_total_ad_plus_0_40_ap; preserve_rising_spell_force_one_stack_on_successful_hit; no_direction_range_projectile_travel_collision_first_enemy_acquisition_on_hit_on_attack_cooldown_reduction_basic_damage_spell_damage_dual_tag_lifesteal_vamp_spellshield_buffering_other_ranks_or_full_fidelity`

Ordered tags：`ability_cost_cooldown` → `active_physical_damage` → `ap_ratio` → `immediate_impact_scaffold`（**不含** governed tag `total_ad_ratio`；亦不含 stale `cooldown_or_haste_without_rotation`；total AD 仅显式出现在 boundary/reason/formula；亦不含 salvage tags）。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_ezreal` / `ad`+`ap` 定义与实体值 / `mana` 资源定义与实体资源值做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`）；幂等投影 reserved → `types`；向 `hero_ezreal` **仅** mount 独立 `provider_hero_ezreal_q_mystic_shot_primary_hit`（与既有 P/E/R 并存，不更新/删除/重建；不创建 W），含 active `ability_hero_ezreal_q_mystic_shot_primary_hit`（`ability_key=mystic_shot_primary_hit`）、`ability_costs` 40 mana、`ability_cooldowns` 4500ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 physical damage `120 + 1.30*source.attr.ad.resolved + 0.40*source.attr.ap.resolved`（**total AD** 直接读 `ad.resolved`，不减 `ad.base`、不称 bonus AD；嵌套二元 `add(add(const 120, mul(const 1.30, read …ad.resolved)), mul(const 0.40, read …ap.resolved))`；每条 read path 恰好一次；非历史 R 三元 add；`copyable_on_hit=false`，非 crit；运行时类型 `20220` + add policy `20170`；禁止可执行图/`required reserved` 使用 `20230`）；**零** Q state / modifiers / listeners / matchers / repeat / control / event / projectile / on-hit / on-attack / cooldown-adjust / basic+spell dual-tag / lifesteal / vamp / AOE 行。**Q 无 ability-specific game-local type**，不新增 Q 专用 62xxx type、不写 `type_relations`。成功非普攻 Q cast 可参与既有自动 `ability_started` 表面（Rising Spell Force 叠一层），本 Q 图不添加 listener / event step。Immediate selected-primary-enemy-champion single physical hit 为 Phase-A scaffold，不是实际 direction / range / projectile travel / collision / first-enemy acquisition / on-hit / on-attack / cooldown reduction / basic+spell dual-tag / lifesteal / vamp / spellshield / buffering / full-Q fidelity。One selected-primary physical hit only, not full Q。Wiki：request `Template:Data Ezreal/Q` → resolved `Template:Data Ezreal/Mystic Shot`；page1307107 / rev4013233 / `2026-04-28T21:19:30Z` / canonical 2054 bytes / SHA256 `be5a24861dc53970c19378fe8bea17b242b5b406a588cebb32b0d59a4af4b533`；sidecar `normalized/generic/ezreal-q.json`（bytes 2527 / SHA256 `b7e8639d6fd82df4c66c4f883078b54274b4a1708fdca6bf2703d70a0518ab47`）+ `pages/ezreal-q.json`（bytes 692 / SHA256 `f5f133eef00f3dd4cdc95c0513d3371851b71d890a61b9e8de93716ccd107060`）。**local raw materialization caveat**：仓库 local raw 2052 / `d8348b3b9eb4a076af5a87b714dd4de109643252f6b18fd2873f5a5bf7b05dbd`；同 size 不等于等价；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾（仅 materialization/serialization caveat）。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。hero-named Wasm test 计划作为回归证据，而非生产分支条件。

确定性夹具（注释记录；不连 live / 不执行 runtime）：`AD0/AP0/armor0` raw/final120；`AD100/AP0` 250；`AD0/AP100` 160；`AD100/AP100` 290；same armor100 raw290/final145；`AD200/AP100/armor100` raw420/final210；totalAD counterproof `base0/resolved100` vs `base60/resolved100`/AP0/armor0 both250（公式只读 `source.attr.ad.resolved`，从不读 `source.attr.ad.base`）；Mana180/base60/resolved100/AP100/HP1000/armor100 在 t0/t4499/t4500 → success/skip/success、two Q hits/automatic starts、readyAt4500、final mana100/HP710；Mana39 → skips unchanged/no damage/start；preserve P/E/R；Q seed contains no W rows。

**排除**（completed-boundary exclusions；不得实现或描述为近似）：direction / range / projectile travel / collision / first-enemy acquisition；on-hit / on-attack / cooldown reduction / basic+spell dual-tag / lifesteal / vamp / spellshield / buffering；ranks1–4；W/other graphs；identity/panel/resource bootstrap；listener/state/event/modifier/repeat/control/projectile/AOE/on-hit/on-attack；live migration；publish；E2E/live/full fidelity。One selected-primary-enemy-champion single physical hit, not full Q。

静态契约校验（不连 live DB；含邻近 Ezreal E/R/P check-only coexistence 与 Jhin Q total-AD+AP physical 先例）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericEzrealMysticShotPrimaryHitSeedSqlTest,LolGenericEzrealArcaneShiftPrimaryHitSeedSqlTest,LolGenericEzrealTrueshotBarragePrimaryHitSeedSqlTest,LolGenericEzrealRisingSpellForceSeedSqlTest,LolGenericJhinDancingGrenadePrimaryFirstHitSeedSqlTest test
```

### LoL generic Akshan Avengerang first-outbound-hit seed（艾克尚 Q / Phase-A v2 选定主冠军首段出站单次物理命中）

在 reserved types、`lol_generic_akshan_dirty_fighting_seed.sql`（`hero_akshan` + `ad`/`mana` 面板 EAV + `provider_hero_akshan_basic_attack` Dirty Fighting 普攻图；**无** mana 资源表行）已就绪后，按顺序执行（**前置为** Dirty Fighting seed；seed **fail-closed** check-only game / reserved（含 `20220`/`20170`）/ `hero_akshan` / `ad`+`mana` 面板 EAV；**Frozen option A**：仅缺席时 `ON CONFLICT DO NOTHING` 插入中性 `resource_definitions(mana)` 与派生自既有 mana 面板 EAV 的 `entity_resource_values(hero_akshan,mana)`——**永不 UPDATE/overwrite/delete** 既有资源行、不硬编码面板 mana；**不**写 `attribute_definitions` / `game_entities` / `entity_attribute_values`；保留 `provider_hero_akshan_basic_attack` 与全部 Dirty Fighting/basic 图不变；不做 live migration、不自动 publish、不连 live DB 执行本 seed；**本 seed 非自包含**）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20220`/`20260`；不含 `20230`）
2. `db/game_manage/seeds/lol_generic_akshan_dirty_fighting_seed.sql`（若 `hero_akshan` / `ad`·`mana` 面板 / basic Dirty Fighting 尚未写入）
3. `db/game_manage/seeds/lol_generic_akshan_avengerang_first_outbound_hit_seed.sql`
4. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish；本任务亦不执行该可选 publish 步骤）

建议发布版本：`lol-generic-akshan-avengerang-first-outbound-hit-phase-a-v2-20260726`（seed 不负责 publish）。候选 `hero_skill|hero_akshan|Q|去而复还`（task `wasm-generic-akshan-avengerang-first-outbound-hit`）冻结为 **Phase-A rank-5 立即选定主冠军首段出站单次物理命中 damage/CD scaffold**（`FROZEN_PLAN_REV=akshan-q-avengerang-first-outbound-hit-phase-a-v2`）：

`rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_and_cooldown_scaffold; physical_165_plus_0_70_bonus_ad; no_direction_range_extension_return_pass_homing_projectile_travel_cooldown_start_after_return_sight_reveal_movement_speed_nonchampion_damage_spellshield_other_ranks_or_full_fidelity`

Ordered tags：`ability_cost_cooldown` → `active_physical_damage` → `bonus_ad_ratio` → `immediate_impact_scaffold`。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `attribute_definitions(ad,mana)` / `hero_akshan` / `entity_attribute_values(hero_akshan,ad|mana)` 做 **fail-closed check-only**；幂等投影 reserved → `types`；仅缺席时中性插入 `resource_definitions.mana` 与派生自既有 mana 面板属性的 `entity_resource_values`（均为 `DO NOTHING`，无 upsert-update）；向 `hero_akshan` **仅** mount 独立 `provider_hero_akshan_q_avengerang_first_outbound_hit`（与既有 `provider_hero_akshan_basic_attack` Dirty Fighting 并存，不更新/删除/重建），含 active `ability_hero_akshan_q_avengerang_first_outbound_hit`（`ability_key=avengerang_first_outbound_hit`）、`ability_costs` 80 mana、`ability_cooldowns` 5000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 physical damage `165 + 0.70*(ad.resolved-ad.base)`（**bonus AD**；嵌套二元 `add(const 165, mul(const 0.70, sub(read …resolved, read …base)))`；每条 read path 恰好一次；`copyable_on_hit=false`，非 crit；运行时类型 `20220` + add policy `20170`；禁止可执行图/`required reserved` 使用 `20230`）；**零** Q state / modifiers / listeners / matchers / repeat / control / event / projectile / return / movement / reveal / Dirty-Fighting stack 行。**Q 无 ability-specific game-local type**，不新增 Q 专用 62xxx type、不写 `type_relations`。Immediate selected-primary-champion first-outbound physical **damage/CD scaffold** 为 Phase-A，不是实际 direction / range / extension / return pass / homing / projectile travel / **cooldown-start-after-return**（真实 Wiki CD「Starts after the boomerang returns」明确排除、不 claim 保真）/ sight / reveal / movement speed / non-champion damage / spellshield / full-Q fidelity。Exactly one outbound selected-primary hit only, not full Q。Wiki：request `Template:Data Akshan/Q` → resolved `Template:Data Akshan/Avengerang`；page1502462 / rev4007510 / `2026-04-11T22:35:01Z` / canonical 2570 bytes / SHA256 `1cbf7dda955849d05ad2d7e578ed9507f8f61fc7525c5ed006a25185915b5f5b`；sidecar `normalized/generic/akshan-q.json`（bytes 2948 / SHA256 `f6b0dd492d80c49a2259d366230f7d8f4c6d43a70688b42d0d0780e4866d9a1a`）+ `pages/akshan-q.json`（bytes 688 / SHA256 `11d2da87557737fed487fb106a9ffb7b4a6d7f1d32391ce3a5c142f9128509e0`）。**local raw materialization caveat**：仓库 local raw 2570 / `407e4671cc05e87edcd0038a9efe614ad98f65cd57ce339c2c9d69afe5b8c973`；同 size 不等于等价；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾（仅 materialization/serialization caveat）。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。hero-named Wasm `_test.go` 计划作为回归证据，而非生产分支条件。

确定性夹具（注释记录；不连 live / 不执行 runtime）：`base0/resolved0/armor0` raw/final165；`base52/resolved52/armor0` raw/final165；`base52/resolved152/armor0` raw/final235；same armor100 raw235/final117.5；`base52/resolved252/armor100` raw305/final152.5；bonusAD counterproof `base0/resolved100` vs `base52/resolved152` at armor0 both raw/final235；mana240/baseAD52/resolvedAD152/HP1000/armor100 在 t0/t4999/t5000 → success/skip/success、exactly two Q hits/automatic starts、readyAt5000、final mana80/HP765；mana79 → resource skip；preserve Dirty Fighting/basic。

**排除**（completed-boundary exclusions；不得实现或描述为近似）：direction / range / extension；return pass / homing / projectile travel；cooldown start after return；sight / reveal / movement speed；non-champion damage / spellshield；ranks1–4；Dirty Fighting stack coupling / basic mutation；identity/panel attribute bootstrap（资源表仅 absent-only）；listener/state/event/modifier/repeat/control/projectile/return/movement/reveal/Dirty-Fighting stack；live migration；publish；E2E/live/full fidelity。One selected-primary first-outbound physical hit, not full Q。

静态契约校验（不连 live DB；含 Dirty Fighting 保留、Graves Q first-outbound bonus-AD、Quinn Q absent-only mana 先例）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericAkshanAvengerangFirstOutboundHitSeedSqlTest,LolGenericAkshanDirtyFightingSeedSqlTest,LolGenericGravesEndOfTheLineFirstOutboundPassSeedSqlTest,LolGenericQuinnBlindingAssaultPrimaryHitSeedSqlTest test
```

### LoL generic Sivir Boomerang Blade first-outbound-hit seed（希维尔 Q / Phase-A v3 选定主冠军首段出站单次物理命中）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_sivir)`、`attribute_definitions(ad)`、`entity_attribute_values(hero_sivir,ad)`、`attribute_definitions(ap)`、`entity_attribute_values(hero_sivir,ap)`、`attribute_definitions(crit_chance)`、`entity_attribute_values(hero_sivir,crit_chance)`、`resource_definitions(mana)`、`entity_resource_values(hero_sivir,mana)` 已存在后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**物化身份/面板/资源值——当前仓库亦无 Sivir identity/panel/resource materializer / owning Sivir materializer；仅挂载可 cast 的独立 Q active **选定主冠军首段出站单次物理命中**；standalone sibling absence：不创建/突变/合成/复制 P/W/E/R/basic；Backend prerequisite checks 为 publication guard，generic runtime 缺失 attr 读为 0 且不断言 fail-closed；不检视/不断言 `crit_chance` DB min/max 元数据；不做 live migration、不自动 publish、不连 live DB 执行本 seed；**本 seed 非自包含**）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20220`/`20260`；不含 `20230`）
2. `db/game_manage/seeds/lol_generic_sivir_boomerang_blade_first_outbound_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish；本任务亦不执行该可选 publish 步骤）

建议发布版本：`lol-generic-sivir-boomerang-blade-first-outbound-hit-phase-a-v3-20260726`（seed 不负责 publish）。候选 `hero_skill|hero_sivir|Q|回旋之刃`（task `wasm-generic-sivir-boomerang-blade-first-outbound-hit`）冻结为 **Phase-A rank-5 立即选定主冠军首段出站单次物理命中 damage/CD scaffold**（`FROZEN_PLAN_REV=sivir-q-boomerang-blade-first-outbound-hit-phase-a-v3`）：

`rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_and_cooldown_scaffold; physical_base_160_plus_0_70_bonus_ad_plus_0_60_ap_scaled_by_0_to_0_40_formula_clamped_crit_chance; no_cast_time_bonus_attack_speed_direction_range_width_geometry_projectile_travel_speed_nonchampion_hit_reduction_return_pass_damage_modifier_reset_once_per_pass_spellshield_other_ranks_or_full_fidelity`

Ordered tags：`ability_cost_cooldown` → `active_physical_damage` → `bonus_ad_ratio` → `ap_ratio` → `crit_scaling` → `immediate_impact_scaffold`。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_sivir` / `ad`+`ap`+`crit_chance` 定义与实体值 / `mana` 资源定义与实体资源值做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`）；幂等投影 reserved → `types`；向 `hero_sivir` **仅** mount 独立 `provider_hero_sivir_q_boomerang_blade_first_outbound_hit`（stable id `hero_sivir_q_boomerang_blade_first_outbound_hit`；standalone；不创建/突变/合成/复制 P/W/E/R/basic），含 active `ability_hero_sivir_q_boomerang_blade_first_outbound_hit`（`ability_key=boomerang_blade_first_outbound_hit`）、`ability_costs` 75 mana、`ability_cooldowns` 8000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 physical damage `(160 + 0.70*(ad.resolved-ad.base) + 0.60*ap.resolved) * (1.00 + 0.40 * min(1.00, max(0.00, crit_chance.resolved)))`（**bonus AD** + AP + formula-local crit_chance clamp；嵌套二元 `mul(add(add(const 160, mul(const 0.70, sub(read …ad.resolved, read …ad.base))), mul(const 0.60, read …ap.resolved)), add(const 1.00, mul(const 0.40, min(const 1.00, max(const 0.00, read …crit_chance.resolved)))))`；每条 read path 恰好一次；`copyable_on_hit=false`，noncritical / 确定性金额缩放，非 random crit pipeline / 不写 `crit_damage` / `crit_eligible`；运行时类型 `20220` + add policy `20170`；禁止可执行图/`required reserved` 使用 `20230=provider_action/apply`）；**零** provider state / modifiers / listeners / matchers / explicit events / repeats / control / projectile / geometry / return / nonchampion / once-per-pass 行。**Q 无 ability-specific game-local type**，不新增 Q 专用 62xxx type、不写 `type_relations`。成功 cast 由 runtime 自动发出 `ability_started`（本 Q 图不添加 listener / event step）。Immediate selected-primary-champion first-outbound physical **damage/CD scaffold** 为 Phase-A，不是实际 cast time / bonus attack speed / Effect at cast end / direction / range / width / geometry / projectile travel / speeds / collision / nonchampion hit reduction / return pass / damage modifier / direction-change reset / once-per-pass / spellshield / full-Q fidelity。Exactly one outbound selected-primary hit only, not full Q。Wiki：request `Template:Data Sivir/Q` → resolved `Template:Data Sivir/Boomerang Blade`；page1308837 / rev4016378 / `2026-05-11T05:05:57Z` / canonical 2745 bytes / SHA256 `0adcf3916b63e8b0ae6c2c7ad74d1796e3362a3a22682c58ef92aaccfae43e5e`；sidecar `normalized/generic/sivir-q.json`（bytes 3018 / SHA256 `2320f7ada83cceee979c52cd314395c6b41e2f50c50e3114e9bca0d39386ff02`）+ `pages/sivir-q.json`（bytes 691 / SHA256 `adeab85889a4208b52f0b6cd3bcc3aef022a986dcad5168e1c817e3ab3323fa9`；Wasm repo authoritative）。**local raw materialization caveat**：仓库 local raw 2745 / `b8d46412519f211b27f2575684693f407806cbbca337a80e775a1baf4c2396a4`；同 size 不等于等价；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾（仅 materialization/serialization caveat）。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。hero-named Wasm `_test.go` 计划作为回归/治理证据，而非生产分支条件；生产 runtime 仍为 generic。

确定性夹具（注释记录；不连 live / 不执行 runtime）：armor100 下 `base60/resolved160/AP100` crit0/0.5/1 → raw290/348/406 与 final145/174/203；crit-0.25 clamps0 →290/145；crit1.25 clamps1 →406/203；bonusAD counterproof `base0/resolved100` vs `base60/resolved160` at AP100/crit0 both290/145；AP0 vs AP100 at bonusAD100/crit0 raw230 vs290；mana225/crit0.5 在 t0/t7999/t8000 → success/cooldown skip/success、exactly two Q hits and automatic starts、readyAt8000、final mana75/HP652；mana74 → resource skip；standalone isolation mounts only this Q and synthesizes no P/W/E/R/basic。

**排除**（completed-boundary exclusions；不得实现或描述为近似）：cast time / bonus attack speed / Effect at cast end；direction/range/width/geometry；projectile/travel/speeds/collision；nonchampion hit reduction/cap；direction-change reset；return/equal second pass/total/return-after-death/homing/once-per-pass state；spellshield；multi/secondary；ranks1–4；P/W/E/R/basic/loadout/on-hit；identity/panel/resource bootstrap；listener/state/event/modifier/repeat/control/projectile/geometry/return/nonchampion/sibling；crit pipeline/crit_damage/random crit；live migration；publish；E2E/live/full fidelity。One selected-primary first-outbound hit, not full Q。

静态契约校验（不连 live DB；含 Akshan Q first-outbound physical scaffold、Twisted Fate Q / Tristana R / Senna R bonusAD+AP、Essence Reaver crit_chance read-path 先例）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericSivirBoomerangBladeFirstOutboundHitSeedSqlTest,LolGenericAkshanAvengerangFirstOutboundHitSeedSqlTest,LolGenericTwistedFateWildCardsPrimaryHitSeedSqlTest,LolGenericTristanaBusterShotPrimaryHitSeedSqlTest,LolGenericEssenceReaverSpellbladeSeedSqlTest,LolGenericSennaDawningShadowPrimaryHitSeedSqlTest test
```

### LoL generic Jinx Zap! primary-hit seed（金克丝 W / Phase-A v1 主冠军命中）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_jinx)`、`attribute_definitions(ad)`、`entity_attribute_values(hero_jinx,ad)`、`resource_definitions(mana)`、`entity_resource_values(hero_jinx,mana)` 已存在后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**物化身份/面板/资源值，**不**物化 Jinx ad/mana 行——当前仓库亦无 seed / materializer 负责物化这些行；仅挂载可 cast 的 W active；不做 live migration、不自动 publish、不连 live DB 执行本 seed）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20220`/`20260`）
2. `db/game_manage/seeds/lol_generic_jinx_zap_primary_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-jinx-zap-primary-hit-phase-a-v1-20260725`（seed 不负责 publish）。候选 `hero_skill|hero_jinx|W|震荡电磁波！`（task `wasm-generic-jinx-zap-primary-hit`）冻结为 **Phase-A rank-5 立即主冠军物理命中 impact scaffold**（`FROZEN_PLAN_REV=jinx-w-zap-primary-hit-phase-a-v1`）：

`rank5_primary_champion_single_physical_hit; immediate_impact_scaffold; physical_210_plus_1_40_total_ad; no_cast_timing_direction_range_width_projectile_travel_collision_first_enemy_acquisition_sight_reveal_slow_other_ranks_or_full_fidelity`

Ordered tags：`ability_cost_cooldown` → `active_physical_damage` → `immediate_impact_scaffold`。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_jinx` / `ad` 定义与实体值 / `mana` 资源定义与实体资源值做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`）；幂等投影 reserved → `types`；向 `hero_jinx` **仅** mount 独立 `provider_hero_jinx_w_zap_primary_hit`（standalone；不创建/突变 P/Q/E/R/basic），含 active `ability_hero_jinx_w_zap_primary_hit`（`ability_key=zap_primary_hit`）、`ability_costs` 60 mana、`ability_cooldowns` 4000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 physical damage `210 + 1.40*source.attr.ad.resolved`（**total AD**，直接读 `ad.resolved`，不减 `ad.base`、不称 bonus AD；二元 `add(const 210, mul(const 1.40, read …))`；`copyable_on_hit=false`，非 crit；运行时类型 `20220`）；**零** provider state / modifiers / listeners / matchers / explicit events / repeats / control / projectile / sight / reveal / slow 行。成功 cast 由 runtime 自动发出 `ability_started`（本 W 图不添加 listener / event step）。Wiki：request `Template:Data Jinx/W` → resolved `Template:Data Jinx/Zap!`；page1307598 / rev3907092 / `2025-06-06T17:47:18Z` / canonical 1321 bytes / SHA256 `8aa6ac3943076256fe6afea15f1dd6eebf892656be45784e2522abb6243f4d1f`；sidecar `normalized/generic/jinx-w.json` + pages sibling。**local raw materialization caveat**：仓库 local raw 1319 / `c373cc258c5c8c612930a32c5e851bd4b68dbbcb3c0d7f71ce1d25020ba12624`；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

确定性夹具（注释记录；不连 live / 不执行 runtime）：totalAD60 → raw294 / armor0=294 / armor100=147；totalAD110 → raw364 / armor0=364 / armor100=182；mana180/HP1000/totalAD110/armor100 在 t0/t3999/t4000 → 两次成功 + 一次 cooldown skip、两笔 W damage、final mana60/HP636、两次自动 W `ability_started`；mana59 → resource skip、不变、无 W damage/event；standalone provider 不合成 P/Q/E/R/basic。

**排除**：cast timing / Effect at cast time start；direction/range/width/geometry；projectile/travel/collision/interception/spellshield/first-enemy acquisition；sight/reveal；slow magnitude/duration/control/tenacity；ranks1–4；P/Q/E/R/basic/loadout/crit/on-hit；identity/panel/resource bootstrap；listener/state/event/modifier/repeat/control/projectile/sight/reveal/slow；live migration；publish；E2E/full fidelity。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericJinxZapPrimaryHitSeedSqlTest,LolGenericKaisaVoidSeekerPrimaryHitSeedSqlTest,LolGenericDravenStandAsideSeedSqlTest test
```

### LoL generic Jinx Flame Chompers! selected-primary explosion-hit seed（金克丝 E / Phase-A v1 选定主冠军单次魔法爆炸命中）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_jinx)`、`attribute_definitions(ap)`、`entity_attribute_values(hero_jinx,ap)`、`resource_definitions(mana)`、`entity_resource_values(hero_jinx,mana)` 已存在后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**物化身份/面板/资源值，**不**物化 Jinx ap/mana 行——当前仓库亦无 seed / materializer 负责物化这些行；仅挂载可 cast 的独立 E active **选定主冠军单次魔法爆炸命中**；**不依赖/不突变**既有 Jinx W Zap；亦不创建/突变 P/Q/W/R/basic；不做 live migration、不自动 publish、不连 live DB 执行本 seed；**本 seed 非自包含**）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20221`/`20260`；不含 `20230`）
2. `db/game_manage/seeds/lol_generic_jinx_flame_chompers_primary_explosion_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish；本任务亦不执行该可选 publish 步骤）

建议发布版本：`lol-generic-jinx-flame-chompers-primary-explosion-hit-phase-a-v1-20260726`（seed 不负责 publish）。候选 `hero_skill|hero_jinx|E|嚼火者手雷！`（task `wasm-generic-jinx-flame-chompers-primary-explosion-hit`）冻结为 **Phase-A rank-5 立即选定主冠军单次魔法爆炸命中 impact + cooldown scaffold**（`FROZEN_PLAN_REV=jinx-e-flame-chompers-primary-explosion-hit-phase-a-v1`）：

`rank5_selected_primary_champion_single_magic_explosion_hit; immediate_impact_and_cooldown_scaffold; magic_290_plus_1_00_ap; no_three_chomper_layout_landing_delay_arming_delay_five_second_lifetime_location_direction_range_geometry_area_multitarget_contact_acquisition_knockdown_root_one_chomper_per_champion_wind_wall_braum_spellshield_exception_vision_other_ranks_or_full_fidelity`

Ordered tags：`ability_cost_cooldown` → `active_magic_damage` → `ap_ratio` → `immediate_impact_scaffold`。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_jinx` / `ap` 定义与实体值 / `mana` 资源定义与实体资源值做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`）；幂等投影 reserved → `types`；向 `hero_jinx` **仅** mount 独立 `provider_hero_jinx_e_flame_chompers_primary_explosion_hit`（stable id `hero_jinx_e_flame_chompers_primary_explosion_hit`；standalone；不创建/突变 P/Q/W/R/basic；不依赖/不突变既有 Jinx W Zap），含 active `ability_hero_jinx_e_flame_chompers_primary_explosion_hit`（`ability_key=flame_chompers_primary_explosion_hit`）、`ability_costs` 90 mana、`ability_cooldowns` 10000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 magic damage `290 + 1.00*source.attr.ap.resolved`（AP 直接读 `ap.resolved`；无关 AD 变化不得改变 E 伤害；二元 `add(const 290, mul(const 1.00, read …))`；`copyable_on_hit=false`，非 crit；运行时类型 `20221` + add policy `20170`；禁止可执行图/`required reserved` 使用 `20230=provider_action/apply`）；**零** provider state / modifiers / listeners / matchers / explicit events / repeats / control / projectile / vision / sibling 行。成功 cast 由 runtime 自动发出 `ability_started`（本 E 图不添加 listener / event step）。Immediate impact and cooldown 为 Phase-A scaffold，不是实际三枚 Chomper 布局/落地/武装/寿命/接触爆炸。Wiki：request `Template:Data Jinx/E` → resolved `Template:Data Jinx/Flame Chompers!`；page1307600 / rev3993368 / `2026-02-21T15:35:19Z` / canonical 1786 bytes / SHA256 `64562ed4adb34c932810970fd9b9c016b46329d6f956541d334c60d2bc9d83ee`；sidecar `normalized/generic/jinx-e.json`（bytes2228 / SHA256 `de7922f66deb96c8652dd1a0509105b49cdcf22278d1fd591bc366060987183a`）+ `pages/jinx-e.json`（bytes694 / SHA256 `f2822e5708dd024c582575a9298c12b6e6cd66b37e3365ea8749e8e1d49b360d`；Wasm repo authoritative）。**local raw materialization caveat**：仓库 local raw 1784 / `aabb099fd172522682e40f0826e4971797c3a047787ef3c5af902bc4b673a551`；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

确定性夹具（注释记录；不连 live / 不执行 runtime）：AP0 → raw290；MR100 → final145；AP100 → raw390；MR100 → final195；changing unrelated AD must not change E damage；mana270/AP100/HP1000/MR100 在 t0/t9999/t10000 → success/skip/success、two E damage items、两次自动 E `ability_started`、final mana90/HP610；mana89 → resource skip、不变、无 E damage/event；standalone E 不合成 P/Q/W/R/basic，不突变/依赖既有 Jinx W Zap。

**排除**（completed-boundary exclusions；不得实现或描述为近似）：three-Chomper layout/count/identity；0.4s landing / 0.5s arming / 5s lifetime / delayed schedule；location/direction/range/geometry/radius/area/multitarget；contact/collision/acquisition；one-Chomper-per-champion；knockdown/root/CC/control；Wind Wall/Braum；spell-shield exception；vision；ranks1–4；P/Q/W/R/basic/loadout/bootstrap；identity/panel/resource bootstrap；listener/state/event/modifier/repeat/control/projectile/vision/sibling；live migration；publish；E2E/full E/full-game fidelity。Exactly one selected-primary champion magic explosion-hit quantum，不是主张游戏内 E 只有一枚陷阱或一次总命中。

静态契约校验（不连 live DB；含邻近 Jinx W check-only physical、Lucian W / Corki Q AP-magic direct-hit 先例）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericJinxFlameChompersPrimaryExplosionHitSeedSqlTest,LolGenericJinxZapPrimaryHitSeedSqlTest,LolGenericLucianArdentBlazePrimaryHitSeedSqlTest,LolGenericCorkiPhosphorusBombPrimaryImpactSeedSqlTest test
```

### LoL generic Jhin Deadly Flourish primary-hit seed（戏命师 W / Phase-A v1 主冠军命中）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_jhin)`、`attribute_definitions(ad)`、`entity_attribute_values(hero_jhin,ad)`、`resource_definitions(mana)`、`entity_resource_values(hero_jhin,mana)` 已存在后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**物化身份/面板/资源值，**不**物化 Jhin ad/mana 行——当前仓库亦无 seed / materializer 负责物化这些行；仅挂载可 cast 的 W active；不做 live migration、不自动 publish、不连 live DB 执行本 seed）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20220`/`20260`）
2. `db/game_manage/seeds/lol_generic_jhin_deadly_flourish_primary_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-jhin-deadly-flourish-primary-hit-phase-a-v1-20260725`（seed 不负责 publish）。候选 `hero_skill|hero_jhin|W|致命华彩`（task `wasm-generic-jhin-deadly-flourish-primary-hit`）冻结为 **Phase-A rank-5 立即主冠军物理命中 impact scaffold**（`FROZEN_PLAN_REV=jhin-w-deadly-flourish-primary-hit-phase-a-v1`）：

`rank5_primary_champion_single_physical_hit; immediate_impact_scaffold; physical_210_plus_0_50_total_ad; no_cast_timing_direction_range_width_line_geometry_multitarget_champion_collision_projectile_interception_spell_shield_mark_creation_mark_detection_root_bonus_movement_speed_minion_reduction_other_ranks_or_full_fidelity`

Ordered tags：`ability_cost_cooldown` → `active_physical_damage` → `immediate_impact_scaffold`。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_jhin` / `ad` 定义与实体值 / `mana` 资源定义与实体资源值做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`）；幂等投影 reserved → `types`；向 `hero_jhin` **仅** mount 独立 `provider_hero_jhin_w_deadly_flourish_primary_hit`（standalone；不创建/突变 P/Q/E/R/basic），含 active `ability_hero_jhin_w_deadly_flourish_primary_hit`（`ability_key=deadly_flourish_primary_hit`）、`ability_costs` 70 mana、`ability_cooldowns` 12000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 physical damage `210 + 0.50*source.attr.ad.resolved`（**total AD**，直接读 `ad.resolved`，不减 `ad.base`、不称 bonus AD；二元 `add(const 210, mul(const 0.50, read …))`；`copyable_on_hit=false`，非 crit；运行时类型 `20220`）；**零** provider state / modifiers / listeners / matchers / explicit events / repeats / control / projectile / mark / root / movement-speed 行。成功 cast 由 runtime 自动发出 `ability_started`（本 W 图不添加 listener / event step）。Wiki：request `Template:Data Jhin/W` → resolved `Template:Data Jhin/Deadly Flourish`；page1307581 / rev4021795 / `2026-05-21T13:25:33Z` / canonical 2942 bytes / SHA256 `14790ca09f6f320fc2fadc81c2fa7e783c7b81d48d792b7760494f2e8d788c65`；sidecar `normalized/generic/jhin-w.json` + pages sibling。**local raw materialization caveat**：仓库 local raw 2940 / `76790ba522dc101bb1f1c24ae620f80e8db6d10e890515cbc7da85005a67f78b`；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

确定性夹具（注释记录；不连 live / 不执行 runtime）：totalAD60 → raw240 / armor0=240 / armor100=120；totalAD100 → raw260 / armor0=260 / armor100=130；mana210/HP1000/totalAD100/armor100 在 t0/t11999/t12000 → 两次成功 + 一次 cooldown skip、两笔 W damage、final mana70/HP740、两次自动 W `ability_started`；mana69 → resource skip、不变、无 W damage/event；standalone provider 不合成 P/Q/E/R/mark/root/movement-speed/basic。

**排除**：cast timing / Effect at cast time start；direction/range/width/line geometry；multitarget/champion collision；projectile/interception/spell shield/facing；mark creation/detection；root/control/tenacity；bonus movement speed；minions-only 25% reduction；ranks1–4；P/Q/E/R/basic/loadout/crit/on-hit；identity/panel/resource bootstrap；listener/state/event/modifier/repeat/control/projectile/mark/root/movement-speed；live migration；publish；E2E/full fidelity。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericJhinDeadlyFlourishPrimaryHitSeedSqlTest,LolGenericJinxZapPrimaryHitSeedSqlTest,LolGenericKaisaVoidSeekerPrimaryHitSeedSqlTest test
```

### LoL generic Jhin Dancing Grenade primary-first-hit seed（戏命师 Q / Phase-A v1 选定主冠军首发手雷单次物理命中）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_jhin)`、`attribute_definitions(ad)`、`entity_attribute_values(hero_jhin,ad)`、`attribute_definitions(ap)`、`entity_attribute_values(hero_jhin,ap)`、`resource_definitions(mana)`、`entity_resource_values(hero_jhin,mana)` 已存在后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**物化身份/面板/资源值，**不**物化 Jhin ad/ap/mana 行——当前仓库亦无 seed / materializer 负责物化这些行；仅挂载可 cast 的独立 Q active **选定主冠军首发手雷单次物理命中**；**保留既有 W**（Deadly Flourish）但不要求/突变/合成/复制 W；亦不要求/突变/合成/复制 P/E/R/basic；**Q seed 不含任何 W rows**；Q/W isolation 仅允许 test-only composition of independent graphs；不做 live migration、不自动 publish、不连 live DB 执行本 seed；**本 seed 非自包含**）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20220`/`20260`；不含 `20230`）
2. `db/game_manage/seeds/lol_generic_jhin_dancing_grenade_primary_first_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish；本任务亦不执行该可选 publish 步骤）

建议发布版本：`lol-generic-jhin-dancing-grenade-primary-first-hit-phase-a-v1-20260726`（seed 不负责 publish）。候选 `hero_skill|hero_jhin|Q|曼舞手雷`（task `wasm-generic-jhin-dancing-grenade-primary-first-hit`）冻结为 **Phase-A rank-5 立即选定主冠军首发手雷单次物理命中 impact scaffold**（`FROZEN_PLAN_REV=jhin-q-dancing-grenade-primary-first-hit-phase-a-v1`）：

`rank5_selected_primary_champion_first_grenade_single_physical_hit; immediate_impact_scaffold; physical_144_plus_0_74_total_ad_plus_0_60_ap; no_cast_time_unit_targeted_cancel_conditions_projectile_travel_first_target_acquisition_bounce_to_up_to_three_additional_targets_nearest_unhit_priority_target_death_35_percent_damage_increase_later_bounce_scaling_maximum_final_bounce_spellshield_bounce_persistence_other_ranks_or_full_fidelity`

Ordered tags：`ability_cost_cooldown` → `active_physical_damage` → `ap_ratio` → `immediate_impact_scaffold`（**不含** governed tag `total_ad_ratio`；total AD 仅显式出现在 boundary/reason/formula；亦不含 salvage tags）。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_jhin` / `ad`+`ap` 定义与实体值 / `mana` 资源定义与实体资源值做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`）；幂等投影 reserved → `types`；向 `hero_jhin` **仅** mount 独立 `provider_hero_jhin_q_dancing_grenade_primary_first_hit`（stable id `hero_jhin_q_dancing_grenade_primary_first_hit`；standalone；不创建/突变/合成/复制 P/W/E/R/basic），含 active `ability_hero_jhin_q_dancing_grenade_primary_first_hit`（`ability_key=dancing_grenade_primary_first_hit`）、`ability_costs` 60 mana、`ability_cooldowns` 5000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 physical damage `144 + 0.74*source.attr.ad.resolved + 0.60*source.attr.ap.resolved`（**total AD** 直接读 `ad.resolved`，不减 `ad.base`、不称 bonus AD；嵌套二元 `add(add(const 144, mul(const 0.74, read …ad.resolved)), mul(const 0.60, read …ap.resolved))`；每条 read path 恰好一次；`copyable_on_hit=false`，非 crit；运行时类型 `20220` + add policy `20170`；禁止可执行图/`required reserved` 使用 `20230=provider_action/apply`）；**零** provider state / modifiers / listeners / matchers / explicit events / repeats / control / secondary / projectile / movement / geometry / bounce / death-amplification 行。**Q 无 ability-specific game-local type**，不新增 Q 专用 62xxx type、不写 `type_relations`。成功 cast 由 runtime 自动发出 `ability_started`（本 Q 图不添加 listener / event step；无 Q-specific type）。Immediate selected-primary-champion first-grenade physical hit 为 Phase-A scaffold，不是实际 cast time / unit-targeted cancel / projectile travel / first-target acquisition / bounce / nearest-unhit / target-death +35% later-bounce / maximum final bounce / spellshield bounce-persistence / full-Q fidelity。Wiki：request `Template:Data Jhin/Q` → resolved `Template:Data Jhin/Dancing Grenade`；page1307579 / rev4007611 / `2026-04-12T07:23:12Z` / canonical 1913 bytes / SHA256 `522c4b918067b4b035b6744eb3dc83ce64ba5d47f677ed8517fcb246111685f1`；sidecar `normalized/generic/jhin-q.json`（bytes 2388 / SHA256 `6f5c6dcc9771140136705f8e6554cb999f7ec5a1272515d5cbd03b910bdd20b1`）+ `pages/jhin-q.json`（bytes 682 / SHA256 `642d7c88a064cd3107a4cf9f51a75be2ca91bb2e904afd6cfa8cf3ead92b7897`；Wasm repo authoritative）。**local raw materialization caveat**：仓库 local raw 1911 / `17deceae0abe42034f805a166ae5a16932ffcb19925654e6aa39625f026dd0cb`；同 size 不等于等价；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾（仅 materialization/serialization caveat）。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

确定性夹具（注释记录；不连 live / 不执行 runtime）：`AD0/AP0/armor0` raw/final144；`AD100/AP0` 218；`AD0/AP100` 204；`AD100/AP100` 278；same armor100 raw278/final139；`AD200/AP100/armor100` raw352/final176；totalAD counterproof `base0/resolved100` vs `base60/resolved100`/AP0/armor0 both218（公式只读 `source.attr.ad.resolved`，从不读 `source.attr.ad.base`）；Mana180/base60/resolved100/AP100/HP1000/armor100 在 t0/t4999/t5000 → success/skip/success、two Q hits/automatic starts、readyAt5000、final mana60/HP722；Mana59 → skips unchanged/no damage/start；Q/W isolation；standalone provider 保留既有 W，不合成 P/W/E/R/basic。

**排除**（completed-boundary exclusions；不得实现或描述为近似）：cast time / unit-targeted cancel conditions；projectile travel / impact timing / first-target acquisition；bounce to up to three additional enemies / nearest-unhit priority / multiple targets；target-death observation / +35% later-bounce amplification / maximum final bounce；all primary-hit spellshield absorption and bounce-persistence semantics；ranks1–4；P/W/E/R/basic/loadout/crit/on-hit；identity/panel/resource bootstrap；listener/state/event/modifier/repeat/control/secondary/projectile/movement/geometry/bounce/death-amplification/sibling；live migration；publish；E2E/live/full fidelity。One selected-primary-champion first-grenade single physical hit, not full Q。

静态契约校验（不连 live DB；含邻近 Jhin W check-only physical immediate-impact、Lucian R / Quinn Q totalAD+AP physical formula、Senna W / Graves Q selected-primary salvage 先例）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericJhinDancingGrenadePrimaryFirstHitSeedSqlTest,LolGenericJhinDeadlyFlourishPrimaryHitSeedSqlTest,LolGenericLucianTheCullingSingleShotQuantumSeedSqlTest,LolGenericQuinnBlindingAssaultPrimaryHitSeedSqlTest,LolGenericSennaLastEmbraceFirstEnemyHitSeedSqlTest,LolGenericGravesEndOfTheLineFirstOutboundPassSeedSqlTest test
```

### LoL generic Corki Phosphorus Bomb primary-impact seed（飞机 Q / Phase-A v1 选定主冠军单次魔法 impact 命中）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_corki)`、`attribute_definitions(ad)`、`entity_attribute_values(hero_corki,ad)`、`attribute_definitions(ap)`、`entity_attribute_values(hero_corki,ap)`、`resource_definitions(mana)`、`entity_resource_values(hero_corki,mana)` 已存在后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**物化身份/面板/资源值，**不**物化 Corki ad/ap/mana 行——当前仓库亦无 seed / materializer 负责物化这些行；Q 仍为 check-only，**不**拥有/物化 `missile_barrage_ammo`（该资源仅由 R Missile Barrage seed 拥有）；仅挂载可 cast 的独立 Q active **选定主冠军单次魔法 impact 命中**；不要求/突变/合成/复制 P/W/E/R/basic；不做 live migration、不自动 publish、不连 live DB 执行本 seed；**本 seed 非自包含**）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20221`/`20260`；不含 `20230`）
2. `db/game_manage/seeds/lol_generic_corki_phosphorus_bomb_primary_impact_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish；本任务亦不执行该可选 publish 步骤）

建议发布版本：`lol-generic-corki-phosphorus-bomb-primary-impact-phase-a-v1-20260726`（seed 不负责 publish）。候选 `hero_skill|hero_corki|Q|磷光炸弹`（task `wasm-generic-corki-phosphorus-bomb-primary-impact`）冻结为 **Phase-A rank-5 立即选定主冠军单次魔法 impact 命中 impact scaffold**（`FROZEN_PLAN_REV=corki-q-phosphorus-bomb-primary-impact-phase-a-v1`）：

`rank5_selected_primary_champion_single_magic_impact_hit; immediate_impact_scaffold; magic_240_plus_1_25_bonus_ad_plus_1_00_ap; no_cast_time_location_targeting_range_radius_geometry_projectile_travel_minimum_travel_time_explosion_aoe_multitarget_surrounding_or_travel_sight_impact_area_sight_enemy_champion_reveal_six_second_duration_spellshield_other_ranks_or_full_fidelity`

Ordered tags：`ability_cost_cooldown` → `active_magic_damage` → `bonus_ad_ratio` → `ap_ratio` → `immediate_impact_scaffold`（不含 salvage tags；亦不含 `meta_or_non_target_dps`）。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_corki` / `ad`+`ap` 定义与实体值 / `mana` 资源定义与实体资源值做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`）；幂等投影 reserved → `types`；向 `hero_corki` **仅** mount 独立 `provider_hero_corki_q_phosphorus_bomb_primary_impact`（stable id `hero_corki_q_phosphorus_bomb_primary_impact`；standalone；不创建/突变/合成/复制 P/W/E/R/basic），含 active `ability_hero_corki_q_phosphorus_bomb_primary_impact`（`ability_key=phosphorus_bomb_primary_impact`）、`ability_costs` 80 mana、`ability_cooldowns` 7000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 magic damage `240 + 1.25*(ad.resolved-ad.base) + 1.00*ap.resolved`（**bonus AD** 显式 `sub(resolved, base)`，不得 total-AD 直读；嵌套二元 `add(add(const 240, mul(const 1.25, sub(read …resolved, read …base))), mul(const 1.00, read …ap.resolved))`；每条 read path 恰好一次；`copyable_on_hit=false`，非 crit；运行时类型 `20221` + add policy `20170`；禁止可执行图/`required reserved` 使用 `20230=provider_action/apply`）；**零** provider state / modifiers / listeners / matchers / explicit events / repeats / control / secondary / projectile / movement / geometry / AOE / sight / reveal / duration 行。**Q 无 ability-specific game-local type**，不新增 Q 专用 62xxx type、不写 `type_relations`。成功 cast 由 runtime 自动发出 `ability_started`（本 Q 图不添加 listener / event step；无 Q-specific type）。Immediate selected-primary-champion magic impact hit 为 Phase-A scaffold，不是实际 cast time / location targeting / range / radius / geometry / projectile travel / minimum travel time / explosion AOE / multitarget / surrounding or travel sight / impact-area sight / enemy-champion reveal / six-second duration / spellshield / full-Q fidelity。Wiki：request `Template:Data Corki/Q` → resolved `Template:Data Corki/Phosphorus Bomb`；page1306953 / rev4007588 / `2026-04-12T06:50:59Z` / canonical 1531 bytes / SHA256 `e71a474ef6b4df1df4808b397c8bd0f42ce284234f3eb7603fab09cabd760365`；sidecar `normalized/generic/corki-q.json`（bytes 2148 / SHA256 `3c4584b2e8442e7ff2ae1d2d4c4d8dff4613efa98bf7ba4cd3ab44ef05c8572d`）+ `pages/corki-q.json`（bytes 691 / SHA256 `bff7e3533e2bba561c03e91da5d7c07ffc095e07a0669b321cc7fd480d18f42a`；Wasm repo authoritative）。**local raw materialization caveat**：仓库 local raw 1529 / `c39556a0d90226462e8a939ebe58888ec91325a9ca4d10be23e43dd77d948ba6`；同 size 不等于等价；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾（仅 materialization/serialization caveat）。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

确定性夹具（注释记录；不连 live / 不执行 runtime）：`base60/resolved60/AP0/MR0` raw/final240；`base60/resolved160/AP0` 365；`base60/resolved60/AP100` 340；`base60/resolved160/AP100` 465；`base60/resolved156/AP100/MR100` raw460/final230；`base60/resolved220/AP100/MR100` raw540/final270；bonusAD counterproof `base0/resolved100` vs `base60/resolved160`/AP0/MR0 both365；Mana240/base60/resolved156/AP100/HP1000/MR100 在 t0/t6999/t7000 → success/skip/success、two Q hits/automatic starts、readyAt7000、final mana80/HP540；Mana79 → skips unchanged/no damage/start；standalone provider 不合成 P/W/E/R/basic。

**排除**（completed-boundary exclusions；不得实现或描述为近似）：cast time / location targeting / range / radius / geometry；projectile identity / travel / speed / minimum travel time / actual explosion timing；AOE / multiple targets / collision / acquisition / spellshield；surrounding / travel / impact sight；enemy-champion reveal / six-second duration；ranks1–4；P/W/E/R/basic/siblings/loadout/bootstrap/crit/on-hit；identity/panel/resource bootstrap；listener/state/event/modifier/repeat/control/secondary/projectile/movement/geometry/AOE/sight/reveal/duration/sibling；live migration；publish；E2E/live/full fidelity。One selected-primary-champion single magic impact hit, not full Q。

静态契约校验（不连 live DB；含邻近 Tristana W / Ezreal E/R / Twisted Fate Q magic bonusAD+AP immediate-impact，Lucian W AOE/sight exclusions，以及最近 Jhin Q / Graves Q selected-primary salvage 结构先例；Quinn Q 仅为历史 classification override 先例，非 magic-hit 标签）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericCorkiPhosphorusBombPrimaryImpactSeedSqlTest,LolGenericTristanaRocketJumpPrimaryLandingHitSeedSqlTest,LolGenericEzrealArcaneShiftPrimaryHitSeedSqlTest,LolGenericEzrealTrueshotBarragePrimaryHitSeedSqlTest,LolGenericTwistedFateWildCardsPrimaryHitSeedSqlTest,LolGenericLucianArdentBlazePrimaryHitSeedSqlTest,LolGenericJhinDancingGrenadePrimaryFirstHitSeedSqlTest,LolGenericGravesEndOfTheLineFirstOutboundPassSeedSqlTest test
```

### LoL generic Corki Missile Barrage normal primary-hit seed（飞机 R / Phase-A v1 普通导弹选定主冠军第一敌人物理命中）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_corki)`、`attribute_definitions(ad)`、`entity_attribute_values(hero_corki,ad)`、`resource_definitions(mana)`、`entity_resource_values(hero_corki,mana)` 已存在后，按顺序执行（**check-only / external existing-data** 身份/ad/mana；**不做** hero/panel/ad/mana 自包含写入；**仅拥有**机制专用 `resource_definitions(missile_barrage_ammo)` default_initial2/default_max4 与 `entity_resource_values(hero_corki,missile_barrage_ammo)` initial2/max4；不要求 AP；与既有 Corki Q Phosphorus Bomb 并存且不突变；不要求/突变/合成/复制 P/Q/W/E/basic；不做 live migration、不自动 publish、不连 live DB 执行本 seed；**本 seed 非自包含**）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20112`/`20120`/`20130`/`20142`/`20150`/`20152`/`20170`/`20220`/`20260`；不含 `20230`）
2. `db/game_manage/seeds/lol_generic_corki_missile_barrage_normal_primary_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish；本任务亦不执行该可选 publish 步骤）

建议发布版本：`lol-generic-corki-missile-barrage-normal-primary-hit-phase-a-v1-20260726`（seed 不负责 publish）。候选 `hero_skill|hero_corki|R|火箭轰击`（task `wasm-generic-corki-missile-barrage-normal-primary-hit`）冻结为 **Phase-A rank-3 立即普通导弹选定主冠军第一敌人物理命中 impact scaffold**（`FROZEN_PLAN_REV=corki-r-missile-barrage-normal-primary-hit-phase-a-v1`）：

`rank3_normal_missile_selected_primary_champion_first_enemy_hit; immediate_impact_scaffold; physical_250_plus_0_85_bonus_ad; mana35_plus_one_missile_barrage_ammo_atomic_gate_and_spend; initial_ammo_two_max_four; cooldown2000ms; no_direction_projectile_travel_collision_explosion_aoe_multitarget_big_one_third_shot_cycle_double_damage_range_radius_periodic_stock_recharge_respawn_refill_basic_attack_on_hit_recharge_reduction_crit_scaling_malignance_eclipse_interaction_other_ranks_or_full_fidelity`

Ordered tags：`ability_cost_cooldown` → `ammo_gate_and_spend` → `active_physical_damage` → `bonus_ad_ratio` → `immediate_impact_scaffold`（不含 salvage tags；亦不含 `meta_or_non_target_dps`）。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_corki` / `ad` 定义与实体值 / `mana` 资源定义与实体资源值做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `game_entities` / `entity_attribute_values`；不写/覆盖 mana 资源行）；幂等投影 reserved → `types`；**仅**幂等写入 `missile_barrage_ammo` 定义与实体资源值（2/4）；向 `hero_corki` **仅** mount 独立 `provider_hero_corki_r_missile_barrage_normal_primary_hit`（stable id `hero_corki_r_missile_barrage_normal_primary_hit`；standalone；与既有 Corki Q Phosphorus Bomb 并存且不突变；不创建/突变/合成/复制 P/Q/W/E/basic），含 active `ability_hero_corki_r_missile_barrage_normal_primary_hit`（`ability_key=missile_barrage_normal_primary_hit`；`cast_condition_formula_key=missile_barrage_cast_condition` 精确 `gte(read source.resource.missile_barrage_ammo.current, const 1)`；`cast_origin=champion`）、**恰好一个** `ability_costs` 35 mana（绝不第二行 ammo cost——Web 仅投影第一行）、`ability_cooldowns` 2000ms、恰好一个 null-duration impact phase + on_enter sequence，以及两步：step0 `operation/resource_change`（selector/source `20112`；`resource_effect_details` `resource_key=missile_barrage_ammo` / amount formula const -1 / add policy `20170` / operation `20152` / step_order0——仓库首个 LoL seed 使用 `resource_effect_details`）、step1 direct-opponent noncritical/noncopyable physical damage `250 + 0.85*(ad.resolved-ad.base)`（**bonus AD** 显式 `sub(resolved, base)`，不得 total-AD 直读；二元 `add(const 250, mul(const 0.85, sub(read …resolved, read …base)))`；每条 read path 恰好一次；`copyable_on_hit=false`，非 crit；运行时类型 `20220` + add policy `20170`；禁止可执行图/`required reserved` 使用 `20230=provider_action/apply`）；**零** provider state / modifiers / listeners / matchers / explicit events / repeats / control / secondary / projectile / movement / geometry / AOE / multitarget / Big One / third-shot / recharge / refill 行。**R 无 ability-specific game-local type**，不新增 R 专用 62xxx type、不写 `type_relations`。成功 cast 由 runtime 自动发出 `ability_started`（本 R 图不添加 listener / event step；无 R-specific type）。mana35 + 1 ammo 以「唯一 ability_costs(mana) + cast_condition gate + resource_effect spend」原子投影。Immediate normal-missile selected-primary first-enemy physical hit 为 Phase-A scaffold，不是实际 direction / projectile travel / collision / explosion AOE / multitarget / Big One / third-shot cycle / double damage / range / radius / periodic stock recharge / respawn refill / basic-attack on-hit recharge reduction / crit scaling / Malignance / Eclipse / full-R fidelity。Wiki：request `Template:Data Corki/R` → resolved `Template:Data Corki/Missile Barrage`；page1306946 / rev4042863 / `2026-07-14T19:35:26Z` / canonical 3065 bytes / SHA256 `1c2da7a1ea6bd4904c498eeb823e75dbf0f1e354cf5fe22f72dee2bb09ac4845`；sidecar `normalized/generic/corki-r.json`（bytes 3265 / SHA256 `dcaa1352eba2fa1d6c2acfc1aba9320bccb200b5b9d00dba559373e0981adbe0`）+ `pages/corki-r.json`（bytes 691 / SHA256 `694cda4c4d4ee4e9606ac1ca82a7085f89b7898884b23653bf718e86bfcd5bc7`；Wasm repo authoritative）。**local raw materialization caveat**：仓库 local raw 3063 / `3764aafcecd5ef76f619472e443869c2ef43fd5b062894f6e111172f9a5cf91a`；同 size 不等于等价；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾（仅 materialization/serialization caveat）。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

确定性夹具（注释记录；不连 live / 不执行 runtime）：`base60/resolved60/armor0` raw/final250；`base60/resolved160/armor0` 335；`base60/resolved160/armor100` raw335/final167.5；bonusAD counterproof `base0/resolved100` vs `base60/resolved160`/armor0 both335；Mana240/Ammo2/base60/resolved160/HP1000/armor100 在 t0/t1999/t2000 → success/skip/success、two R hits/automatic starts、readyAt2000、final mana170/ammo0/HP665；Mana34 或 Ammo0 → skips unchanged/no damage/start；standalone provider 与 Corki Q 并存、不合成 P/Q/W/E/basic。

**排除**（completed-boundary exclusions；不得实现或描述为近似）：direction / projectile travel / collision / explosion AOE / multitarget；Big One / third-shot cycle / double damage；range / radius；periodic stock recharge / respawn refill；basic-attack on-hit recharge reduction；crit scaling / Malignance / Eclipse interaction；ranks1–2；P/Q/W/E/basic/siblings/loadout/bootstrap；identity/panel/ad/mana bootstrap（ammo 除外）；listener/state/event/modifier/repeat/control/secondary/projectile/movement/geometry/AOE/sibling；live migration；publish；E2E/live/full fidelity。One normal-missile selected-primary first-enemy physical hit, not full R。

静态契约校验（不连 live DB；含邻近 Corki Q check-only magic impact 与 Draven R physical bonusAD immediate-impact 先例）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericCorkiMissileBarrageNormalPrimaryHitSeedSqlTest,LolGenericCorkiPhosphorusBombPrimaryImpactSeedSqlTest,LolGenericDravenWhirlingDeathPrimaryOutboundHitSeedSqlTest test
```

### LoL generic Miss Fortune Bullet Time max-channel expected seed（厄运小姐 R / Phase-A v3 最大全通道选定主冠军期望总物理伤害）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_missfortune)`、`attribute_definitions(ad)`、`entity_attribute_values(hero_missfortune,ad)`、`attribute_definitions(ap)`、`entity_attribute_values(hero_missfortune,ap)`、`attribute_definitions(crit_chance)`、`entity_attribute_values(hero_missfortune,crit_chance)`、`resource_definitions(mana)`、`entity_resource_values(hero_missfortune,mana)` 已存在后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**物化身份/面板/资源值——当前仓库亦无 Miss Fortune identity/panel/resource materializer / owning Miss Fortune materializer；仅挂载可 cast 的独立 R active **最大全通道期望总物理伤害聚合量子**；standalone sibling absence：不创建/突变/合成/复制 P/Q/W/E/basic；Backend prerequisite checks 为 publication guard，generic runtime 缺失 attr 读为 0 且不断言 fail-closed；不检视/不断言 `crit_chance` DB min/max 元数据；不做 live migration、不自动 publish、不连 live DB 执行本 seed；**本 seed 非自包含**；**不以** `数据参考/champion/MissFortune.json` legacy DDragon 为当前真相）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20220`/`20260`；不含 `20230`）
2. `db/game_manage/seeds/lol_generic_miss_fortune_bullet_time_max_channel_expected_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish；本任务亦不执行该可选 publish 步骤）

建议发布版本：`lol-generic-miss-fortune-bullet-time-max-channel-expected-phase-a-v3-20260726`（seed 不负责 publish）。候选 `hero_skill|hero_missfortune|R|弹幕时间`（task `wasm-generic-miss-fortune-bullet-time-max-channel-expected`）冻结为 **Phase-A rank-3 立即最大全通道选定主冠军期望总物理伤害聚合 scaffold**（`FROZEN_PLAN_REV=miss-fortune-r-bullet-time-max-channel-expected-phase-a-v3`）：

`rank3_max_full_channel_selected_primary_champion_expected_total_physical_damage; immediate_aggregated_channel_total_scaffold; eighteen_waves; per_wave_40_plus_0_60_total_ad_plus_0_25_ap; base_wave_crit_multiplier_1_30; expected_factor_one_plus_0_30_times_formula_clamped_crit_chance; mana100_cooldown100000ms; exactly_one_aggregated_damage_quantum; phase_a_excludes_wiki_ie_crit_ratio_30; no_channel_timing_tick_schedule_interruption_cancel_direction_cone_six_projectiles_per_wave_collision_geometry_multitarget_wave_by_wave_snapshot_dynamic_stats_sight_reveal_spellshield_rng_on_crit_basic_attack_other_ranks_or_full_fidelity`

Ordered tags：`ability_cost_cooldown` → `active_physical_damage` → `ap_ratio` → `crit_scaling` → `immediate_aggregated_channel_total_scaffold`（显式不包含 `total_ad_ratio`；仓库治理禁止该 governed tag）。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_missfortune` / `ad`+`ap`+`crit_chance` 定义与实体值 / `mana` 资源定义与实体资源值做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`）；幂等投影 reserved → `types`；向 `hero_missfortune` **仅** mount 独立 `provider_hero_missfortune_r_bullet_time_max_channel_expected`（stable id `hero_missfortune_r_bullet_time_max_channel_expected`；standalone；不创建/突变/合成/复制 P/Q/W/E/basic），含 active `ability_hero_missfortune_r_bullet_time_max_channel_expected`（`ability_key=bullet_time_max_channel_expected`）、`ability_costs` 100 mana、`ability_cooldowns` 100000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 physical damage `18 * (40 + 0.60*ad.resolved + 0.25*ap.resolved) * (1.00 + 0.30 * min(1.00, max(0.00, crit_chance.resolved)))`（**total AD** 直接读 `ad.resolved`，不减 `ad.base`、不称 bonus AD；AP + formula-local crit_chance clamp；嵌套二元 `mul(const 18, mul(add(add(const 40, mul(const 0.60, read …ad.resolved)), mul(const 0.25, read …ap.resolved)), add(const 1.00, mul(const 0.30, min(const 1.00, max(const 0.00, read …crit_chance.resolved))))))`；每条 read path 恰好一次；`copyable_on_hit=false`，noncritical / 确定性金额缩放，非 random crit pipeline / 不写 `crit_damage` / `crit_eligible`（`crit_eligible=false`）；运行时类型 `20220` + add policy `20170`；禁止可执行图/`required reserved` 使用 `20230=provider_action/apply`）；**零** provider state / modifiers / listeners / matchers / explicit events / repeats / tick / control / projectile / geometry / multitarget / wave-by-wave 行。**R 无 ability-specific game-local type**，不新增 R 专用 62xxx type、不写 `type_relations`。成功 cast 由 runtime 自动发出 `ability_started`（本 R 图不添加 listener / event step）。Immediate max-full-channel selected-primary-champion expected total physical **aggregated channel total scaffold** 为 Phase-A，不是实际 channel timing / tick schedule / interruption / cancel / direction / cone / six projectiles per wave / collision / geometry / multitarget / wave-by-wave snapshot / dynamic stats / sight / reveal / spellshield / RNG-on-crit / basic attack / full-R fidelity。Exactly one aggregated max-full-channel expected quantum only, not full R。Wiki：request `Template:Data Miss Fortune/R` → resolved `Template:Data Miss Fortune/Bullet Time`；page1308257 / rev3987215 / `2026-01-25T03:47:11Z` / canonical 3021 bytes / SHA256 `354cac88f79defa26369f485743f697bf61b50a814b008a8aa6c308b7e394d8a`；sidecar `normalized/generic/missfortune-r.json`（bytes 3550 / SHA256 `b275bcc7fb13855cf3fb5a7a8ca0cddce4964ed5713dc521eceb573e69b78c49`）+ `pages/missfortune-r.json`（bytes 743 / SHA256 `43bb41feafeaa7a8416bd91b81f51f4be73d3bf30ff78ccb2190fc317f3084d6`；Wasm repo authoritative）。**local raw materialization caveat**：仓库 local raw 3021 / `19ba845fd99a0da526b34e55c833f9902c0ce9feb55ad486a1d18c12b55a1049`；同 size 不等于等价；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾（仅 materialization/serialization caveat）。Wiki `{{critical damage|130|30}}` **含** Infinity Edge ratio；本 Phase-A **仅**实现 base130 expected crit（factor `1 + 0.30 * formula-clamped crit_chance`）并 **显式排除** Wiki IE ratio 30；绝不主张 Wiki 省略 IE。Wiki Maximum Total Physical Damage 为 noncrit 对照。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。hero-named Wasm `_test.go` 计划作为 **test-only** 回归/治理证据，而非生产分支条件；生产 runtime 仍为 generic。

确定性夹具（注释记录；不连 live / 不执行 runtime；JUnit 静态代数 counterproof）：`totalAD100/AP0` crit0/0.5/1 → raw1800/2070/2340；crit0.5/armor100 → final1035；`totalAD100/AP100/crit0.5` → raw2587.5；crit-0.25 clamps0 →1800；crit1.25 clamps1 →2340；total-AD counterproof `base0/resolved100` vs `base60/resolved100` at AP0/crit0 both1800；standalone isolation mounts only this R and synthesizes no P/Q/W/E/basic。

**排除**（completed-boundary exclusions；不得实现或描述为近似）：channel timing / tick schedule / interruption / cancel；direction/cone/six projectiles per wave/collision/geometry；multitarget/wave-by-wave snapshot/dynamic stats；sight/reveal/spellshield；RNG-on-crit/crit pipeline/crit_damage/random crit；**Wiki IE crit ratio 30**（Infinity Edge；Phase-A 显式排除；Wiki 含该 ratio）；ranks1–2；P/Q/W/E/basic/loadout/on-hit；identity/panel/resource bootstrap；listener/state/event/modifier/repeat/tick/control/projectile/geometry/multitarget/sibling；live migration；publish；E2E/live/full fidelity。One aggregated max-full-channel expected quantum, not full R。

静态契约校验（不连 live DB；含 Sivir Q formula-local crit_chance clamp / 无 `total_ad_ratio` 先例，以及 crit_eligible 治理种子）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericMissFortuneBulletTimeMaxChannelExpectedSeedSqlTest,LolGenericCritModifierSeedSqlTest,LolGenericSivirBoomerangBladeFirstOutboundHitSeedSqlTest test
```

### LoL generic Miss Fortune Make It Rain max-duration total selected-primary seed（厄运小姐 E / Phase-A v2 最大时长选定主冠军总魔法伤害聚合）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_missfortune)`、`attribute_definitions(ap)`、`entity_attribute_values(hero_missfortune,ap)`、`resource_definitions(mana)`、`entity_resource_values(hero_missfortune,mana)` 已存在后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**物化身份/面板/资源值——当前仓库亦无 Miss Fortune identity/panel/resource materializer；仅挂载可 cast 的独立 E active **最大时长选定主冠军总魔法伤害聚合量子**；与既有独立 R Bullet Time **并存且不突变/不复制**；standalone：不创建/突变/合成/复制 P/Q/W/R/basic；不做 live migration、不自动 publish、不连 live DB 执行本 seed；**本 seed 非自包含**；**不以** legacy champion JSON 为当前真相）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20221`/`20260`；不含 `20230`）
2. `db/game_manage/seeds/lol_generic_miss_fortune_make_it_rain_max_total_selected_primary_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish；本任务亦不执行该可选 publish 步骤）

建议发布版本：`lol-generic-miss-fortune-make-it-rain-max-total-selected-primary-phase-a-v2-20260726`（seed 不负责 publish）。候选 `hero_skill|hero_missfortune|E|枪林弹雨`（task `wasm-generic-miss-fortune-make-it-rain-max-total-selected-primary`）冻结为 **Phase-A rank-5 立即聚合最大时长选定主冠军总魔法伤害 scaffold**（`FROZEN_PLAN_REV=miss-fortune-e-make-it-rain-max-total-selected-primary-phase-a-v2`）：

`rank5_selected_primary_champion_max_duration_total_magic_damage; immediate_aggregated_duration_total_scaffold; magic_190_plus_1_20_ap; mana80_cooldown14000ms; exactly_one_aggregated_damage_quantum; no_two_second_duration_eight_ticks_quarter_second_tick_schedule_location_area_geometry_multitarget_sight_slow_dynamic_slow_refresh_or_full_fidelity`

Ordered tags：`ability_cost_cooldown` → `active_magic_damage` → `ap_ratio` → `immediate_aggregated_duration_total_scaffold`（**显式不含** `immediate_impact_scaffold`）。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_missfortune` / `ap` 定义与实体值 / `mana` 资源定义与实体资源值做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`）；幂等投影 reserved → `types`；向 `hero_missfortune` **仅** mount 独立 `provider_hero_missfortune_e_make_it_rain_max_total_selected_primary`（stable id `hero_missfortune_e_make_it_rain_max_total_selected_primary`；standalone；与既有 `provider_hero_missfortune_r_bullet_time_max_channel_expected` 并存且不突变/不复制；不创建/突变/合成/复制 P/Q/W/R/basic），含 active `ability_hero_missfortune_e_make_it_rain_max_total_selected_primary`（`ability_key=make_it_rain_max_total_selected_primary`）、`ability_costs` 80 mana、`ability_cooldowns` 14000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 magic damage `190 + 1.20*source.attr.ap.resolved`（AP 直接读 `ap.resolved`；无关 AD/crit 变化不得改变 E 伤害；嵌套二元 `add(const 190, mul(const 1.20, read …))`；AP read 恰好一次；`copyable_on_hit=false`，非 crit / `CritEligible=false`；运行时类型 `20221` + add policy `20170`；禁止可执行图/`required reserved` 使用 `20230=provider_action/apply`）；**零** provider state / modifiers / listeners / matchers / explicit events / repeats / tick / control / scheduler / E-specific type / sibling 行。成功 cast 由 runtime 自动发出 `ability_started`（本 E 图不添加 listener / event step）。Immediate aggregated duration-total selected-primary-champion magic **aggregated duration total scaffold** 为 Phase-A，不是实际两秒时长 / 八 ticks / 0.25s tick schedule / location / area / geometry / multitarget / sight / slow / dynamic slow refresh / full-E fidelity。Exactly one immediate aggregated max-duration total magic quantum only, not full E。Wiki：request `Template:Data Miss Fortune/E` → resolved `Template:Data Miss Fortune/Make It Rain`；page1308255 / rev3936384 / `2025-07-24T15:45:56Z` / canonical 1210 bytes / SHA256 `a38b513373be3b0491f7c967af8827dbdc9196452e5feb25614af3b78ab286f7`；sidecar `normalized/generic/missfortune-e.json`（bytes 1972 / SHA256 `d53466f5d4e7e046620820cfd492133bcfac646e2d81d348dfcf544fe8174596`）+ `pages/missfortune-e.json`（bytes 747 / SHA256 `ac8ffb762ccb1667b7c3f955a60e418cb36553b1c653ebb6a70b613c4bf0a0dc`；Wasm repo authoritative）。**local raw materialization caveat**：仓库 local raw 1210 / `5a8800d1ca721f1583bb3d2c5581977a2e4942d399266ca3c745cd11e6503b7f`；同 size 不等于等价；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾（仅 materialization/serialization caveat）。Wiki total `190 + 120% AP` 可推导为 eight ticks `190/8 + (120/8)% AP` over two seconds；本 Phase-A **仅**实现立即聚合总额，**无** tick schedule。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。hero-named Wasm `_test.go` 计划作为 **test-only** 回归/治理证据，而非生产分支条件；生产 runtime 仍为 generic。

确定性夹具（注释记录；不连 live / 不执行 runtime；JUnit 静态代数 counterproof）：AP0 → raw190；MR100 → final95；AP100 → raw310；MR100 → final155；unrelated AD/crit inputs absent from formula。

**排除**（completed-boundary exclusions；不得实现或描述为近似）：actual two seconds / eight ticks / 0.25s schedule / tick snapshot / rounding；location/area/radius/acquisition/geometry/multi-target/sight；slow/AP-scaled slow/refresh/cleanse；spell-effects/persistent-area/interruption/animation；ranks1–4；P/Q/W/R/basic/loadout/full fidelity；identity/panel/resource bootstrap；listener/state/event/modifier/repeat/tick/control/scheduler/sibling；live migration；publish；E2E/live/full fidelity。One immediate aggregated max-duration total magic quantum, not full E。

静态契约校验（不连 live DB；含邻近 Miss Fortune R standalone aggregated-channel 并存/非突变，以及 Jinx E 选定主冠军 AP-magic 先例）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericMissFortuneMakeItRainMaxTotalSelectedPrimarySeedSqlTest,LolGenericMissFortuneBulletTimeMaxChannelExpectedSeedSqlTest,LolGenericJinxFlameChompersPrimaryExplosionHitSeedSqlTest test
```

### LoL generic Caitlyn 90 Caliber Net primary-hit seed（凯特琳 E / Phase-A v3 主冠军第一敌人命中）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_caitlyn)`、`attribute_definitions(ap)`、`entity_attribute_values(hero_caitlyn,ap)`、`resource_definitions(mana)`、`entity_resource_values(hero_caitlyn,mana)` 已存在后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**物化身份/面板/资源值，**不**物化 Caitlyn ap/mana 行——当前仓库亦无 seed / materializer 负责物化这些行；仅挂载可 cast 的 E active；不做 live migration、不自动 publish、不连 live DB 执行本 seed）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20221`/`20260`；不含 `20230`）
2. `db/game_manage/seeds/lol_generic_caitlyn_90_caliber_net_primary_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish）

建议发布版本：`lol-generic-caitlyn-90-caliber-net-primary-hit-phase-a-v3-20260725`（seed 不负责 publish）。候选 `hero_skill|hero_caitlyn|E|90口径绳网`（task `wasm-generic-caitlyn-90-caliber-net-primary-hit`）冻结为 **Phase-A rank-5 立即主冠军第一敌人魔法命中 impact scaffold**（`FROZEN_PLAN_REV=caitlyn-e-90-caliber-net-primary-hit-phase-a-v3`）：

`rank5_primary_champion_first_enemy_single_magic_hit; immediate_impact_scaffold; magic_280_plus_0_80_ap; no_cast_timing_direction_range_width_line_geometry_multitarget_first_enemy_collision_projectile_suppression_spell_shield_recoil_dash_terrain_buffered_actions_slow_headshot_mark_other_ranks_or_full_fidelity`

Ordered tags：`ability_cost_cooldown` → `active_magic_damage` → `ap_ratio` → `immediate_impact_scaffold`。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_caitlyn` / `ap` 定义与实体值 / `mana` 资源定义与实体资源值做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`）；幂等投影 reserved → `types`；向 `hero_caitlyn` **仅** mount 独立 `provider_hero_caitlyn_e_90_caliber_net_primary_hit`（standalone；不创建/突变 P/Q/W/R/basic），含 active `ability_hero_caitlyn_e_90_caliber_net_primary_hit`（`ability_key=caliber_net_primary_hit`）、`ability_costs` 75 mana、`ability_cooldowns` 8000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 magic damage `280 + 0.80*source.attr.ap.resolved`（AP 直接读 `ap.resolved`；二元 `add(const 280, mul(const 0.80, read …))`；`copyable_on_hit=false`，非 crit；运行时类型 `20221` + add policy `20170`；禁止可执行图/`required reserved` 使用 `20230=provider_action/apply`）；**零** provider state / modifiers / listeners / matchers / explicit events / repeats / control / projectile / slow / recoil / dash / mark 行。成功 cast 由 runtime 自动发出 `ability_started`（本 E 图不添加 listener / event step）。Wiki：request `Template:Data Caitlyn/E` → resolved `Template:Data Caitlyn/90 Caliber Net`；page1306916 / rev4007584 / `2026-04-12T06:47:56Z` / canonical 2095 bytes / SHA256 `9357e7b28b05f738cd8049a2d10a115e4033a54123c0e71f55d1262a92884db2`；sidecar `normalized/generic/caitlyn-e.json` + pages sibling。**local raw materialization caveat**：仓库 local raw 2094 / `3a5eba6df38ec34046440743d55de61490dc7b5a2488b8fc671851474d080073`；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

确定性夹具（注释记录；不连 live / 不执行 runtime）：AP0 → raw280 / MR0=280 / MR100=140；AP100 → raw360 / MR0=360 / MR100=180；mana225/HP1000/AP100/MR100 在 t0/t7999/t8000 → 两次成功 + 一次 cooldown skip、两笔 E damage、final mana75/HP640、两次自动 E `ability_started`；mana74 → resource skip、不变、无 E damage/event；standalone provider 不合成 P/Q/W/R/basic。

**排除**：cast timing / Effect at cast time end；direction/range/width/line geometry；multitarget/first-enemy acquisition/collision；projectile/suppression/interception/spell shield；recoil/dash/terrain/buffered actions；slow magnitude/duration/control/tenacity；Headshot/mark；ranks1–4；P/Q/W/R/basic/loadout/crit/on-hit；identity/panel/resource bootstrap；listener/state/event/modifier/repeat/control/projectile/slow/recoil/dash/mark；live migration；publish；E2E/full fidelity。

静态契约校验（不连 live DB；含邻近 Jhin W/Jinx W 与直接 AP-magic primary-hit）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericCaitlyn90CaliberNetPrimaryHitSeedSqlTest,LolGenericJhinDeadlyFlourishPrimaryHitSeedSqlTest,LolGenericJinxZapPrimaryHitSeedSqlTest,LolGenericTeemoBlindingDartSeedSqlTest,LolGenericGravesSmokeScreenPrimaryHitSeedSqlTest,LolGenericKogmawVoidOozePrimaryHitSeedSqlTest,LolGenericAsheEnchantedCrystalArrowPrimaryHitSeedSqlTest test
```

### LoL generic Caitlyn Piltover Peacemaker first-enemy-hit seed（凯特琳 Q / Phase-A v1 主冠军第一敌人满额物理命中）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_caitlyn)`、`attribute_definitions(ad)`、`entity_attribute_values(hero_caitlyn,ad)`、`resource_definitions(mana)`、`entity_resource_values(hero_caitlyn,mana)` 已存在后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**物化身份/面板/资源值，**不**物化 Caitlyn ad/mana 行——当前仓库亦无 seed / materializer 负责物化这些行；仅挂载可 cast 的 Q active；与既有 Caitlyn E `provider_hero_caitlyn_e_90_caliber_net_primary_hit` **隔离**；不做 live migration、不自动 publish、不连 live DB 执行本 seed；**本 seed 非自包含**）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20220`/`20260`；不含 `20230`）
2. `db/game_manage/seeds/lol_generic_caitlyn_piltover_peacemaker_first_enemy_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish；本任务亦不执行该可选 publish 步骤）

建议发布版本：`lol-generic-caitlyn-piltover-peacemaker-first-enemy-hit-phase-a-v1-20260725`（seed 不负责 publish）。候选 `hero_skill|hero_caitlyn|Q|和平使者`（task `wasm-generic-caitlyn-piltover-peacemaker-first-enemy-hit`）冻结为 **Phase-A rank-5 立即主冠军第一敌人满额物理命中 impact scaffold**（`FROZEN_PLAN_REV=caitlyn-q-piltover-peacemaker-first-enemy-hit-phase-a-v1`）：

`rank5_primary_champion_first_enemy_full_physical_hit; immediate_impact_scaffold; physical_210_plus_2_05_total_ad; no_cast_timing_attack_timer_reset_direction_range_width_line_geometry_multitarget_post_first_enemy_60_percent_trap_reveal_full_damage_projectile_spell_shield_other_ranks_or_full_fidelity`

Ordered tags：`ability_cost_cooldown` → `active_physical_damage` → `immediate_impact_scaffold`。

不加第四个 total AD 比率标签（Jinx W / Jhin W / Kalista Q 同例：比率进入公式，不进 ordered tags）。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_caitlyn` / `ad` 定义与实体值 / `mana` 资源定义与实体资源值做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`）；幂等投影 reserved → `types`；向 `hero_caitlyn` **仅** mount 独立 `provider_hero_caitlyn_q_piltover_peacemaker_first_enemy_hit`（standalone；不创建/突变 P/W/E/R/basic；不触碰既有 Caitlyn E），含 active `ability_hero_caitlyn_q_piltover_peacemaker_first_enemy_hit`（`ability_key=piltover_peacemaker_first_enemy_hit`）、`ability_costs` 75 mana、`ability_cooldowns` 6000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 physical damage `210 + 2.05*source.attr.ad.resolved`（**total AD**，直接读 `ad.resolved`，不减 `ad.base`、不称 bonus AD；二元 `add(const 210, mul(const 2.05, read …))`；`copyable_on_hit=false`，非 crit / `crit_eligible=false`；运行时类型 `20220` + add policy `20170`；禁止可执行图/`required reserved` 使用 `20230=provider_action/apply`）；**零** provider state / modifiers / listeners / matchers / explicit events / repeats / control / projectile / collision / trap / reveal / attack-timer-reset 行。成功 cast 由 runtime 自动发出 `ability_started`（本 Q 图不添加 listener / event step）。Wiki：request `Template:Data Caitlyn/Q` → resolved `Template:Data Caitlyn/Piltover Peacemaker`；page1306911 / rev4007583 / `2026-04-12T06:47:12Z` / canonical 1841 bytes / SHA256 `6c40deba7b6e60ab9c06bc014a214a8be4319c4ddf22c550237b659f19307caf`；sidecar `normalized/generic/caitlyn-q.json` + pages sibling。**local raw materialization caveat**：仓库 local raw 1838 / `93da300971429a629f11a721c3993784db6a99d3559b1286eae9500176560b9a`；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

确定性夹具（注释记录；不连 live / 不执行 runtime）：`AD0/A0=210`；`AD0/A100=105`；`AD100/A0=415`；`AD100/A100=207.5`；`AD200/A100=310`；mana225/HP1000/AD100/armor100 在 t0/t5999/t6000 → 两次成功 + 一次 cooldown skip、两笔 Q damage、final mana75/HP585、两次自动 Q `ability_started`；mana74 → resource skip、不变、无 Q damage/event；standalone provider 不合成 P/W/E/R/basic，与既有 Caitlyn E 隔离。

**排除**：cast timing / Effect at cast time start；attack timer reset；direction/range/width/line geometry；multitarget/post-first-enemy 60% damage；trap/reveal；projectile/full-damage projectile/spell shield；ranks1–4；P/W/E/R/basic/loadout/crit/on-hit；identity/panel/resource bootstrap；listener/state/event/modifier/repeat/control/projectile/collision/trap/reveal/attack-reset；live migration；publish；E2E/full fidelity。

静态契约校验（不连 live DB；含邻近 Caitlyn E / total-AD Jinx W / Jhin W / Kalista Q）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericCaitlynPiltoverPeacemakerFirstEnemyHitSeedSqlTest,LolGenericCaitlyn90CaliberNetPrimaryHitSeedSqlTest,LolGenericJinxZapPrimaryHitSeedSqlTest,LolGenericJhinDeadlyFlourishPrimaryHitSeedSqlTest,LolGenericKalistaPiercePrimaryHitSeedSqlTest test
```

### LoL generic Caitlyn Ace in the Hole single-bullet-quantum seed（凯特琳 R / Phase-A v1 选定主冠军单发物理子弹量子）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_caitlyn)`、`attribute_definitions(ad)`、`entity_attribute_values(hero_caitlyn,ad)`、`resource_definitions(mana)`、`entity_resource_values(hero_caitlyn,mana)` 已存在后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**物化身份/面板/资源值，**不**物化 Caitlyn ad/mana 行——当前仓库亦无 seed / materializer 负责物化这些行；仅挂载可 cast 的 R active **单发 bullet quantum**；**不要求** Caitlyn Q 或 E publication，与既有/未来 Caitlyn P/Q/W/E/basic（含 Piltover Peacemaker Q / 90 Caliber Net E）**并存且不突变**；不做 live migration、不自动 publish、不连 live DB 执行本 seed；**本 seed 非自包含**）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20220`/`20260`；不含 `20230`）
2. `db/game_manage/seeds/lol_generic_caitlyn_ace_in_the_hole_single_bullet_quantum_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish；本任务亦不执行该可选 publish 步骤）

建议发布版本：`lol-generic-caitlyn-ace-in-the-hole-single-bullet-quantum-phase-a-v1-20260725`（seed 不负责 publish）。候选 `hero_skill|hero_caitlyn|R|让子弹飞`（task `wasm-generic-caitlyn-ace-in-the-hole-single-bullet-quantum`）冻结为 **Phase-A rank-3 立即选定主冠军单发物理子弹量子 impact scaffold**（`FROZEN_PLAN_REV=caitlyn-r-ace-in-the-hole-single-bullet-quantum-phase-a-v1`）：

`rank3_selected_primary_champion_single_physical_bullet_quantum; immediate_impact_scaffold; physical_650_plus_1_00_bonus_ad; no_channel_lock_reveal_self_reveal_cancel_refund_short_cooldown_homing_projectile_travel_interception_first_enemy_geometry_crit_scaling_untargetable_resurrection_target_death_corpse_hit_sight_radius_unit_target_cancel_conditions_ability_lockout_other_ranks_or_full_fidelity`

Ordered tags：`ability_cost_cooldown` → `active_physical_damage` → `bonus_ad_ratio` → `immediate_impact_scaffold`（**不含**暴击比率标签）。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_caitlyn` / `ad` 定义与实体值 / `mana` 资源定义与实体资源值做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`）；幂等投影 reserved → `types`；向 `hero_caitlyn` **仅** mount 独立 `provider_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum`（standalone；不创建/突变 P/Q/W/E/basic；不触碰既有 Caitlyn Q/E），含 active `ability_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum`（`ability_key=ace_in_the_hole_single_bullet_quantum`）、`ability_costs` 100 mana、`ability_cooldowns` 90000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 physical damage `650 + 1.00*(ad.resolved-ad.base)`（**bonus AD**，二元 `add(const 650, mul(const 1.00, sub(read …resolved, read …base)))`；`copyable_on_hit=false`，非 crit / `crit_eligible=false`；运行时类型 `20220` + add policy `20170`；禁止可执行图/`required reserved` 使用 `20230=provider_action/apply`）；**零** provider state / modifiers / listeners / matchers / explicit events / repeats / control / channel / projectile / geometry / interception / crit 行。成功 cast 由 runtime 自动发出 `ability_started`（本 R 图不添加 listener / event step）。Immediate selected-primary-champion one-bullet damage 为 Phase-A **single-bullet quantum scaffold**，不是实际 channel/reveal/homing/travel/interception/crit/corpse/full-R fidelity。Wiki：request `Template:Data Caitlyn/R` → resolved `Template:Data Caitlyn/Ace in the Hole`；page1306918 / rev3982561 / `2026-01-09T09:02:59Z` / canonical 3119 bytes / SHA256 `08b488c97fc694d9a3de711ffd4ea0b95fc1746c3a11b9c44b878844e586e8a8`；sidecar `normalized/generic/caitlyn-r.json` + pages sibling（Wasm repo authoritative）。**local raw materialization caveat**：仓库 local raw 亦 3119 / `015c1dbe8f02dd5ac354e6a6da6def878f1acccf788b1f599ee4bfd589e05003`；同 size 不等于等价；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

确定性夹具（注释记录；不连 live / 不执行 runtime）：`base0/resolved0/A0=650`；`base60/resolved60/A0=650`；`base60/resolved160/A0=750`；`base60/resolved160/A100` raw750/final375；`base60/resolved260/A100` raw850/final425；`base0/resolved100` vs `base60/resolved160/A0` both750（bonus-AD proof）；mana300/base60/resolved160/HP1000/A100 在 t0/t89999/t90000 → 两次成功 + 一次 cooldown skip、两笔 R damage、两次自动 R `ability_started`、final mana100/HP250；mana99 → resource skip、不变、无 R damage/event evidence；standalone provider 不合成 P/Q/W/E/basic，不要求 Caitlyn Q 或 E publication，与既有 Caitlyn Q/E 隔离。

**排除**（completed-boundary exclusions；不得实现或描述为近似）：1s channel/locks；target/self reveal/true sight/4s buff；cancel/interrupt/death/untargetable/mana refund/5s canceled cooldown/resurrection；homing/travel/destruction/interception/first-enemy geometry/range；crit chance 0–30%；target death/corpse continuation；sight1500；unit-target cancel conditions/ability lockout；ranks1–2；P/Q/W/E/basic/siblings/loadout/on-hit；identity/panel/resource bootstrap；listener/state/event/modifier/repeat/control/channel/projectile/geometry/interception/crit/sibling；live migration；publish；E2E/live/full fidelity。One quantum, not full R。

静态契约校验（不连 live DB；含邻近 Caitlyn Q/E isolation，以及 Lucian Q bonus-AD / Lucian R quantum 先例）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericCaitlynAceInTheHoleSingleBulletQuantumSeedSqlTest,LolGenericCaitlynPiltoverPeacemakerFirstEnemyHitSeedSqlTest,LolGenericCaitlyn90CaliberNetPrimaryHitSeedSqlTest,LolGenericLucianPiercingLightSelectedTargetHitSeedSqlTest,LolGenericLucianTheCullingSingleShotQuantumSeedSqlTest test
```

### LoL generic Kalista Pierce primary-hit seed（卡莉丝塔 Q / Phase-A v1 主冠军第一敌人命中）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_kalista)`、`attribute_definitions(ad)`、`entity_attribute_values(hero_kalista,ad)`、`resource_definitions(mana)`、`entity_resource_values(hero_kalista,mana)` 已存在后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**物化身份/面板/资源值，**不**物化 Kalista ad/mana 行——当前仓库亦无 seed / materializer 负责物化这些行；仅挂载可 cast 的 Q active；不做 live migration、不自动 publish、不连 live DB 执行本 seed；**本 seed 非自包含**）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20220`/`20260`；不含 `20230`）
2. `db/game_manage/seeds/lol_generic_kalista_pierce_primary_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish；本任务亦不执行该可选 publish 步骤）

建议发布版本：`lol-generic-kalista-pierce-primary-hit-phase-a-v1-20260725`（seed 不负责 publish）。候选 `hero_skill|hero_kalista|Q|穿刺`（task `wasm-generic-kalista-pierce-primary-hit`）冻结为 **Phase-A rank-5 立即主冠军第一敌人物理命中 impact scaffold**（`FROZEN_PLAN_REV=kalista-q-pierce-primary-hit-phase-a-v1`）：

`rank5_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold; physical_270_plus_1_05_total_ad; no_cast_timing_martial_poise_dash_cancel_direction_range_width_line_geometry_multitarget_first_enemy_collision_projectile_interception_spell_shield_kill_continuation_rend_stack_transfer_other_ranks_or_full_fidelity`

Ordered tags：`ability_cost_cooldown` → `active_physical_damage` → `immediate_impact_scaffold`。

不加第四个 total AD 比率标签（Jinx W / Jhin W 同例：比率进入公式，不进 ordered tags）。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_kalista` / `ad` 定义与实体值 / `mana` 资源定义与实体资源值做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`）；幂等投影 reserved → `types`；向 `hero_kalista` **仅** mount 独立 `provider_hero_kalista_q_pierce_primary_hit`（standalone；不创建/突变 P/W/E/R/basic），含 active `ability_hero_kalista_q_pierce_primary_hit`（`ability_key=pierce_primary_hit`）、`ability_costs` 80 mana、`ability_cooldowns` 9000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 physical damage `270 + 1.05*source.attr.ad.resolved`（**total AD**，直接读 `ad.resolved`，不减 `ad.base`、不称 bonus AD；二元 `add(const 270, mul(const 1.05, read …))`；`copyable_on_hit=false`，非 crit / `crit_eligible=false`；运行时类型 `20220` + add policy `20170`；禁止可执行图/`required reserved` 使用 `20230=provider_action/apply`）；**零** provider state / modifiers / listeners / matchers / explicit events / repeats / control / projectile / collision / spell-shield / kill-continuation / Rend-transfer / movement / dash 行。成功 cast 由 runtime 自动发出 `ability_started`（本 Q 图不添加 listener / event step）。Wiki：request `Template:Data Kalista/Q` → resolved `Template:Data Kalista/Pierce`；page1307666 / rev3997075 / `2026-03-06T15:53:18Z` / canonical 1625 bytes / SHA256 `90c490d921da436134c318249fa7d0038ceaa97dfb76e5bdaa0b330a43676a67`；sidecar `normalized/generic/kalista-q.json` + pages sibling。**local raw materialization caveat**：仓库 local raw 1623 / `0b8dd9cf9b40aae52fb6180ecabae7e459970f2f7c4d05711463df25fdbd1c94`；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

确定性夹具（注释记录；不连 live / 不执行 runtime）：`(AD0,A0)=(270,270)`；`(AD0,A100)=(270,135)`；`(AD100,A0)=(375,375)`；`(AD100,A100)=(375,187.5)`；`(AD200,A100)=(480,240)`；mana240/HP1000/AD100/armor100 在 t0/t8999/t9000 → 两次成功 + 一次 cooldown skip、两笔 Q damage、final mana80/HP625、两次自动 Q `ability_started`；mana79 → resource skip、不变、无 Q damage/event；standalone provider 不合成 P/W/E/R/basic。

**排除**：cast timing / Effect at cast time end；Martial Poise / dash cancel；direction/range/width/line geometry；multitarget/first-enemy acquisition/collision；projectile/interception/spell shield；kill continuation / Rend stack transfer；ranks1–4；P/W/E/R/basic/loadout/crit/on-hit；identity/panel/resource bootstrap；listener/state/event/modifier/repeat/control/projectile/collision/spell-shield/kill/Rend/movement/dash；live migration；publish；E2E/full fidelity。

静态契约校验（不连 live DB；含邻近 total-AD Jinx W / Jhin W）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericKalistaPiercePrimaryHitSeedSqlTest,LolGenericJinxZapPrimaryHitSeedSqlTest,LolGenericJhinDeadlyFlourishPrimaryHitSeedSqlTest test
```

### LoL generic Lucian Piercing Light selected-target-hit seed（卢锡安 Q / Phase-A v1 主冠军选定目标命中）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_lucian)`、`attribute_definitions(ad)`、`entity_attribute_values(hero_lucian,ad)`、`resource_definitions(mana)`、`entity_resource_values(hero_lucian,mana)` 已存在后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**物化身份/面板/资源值，**不**物化 Lucian ad/mana 行——当前仓库亦无 seed / materializer 负责物化这些行；仅挂载可 cast 的 Q active；不做 live migration、不自动 publish、不连 live DB 执行本 seed；**本 seed 非自包含**）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20220`/`20260`；不含 `20230`）
2. `db/game_manage/seeds/lol_generic_lucian_piercing_light_selected_target_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish；本任务亦不执行该可选 publish 步骤）

建议发布版本：`lol-generic-lucian-piercing-light-selected-target-hit-phase-a-v1-20260725`（seed 不负责 publish）。候选 `hero_skill|hero_lucian|Q|透体圣光`（task `wasm-generic-lucian-piercing-light-selected-target-hit`）冻结为 **Phase-A rank-5 立即主冠军选定目标物理命中 impact scaffold**（`FROZEN_PLAN_REV=lucian-q-piercing-light-selected-target-hit-phase-a-v1`）：

`rank5_primary_champion_selected_target_single_physical_hit; immediate_impact_scaffold; physical_220_plus_1_00_bonus_ad; no_cast_timing_target_lead_or_dodge_direction_target_range_range_width_line_geometry_multitarget_aoe_spell_shield_buffered_w_or_r_e_lockout_initial_target_death_early_end_other_ranks_or_full_fidelity`

Ordered tags：`ability_cost_cooldown` → `active_physical_damage` → `bonus_ad_ratio` → `immediate_impact_scaffold`。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_lucian` / `ad` 定义与实体值 / `mana` 资源定义与实体资源值做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`）；幂等投影 reserved → `types`；向 `hero_lucian` **仅** mount 独立 `provider_hero_lucian_q_piercing_light_selected_target_hit`（standalone；不创建/突变 P/W/E/R/basic），含 active `ability_hero_lucian_q_piercing_light_selected_target_hit`（`ability_key=piercing_light_selected_target_hit`）、`ability_costs` 80 mana、`ability_cooldowns` 5000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 physical damage `220 + 1.00*(ad.resolved-ad.base)`（**bonus AD**，二元 `add(const 220, mul(const 1.00, sub(read …resolved, read …base)))`；`copyable_on_hit=false`，非 crit / `crit_eligible=false`；运行时类型 `20220` + add policy `20170`；禁止可执行图/`required reserved` 使用 `20230=provider_action/apply`）；**零** provider state / modifiers / listeners / matchers / explicit events / repeats / control / projectile / AOE / geometry / buffer / lockout / death / sibling 行。成功 cast 由 runtime 自动发出 `ability_started`（本 Q 图不添加 listener / event step）。Wiki：request `Template:Data Lucian/Q` → resolved `Template:Data Lucian/Piercing Light`；page1308176 / rev3982579 / `2026-01-09T09:22:29Z` / canonical 1608 bytes / SHA256 `d7b03d15af48312a0ea5a06fa147b43c46d2a7ee6e1491dd121d796a2e452981`；sidecar `normalized/generic/lucian-q.json` + pages sibling。**local raw materialization caveat**：仓库 local raw 亦 1608 / `cd65b80f0580f0e4833028791bba2331a321366307b8c35f7fc28fe06c1f06c1`；同 size 不等于等价；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

确定性夹具（注释记录；不连 live / 不执行 runtime）：`base60/resolved60/armor0` raw/final220，armor100 final110；`base60/resolved160/armor0` raw/final320，armor100 final160；`base60/resolved260/armor100` raw420/final210；mana240/base60/resolved160/HP1000/armor100 在 t0/t4999/t5000 → 两次成功 + 一次 cooldown skip、两笔 Q damage、两次自动 Q `ability_started`、final mana80/HP680；mana79 → resource skip、不变、无 Q damage/event evidence；standalone provider 不合成 P/W/E/R/basic。

**排除**：cast timing / target lead or dodge；direction/target range/range/width/line geometry；multitarget/AOE/spell shield；buffered W or R / E lockout；initial target death early end；ranks1–4；P/W/E/R/basic/loadout/crit/on-hit；identity/panel/resource bootstrap；listener/state/event/modifier/repeat/control/projectile/AOE/geometry/buffer/lockout/death/sibling；live migration；publish；E2E/full fidelity。

静态契约校验（不连 live DB；含邻近 bonus-AD immediate Varus E / Quinn Q，以及近期 check-only Caitlyn Q / Kalista Q）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericLucianPiercingLightSelectedTargetHitSeedSqlTest,LolGenericVarusHailOfArrowsPrimaryHitSeedSqlTest,LolGenericQuinnBlindingAssaultPrimaryHitSeedSqlTest,LolGenericCaitlynPiltoverPeacemakerFirstEnemyHitSeedSqlTest,LolGenericKalistaPiercePrimaryHitSeedSqlTest test
```

### LoL generic Lucian Ardent Blaze primary-hit seed（卢锡安 W / Phase-A v1 主冠军单次魔法命中）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_lucian)`、`attribute_definitions(ap)`、`entity_attribute_values(hero_lucian,ap)`、`resource_definitions(mana)`、`entity_resource_values(hero_lucian,mana)` 已存在后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**物化身份/面板/资源值，**不**物化 Lucian ap/mana 行——当前仓库亦无 seed / materializer 负责物化这些行；仅挂载可 cast 的 W active；**不要求** Lucian Q publication，与既有/未来 Lucian P/Q/E/R/basic（含 Piercing Light Q）**并存且不突变**；不做 live migration、不自动 publish、不连 live DB 执行本 seed；**本 seed 非自包含**）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20221`/`20260`；不含 `20230`）
2. `db/game_manage/seeds/lol_generic_lucian_ardent_blaze_primary_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish；本任务亦不执行该可选 publish 步骤）

建议发布版本：`lol-generic-lucian-ardent-blaze-primary-hit-phase-a-v1-20260725`（seed 不负责 publish）。候选 `hero_skill|hero_lucian|W|热诚烈弹`（task `wasm-generic-lucian-ardent-blaze-primary-hit`）冻结为 **Phase-A rank-5 立即主冠军单次魔法命中 impact scaffold**（`FROZEN_PLAN_REV=lucian-w-ardent-blaze-primary-hit-phase-a-v1`）：

`rank5_primary_champion_single_magic_hit; immediate_impact_scaffold; magic_215_plus_0_90_ap; no_cast_timing_effect_at_cast_time_end_direction_range_missile_collision_cross_explosion_geometry_multitarget_aoe_sight_mark_movement_speed_allied_trigger_vigilance_dodge_block_blind_persistent_damage_spell_shield_exception_other_ranks_or_full_fidelity`

Ordered tags：`ability_cost_cooldown` → `active_magic_damage` → `ap_ratio` → `immediate_impact_scaffold`。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_lucian` / `ap` 定义与实体值 / `mana` 资源定义与实体资源值做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`）；幂等投影 reserved → `types`；向 `hero_lucian` **仅** mount 独立 `provider_hero_lucian_w_ardent_blaze_primary_hit`（standalone；不创建/突变 P/Q/E/R/basic；不触碰既有 Lucian Q），含 active `ability_hero_lucian_w_ardent_blaze_primary_hit`（`ability_key=ardent_blaze_primary_hit`）、`ability_costs` 60 mana、`ability_cooldowns` 10000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 magic damage `215 + 0.90*source.attr.ap.resolved`（AP 直接读 `ap.resolved`；二元 `add(const 215, mul(const 0.90, read …))`；`copyable_on_hit=false`，非 crit；运行时类型 `20221` + add policy `20170`；禁止可执行图/`required reserved` 使用 `20230=provider_action/apply`）；**零** provider state / modifiers / listeners / matchers / explicit events / repeats / control / projectile / geometry / AOE / sight / mark / movement-speed / Vigilance / sibling 行。成功 cast 由 runtime 自动发出 `ability_started`（本 W 图不添加 listener / event step）。Immediate primary-champion damage 为 Phase-A scaffold，不是实际 missile/cross timing 或 acquisition。Wiki：request `Template:Data Lucian/W` → resolved `Template:Data Lucian/Ardent Blaze`；page1308178 / rev3594941 / `2023-09-12T19:08:23Z` / canonical 2542 bytes / SHA256 `b1ea7bc7a2e48be9ab97acfa1fc5addb80b8dd236dc97bd3d57c5e90951418c5`；sidecar `normalized/generic/lucian-w.json` + pages sibling（Wasm repo authoritative）。**local raw materialization caveat**：仓库 local raw 亦 2542 / `a57b0e49765ab5a9bdd30ad295d24e406a90015b083c8a0e817855c6bc152236`；同 size 不等于等价；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

确定性夹具（注释记录；不连 live / 不执行 runtime）：`AP0/MR0` raw/final215；`AP0/MR100` raw215/final107.5；`AP100/MR0` raw/final305；`AP100/MR100` raw305/final152.5；`AP200/MR100` raw395/final197.5；mana180/AP100/HP1000/MR100 在 t0/t9999/t10000 → 两次成功 + 一次 cooldown skip、exactly two W damage items、两次自动 W `ability_started`、final mana60/HP695；mana59 → resource skip、不变、无 W damage/event；standalone provider 不合成 P/Q/E/R/basic，不要求 Lucian Q publication，与既有 Lucian Q 隔离。

**排除**（completed-boundary exclusions；不得实现或描述为近似）：cast timing / Effect at cast time end；direction/range/acquisition；missile/travel/collision；cross explosion geometry/AOE/multitarget；sight；six-second mark；movement-speed buff/rank values；allied trigger/Vigilance；dodge/block/blind/persistent-damage trigger logic；spell-shield mark exception；ranks1–4；P/Q/E/R/basic/on-hit/loadout/crit coupling；identity/panel/attribute/resource/Wiki bootstrap；listener/state/event/modifier/repeat/control/projectile/geometry/AOE/sight/mark/movement-speed/Vigilance/sibling；live migration；publish；E2E/full fidelity。

静态契约校验（不连 live DB；含邻近 Lucian Q isolation 以及 Caitlyn E / Graves W magic AP immediate）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericLucianArdentBlazePrimaryHitSeedSqlTest,LolGenericLucianPiercingLightSelectedTargetHitSeedSqlTest,LolGenericCaitlyn90CaliberNetPrimaryHitSeedSqlTest,LolGenericGravesSmokeScreenPrimaryHitSeedSqlTest test
```

### LoL generic Lucian The Culling single-shot quantum seed（卢锡安 R / Phase-A v2 主冠军首敌单发物理 shot quantum）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_lucian)`、`attribute_definitions(ad)`、`entity_attribute_values(hero_lucian,ad)`、`attribute_definitions(ap)`、`entity_attribute_values(hero_lucian,ap)`、`resource_definitions(mana)`、`entity_resource_values(hero_lucian,mana)` 已存在后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**物化身份/面板/资源值，**不**物化 Lucian ad/ap/mana 行——当前仓库亦无 seed / materializer 负责物化这些行；仅挂载可 cast 的 R active **单发 shot quantum**；**不要求** Lucian Q 或 W publication，与既有/未来 Lucian P/Q/W/E/basic（含 Piercing Light Q / Ardent Blaze W）**并存且不突变**；不做 live migration、不自动 publish、不连 live DB 执行本 seed；**本 seed 非自包含**）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20220`/`20260`；不含 `20230`）
2. `db/game_manage/seeds/lol_generic_lucian_the_culling_single_shot_quantum_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish；本任务亦不执行该可选 publish 步骤）

建议发布版本：`lol-generic-lucian-the-culling-single-shot-quantum-phase-a-v2-20260725`（seed 不负责 publish）。候选 `hero_skill|hero_lucian|R|圣枪洗礼`（task `wasm-generic-lucian-the-culling-single-shot-quantum`）冻结为 **Phase-A rank-3 立即主冠军首敌单发物理 shot quantum impact scaffold**（`FROZEN_PLAN_REV=lucian-r-the-culling-single-shot-quantum-phase-a-v2`）：

`rank3_primary_champion_first_enemy_single_physical_shot_quantum; immediate_impact_scaffold; physical_45_plus_0_25_total_ad_plus_0_15_ap; no_channel_duration_recast_shot_count_crit_scaling_fire_rate_direction_range_width_missile_offset_alternating_guns_travel_collision_multitarget_minion_double_move_ghost_facing_spell_shield_interrupts_ability_lockout_other_ranks_or_full_fidelity`

Ordered tags：`ability_cost_cooldown` → `active_physical_damage` → `ap_ratio` → `immediate_impact_scaffold`（**不含** governed tag `total_ad_ratio`；total AD 仅显式出现在 boundary/reason/formula）。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_lucian` / `ad`+`ap` 定义与实体值 / `mana` 资源定义与实体资源值做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`）；幂等投影 reserved → `types`；向 `hero_lucian` **仅** mount 独立 `provider_hero_lucian_r_the_culling_single_shot_quantum`（standalone；不创建/突变 P/Q/W/E/basic；不触碰既有 Lucian Q/W），含 active `ability_hero_lucian_r_the_culling_single_shot_quantum`（`ability_key=the_culling_single_shot_quantum`）、`ability_costs` 100 mana、`ability_cooldowns` 90000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 physical damage `45 + 0.25*source.attr.ad.resolved + 0.15*source.attr.ap.resolved`（**total AD** 直接读 `ad.resolved`，不减 `ad.base`、不称 bonus AD；嵌套二元 `add(add(const 45, mul(const 0.25, read …ad.resolved)), mul(const 0.15, read …ap.resolved))`；`copyable_on_hit=false`，非 crit；运行时类型 `20220` + add policy `20170`；禁止可执行图/`required reserved` 使用 `20230=provider_action/apply`）；**零** provider state / modifiers / listeners / matchers / explicit events / repeats / control / channel / projectile / geometry / multishot / crit / sibling 行。成功 cast 由 runtime 自动发出 `ability_started`（本 R 图不添加 listener / event step）。Immediate primary-champion one-shot damage 为 Phase-A **single-shot quantum scaffold**，不是实际 channel/missile/acquisition/total-shot/total-ultimate fidelity。Wiki：request `Template:Data Lucian/R` → resolved `Template:Data Lucian/The Culling`；page1308182 / rev4007670 / `2026-04-12T10:40:21Z` / canonical 4477 bytes / SHA256 `7a4679542eebdebf25da391a1222f08df2f416c641f48473d528e62296b9a2f7`；sidecar `normalized/generic/lucian-r.json` + pages sibling（Wasm repo authoritative）。**local raw materialization caveat**：仓库 local raw 亦 4477 / `b63612287a8a965e7655829a2054aec7b019705225fd7e7b4736303a172bc74d`；同 size 不等于等价；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾。Raw variables freeze：`r_d3=45`、`r_ad=25` percent total AD、`r_ap=15` percent AP、cost100 mana、cooldown Rank3 90 seconds、physical damage。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

确定性夹具（注释记录；不连 live / 不执行 runtime）：`baseAD0/resolvedAD0/AP0/armor0` raw/final45；`baseAD60/resolvedAD60/AP0/armor0` raw/final60；`baseAD60/resolvedAD160/AP0/armor0` raw/final85；`baseAD60/resolvedAD160/AP100/armor0` raw/final100；`baseAD60/resolvedAD160/AP100/armor100` raw100/final50；`baseAD60/resolvedAD260/AP200/armor100` raw140/final70；`baseAD0` versus `baseAD60` with `resolvedAD160` 产生相同 raw（公式只读 `source.attr.ad.resolved`，从不读 `source.attr.ad.base`）；mana300/baseAD60/resolvedAD160/AP100/HP1000/armor100 在 t0/t89999/t90000 → 两次成功 + 一次 cooldown skip、exactly two R shot-quantum damage items、两次自动 R `ability_started`、final mana100/HP900；mana99 → resource skip、不变、无 R damage/event；standalone provider 不合成 P/Q/W/E/basic，不要求 Lucian Q 或 W publication，与既有 Lucian Q/W 隔离。

**排除**（completed-boundary exclusions；不得实现或描述为近似）：3-second channel/channel state；0.75-second/manual/automatic recast；22 base shots、crit-chance additional-shot count、total channel damage、cadence/fire-rate scaling；direction/range/width；missile offsets/alternating guns/travel/collision/first-enemy geometry/multitarget；minion double；movement/ghosted/facing；spell-shield handling；interrupts/E usability/Q-W lockout/Thresh/Tahm interactions；ranks1–2；P/Q/W/E/basic/on-hit/loadout/crit coupling；identity/panel/attribute/resource/Wiki bootstrap；listener/state/event/modifier/repeat/control/channel/projectile/geometry/multishot/crit/sibling；live migration；publish；E2E/full fidelity。

静态契约校验（不连 live DB；含邻近 Lucian Q/W isolation，以及 Kai'Sa W total-AD+AP / Caitlyn Q total-AD / Ezreal E nested-formula 先例）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericLucianTheCullingSingleShotQuantumSeedSqlTest,LolGenericLucianPiercingLightSelectedTargetHitSeedSqlTest,LolGenericLucianArdentBlazePrimaryHitSeedSqlTest,LolGenericKaisaVoidSeekerPrimaryHitSeedSqlTest,LolGenericCaitlynPiltoverPeacemakerFirstEnemyHitSeedSqlTest,LolGenericEzrealArcaneShiftPrimaryHitSeedSqlTest test
```

### LoL generic Tristana Rapid Fire timed bonus attack-speed seed（麦林炮手 Q / Phase-A v1 自身限时攻速加成）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_tristana)`、`attribute_definitions(attack_speed)`、`entity_attribute_values(hero_tristana,attack_speed)`、`resource_definitions(mana)`、`entity_resource_values(hero_tristana,mana)` 已存在后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**物化身份/面板/资源值，**不**物化 Tristana attack_speed/mana 行——当前仓库亦无 seed / materializer 负责物化这些行；不以 ensure-entity legacy seeds 为理由物化前置；仅挂载可 cast 的 Q active **自身限时攻速加成**；与既有/未来 R（Buster Shot）**并存**但不依赖/不合成；**不要求** P/W/E/basic/Explosive Charge/R publication；不做 live migration、不自动 publish、不连 live DB 执行本 seed；**本 seed 非自包含**）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20100`/`20110`/`20120`/`20130`/`20160`/`20172`/`20173`/`20181`/`20190`/`20205`/`20212`/`20250`）
2. `db/game_manage/seeds/lol_generic_tristana_rapid_fire_timed_bonus_attack_speed_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish；本任务亦不执行该可选 publish 步骤）

建议发布版本：`lol-generic-tristana-rapid-fire-timed-bonus-attack-speed-phase-a-v1-20260725`（seed 不负责 publish）。候选 `hero_skill|hero_tristana|Q|急速射击`（task `wasm-generic-tristana-rapid-fire-timed-bonus-attack-speed`）冻结为 **Phase-A rank-5 自身限时攻速加成**（`FROZEN_PLAN_REV=tristana-q-rapid-fire-timed-bonus-attack-speed-phase-a-v1`）：

`rank5_self_timed_bonus_attack_speed; duration_7000ms; bonus_attack_speed_120_percent; cooldown_16000ms_prevents_recast_before_expiry; ability_type_listener_isolation_from_buster_shot; no_rank_up_update_attack_animation_windup_basic_attack_count_rotation_cooldown_bypass_other_ranks_or_full_fidelity`

Ordered tags：`ability_cost_cooldown` → `active_attack_speed_modifier` → `timed_state` → `ability_type_listener_isolation`。

**Ability-type listener isolation（必选；同 Xayah W）**：Web 把非空 `provider_listeners.ability_id` 映射为 `ListenerDefinition.abilityRef`，runtime 会把已填充 AbilityRef 当作 `castAbilityAt` 子施法，而不是事件过滤。因此本 seed 将 Q listener 的 `ability_id` 置为 `NULL`，并 fail-closed ensure game-local `62013 ability/tristana_rapid_fire`（`reserved_type_id=NULL`；双向 id↔key collision guards；同 Hexplate `62010` / Xayah W `62012` ability-specific type 模式），写入 `type_relations(lol,62013,'ability','ability_hero_tristana_q_rapid_fire_timed_bonus_attack_speed',...)`（在 listener matching 前物化，参与 material-change-only revision），并为 ALL matcher 保留 `20205 ability_started` + `20212 source_owner` 且新增 `62013`。不得把该 type 写入 `ability_kind_type_id`。R/Buster Shot cast 不得武装 Q 或改变 AS。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_tristana` / `attack_speed` 定义与实体值 / `mana` 资源定义与实体资源值做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`）；幂等投影 reserved → `types`；fail-closed ensure `62013`；向 `hero_tristana` **仅** mount 独立 `provider_hero_tristana_q_rapid_fire_timed_bonus_attack_speed`（stable id `hero_tristana_q_rapid_fire_timed_bonus_attack_speed`；standalone；不创建/突变 R/Buster Shot / P/W/E/basic），含 active `ability_hero_tristana_q_rapid_fire_timed_bonus_attack_speed`（`ability_key=rapid_fire_timed_bonus_attack_speed`）、`ability_costs` 35 mana、`ability_cooldowns` 16000ms、timed `rapid_fire_active`（number max1 / `duration_ms=7000` / refresh policy `20190`）、`ability_started` + `source_owner` + `ability/tristana_rapid_fire` ALL listener 武装 active=1（override `20172`；`ability_id IS NULL`）、以及 AS source `percent_add` `20173` exact binary `mul(const 1.20, read provider.state.rapid_fire_active)`。**零** damage / heal / shield / control / repeat / explicit event / ability_phases 行。成功 cast 由 runtime 自动发出 `ability_started`。Wiki：request `Template:Data Tristana/Q` → resolved `Template:Data Tristana/Rapid Fire`；page1308522 / rev4026462 / `2026-06-09T21:59:03Z` / canonical 872 bytes / SHA256 `f6465863035c4634510ecc96e9ee04f4a998d150871d88e498e6636e27a9d4da`；sidecar `normalized/generic/tristana-q.json` + pages sibling（Wasm repo authoritative）。**local raw materialization caveat**：仓库 local raw 866 / `db084b4142559f0775af841fe163e1b80880e2661b26b6d82fb26261e1f5d170`；同 size 不等于等价；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾（仅 materialization/serialization caveat）。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

**Normal non-refreshing truth**（注释记录；不得把 runtime refresh_policy 本身描述为 non-refresh）：CD 16000ms > duration 7000ms，故任何成功的 normal Q recast 都发生在窗口到期之后；正常路径无法 refresh。明确排除：cooldown bypass/reset、direct state admin、rank-up update。

确定性夹具（注释记录；不连 live / 不执行 runtime）：baseline AS0.60 → active AS1.32 at t0 through t6999 → baseline AS0.60 at t7000；mana105 在 t0/t15999/t16000 → success / cooldown skip / success、exactly two Q `ability_started`、readyAt16000、final mana35 / active1 / AS1.32；mana34 → resource skip、unchanged；R cast must not arm Q or change AS；Q causes no R damage；standalone provider 与 R 并存但不依赖/不合成。

**排除**（completed-boundary exclusions；不得实现或描述为近似）：rank-up update；attack animation/windup；basic attack count/rotation；cooldown bypass/reset/direct state admin；damage/heal/shield/control/repeat/explicit event；ranks1–4；P/W/E/basic/Explosive Charge/loadout；identity/panel/resource bootstrap；Buster Shot dependency/synthesis；live migration；publish；E2E/live/full fidelity。

静态契约校验（不连 live DB；含邻近 Xayah W ability-type isolation、Kai'Sa E / Vayne R timed modifier、Tristana R check-only 先例）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericTristanaRapidFireTimedBonusAttackSpeedSeedSqlTest,LolGenericXayahDeadlyPlumageSeedSqlTest,LolGenericKaisaSuperchargeSeedSqlTest,LolGenericVayneFinalHourTimedBonusAdSeedSqlTest,LolGenericTristanaBusterShotPrimaryHitSeedSqlTest test
```

### LoL generic Tristana Rocket Jump primary landing-hit seed（麦林炮手 W / Phase-A v2 选定主冠军单次魔法落地命中）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_tristana)`、`attribute_definitions(ad)`、`entity_attribute_values(hero_tristana,ad)`、`attribute_definitions(ap)`、`entity_attribute_values(hero_tristana,ap)`、`resource_definitions(mana)`、`entity_resource_values(hero_tristana,mana)` 已存在后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**物化身份/面板/资源值，**不**物化 Tristana ad/ap/mana 行——当前仓库亦无 seed / materializer 负责物化这些行；不以 ensure-entity legacy seeds 为理由物化前置；仅挂载可 cast 的 W active **选定主冠军单次魔法落地命中**；与既有/未来 Q（Rapid Fire）/ R（Buster Shot）**并存**但不依赖/不合成；**不要求** P/Q/E/basic/Explosive Charge/R publication，亦不合成那些行；不做 live migration、不自动 publish、不连 live DB 执行本 seed；**本 seed 非自包含**）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20221`/`20260`；不含 `20230`）
2. `db/game_manage/seeds/lol_generic_tristana_rocket_jump_primary_landing_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish；本任务亦不执行该可选 publish 步骤）

建议发布版本：`lol-generic-tristana-rocket-jump-primary-landing-hit-phase-a-v2-20260726`（seed 不负责 publish）。候选 `hero_skill|hero_tristana|W|火箭跳跃`（task `wasm-generic-tristana-rocket-jump-primary-landing-hit`）冻结为 **Phase-A rank-5 立即选定主冠军单次魔法落地命中 impact scaffold**（`FROZEN_PLAN_REV=tristana-w-rocket-jump-primary-landing-hit-phase-a-v2`）：

`rank5_selected_primary_champion_single_magic_landing_hit; immediate_impact_scaffold; magic_210_plus_1_00_bonus_ad_plus_0_50_ap; no_dash_cast_time_air_time_landing_delay_movement_geometry_speed_terrain_collision_knockdown_grounded_slow_aoe_secondary_takedown_reset_explosive_charge_reset_cast_during_dash_other_ranks_or_full_fidelity`

Ordered tags：`ability_cost_cooldown` → `active_magic_damage` → `bonus_ad_ratio` → `ap_ratio` → `immediate_impact_scaffold`。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_tristana` / `ad`+`ap` 定义与实体值 / `mana` 资源定义与实体资源值做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`）；幂等投影 reserved → `types`；向 `hero_tristana` **仅** mount 独立 `provider_hero_tristana_w_rocket_jump_primary_landing_hit`（stable id `hero_tristana_w_rocket_jump_primary_landing_hit`；standalone；不创建/突变 P/Q/E/basic/Explosive Charge/R），含 active `ability_hero_tristana_w_rocket_jump_primary_landing_hit`（`ability_key=rocket_jump_primary_landing_hit`）、`ability_costs` 50 mana、`ability_cooldowns` 14000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 magic damage `210 + 1.00*(ad.resolved-ad.base) + 0.50*ap.resolved`（**bonus AD** + AP；嵌套二元 `add(add(const 210, mul(const 1.00, sub(read …resolved, read …base))), mul(const 0.50, read …ap.resolved))`；每条 read path 恰好一次；`copyable_on_hit=false`，非 crit；运行时类型 `20221` + add policy `20170`；禁止可执行图/`required reserved` 使用 `20230=provider_action/apply`）；**零** provider state / modifiers / listeners / matchers / explicit events / repeats / control / slow / secondary / channel / projectile / geometry / movement 行。**W 无 ability-specific game-local type**，不得携带 `ability/tristana_rapid_fire` / type `62013`；不新增 W type、不写 `type_relations`；Q listener isolation 依赖 W 缺少 Q type（Q/W isolation：W cast 不得武装 Q；Q cast 不得造成 W damage）。成功 cast 由 runtime 自动发出 `ability_started`（本 W 图不添加 listener / event step）。Immediate selected-primary-champion magic landing hit 为 Phase-A scaffold，不是实际 dash/cast time/air time/landing delay/movement/AOE/slow/full-W fidelity。Wiki：request `Template:Data Tristana/W` → resolved `Template:Data Tristana/Rocket Jump`；page1308523 / rev4007758 / `2026-04-12T14:13:05Z` / canonical 2444 bytes / SHA256 `cf0e3ae91310ab5e7cc04408941671520e3464f75bc61da683b100ea82e56eec`；sidecar `normalized/generic/tristana-w.json` + pages sibling（Wasm repo authoritative）。**local raw materialization caveat**：仓库 local raw 2443 / `7283b2eb2020c20c6e48098e647ba4782b6dc134705c7c668d7e7279da1cabd9`；同 size 不等于等价；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾（仅 materialization/serialization caveat）。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

确定性夹具（注释记录；不连 live / 不执行 runtime）：`baseAD0/resolvedAD0/AP0/MR0` raw/final210；`baseAD60/resolvedAD60/AP0/MR0` raw/final210；`baseAD60/resolvedAD160/AP0/MR0` raw/final310；`baseAD60/resolvedAD160/AP100/MR0` raw/final360；`baseAD60/resolvedAD160/AP100/MR100` raw360/final180；`baseAD60/resolvedAD260/AP200/MR100` raw510/final255；`baseAD0/resolvedAD100/AP100` vs `baseAD60/resolvedAD160/AP100` at MR0 both360（bonus-AD proof）；mana150/base60/resolved160/AP100/HP1000/MR100 在 t0/t13999/t14000 → 两次成功 + 一次 cooldown skip、exactly two W hits、两次自动 W `ability_started`、readyAt14000、final mana50/HP640；mana49 → resource skip、不变、无 W damage/start；Q/W isolation：W cast does not arm Q；Q cast causes no W damage；standalone provider 不合成 P/Q/E/basic/Explosive Charge/R。

**排除**（completed-boundary exclusions；不得实现或描述为近似）：dash/cast time 0.25/air time/landing delay；movement/destination/range/speed/terrain/collision/geometry；landing AOE/effect radius 350/spellaoe/multiple or secondary targets；40% slow 2s/knockdown/grounded/spellshield；takedown/clone/max-stack Explosive Charge reset and cooldown bypass/reset；casting abilities/spells/items during dash；ranks1–4；P/Q/E/basic/Explosive Charge/R/loadout/crit/on-hit；identity/panel/resource bootstrap；listener/state/event/modifier/repeat/control/slow/secondary/movement/geometry/sibling；live migration；publish；E2E/live/full fidelity。One selected-target magic landing hit, not full W。

静态契约校验（不连 live DB；含邻近 Tristana R nested bonusAD+AP、Tristana Q check-only/sibling coexistence，以及 Graves W / Ezreal E / Varus E primary-impact scaffold 先例）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericTristanaRocketJumpPrimaryLandingHitSeedSqlTest,LolGenericTristanaBusterShotPrimaryHitSeedSqlTest,LolGenericTristanaRapidFireTimedBonusAttackSpeedSeedSqlTest,LolGenericGravesSmokeScreenPrimaryHitSeedSqlTest,LolGenericEzrealArcaneShiftPrimaryHitSeedSqlTest,LolGenericVarusHailOfArrowsPrimaryHitSeedSqlTest test
```

### LoL generic Tristana Buster Shot primary-hit seed（麦林炮手 R / Phase-A v1 选定主冠军单次魔法命中）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_tristana)`、`attribute_definitions(ad)`、`entity_attribute_values(hero_tristana,ad)`、`attribute_definitions(ap)`、`entity_attribute_values(hero_tristana,ap)`、`resource_definitions(mana)`、`entity_resource_values(hero_tristana,mana)` 已存在后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**物化身份/面板/资源值，**不**物化 Tristana ad/ap/mana 行——当前仓库亦无 seed / materializer 负责物化这些行；不以 ensure-entity legacy seeds 为理由物化前置；仅挂载可 cast 的 R active **选定主冠军单次魔法命中**；**不要求** P/Q/W/E/basic/Explosive Charge publication，亦不合成那些行；不做 live migration、不自动 publish、不连 live DB 执行本 seed；**本 seed 非自包含**）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20221`/`20260`；不含 `20230`）
2. `db/game_manage/seeds/lol_generic_tristana_buster_shot_primary_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish；本任务亦不执行该可选 publish 步骤）

建议发布版本：`lol-generic-tristana-buster-shot-primary-hit-phase-a-v1-20260725`（seed 不负责 publish）。候选 `hero_skill|hero_tristana|R|毁灭射击`（task `wasm-generic-tristana-buster-shot-primary-hit`）冻结为 **Phase-A rank-3 立即选定主冠军单次魔法命中 impact scaffold**（`FROZEN_PLAN_REV=tristana-r-buster-shot-primary-hit-phase-a-v1`）：

`rank3_selected_primary_champion_single_magic_hit; immediate_impact_scaffold; magic_325_plus_0_70_bonus_ad_plus_1_00_ap; no_cast_time_knockback_stun_reveal_secondary_zero_damage_terrain_geometry_displacement_immunity_unit_target_cancel_post_basic_attack_explosive_charge_other_ranks_or_full_fidelity`

Ordered tags：`ability_cost_cooldown` → `active_magic_damage` → `bonus_ad_ratio` → `ap_ratio` → `immediate_impact_scaffold`。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_tristana` / `ad`+`ap` 定义与实体值 / `mana` 资源定义与实体资源值做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`）；幂等投影 reserved → `types`；向 `hero_tristana` **仅** mount 独立 `provider_hero_tristana_r_buster_shot_primary_hit`（standalone；不创建/突变 P/Q/W/E/basic/Explosive Charge），含 active `ability_hero_tristana_r_buster_shot_primary_hit`（`ability_key=buster_shot_primary_hit`）、`ability_costs` 100 mana、`ability_cooldowns` 100000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 magic damage `325 + 0.70*(ad.resolved-ad.base) + 1.00*ap.resolved`（**bonus AD** + AP；嵌套二元 `add(add(const 325, mul(const 0.70, sub(read …resolved, read …base))), mul(const 1.00, read …ap.resolved))`；每条 read path 恰好一次；`copyable_on_hit=false`，非 crit；运行时类型 `20221` + add policy `20170`；禁止可执行图/`required reserved` 使用 `20230=provider_action/apply`）；**零** provider state / modifiers / listeners / matchers / explicit events / repeats / control / channel / projectile / geometry / knockback / stun / reveal / secondary 行。成功 cast 由 runtime 自动发出 `ability_started`（本 R 图不添加 listener / event step）。Immediate selected-primary-champion magic hit 为 Phase-A scaffold，不是实际 cast time/knockback/stun/reveal/secondary/terrain/full-R fidelity。Wiki：request `Template:Data Tristana/R` → resolved `Template:Data Tristana/Buster Shot`；page1308525 / rev4008205 / `2026-04-14T05:37:16Z` / canonical 2385 bytes / SHA256 `2dff322949f442acc00a7074458fd5ed9bc542d6fd143b818a9a7151e117c058`；sidecar `normalized/generic/tristana-r.json` + pages sibling（Wasm repo authoritative）。**local raw materialization caveat**：仓库 local raw 2382 / `42e07f07f3188aada86d18d782c05d291f031dbbf92171e4a1120e828ebf8c7b`；同 size 不等于等价；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾（仅 materialization/serialization caveat）。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

确定性夹具（注释记录；不连 live / 不执行 runtime）：`baseAD0/resolvedAD0/AP0/MR0` raw/final325；`baseAD60/resolvedAD60/AP0/MR0` raw/final325；`baseAD60/resolvedAD160/AP0/MR0` raw/final395；`baseAD60/resolvedAD160/AP100/MR0` raw/final495；`baseAD60/resolvedAD160/AP100/MR100` raw495/final247.5；`baseAD60/resolvedAD260/AP200/MR100` raw665/final332.5；`baseAD0/resolvedAD100/AP100` vs `baseAD60/resolvedAD160/AP100` at MR0 both495（bonus-AD proof）；mana300/base60/resolved160/AP100/HP1000/MR100 在 t0/t99999/t100000 → 两次成功 + 一次 cooldown skip、exactly two R damage items、两次自动 R `ability_started`、final mana100/HP505；mana99 → resource skip、不变、无 R damage/event；standalone provider 不合成 P/Q/W/E/basic/Explosive Charge。

**排除**（completed-boundary exclusions；不得实现或描述为近似）：cast time；knockback/airborne/stun/reveal；displacement direction/distance/speed/terrain/immunity；secondary/surrounding targets and zero default damage/turret aggro；unit-target cancel conditions；post-cast basic attack；Explosive Charge；ranks1–2；P/Q/W/E/basic/siblings/loadout/crit/on-hit；identity/panel/resource bootstrap；listener/state/event/modifier/repeat/control/channel/projectile/geometry/knockback/stun/reveal/secondary/sibling；live migration；publish；E2E/live/full fidelity。One selected-target magic hit, not full R。

静态契约校验（不连 live DB；含邻近 Caitlyn R / Lucian W / Twisted Fate Q / Caitlyn E check-only，以及 Ezreal E 嵌套 bonusAD+AP 先例）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericTristanaBusterShotPrimaryHitSeedSqlTest,LolGenericCaitlynAceInTheHoleSingleBulletQuantumSeedSqlTest,LolGenericLucianArdentBlazePrimaryHitSeedSqlTest,LolGenericTwistedFateWildCardsPrimaryHitSeedSqlTest,LolGenericCaitlyn90CaliberNetPrimaryHitSeedSqlTest,LolGenericEzrealArcaneShiftPrimaryHitSeedSqlTest test
```

### LoL generic Samira Flair max-distance primary-hit seed（莎弥拉 Q / Phase-A v1 最大距离远程射击选定主目标单次物理命中）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_samira)`、`attribute_definitions(ad)`、`entity_attribute_values(hero_samira,ad)`、`resource_definitions(mana)`、`entity_resource_values(hero_samira,mana)` 已存在后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**物化身份/面板/资源值——当前仓库亦无 materializer / 无 seed 负责物化 Samira 身份/面板/资源行；本 seed 不物化；仅挂载可 cast 的独立 Q active **最大距离远程射击选定主目标单次物理命中**；standalone sibling absence：不创建/突变/合成/复制 P/W/E/R/basic；Backend prerequisite checks 为 publication guard，generic runtime 缺失 attr 读为 0 且不断言 fail-closed；不做 live migration、不自动 publish、不连 live DB 执行本 seed；**本 seed 非自包含**）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20220`/`20260`；不含 `20230`）
2. `db/game_manage/seeds/lol_generic_samira_flair_max_distance_primary_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish；本任务亦不执行该可选 publish 步骤）

建议发布版本：`lol-generic-samira-flair-max-distance-primary-hit-phase-a-v1-20260726`（seed 不负责 publish）。候选 `hero_skill|hero_samira|Q|交火`（task `wasm-generic-samira-flair-max-distance-primary-hit`）冻结为 **Phase-A rank-5 立即最大距离远程射击选定主目标单次物理命中 impact scaffold**（`FROZEN_PLAN_REV=samira-q-flair-max-distance-primary-hit-phase-a-v1`）：

`rank5_max_distance_ranged_shot_selected_primary_physical_hit; immediate_impact_scaffold; physical_20_plus_1_10_total_ad; mana30_cooldown2000ms; exactly_one_immediate_damage_quantum; no_distance_range_direction_projectile_collision_melee_slash_wild_rush_e_explosives_crit_expected_crit_rng_150_percent_lifesteal_style_multitarget_other_ranks_or_full_fidelity`

Ordered tags：`ability_cost_cooldown` → `active_physical_damage` → `immediate_impact_scaffold`（显式不包含 `total_ad_ratio`；仓库治理禁止该 governed tag）。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_samira` / `ad` 定义与实体值 / `mana` 资源定义与实体资源值做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`）；幂等投影 reserved → `types`；向 `hero_samira` **仅** mount 独立 `provider_hero_samira_q_flair_max_distance_primary_hit`（stable id `hero_samira_q_flair_max_distance_primary_hit`；standalone；不创建/突变/合成/复制 P/W/E/R/basic），含 active `ability_hero_samira_q_flair_max_distance_primary_hit`（`ability_key=flair_max_distance_primary_hit`）、`ability_costs` 30 mana、`ability_cooldowns` 2000ms、恰好一个 null-duration impact phase + on_enter sequence，以及一次 physical damage `20 + 1.10*source.attr.ad.resolved`（**total AD**，直接读 `ad.resolved`，不减 `ad.base`、不称 bonus AD；二元 `add(const 20, mul(const 1.10, read …))`；每条 read path 恰好一次；`copyable_on_hit=false`，非 crit / `crit_eligible=false`；运行时类型 `20220` + add policy `20170`；禁止可执行图/`required reserved` 使用 `20230=provider_action/apply`）。Maximum-distance **仅**选择远程射击分支；公式本身**无**距离乘数。**零** provider state / modifiers / listeners / matchers / explicit events / repeats / control / projectile / geometry / melee / Wild Rush / style 行。**Q 无 ability-specific game-local type**，不新增 Q 专用 62xxx type、不写 `type_relations`。成功 cast 由 runtime 自动发出 `ability_started`（本 Q 图不添加 listener / event step）。Immediate max-distance ranged-shot selected-primary physical hit 为 Phase-A scaffold，不是实际 distance / range / direction / projectile / collision / melee slash / Wild Rush/E explosives / crit / expected crit / RNG / 150% / lifesteal / style / multitarget / full-Q fidelity。Exactly one immediate damage quantum only, not full Q。Wiki：request `Template:Data Samira/Q` → resolved `Template:Data Samira/Flair`；page1459315 / rev4008027 / `2026-04-13T03:58:01Z` / canonical 3596 bytes / SHA256 `7f65786ccae8186903166195be9151294adef3539fe97f067de4273e162cd203`；sidecar `normalized/generic/samira-q.json`（bytes 3596 / SHA256 `9077cd57cd3f2713d4725a2b3264b987163feb57d97c892669bc35bbde8ecc0d`）+ `pages/samira-q.json`（bytes 666 / SHA256 `c572e9baffa2c4ec196fe5a410c3ca89ddfc717e63be43be6428626ef7e93976`；Wasm repo authoritative）。**local raw materialization caveat**：仓库 local raw 3596 / `fe7ba68ec41b06ea2592a9f0b751d5970b0d42914886c926b3d90509efca5f8d`；同 size 不等于等价；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾（仅 materialization/serialization caveat）。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

确定性夹具（注释记录；不连 live / 不执行 runtime）：`totalAD0` raw20 / armor0=20 / armor100=10；`totalAD100` raw130 / armor100=65；`totalAD110` raw141 / armor100=70.5；total-AD counterproof `base0/resolved100` vs `base60/resolved100` both130；mana90/HP1000/totalAD100/armor100 在 t0/t1999/t2000 → success/cooldown skip/success、exactly two Q hits and automatic starts、readyAt2000、final mana30/HP870；mana29 → resource skip；standalone isolation mounts only this Q and synthesizes no P/W/E/R/basic。

**排除**（completed-boundary exclusions；不得实现或描述为近似）：distance/range/direction/projectile/collision；melee slash/cone blade；Wild Rush/E explosives；crit/expected crit/RNG/150% critical damage；lifesteal；style/Daredevil Impulse；multi-target；ranks1–4；P/W/E/R/basic/loadout/on-hit；identity/panel/resource bootstrap；listener/state/event/modifier/repeat/control/projectile/geometry/sibling；live migration；publish；E2E/live/full fidelity。One selected-primary max-distance ranged-shot hit, not full Q。公式无距离乘数。

静态契约校验（不连 live DB；含邻近 total-AD Jinx W / Kalista Q check-only 先例）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericSamiraFlairMaxDistancePrimaryHitSeedSqlTest,LolGenericJinxZapPrimaryHitSeedSqlTest,LolGenericKalistaPiercePrimaryHitSeedSqlTest,LolGenericSivirBoomerangBladeFirstOutboundHitSeedSqlTest test
```

### LoL generic Varus Piercing Arrow max-charge primary-first-hit seed（韦鲁斯 Q / Phase-A v1 最大蓄力第一敌人选定主目标物理命中）

在 reserved types 已就绪，且 **外部既有** `game_entities(hero_varus)`、`attribute_definitions(ad)`、`entity_attribute_values(hero_varus,ad)`、`resource_definitions(mana)`、`entity_resource_values(hero_varus,mana)` 已存在后，按顺序执行（**check-only / external existing-data**；**不做** hero/panel/mana 自包含写入，**不**物化身份/面板/资源值；Mana ERV **可能已由**既有 Varus E Hail of Arrows / R Chain of Corruption seed 物化，本 seed 仅 check-only、**不断言**无 repository materializer；`ad.base`/`ad.resolved` 是单一 `attribute_definitions(ad)` + `entity_attribute_values(hero_varus,ad)` 上的 **generic runtime 路径**，不是独立 attr_key；仅挂载可 cast 的独立 Q active；与既有 basic / W Blighted Quiver（含 `blighted_quiver_q_max_charge_carrier`）/ E / R **并存且不突变、不依赖、不 enrich**；不做 live migration、不自动 publish、不连 live DB 执行本 seed；**本 seed 非自包含**）：

1. `db/game_manage/seeds/reserved_types_seed.sql`（需含 `20111`/`20120`/`20130`/`20142`/`20150`/`20170`/`20220`/`20260`；不含 `20230`）
2. `db/game_manage/seeds/lol_generic_varus_piercing_arrow_max_charge_primary_first_hit_seed.sql`
3. 校验通过后再显式 Admin `POST /api/admin/games/lol/versions:publish`（本脚本**不会**自动 publish；本任务亦不执行该可选 publish 步骤）

建议发布版本：`lol-generic-varus-piercing-arrow-max-charge-primary-first-hit-phase-a-v1-20260726`（seed 不负责 publish）。候选 `hero_skill|hero_varus|Q|穿刺之箭`（task `wasm-generic-varus-piercing-arrow-max-charge-primary-first-hit`）冻结为 **Phase-A rank-5 立即最大蓄力/最大射程第一敌人选定主目标物理命中 impact scaffold**（`FROZEN_PLAN_REV=varus-q-piercing-arrow-max-charge-primary-first-hit-phase-a-v1`）：

`rank5_max_charge_max_range_selected_primary_first_enemy_physical_hit; immediate_impact_scaffold; physical_360_plus_1_20_bonus_ad; mana70_listed_cooldown12000ms_scaffold; no_real_charge_channel_post_effect_cooldown_start_charge_duration_cooldown_reduction_pierce_falloff_projectile_geometry_blight_or_full_fidelity`

Ordered tags：`ability_cost_cooldown` → `active_physical_damage` → `bonus_ad_ratio` → `immediate_impact_scaffold`。

该 seed 会：锁定 `game_data_state`；对 game / reserved / `hero_varus` / `ad` 定义与实体值 / `mana` 资源定义与实体资源值做 **fail-closed check-only EXISTS**（缺失即回滚；不写 `attribute_definitions` / `resource_definitions` / `game_entities` / `entity_attribute_values` / `entity_resource_values`）；幂等投影 reserved → `types`；向 `hero_varus` **仅** mount 独立 `provider_hero_varus_q_piercing_arrow_max_charge_primary_first_hit`（stable id `hero_varus_q_piercing_arrow_max_charge_primary_first_hit`；standalone；不创建/突变 basic/W/E/R，不触碰 `provider_hero_varus_w_blighted_quiver_phase_a` / `blighted_quiver_q_max_charge_carrier`），含 active `ability_hero_varus_q_piercing_arrow_max_charge_primary_first_hit`（`ability_key=piercing_arrow_max_charge_primary_first_hit`）、`ability_costs` 70 mana、`ability_cooldowns` 12000ms listed scaffold、恰好一个 null-duration impact phase + on_enter sequence，以及一次 physical damage `360 + 1.20*(ad.resolved-ad.base)`（**bonus AD**，二元 `add(const 360, mul(const 1.20, sub(read …resolved, read …base)))`；每条 AD path 恰好一次；无 AP/crit reads；`copyable_on_hit=false`，非 crit / `crit_eligible=false`；运行时类型 `20220` + add policy `20170`；禁止可执行图/`required reserved` 使用 `20230=provider_action/apply`）；**零** provider state / modifiers / listeners / matchers / explicit events / repeats / tick / control / scheduler 行。成功 cast 由 runtime 自动发出 `ability_started`（本 Q 图不添加 listener / event step）。Wiki：request `Template:Data Varus/Q` → resolved `Template:Data Varus/Piercing Arrow`；page1309981 / rev4026469 / `2026-06-09T22:00:25Z` / canonical 3888 bytes / SHA256 `bdbbe064008b969e153800f7d5cdb305f84eca1ef043d8e6f8ce41c5db2659dd`；sidecar `normalized/generic/varus-q.json`（bytes 4131 / SHA256 `bb5af7baaf053d1266a3702664c2df09e89f67c6125e8cf6da15f28f5b0c1f8e`）。**local raw materialization caveat**：仓库 local raw 3888 / `5a350cecb53d37bd2640f7de3398c1be0a798a75f88c42eb327933920d487962`；同 size 不等于等价；canonical 以 sidecar/pages 为准，不断言等价、亦不主张源矛盾。有 material change 时才推进候选 revision；不 DELETE、不 DDL、不自动 publish。

确定性夹具（注释记录；不连 live / 不执行 runtime）：`base60/resolved60/armor0` raw/final360，armor100 final180；`base60/resolved160/armor0` raw/final480，armor100 final240；`base60/resolved260/armor100` raw600/final300；bonus-AD proof `base0/resolved100` vs `base60/resolved160` at armor0 both480；mana210/base60/resolved160/HP1000/armor100 在 t0/t11999/t12000 → 两次成功 + 一次 cooldown skip、两笔 Q damage、两次自动 Q `ability_started`、final mana70/HP520；mana69 → resource skip、不变、无 Q damage/event；standalone provider 不合成 basic/W/E/R，不突变 W carrier。

**排除**：real charge/channel timing；cooldown reduction by charge duration；cancel/refund/recast；movement slow/cast restrictions；projectile/travel/direction/collision/range geometry；pierce falloff/enemy count/multi-target；W active/passive/Blight/missing-health/detonation/reset/cooldown refund；cosmetic or actual crit；other ranks/siblings/items/loadout/full fidelity；identity/panel/resource bootstrap；listener/state/event/modifier/repeat/tick/control/scheduler；live migration；publish；E2E/full fidelity。

静态契约校验（不连 live DB；含邻近 Varus W/E/R sibling coexistence）：

```bash
cd server/data_manage
mvn -Dtest=LolGenericVarusPiercingArrowMaxChargePrimaryFirstHitSeedSqlTest,LolGenericVarusBlightedQuiverSeedSqlTest,LolGenericVarusHailOfArrowsPrimaryHitSeedSqlTest,LolGenericVarusChainOfCorruptionPrimaryHitSeedSqlTest test
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
