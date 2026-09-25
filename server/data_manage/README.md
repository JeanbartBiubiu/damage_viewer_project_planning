# Damage Viewer Backend

`server/data_manage` 是 Damage Viewer 的 Java / Spring Boot 后端，负责游戏元数据、图片、属性、角色、装备、符文、技能、状态，以及技能公式、效果、内部状态、过程和触发规则的录入管理。

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

[当前建表脚本](../../db/game_manage/schema.sql) 定义 **28 张 public 逻辑表**。这个数量包含 `images` 分区父表，不包含图片子分区和其他模式下的表。

| 用途 | 表 |
| --- | --- |
| 游戏、属性、等级与通用吸血配置 | `games`、`attributes`、`game_level_configs`、`game_vamp_rules` |
| 角色与属性配置 | `characters`、`character_attributes` |
| 装备与属性配置 | `equipment`、`equipment_attributes` |
| 符文身份、分组与技能挂载 | `runes`、`rune_paths`、`rune_skill_relations` |
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
| 触发规则 | `event_source`、`condition_groups`、`actions`、`limits` | 事件来源、条件组、动作与三项触发限制 |

数据库的 `effect_bindings`、`state_operations` 等列对应接口中的 `effectBindings`、`stateOperations`；触发规则的 `limits` 只用于存储，接口使用 `perTargetCooldown`、`maxTriggersPerProcess` 和 `oncePerUse` 字段。数值字段使用下文的三种统一取值来源；其余枚举、数组顺序、空值语义，以及角色、装备和参数的完整属性或等级取值图保持原结构。

### 校验与并发写入

数据库保留根对象外键、唯一约束、元数据检查和 JSON 对象/数组形状检查。表达式深度与节点数、启停引用、类型匹配、子项顺序、动态输入、前序动作和循环等业务校验由对应服务负责。[triggers.sql](../../db/game_manage/triggers.sql) 当前只负责游戏新增时创建图片分区，不再承担技能明细的延迟形状校验。

配置写入口必须在真实可写事务中先调用 `GameConfigurationWriteGuard.begin(gameId)`，再读取和修改业务数据。它使用 `READ COMMITTED` 隔离级别和 `games` 行锁，使同一游戏的配置写入顺序执行；字典、图片和关系管理也遵循这个入口。

提交前，保护器读取该游戏五类根对象的最终 JSON，按明确的业务字段提取引用，检查目标根对象及结果、生命周期、模式选项、步骤、动作等子项存在，然后整体替换该游戏的 `skill_object_references`。引用记录包含来源技能、对象、字段路径以及目标技能、对象和子项，支持跨技能反查；它由系统生成，没有独立编辑接口。校验失败时，业务修改和引用索引一起回滚。

[SkillNumericSemantics.java](src/main/java/xyz/game/datamanage/support/authoring/SkillNumericSemantics.java) 在同一提交检查中复核全部数值使用位置和动作输入绑定。参数模式、类型、值、等级图，公式表达式，以及效果、生命周期、过程和状态的修改都受约束；技能或角色等级扩展后给参数补入的零值也会重新检查。该组件仅依赖数据库连接，不通过管理服务相互调用。

已有删除保护保留各接口错误码；最终引用缺失返回 `409.SKILL_OBJECT_REFERENCE_INVALID` 并带来源字段信息。修改聚合时移除被引用子项也会被检查。直接 SQL 写入不会自动执行这些服务校验，迁移必须使用下述事务验收入口。

### 通用吸血规则与伤害例外

`GET/PUT /api/admin/games/{gameId}/vamp-rules` 按 `{rules:[...]}` 读取和完整替换当前游戏的吸血规则。每种类型最多一项，固定按生命偷取、全能吸血、物理吸血、法术吸血排序；未配置的类型不会启用。每项保存来源比例属性、计算基数、默认效率和三个非空允许集合。产生方式、来源性质和技能分类在各自集合内任一匹配，三个维度之间同时满足。当前属性目录没有独立单位字段，来源比例属性按同游戏真实存在的 `DECIMAL`（十进制）属性校验，比例业务含义由来源核定，不按属性名称推断。

伤害明细使用 `vampQualification`（资格状态）与 `vampOverrides`（例外集合），旧 `vampRules` 字段被拒绝。未核定 `UNRESOLVED` 只能配空集合；已核定 `RESOLVED` 的空集合表示继承。禁止 `DISABLED` 的基数与效率为空；覆盖 `OVERRIDE` 必须提供两项，并复用现有固定值、参数或公式。覆盖效率的固定值及参数全部等级不能为负，禁止项不产生数值引用或动态输入依赖。

游戏规则写入先取得同游戏写锁。提交前重新核对来源属性类型、规则分类引用、伤害分类与例外对应类型；已核定伤害必须具有技能分类及至少一项游戏规则。删除最后一项规则、删除被引用分类、把比例属性改成整数，或使现有例外失去对应规则，均返回 `409.GAME_VAMP_RULE_INVALID` 并回滚。直接请求形状错误仍返回 `400.VALIDATION_FAILED`。这些游戏级引用不伪装为技能引用索引行。

已核定伤害提供 `ACTUAL_HEALING`（实际治疗）前序输出，未匹配或被禁止时可合法为零；未核定伤害不提供该输出。SQL 投影、效果形状与提交检查保持同义。本模块只保存、校验与回读，不执行吸血或治疗；完整规则与运行顺序以规划真源[管理页面与共性机制迭代计划](../../../damage_viewer_project_planning/文档记录/详细设计/项目/管理页面与共性机制迭代计划.md)第3项为准。

已有库使用[通用吸血规则迁移](../../db/game_manage/migrations/game_vamp_rules.sql)，新库直接使用当前28表建表脚本。迁移脚本不提交事务、不写入默认游戏规则、不自动核定任何旧伤害。调用方必须先冻结完整前值到外部档案，并在同一事务、同一连接创建 `pg_temp.vamp_migration_archive`，列结构与 `skill_effects` 一致，保存全部包含伤害结果的完整效果行。脚本锁定相关表后双向比较完整前值，拒绝重放、新旧字段混用和依赖旧伤害吸血治疗输出的动作，然后把每条旧伤害转换为未核定空例外，仅移除旧效率引用；非目标结果、伤害字段、生命周期与时间戳保持。

执行器还须核对数据库目标及脚本、完整前值摘要，在提交前对每项结果计算上述预期转换并逐项比对，再通过 `GameConfigurationWriteGuard` 进行同事务最终校验和引用重建。提交后用独立连接及最终服务分别回读规则、全部伤害与引用；提交结果不明先只读恢复，不重放。启动新版服务之前必须完成迁移；测试通过不能代替真实迁移与接口读回。

一次性执行器为 [ApplyGameVampRules.java](../../tools/authoring/ApplyGameVampRules.java)。其 `--prepare` 只读冻结完整效果、引用、触发规则及全部原表摘要，`--apply` 要求冻结档案和两个明确摘要，并以固定尝试流水禁止重放；事务守卫及逐项比较通过后才提交，再用新只读连接独立回查。`--check` 真正只读，不重建引用或建临时表。完整命令和证据边界见[执行器说明](../../tools/authoring/README.md#通用吸血规则一次性迁移)。

### 来源对象初始化完成事件

`SOURCE_INITIALIZED` 表示来源对象的基础属性、技能与装备挂载、初始内部状态准备完成后触发一次。它不表示复活、装备变化或等级变化。事件明细必须是空对象 `{}`，不能为 `null`、非对象或带额外字段，也不提供事件数值。`EVENT_SOURCE` 和 `CURRENT_TARGET` 均为被初始化的来源对象自身，不是其战斗目标。

初始化规则复用执行效果或启动过程动作，以及现有引用与循环校验，不增加表或循环豁免。无条件被动可通过 `EXECUTE_EFFECT`、`targetContext=EVENT_SOURCE` 施加自身效果；例如按当前角色等级读取的无限期生命偷取效果，无需另建等级变化事件。本模块只保存、校验和回读此事件契约，不产生战斗初始化事件或执行被动。

### 直接生命周期条件

效果的结果数组仍为必填；合法生命周期可以配合空数组保存，仅记录生命周期实例。缺失或为空值的结果数组、无生命周期且无结果、无周期结果却配置周期均被拒绝。真实结果读取保持零条；触发规则内部形状读取保留效果及生命周期元数据，用于生命周期事件、动态输入和循环校验，不生成结果标识、数值输出或伤害依赖。移除被引用结果与生命周期仍受原引用保护，不需要数据库迁移。共享定义见规划真源《系统精简实施说明》的“仅记录生命周期的效果增量”。

触发条件支持 `LIFECYCLE_CHECK`，明细为 `effectKey`、`subject`、`checkKind`、`comparator`、`comparisonValue`。仅引用当前技能已经配置生命周期的效果；`PRESENT` 和 `ABSENT` 不允许比较符或比较值，`STACKS_COMPARE` 必须提供两者，固定值及静态参数全部等级均为非负整数，直接或经公式引用计算时参数均被拒绝。

条件复用效果的实例范围，`SKILL`、`SOURCE` 的主体为空，`TARGET`、`SOURCE_TARGET` 必须指定承受对象；后者来源固定为当前技能拥有者。没有事件来源对象的事件不能选择 `EVENT_SOURCE`。实例范围仍不可修改，提交前复核既有条件的主体适配；删除被引用效果或移除其生命周期沿用 409 引用保护。

此条件约定读取动作执行前的当前实例，不存在时层数为零。配置检查不产生执行效果依赖，也不作为循环保护；本模块仍不执行事件和实例计算。不新增表或数据迁移。

### 来源施放消耗绑定

动态输入来源 `SOURCE_CAST_RESOURCE_COST` 的明细只含 `attributeKey`，引用当前游戏已有属性。允许已经明确 `sourceSkillKey` 的 `SKILL_HIT`，以及当前技能、非被动过程的 `PROCESS_COMPLETE` / `PROCESS_FAILURE`；开始或取消请求不能供值。目标必须是当前动作可达的 `RUNTIME_INPUT`、`DECIMAL` 参数。命中事件的来源技能直接取事件配置；过程时点的来源归属为规则所属技能加 `processKey`。更换绑定来源仍须使用新的绑定键。

属性引用进入统一引用索引；受写入守卫保护的属性移除事务会以 409 拒绝悬空引用，当前属性管理没有删除接口。参数类型、模式、公式可达性和绑定事件的后续变化均在提交前复核。普通直接 SQL 不受此保护。

该来源约定读取实际命中所属原始施放、或当前技能过程完成/失败时点对应施放的非负资源消耗快照。同次施放的多次命中共用快照，后续退款不改变它。真实零消耗必须明确提供零，缺少施放或资源上下文必须报缺失。本模块只保存此输入契约，不产生快照，也不把已有消耗、恢复或退款结果累加成该值。完整规则以规划真源[管理页面与共性机制迭代计划](../../../damage_viewer_project_planning/文档记录/详细设计/项目/管理页面与共性机制迭代计划.md)第4项（PLAN_REV `casting-phase-r2`）为准。

### 技能使用阶段与推进过程

`SKILL_USED.detail.castPhase` 必填，取值 `INITIAL` / `RECAST` / `CHARGE_RELEASE`；`SKILL_HIT` 及其他事件拒绝该字段。读取旧缺省或 `NULL` 如实返回，不默认 `INITIAL`。新建与修改（包括只改名字）强制核定阶段。

`ADVANCE_PROCESS` 明细为 `{processKey,stepKey}`，必须明确同技能 `sourceSkillKey`：`RECAST` 推进再次施放步骤，`CHARGE_RELEASE` 推进蓄力步骤；拒绝首次、被动、不存在或类型不匹配。动作外壳与 `FAIL_PROCESS` 相同：`targetContext` 为 `null`，动态输入与结果修正为空。已核定阶段上的 `START_PROCESS` 只允许 `INITIAL`。过程时点 `failureReason` 仅 `PROCESS_FAILURE` 可非空。冷却变化 `SET_REMAINING` 需要有限非负毫秒（含 0）的数值规则，配置值前序输出沿用 `REDUCE` 而非 `RESET`。

未修改的缺阶段存量不单独锁死全游戏最终检查；任意 `ADVANCE_PROCESS` 不能因阶段空缺豁免。本模块仍只管理配置，不执行过程或宣称战斗通过。共享契约只以规划真源第4项为准，不在此复制整份。

### 事件对方类别条件

`TARGET_CATEGORY_CHECK` 的明细只含非空、无重复的 `categories` 数组，类别限定为英雄 `CHAMPION`、史诗野怪 `EPIC_MONSTER`、小兵 `MINION`、非史诗野怪 `NON_EPIC_MONSTER`、建筑 `STRUCTURE`。仅供 `SKILL_HIT`、`BASIC_ATTACK_HIT`、`KILL`、`DAMAGE_PENDING`、`DAMAGE_DEALT`、`DAMAGE_TAKEN` 使用，主体固定为事件对方：技能命中和普攻命中读取实际命中对象，来源对象完成击杀读取本次被击杀对象，造成伤害读取本次伤害承受对象，伤害待结算和受到伤害读取本次伤害来源对象；不保存主体字段、属性或执行引用，也不作为循环保护。

保存和事务提交前均检查类别形状及事件适配。每次对应事件必须为事件对方明确提供唯一类别，条件中的多个类别表示任一匹配；缺失类别及尚未建模对方不能默认归为英雄。当前模块只保存、校验和回读条件配置，不产生上述事件的对方类别上下文。

### 显式自施目标条件

`EXPLICIT_TARGET_IS_SOURCE` 只允许用于 `SKILL_USED`，条件明细严格为 `{}`。它表示在目标回退前，事件确实携带显式目标且该目标与技能拥有者为同一对象；没有显式目标时固定不匹配，不能把无目标施法回退到来源对象误判为自施。

该条件不保存对象标识，不产生目录、公式、数值、执行或循环引用。管理端保存和事务提交前都会检查空明细及事件适配；本模块只保存、校验和回读条件，不产生显式目标快照，也不执行条件。现有触发规则聚合即可承载此条件，不增加表或数据库迁移。

### 技能命中敌方对象

管理接口支持 `SKILL_HIT_TARGET_IS_ENEMY`（技能命中敌方对象），复用现有触发规则聚合。空明细解析、技能命中事件适配、最终配置校验及引用扫描均已接入，不需要数据库迁移。共享语义以规划 `master` 的《条件事件与动态输入供值管理详细设计》第6.7节为准；本模块不生产敌我关系，也不执行条件。

定向检查包含 `SkillTriggerSkillHitTargetIsEnemyConditionServiceTest` 与 `SkillHitTargetIsEnemyConditionSemanticsTest`，并回归既有显式自施条件、整体写入校验与引用检查；68项定向和994项全量测试通过。正常重启后20项原配置响应含时间戳不变。娜美R已通过真实页面单次保存、关闭重开和另次32项独立GET，原成本规则保持；这是管理读写证据，未执行敌我关系或战斗求值。

### 技能命中护盾结果

事件值 `SKILL_HIT_SPELL_SHIELD_BLOCKED` 仅由 `SKILL_HIT` 提供，约定整数零表示未被法术护盾阻挡、一表示被阻挡。它可用于现有事件值比较和动态输入绑定；整数来源按现有规则可绑定整数或十进制参数，比较阈值仍使用现有三来源数值规则，不限制为零或一。保存及最终事务状态均检查所属事件，旧伤害事件的 `BLOCKED` 和法术护盾阻挡事件保持原义。

该值必须来自同次实际命中的护盾判定，缺少结果必须报缺失，不能默认补零，也不能从伤害、护盾存续或免疫反推。当前只保存管理输入契约，不产生运行时判定；比较此值不作为循环保护。

持续状态施加允许保留当前结果粒度：`TARGET + STATUS_OPERATION + APPLY + PERSISTENT + RESULT`。创建、修改与聚合读回共用 `SkillEffectService` 的资格校验；其他持续非空粒度仍拒绝，`null` 保持不参与阻挡的含义。共享语义以规划工作树的《法术护盾闭环详细设计》为准，沿用现有结果与生命周期 JSONB，不增加表或字段；本服务不执行状态期限或法术护盾战斗判断。

### 同次使用限制

触发规则可空 `oncePerUse: {groupKey, scope}` 写入现有 `limits` JSON，不加表、不做数据迁移。页面称“同次使用仅触发一次”；`null` 或缺失表示关闭，旧 JSON 缺该字段读回 `null`，不猜测组名。启用后 `groupKey` 沿用 `^[a-z][a-z0-9_]{0,63}$`，`scope` 为 `SKILL` 或 `TARGET`，额度固定一次，不接受次数配置或其它额外字段。

只允许 `SKILL_HIT`、`BASIC_ATTACK_HIT`、`BASIC_ATTACK_START`。同技能同一 `groupKey` 必须同范围；保存时在 `listRulesForUpdate` 事务锁下核对其他规则，冲突字段为 `oncePerUse.scope` 并附 `conflictingRuleKey`，不偷偷改另一条。不同技能可以重名。删除或把该限制改为 `null` 后，剩余成员可改范围。

`groupKey` 不是目录或用户技能引用，不进入 `skill_object_references`。请求形状、未知字段和事件资格返回 `400.VALIDATION_FAILED` 或 `400.INVALID_BODY`；与已有规则组冲突以及提交前最终聚合不合法返回 `409.SKILL_TRIGGER_RULE_ONCE_PER_USE_INVALID`。服务字段校验与 `GameConfigurationWriteGuard` 共用 `SkillTriggerOncePerUseSemantics`。角色录入检查走同一语义，诊断字段经第8项 `limits` 展开为 `oncePerUse.groupKey` / `oncePerUse.scope`。本模块只保存、校验和回读，不执行额度。共享契约以规划真源[管理页面与共性机制迭代计划](../../../damage_viewer_project_planning/文档记录/详细设计/项目/管理页面与共性机制迭代计划.md)第6项（`authoring-p6-r3`）为准。

## 初始化与已有库迁移

### 新库

按顺序执行：

1. [schema.sql](../../db/game_manage/schema.sql)：创建当前 27 张逻辑表及约束。
2. [triggers.sql](../../db/game_manage/triggers.sql)：安装图片分区函数与游戏新增触发器。

随后录入游戏及业务数据。当前没有新库必跑的业务种子；`migrations/**` 不属于新库初始化步骤，应用启动也不会自动执行迁移。

### 符文基础管理追加迁移

已有 24 表聚合存储库使用 [rune_management.sql](../../db/game_manage/migrations/rune_management.sql)：仅创建三张空表，并在图片来源检查中加入符文及分组，保留原七项。先核对目标库、三表不存在和原约束定义，再由调用方在单事务中执行；脚本不自动提交，重复执行应失败。应用启动不会迁移结构，重启新版服务前必须完成追加迁移。该迁移不重写历史 91 → 24 表脚本，也不改变已有业务行或图片内容。

指定开发库可通过 [VerifyRuneMigration.java](../../tools/authoring/VerifyRuneMigration.java) 执行：参数为后端根目录及`--inspect`；正式追加改为`--apply`并附已审查SQL的SHA256。只读模式输出表、约束、分区和逐表摘要；写模式在同事务锁定现有表，验证24→27、新表为空及原有数据摘要不变后提交。提交结果未知时必须先只读核对，不能重放。验收记录保存在忽略目录`output/rune-management/`，不输出凭据。

符文共享字段、槽位规则、接口和错误含义以 [符文基础管理详细设计](../../../damage_viewer_project_planning/文档记录/详细设计/项目/符文基础管理详细设计.md) 为唯一契约。实现入口为 `RuneService`、`RuneRelationService` 和 `mapper/rune/RuneMapper.xml`；所有写入沿用同游戏保护器，槽位引用由服务在持有游戏写锁时整对象正向校验与反查，未加入五类技能对象的引用索引。删除布局保留符文，删除脱离位置的符文通过外键清挂载，并由服务清其代表图；共享技能和图片保留。

针对性检查：`mvn "-Dtest=RuneServiceTest,RuneRelationServiceTest,RuneMapperTest,RuneSchemaSqlTest,RuneAdminControllerTest,ImageRelationServiceTest,ImageRelationMapperContractTest,ImageRelationAdminControllerTest,SkillRelationMapperTest,LegacyCombatDataCleanupDbContractSqlTest" test`。完成迁移后必须核对实际 27 表结构、公开游戏/图片读取，以及新增、替换、跨游戏和重复引用拒绝、类别占用、删除保留与图片用途回读。上述入口和单测不代表实库迁移或浏览器验收已经完成。

2026-09-09 开发库追加迁移已提交：24→27张逻辑表，原24表逐表数据摘要保持一致，新增三表在提交前核对为空。新版服务通过真实管理接口的11项检查、68次请求，覆盖完整布局替换、重复位置拒绝、碎片跨行复用、引用占用、停用技能既有关系调整及删除保留；临时验收对象全部清理。入口 [verify-rune-management.mjs](../../tools/authoring/verify-rune-management.mjs) 默认只读，显式`--run-fixtures`仅创建和清理固定前缀验收对象，先检查不存在，异常后先查结果与现值。迁移与HTTP记录分别在`output/rune-management/apply-1788891384893.json`和`http-2026-09-08T18-33-31.146Z.json`。903项后端测试通过，随后仅修改技能删除错误文案并通过`SkillServiceTest`；浏览器已保存符文与分组、直接上传图片、重开碎片跨行布局。以上证据不代表全部符文机制或战斗运行完成。

### 来源初始化事件约束升级

已有聚合存储库先核对 `skill_trigger_rules` 的 `ck_skill_trigger_rules_event_type`。旧约束不接受 `SOURCE_INITIALIZED` 时，执行 [source_initialized_event.sql](../../db/game_manage/migrations/source_initialized_event.sql)：单条 `ALTER TABLE` 原子重建同名检查，保留原 21 项并加入初始化事件，不改业务行。执行前后核对目标库、约束定义、已验证状态及规则行数，再通过管理页面保存并独立回读初始化规则；仅重启应用不会升级约束。新库直接使用当前 `schema.sql`。

### 历史 91 表库前置迁移

存储精简阶段的一次性入口是 [skill_aggregate_migration.sql](../../db/game_manage/migrations/breaking/skill_aggregate_migration.sql)。它将五类对象的原明细转换为根对象 JSON，创建引用索引表，并显式删除被吸收的 68 张表，得到 24 张逻辑表；删除语句不使用 `CASCADE`，脚本自身不提交事务。此脚本和 `VerifyAggregateMigration.java` 对应后端提交 `c23c9b3`，使用该阶段的字段和校验器；不能在最新数值取值协议下直接运行旧验收工具。

执行顺序：

1. 核对准确数据库目标、完整备份和 91 表前置结构，保存迁移前聚合接口快照，并停止业务写入。
2. 通过 [VerifyAggregateMigration.java](../../tools/authoring/VerifyAggregateMigration.java) 在同一连接、同一事务中执行主迁移，对照聚合内容、数组顺序、数值、空值、表数及图片内容，并在提交前校验和生成引用索引。任一检查失败则回滚。
3. 结构和数据检查通过后，用新后端回读原有接口，并验证相关新增、修改、删除和引用拒绝行为，再恢复录入。

执行器参数依次为“后端工作树根目录、已核对数据库名、迁移前聚合快照路径、`--apply` 或 `--check`”。它是本次指定开发库的验收工具，带有已核对库名和图片基线限制，不是任意数据库的通用迁移命令。`--apply` 执行迁移；`--check` 跳过结构变更，但仍在事务内重新校验和生成引用索引，不能当作只读检查。

`aggregate_parts/*.sql` 是主脚本已经包含的转换片段，不要分别执行后再执行主脚本。历史 `migrations/compatibility/**`、旧战斗表清理和关系管理迁移仅适用于各自注明的旧版本前置结构，不能作为当前聚合存储库的补表或升级步骤。

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

参与击杀事件 `TAKEDOWN` 使用现有触发聚合和引用保护。共享含义见规划真源《条件事件与动态输入供值管理详细设计》第5.4节；空明细、事件能力、类别条件与循环检查统一处理。已有test0221库使用 [参与击杀事件追加迁移](../../db/game_manage/migrations/takedown_event.sql) 和 `tools/authoring/ApplyTakedownEvent.java` 单次执行器，已独立核对只扩大事件约束，原规则、效果、引用及27表保持。存在执行流水时不得重放，先独立只读核对现状；新库使用当前schema。管理保存不生产战斗事件。

| 资源路径 | 当前边界 |
| --- | --- |
| `/attributes` | 列表、详情、新建、全量修改和启停；不提供 DELETE |
| `/vamp-rules` | 游戏级通用吸血规则完整读取与替换，来源属性、分类及伤害例外在提交前复核 |
| `/characters`、`/equipment` | 角色和装备分别管理，保留各自完整属性配置 |
| `/skill-categories`、`/damage-types` | 单层技能分类与伤害类型，均支持列表、详情、新建、全量修改和删除 |
| `/modifier-zones` | 属性、伤害、治疗、护盾四个业务域的乘区管理 |
| `/statuses` | 状态基本资料；稳定标识与状态种类不可改，名称按去首尾空格、不区分大小写唯一，停用项仍参与唯一校验 |
| `/runes`、`/rune-paths` | 符文身份及分组完整布局管理，按上文唯一契约保存；不提供启停 |
| `/skills` | 技能基本资料；`skillKey` 在同游戏唯一且不可改，名称可重复，`maxLevel >= 1` |
| `/skills/{skillKey}/parameters` | 参数四种取值方式：FIXED、SKILL_LEVEL、CHARACTER_LEVEL、RUNTIME_INPUT |
| `/skills/{skillKey}/formulas` | 表达式节点 OPERATION、PARAMETER、ATTRIBUTE；深度最多 32、节点最多 256，不执行公式 |
| `/skills/{skillKey}/effects` | 效果及完整结果、可选生命周期；已有结果的 `resultType` 不可改 |
| `/skills/{skillKey}/internal-states` | 五种内部状态完整读写；既有种类和范围不可改 |
| `/skills/{skillKey}/processes` | 完整过程读写；普通冷却、效果挂接和内部状态操作至少具备一项 |
| `/skills/{skillKey}/trigger-rules` | 完整事件、条件、动作和动态输入配置；`ruleKey` 创建后不可改 |
| `/images` | 图片列表、详情、新建、全量修改和启停 |

技能分类继续用 `skillCategoryKeys: string[]`，空数组表示未分类，关系保存在 `skill_category_relations`。只有冷却变化和技能急速修正结果可携带 `detail.affectedSkillScope`；模式为 `ALL / SKILLS / CATEGORIES`，多个分类按并集匹配。旧 `detail.affectedSkillKeys` 不接受。

冷却变化新增 `REDUCE_REMAINING_RATIO`（按比例减少剩余冷却），复用结果聚合和数值规则，无数据库迁移。最终写保护检查静态固定值、参数全部等级及动作结果修正后的有效比例；效果、参数或规则修改均会复核。具名公式和计算时传入值保持原有不求值边界，管理保存不执行冷却。唯一数值定义见规划真源《系统精简实施说明》的“剩余冷却比例减少增量”。

伤害修正明细的 `condition`（生效条件）可为空；非空时保存本笔敌方英雄承受者的生命当前比例门槛及严格比较，要求作用于来源对象、造成伤害方向、持续生命周期和防御前伤害乘区。右值使用统一数值取值，固定值、静态参数及可静态求值公式的全部等级都须位于零到一；属性、参数、公式引用与后续修改受提交前保护。管理端只保存、校验和回读，逐笔判定时点以规划真源《管理页面与共性机制迭代计划》的“逐笔生命门槛的最小契约”为准。

生命周期随效果保存和回读，摘要提供 `lifecycleEnabled`。前序结果输入仍为 `sourceActionKey / sourceResultKey / outputKind`，对应效果由服务端从更早的执行效果动作推导。过程允许仅声明有效普通冷却；`cooldown` 为空且 `effectBindings` 与 `stateOperations` 都为空时返回 `400.VALIDATION_FAILED`，后两字段的问题码均为 `PROCESS_BEHAVIOR_REQUIRED`。步骤本身不满足该行为要求，冷却参数或公式仍须通过引用校验。

生命周期操作结果中的 `EXTEND_DURATION` 表示延长目标实例的当前剩余毫秒数。它只能引用同一技能内、不是当前效果、具有期限且采用全部层统一到期的目标；保存时只校验配置，不创建实例、不改变层数或产生满层和提前移除事件。增加值会在固定倍率、上下界修正后检查为有限的非负整数；具名公式和计算时传入值保留到执行时再检查。

收到护盾修正结果 `SHIELD_RECEIVED_MODIFIER` 使用现有效果数组，明细仅有乘区标识 `modifierZoneKey` 和提高/降低 `operation`。必填数值规则按小数比例解释；父生命周期必填，结果必须持续生效，沿用持续数值读取、层数与重施约束，法术护盾阻挡粒度为空。目标是护盾承受者；共享含义由 planning/master 的《系统精简实施说明》“收到普通护盾修正增量”维护。本次保存与读取不执行护盾结算。

护盾范围 `SHIELD` 仅允许比例加算 `RATIO_ADD` 和护盾结果阶段 `SHIELD_RESULT`。新结果纳入乘区与数值引用保护、最终事务复核和聚合读取，无新增业务表。[护盾乘区追加迁移](../../db/game_manage/migrations/add_shield_modifier_zone.sql)已在核定原库单次执行，扩大三条检查约束，原乘区、效果、引用及时间戳保持；提交结果不明时先只读核对，不能重放。新库直接使用当前建表脚本。

治疗乘区计算方式新增 `RATIO_MAX`（比例减少取强），只允许 `HEALING` + `HEALING_RESULT`，现有 `varchar(16)` 列够用，不新表、不改默认值，也不把旧 `RATIO_ADD` 改成取强。引用该乘区的治疗修正必须是 `HEALING_MODIFIER`、`direction=RECEIVED`、`operation=DECREASE`；任意/直接/吸血种类保持原义。效果保存锁出的乘区行带真实 `calculationMode`，同事务按当前目录校验，不按名称猜测。已引用乘区仍以 `409.MODIFIER_ZONE_IN_USE` 禁止改作用域、计算方式或应用阶段；已停用引用策略不变。固定或可静态求值的有效减少比例须有限且在 `[0,1]`，按现有数值规则计算（含倍率与已配置边界），不能把基础值或百分数点直接当最终比例；无法静态求值不补默认。同游戏最终配置检查复用同一套组合规则，不能只靠引用目标存在。独立迁移 [healing_ratio_max.sql](../../db/game_manage/migrations/healing_ratio_max.sql) 只扩大两项现有 CHECK，尚未对实库执行；新库直接使用当前建表脚本。管理保存、单测和静态 SQL 不是运行证明。共享契约以规划真源[管理页面与共性机制迭代计划](../../../damage_viewer_project_planning/文档记录/详细设计/项目/管理页面与共性机制迭代计划.md)第7项（PLAN_REV `authoring-p7-r2`）为准。

普攻计时重置结果 `ATTACK_TIMER_RESET` 继续使用现有效果聚合；明细必须为空对象，数值规则与法术护盾粒度均为空，只允许即时或既有生命周期离散时点。它没有数值输出或字典引用；无生命周期结果仍参与现有结果可用事件与循环检查，不新增攻击或命中事件。无需数据库迁移，不改历史拆表迁移。共享含义由 planning/master《系统精简实施说明》“普攻计时重置增量”维护；管理保存不执行攻击计时。

状态身份及普通减速强度的共享定义见[系统精简实施说明第四单元](../../文档记录/详细设计/项目/系统精简实施说明.md#第四单元状态身份与普通减速强度)。状态种类通过请求、列表和详情完整回读；效果保存锁定状态目录后校验减速数值、期限和持续行为，触发动作不能在减速数值规则外再次修正强度。原有引用提取与动态输入检查继续覆盖顶层数值规则。这里只保存配置，未实现跨来源取强或战斗移动速度计算。

当前建表脚本的状态种类列非空且无默认值。[普通减速身份迁移](../../db/game_manage/migrations/status_kinds_and_slow_strength.sql)严格核对唯一眩晕及其引用，在单事务内回填且保留原正文与时间戳，现值不符或重复执行均拒绝。该迁移已在原库执行并冻结，后续增量不得重放。历史 `compatibility/status_basic_management_migration.sql` 保留原八列基线，不在新结构上重放，也不改写历史字节。真实接口及页面验收仍须基于最终服务另行完成。

状态目录增加 `ROOT`（禁锢），沿用新建必填、创建后种类不可改的规则。禁锢施加和移除均不允许强度数值；本次三个原对象通过父效果的有期限生命周期保存禁锢时长，结果为 `PERSISTENT`（持续生效），数值读取、层数数值、重施数值及周期模式均为空。持续目标状态的法术护盾粒度仍只允许 `RESULT`（当前结果）或空值。共享含义见上述第四单元的“禁锢状态增量”；当前不执行禁锢、韧性、解除或移动技能交互。

已执行普通减速迁移的原库使用[禁锢追加迁移](../../db/game_manage/migrations/add_root_status_kind.sql)，不重放或改写旧迁移与 `ApplyStatusKinds.java`。执行方先核对目标连接及已审查脚本的摘要；脚本验证 `test0221`、旧种类约束、非空且无默认值的列和唯一已核定状态，锁定游戏、状态、效果与引用，在单事务内只扩大检查约束并更新注释。前后完整比较原状态含时间戳、效果和引用；重复执行、结构或现值漂移均报错回滚，不新增状态记录。脚本提交结果未知时先独立只读核对，不能直接重试。新库直接使用当前建表脚本；真实页面首次建立禁锢目录前不通过接口预先录入。

禁锢定向检查：`mvn "-Dtest=StatusServiceTest,SkillMovementSlowServiceTest,StatusBasicManagementSchemaSqlTest" test`。这些服务与静态 SQL 检查不代表实库迁移、页面补录或战斗运行通过。

### 技能挂载与代表图片

`/character-skill-relations`、`/equipment-skill-relations` 和 `/rune-skill-relations` 提供角色、装备、符文与技能的双向查询、新增、排序调整和移除，使用同游戏复合外键。

游戏、角色、属性、装备、符文、符文分组、技能、技能效果和状态通过各自的 `representative-image` 子资源维护代表图片；`/images/{imageKey}/usages` 查询图片用途；`/image-options?keyword=` 查询最多 50 个已启用图片摘要，不含图片内容。图片关联的来源存在性与来源删除清理由服务在上述同游戏写事务中保证。

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

`mvn spring-boot:run` 已把 JDK 的 Unix 域套接字（本机进程通信路径）临时目录固定到模块 `target`。这是 Windows 下 Tomcat 与 Redis 客户端共用的选择器启动前置，避免用户临时目录能够绑定但无法连接时出现 `Unable to establish loopback connection`。该目录属于构建产物，不进入 Git；无需再手工添加 JVM 参数。

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

角色录入检查使用 `GET /api/admin/games/{gameId}/characters/{characterKey}/authoring-check`，在可重复读的只读事务中检查当前角色与直接挂载的技能。报告区分结构错误、人工待核对和未执行的战斗运行；缺失角色或游戏返回 404，读取失败不会返回空的成功报告。它读取现有引用索引并核对完整目标键，不写报告表、不重建引用，也不作为保存或发布门槛。

问题和引用来源必带 `location`（结构化定位），从本次事务读到的原始数组取子项稳定键，保留原 `fieldPath` 仅供说明。类型、父级引用和公式表达式快照用于在重新读取后防止错位；缺失、重复或损坏对象明确降级。存储中的规则 `limits` 包装映射到现有详情的平铺字段，基本字段 `key` 映射到真实对象键；不改引用索引，也不按界面排序反推旧下标。共享字段见规划真源《管理页面与共性机制迭代计划》第8项。

角色检查定向验证为 `mvn "-Dtest=CharacterAuthoringCheckServiceTest,CharacterAuthoringCheckMapperTest,CharacterAuthoringCheckAdminControllerTest" test`。结构检查覆盖原始等级属性图、已读对象基本字段及直接执行入口；不执行公式、战斗机制或跨技能递归分析。 对象型生命周期允许配合空结果数组；结果数组仍必填，无生命周期的空结果仍报错。未接线人工提示与生命周期参数引用检查保留，不以零结果误判合法资格标记。

只修改文档时核对链接、命令和差异，不需要运行 Maven。实现变更先运行受影响测试，功能收尾运行 `mvn test`；配置、依赖或启动装配变化增加 `mvn package`。移除旧类后若出现与源码不符的测试结果，使用 `mvn clean test` 清除旧编译产物。

当前聚合存储与引用保护的针对性入口：

```powershell
mvn "-Dtest=LegacyCombatDataCleanupDbContractSqlTest,SkillParameterFormulaManagementDbContractSqlTest,SkillEffectAggregateStorageTest,SkillObjectReferencesTest,GameConfigurationWriteGuardTest,SkillNumericValueTest,SkillNumericSemanticsTest" test
```

数据库结构或公共读取变化后，对最终服务验证 `GET /api/games`、受影响图片接口和相关管理读写；同时检查删除根对象、移除被引用子项的拒绝行为，以及失败事务没有留下局部修改。旧 `/combat-data/**`、版本查询和发布别名应返回普通 404。

[verify-aggregate-api.mjs](../../tools/authoring/verify-aggregate-api.mjs) 用于将管理接口回读与迁移前快照比较；[verify-aggregate-crud.mjs](../../tools/authoring/verify-aggregate-crud.mjs) 是本轮复制演练服务的新增、修改、删除与引用保护验收工具，运行前核对其固定目标和隔离测试标识。

静态 SQL 检查、单测、复制库迁移、真实 HTTP 和浏览器验收分别提供不同层面的证据；单测通过或应用启动成功不能替代原库迁移和真实页面验收。发现旧明细表查询错误时，应核对实际数据库是否已迁移、服务是否使用当前编译产物，不要重新创建已吸收的旧表。

沉默状态增量：目录追加 `SILENCE`（沉默），创建后种类不可改；施加和移除均复用无强度状态操作，期限由技能效果生命周期维护，当前结果法术护盾粒度沿用既有规则。共享含义见规划真源《系统精简实施说明》的“沉默状态增量”，不实现施法限制、引导中断或解除结算。

已核定的原库使用 [add_silence_status_kind.sql](../../db/game_manage/migrations/add_silence_status_kind.sql) 追加种类约束；[ApplySilenceStatusKind.java](../../tools/authoring/ApplySilenceStatusKind.java) 固定主机、数据库和已审查SQL摘要，并用新建流水拒绝重放。它仅修改约束与注释，核对原三条状态含时间戳、970个效果和9331条引用，再比较事务前后原数据。执行结果不明时先独立只读恢复，不能直接重试；旧迁移和旧执行工具保持原字节。首次新增沉默目录使用最终服务的真实页面。

魅惑状态增量：目录增加 `CHARM`（魅惑），无强度状态操作、种类不可改和来源与承受对象实例关联沿用既有结构。具体移动速度、中止与重施分别依据来源；共享定义以规划真源《系统精简实施说明》的“魅惑状态增量”为准，本模块不执行魅惑行动控制。

已有test0221库的魅惑种类约束使用 [本次追加SQL](../../db/game_manage/migrations/add_charm_status_kind.sql) 与 `tools/authoring/ApplyCharmStatusKind.java` 单次执行器。先按当前基线预检和独立批准摘要，执行日志为 `output/charm-status-preflight/migration-attempt.jsonl`，存在任何尝试记录都先查现状；不得重放旧状态迁移。写后另启只读连接确认四条原状态、效果、引用和27表保留，再通过页面建立魅惑目录。

### 首次目标接触判定

事件值 `SKILL_HIT_FIRST_CONTACT`（本次使用首次目标接触）复用事件值比较与动态绑定，只允许技能命中事件，保存与事务最终配置复核均检查。整数来源可绑定整数或十进制参数；管理明细不接受实际值或默认值字段，无数据库迁移。实际0/1、完整接触历史、使用归属及缺值边界以规划真源《系统精简实施说明》的“首次目标接触判定增量”为准。本模块不生成接触记录，既有HIT_INDEX仍表示从1开始的单次或重复步骤命中序号。

### 击飞状态增量

状态种类增加击飞（`AIRBORNE`），复用现有无强度状态施加和移除；创建后种类不可改，引用保护及事件关系仍按状态标识处理。具体生命周期以来源为准，不为整个种类额外限定持续生效或有限期限。唯一共享含义见规划真源《系统精简实施说明》的“击飞状态增量”。

已有 test0221 库使用 [约束增量](../../db/game_manage/migrations/add_airborne_status_kind.sql) 与 [单次执行器](../../tools/authoring/ApplyAirborneStatusKind.java)。执行器核对独立批准的文件散列、完整只读基线和固定目标，先建尝试记录再执行；已有记录或提交结果不明时先独立核对，不能重放。仅追加约束与注释，不创建状态条目。首次新增击飞目录与科加斯Q返回须经真实页面；隔离模拟页面不代替该项验收。
