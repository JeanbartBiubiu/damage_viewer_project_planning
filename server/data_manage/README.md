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
