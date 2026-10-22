# 系统固定枚举

`authoring.json` 保存35组、202个固定成员及中文标签，是对应Web定义的唯一来源，包含触发、过程、修正区域计算方式及自动技能运行值。作者选择已有选项，原生返回实际运行值；目录标识、公式、数值、对象关系仍由作者填写。

生成文件为 `web/src/types/skillSystemEnums.generated.ts`。后端33个Java枚举、原生9个明确事件常量及15个自动调度常量使用只读成员核对；自动运行枚举不声明后端Java绑定。完整作者目录边界见[系统固定枚举与作者目录边界清单](../../文档记录/详细设计/项目/系统固定枚举与作者目录边界清单.md)，自动运行语义见[主动技能自动调度与连招约束详细设计](../../文档记录/详细设计/项目/主动技能自动调度与连招约束详细设计.md)。

生成与检查命令在规划真源运行，工作树必须明确指定：

```powershell
node tools/system-enums/generate.mjs --target docs --root C:/project/damage_viewer_project_planning
node tools/system-enums/generate.mjs --target docs --root C:/project/damage_viewer_project_planning --check
node tools/system-enums/generate.mjs --target web --root C:/project/damage_web_dev
node tools/system-enums/generate.mjs --target web --root C:/project/damage_web_dev --check --backend-root C:/project/damage_backend_dev --wasm-root C:/project/damage_wasm_dev
```

检查模式不写任何模块；生成模式按目标只写规划清单表或明确指定的Web生成文件，不同步根协作规则，也不修改后端或原生。固定选项全集与特定位置的支持子集分开：周期首次执行仅两值，引导窗口可以使用第三值；管理侧强化普攻消费有两值，当前运行准入仍只开放命中消费。

`SKILL_USED`与原生成功开始机制存在有界映射，`PROCESS_MOMENT`是过程操作时点，二者不生成虚构的同名事件目录键。现行类型目录声明、事件排序、生命、暴击及费用语义继续按原协议执行。

## 当前成员清单

下表由JSON生成；是否可运行仍取决于实际场景的准入和实现。

<!-- system-enums:members:start -->
| 用途 | 类型 | 固定值与显示 |
| --- | --- | --- |
| 触发动作 | SkillTriggerActionType | `EXECUTE_EFFECT`（执行效果）、`START_PROCESS`（启动过程）、`FAIL_PROCESS`（令过程失败）、`ADVANCE_PROCESS`（推进当前过程）、`MODIFY_INTERNAL_STATE`（修改内部状态） |
| 内部状态修改操作 | SkillTriggerInternalStateOperation | `REDUCE_RECOVERY`（减少下一次回充余时） |
| 施放阶段 | SkillTriggerCastPhase | `INITIAL`（首次施放）、`RECAST`（再次施放）、`CHARGE_RELEASE`（蓄力释放） |
| 战斗状态读值 | SkillTriggerCombatStatusValueKind | `PRESENT`（存在）、`STACKS`（层数）、`REMAINING_MS`（剩余时间） |
| 比较符 | SkillTriggerComparator | `LT`（小于）、`LTE`（小于等于）、`EQ`（等于）、`NE`（不等于）、`GTE`（大于等于）、`GT`（大于） |
| 触发条件 | SkillTriggerConditionType | `ATTRIBUTE_COMPARE`（属性比较）、`STATUS_CHECK`（战斗状态检查）、`LIFECYCLE_CHECK`（生命周期检查）、`TARGET_CATEGORY_CHECK`（事件对方类别）、`EXPLICIT_TARGET_IS_SOURCE`（显式目标为来源对象）、`SKILL_HIT_TARGET_IS_ENEMY`（技能命中敌方对象）、`INTERNAL_STATE_CHECK`（技能内部状态检查）、`EVENT_VALUE_COMPARE`（事件值比较） |
| 触发伤害产生方式 | SkillTriggerDamageDeliveryKind | `ANY`（任意）、`SKILL`（技能）、`BASIC_ATTACK`（普通攻击） |
| 触发伤害来源性质 | SkillTriggerDamageOriginKind | `ANY`（任意）、`DIRECT`（直接伤害）、`REFLECTED`（反伤） |
| 触发事件 | SkillTriggerEventType | `SOURCE_INITIALIZED`（来源对象初始化完成）、`SKILL_USED`（技能被主动或消耗使用）、`BASIC_ATTACK_START`（普通攻击发起）、`BASIC_ATTACK_HIT`（普通攻击命中）、`BASIC_ATTACK_RECEIVED`（普通攻击命中接收（结果前））、`SKILL_HIT`（技能命中）、`PROCESS_MOMENT`（当前技能过程到达固定时点）、`PROCESS_RESOLVED`（技能完成且绑定命中已结算）、`RESULT_AVAILABLE`（当前技能某个无生命周期基础结果到达可用时点）、`LIFECYCLE_MOMENT`（当前技能生命周期到达离散时点）、`DAMAGE_PENDING`（即将受到伤害）、`DAMAGE_DEALT`（来源对象造成伤害）、`DAMAGE_TAKEN`（来源对象受到伤害）、`STATUS_CHANGED`（指定对象的战斗状态施加或移除）、`HEALTH_THRESHOLD_CROSSED`（指定对象生命属性越过阈值）、`INTERNAL_STATE_CHANGED`（当前技能内部状态发生固定变化）、`CONTROL_RECEIVED`（来源对象受到控制）、`ENTITY_DIED`（指定对象死亡）、`ENTITY_UNTARGETABLE`（指定对象变为不可选取）、`KILL`（来源对象完成击杀）、`TAKEDOWN`（来源对象参与击杀）、`PROCESS_CANCEL_REQUESTED`（指定过程收到主动取消请求）、`SPELL_SHIELD_BLOCKED`（法术护盾成功阻挡）、`HIT_LINK_APPLIED`（应用命中联动）、`ATTACK_LINK_APPLIED`（触发攻击联动） |
| 事件使用方式 | SkillTriggerEventUseKind | `ACTIVE`（主动）、`CONSUMABLE`（消耗）、`ANY`（任意） |
| 事件读值口径 | SkillTriggerEventValueKey | `STEP_EXECUTION_INDEX`（当前步骤第几次执行）、`CHARGE_DURATION_MS`（实际蓄力毫秒数）、`RECAST_COUNT`（当前过程已重施次数）、`HIT_INDEX`（当前命中序号）、`SKILL_HIT_FIRST_CONTACT`（本次使用首次目标接触）、`SKILL_USE_CONTACT_COUNT`（本次使用已结算接触数）、`SKILL_HIT_SPELL_SHIELD_BLOCKED`（技能命中被法术护盾阻挡）、`LIFECYCLE_STACKS`（当前生命周期层数）、`PERIOD_INDEX`（当前周期序号）、`REMAINING_MS`（当前生命周期剩余毫秒数）、`STATE_BEFORE`（数值内部状态变化前值）、`STATE_AFTER`（数值内部状态变化后值）、`ATTRIBUTE_BEFORE`（生命属性越阈值前值）、`ATTRIBUTE_AFTER`（生命属性越阈值后值）、`THRESHOLD_VALUE`（本次阈值取值值）、`RAW_DAMAGE`（原始伤害）、`POST_DEFENSE_DAMAGE`（防御后伤害）、`HEALTH_BEFORE`（受伤前生命）、`PROJECTED_HEALTH_AFTER`（预计受伤后生命）、`SHIELD_ABSORBED`（护盾吸收）、`ACTUAL_HP_LOSS`（实际扣血）、`BLOCKED`（是否被法术护盾阻挡（0/1））、`IMMUNE`（是否被伤害免疫（0/1））、`KILLED`（是否形成击杀（0/1））、`LINK_INDEX`（本次序号（从 1 开始））、`LINK_COUNT`（总次数（从 1 开始）） |
| 生命越阈值方向 | SkillTriggerHealthDirection | `UPWARD`（向上）、`DOWNWARD`（向下） |
| 内部状态变化种类 | SkillTriggerInternalStateChangeKind | `VALUE_CHANGED`（数值变化）、`OPTION_SELECTED`（模式选项变化）、`FLAG_CHANGED`（准备标记变化）、`COOLDOWN_READY`（内部冷却就绪） |
| 内部状态读值 | SkillTriggerInternalStateValueKind | `VALUE`（数值）、`ATTACK_START_VALUE`（本次攻击开始值）、`DAMAGE_BEFORE_VALUE`（本笔伤害前值）、`OPTION_SELECTED`（模式是否选中）、`ENABLED`（准备标记是否启用）、`REMAINING_MS`（剩余毫秒） |
| 生命周期检查 | SkillTriggerLifecycleCheckKind | `PRESENT`（存在）、`ABSENT`（不存在）、`STACKS_COMPARE`（层数比较） |
| 生命周期离散事件 | SkillTriggerLifecycleEventMoment | `APPLICATION`（施加）、`FULL_STACKS`（满层）、`PERIODIC`（周期）、`NATURAL_END`（自然结束）、`EARLY_REMOVE`（提前移除） |
| 同次使用范围 | SkillTriggerOncePerUseScope | `SKILL`（整个技能使用）、`TARGET`（每个目标） |
| 前序结果读值 | SkillTriggerPriorResultOutputKind | `CONFIGURED_VALUE`（基础配置值）、`RAW_DAMAGE`（原始伤害）、`POST_DEFENSE_DAMAGE`（防御后伤害）、`SHIELD_ABSORBED`（护盾吸收）、`ACTUAL_HP_LOSS`（实际扣血）、`ACTUAL_HEALING`（实际治疗）、`BLOCKED`（是否被法术护盾阻挡（0/1））、`IMMUNE`（是否被伤害免疫（0/1））、`STATUS_APPLIED`（是否成功施加状态（0/1））、`KILLED`（是否形成击杀（0/1）） |
| 过程失败原因 | SkillProcessFailureReason | `CONTROLLED`（受到控制）、`SOURCE_DIED`（来源对象死亡）、`TARGET_UNTARGETABLE`（当前目标不可选取）、`ACTIVE_CANCELLED`（主动取消）、`EVENT_ABORTED`（当前事件终止） |
| 近期受伤读值 | SkillTriggerRecentDamageOutputKind | `POST_DEFENSE_DAMAGE`（防御后伤害）、`ACTUAL_HP_LOSS`（实际扣血） |
| 运行输入来源 | SkillTriggerRuntimeInputSourceType | `INTERNAL_STATE`（技能内部状态）、`COMBAT_STATUS`（战斗状态）、`EVENT_VALUE`（当前事件值）、`SOURCE_CAST_RESOURCE_COST`（来源施放资源消耗）、`SCENE_ATTRIBUTE_SNAPSHOT`（场景属性快照）、`SCENE_INITIAL_PARAMETER`（场景显式初值）、`PRIOR_ACTION_RESULT`（更早动作结果）、`COMBAT_ELAPSED_TIME`（本次入战后时长）、`RECENT_DAMAGE_SUM`（近期受伤累计） |
| 战斗状态变化 | SkillTriggerStatusChangeKind | `APPLY`（施加）、`REMOVE`（移除） |
| 战斗状态检查 | SkillTriggerStatusCheckKind | `PRESENT`（存在）、`ABSENT`（不存在）、`STACKS_COMPARE`（层数比较）、`REMAINING_MS_COMPARE`（剩余时间比较） |
| 触发主体 | SkillTriggerSubject | `SOURCE`（来源对象）、`CURRENT_TARGET`（当前目标）、`EVENT_SOURCE`（事件来源对象） |
| 事件对方类别 | SkillTriggerTargetCategory | `CHAMPION`（英雄）、`EPIC_MONSTER`（史诗野怪）、`MINION`（小兵）、`NON_EPIC_MONSTER`（非史诗野怪）、`STRUCTURE`（建筑） |
| 动作目标上下文 | SkillTriggerTargetContext | `CURRENT_TARGET`（当前目标）、`EVENT_SOURCE`（事件来源对象） |
| 运行输入数值类型 | SkillTriggerValueDomain | `INTEGER`（整数）、`DECIMAL`（小数） |
| 过程激活方式 | SkillProcessActivationType | `ACTIVE`（主动）、`PASSIVE`（被动）、`CONSUMABLE`（消耗） |
| 强化普攻消费时点 | SkillProcessEmpoweredConsumeMoment | `ATTACK_START`（攻击发起）、`ATTACK_HIT`（攻击命中） |
| 首次执行方式 | SkillProcessFirstExecutionKind | `IMMEDIATE`（立即执行）、`AFTER_INTERVAL`（等待一个间隔）、`CUSTOM_WINDOW`（指定首末执行窗口） |
| 过程与步骤时点 | SkillProcessMomentType | `PROCESS_START`（过程开始）、`STEP_START`（步骤开始）、`STEP_EXECUTION`（步骤执行）、`STEP_COMPLETE`（步骤完成）、`STEP_TIMEOUT`（步骤超时）、`PROCESS_COMPLETE`（过程完成）、`PROCESS_FAILURE`（过程失败） |
| 内部状态操作 | SkillProcessStateOperationKind | `INCREASE`（增加）、`DECREASE`（减少）、`CONSUME`（消耗）、`SET`（设置）、`RESET`（重置）、`SELECT`（选择）、`ENABLE`（启用）、`DISABLE`（停用）、`TOGGLE`（切换）、`START`（开始） |
| 过程步骤 | SkillProcessStepType | `IMMEDIATE`（立即）、`DELAY`（延迟）、`MULTI_HIT`（多段）、`PERIODIC`（周期）、`CHANNEL`（引导）、`CHARGE`（蓄力）、`RECAST`（重施）、`EMPOWERED_BASIC_ATTACK`（强化下一次普通攻击） |
| 自动技能等待原因 | AutomaticSkillWaitReason | `OWN_COOLDOWN`（自身冷却）、`RELATED_COOLDOWN`（关联冷却）、`RELEASE_QUALIFICATION`（缺释放资格）、`ACTION_OCCUPIED`（行动占用）、`PROCESS_ACTIVE`（同来源已有过程）、`MECHANIC_RESOURCE`（机制资源不足）、`AUTHOR_CONDITION`（作者条件不成立） |
| 自动技能记录类别 | AutomaticSkillRecordKind | `ATTEMPT_REJECTED`（尝试拒绝）、`ABORTED_BEFORE_START`（开始前中止）、`STARTED`（成功开始）、`COMPLETED`（成功终结）、`FAILED`（失败终结）、`QUALIFICATION_GRANTED`（资格授予）、`QUALIFICATION_CONSUMED`（资格消费）、`WAIT_CHANGED`（等待变化） |
| 修正区域计算方式 | ModifierZoneCalculationMode | `FLAT_ADD`（固定值加算）、`RATIO_ADD`（比例加算）、`RATIO_MULTIPLY`（比例乘算）、`RATIO_MAX`（比例减少取强）、`RATIO_COMPLEMENT_MULTIPLY`（剩余比例连乘） |
<!-- system-enums:members:end -->
