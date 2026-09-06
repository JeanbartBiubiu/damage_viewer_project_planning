# Damage Viewer Backend

`server/data_manage` 是 Damage Viewer 的 Java / Spring Boot 后端，负责游戏元数据、图片、属性、角色、装备、技能、状态，以及技能公式、效果、内部状态、过程和触发规则的录入管理。

当前实现只保存、校验和回读配置，不执行公式、过程或事件，不组装 Wasm 数据。旧 `/combat-data/**`、当前版本查询和 `versions:publish` 发布链路已删除。

## 开发范围与入口

默认写入范围为本模块、`db/**`、后端接口文档和直接相关的 `tools/**`；`web/**`、`wasm/**` 与其他模块设计只读参考。修改前先读 [本模块规则](AGENTS.md) 和 [仓库规则](../../AGENTS.md)。

| 入口 | 职责 |
| --- | --- |
| [DataManageApplication.java](src/main/java/xyz/game/datamanage/DataManageApplication.java) | 应用启动 |
| `src/main/resources/application.yml` | 默认配置，实际值可由环境变量覆盖 |
| `controller/publicapi/**` | 游戏列表与公开图片同步 |
| `controller/adminapi/**` | 当前业务管理接口 |
| [GameConfigurationWriteGuard.java](src/main/java/xyz/game/datamanage/support/authoring/GameConfigurationWriteGuard.java) | 同游戏写事务锁与提交前引用校验 |
| [SkillObjectReferences.java](src/main/java/xyz/game/datamanage/support/authoring/SkillObjectReferences.java) | 按业务字段提取根对象和子项引用 |
| [AuthoringReadModel.xml](src/main/resources/mapper/authoring/AuthoringReadModel.xml) | 从聚合 JSON 读取业务校验所需的明细 |
| [StartupDependencyVerifier.java](src/main/java/xyz/game/datamanage/config/StartupDependencyVerifier.java) | 启动依赖探测 |

## 当前存储结构

[当前建表脚本](../../db/game_manage/schema.sql) 定义 **24 张 public 逻辑表**。这个数量包含 `images` 分区父表，不包含图片子分区和其他模式下的表。

| 用途 | 表 |
| --- | --- |
| 游戏、属性与等级配置 | `games`、`attributes`、`game_level_configs` |
| 角色与属性配置 | `characters`、`character_attributes` |
| 装备与属性配置 | `equipment`、`equipment_attributes` |
| 技能基础与参数 | `skill_categories`、`skills`、`skill_category_relations`、`skill_parameters` |
| 伤害类型、乘区与状态 | `damage_types`、`modifier_zones`、`statuses` |
| 五类技能根对象 | `skill_formulas`、`skill_effects`、`skill_internal_states`、`skill_processes`、`skill_trigger_rules` |
| 图片与挂载关系 | `images`、`character_skill_relations`、`equipment_skill_relations`、`image_relations` |
| 系统生成的引用索引 | `skill_object_references` |

五类根对象保留稳定标识、名称、启停状态、排序和审计时间等普通列，其结构化内容使用 PostgreSQL 的 JSONB 列存储。一次保存写入完整对象，不再拆写节点和类型明细表。

| 根对象 | JSONB 列 | 内容 |
| --- | --- | --- |
| 公式 | `expression` | 当前接口的表达式树；运算节点使用有序 `operands` |
| 效果 | `results`、`lifecycle` | 结果数组和可选效果生命周期；结果自身保留数值规则、类型明细与生命周期行为 |
| 内部状态 | `detail` | COUNTER、AMMO、MODE、FLAG、INTERNAL_COOLDOWN 对应内容，模式选项也在其中 |
| 过程 | `steps`、`cooldown`、`effect_bindings`、`state_operations` | 步骤、可选普通冷却、效果挂接与内部状态操作 |
| 触发规则 | `event_source`、`condition_groups`、`actions`、`limits` | 事件来源、条件组、动作与两项触发限制 |

数据库的 `effect_bindings`、`state_operations` 等列对应接口中的 `effectBindings`、`stateOperations`；触发规则的 `limits` 只用于存储，接口使用 `perTargetCooldown` 和 `maxTriggersPerProcess` 字段。数值字段使用下文的三种统一取值来源；其余枚举、数组顺序、空值语义，以及角色、装备和参数的完整属性或等级取值图保持原结构。

### 校验与并发写入

数据库保留根对象外键、唯一约束、元数据检查和 JSON 对象/数组形状检查。表达式深度与节点数、启停引用、类型匹配、子项顺序、动态输入、前序动作和循环等业务校验由对应服务负责。[triggers.sql](../../db/game_manage/triggers.sql) 当前只负责游戏新增时创建图片分区，不再承担技能明细的延迟形状校验。

配置写入口必须在真实可写事务中先调用 `GameConfigurationWriteGuard.begin(gameId)`，再读取和修改业务数据。它使用 `READ COMMITTED` 隔离级别和 `games` 行锁，使同一游戏的配置写入顺序执行；字典、图片和关系管理也遵循这个入口。

提交前，保护器读取该游戏五类根对象的最终 JSON，按明确的业务字段提取引用，检查目标根对象及结果、生命周期、模式选项、步骤、动作等子项存在，然后整体替换该游戏的 `skill_object_references`。引用记录包含来源技能、对象、字段路径以及目标技能、对象和子项，支持跨技能反查；它由系统生成，没有独立编辑接口。校验失败时，业务修改和引用索引一起回滚。

[SkillNumericSemantics.java](src/main/java/xyz/game/datamanage/support/authoring/SkillNumericSemantics.java) 在同一提交检查中复核全部数值使用位置和动作输入绑定。参数模式、类型、值、等级图，公式表达式，以及效果、生命周期、过程和状态的修改都受约束；技能或角色等级扩展后给参数补入的零值也会重新检查。该组件仅依赖数据库连接，不通过管理服务相互调用。

已有删除保护保留各接口错误码；最终引用缺失返回 `409.SKILL_OBJECT_REFERENCE_INVALID` 并带来源字段信息。修改聚合时移除被引用子项也会被检查。直接 SQL 写入不会自动执行这些服务校验，迁移必须使用下述事务验收入口。

### 直接生命周期条件

触发条件支持 `LIFECYCLE_CHECK`，明细为 `effectKey`、`subject`、`checkKind`、`comparator`、`comparisonValue`。仅引用当前技能已经配置生命周期的效果；`PRESENT` 和 `ABSENT` 不允许比较符或比较值，`STACKS_COMPARE` 必须提供两者，固定值及静态参数全部等级均为非负整数，直接或经公式引用计算时参数均被拒绝。

条件复用效果的实例范围，`SKILL`、`SOURCE` 的主体为空，`TARGET`、`SOURCE_TARGET` 必须指定承受对象；后者来源固定为当前技能拥有者。没有事件来源对象的事件不能选择 `EVENT_SOURCE`。实例范围仍不可修改，提交前复核既有条件的主体适配；删除被引用效果或移除其生命周期沿用 409 引用保护。

此条件约定读取动作执行前的当前实例，不存在时层数为零。配置检查不产生执行效果依赖，也不作为循环保护；本模块仍不执行事件和实例计算。不新增表或数据迁移。

### 来源施放消耗绑定

动态输入来源 `SOURCE_CAST_RESOURCE_COST` 的明细只含 `attributeKey`，引用当前游戏已有属性。仅允许已经明确 `sourceSkillKey` 的 `SKILL_HIT` 事件，目标必须是当前动作可达的 `RUNTIME_INPUT`、`DECIMAL` 参数。来源技能直接取事件配置，更换绑定来源仍须使用新的绑定键。

属性引用进入统一引用索引；受写入守卫保护的属性移除事务会以 409 拒绝悬空引用，当前属性管理没有删除接口。参数类型、模式、公式可达性和绑定事件的后续变化均在提交前复核。普通直接 SQL 不受此保护。

该来源约定读取实际命中所属原始施放的非负资源消耗快照，同次施放的多次命中共用快照，后续退款不改变它。真实零消耗必须明确提供零，缺少施放或资源上下文必须报缺失。本模块只保存此输入契约，不产生快照，也不把已有消耗、恢复或退款结果累加成该值。

### 命中目标类别条件

`TARGET_CATEGORY_CHECK` 的明细只含非空、无重复的 `categories` 数组，类别限定为英雄 `CHAMPION`、史诗野怪 `EPIC_MONSTER`、小兵 `MINION`、非史诗野怪 `NON_EPIC_MONSTER`、建筑 `STRUCTURE`。仅供 `SKILL_HIT`、`BASIC_ATTACK_HIT` 使用，主体固定为实际命中目标；不保存主体字段、属性或执行引用，也不作为循环保护。

保存和事务提交前均检查类别形状及事件适配。每次实际命中必须明确提供唯一类别，条件中的多个类别表示任一匹配；缺失类别及尚未建模目标不能默认归为英雄。当前模块只保存响应配置，不产生实际命中上下文。

## 初始化与已有库迁移

### 新库

按顺序执行：

1. [schema.sql](../../db/game_manage/schema.sql)：创建当前 24 张逻辑表及约束。
2. [triggers.sql](../../db/game_manage/triggers.sql)：安装图片分区函数与游戏新增触发器。

随后录入游戏及业务数据。当前没有新库必跑的业务种子；`migrations/**` 不属于新库初始化步骤，应用启动也不会自动执行迁移。

### 历史 91 表库前置迁移

存储精简阶段的一次性入口是 [skill_aggregate_migration.sql](../../db/game_manage/migrations/breaking/skill_aggregate_migration.sql)。它将五类对象的原明细转换为根对象 JSON，创建引用索引表，并显式删除被吸收的 68 张表，得到 24 张逻辑表；删除语句不使用 `CASCADE`，脚本自身不提交事务。此脚本和 `VerifyAggregateMigration.java` 对应后端提交 `c23c9b3`，使用该阶段的字段和校验器；不能在最新数值取值协议下直接运行旧验收工具。

执行顺序：

1. 核对准确数据库目标、完整备份和 91 表前置结构，保存迁移前聚合接口快照，并停止业务写入。
2. 通过 [VerifyAggregateMigration.java](../../tools/authoring/VerifyAggregateMigration.java) 在同一连接、同一事务中执行主迁移，对照聚合内容、数组顺序、数值、空值、表数及图片内容，并在提交前校验和生成引用索引。任一检查失败则回滚。
3. 结构和数据检查通过后，用新后端回读原有接口，并验证相关新增、修改、删除和引用拒绝行为，再恢复录入。

执行器参数依次为“后端工作树根目录、已核对数据库名、迁移前聚合快照路径、`--apply` 或 `--check`”。它是本次指定开发库的验收工具，带有已核对库名和图片基线限制，不是任意数据库的通用迁移命令。`--apply` 执行迁移；`--check` 跳过结构变更，但仍在事务内重新校验和生成引用索引，不能当作只读检查。

`aggregate_parts/*.sql` 是主脚本已经包含的转换片段，不要分别执行后再执行主脚本。历史 `migrations/compatibility/**`、旧战斗表清理和关系管理迁移仅适用于各自注明的旧版本前置结构，不能作为当前 24 表库的补表或升级步骤。

**2026-09-06 已完成复制演练库和原开发库的 91 → 24 表迁移，生成 150 条引用；原有聚合内容和 2,127 张图片核对一致。** 原开发库启动新服务后完成 154 次管理接口读回及公开接口对照，浏览器完成伊泽瑞尔 Q 效果保存。演练库另验证五类聚合增改、引用删除保护、循环与动态输入拒绝、并发冲突；新建空库验证初始化和 12 项 JSON 形状约束。完整数据库备份及机器验收产物位于工作树忽略目录 `output/authoring-simplification/`。

### 统一数值取值迁移

已经完成存储精简的 24 表库，使用 [MigrateNumericValues.java](../../tools/authoring/MigrateNumericValues.java) 单独迁移效果、内部状态、过程和触发规则的 34 处取值位置。它把已有非空公式标识转换为 FORMULA 对象，保留空值；不生成中转公式，不改变参数、元数据、排序或图片。四个参数仍为后端根目录、已核对数据库名、迁移前快照路径、`--apply` 或 `--check`，目标数据库受工具中的专属名单限制。

先备份和保存当前聚合快照，在复制库演练；正式执行时停止写入，在单事务中转换、比较业务含义、运行完整提交前保护并重建引用，失败回滚。`--check` 也会重建引用，不是只读操作。当前文档说明的是代码入口；本单元实际数据库和页面验收结果由主负责人另行记录。

### 统一数值取值

34 处原公式取值统一为 [SkillNumericValue](src/main/java/xyz/game/datamanage/model/value/SkillNumericValue.java)：

- 固定值：`{"kind":"FIXED","value":12.5}`。
- 当前技能参数：`{"kind":"PARAMETER","parameterKey":"damage"}`。
- 当前技能公式：`{"kind":"FORMULA","formulaKey":"damage"}`。

三种形状严格互斥，拒绝未知字段、数值字符串、混合分支和旧字段。可选位置用 `null` 表示未配置，固定零表示已配置。HTTP 反序列化直接读取十进制数值令牌，父请求的多态 JSON 树解析同样保留十进制精度，存储与回读延续该精度。

字段替换为 `valueRule.value`、状态操作 `value`、`initialValue`、`maxValue`；其他取值字段去掉 `FormulaKey` 并加 `Value`，如 `durationValue`、`comparisonValue`、`repeatCountValue`。公式本身的标识、表达式树、动态输入绑定的参数标识以及数值规则中的固定倍率和上下界不变。

固定值和静态参数的全部等级取值按使用位置检查：时间非负且允许小数毫秒，周期、恢复间隔及每目标保护冷却必须大于零；次数和层数为整数，重复次数、触发上限、弹药容量、生命周期最大层数与每次施加层数至少一，初始数量和普通计数上限可为零。比较值和有方向的数值变化不统一限制正负。可取得蓄力两端时，逐对应等级或独立等级组合检查最大时长不小于最小时长。

动态输入检查同时收集直接参数及公式展开的参数，继续遍历过程挂接、计数/弹药初始化、重置与内部冷却。条件、阈值、限制及当前时点读取禁止计算时输入。数值或既有绑定失效返回 `400.INVALID_SKILL_NUMERIC_VALUE`，带所属对象和字段路径并回滚整笔事务。具名公式保持原校验，不新增公式执行器，也不推断任意公式的整数性、大小或范围；前序结果输出的数值类型契约不变。

## 管理接口与录入约束

管理接口统一位于 `/api/admin/games/{gameId}`。五类技能对象按完整对象保存，没有独立的结果、步骤、动作、绑定或模式选项写接口。

| 资源路径 | 当前边界 |
| --- | --- |
| `/attributes` | 列表、详情、新建、全量修改和启停；不提供 DELETE |
| `/characters`、`/equipment` | 角色和装备分别管理，保留各自完整属性配置 |
| `/skill-categories`、`/damage-types` | 单层技能分类与伤害类型，均支持列表、详情、新建、全量修改和删除 |
| `/modifier-zones` | 属性、伤害、治疗三个业务域的乘区管理 |
| `/statuses` | 状态基本资料；稳定标识不可改，名称按去首尾空格、不区分大小写唯一，停用项仍参与唯一校验 |
| `/skills` | 技能基本资料；`skillKey` 在同游戏唯一且不可改，名称可重复，`maxLevel >= 1` |
| `/skills/{skillKey}/parameters` | 参数四种取值方式：FIXED、SKILL_LEVEL、CHARACTER_LEVEL、RUNTIME_INPUT |
| `/skills/{skillKey}/formulas` | 表达式节点 OPERATION、PARAMETER、ATTRIBUTE；深度最多 32、节点最多 256，不执行公式 |
| `/skills/{skillKey}/effects` | 效果及完整结果、可选生命周期；已有结果的 `resultType` 不可改 |
| `/skills/{skillKey}/internal-states` | 五种内部状态完整读写；既有种类和范围不可改 |
| `/skills/{skillKey}/processes` | 完整过程读写；效果挂接和内部状态操作不能同时为空 |
| `/skills/{skillKey}/trigger-rules` | 完整事件、条件、动作和动态输入配置；`ruleKey` 创建后不可改 |
| `/images` | 图片列表、详情、新建、全量修改和启停 |

技能分类继续用 `skillCategoryKeys: string[]`，空数组表示未分类，关系保存在 `skill_category_relations`。只有冷却变化和技能急速修正结果可携带 `detail.affectedSkillScope`；模式为 `ALL / SKILLS / CATEGORIES`，多个分类按并集匹配。旧 `detail.affectedSkillKeys` 不接受。

生命周期随效果保存和回读，摘要提供 `lifecycleEnabled`。前序结果输入仍为 `sourceActionKey / sourceResultKey / outputKind`，对应效果由服务端从更早的执行效果动作推导。过程的 `effectBindings` 与 `stateOperations` 同时为空时返回 `400.VALIDATION_FAILED`，两字段的问题码均为 `PROCESS_BEHAVIOR_REQUIRED`。

### 技能挂载与代表图片

`/character-skill-relations` 和 `/equipment-skill-relations` 提供角色、装备与技能的双向查询、新增、排序调整和移除，使用同游戏复合外键。

游戏、角色、属性、装备、技能、技能效果和状态通过各自的 `representative-image` 子资源维护代表图片；`/images/{imageKey}/usages` 查询图片用途；`/image-options?keyword=` 查询最多 50 个已启用图片摘要，不含图片内容。图片关联的来源存在性与来源删除清理由服务在上述同游戏写事务中保证。

`GET /api/games` 只返回 `gameId`、`gameName`、可空 `representativeImageKey`。游戏代表图片写入成功后会清理游戏列表缓存。

### 图片内容与公开同步

`images` 按 `game_id` 列表分区，主键为 `(game_id, image_key)`，保存名称、说明、Base64 数据地址、真实格式、字节数、宽高、启停状态和审计时间。

后端只接受 PNG/JPEG，解码后大小为 1～262144 字节，宽高分别为 1～64 像素。服务端核对真实格式、签名和尺寸后原样保存，不裁切、缩放、压缩或重新编码；直接提交超限图片返回 `400.IMAGE_CONTENT_INVALID`。

公开同步接口为 `/api/games/{gameId}/images`，可按 `updatedAfter` 增量读取；停用项只返回标识、状态和更新时间。

## 本地开发与配置

前置要求为 JDK 21、Maven 3.9+、PostgreSQL 和 Redis。默认端口为 8080，以下命令在 `server/data_manage` 执行：

| 命令 | 用途 |
| --- | --- |
| `mvn spring-boot:run` | 启动本地服务 |
| `mvn "-Dtest=具体测试类" test` | 运行受影响测试 |
| `mvn test` | 功能收尾测试 |
| `mvn package` | 配置、依赖或打包链路变更后的打包检查 |

默认配置在 `src/main/resources/application.yml`。本地使用环境变量或私有配置覆盖，不把真实数据库、Redis、JWT 凭据写回仓库。

| 环境变量 | 用途 |
| --- | --- |
| `SPRING_DATASOURCE_URL` | PostgreSQL 连接串 |
| `SPRING_DATASOURCE_USERNAME` / `SPRING_DATASOURCE_PASSWORD` | 数据库账号密码 |
| `IT_DB_INIT_FAIL_TIMEOUT` | Hikari 初始化失败等待时间 |
| `IT_REDIS_HOST` / `IT_REDIS_PORT` / `IT_REDIS_PASSWORD` / `IT_REDIS_DATABASE` | Redis 连接配置 |
| `APP_STARTUP_FAIL_FAST` | 是否在启动时立即检查 PostgreSQL / Redis |
| `APP_AUTH_JWT_DISABLED` | 是否关闭本地管理接口 JWT 校验 |
| `IT_ADMIN_JWT_ES256_PUBLIC_KEY_PEM` | 开启管理接口 JWT 校验时使用的 ES256 公钥 |

CORS 当前覆盖 `/api/**`，并暴露 `ETag` 响应头。启动成功但首次请求出现依赖错误时，检查连接配置；需要启动时直接暴露问题可设 `APP_STARTUP_FAIL_FAST=true`。管理接口返回 401 / 403 时，检查 JWT 开关及公钥配置。

## 验证入口与证据边界

只修改文档时核对链接、命令和差异，不需要运行 Maven。实现变更先运行受影响测试，功能收尾运行 `mvn test`；配置、依赖或启动装配变化增加 `mvn package`。移除旧类后若出现与源码不符的测试结果，使用 `mvn clean test` 清除旧编译产物。

当前聚合存储与引用保护的针对性入口：

```powershell
mvn "-Dtest=LegacyCombatDataCleanupDbContractSqlTest,SkillParameterFormulaManagementDbContractSqlTest,SkillEffectAggregateStorageTest,SkillObjectReferencesTest,GameConfigurationWriteGuardTest,SkillNumericValueTest,SkillNumericSemanticsTest" test
```

数据库结构或公共读取变化后，对最终服务验证 `GET /api/games`、受影响图片接口和相关管理读写；同时检查删除根对象、移除被引用子项的拒绝行为，以及失败事务没有留下局部修改。旧 `/combat-data/**`、版本查询和发布别名应返回普通 404。

[verify-aggregate-api.mjs](../../tools/authoring/verify-aggregate-api.mjs) 用于将管理接口回读与迁移前快照比较；[verify-aggregate-crud.mjs](../../tools/authoring/verify-aggregate-crud.mjs) 是本轮复制演练服务的新增、修改、删除与引用保护验收工具，运行前核对其固定目标和隔离测试标识。

静态 SQL 检查、单测、复制库迁移、真实 HTTP 和浏览器验收分别提供不同层面的证据；单测通过或应用启动成功不能替代原库迁移和真实页面验收。发现旧明细表查询错误时，应核对实际数据库是否已迁移、服务是否使用当前编译产物，不要重新创建已吸收的旧表。
