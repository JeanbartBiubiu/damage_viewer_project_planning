# 现行入口与变更核对

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

读取技能聚合使用`GET /api/admin/games/{gameId}/skills/{skillKey}/configuration`。修改已有技能使用同一路径的`PATCH`，顶层为`baseDigest`、可选的`skill`、`changes`；配套脚本接受同一形状。`skill`提供完整`name / description / maxLevel / status / sortOrder / skillCategoryKeys`，不带`skillKey / gameId / createdAt / updatedAt`，未改字段按冻结基线保留。每项组成变化为`objectType / operation / key / value`，脚本支持六种组成的`CREATE / UPDATE`；`value`使用完整请求类型，不带所属对象和时间戳。`CREATE`带与`key`一致的组成标识，`UPDATE`不带标识。仅修改主体时`changes`可为空；未提供主体时至少有一项组成变更。完整规则的未变动作、条件、保护配置仍保留。

| objectType | 组成标识 | 完整读取集合 |
| --- | --- | --- |
| `PARAMETER` | `parameterKey` | `parameters` |
| `FORMULA` | `formulaKey` | `formulas` |
| `EFFECT` | `effectKey` | `effects` |
| `PROCESS` | `processKey` | `processes` |
| `INTERNAL_STATE` | `stateKey` | `internalStates` |
| `TRIGGER_RULE` | `ruleKey` | `triggerRules` |

新建技能的同路由`POST`要求完整主体且不允许基线摘要，不能将更新请求改方法后直接复用。配套脚本不执行技能新建或任何删除。角色、属性、关系及构筑各有自己的保护与返回形状，先读对应客户端与后端，不能套用技能的摘要协议。

过程的冷却起点、效果挂接与状态操作时点中，后端`SkillProcessMoment`会省略空`failureReason`，前端解析为`null`；保护脚本仅在这三处把缺失与空失败原因视为相同。明确失败原因及其它嵌套业务字段仍完整比较，不递归忽略空值。

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

运行时输入新增 `SCENE_ATTRIBUTE_SNAPSHOT`（场景属性快照），字段与消费约束以[当前共享契约](../../../../outputs/priority-adaptation-2026-10-18/有限引导与场景属性快照现行契约.md)为准，写入类型由后端 `model/skilltrigger/SkillTriggerSceneAttributeSnapshotBindingDetail.java` 定义。它仍是动作的 `runtimeInputBindings`，不新增聚合顶层字段或保存接口，也不写角色或装备属性。

录入前核对参数确为本技能无默认值的计算时输入、真实首次主动入口启动的过程确实消费它、属性引用存在且启用。来源须显式选择；仅装备来源不要求角色等级基值存在，合法0不能当作缺失。管理保存只证明作者绑定正确，实际等级和装备取值、整数约束以及圈数等结果仍须在正式Wasm验证。不要在录入时把本次采集数值改写成固定参数，也不通过填0绕过缺值。

现有聚合脚本保留该嵌套结构并提交服务校验，保护摘要和独立回读步骤不变。准备保存前需确认8080服务已经运行含新增来源的构建；旧服务拒绝新枚举时先完成已授权服务集成，不换成其它来源蒙混保存。

认证沿现有管理接口；不得修改鉴权或借用他人的令牌。当前本地开发文档允许任意非空测试值，仅在确认当前服务仍为该模式时使用；不得把这个约定带到其他环境。

遇到字段、枚举、数组结构或协议变化时，依次核对控制器与请求类型、聚合准备和事务校验、前端保存转换、完整回读形状，以及运行适配中的实际消费者。更新本说明和脚本的输入校验，并至少复查正常保存、摘要漂移及结果不明回读三个场景。旧冻结请求是来源与历史证据，不能无条件直接重放。

项目范围继续以`数据参考/全量录入-2026-09/阶段进度.json`为唯一账本；本次五批为49名英雄。计算可用目录中的证明资源只接收真实验证产物，数据补录脚本不得手工提升可用状态。

### 普攻伤害角色

伤害结果的 `detail.attackDamageRole` 可省略；显式提供时只能为 `PRIMARY`（普通攻击主体）或 `REPLACE_PRIMARY`（强化待击替换主体）。空值、数字、未知值和非伤害结果均拒绝，不给普通伤害补空字段。后端请求真源为 `SkillEffectDamageDetail.java`；保存与聚合回读必须保留该字段。角色效果可先保存为尚未挂接的资料，但真实消费点、完整事务最终态以及宿主所选普通攻击还需分别校验，不能由字段存在直接判定可计算。替换负载只含一个无条件、即时目标伤害；普通主体所在作者效果可以保留其它无角色结果。结构边界以[正式共享契约](../../../../outputs/priority-adaptation-2026-10-18/twistedfate-next/w-implementation-2026-10-19/共享实施契约.md)为准。采用前核对运行服务确实含新字段，不能向旧服务盲目重试。

### 场景显式初值绑定

`SCENE_INITIAL_PARAMETER`（场景显式初值）的完整明细为 `{minValue, maxValue}`，上下界必须是有限数且有序；整数参数的边界必须为安全整数，通用负范围可以合法。它只在本技能 `SOURCE_INITIALIZED / EXECUTE_EFFECT / EVENT_SOURCE` 动作绑定无默认的数值 `RUNTIME_INPUT` 参数，且参数必须被本动作真实结果数值消费。生命周期、条件、过程和主动兄弟不得借用该授权。实际本场值不写进声明、参数固定值、角色属性或数据库；界面另行明确填写，缺值不默认为0。

请求类型为后端 `SkillTriggerSceneInitialParameterBindingDetail.java`。同一初值可被两个实际初始化动作分别绑定、派生不同属性，边界须一致，来源和双方位置仍独立。保存、事务最终态及引用保护使用现有聚合接口和脚本，未知明细（含空的 `value / defaultValue`）也拒绝。运行与证据边界见[通用实施方案](../../../../outputs/priority-adaptation-2026-10-18/场景显式初值参数实施方案.md)。

### 状态初值与逐枚回充

`COUNTER / AMMO` 的 `detail.initialValueBinding`、以及 `AMMO` 的 `detail.initialRemainingMsBinding` 是状态字段自己的可选初值声明，不放入触发动作。两者均复用 `SCENE_INITIAL_PARAMETER` 绑定形状，对应的 `initialValue / initialRemainingValue` 必须直接引用相同的本技能无默认整数参数。范围限于 `SKILL` 状态及有序的非负安全整数边界；字段缺省时保持缺省，不自动补 `null`、0 或空声明。后端请求真源为 `SkillInternalStateCounterDetail.java / SkillInternalStateAmmoDetail.java`。

`initialRemainingValue` 使用毫秒，只适用于 `ONE_BY_ONE / AFTER_CONSUME`；欠弹必须有明确余时，满弹仅允许不提供余时或明确0。每个实际场景的库存、余时和循环位置由使用者填写，不把学习时库存当成战斗初值，不改写参数默认值。管理保存还需核对容量、时长与声明引用，真正的场景值及单发冷却、回充执行由宿主和正式Wasm验证。

`MODIFY_INTERNAL_STATE` 的明细为 `{stateSkillKey, stateKey, operation: 'REDUCE_RECOVERY', value}`，请求真源为 `SkillTriggerModifyInternalStateActionDetail.java`。它只允许本技能 `BASIC_ATTACK_HIT / EVENT_SOURCE` 修改自身 `SKILL / AMMO` 的下一枚回充余时；`runtimeInputBindings / resultModifiers` 均为空。金额使用现行数值引用，不增加库存、不改变单发冷却、不借用辅助过程。其它动作的事件来源和输入授权保持原约束。

每发循环沿现有 `START_PROCESS` 的 `INTERNAL_STATE / VALUE` 绑定读取本技能整数计数器，仅在 `PROCESS_START / COUNTER / SET` 使用相应动态值及已核验公式。应先冻结本次序号再推进下一发，命中条件读取冻结状态；不新增过程算子或用一个效果假装扣弹。完整边界及验证真源见[作者与宿主实施契约](../../../../outputs/priority-adaptation-2026-10-18/corki-next/r-implementation-2026-10-19/作者与宿主实施契约.md)，执行前核对实际部署版本。

### 有期指定技能冷却时长倍率

`COOLDOWN_DURATION_MODIFIER`（冷却时长修正）的`detail`只接受`{affectedSkillScope:{mode:'SKILLS',skillKeys:[...],skillCategoryKeys:[]}}`，指定技能非空、合法、无重复且属于同游戏；不接受其它范围、`operation`、未知字段、类型转换或显式空明细。请求真源为`SkillEffectCooldownDurationModifierDetail.java`及其严格反序列化分派。效果须为有限SOURCE单层、保持层数并刷新全部、同时到期、无周期/盾关联，结果为PERSISTENT/APPLICATION_SNAPSHOT/SHARED/REPLACE且不消费法术盾。完整数值规则在各声明等级最终都须静态、有限且严格大于0；0.5表示时长一半，1合法。参数、公式、生命周期与范围引用后续修改仍需通过事务最终态守卫。

该结果沿现有`results`数组完整保护保存和独立回读；不写数据库新列、不冒充技能急速或剩余冷却操作。管理层可保存合法资料；实际本场INITIAL能力、关闭/未学/未计划的零匹配，以及只作用未来新提交冷却，仍由宿主和正式Wasm证明。见[共享实施方案及接线澄清](../../../../outputs/priority-adaptation-2026-10-18/nasus-next/内瑟斯通用机制共享实施方案.md)。执行前核对真实服务已安装支持该类型的版本；接口保存成功不能直接开放英雄。
