import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const apiBaseUrl = 'http://127.0.0.1:8080/api/admin/games/lol';
const token = 'local-entry';
const evidencePath = new URL('./逐字段回读证据.json', import.meta.url);
const candidatePath = new URL('./录入候选.json', import.meta.url);

const fixed = (value) => ({ kind: 'FIXED', value });
const parameter = (parameterKey) => ({ kind: 'PARAMETER', parameterKey });
const formula = (formulaKey) => ({ kind: 'FORMULA', formulaKey });
const attribute = (attributeOwner, attributeKey, attributeValueKind) => ({
  nodeType: 'ATTRIBUTE', attributeOwner, attributeKey, attributeValueKind
});
const parameterNode = (parameterKey) => ({ nodeType: 'PARAMETER', parameterKey });
const operation = (operationName, left, right) => ({
  nodeType: 'OPERATION', operation: operationName, operands: [left, right]
});
const effectValue = (value, fixedMaxValue = null) => ({
  value, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue
});
const persistentBehavior = (reapplicationValueMode = 'REPLACE', valueReadMode = 'APPLICATION_SNAPSHOT') => ({
  moment: 'PERSISTENT', valueReadMode, stackValueMode: 'SHARED', reapplicationValueMode, periodicExecutionMode: null
});
const explicitLifecycle = () => ({
  durationValue: null,
  maxStacksValue: fixed(1),
  applicationStacksValue: fixed(1),
  instanceScope: 'SOURCE',
  reapplicationStackMode: 'KEEP',
  reapplicationDurationMode: null,
  expiryMode: 'EXPLICIT_ONLY',
  periodicIntervalValue: null,
  firstPeriodicExecution: null
});
const timedLifecycle = (durationValue, instanceScope = 'SOURCE') => ({
  durationValue,
  maxStacksValue: fixed(1),
  applicationStacksValue: fixed(1),
  instanceScope,
  reapplicationStackMode: 'KEEP',
  reapplicationDurationMode: 'REFRESH_ALL',
  expiryMode: 'ALL_AT_ONCE',
  periodicIntervalValue: null,
  firstPeriodicExecution: null
});
const periodicLifecycle = () => ({
  durationValue: null,
  maxStacksValue: fixed(1),
  applicationStacksValue: fixed(1),
  instanceScope: 'SOURCE',
  reapplicationStackMode: 'KEEP',
  reapplicationDurationMode: null,
  expiryMode: 'EXPLICIT_ONLY',
  periodicIntervalValue: fixed(5000),
  firstPeriodicExecution: 'AFTER_INTERVAL'
});
const periodicBehavior = {
  moment: 'PERIODIC', valueReadMode: 'MOMENT_EVALUATION', stackValueMode: 'SHARED',
  reapplicationValueMode: null, periodicExecutionMode: 'ONCE_PER_INSTANCE'
};
const damageResult = ({
  resultKey = 'damage', name, description, target = 'TARGET', value, damageTypeKey = 'physics',
  deliveryKind = 'BASIC_ATTACK', originKind = 'DIRECT', fixedMaxValue = null
}) => ({
  resultKey, name, resultType: 'DAMAGE', target, description, sortOrder: 10,
  lifecycleBehavior: null, spellShieldBlockScope: null,
  valueRule: effectValue(value, fixedMaxValue),
  detail: {
    damageTypeKey, deliveryKind, originKind,
    critical: { mode: 'DISALLOWED', multiplierValue: null }, vampRules: []
  }
});
const healResult = ({ resultKey = 'heal', name, description, value }) => ({
  resultKey, name, resultType: 'DIRECT_HEAL', target: 'SOURCE', description, sortOrder: 10,
  lifecycleBehavior: null, spellShieldBlockScope: null, valueRule: effectValue(value), detail: {}
});
const shieldResult = ({ resultKey = 'shield', name, description, value, damageTypeKey, lifecycleBehavior = persistentBehavior() }) => ({
  resultKey, name, resultType: 'NORMAL_SHIELD', target: 'SOURCE', description, sortOrder: 10,
  lifecycleBehavior, spellShieldBlockScope: null, valueRule: effectValue(value),
  detail: { absorbedDamageTypeKey: damageTypeKey ?? null, decayMode: 'NONE' }
});
const attributeResult = ({ resultKey, name, description, attributeKey, value, lifecycleBehavior = persistentBehavior() }) => ({
  resultKey, name, resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE', description, sortOrder: 10,
  lifecycleBehavior, spellShieldBlockScope: null, valueRule: effectValue(value),
  detail: { attributeKey, operation: 'INCREASE', modifierZoneKey: 'attribute_flat_add' }
});
const attributeModifierResult = ({ resultKey, name, description, attributeKey, value, modifierZoneKey = 'attribute_percent_bonus', lifecycleBehavior = persistentBehavior() }) => ({
  resultKey, name, resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE', description, sortOrder: 10,
  lifecycleBehavior, spellShieldBlockScope: null, valueRule: effectValue(value),
  detail: { attributeKey, operation: 'INCREASE', modifierZoneKey }
});const resourceResult = ({ resultKey = 'resource_change', name, description, target = 'SOURCE', value, attributeKey = 'mana', operation = 'RESTORE' }) => ({
  resultKey, name, resultType: 'RESOURCE_CHANGE', target, description, sortOrder: 10,
  lifecycleBehavior: null, spellShieldBlockScope: null, valueRule: effectValue(value),
  detail: { attributeKey, operation }
});
const executeResult = ({ resultKey = 'execute', name, description, target = 'TARGET', value, attributeKey = 'hp' }) => ({
  resultKey, name, resultType: 'EXECUTE', target, description, sortOrder: 10,
  lifecycleBehavior: null, spellShieldBlockScope: null, valueRule: effectValue(value), detail: { attributeKey }
});
const damageImmunityResult = ({ resultKey = 'damage_immunity', name, description, target = 'SOURCE', damageTypeKey = null, deliveryKind = 'ANY', originKind = 'ANY', lifecycleBehavior = { moment: 'PERSISTENT', valueReadMode: null, stackValueMode: null, reapplicationValueMode: null, periodicExecutionMode: null } }) => ({
  resultKey, name, resultType: 'DAMAGE_IMMUNITY', target, description, sortOrder: 10,
  lifecycleBehavior, spellShieldBlockScope: null, valueRule: null,
  detail: { damageTypeKey, deliveryKind, originKind }
});
const thresholdGroup = (thresholdFormulaKey, thresholdParameterKey) => ({
  groupKey: 'cross_below_threshold', name: '从阈值以上跌破阈值', sortOrder: 10,
  conditions: [
    {
      conditionKey: 'health_before_threshold', conditionType: 'ATTRIBUTE_COMPARE', sortOrder: 10,
      detail: {
        subject: 'SOURCE', attributeKey: 'hp', attributeValueKind: 'CURRENT_RATIO', comparator: 'GTE',
        comparisonValue: parameter(thresholdParameterKey)
      }
    },
    {
      conditionKey: 'projected_health_threshold', conditionType: 'EVENT_VALUE_COMPARE', sortOrder: 20,
      detail: { eventValueKey: 'PROJECTED_HEALTH_AFTER', comparator: 'LT', comparisonValue: formula(thresholdFormulaKey) }
    }
  ]
});

const skippedObjects = [];

const objects = [
  {
    equipmentKey: 'item_1043', equipmentName: '反曲之弓',
    directAttributes: { bonus_attack_speed_percent: 0.15 },
    skill: {
      skillKey: 'item_1043_passive', name: '反曲之弓·叮刺',
      description: '保存16.17客户端与官方说明共同确证的攻击附带15点额外物理伤害。装备已有15%攻击速度，不在技能中重复施加；仅把已有普通攻击命中事件作为当前可确认触发，未扩大到技能触发攻击特效。',
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'on_hit_damage', name: '叮刺额外伤害', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 15, levelValues: null, description: '每次攻击附带的额外物理伤害，单位：伤害点。', sortOrder: 10 }
    ],
    formulas: [],
    effects: [{
      effectKey: 'on_hit_damage', name: '叮刺额外物理伤害', description: '攻击命中时造成15点额外物理伤害。', sortOrder: 10, lifecycle: null,
      results: [damageResult({ resultKey: 'on_hit_damage', name: '叮刺物理伤害', description: '每次攻击附带15点额外物理伤害。', value: parameter('on_hit_damage'), target: 'TARGET', damageTypeKey: 'physics', deliveryKind: 'BASIC_ATTACK', originKind: 'DIRECT' })]
    }],
    triggerRules: [{
      ruleKey: 'resolve_on_basic_attack_hit', name: '普通攻击命中结算叮刺', description: '按客户端攻击附带文案监听已有普通攻击命中事件；技能触发攻击特效的范围不在本批扩大。',
      sortOrder: 10, eventSource: { eventType: 'BASIC_ATTACK_HIT', detail: {} }, conditionGroups: [],
      actions: [{ actionKey: 'execute_on_hit_damage', name: '执行叮刺额外伤害', actionType: 'EXECUTE_EFFECT', sortOrder: 10, targetContext: 'CURRENT_TARGET', detail: { effectKey: 'on_hit_damage' }, runtimeInputBindings: [], resultModifiers: [] }],
      perTargetCooldown: null, maxTriggersPerProcess: null
    }],
    pendingRules: ['当前规则只覆盖已有BASIC_ATTACK_HIT事件；来源只确认攻击附带，技能触发的攻击特效是否复用该事件留待运行链核对。'],
    pendingEffects: [],
    relation: { equipmentKey: 'item_1043', skillKey: 'item_1043_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/1043/mDataValues/OnHitDamage、mItemCalculations、mPercentAttackSpeedMod、mItemDataClient/mTooltipData/mLocKeys', evidence: 'OnHitDamage=15；直接属性为0.15攻击速度；客户端计算项引用OnHitDamage。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_1043_tooltip、entries/GeneratedTip_Item_1043_Description', evidence: '攻击附带15点额外物理伤害，并标为攻击特效。' },
      { file: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json', pointer: '/data/1043/description、/data/1043/stats', evidence: '官方说明为15%攻击速度与攻击附带15点额外物理伤害。' }
    ],
    arithmetic: [{ sample: '单次攻击附带伤害', expected: 15, actual: 15, unit: '物理伤害点' }]
  },
  {
    equipmentKey: 'item_1083', equipmentName: '萃取',
    directAttributes: { attack_damage: 7 },
    skill: {
      skillKey: 'item_1083_passive', name: '萃取·收割',
      description: '保存16.17客户端与官方说明共同确证的每次攻击回复3点生命值。装备已有7点攻击力，不在技能中重复施加；小兵击杀金币、累计击杀阈值与额外金币按本批范围跳过。',
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'on_hit_heal', name: '收割攻击治疗', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 3, levelValues: null, description: '每次攻击命中回复来源3点生命值，单位：生命点。', sortOrder: 10 }
    ],
    formulas: [],
    effects: [{
      effectKey: 'on_hit_heal', name: '收割攻击治疗', description: '普通攻击命中时回复来源3点生命值。', sortOrder: 10, lifecycle: null,
      results: [healResult({ resultKey: 'on_hit_heal', name: '收割直接治疗', description: '每次攻击命中回复来源3点生命值。', value: parameter('on_hit_heal') })]
    }],
    triggerRules: [{
      ruleKey: 'resolve_on_basic_attack_hit', name: '普通攻击命中结算收割', description: '按来源每次攻击回复生命值的文案监听已有普通攻击命中事件；金币奖励不进入本技能。',
      sortOrder: 10, eventSource: { eventType: 'BASIC_ATTACK_HIT', detail: {} }, conditionGroups: [],
      actions: [{ actionKey: 'execute_on_hit_heal', name: '执行收割攻击治疗', actionType: 'EXECUTE_EFFECT', sortOrder: 10, targetContext: 'CURRENT_TARGET', detail: { effectKey: 'on_hit_heal' }, runtimeInputBindings: [], resultModifiers: [] }],
      perTargetCooldown: null, maxTriggersPerProcess: null
    }],
    pendingRules: ['小兵击杀1金币、达到100次后的额外350金币及相关阈值属于范围外金币效果，已从参数、效果和触发中排除，不计待补机制。'],
    pendingEffects: [],
    relation: { equipmentKey: 'item_1083', skillKey: 'item_1083_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/1083/mDataValues/OnHitHeal、MinionKillGold、CompleteGold、MinionKillThreshold、mFlatPhysicalDamageMod、mItemDataClient/mTooltipData/mLocKeys', evidence: 'OnHitHeal=3；金币字段另存但按范围跳过；直接属性为7攻击力。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_1083_tooltip、entries/Item_1083_TooltipExternal、entries/GeneratedTip_Item_1083_Description', evidence: '每次攻击回复3点生命值；同一说明另含小兵金币段，金币段未录入。' },
      { file: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json', pointer: '/data/1083/description、/data/1083/stats', evidence: '官方说明为7攻击力、攻击回复3点生命值及小兵金币奖励；本批仅保留生命回复。' }
    ],
    arithmetic: [{ sample: '单次攻击命中治疗', expected: 3, actual: 3, unit: '生命点' }]
  },
  {
    equipmentKey: 'item_3123', equipmentName: '死刑宣告',
    directAttributes: { attack_damage: 15 },
    skill: {
      skillKey: 'item_3123_passive', name: '死刑宣告·重伤',
      description: '保存16.17客户端与官方说明共同确证的对敌方英雄造成物理伤害时40%重伤、持续3秒的参数。装备已有15点攻击力，不在技能中重复施加；重伤按HEALING_MODIFIER候选表达，当前共享治疗乘区为空，暂不伪造错误乘区或状态键。',
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'grievous_amount', name: '重伤减疗比例', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.4, levelValues: null, description: '受到重伤影响的治疗减少比例，小数0.4表示40%。', sortOrder: 10 },
      { parameterKey: 'grievous_duration_ms', name: '重伤持续时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 3000, levelValues: null, description: '重伤持续3秒，单位：毫秒。', sortOrder: 20 }
    ],
    formulas: [], effects: [], triggerRules: [],
    pendingRules: [
      '来源触发是对敌方英雄造成物理伤害，不是任意命中；当前DAMAGE_DEALT事件与目标类别条件的组合不能准确覆盖全部物理伤害并同时限定英雄，因此不接宽泛规则。',
      '重伤结果目标为TARGET，RECEIVED/DECREASE/ANY仅说明该目标受到治疗的降低。现有RATIO_ADD会把两份40%叠成80%，需先补跨来源取强语义，再建治疗乘区和效果；hp_regen覆盖另核，不能宣称完整重伤。'
    ],
    pendingEffects: [{
      effectKey: 'grievous_healing_modifier', resultType: 'HEALING_MODIFIER', target: 'TARGET',
      valueRule: effectValue(parameter('grievous_amount')),
      detail: { modifierZoneKey: null, direction: 'RECEIVED', operation: 'DECREASE', healingKind: 'ANY' },
      reason: '单份治疗降低已有结果结构；当前组合仅加算，缺多个重伤来源只取最强的方式，不能仅新增RATIO_ADD目录后提交。目标类别门禁及生命回复覆盖分别待处理。'
    }],
    relation: { equipmentKey: 'item_3123', skillKey: 'item_3123_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/3123/mDataValues/GrievousDuration、GrievousAmount、mFlatPhysicalDamageMod、mItemDataClient/mTooltipData/mLocKeys', evidence: 'GrievousAmount=0.4；GrievousDuration=3秒；直接属性为15攻击力。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_3123_tooltip、entries/GeneratedTip_Item_3123_Description', evidence: '对敌方英雄造成物理伤害时施加40%重伤，持续3秒。' },
      { file: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json', pointer: '/data/3123/description、/data/3123/stats', evidence: '官方说明与客户端一致；基础攻击力已由装备自身保存。' }
    ],
    arithmetic: [{ sample: '治疗100点时的减疗量', expected: 40, actual: 0.4 * 100, unit: '治疗点' }, { sample: '重伤时长换算', expected: 3000, actual: 3 * 1000, unit: '毫秒' }]
  },
  {
    equipmentKey: 'item_3916', equipmentName: '湮灭宝珠',
    directAttributes: { ability_power: 25 },
    skill: {
      skillKey: 'item_3916_passive', name: '湮灭宝珠·重伤',
      description: '保存16.17客户端与官方说明共同确证的对敌方英雄造成魔法伤害时40%重伤、持续3秒的参数。装备已有25点法术强度，不在技能中重复施加；重伤按HEALING_MODIFIER候选表达，当前共享治疗乘区为空，暂不伪造错误乘区或状态键。',
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'grievous_amount', name: '重伤减疗比例', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.4, levelValues: null, description: '受到重伤影响的治疗减少比例，小数0.4表示40%。', sortOrder: 10 },
      { parameterKey: 'grievous_duration_ms', name: '重伤持续时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 3000, levelValues: null, description: '重伤持续3秒，单位：毫秒。', sortOrder: 20 }
    ],
    formulas: [], effects: [], triggerRules: [],
    pendingRules: [
      '来源触发是对敌方英雄造成魔法伤害，不是任意命中；当前DAMAGE_DEALT事件与目标类别条件的组合不能准确覆盖全部魔法伤害并同时限定英雄，因此不接宽泛规则。',
      '重伤结果目标为TARGET，RECEIVED/DECREASE/ANY仅说明该目标受到治疗的降低。现有RATIO_ADD会把两份40%叠成80%，需先补跨来源取强语义，再建治疗乘区和效果；hp_regen覆盖另核，不能宣称完整重伤。'
    ],
    pendingEffects: [{
      effectKey: 'grievous_healing_modifier', resultType: 'HEALING_MODIFIER', target: 'TARGET',
      valueRule: effectValue(parameter('grievous_amount')),
      detail: { modifierZoneKey: null, direction: 'RECEIVED', operation: 'DECREASE', healingKind: 'ANY' },
      reason: '单份治疗降低已有结果结构；当前组合仅加算，缺多个重伤来源只取最强的方式，不能仅新增RATIO_ADD目录后提交。目标类别门禁及生命回复覆盖分别待处理。'
    }],
    relation: { equipmentKey: 'item_3916', skillKey: 'item_3916_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/3916/mDataValues/GrievousDuration、GrievousAmount、mFlatMagicDamageMod、mItemDataClient/mTooltipData/mLocKeys', evidence: 'GrievousAmount=0.4；GrievousDuration=3秒；直接属性为25法术强度。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_3916_tooltip、entries/GeneratedTip_Item_3916_Description', evidence: '对敌方英雄造成魔法伤害时施加40%重伤，持续3秒。' },
      { file: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json', pointer: '/data/3916/description、/data/3916/stats', evidence: '官方说明与客户端一致；基础法术强度已由装备自身保存。' }
    ],
    arithmetic: [{ sample: '治疗100点时的减疗量', expected: 40, actual: 0.4 * 100, unit: '治疗点' }, { sample: '重伤时长换算', expected: 3000, actual: 3 * 1000, unit: '毫秒' }]
  },
  {
    equipmentKey: 'item_3089', equipmentName: '灭世者的死亡之帽',
    directAttributes: { ability_power: 130 },
    skill: {
      skillKey: 'item_3089_passive', name: '灭世者的死亡之帽·魔法乐章',
      description: '保存16.17客户端与官方说明共同确证的总法术强度提升30%。装备已有130点法术强度，不在技能中重复施加；使用现有ATTRIBUTE百分比乘区保存比例值0.3，由总法术强度乘区负责应用，不另造把当前法强乘一次的公式。',
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'ap_total_multiplier', name: '总法术强度提升比例', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.3, levelValues: null, description: '总法术强度增加30%，小数0.3表示30%；交给attribute_percent_bonus乘区应用。', sortOrder: 10 }
    ],
    formulas: [],
    effects: [{
      effectKey: 'total_ap_percent', name: '总法术强度百分比提升', description: '对来源总法术强度施加30%的属性百分比提升；装备直接的130点法术强度不在结果中重复添加。', sortOrder: 10, lifecycle: explicitLifecycle(),
      results: [attributeModifierResult({ resultKey: 'total_ap_percent', name: '总法术强度提升', description: '来源总法术强度提升30%。', attributeKey: 'ability_power', value: parameter('ap_total_multiplier'), modifierZoneKey: 'attribute_percent_bonus', lifecycleBehavior: persistentBehavior('REPLACE', 'APPLICATION_SNAPSHOT') })]
    }],
    triggerRules: [{
      ruleKey: 'initialize_total_ap_multiplier', name: '初始化总法术强度提升', description: '死亡之帽是装备持有时就生效的无条件被动，使用SOURCE_INITIALIZED并保持事件明细为空。',
      sortOrder: 10, eventSource: { eventType: 'SOURCE_INITIALIZED', detail: {} }, conditionGroups: [],
      actions: [{ actionKey: 'execute_total_ap_percent', name: '执行总法术强度提升', actionType: 'EXECUTE_EFFECT', sortOrder: 10, targetContext: 'EVENT_SOURCE', detail: { effectKey: 'total_ap_percent' }, runtimeInputBindings: [], resultModifiers: [] }],
      perTargetCooldown: null, maxTriggersPerProcess: null
    }],
    pendingRules: ['属性百分比乘区只保存比例值0.3并由现有attribute_percent_bonus应用；示例总法强400时增加120、结果520。当前仅完成配置和接口回读，未执行运行时计算。'],
    pendingEffects: [],
    relation: { equipmentKey: 'item_3089', skillKey: 'item_3089_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/3089/mDataValues/APAmp、mFlatMagicDamageMod、mItemDataClient/mTooltipData/mLocKeys', evidence: 'APAmp=0.3；直接属性为130法术强度；客户端提示为总法术强度提升。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_3089_tooltip、entries/item_3089_tooltipdynamic、entries/GeneratedTip_Item_3089_Description', evidence: '魔法乐章使总法术强度提升30%。' },
      { file: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json', pointer: '/data/3089/description、/data/3089/stats', evidence: '官方说明为130法术强度与总法术强度提升30%。' }
    ],
    arithmetic: [{ sample: '总法术强度400的提升', expected: 120, actual: 0.3 * 400, unit: '法术强度点' }, { sample: '总法术强度400应用后', expected: 520, actual: 400 + 0.3 * 400, unit: '法术强度点' }]
  },
  {
    equipmentKey: 'item_3116', equipmentName: '瑞莱的冰晶节杖',
    directAttributes: { hp: 400, ability_power: 65 },
    skill: {
      skillKey: 'item_3116_passive', name: '瑞莱的冰晶节杖·冰脉',
      description: '保存16.17客户端与官方说明共同确证的伤害型技能使目标减速30%、持续1秒参数。装备已有400生命值和65点法术强度，不在技能中重复施加；当前状态目录没有减速状态，不把眩晕或移动速度属性冒充减速效果。',
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'slow_amount', name: '冰脉减速比例', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.3, levelValues: null, description: '伤害型技能造成的减速比例，小数0.3表示30%。', sortOrder: 10 },
      { parameterKey: 'slow_duration_ms', name: '冰脉减速持续时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 1000, levelValues: null, description: '减速持续1秒，单位：毫秒。', sortOrder: 20 }
    ],
    formulas: [], effects: [], triggerRules: [],
    pendingRules: [
      '来源范围是伤害型技能命中目标；当前SKILL_HIT可以作为技能命中事件，但状态操作必须引用已登记状态，且事件与伤害类型筛选还需运行链确认。',
      '当前GET /statuses仅有vertigo（眩晕），没有减速状态键；不使用眩晕或move_speed_percent属性变化替代30%减速，待共享减速状态及准确技能伤害触发条件补齐后再写效果。'
    ],
    pendingEffects: [{
      effectKey: 'skill_damage_slow', resultType: 'STATUS_OPERATION', target: 'TARGET',
      valueRule: null, detail: { statusKey: null, operation: 'APPLY' },
      reason: '现有STATUS_OPERATION要求已登记statusKey；当前状态目录没有减速，且减速强度与持续时间已分别保存为参数。'
    }],
    relation: { equipmentKey: 'item_3116', skillKey: 'item_3116_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/3116/mDataValues/SlowAmount、SlowDuration、mEffectAmount、mFlatHPPoolMod、mFlatMagicDamageMod、mItemDataClient/mTooltipData/mLocKeys', evidence: 'SlowAmount=0.3；SlowDuration=1秒；直接属性400生命值、65法术强度；当前item_3116对象不是升级版item_223116。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_3116_tooltip、entries/item_3116_tooltipexternal、entries/GeneratedTip_Item_3116_Description', evidence: '伤害型技能使敌人减速30%，持续1秒；未采用升级版对象的其它减速数值。' },
      { file: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json', pointer: '/data/3116/description、/data/3116/stats', evidence: '官方说明为65法术强度、400生命值及伤害型技能减速30%持续1秒。' }
    ],
    arithmetic: [{ sample: '伤害型技能造成的减速比例', expected: 0.3, actual: 0.3, unit: '小数，等于30%' }, { sample: '减速持续时间换算', expected: 1000, actual: 1 * 1000, unit: '毫秒' }]
  }
];
const sourceFiles = [
  '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz',
  '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz',
  '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json',
];

async function request(method, path, body) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { status: response.status, data };
}
function isSuccess(result) { return result.status >= 200 && result.status < 300; }
function compareFields(expected, actual, path = '', rows = []) {
  if (expected === null || typeof expected !== 'object') { rows.push({ path, expected, actual, equal: Object.is(expected, actual) }); return rows; }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) { rows.push({ path, expected, actual, equal: false }); return rows; }
    rows.push({ path: `${path}[]`, expectedCount: expected.length, actualCount: actual.length, equal: expected.length === actual.length });
    expected.forEach((value, index) => compareFields(value, actual[index], `${path}[${index}]`, rows));
    return rows;
  }
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) { rows.push({ path, expected, actual, equal: false }); return rows; }
  for (const [key, value] of Object.entries(expected)) compareFields(value, actual[key], path ? `${path}.${key}` : key, rows);
  return rows;
}
function listItems(data) { return Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []); }
function mustSuccess(result, label) { if (!isSuccess(result)) throw new Error(`${label} failed: HTTP ${result.status} ${JSON.stringify(result.data)}`); return result; }
async function hashFile(relativePath) {
  const absolutePath = new URL(`../../../../${relativePath}`, import.meta.url);
  try { const bytes = await readFile(absolutePath); return { relativePath, sha256: createHash('sha256').update(bytes).digest('hex') }; }
  catch (error) { return { relativePath, missing: true, error: String(error.message ?? error) }; }
}
async function writeResource({ kind, path, createPath, body, apply, record }) {
  const before = await request('GET', path);
  if (isSuccess(before)) {
    const fields = compareFields(body, before.data);
    if (fields.some((field) => !field.equal)) throw new Error(`${kind} existing value differs; refusing overwrite: ${JSON.stringify(fields.filter((field) => !field.equal))}`);
    record.push({ kind, path, state: 'same', expected: body, readback: before.data, fields }); return before.data;
  }
  if (before.status !== 404) throw new Error(`${kind} preflight failed: HTTP ${before.status} ${JSON.stringify(before.data)}`);
  const row = { kind, path, state: apply ? 'created' : 'missing', expected: body, preflight: { status: before.status, data: before.data } };
  if (!apply) { record.push(row); return null; }
  const written = await request('POST', createPath, body);
  if (!isSuccess(written)) {
    const afterFailure = await request('GET', path);
    if (isSuccess(afterFailure)) {
      const fields = compareFields(body, afterFailure.data);
      if (!fields.some((field) => !field.equal)) { row.state = 'created-by-confirmed-retry'; row.write = { status: written.status, data: written.data }; row.readback = afterFailure.data; row.fields = fields; record.push(row); return afterFailure.data; }
    }
    throw new Error(`${kind} write failed and GET did not confirm same value: HTTP ${written.status} ${JSON.stringify(written.data)}`);
  }
  const read = mustSuccess(await request('GET', path), `${kind} readback`);
  row.write = { status: written.status, data: written.data }; row.readback = read.data; row.fields = compareFields(body, read.data);
  if (row.fields.some((field) => !field.equal)) throw new Error(`${kind} readback differs: ${JSON.stringify(row.fields.filter((field) => !field.equal))}`);
  record.push(row); return read.data;
}
async function relationRecord(object, apply, record) {
  const path = `/equipment-skill-relations?equipmentKey=${encodeURIComponent(object.equipmentKey)}`;
  const before = mustSuccess(await request('GET', path), `${object.equipmentKey} relation preflight`).data;
  const existing = listItems(before).find((item) => item.skillKey === object.skill.skillKey);
  if (existing) {
    const fields = compareFields(object.relation, existing);
    if (fields.some((field) => !field.equal)) throw new Error(`relation existing value differs: ${JSON.stringify(fields.filter((field) => !field.equal))}`);
    record.push({ kind: 'equipment-skill-relation', path, state: 'same', expected: object.relation, readback: existing, fields, listReadback: before }); return;
  }
  const row = { kind: 'equipment-skill-relation', path, state: apply ? 'created' : 'missing', expected: object.relation, preflight: before };
  if (!apply) { record.push(row); return; }
  const written = await request('POST', '/equipment-skill-relations', object.relation);
  const after = mustSuccess(await request('GET', path), `${object.equipmentKey} relation readback`).data;
  const confirmed = listItems(after).find((item) => item.skillKey === object.skill.skillKey);
  if (!confirmed) throw new Error(`relation write failed: HTTP ${written.status} ${JSON.stringify(written.data)}`);
  row.write = { status: written.status, data: written.data }; row.readback = confirmed; row.fields = compareFields(object.relation, confirmed); row.listReadback = after;
  if (row.fields.some((field) => !field.equal)) throw new Error(`relation readback differs: ${JSON.stringify(row.fields.filter((field) => !field.equal))}`);
  record.push(row);
}
async function imageRecord(object, applyImages, record) {
  const equipmentImagePath = `/equipment/${encodeURIComponent(object.equipmentKey)}/representative-image`;
  const skillImagePath = `/skills/${encodeURIComponent(object.skill.skillKey)}/representative-image`;
  const equipmentImage = mustSuccess(await request('GET', equipmentImagePath), `${object.equipmentKey} equipment image`).data;
  const imageKey = equipmentImage?.image?.imageKey;
  if (!imageKey) throw new Error(`${object.equipmentKey} has no enabled representative image`);
  const skillImageResponse = await request('GET', skillImagePath);
  if (!isSuccess(skillImageResponse) && skillImageResponse.status !== 404) throw new Error(`skill image preflight failed: HTTP ${skillImageResponse.status} ${JSON.stringify(skillImageResponse.data)}`);
  const currentImage = skillImageResponse.data?.image;
  if (currentImage) {
    if (currentImage.imageKey !== imageKey) throw new Error(`${object.skill.skillKey} representative image differs: expected ${imageKey}, got ${currentImage.imageKey}`);
    record.push({ kind: 'representative-image', path: skillImagePath, state: 'same', equipmentImagePath, equipmentImage, expectedImageKey: imageKey, readback: skillImageResponse.data }); return;
  }
  const row = { kind: 'representative-image', path: skillImagePath, state: applyImages ? 'created' : 'missing', equipmentImagePath, equipmentImage, expectedImageKey: imageKey, preflight: skillImageResponse.data };
  if (!applyImages) { record.push(row); return; }
  const written = await request('PUT', skillImagePath, { imageKey });
  const read = mustSuccess(await request('GET', skillImagePath), `${object.skill.skillKey} image readback`);
  row.write = { status: written.status, data: written.data }; row.readback = read.data;
  if (row.readback?.image?.imageKey !== imageKey) throw new Error(`representative image readback differs for ${object.skill.skillKey}`);
  record.push(row);
}
async function equipmentAttributesRecord(object, record) {
  const path = `/equipment/${encodeURIComponent(object.equipmentKey)}/attributes`;
  const read = mustSuccess(await request('GET', path), `${object.equipmentKey} direct attributes`);
  const actual = read.data?.attributeValues ?? read.data;
  const fields = compareFields(object.directAttributes, actual);
  if (fields.some((field) => !field.equal)) {
    throw new Error(`${object.equipmentKey} direct attributes differ: ${JSON.stringify(fields.filter((field) => !field.equal))}`);
  }
  record.components.push({ kind: 'equipment-direct-attributes', path, state: 'read', expected: object.directAttributes, readback: actual, fields });
}
async function runObject(object, { apply, applyImages }) {
  const skillPath = `/skills/${encodeURIComponent(object.skill.skillKey)}`;
  const record = { equipmentKey: object.equipmentKey, equipmentName: object.equipmentName, skillKey: object.skill.skillKey, sourceRefs: object.sourceRefs, pendingRules: object.pendingRules, pendingEffects: object.pendingEffects ?? [], arithmetic: object.arithmetic, directAttributes: object.directAttributes, components: [] };
  await equipmentAttributesRecord(object, record);
  const skill = await writeResource({ kind: 'skill', path: skillPath, createPath: '/skills', body: object.skill, apply, record: record.components });
  if (!skill) { record.status = '待录入'; record.missingComponentCount = 1 + object.parameters.length + object.formulas.length + object.effects.length + object.triggerRules.length + 2; return record; }
  for (const item of object.parameters) await writeResource({ kind: `parameter:${item.parameterKey}`, path: `${skillPath}/parameters/${encodeURIComponent(item.parameterKey)}`, createPath: `${skillPath}/parameters`, body: item, apply, record: record.components });
  for (const item of object.formulas) await writeResource({ kind: `formula:${item.formulaKey}`, path: `${skillPath}/formulas/${encodeURIComponent(item.formulaKey)}`, createPath: `${skillPath}/formulas`, body: item, apply, record: record.components });
  for (const item of object.effects) await writeResource({ kind: `effect:${item.effectKey}`, path: `${skillPath}/effects/${encodeURIComponent(item.effectKey)}`, createPath: `${skillPath}/effects`, body: item, apply, record: record.components });
  for (const item of object.triggerRules) await writeResource({ kind: `trigger-rule:${item.ruleKey}`, path: `${skillPath}/trigger-rules/${encodeURIComponent(item.ruleKey)}`, createPath: `${skillPath}/trigger-rules`, body: item, apply, record: record.components });
  await relationRecord(object, apply, record.components);
  await imageRecord(object, applyImages, record.components);
  record.status = '已完成可保存组成'; return record;
}
function summary(records) {
  const components = records.flatMap((record) => record.components ?? []); const fields = components.flatMap((component) => component.fields ?? []); const count = (prefix) => components.filter((component) => component.kind.startsWith(prefix)).length;
  return { equipmentCount: records.length + skippedObjects.length, processedEquipmentCount: records.length, skippedEquipmentCount: skippedObjects.length, skillCount: count('skill'), parameterCount: count('parameter:'), formulaCount: count('formula:'), effectCount: count('effect:'), triggerRuleCount: count('trigger-rule:'), relationCount: count('equipment-skill-relation'), representativeImageCount: count('representative-image'), componentCount: components.length, fieldCount: fields.length, mismatchCount: fields.filter((field) => !field.equal).length, missingCount: components.filter((component) => component.state === 'missing' || component.state === 'skill-missing').length };
}
const apply = process.argv.includes('--apply');
const applyImages = process.argv.includes('--apply-images');
const writeCandidate = process.argv.includes('--write-candidate');
if (writeCandidate) await writeFile(candidatePath, `${JSON.stringify({ generatedAt: new Date().toISOString(), objects, skipped: skippedObjects }, null, 2)}\n`, 'utf8');
const records = [];
for (const object of objects) records.push(await runObject(object, { apply, applyImages }));
const result = {
  generatedAt: new Date().toISOString(), mode: applyImages ? (apply ? '补缺并独立补图' : '独立补图') : (apply ? '补缺' : '只读逐字段回读'), apiBaseUrl, gameId: 'lol',
  source: { version: '16.17.1', clientDirectoryVersion: '16.17', hashes: await Promise.all(sourceFiles.map(hashFile)), note: '仅保存冻结来源确证的独立组成；配置保存与接口回读不等于运行时验证。' },
  objects: records, skipped: skippedObjects, summary: summary(records)
};
await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ mode: result.mode, summary: result.summary, evidencePath: evidencePath.pathname, candidatePath: writeCandidate ? candidatePath.pathname : null }, null, 2));
