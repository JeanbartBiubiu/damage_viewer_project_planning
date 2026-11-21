# 现行入口与变更核对

同次伤害结果的单向法盾跟随声明见[当前字段与保存边界](spell-shield-follow.md)，生产形状放在现有伤害明细中；采用前仍核对运行服务和实际完整对象。

核对基准日期：2026-10-17。下列路径用于定位真源，不替代当前请求类型；均相对仓库根目录。

场景显式初值声明于2026-10-18追加，见文末当前约束；写入前仍核对实际服务已部署该类型。

状态初值与普攻减少弹药回充于2026-10-19追加，见文末相应入口；源码修改不代表运行中的服务已更新。

| 对象 | 前端契约真源，相对 `web/` | 后端真源，相对 `server/data_manage/src/main/java/xyz/game/datamanage/` |
| --- | --- | --- |
| 技能完整配置 | `src/services/skillConfigurationClient.ts`、`src/types/skillConfiguration.ts`；各组成的类型与表单转换 | `controller/adminapi/skill/SkillConfigurationAdminController.java`、`model/skillconfiguration/SkillConfigurationSaveRequest.java`、`service/skillconfiguration/SkillConfigurationService.java` |
| 角色、等级属性与技能关系 | `src/services/characterClient.ts`、`skillRelationClient.ts`及对应类型 | `controller/adminapi/character/`、`controller/adminapi/skillrelation/CharacterSkillRelationAdminController.java`及`model/character/` |
| 装备、直接属性与技能关系 | `src/services/equipmentClient.ts`、`skillRelationClient.ts`及对应类型 | `controller/adminapi/equipment/`、`controller/adminapi/skillrelation/EquipmentSkillRelationAdminController.java`及`model/equipment/` |
| 构筑系统与选项 | `src/services/buildClient.ts`及`src/types/build.ts` | `controller/adminapi/build/`与实际服务；按当前映射定位 |
| 计算可用目录 | `src/services/simulationAvailabilityClient.ts`及`src/types/simulationAvailability.ts` | `controller/adminapi/simulation/SimulationAvailabilityAdminController.java`、`service/simulation/availability/` |

读取技能聚合使用`GET /api/admin/games/{gameId}/skills/{skillKey}/configuration`。修改已有技能使用同一路径的`PATCH`，顶层为`baseDigest`、可选的`skill`、`changes`；配套脚本接受同一形状。`skill`提供完整`name / description / maxLevel / status / sortOrder / skillCategoryKeys`，不带`skillKey / gameId / createdAt / updatedAt`，未改字段按冻结基线保留。每项组成变化为`objectType / operation / key / value`，脚本支持六种组成的`CREATE / UPDATE / DELETE`；`value`使用完整请求类型，不带所属对象和时间戳。`CREATE`带与`key`一致的组成标识，`UPDATE`不带标识。仅修改主体时`changes`可为空；未提供主体时至少有一项组成变更。完整规则的未变动作、条件、保护配置仍保留。

| objectType | 组成标识 | 完整读取集合 |
| --- | --- | --- |
| `PARAMETER` | `parameterKey` | `parameters` |
| `FORMULA` | `formulaKey` | `formulas` |
| `EFFECT` | `effectKey` | `effects` |
| `PROCESS` | `processKey` | `processes` |
| `INTERNAL_STATE` | `stateKey` | `internalStates` |
| `TRIGGER_RULE` | `ruleKey` | `triggerRules` |

冻结计划中的 `sourceEvidence[].path` 相对计划文件所在目录解析；先核对每个实际文件和摘要，再运行只读预检。它不以当前命令所在的仓库目录为基准。

新建技能的同路由`POST`要求完整主体且不允许基线摘要，不能将更新请求改方法后直接复用。配套脚本不执行技能新建或删除技能主体。六类组成的`DELETE`须有授权，提供原目标键及明确的`value: null`；同批清理必要引用，完整预期移除对应组成。只读候选核对完整最终聚合的本地引用，外部引用仍由场景闭包解析，正式保存重新检查完整引用和并发保护。结构删除仅走开发候选，自动候选不接受。角色、属性、关系及构筑各有自己的保护与返回形状，先读对应客户端与后端，不能套用技能的摘要协议。

过程的冷却起点、效果挂接、状态操作时点，以及 `PROCESS_MOMENT` 事件的 `detail.moment`，均使用后端 `SkillProcessMoment`：回读会省略空 `failureReason`，前端解析为 `null`；保护脚本仅在这四处把缺失与空失败原因视为相同。明确失败原因及其它嵌套业务字段仍完整比较，不递归忽略空值。

步骤的`processes[].steps[].occupiesAction`也仅在缺省与显式`null`间视为同义：后端`SkillProcessStepRequestDeserializer`把两者均读为可空布尔值，`SkillProcessStepResponse`回读为`null`。保护脚本在完整业务比较中仅规范该路径的空值，明确`false / true`仍有业务含义，不作为默认值删除；同名字段出现在步骤明细、效果、动作或其它未知路径时继续严格比较。实际PATCH正文保留冻结计划，不改成补空字段的请求。

过程的三个嵌套集合在`SkillProcessService.writeSteps / writeBindings / writeOperations`中按`sortOrder`、再按各自`stepKey / bindingKey / operationKey`稳定排序存储。生成本次过程写入的请求及完整预期时，显式使用这一存储顺序；保护脚本仍严格比较实际数组顺序，不全局重排来隐藏业务变化。保存后只有顺序不同也先独立回读、核对源码与全部字段；确认已落地后用有来源证据的新候选跳过该对象，不重放PATCH。未修改的嵌套数组按原完整基线保留。

上述限定比较由同一`businessConfiguration / sameConfiguration`入口用于计划的PATCH投影、写前基线守护、已落地跳过及独立回读。完整当前业务内容同义于候选时，即使摘要已变化，也只记录已落地而不再次PATCH；不能全局递归删空值、忽略明确失败原因或屏蔽其它未知字段。候选与业务数据不符合这些已核实的DTO路径时仍按原规则阻断。

以下入口均以`/api/admin/games/{gameId}`为前缀，当前请求不接受`baseDigest`。更新前比较完整基线，更新后独立读取；这些入口不能使用触发规则脚本。

| 对象 | 当前读取与写入 | 请求边界 |
| --- | --- | --- |
| 角色主体 | `GET /characters/{characterKey}`；集合`POST`新建，单项`PUT`修改 | 新建含`characterKey / name / description`，修改仅`name / description` |
| 角色等级属性 | `GET /characters/{characterKey}/attributes`；同路径`PUT` | `{levelValues}`完整替换等级属性图；保留所有原属性和等级，不能只提交本次变化单元 |
| 装备主体 | `GET /equipment/{equipmentKey}`；集合`POST`新建，单项`PUT`修改 | 新建含`equipmentKey / name / description`，修改仅`name / description` |
| 装备属性 | `GET /equipment/{equipmentKey}/attributes`；同路径`PUT` | `{attributeValues}`完整替换属性图；未提交原属性不会自动保留 |
| 角色、装备技能关系 | `GET /character-skill-relations?characterKey=...`或`/equipment-skill-relations?equipmentKey=...`；集合`POST`挂载，单项`PUT /{所属对象键}/{skillKey}`调序 | 挂载提供所属对象键、`skillKey / sortOrder`；修改仅`{sortOrder}`，不能改为另一条关系 |

构筑完整读取为`GET /build-systems/{systemKey}/definition`；系统、分组、选项和技能授予分别沿当前控制器写入，完整读取不是整套保存入口。本技能不自动删除任何对象或关系；数据删除继续按任务授权与引用保护处理。

### 场景属性快照绑定

运行时输入新增 `SCENE_ATTRIBUTE_SNAPSHOT`（场景属性快照），字段与消费约束以[当前共享契约](../../../../contracts/authoring/有限引导与场景属性快照现行契约.md)为准，写入类型由后端 `model/skilltrigger/SkillTriggerSceneAttributeSnapshotBindingDetail.java` 定义。它仍是动作的 `runtimeInputBindings`，不新增聚合顶层字段或保存接口，也不写角色或装备属性。

录入前核对参数确为本技能无默认值的计算时输入、真实首次主动入口启动的过程确实消费它、属性引用存在且启用。来源须显式选择；仅装备来源不要求角色等级基值存在，合法0不能当作缺失。管理保存只证明作者绑定正确，实际等级和装备取值、整数约束以及圈数等结果仍须在正式Wasm验证。不要在录入时把本次采集数值改写成固定参数，也不通过填0绕过缺值。

现有聚合脚本保留该嵌套结构并提交服务校验，保护摘要和独立回读步骤不变。准备保存前需确认8080服务已经运行含新增来源的构建；旧服务拒绝新枚举时先完成已授权服务集成，不换成其它来源蒙混保存。

### 管理接口认证

认证接线于2026-11-13调整：身份、会话和批次统一以[维护契约](../../../../contracts/maintenance/README.md)为准。写入要求有效的独立维护会话、同一会话的防伪值、服务允许的维护来源及已验证批次；普通玩家会话不能维护配置。脚本不自行登录、不提取浏览器凭据，也不修改后端权限，缺少维护会话时先由受控宿主建立。

在当前进程提供以下环境变量，具体值不进入命令参数、冻结计划、证据或输出：

| 环境变量 | 内容 |
| --- | --- |
| `DAMAGE_AUTHORING_SESSION` | 当前独立维护会话的 `__Host-damage-maint-session` 原始值，43位网址安全编码字符 |
| `DAMAGE_AUTHORING_CSRF` | 同一维护会话的 `__Host-damage-maint-csrf` 防伪值，格式同上 |
| `DAMAGE_AUTHORING_ORIGIN` | 服务已允许的页面来源地址，仅含协议、主机和可选端口；不能包含凭据、路径、查询或片段 |
| `DAMAGE_AUTHORING_BATCH` | 正式写入时必需，已验证并登记、处于维护窗口内的批次 UUID；它不是身份凭据 |

脚本发送这两个 Cookie（会话凭据）、`Origin`（请求来源）与 `X-Damage-Client: web`；`PATCH` 同时发送 `X-CSRF-Token`（防伪请求头）及 JSON 内容类型，不发送旧 `Authorization: Bearer`。默认只读检查也先核对这三项输入，但不据此证明会话有效或可以写入；实际有效性由服务校验。会话过期、权限或来源拒绝时保留独立回读并停批，不自动登录、降级认证或重放写入。

遇到字段、枚举、数组结构或协议变化时，依次核对控制器与请求类型、聚合准备和事务校验、前端保存转换、完整回读形状，以及运行适配中的实际消费者。更新本说明和脚本的输入校验，并至少复查正常保存、摘要漂移及结果不明回读三个场景。旧冻结请求是来源与历史证据，不能无条件直接重放。

项目范围继续以`数据参考/全量录入-2026-09/阶段进度.json`为唯一账本；Excel原有49名英雄，明确排除8名后的当前范围为41名，逐槽排除与完整对象证明分别核对。计算可用目录中的证明资源只接收真实验证产物，数据补录脚本不得手工提升可用状态。

### 有限自身属性最终上界

`ATTRIBUTE_CHANGE.detail.operation=LIMIT_MAX` 表示普通属性的最终上界，`modifierZoneKey` 必须为 `null`；作用对象为自身、不能是生命属性、盾关联或法术盾结果。数值必须在所声明等级下静态、有限，生命周期限有限自身单层、保持层数、刷新全部、同时到期且无周期。形状由 `AttributeFinalLimitSemantics.java` 与 `SkillNumericSemantics.java` 共用校验，不新增数据库列。

本轮自然触发的实时多属性组沿 `MOMENT_EVALUATION/SHARED`，上界与同组属性共用实例；宿主编译为既有属性修正的 `stage=final/valuePolicy=min`。普通与派生乘算完成后才夹取，低于上界时保留原值。保存仍走原聚合、摘要保护和独立回读；该能力不内置普通攻速2.5，也不由单一组件对照授予整技能可用。

### 普攻伤害角色

伤害结果的 `detail.attackDamageRole` 可省略；显式提供时只能为 `PRIMARY`（普通攻击主体）或 `REPLACE_PRIMARY`（强化待击替换主体）。空值、数字、未知值和非伤害结果均拒绝，不给普通伤害补空字段。后端请求真源为 `SkillEffectDamageDetail.java`；保存与聚合回读必须保留该字段。角色效果可先保存为尚未挂接的资料，但真实消费点、完整事务最终态以及宿主所选普通攻击还需分别校验，不能由字段存在直接判定可计算。替换负载只含一个无条件、即时目标伤害；普通主体所在作者效果可以保留其它无角色结果。结构边界以[正式共享契约](../../../../contracts/authoring/崔斯特普攻主体替换与三牌契约.md)为准。采用前核对运行服务确实含新字段，不能向旧服务盲目重试。

### 当前时点普通减速

普通减速可声明`PERSISTENT/MOMENT_EVALUATION/SHARED`，重施数值方式为空。只接独立单结果的`STATUS_OPERATION/APPLY`及真实`MOVEMENT_SLOW`目录，有限正安全整数期限、`SOURCE_TARGET`分组、单层`KEEP/REFRESH_ALL/ALL_AT_ONCE`，无周期、关联盾结束或独立法盾粒度。强度只读取本实例`effect_elapsed_ms`和冻结静态参数；公式全部声明及条件各分支均检查，不能夹带当前属性、外来上下文或运行输入。

新模式`fixedMinValue`、`fixedMaxValue`必须为空；固定倍率须有限且非负、静态原值须有限，防止零乘法掩盖溢出，最终强度须在0至1之间。旧施加快照继续使用原0/1界限。原生状态贡献仅新模式显式输出`valueReadMode:MOMENT_EVALUATION`，旧快照继续省略；管理配置、原生运行及整对象准入分别验证。完整约束见[Q落地减速契约](../../../../contracts/authoring/科加斯Q落地减速实施契约.md)。

### 场景显式初值绑定

`SCENE_INITIAL_PARAMETER`（场景显式初值）的必需明细为 `{minValue, maxValue}`，上下界必须是有限数且有序；整数参数的边界必须为安全整数，通用负范围可以合法。它在本技能 `SOURCE_INITIALIZED / EXECUTE_EFFECT / EVENT_SOURCE` 动作绑定无默认的数值 `RUNTIME_INPUT` 参数，且参数必须被本动作真实结果数值消费。另可由明确本技能 `SKILL_USED / ACTIVE / INITIAL → START_PROCESS` 绑定，但只授权唯一真实主动过程的步骤执行伤害负载金额；费用、冷却、时间、生命周期、条件和状态操作不能借用该授权。实际本场值不写进声明、参数固定值、角色属性或数据库；界面另行明确填写，缺值不默认为0。

明细可选 `sharedInputKey`（共享输入标识），省略仍保留旧形状，显式空值或非法标识拒绝。同场景只有同游戏、同方、同实际角色及同共享标识的真实启用成员可合并一个输入，各成员仍保留本技能参数与实际消费声明；类型与边界必须一致。后端保存声明，宿主核验真实角色、成员闭包和输入身份，不在数据库保存本场值。常驻生命及有限多次强化的当前边界见[科加斯E/R共享契约](../../../../contracts/authoring/科加斯E与R通用机制实施契约.md)。

请求类型为后端 `SkillTriggerSceneInitialParameterBindingDetail.java`。同一初值可被两个实际初始化动作分别绑定、派生不同属性，边界须一致，来源和双方位置仍独立。保存、事务最终态及引用保护使用现有聚合接口和脚本，未知明细（含空的 `value / defaultValue`）也拒绝。运行与证据边界见[通用实施方案](../../../../contracts/authoring/场景显式初值参数实施方案.md)。

`EMPOWERED_BASIC_ATTACK` 步骤明细可选 `maximumAttackCountValue`（最多消费次数），只用于明确不占行动的单步骤主动过程及 `ATTACK_START`（普攻发动消费），次数须可静态求为1至64整数，窗口须为正安全整数毫秒。缺省保持原单次 `ATTACK_HIT`（命中消费）形状，显式空次数拒绝。该字段保留在现有过程明细JSON中，无新增枚举或表；引用公式继续纳入事务最终态与删除保护。写入成功不代替发动预留、延迟命中、窗口结束冷却及正式Wasm验证。

### 状态初值与逐枚回充

`COUNTER / AMMO` 的 `detail.initialValueBinding`、以及 `AMMO` 的 `detail.initialRemainingMsBinding` 是状态字段自己的可选初值声明，不放入触发动作。两者均复用 `SCENE_INITIAL_PARAMETER` 绑定形状，对应的 `initialValue / initialRemainingValue` 必须直接引用相同的本技能无默认整数参数。范围限于 `SKILL` 状态及有序的非负安全整数边界；字段缺省时保持缺省，不自动补 `null`、0 或空声明。后端请求真源为 `SkillInternalStateCounterDetail.java / SkillInternalStateAmmoDetail.java`。

`initialRemainingValue` 使用毫秒，只适用于 `ONE_BY_ONE / AFTER_CONSUME`；欠弹必须有明确余时，满弹仅允许不提供余时或明确0。每个实际场景的库存、余时和循环位置由使用者填写，不把学习时库存当成战斗初值，不改写参数默认值。管理保存还需核对容量、时长与声明引用，真正的场景值及单发冷却、回充执行由宿主和正式Wasm验证。

`MODIFY_INTERNAL_STATE` 的明细为 `{stateSkillKey, stateKey, operation: 'REDUCE_RECOVERY', value}`，请求真源为 `SkillTriggerModifyInternalStateActionDetail.java`。它只允许本技能 `BASIC_ATTACK_HIT / EVENT_SOURCE` 修改自身 `SKILL / AMMO` 的下一枚回充余时；`runtimeInputBindings / resultModifiers` 均为空。金额使用现行数值引用，不增加库存、不改变单发冷却、不借用辅助过程。其它动作的事件来源和输入授权保持原约束。

每发循环沿现有 `START_PROCESS` 的 `INTERNAL_STATE / VALUE` 绑定读取本技能整数计数器，仅在 `PROCESS_START / COUNTER / SET` 使用相应动态值及已核验公式。应先冻结本次序号再推进下一发，命中条件读取冻结状态；不新增过程算子或用一个效果假装扣弹。完整边界及验证真源见[作者与宿主实施契约](../../../../contracts/authoring/库奇R作者与宿主实施契约.md)，执行前核对实际部署版本。

### 有期指定技能冷却时长倍率

`COOLDOWN_DURATION_MODIFIER`（冷却时长修正）的`detail`只接受`{affectedSkillScope:{mode:'SKILLS',skillKeys:[...],skillCategoryKeys:[]}}`，指定技能非空、合法、无重复且属于同游戏；不接受其它范围、`operation`、未知字段、类型转换或显式空明细。请求真源为`SkillEffectCooldownDurationModifierDetail.java`及其严格反序列化分派。效果须为有限SOURCE单层、保持层数并刷新全部、同时到期、无周期/盾关联，结果为PERSISTENT/APPLICATION_SNAPSHOT/SHARED/REPLACE且不消费法术盾。完整数值规则在各声明等级最终都须静态、有限且严格大于0；0.5表示时长一半，1合法。参数、公式、生命周期与范围引用后续修改仍需通过事务最终态守卫。

该结果沿现有`results`数组完整保护保存和独立回读；不写数据库新列、不冒充技能急速或剩余冷却操作。管理层可保存合法资料；实际本场INITIAL能力、关闭/未学/未计划的零匹配，以及只作用未来新提交冷却，仍由宿主和正式Wasm证明。见[共享实施方案及接线澄清](../../../../contracts/authoring/内瑟斯通用机制共享实施方案.md)。执行前核对真实服务已安装支持该类型的版本；接口保存成功不能直接开放英雄。

### 持续属性的明确护盾依赖

2026-10-21追加：`ATTRIBUTE_CHANGE` 的 `detail.requiredShield` 可缺省；存在时只接受 `{skillKey, effectKey, resultKey}` 三个明确标识，不接受空值或未知字段。它表示属性随同拥有者指定普通盾持续存在，不能用一次事件的生命周期条件替代。请求真源为 `SkillEffectAttributeChangeDetail.java`，最终守卫为 `ShieldAttributeDependencySemantics.java` 和 `SkillNumericSemantics.java`。

当前作者形状限独立单结果、自身无期限单层、共享持续非生命属性，使用 `PERSISTENT/MOMENT_EVALUATION/SHARED`，不声明重施取值、周期或法术盾资格；数值在全部声明等级须静态、有限且非负。引用须指向同游戏明确的自身关联普通盾，纳入反向引用和后续修改／删除保护。读取盾定义不会启用关闭或零级的来源，实际同拥有者挂载及依赖属性的零挂载由宿主验证。

目标持续属性可声明 `RESULT/EFFECT/SKILL` 的普通法术盾资格，继续拒绝 `DAMAGE_INSTANCE` 与自身结果消费。双端命中属性的来源结果保持空资格，并由完整单候选共享目标结果的实际命中与阻挡结果；不得拆成两次独立保存来绕过完整图检查。

仍使用现行聚合 `PATCH` 和保护脚本。脚本对嵌套明细完整保留，无须新增顶层字段；采用前核对服务已安装该类型，并按冻结计划、当前摘要和独立完整回读核对。共享契约与当前范围见[墨菲特数值适配契约](../../../../contracts/authoring/墨菲特数值适配契约.md)，该契约的验收段不代替实际运行证据。

### 分阶段命中与普攻开始计数

2026-10-21追加：技能实际命中事件的明细可显式声明 `processMoment`，将本技能首次主动过程的真实步骤映射为独立接触，并声明同次使用的前置接触。字段、依赖图、法盾范围及完整提交语义只在[分阶段命中与攻击起始状态契约](../../../../contracts/authoring/分阶段命中与攻击起始状态契约.md)定义。请求真源为 `SkillTriggerSkillHitProcessMoment.java`，最终态检查为 `SkillHitPhaseSemantics.java`；完整聚合保存后的 `validateAffectedConfigurationFinal` 也必须复核，单规则保存通过不能代替它。

普攻开始和命中事件可对本技能、技能范围整数计数声明 `ATTACK_START_VALUE`，实际场景沿同次攻击的起始快照读取；原弹药资格与运行输入绑定边界保持现行规则。共同作者资格真源为 `SkillAttackStartValueSemantics.java`。这些事件的自身数值结果使用合法的 `CURRENT_TARGET` 动作上下文，并由结果的 `SOURCE` 目标明确作用自身，不能擅自填写事件能力没有开放的 `EVENT_SOURCE`。

仍使用同一聚合保护保存脚本，嵌套明细完整保留，未提供的可选声明不补空值。服务与事务守卫、宿主和正式Wasm均安装支持后才采用；拒绝或超时先独立回读，只有证实未落地且修复真实原因后才重新采用。管理回读、机制回归、首次英雄验收与可用目录分别留证。

### 指定自身普通盾的本笔吸收量

事件值比较明细新增可选`shieldResult`（指定自身盾结果），仅用于受到伤害事件的吸收量条件。完整字段、同技能自身盾要求、逐盾冻结事实及复制组合边界以[首次自身损盾实施契约](../../../../contracts/authoring/墨菲特P首次损盾实施契约.md)为唯一来源。请求真源为`SkillTriggerEventValueConditionDetail.java`，最终图守卫为`SkillShieldAbsorptionConditionSemantics.java`；省略该键与显式空值含义不同，不能补null或猜一面默认盾。

仍使用现行聚合`PATCH`及保护脚本，触发规则的嵌套明细完整保留，无新增顶层字段或脚本分支。写前确认真实服务已安装新类型，冻结完整原规则、候选和用户已确认的计时选择；只修改核定条件组，原动作、等待时长、到期保护及兄弟技能保持。先前完成的补盾主体不因新选择器而重做，写后独立核对完整配置；管理保存不代表首次损盾分支或整英雄已通过正式运行。

### 保留相位的目标周期与逐伤前值

2026-10-22追加：`TARGET / COUNTER` 的可选 `detail.targetTiming`（目标计时声明）采用严格分型，只有周期跳伤 `PHASED_TICK` 和到期负载 `EXPIRY_PAYLOAD` 两种。字段、纯过程限制、最多三周期加一预约、有界到期动作与唯一存活尾规则，只在[有界目标时序共享契约](../../../../contracts/authoring/有界目标时序共享契约.md)定义。声明省略时保持原形状，显式空值和未知字段拒绝；不导入旧计时器。请求真源为 `SkillInternalStateTargetTiming.java`，最终图与引用检查为 `SkillTargetTimingSemantics.java`。

`MODIFY_INTERNAL_STATE` 新增 `ENSURE_REMAINING_PRESERVE_PHASE`（保留原跳伤时点续期），仅在实际未被挡住的明确技能命中上修改自身周期锚；原 `ENSURE_REMAINING` 不接受任何目标计时锚。到期过程完成写入和存活重挂尾统一使用 `PROCESS_COMPLETE` 且 `stepKey` 为空，不用步骤完成时点替代。完整图保存在同一笔技能聚合修改中，避免分次写入产生缺少过程或尾规则的中间态。

内部状态条件新增 `DAMAGE_BEFORE_VALUE`（本笔伤害前值），仅用于自身普通目标计数的实际造成伤害事件，不读取周期或预约锚，不用于运行输入绑定。引擎按每一笔真实伤害冻结前值，再沿实际伤害标识执行致死恢复；不能用结算后的状态或一次使用去重替代。保护脚本仍完整保留嵌套字段，无新增请求顶层或认证方式。采用前核对服务、适配器和正式Wasm支持同一契约；管理保存、固定机制、真实技能组合及完整英雄准入各自留证。

### 同角色技能命中的目标计数只读条件

实际已计划的自身主动技能命中规则，可用现有 `INTERNAL_STATE_CHECK`（内部状态检查）读取同一来源角色真实技能关系中的另一技能普通目标计数。须明确所属技能、状态标识、`VALUE`（当前值）与非负整数阈值；状态需零初值、非负整数容量、正整数期限。周期锚、预约锚、跨技能写入和运行输入绑定不适用；同一规则不能混读自身状态或第二个供值技能。关闭场景来源或零级来源只读取合法定义，不生成挂载或执行入口；启用却未装配的来源仍拒绝。完整边界见[同拥有者命中前计数读取契约](../../../../contracts/authoring/同拥有者命中前计数读取契约.md)。

作者层效果时点使用 `APPLICATION`（施加时）等现行枚举；`INSTANT`（即时）属于降低后的引擎语义，不能填进管理请求的 `lifecycleBehavior.moment`。例如有限目标眩晕可以沿施加时操作建立1750毫秒状态，声明技能级法术护盾；若声明持续结果，其法盾资格按持续结果门禁另行核对。
