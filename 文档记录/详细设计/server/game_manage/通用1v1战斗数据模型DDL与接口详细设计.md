TASK_KEY: server-generic-combat-data-model
DOC_TYPE: 详细设计
WORKSTREAM: server/game-manage
STATUS: done
EXECUTION_MODEL: cursor-grok-4.5-plus-codex-review
LAST_TRACKED_AT: 2026-07-12

# 通用 1v1 战斗数据模型 DDL 与接口详细设计

系统边界和已确认决策见 [通用 1v1 战斗数据模型替换方案](../../../概要设计/server/通用1v1战斗数据模型替换方案.md)。本文是通用 1v1 `combat-data` 的 DDL 与接口实现契约真源；后端与基线 DDL 已落地。当前后端接口索引见 [接口定义](./接口定义.md)；验证证据见 [通用1v1战斗数据模型验证记录-2026-07-12](../../../测试记录/server/game_manage/通用1v1战斗数据模型验证记录-2026-07-12.md)。

## 1. 实施范围

本任务已写入并收口的范围：

1. `db/game_manage/schema.sql`
2. `db/game_manage/triggers.sql`
3. `db/game_manage/migrations/compatibility/**`
4. `db/game_manage/seeds/reserved_types_seed.sql`
5. `server/data_manage/**`
6. `文档记录/概要设计/server/**`
7. `文档记录/详细设计/server/game_manage/**`
8. `db/task_doc_governance/task_rules.json`

只读参考：Web、Wasm、Wiki 转换工具和历史测试数据。不得修改 Wasm ABI 或前端代码。

## 2. 统一 DDL 约定

### 2.1 最新主表

除全局/非版本配置外，每张游戏业务主表必须包含：

```sql
game_id varchar(64) NOT NULL,
change_revision bigint NOT NULL CHECK (change_revision > 0),
updated_at timestamp NOT NULL DEFAULT NOW()
```

主表 PK 使用 `game_id + 稳定自然键`。主表不再包含 `start_version_id/end_version_id`。

### 2.2 `_log` 表

每张需要发布审计的业务表都有同名 `_log`：

```sql
game_id varchar(64) NOT NULL,
version_id bigint NOT NULL,
change_revision bigint NOT NULL,
-- 其余字段为主表业务字段快照
PRIMARY KEY (<主表自然键>, version_id),
FOREIGN KEY (game_id, version_id)
  REFERENCES public.game_versions(game_id, version_id)
```

log 不保存 `updated_at`，不使用 start/end 区间，不反向 FK 当前子表，避免删除旧表或结构迁移时形成历史依赖环。

### 2.3 分区

§5 的全部战斗主表和 `_log`、改造后的 attribute/type/type-relation 表以及现有 images 继续 `PARTITION BY LIST (game_id)`。`ensure_game_partitions` 必须改为表清单驱动或统一循环生成，禁止继续手写数十个重复 BEGIN/EXCEPTION 块。

不分区：games、game_versions、game_data_state、game_progression_schema 及其 log、reserved_type、reserved_type_relation。

### 2.4 删除与可见性

1. 不提供 DELETE API。
2. 新表不增加 `deleted` tombstone。
3. PUT 成功后立即被 Public GET 读取。
4. 不提供 batch、draft、snapshot、双写或发布隔离。
5. 一个 PUT 内涉及的公共行和 detail 行必须同事务写入。

### 2.5 校验边界

后端只保证 JSON 可解析、必填字段存在、基础类型正确和数据库约束可满足。不校验：

- reserved type 是否属于某个语义分组
- formula AST 合法性
- operation 是否被当前 Wasm 支持
- provider/ability/effect 引用能否形成可运行闭包
- 数值、stage 和 1v1 业务语义

上述内容由 Web 校验。数据库仍保留 NOT NULL、唯一约束、FK、顺序非负和一对一 detail 等结构约束。

## 3. Revision 与发布 DDL

### 3.1 `game_data_state`

```sql
CREATE TABLE public.game_data_state (
    game_id varchar(64) PRIMARY KEY REFERENCES public.games(game_id),
    current_revision bigint NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
    published_revision bigint NOT NULL DEFAULT 0 CHECK (published_revision >= 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CHECK (published_revision <= current_revision)
);
```

已有 game 全量 backfill；以后创建 game 时同事务初始化该行。

### 3.2 `game_versions`

保留版本元数据和 current 指针，删除 `data_hash`，新增：

```sql
change_revision bigint NOT NULL DEFAULT 0
```

非 workspace 发布版本记录本次冻结的 revision。`version_code='__workspace__'` 不再作为新表 FK 或编辑态标记。

### 3.3 Admin 写 revision

每次 PUT 事务先执行：

```sql
UPDATE public.game_data_state
SET current_revision = current_revision + 1,
    updated_at = NOW()
WHERE game_id = #{gameId}
RETURNING current_revision;
```

本次 PUT 写入的所有主表行共享返回 revision。无 batch 表示每个 HTTP PUT 独立 revision，而不是一个 PUT 内的每条 SQL 独立 revision。

### 3.4 发布算法

`publishVersion` 新顺序：

1. `SELECT game_data_state ... FOR UPDATE`，冻结 `publishRevision=current_revision`。
2. 创建 `game_versions(version_code, release_date, change_revision=publishRevision)`。
3. 取上一个 current version 的 `change_revision`，无则为 0。
4. 每个业务 Mapper 查询 `previousRevision < change_revision AND change_revision <= publishRevision`。
5. 将命中行 upsert 到对应 `_log`，写本次 `version_id`。
6. 不更新主表版本范围，不构建/校验 Bundle，不物化 Catalog，不计算 hash。
7. 更新 `published_revision=publishRevision`，切换 current version。

同 game 的 PUT 和 publish 通过锁定 `game_data_state` 串行化。

## 4. 保留并改造的表

| 表 | 变更 |
| --- | --- |
| `games` | 保留；创建时初始化 `game_data_state`。 |
| `game_versions` | 删除 `data_hash`；新增 `change_revision`。 |
| `game_progression_schema` | 新增 `change_revision`、保留 `updated_at` 并新增 `_log`，因为 stage 定义影响战斗数值。 |
| `images` | 保留原状，不参与 revision/log。 |
| `attribute_definitions/_log` | 删除 start/end，改 change_revision/version_id log；`attr_type/value_kind` 后续使用 reserved type ID 表达。 |
| `reserved_type/reserved_type_relation` | 保留；增加稳定 `type_key`。不参与 revision/log。 |
| `types/_log` | 增加 `type_key`，改 revision/log 模型；保留 `reserved_type_id`。 |
| `type_relations/_log` | 改 revision/log 模型，删除 `deleted`；扩展 target category。 |

### 4.1 Type 结构调整

`reserved_type` 增加：

```sql
type_key varchar(128) NOT NULL UNIQUE
```

`types` 增加：

```sql
type_key varchar(128) NOT NULL,
UNIQUE (game_id, type_key)
```

`type_relations.target_category` 新集合：

```text
entity
attribute
resource
provider
ability
ability_phase
modifier
listener
effect_step
type
```

旧 `equipment` / `character` / `skill` 等 target category 值已退出；当前集合见上。`type_relations.type_id` 可引用 reserved 或 game-local type；由于 PostgreSQL 无法对两张表建立 polymorphic FK，不再使用只指向 `types` 的 FK，由有效 type 视图和 Web 校验负责解析。

### 4.2 首批 reserved type 分组

至少覆盖：

- value_type: number/boolean/string/timestamp/entity_ref
- selector: self/opponent/source/target
- provider_kind: passive/status/equipment/rune/augment
- ability_kind: active/passive/tick
- ability_phase: cast/channel/impact/tick/recovery
- operation: damage/heal/resource_change/attribute_change/shield/apply_provider/refresh_provider/expire_provider/emit_event/cooldown_change/state_change
- modifier_mode/value_policy: add/multiply/override/percent_add/min/max
- match_mode: any/all/none
- refresh_policy
- event、damage、action/control 等当前 Wasm/Web 已使用的稳定词表

具体 ID 延续 reserved type ID 区间；跨模块以 `type_key` 为语义真源，数字 ID 只作为数据库引用。

## 5. 新表目录

以下所有业务表均按 §2 配置 `_log`，除非明确注明。

### 5.1 Entity、Attribute、Resource

| 表 | PK | 主要字段与 FK |
| --- | --- | --- |
| `game_entities` | `(game_id, entity_id)` | `display_name`, `description`; 只保存战斗相关身份。 |
| `entity_attribute_values` | `(game_id, entity_id, attr_key)` | FK entity、attribute definition；`base_value numeric`。 |
| `entity_attribute_stage_values` | `(game_id, entity_id, attr_key, stage)` | FK entity attribute；`value numeric`，表示该 stage 绝对值。 |
| `resource_definitions` | `(game_id, resource_key)` | `display_name`, `default_initial_value`, `default_max_value`。 |
| `entity_resource_values` | `(game_id, entity_id, resource_key)` | `initial_value`, `max_value`; FK entity、resource definition。 |
| `entity_resource_stage_values` | `(game_id, entity_id, resource_key, stage)` | `initial_value`, `max_value`; stage 绝对值。 |

实体类型、标签不放数组列，统一通过 `type_relations(target_category='entity')`。

### 5.2 Provider

| 表 | PK | 主要字段与 FK |
| --- | --- | --- |
| `provider_definitions` | `(game_id, provider_id)` | `provider_kind_type_id` FK reserved type，`display_name`。每个真实被动/状态/装备效果一条；Web 使用 `provider_id` 生成 providerKey/stableId。 |
| `provider_lifecycles` | `(game_id, provider_id)` | `duration_formula_key`, `max_stacks`, `refresh_policy_type_id`, `tick_interval_ms`, `start_delay_ms`; FK provider/formula/reserved type。 |
| `entity_provider_mounts` | `(game_id, entity_id, provider_id)` | FK entity/provider；无参数覆盖。 |
| `provider_state_fields` | `(game_id, provider_id, state_key)` | `value_type_id`, default number/boolean/string；只允许标量 schema。 |
| `provider_formulas` | `(game_id, provider_id, formula_key)` | `expression jsonb NOT NULL`; provider 内共享，禁止跨 provider FK。 |

`provider_lifecycles.duration_formula_key` 与 `provider_formulas` 形成同 provider 复合 FK。建表顺序采用 provider → formula → lifecycle，避免循环。

### 5.3 Ability

| 表 | PK | 主要字段与 FK |
| --- | --- | --- |
| `ability_definitions` | `(game_id, ability_id)` | `provider_id`, `ability_key`, `ability_kind_type_id`, `display_name`; UNIQUE `(game_id, provider_id, ability_key)`。 |
| `ability_parameters` | `(game_id, ability_id, param_key)` | `numeric_value`; 当前 Wasm params 为 numeric map。 |
| `ability_state_fields` | `(game_id, ability_id, state_key)` | 与 provider state 同构。 |
| `ability_phases` | `(game_id, phase_id)` | `ability_id`, `phase_order`, `phase_type_id`, `duration_formula_key`, `interruptible`; UNIQUE `(game_id, ability_id, phase_order)`。 |
| `ability_costs` | `(game_id, cost_id)` | `ability_id`, `phase_id`, `resource_key`, `amount_formula_key`, `allow_partial`。 |
| `ability_cooldowns` | `(game_id, cooldown_id)` | `ability_id`, `duration_formula_key`, `starts_on_phase_id`, `group_key`。 |

formula key 均通过 ability 所属 provider 解析。Web 将 phase 展平为当前 Wasm ability operations/tickSpec；后端不保存 source/target clone 结果。

### 5.4 Modifier 与 Listener

| 表 | PK | 主要字段与 FK |
| --- | --- | --- |
| `provider_modifiers` | `(game_id, modifier_id)` | `provider_id`, `modifier_key`, `modifier_type_id`, `target_selector_type_id`, `target_attr_key`, `command_type_id`, `channel_type_id`, `bucket_type_id`, `stage_type_id`, `priority`, `value_policy_type_id`, `value_formula_key`, `condition_formula_key`。 |
| `provider_listeners` | `(game_id, listener_id)` | `provider_id`, `listener_key`, `event_type_id`, `ability_id`, `max_triggers_per_event`, `chain_limit_key`。 |
| `listener_match_types` | `(game_id, listener_id, match_mode_type_id, type_id)` | any/all/none 由 reserved match mode 表达；type_id 解析 reserved/game-local type。 |

modifier 的叠加规则由每条 modifier 自己声明，不从 attribute definition 推导。

### 5.5 Effect Sequence 与 Owner 关联

| 表 | PK | 主要字段与 FK |
| --- | --- | --- |
| `effect_sequences` | `(game_id, sequence_id)` | `provider_id`, `sequence_key`, `display_name`; UNIQUE `(game_id, provider_id, sequence_key)`。 |
| `effect_steps` | `(game_id, step_id)` | `sequence_id`, `step_order`, `operation_type_id`, `target_selector_type_id`, `condition_formula_key`; UNIQUE `(game_id, sequence_id, step_order)`。 |
| `ability_phase_effect_sequences` | `(game_id, phase_id, trigger_type_id, sequence_id)` | 明确 FK phase + sequence。 |
| `listener_effect_sequences` | `(game_id, listener_id, sequence_id)` | 明确 FK listener + sequence。 |
| `provider_tick_sequences` | `(game_id, provider_id, sequence_id)` | provider lifecycle tick 的 effect；Web 为当前 Wasm 物化为 provider-owned tick ability。 |

sequence 与 owner 必须属于同一个 provider。通过复合 FK 或写 SQL 的结构检查保证；不做机制语义校验。

### 5.6 Effect Detail

每个 `effect_steps` 必须恰好存在一条 detail。一个 effect-step PUT 同事务写公共行和对应 detail；operation family 改变时服务内部删除旧 detail 后写新 detail，但不暴露 DELETE API。

| detail 表 | PK/FK | 固定字段 |
| --- | --- | --- |
| `damage_effect_details` | `(game_id, step_id)` → effect step | `amount_formula_key`, `damage_type_id`, `value_policy_type_id` |
| `heal_effect_details` | 同上 | `amount_formula_key`, `value_policy_type_id` |
| `resource_effect_details` | 同上 | `resource_key`, `amount_formula_key`, `value_policy_type_id` |
| `attribute_effect_details` | 同上 | `attr_key`, `amount_formula_key`, `value_policy_type_id` |
| `shield_effect_details` | 同上 | `shield_ref`, `amount_formula_key`, `duration_formula_key`, `value_policy_type_id` |
| `provider_effect_details` | 同上 | `action_type_id`, `target_provider_id`, `stacks_formula_key`, `duration_formula_key` |
| `event_effect_details` | 同上 | `event_type_id`, `event_ref`, `payload jsonb` |
| `ability_control_effect_details` | 同上 | `action_type_id`, `target_ability_id`, `amount_formula_key`, `value_policy_type_id` |
| `state_effect_details` | 同上 | `state_scope_type_id`, `state_key`, `amount_formula_key`, `value_policy_type_id` |

使用 deferred constraint trigger 或等价数据库结构检查，保证 effect step 在事务提交时只有一种 detail。事件 payload 是开放扩展 JSON；当前 Wasm 未消费的字段由 Web 暂停导出。

## 6. `_log` 覆盖范围

需要 log：

1. game progression schema
2. attribute definitions
3. types、type relations
4. §5 全部主表、关联表和 detail 表

不需要 log：games、game_data_state、game_versions、images、reserved type、reserved type relation。

log 只记录发布时的最新行状态，不记录每一次 PUT。无 DELETE 意味着首版 log 不包含 tombstone。

## 7. Public API

Public API 直接读取最新主表。统一响应 envelope：

```json
{
  "gameId": "lol",
  "currentRevision": 42,
  "data": []
}
```

单条 GET 的 `data` 为 object，列表 GET 为 array。首版不做 `afterRevision` delta API；IndexedDB revision 变化时全量刷新所需资源。

### 7.1 状态与基础定义

```text
GET /api/games/{gameId}/combat-data/state
GET /api/games/{gameId}/combat-data/progression-schema
GET /api/games/{gameId}/combat-data/attribute-definitions
GET /api/games/{gameId}/combat-data/resource-definitions
GET /api/games/{gameId}/combat-data/types
GET /api/games/{gameId}/combat-data/type-relations
```

### 7.2 Entity

```text
GET /api/games/{gameId}/combat-data/entities
GET /api/games/{gameId}/combat-data/entities/{entityId}
GET /api/games/{gameId}/combat-data/entity-attributes
GET /api/games/{gameId}/combat-data/entity-attribute-stages
GET /api/games/{gameId}/combat-data/entity-resources
GET /api/games/{gameId}/combat-data/entity-resource-stages
GET /api/games/{gameId}/combat-data/entity-provider-mounts
```

列表接口支持明确 FK filter，例如 `?entityId=`、`?providerId=`，不提供通用 SQL filter DSL。

### 7.3 Provider/Ability/Effect

```text
GET /api/games/{gameId}/combat-data/providers
GET /api/games/{gameId}/combat-data/provider-lifecycles
GET /api/games/{gameId}/combat-data/provider-state-fields
GET /api/games/{gameId}/combat-data/provider-formulas
GET /api/games/{gameId}/combat-data/provider-modifiers
GET /api/games/{gameId}/combat-data/provider-listeners
GET /api/games/{gameId}/combat-data/listener-match-types

GET /api/games/{gameId}/combat-data/abilities
GET /api/games/{gameId}/combat-data/ability-parameters
GET /api/games/{gameId}/combat-data/ability-state-fields
GET /api/games/{gameId}/combat-data/ability-phases
GET /api/games/{gameId}/combat-data/ability-costs
GET /api/games/{gameId}/combat-data/ability-cooldowns

GET /api/games/{gameId}/combat-data/effect-sequences
GET /api/games/{gameId}/combat-data/effect-steps
GET /api/games/{gameId}/combat-data/ability-phase-effect-sequences
GET /api/games/{gameId}/combat-data/listener-effect-sequences
GET /api/games/{gameId}/combat-data/provider-tick-sequences
```

`GET effect-steps` 返回公共 step 和对应 detail 的联合 DTO；不要求前端分别请求九张 detail 表。

## 8. Admin API

Admin 路径与 Public 资源名对应：

```text
PUT /api/admin/games/{gameId}/combat-data/<resource>/<stableId>
```

复合自然键资源使用清晰路径，例如：

```text
PUT /api/admin/games/{gameId}/combat-data/entities/{entityId}/attributes/{attrKey}
PUT /api/admin/games/{gameId}/combat-data/entities/{entityId}/attributes/{attrKey}/stages/{stage}
PUT /api/admin/games/{gameId}/combat-data/entities/{entityId}/resources/{resourceKey}
PUT /api/admin/games/{gameId}/combat-data/providers/{providerId}/formulas/{formulaKey}
PUT /api/admin/games/{gameId}/combat-data/providers/{providerId}/state-fields/{stateKey}
PUT /api/admin/games/{gameId}/combat-data/abilities/{abilityId}/parameters/{paramKey}
PUT /api/admin/games/{gameId}/combat-data/effect-steps/{stepId}
```

规则：

1. 不提供 DELETE。
2. 不提供 batch。
3. 每个 PUT 独立事务和 revision。
4. effect-step PUT body 包含公共字段和一种 detail，公共/detail 原子更新。
5. 请求不得提交 `changeRevision/currentRevision/versionId/versionCode`。
6. 成功响应返回写入对象和新的 `currentRevision`。
7. 继续写 Admin edit log。

## 9. 旧接口删除与替换

已删除（请求返回 404）：

```text
GET /api/games/{gameId}/versions/{versionCode}/bundle
GET /api/games/{gameId}/versions/{versionCode}/wasm-catalog

GET/PUT /api/admin/games/{gameId}/wasm-catalog-source
POST /api/admin/games/{gameId}/wasm-catalog-source:bootstrap-legacy-adc
```

旧 hero/item/skill/skill-mount/formula/coefficient/status/control Admin Controller 与 owner-categories Public API 已移除；能力由 `/combat-data/**` 资源替代。

保留：

```text
GET /api/games
GET /api/games/{gameId}/versions/current
POST /api/admin/games/{gameId}/versions:publish
GET/PUT images
```

publish 响应包含 `gameId` / `versionCode` / `releaseDate` / `changeRevision` / `publishedAt` / `updatedAt`。

## 10. Java 模块边界

禁止把全部战斗表逻辑重新聚合进 `PostgresReadStore/PostgresWriteStore`。包按责任拆分：

```text
service/combatdata/revision
  GameDataRevisionService
  CombatDataPublishService

service/combatdata/entity
  EntityCombatDataService

service/combatdata/provider
  ProviderCombatDataService

service/combatdata/ability
  AbilityCombatDataService

service/combatdata/effect
  EffectCombatDataService

service/combatdata/type
  CombatTypeService
```

Controller 同样按 entity/provider/ability/effect/type 分组。每个 Service 只持有本聚合 Mapper 和 `GameDataRevisionService`，发布服务负责调用各模块的 changed-row logger。不要为每张表创建一层无差异 one-method interface；Mapper 保持 MyBatis 接口，Service 作为事务边界。

`GameDataService` 只保留 games/current version/images 等薄 Facade；旧聚合读写方法已删除。

## 11. Wasm/Web 映射约束

后端表能够覆盖当前 `CompileRequest`，但以下转换只属于 Web：

1. 从 `game_entities` 选两个实体并改名 source/target。
2. 将 entity attribute/resource 组装为完整 slot；选定 stage 的 attribute 绝对值默认写入 base/current/max/resolved，resource 写入 initial current/max，再应用用户 override。
3. clone provider/formula 并加 source/target namespace。
4. 将 ability phase 展平为 operations/tickSpec。
5. 将 provider tick sequence 合成为当前 Wasm 可接受的 tick ability。
6. 聚合 listener matcher any/all/none。
7. 把 reserved/game type ID 转为稳定 `type_key`。

provider/ability state field 在首版后端只是作者态 schema；当前 Wasm compiler 未完整消费 state schema 时，Web 不得把“已存入后端”等同于“当前 runtime 已支持”。

不进入后端：schemaHash/rulesHash、sessionId、initialSnapshot、driverPlan、stopPolicy、sampling、safetyBudget、运行态 cooldown/shield/provider instance/state/vars、compiled bundle 或公式 bytecode。

## 12. 旧表到新表迁移

### 12.1 可确定迁移

| 旧数据 | 新数据 |
| --- | --- |
| hero/item 的稳定 ID、名称 | game_entities |
| base_stats/stats_by_level | entity attribute/resource values/stages |
| types/reserved types | 改造后的 type 表 |
| item_stat_modifiers | provider + provider_modifiers |
| skill 基础信息 | provider + ability 基础信息 |

### 12.2 不自动猜测迁移

- mechanics_config
- DPS passive 配置
- 旧 status/control 专用组合
- formula binding 软引用
- timing_profile 多种旧方言

这些机制以 Wiki 原始数据重新转换，在录入新表过程中由 Web/Wasm 逐项验证。

### 12.3 最终物理删除表

```text
published_bundle_snapshots
owner_categories
formula_profiles / formula_profiles_log
formula_bindings / formula_bindings_log
heroes / heroes_log
skills / skills_log
items / items_log
item_stat_modifiers / item_stat_modifiers_log
skill_mounts / skill_mounts_log
coefficient_buckets / coefficient_buckets_log
status_action_control_rules / _log
status_definitions / _log
status_modifier_groups / _log
status_attribute_modifiers / _log
status_periodic_hp_effects / _log
control_state_profiles / _log
wasm_catalog_sources / _log
published_wasm_catalog_snapshots
```

DROP migration 不使用 CASCADE；遇到未知依赖必须停止。

## 13. 实施顺序（历史说明）

已完成的后端切换顺序：

1. 修改 reserved type/type/attribute/progression 基线，新增 game_data_state。
2. 新增 entity/resource/provider/ability/effect 主表、log、分区和 Mapper。
3. 新增 revision service、细粒度 Public/Admin GET/PUT。
4. 改造 publish 为 revision → per-table log，不再 build Bundle/Catalog。
5. 删除旧 Controller/Service/Mapper/缓存和旧表。
6. 更新 README、接口定义与任务治理文档。

Wiki 逐项录入与 Web 切换到新接口/IndexedDB revision 属于消费方后续工作，不改变本后端契约。

已有库：`generic_combat_data_model_compatibility_migration.sql` → `triggers.sql` → `generic_combat_data_model_final_drop_legacy_tables_migration.sql` → `reserved_types_seed.sql`。新库：`schema.sql` + `triggers.sql` + `reserved_types_seed.sql`。

## 14. 验证契约

实现与回归应满足：

1. fresh schema 创建全部新 parent、log、分区和约束；已有 game backfill `game_data_state`。
2. 一次 PUT 只增加一次 `current_revision`；Public GET 立即可见。
3. publish 只记录 `(previous, current]` 变化行；无变化时不新增业务 log 行。
4. 无 DELETE/batch 路由；effect-step PUT 原子写 common/detail；响应携带 `currentRevision`。
5. 旧 bundle/catalog/source 与旧专用资源路由为 404；DROP migration 无 CASCADE。

命令与 live DB 证据见测试记录，不在本文展开。

## 15. 边界守卫

后续改动若触及以下任一条，须重新评审后再改契约：

1. 需要修改 Wasm ABI 才能保存或读取后端数据。
2. 新机制只能通过重新增加 game 专用状态表表达。
3. publish 重新依赖全量 Bundle/Catalog JSON 才能写 log。
4. Service 再次把所有 Mapper 聚合进单个 god class。
5. DROP 发现未清点依赖却强行 CASCADE。
6. Web 无法从新表确定性组装现有 1v1 CompileRequest。
7. 需要删除/批量/强一致语义才能继续。
