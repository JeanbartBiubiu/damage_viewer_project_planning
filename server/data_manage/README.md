# Damage Viewer Backend

`server/data_manage` 是 Damage Viewer 的 Java / Spring Boot 后端，负责游戏元数据、图片资源，以及当前属性、角色、装备、技能、状态、效果、过程、生命周期与技能触发规则管理。

它在整条链路里的位置是：

1. 从 `db/game_manage` 定义的 PostgreSQL 结构中读取和写入当前业务表。
2. 对外提供 `GET /api/games`、图片读取，以及对内提供图片写入与当前管理接口。
3. 不再提供旧 `/combat-data/**`、旧当前版本查询或旧 `versions:publish` 发布链路。
4. 不组装 Bundle / Wasm Catalog，不为已删除的旧实体、Provider、Ability 或效果步骤保留兼容入口。

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
- 公共读取：`GamePublicController`（`GET /api/games`）、`ImagePublicController`
- Admin 写入：当前业务管理控制器，以及 `ImageAdminController`
- 游戏与图片薄 Facade：`src/main/java/xyz/game/datamanage/service/GameDataService.java`
- 读写存储：`PostgresReadStore` / `PostgresWriteStore`（图片与编辑日志）
- 启动依赖探测：`src/main/java/xyz/game/datamanage/config/StartupDependencyVerifier.java`

当前管理接口契约仍以各阶段详细设计为准。旧通用 1v1 combat-data 链路已经从现行代码中删除。

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
| `mvn test` | 运行测试与基础回归 | 开发中先跑受影响测试，功能收尾完整执行 |
| `mvn package` | 打包校验 | 改 `pom.xml`、配置或依赖时建议执行 |

### SQL 初始化与兼容迁移

**新库（fresh install）**：

1. `db/game_manage/schema.sql`（88 张保留父表，含阶段 7.5 技能触发规则表、阶段 7.6.4 `skill_effect_execute_details` / `skill_trigger_rule_link_events`、公共技能作用范围与技能急速明细、阶段 7.6.5 前序输出与事件值检查，以及 `images` 列表分区）
2. `db/game_manage/triggers.sql`（图片分区函数与当前技能效果/过程/生命周期约束）

不要把 `migrations/**` 当作新库必跑步骤。当前没有可直接用于新库的业务种子。

**已有库（仍含旧 combat-data 表）**：只在项目负责人确认准确数据库目标、待删数据量和备份方式后，手工执行：

1. `db/game_manage/migrations/breaking/drop_legacy_combat_data_chain.sql`
2. `db/game_manage/triggers.sql`（刷新图片分区函数与当前业务约束）

该破坏式脚本可重复执行，使用显式表名逆依赖 `DROP TABLE IF EXISTS`，不使用 `CASCADE`。应用启动和当前兼容迁移都不会自动执行它。本任务实现阶段只生成并静态校验该脚本，不连接真实数据库。

当前已有库如需补齐业务表，继续按各小节列出的 compatibility migration 执行；那些脚本不是新库必跑步骤。

### 属性管理

`db/game_manage/schema.sql` 直接创建 `public.attributes`。属性管理接口只读写该表，不读取或迁移旧计算表 `public.attribute_definitions`。

管理接口统一位于 `/api/admin/games/{gameId}/attributes`：GET 查询列表或详情，POST 新建，PUT 全量修改或停用；当前不提供 DELETE。请求与响应均不包含显示单位、发布 revision 或旧战斗资源字段。

### 技能分类与伤害类型管理

`public.skill_categories` 保存单层技能分类，`public.damage_types` 保存伤害类型。两者不共用旧 `types` 表，也不读取或修改战斗数据接口。

管理接口分别位于 `/api/admin/games/{gameId}/skill-categories` 和 `/api/admin/games/{gameId}/damage-types`，均提供列表、详情、新建、全量修改和删除。已有开发库执行 `db/game_manage/migrations/compatibility/skill_category_damage_type_management_compatibility_migration.sql`；脚本可重复执行且不写默认记录。

### 技能基本管理

`public.skills` 保存技能基本信息，`public.skill_category_relations` 保存技能与既有 `skill_categories` 的多对多关系。分类关系不写入数组、JSONB 或单列；本阶段不存储伤害类型、每级参数或战斗数据。

管理接口位于 `/api/admin/games/{gameId}/skills`：GET 列表或详情，POST 新建，PUT 全量修改（含启用/停用），DELETE 删除。请求与响应使用 `skillCategoryKeys: string[]`，空数组表示未分类。`skillKey` 在同一游戏内唯一且不可改；显示名称允许重复。`maxLevel` 为 >= 1 的整数，定义完整等级范围 `1..maxLevel`。

已有开发库执行 `db/game_manage/migrations/compatibility/skill_management_compatibility_migration.sql`。脚本用 `information_schema` / `pg_constraint` 预检同名表：缺失则创建，完全兼容则保持幂等，结构不兼容则报错停止；不写默认记录、不迁移旧战斗数据。不要把该 migration 当作新库必跑步骤。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=SkillManagementDbContractSqlTest,SkillServiceTest,SkillAdminControllerTest test
```

### 技能参数与公式管理

`public.skill_parameters` 保存技能参数，`public.skill_formulas` 保存公式资料，`public.skill_formula_nodes` 保存表达式节点。参数与公式均绑定同一技能；节点通过复合外键引用同技能参数与同游戏属性。参数外键不级联；删除公式时级联删除节点；删除技能前须先清公式与参数。

管理接口：

1. `/api/admin/games/{gameId}/skills/{skillKey}/parameters`：参数列表、详情、新建、全量修改、删除。
2. `/api/admin/games/{gameId}/skills/{skillKey}/formulas`：公式列表、详情（还原表达式）、新建、全量修改、删除。

参数取值方式：`FIXED`、`SKILL_LEVEL`、`CHARACTER_LEVEL`、`RUNTIME_INPUT`。公式节点类型：`OPERATION`、`PARAMETER`、`ATTRIBUTE`。本阶段不创建计算变量表，不读取或修改 `provider_formulas`，不执行公式。

已有开发库执行 `db/game_manage/migrations/compatibility/skill_parameter_formula_management_migration.sql`。脚本预检同名结构后幂等创建缺失对象；不写种子、不 `DELETE`/`DROP`/`CASCADE` 改写已有数据。不要把该 migration 当作新库必跑步骤。

静态契约与聚焦回归（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=SkillParameterFormulaManagementDbContractSqlTest,SkillParameterServiceTest,SkillFormulaServiceTest,SkillServiceTest,CharacterServiceTest,SkillParameterAdminControllerTest,SkillFormulaAdminControllerTest test
```

随后：

```bash
mvn test
```

### 状态基本管理

`public.statuses` 保存游戏下的状态基本资料：稳定标识、名称、说明、启停状态、排序与审计时间。本阶段不增加状态分类、持续时间、层数、刷新、到期、周期、控制、免疫、数值、公式、JSONB、发布 revision 或运行时字段，也不读取或迁移旧 `status_definitions`。

管理接口位于 `/api/admin/games/{gameId}/statuses`：GET 列表或详情，POST 新建，PUT 全量修改（含启用/停用），DELETE 删除。`statusKey` 在同一游戏内唯一且不可改；显示名称按 `lower(btrim(name))` 唯一，停用记录仍参与标识和名称唯一校验。

已有开发库执行 `db/game_manage/migrations/compatibility/status_basic_management_migration.sql`。脚本用 `information_schema` / `pg_constraint` / `pg_index` 预检同名表：缺失则创建表和唯一索引；已存在则要求列、约束和 `uq_statuses_name` 完全一致后幂等通过，结构不一致则报错停止，不得把缺失约束或索引当成可补建对象。不写默认记录。不要把该 migration 当作新库必跑步骤。

静态契约校验（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=StatusBasicManagementSchemaSqlTest,StatusServiceTest,StatusAdminControllerTest test
```

### 技能效果结构与基础结果管理

`public.skill_effects` 保存技能效果资料，`public.skill_effect_results` 保存结果主记录，`public.skill_effect_result_values` 保存数值规则，另有伤害、属性变化、资源变化、冷却变化、状态操作等类型明细表。冷却变化的操作仍保存在 `public.skill_effect_cooldown_change_details`；受影响技能集合已迁入结果级公共技能作用范围，不再使用 `skill_effect_cooldown_change_targets` 或 `detail.affectedSkillKeys`。结果形状由 `triggers.sql` 中的延迟约束触发器在事务提交时校验。本阶段不执行公式计算，也不写入 Wasm 或发布字段。

管理接口位于 `/api/admin/games/{gameId}/skills/{skillKey}/effects`：GET 列表摘要或详情，POST 新建，PUT 全量替换结果集合，DELETE 删除。`effectKey` / `resultKey` 创建后不可改；已有结果的 `resultType` 不可改。

已有开发库按顺序执行：

1. `db/game_manage/migrations/compatibility/skill_effect_basic_result_management_migration.sql`
2. `db/game_manage/triggers.sql`（刷新七种结果延迟形状约束触发器）

脚本先核对 `skills`、`skill_formulas`、`damage_types`、`attributes`、`statuses` 前置结构；八张目标表全部缺失时创建，全部存在且结构一致时幂等通过，部分存在或结构漂移时主动失败。不写默认记录、不读取旧效果、不 `DELETE`/`DROP CASCADE`。不要把该 migration 当作新库必跑步骤。

静态契约与聚焦回归（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=SkillEffectBasicResultManagementDbContractSqlTest,SkillEffectServiceTest,SkillEffectAdminControllerTest,SkillFormulaServiceTest,SkillServiceTest,DamageTypeServiceTest,StatusServiceTest test
```

随后：

```bash
mvn test
```

### 技能过程内部状态与效果录入

`public.skill_internal_states` 保存五种内部状态（COUNTER / AMMO / MODE / FLAG / INTERNAL_COOLDOWN），`public.skill_processes` 保存技能过程，步骤、普通冷却、效果挂接和内部状态操作使用专用关系表。形状由 `triggers.sql` 中的延迟约束在事务提交时校验。过程挂接到同一技能下已有的 `skill_effects` 聚合，不复制效果结果。本阶段不执行过程、不写入 Wasm 或发布字段。

管理接口：

1. `/api/admin/games/{gameId}/skills/{skillKey}/internal-states`：GET 列表摘要或详情，POST 新建完整内部状态，PUT 全量更新（种类与范围不可改），DELETE 删除。
2. `/api/admin/games/{gameId}/skills/{skillKey}/processes`：GET 列表摘要或详情，POST / PUT 完整过程聚合（步骤、可选普通冷却、效果挂接、内部状态操作）。没有步骤、挂接、操作或模式选项的独立写接口。`effectBindings` 与 `stateOperations` 同时为空时，写库前返回 `400.VALIDATION_FAILED`，两字段均为 `PROCESS_BEHAVIOR_REQUIRED`。

已有开发库按顺序执行：

1. `db/game_manage/migrations/compatibility/skill_process_internal_state_authoring_migration.sql`
2. `db/game_manage/triggers.sql`（刷新内部状态、步骤与过程延迟形状约束触发器）

脚本先核对 `skills`、`skill_formulas`、`skill_effects` 前置结构；十八张目标表全部缺失时创建，全部存在且结构一致时幂等通过，部分存在或结构漂移时主动失败。不写默认记录、不读取旧过程或内部状态、不 `DELETE`/`DROP CASCADE`。不要把该 migration 当作新库必跑步骤。

静态契约与聚焦回归（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=SkillProcessInternalStateAuthoringDbContractSqlTest,SkillInternalStateServiceTest,SkillInternalStateAdminControllerTest,SkillProcessServiceTest,SkillProcessAdminControllerTest,SkillEffectServiceTest,SkillFormulaServiceTest,SkillServiceTest test
```

随后：

```bash
mvn test
```

### 效果与状态生命周期管理

`public.skill_effect_lifecycles` 保存效果级可选生命周期，`public.skill_effect_result_lifecycle_behaviors` 保存每个结果的生命周期行为，`public.skill_effect_lifecycle_operation_details` 保存第八种结果 `LIFECYCLE_OPERATION` 的目标效果与操作。生命周期公式外键限制删除；生命周期操作目标外键即时、非级联，引用同技能已有生命周期，并禁止自引用。形状由 `triggers.sql` 中的延迟约束在事务提交时校验。本阶段只保存、校验、回读和保护引用，不执行计时、周期、层数、公式、状态、属性、护盾、发布或 Wasm。

管理接口仍位于 `/api/admin/games/{gameId}/skills/{skillKey}/effects`：摘要增加只读 `lifecycleEnabled`；详情、POST、PUT 增加可空 `lifecycle`；每个结果增加可空 `lifecycleBehavior`。没有独立生命周期控制器。

已有开发库按顺序执行：

1. `db/game_manage/migrations/compatibility/effect_status_lifecycle_management_migration.sql`
2. `db/game_manage/triggers.sql`（刷新八种结果延迟形状约束与生命周期聚合/刷新约束触发器）

脚本先核对阶段 7.2 效果八张表、`skill_formulas` 和阶段 7.3 `fk_skill_process_effect_bindings_effect`；三张目标表全部缺失时创建，全部存在且结构一致时幂等通过，部分存在或结构漂移时主动失败。只核对并替换本阶段需要更新的结果种类检查、结果形状函数/触发器和原子表明细触发器循环。不写默认记录、不读取旧生命周期、不 `DELETE`/`DROP CASCADE`。不要把该 migration 当作新库必跑步骤。

静态契约与聚焦回归（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=SkillEffectStatusLifecycleManagementDbContractSqlTest,SkillEffectBasicResultManagementDbContractSqlTest,SkillEffectServiceTest,SkillEffectAdminControllerTest,SkillFormulaServiceTest,SkillServiceTest,SkillProcessServiceTest test
```

随后：

```bash
mvn test
```

### 条件事件与动态输入供值管理

`public.skill_trigger_rules` 保存技能触发规则主记录，另有 8 张事件明细、条件组/条件及 4 张条件明细、动作及 2 张动作明细、动态输入绑定及 4 张来源明细、结果修正、逐目标冷却和单次过程次数限制，共 26 张表。形状由 `triggers.sql` 中的延迟约束在事务提交时校验。本阶段只保存、校验、回读和保护引用，不执行运行时触发、不写入 Wasm 或发布字段。

管理接口位于 `/api/admin/games/{gameId}/skills/{skillKey}/trigger-rules`：GET 列表摘要或详情，POST 新建完整聚合，PUT 全量替换子树，DELETE 删除。`ruleKey` 创建后不可改。没有独立的条件、动作或绑定写接口。

已有开发库按顺序执行：

1. `db/game_manage/migrations/compatibility/condition_event_dynamic_input_management_migration.sql`
2. `db/game_manage/triggers.sql`（刷新技能触发规则延迟形状约束触发器）

脚本先核对 `skills`、`skill_formulas`、`skill_effects`、`skill_processes` 与生命周期前置结构；二十六张目标表全部缺失时创建，全部存在且结构一致时幂等通过，部分存在或结构漂移时主动失败。不写默认记录、不读取旧 Ability/Provider、不 `DELETE`/`DROP CASCADE`。不要把该 migration 当作新库必跑步骤。

静态契约与聚焦回归（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=ConditionEventDynamicInputManagementDbContractSqlTest,SkillTriggerRuleServiceTest,SkillTriggerRuleAdminControllerTest,SkillEffectServiceTest,SkillProcessServiceTest,SkillInternalStateServiceTest,SkillFormulaServiceTest,SkillParameterServiceTest,StatusServiceTest,SkillServiceTest test
```

随后：

```bash
mvn test
```

### 斩杀与命中攻击联动

`public.skill_effect_execute_details` 保存斩杀结果引用的生命属性；`public.skill_trigger_rule_link_events` 保存命中/攻击联动事件的可空来源技能。命中联动应用与攻击联动应用结果没有空结果表。结果种类为十六种，触发事件为二十一种。形状由 `triggers.sql` 中的延迟约束在事务提交时校验。本阶段只保存、校验、回读和保护引用，不执行斩杀、联动、攻击或事件运行。

已有开发库按顺序执行：

1. `db/game_manage/migrations/compatibility/execute_hit_attack_linkage_migration.sql`
2. `db/game_manage/triggers.sql`（刷新十六种结果与二十一种事件延迟形状约束触发器）

脚本先核对阶段 7.6.3 前置结构；两张目标表全部缺失时创建，全部存在且结构一致时继续替换列宽、检查、形状函数与延迟触发器，部分存在或结构漂移时主动失败。不写默认记录、不回填、不 `DELETE`/`DROP CASCADE`。不要把该 migration 当作新库必跑步骤。

静态契约与聚焦回归（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=ExecuteHitAttackLinkageDbContractSqlTest,LegacyCombatDataCleanupDbContractSqlTest,SkillEffectServiceTest,SkillEffectAdminControllerTest,SkillTriggerRuleServiceTest,SkillTriggerRuleAdminControllerTest,SkillTriggerRuleCycleServiceTest,SkillTriggerRuleReverseProtectionServiceTest,SkillServiceTest test
```

随后：

```bash
mvn test
mvn package
```

### 丰富前序结果与综合联动

本阶段不增加表、列、索引或外键。最终仍是 85 张父表、13 张阶段 7.6 累计表、16 种结果、21 种事件。两处 `event_value_key` 检查扩展为 23 种；`skill_trigger_rule_prior_result_bindings.output_kind` 扩展为冻结的 10 种输出。前序结果公共形状仍是 `sourceActionKey` / `sourceResultKey` / `outputKind`，`sourceEffectKey` 由服务端从更早 `EXECUTE_EFFECT` 动作推导。只保存、校验、回读和保护引用，不执行公式、事件或结算。

已有开发库按顺序执行：

1. `db/game_manage/migrations/compatibility/enriched_prior_result_integrated_linkage_migration.sql`
2. `db/game_manage/triggers.sql`（刷新前序结果 `CONFIGURED_VALUE` 才检查数值规则的延迟形状约束触发器）

脚本先核对阶段 7.6.4 与乘区基线；三处检查同为精确前置或同为精确目标时继续，部分完成、未知值或两处事件值不一致时主动失败。既有行原样保留，不写业务数据、不 `CASCADE`。目标态可安全重复执行。不要把该 migration 当作新库必跑步骤。

静态契约与聚焦回归（不连 live DB）：

```bash
cd server/data_manage
mvn -Dtest=EnrichedPriorResultIntegratedLinkageDbContractSqlTest,SkillTriggerRuleServiceTest,SkillTriggerRuleAdminControllerTest,SkillEffectServiceTest,SkillEffectAdminControllerTest test
```

随后：

```bash
mvn test
mvn package
```

### 技能作用范围与技能急速修正

结果级公共技能作用范围保存在 `public.skill_effect_result_skill_scopes`，明确技能与分类关系分别保存在 `public.skill_effect_result_skill_targets` 与 `public.skill_effect_result_skill_category_targets`。技能急速修正保存在 `public.skill_effect_haste_modifier_details`。只有 `COOLDOWN_CHANGE` 与 `SKILL_HASTE_MODIFIER` 可携带范围；接口使用规范化 `detail.affectedSkillScope`，三种模式固定为 `ALL / SKILLS / CATEGORIES`。新库目标为 88 张父表、17 种结果；21 种事件、10 种前序输出、23 种事件值不变。旧冷却目标表已删除，不双写、不接受 `detail.affectedSkillKeys`。

管理接口仍位于 `/api/admin/games/{gameId}/skills/{skillKey}/effects` 聚合 GET/POST/PUT/DELETE，不增加范围子接口。

已有开发库按顺序执行：

1. `db/game_manage/migrations/compatibility/skill_scope_management_migration.sql`
2. `db/game_manage/triggers.sql`（刷新十七种结果延迟形状与生命周期约束触发器）

脚本先精确核对阶段 7.6.5 的 85 张父表、十六种结果和旧冷却目标表；四张新表全部缺失时创建并按冷却结果无损复制为 `mode=SKILLS`，全部结构正确时幂等通过，部分存在或结构漂移时主动失败。不回填技能急速业务记录、不写种子、不 `DROP CASCADE`。不要把该 migration 当作新库必跑步骤；仓库内实现和静态检查不能替代目标数据库执行后的结构与数据读回。

静态契约与聚焦回归（不连 live DB）：

```powershell
cd server/data_manage
mvn -Dtest=SkillScopeManagementDbContractSqlTest,SkillCooldownMultiSelectDbContractSqlTest,SkillEffectServiceTest,SkillEffectAdminControllerTest,SkillServiceTest,SkillCategoryServiceTest,SkillTriggerRuleServiceTest,SkillTriggerRuleRuntimeInputServiceTest,SkillTriggerRuleCycleServiceTest,LegacyCombatDataCleanupDbContractSqlTest,ExecuteHitAttackLinkageDbContractSqlTest,EnrichedPriorResultIntegratedLinkageDbContractSqlTest test
```

随后：

```powershell
mvn test
mvn package
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

### 回归清单

涉及接口、缓存或数据库结构时，至少回归：

1. `GET /api/games`（仅 `gameId` / `gameName` / 可空 `gameImgUrl`）
2. 图片读取与 Admin 写入
3. 阶段 0～7.6.5 及技能作用范围当前管理接口至少一类读写
4. 旧 `/combat-data/**`、`GET .../versions/current` 与旧 publish 别名返回普通 404

静态数据库清理契约：

```bash
cd server/data_manage
mvn -Dtest=LegacyCombatDataCleanupDbContractSqlTest,GamePublicControllerTest,GameDataServiceTest,PostgresReadStoreTest,PostgresWriteStoreTest,ImagePublicControllerTest,ImageAdminControllerTest,LegacyCombatDataHttpNotFoundTest,WebCorsConfigTest test
```

随后：

```bash
mvn test
```

## 常见失败与排查

1. **启动成功但首个请求才报依赖错误**：检查是否把 `APP_STARTUP_FAIL_FAST` 保持为默认关闭；需要尽早暴露问题时显式设为 `true`。
2. **启动阶段直接失败**：优先核对 PostgreSQL / Redis 地址、账号密码和连通性，再看 `application.yml` 是否仍引用了不适合当前环境的示例值。
3. **Admin 接口返回 401 / 403**：检查 `APP_AUTH_JWT_DISABLED` 是否已关闭，以及是否同时提供了 `IT_ADMIN_JWT_ES256_PUBLIC_KEY_PEM`。
4. **改了 SQL 或 Mapper 后查询异常**：同步检查 `db/game_manage/schema.sql`、`triggers.sql` 与 `src/main/resources/mapper/**/*.xml`。
5. **旧 combat-data / versions/current / versions:publish 返回 404**：预期行为；请改用当前管理接口。

## 协作说明

- 这不是独立仓，而是 monorepo 下的后端专用 worktree。
- 涉及 `web / server / wasm` 边界的改动，优先先把后端口径、接口契约和会话记录收口，再决定是否同步改其他模块。
- 长期协作规则见仓库根 `AGENTS.md`；当前目录的就近规则见 `AGENTS.md`。
