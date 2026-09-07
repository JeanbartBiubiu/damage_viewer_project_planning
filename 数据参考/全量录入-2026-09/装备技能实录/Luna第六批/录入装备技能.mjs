import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const stackedTimedLifecycle = (durationValue, maxStacksValue) => ({
  durationValue,
  maxStacksValue,
  applicationStacksValue: fixed(1),
  instanceScope: 'SOURCE',
  reapplicationStackMode: 'INCREASE',
  reapplicationDurationMode: 'REFRESH_ALL',
  expiryMode: 'ALL_AT_ONCE',
  periodicIntervalValue: null,
  firstPeriodicExecution: null
});
const permanentStackLifecycle = (maxStacksValue) => ({
  durationValue: null,
  maxStacksValue,
  applicationStacksValue: fixed(1),
  instanceScope: 'SOURCE',
  reapplicationStackMode: 'INCREASE',
  reapplicationDurationMode: null,
  expiryMode: 'EXPLICIT_ONLY',
  periodicIntervalValue: null,
  firstPeriodicExecution: null
});
const stackedAttributeBehavior = {
  moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'PER_STACK',
  reapplicationValueMode: null, periodicExecutionMode: null
};
const skillHasteBehavior = {
  moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED',
  reapplicationValueMode: 'KEEP', periodicExecutionMode: null
};
const skillHasteModifierResult = ({ resultKey, name, description, value, affectedSkillScope, lifecycleBehavior = skillHasteBehavior }) => ({
  resultKey, name, resultType: 'SKILL_HASTE_MODIFIER', target: 'SOURCE', description, sortOrder: 10,
  lifecycleBehavior, spellShieldBlockScope: null, valueRule: effectValue(value),
  detail: { operation: 'INCREASE', affectedSkillScope }
});

const skippedObjects = [];
export const objects = [
  {
    equipmentKey: 'item_3047', equipmentName: '铁板靴',
    directAttributes: { armor: 25, move_speed: 45 },
    skill: {
      skillKey: 'item_3047_passive', name: '铁板靴·镀板',
      description: '保存16.17客户端与官方16.17.1说明共同确证的镀板10%攻击伤害降低参数；装备自身25护甲与45移动速度不在技能中重复施加。当前管理目录没有DAMAGE修正乘区，因此不把属性乘区冒充攻击伤害减免，效果与触发留待补配。',
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'incoming_attack_damage_reduction', name: '镀板攻击伤害降低比例', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.1, levelValues: null, description: '即将到来的攻击伤害降低10%，小数0.1表示10%。', sortOrder: 10 }
    ],
    formulas: [], effects: [], triggerRules: [],
    pendingRules: [
      '来源只确认即将到来的攻击伤害降低10%，当前GET /modifier-zones?domain=DAMAGE为空，DAMAGE_MODIFIER无法引用有效修正乘区。',
      '可通过SOURCE_INITIALIZED建立持续受到伤害修正，不依赖DAMAGE_TAKEN受伤后事件；严格攻击类型/附伤/技能攻击分类仍需核清。'
    ],
    pendingEffects: [{
      effectKey: 'incoming_attack_damage_reduction', resultType: 'DAMAGE_MODIFIER', target: 'SOURCE',
      valueRule: effectValue(parameter('incoming_attack_damage_reduction')),
      detail: { modifierZoneKey: null, direction: 'TAKEN', operation: 'DECREASE', damageTypeKey: null, deliveryKind: 'BASIC_ATTACK', originKind: 'ANY', criticalFilter: 'ANY' },
      reason: '来源参数已保存；DAMAGE修正乘区目录为空，不能填入attribute_percent_bonus等错误乘区。'
    }],
    relation: { equipmentKey: 'item_3047', skillKey: 'item_3047_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/3047/mEffectAmount、mScripts、mFlatMovementSpeedMod、mFlatArmorMod、mItemDataClient/mTooltipData/mLocKeys', evidence: 'mEffectAmount[0]=0.1；mScripts包含ItemBootsTabi；直接属性为45移动速度、25护甲。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_3047_tooltip、entries/generatedtip_item_3047_externaldescription', evidence: '镀板使即将到来的攻击伤害降低10%。' },
      { file: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json', pointer: '/data/3047/description、/data/3047/stats', evidence: '官方说明与客户端一致，固定属性为25护甲、45移动速度。' }
    ],
    arithmetic: [{ sample: '单次100点即将到来的攻击伤害的确证减免参数', expected: 10, actual: 0.1 * 100, unit: '伤害点；仅算术样例，未执行运行时' }]
  },
  {
    equipmentKey: 'item_3065', equipmentName: '振奋盔甲',
    directAttributes: { hp: 400, magic_resistance: 50, ability_haste: 10, base_hp_regen_percent: 1 },
    skill: {
      skillKey: 'item_3065_passive', name: '振奋盔甲·无拘活力',
      description: '保存16.17客户端与官方16.17.1说明共同确证的自身治疗和护盾效果提升25%；装备自身400生命值、50魔抗、10技能急速、100%基础生命回复不在技能中重复施加。',
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'heal_shield_power_bonus', name: '无拘活力受到治疗护盾增幅', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.25, levelValues: null, description: '自身受到的治疗与护盾数量提升25%，小数0.25表示25%；这不是施放治疗护盾强度属性。治疗修正待配，收到护盾增幅待结构补齐。', sortOrder: 10 }
    ],
    formulas: [],
    effects: [],
    triggerRules: [],
    pendingRules: ['受到治疗增幅可用HEALING_MODIFIER方向TAKEN表达，但治疗修正乘区目录待配；受到护盾增幅为现作者态结构缺口。已撤错误强度属性效果与初始化规则，不用施放强度属性替代。'],
    pendingEffects: [],
    relation: { equipmentKey: 'item_3065', skillKey: 'item_3065_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/3065/mDataValues/HealingIncrease、ShieldIncrease、mAbilityHasteMod、mFlatHPPoolMod、mPercentBaseHPRegenMod、mFlatSpellBlockMod、mItemDataClient/mTooltipData/mLocKeys', evidence: 'HealingIncrease=0.25、ShieldIncrease=0.25；直接属性为400生命值、50魔抗、10技能急速、100%基础生命回复。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_3065_tooltip、entries/generatedtip_item_3065_externaldescription', evidence: '无拘活力使自身治疗和护盾效果提升25%。' },
      { file: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json', pointer: '/data/3065/description、/data/3065/stats', evidence: '官方说明与客户端一致。' }
    ],
    arithmetic: [{ sample: '基础治疗100点的25%增益', expected: 125, actual: 100 + 0.25 * 100, unit: '治疗点；仅算术样例，未执行运行时' }, { sample: '基础护盾100点的25%增益', expected: 125, actual: 100 + 0.25 * 100, unit: '护盾点；仅算术样例，未执行运行时' }]
  },
  {
    equipmentKey: 'item_6621', equipmentName: '黎明核心',
    directAttributes: { ability_power: 45, heal_shield_power_percent: 0.16, base_mana_regen_percent: 1 },
    skill: {
      skillKey: 'item_6621_passive', name: '黎明核心·最初之光',
      description: '保存16.17客户端与官方16.17.1说明共同确证的属性依赖：每100%基础法力回复额外获得2%治疗和护盾强度与10法术强度。装备直接的45法术强度、16%治疗和护盾强度、100%基础法力回复不在技能结果中重复施加。',
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'ap_per_100_base_mana_regen', name: '每100%基础法力回复法术强度', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 10, levelValues: null, description: '每1.0（100%）基础法力回复提供10点法术强度。', sortOrder: 10 },
      { parameterKey: 'heal_shield_per_100_base_mana_regen', name: '每100%基础法力回复治疗护盾强度', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.02, levelValues: null, description: '每1.0（100%）基础法力回复提供0.02治疗和护盾强度，小数0.02表示2%。', sortOrder: 20 }
    ],
    formulas: [
      { formulaKey: 'ap_from_base_mana_regen', name: '基础法力回复转法术强度', description: '基础法力回复比例乘以每100%基础法力回复提供的法术强度。', sortOrder: 10, expression: operation('MULTIPLY', attribute('SOURCE', 'base_mana_regen_percent', 'TOTAL'), parameterNode('ap_per_100_base_mana_regen')) },
      { formulaKey: 'heal_shield_from_base_mana_regen', name: '基础法力回复转治疗护盾强度', description: '基础法力回复比例乘以每100%基础法力回复提供的治疗和护盾强度。', sortOrder: 20, expression: operation('MULTIPLY', attribute('SOURCE', 'base_mana_regen_percent', 'TOTAL'), parameterNode('heal_shield_per_100_base_mana_regen')) }
    ],
    effects: [
      { effectKey: 'ap_from_base_mana_regen', name: '基础法力回复转法术强度', description: '按来源对象基础法力回复比例增加法术强度。', sortOrder: 10, lifecycle: explicitLifecycle(), results: [attributeResult({ resultKey: 'ap_from_base_mana_regen', name: '基础法力回复提供的法术强度', description: '每100%基础法力回复提供10点法术强度。', attributeKey: 'ability_power', value: formula('ap_from_base_mana_regen'), lifecycleBehavior: persistentBehavior(null, 'MOMENT_EVALUATION') })] },
      { effectKey: 'heal_shield_from_base_mana_regen', name: '基础法力回复转治疗护盾强度', description: '按来源对象基础法力回复比例增加治疗和护盾强度。', sortOrder: 20, lifecycle: explicitLifecycle(), results: [attributeModifierResult({ resultKey: 'heal_shield_from_base_mana_regen', name: '基础法力回复提供的治疗护盾强度', description: '每100%基础法力回复提供2%治疗和护盾强度。', attributeKey: 'heal_shield_power_percent', value: formula('heal_shield_from_base_mana_regen'), modifierZoneKey: 'attribute_flat_add', lifecycleBehavior: persistentBehavior(null, 'MOMENT_EVALUATION') })] }
    ],
    triggerRules: [{
      ruleKey: 'initialize_dawncore_scaling', name: '初始化最初之光', description: '装备持有时读取来源对象基础法力回复比例并分别执行法术强度与治疗护盾强度增益。', sortOrder: 10,
      eventSource: { eventType: 'SOURCE_INITIALIZED', detail: {} }, conditionGroups: [],
      actions: [
        { actionKey: 'execute_ap_from_base_mana_regen', name: '执行基础法力回复法术强度', actionType: 'EXECUTE_EFFECT', sortOrder: 10, targetContext: 'EVENT_SOURCE', detail: { effectKey: 'ap_from_base_mana_regen' }, runtimeInputBindings: [], resultModifiers: [] },
        { actionKey: 'execute_heal_shield_from_base_mana_regen', name: '执行基础法力回复治疗护盾强度', actionType: 'EXECUTE_EFFECT', sortOrder: 20, targetContext: 'EVENT_SOURCE', detail: { effectKey: 'heal_shield_from_base_mana_regen' }, runtimeInputBindings: [], resultModifiers: [] }
      ],
      perTargetCooldown: null, maxTriggersPerProcess: null
    }],
    pendingRules: ['初始化建立持续效果，按当前基础法力回复TOTAL动态求值；强度属性固定加算。配置与独立回读不代表实际运行通过。'],
    pendingEffects: [],
    relation: { equipmentKey: 'item_6621', skillKey: 'item_6621_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/6621/mDataValues/APPerManaRegen、HSPowerPerManaRegen、mFlatMagicDamageMod、mPercentHealingAmountMod、percentBaseMPRegenMod、mScripts、mItemDataClient/mTooltipData/mLocKeys', evidence: 'APPerManaRegen=10、HSPowerPerManaRegen=0.02；直接属性为45法术强度、16%治疗和护盾强度、100%基础法力回复；脚本为6621。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_6621_tooltip、entries/item_6621_tooltipexternal、entries/item_6621_inventoryonlytext', evidence: '每100%基础法力回复获得2%治疗和护盾强度与10法术强度。' },
      { file: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json', pointer: '/data/6621/description、/data/6621/stats', evidence: '官方说明与客户端一致。' }
    ],
    arithmetic: [{ sample: '100%基础法力回复的额外法术强度', expected: 10, actual: 1 * 10, unit: '法术强度点；仅算术样例，未执行运行时' }, { sample: '100%基础法力回复的额外治疗护盾强度', expected: 0.02, actual: 1 * 0.02, unit: '比例，小数0.02等于2%；仅算术样例，未执行运行时' }]
  },
  {
    equipmentKey: 'item_3124', equipmentName: '鬼索的狂暴之刃',
    directAttributes: { attack_damage: 30, ability_power: 30, bonus_attack_speed_percent: 0.25 },
    skill: {
      skillKey: 'item_3124_passive', name: '鬼索的狂暴之刃·怨怒与沸腾打击',
      description: '保存16.17客户端绑定计算树与官方16.17.1说明共同确证的攻击附带30点魔法伤害、攻击提供8%攻速且最多4层持续3秒。装备自身30攻击力、30法术强度、25%攻击速度不在技能结果中重复施加；当前仅接已有BASIC_ATTACK_HIT，第三次攻击双攻击特效的计数与递归防止留待补配。',
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'on_hit_magic_damage', name: '怨怒额外魔法伤害', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 30, levelValues: null, description: '攻击命中附带30点额外魔法伤害，单位：伤害点。', sortOrder: 10 },
      { parameterKey: 'attack_speed_per_stack', name: '沸腾打击每层攻击速度', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.08, levelValues: null, description: '每次攻击获得8%攻击速度，小数0.08表示8%。', sortOrder: 20 },
      { parameterKey: 'attack_speed_stack_duration_ms', name: '沸腾打击层数持续时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 3000, levelValues: null, description: '攻速层数持续3秒，单位：毫秒。', sortOrder: 30 },
      { parameterKey: 'attack_speed_max_stacks', name: '沸腾打击最大层数', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 4, levelValues: null, description: '沸腾打击最多叠加4层。', sortOrder: 40 }
    ],
    formulas: [{ formulaKey: 'max_attack_speed_bonus', name: '沸腾打击满层攻击速度', description: '按客户端MaxAttackSpeedCalc计算每层8%乘以4层，满层为32%。', sortOrder: 10, expression: operation('MULTIPLY', parameterNode('attack_speed_per_stack'), parameterNode('attack_speed_max_stacks')) }],
    effects: [
      { effectKey: 'on_hit_magic_damage', name: '怨怒攻击附伤', description: '攻击命中时造成30点额外魔法伤害攻击特效。', sortOrder: 10, lifecycle: null, results: [damageResult({ resultKey: 'on_hit_magic_damage', name: '怨怒魔法伤害', description: '每次普通攻击命中造成30点额外魔法伤害。', value: parameter('on_hit_magic_damage'), target: 'TARGET', damageTypeKey: 'magic', deliveryKind: 'BASIC_ATTACK', originKind: 'DIRECT' })] },
      { effectKey: 'attack_speed_stack', name: '沸腾打击攻击速度层数', description: '每次普通攻击命中获得8%攻击速度，最多4层，持续3秒。', sortOrder: 20, lifecycle: stackedTimedLifecycle(parameter('attack_speed_stack_duration_ms'), parameter('attack_speed_max_stacks')), results: [attributeResult({ resultKey: 'attack_speed_stack', name: '沸腾打击攻击速度', description: '每层增加8%攻击速度。', attributeKey: 'bonus_attack_speed_percent', value: parameter('attack_speed_per_stack'), lifecycleBehavior: stackedAttributeBehavior })] }
    ],
    triggerRules: [{
      ruleKey: 'resolve_rageblade_basic_attack', name: '普通攻击命中结算怨怒与沸腾打击', description: '按来源攻击附带与普通攻击叠层文案监听BASIC_ATTACK_HIT；技能触发攻击特效不扩大到该事件，第三次攻击双附伤另行待配。', sortOrder: 10,
      eventSource: { eventType: 'BASIC_ATTACK_HIT', detail: {} }, conditionGroups: [],
      actions: [
        { actionKey: 'execute_on_hit_magic_damage', name: '执行怨怒额外魔法伤害', actionType: 'EXECUTE_EFFECT', sortOrder: 10, targetContext: 'CURRENT_TARGET', detail: { effectKey: 'on_hit_magic_damage' }, runtimeInputBindings: [], resultModifiers: [] },
        { actionKey: 'execute_attack_speed_stack', name: '执行沸腾打击层数', actionType: 'EXECUTE_EFFECT', sortOrder: 20, targetContext: 'CURRENT_TARGET', detail: { effectKey: 'attack_speed_stack' }, runtimeInputBindings: [], resultModifiers: [] }
      ],
      perTargetCooldown: null, maxTriggersPerProcess: null
    }],
    pendingRules: ['攻击附带目前只用BASIC_ATTACK_HIT，技能触发攻击特效是否复用该事件未宣称覆盖。', '客户端说明的满层每第三次攻击附带2次攻击特效需要攻击计数、满层条件和自触发递归防止；本批未伪造内部状态或重复攻击结果。'],
    pendingEffects: [],
    relation: { equipmentKey: 'item_3124', skillKey: 'item_3124_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/3124/mDataValues/OnHitDamage、AttackSpeedPerStack、MaxStacks、BuffDuration、mItemCalculations/MaxAttackSpeedCalc、mFlatPhysicalDamageMod、mFlatMagicDamageMod、mPercentAttackSpeedMod、mItemDataClient/mTooltipData/mLocKeys', evidence: 'OnHitDamage=30、AttackSpeedPerStack=0.08、MaxStacks=4、BuffDuration=3；MaxAttackSpeedCalc为每层攻速乘最大层数；直接属性30攻击力、30法术强度、25%攻击速度。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_3124_tooltip、entries/item_3124_tooltipdynamic、entries/generatedtip_item_3124_externaldescription', evidence: '怨怒攻击造成30额外魔法攻击特效；沸腾打击每层8%攻速、持续3秒、4层，满层每第三次攻击附带2次攻击特效。' },
      { file: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json', pointer: '/data/3124/description、/data/3124/stats', evidence: '官方说明与客户端一致。' }
    ],
    arithmetic: [{ sample: '单次普通攻击怨怒附伤', expected: 30, actual: 30, unit: '魔法伤害点；仅算术样例，未执行运行时' }, { sample: '满层攻击速度增益', expected: 0.32, actual: 0.08 * 4, unit: '比例，小数0.32等于32%；仅算术样例，未执行运行时' }]
  },
  {
    equipmentKey: 'item_3008', equipmentName: '暴食胫甲',
    directAttributes: { move_speed: 45, omnivamp_percent: 0.04 },
    skill: {
      skillKey: 'item_3008_passive', name: '暴食胫甲·杀戮',
      description: '保存16.17客户端与官方16.17.1说明共同确证的参与击杀英雄后每层0.6%全能吸血、最多10层；装备自身45移动速度与4%全能吸血不在技能中重复施加。',
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'omnivamp_per_kill_stack', name: '杀戮每层全能吸血', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.006, levelValues: null, description: '参与击杀英雄后每层获得0.6%全能吸血，小数0.006表示0.6%。', sortOrder: 10 },
      { parameterKey: 'omnivamp_max_stacks', name: '杀戮最大层数', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 10, levelValues: null, description: '杀戮最多叠加10层。', sortOrder: 20 }
    ],
    formulas: [],
    effects: [{
      effectKey: 'omnivamp_kill_stack', name: '杀戮全能吸血层数', description: '参与击杀英雄后获得0.6%全能吸血，最多10层，永久保留。', sortOrder: 10,
      lifecycle: permanentStackLifecycle(parameter('omnivamp_max_stacks')),
      results: [attributeResult({ resultKey: 'omnivamp_kill_stack', name: '参与击杀全能吸血', description: '每次参与击杀英雄增加0.6%全能吸血。', attributeKey: 'omnivamp_percent', value: parameter('omnivamp_per_kill_stack'), lifecycleBehavior: stackedAttributeBehavior })]
    }],
    triggerRules: [],
    pendingRules: ['来源为参与击杀英雄叠全能吸血，当前KILL不能限定英雄类别，参与击杀也需正确事件。效果结果SOURCE已能指向持有者，不因缺EVENT_SOURCE误判无法给本人；保持无过宽触发。45移速是直接属性。'],
    pendingEffects: [],
    relation: { equipmentKey: 'item_3008', skillKey: 'item_3008_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/3008/mDataValues/OmnivampOnTakedown、Items/3008/mDataValues/MaxStacks、Items/3008/mFlatMovementSpeedMod、Items/3008/mItemDataClient/mTooltipData/mLocKeys', evidence: 'OmnivampOnTakedown=0.006、MaxStacks=10、mFlatMovementSpeedMod=45；4%直接全能吸血由同版本说明核对。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_3008_tooltip、entries/generatedtip_item_3008_externaldescription', evidence: '杀戮参与击杀英雄后获得0.6%全能吸血，可叠加至多10次。' },
      { file: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json', pointer: '/data/3008/description、/data/3008/stats', evidence: '官方说明与客户端一致。' }
    ],
    arithmetic: [{ sample: '1次参与击杀的全能吸血增益', expected: 0.006, actual: 0.006, unit: '比例，小数0.006等于0.6%；仅算术样例，未执行运行时' }, { sample: '10层累计全能吸血增益', expected: 0.06, actual: 0.006 * 10, unit: '比例，小数0.06等于6%；仅算术样例，未执行运行时' }]
  },
  {
    equipmentKey: 'item_3161', equipmentName: '朔极之矛',
    directAttributes: { attack_damage: 45, hp: 450 },
    skill: {
      skillKey: 'item_3161_passive', name: '朔极之矛·龙之力量与专注意志',
      description: '保存16.17客户端与官方16.17.1说明共同确证的25基础技能急速，以及技能造成伤害后英雄技能和被动伤害每层提升3%、持续6秒、最多4层。装备自身45攻击力与450生命值不在技能中重复施加；当前仅保存可准确表达的基础技能急速，伤害增幅乘区与触发筛选留待补配。',
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'basic_skill_haste', name: '龙之力量基础技能急速', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 25, levelValues: null, description: '基础技能获得25点技能急速，基础技能范围使用现有common技能类别保存。', sortOrder: 10 },
      { parameterKey: 'skill_damage_bonus_per_stack', name: '专注意志每层伤害增益', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.03, levelValues: null, description: '英雄技能和被动伤害每层提升3%，小数0.03表示3%。', sortOrder: 20 },
      { parameterKey: 'skill_damage_bonus_duration_ms', name: '专注意志持续时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 6000, levelValues: null, description: '专注意志持续6秒，单位：毫秒。', sortOrder: 30 },
      { parameterKey: 'skill_damage_bonus_max_stacks', name: '专注意志最大层数', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 4, levelValues: null, description: '专注意志最多叠加4层。', sortOrder: 40 }
    ],
    formulas: [],
    effects: [{
      effectKey: 'basic_skill_haste', name: '龙之力量基础技能急速', description: '来源对象基础技能类别获得25点技能急速。', sortOrder: 10, lifecycle: explicitLifecycle(),
      results: [skillHasteModifierResult({ resultKey: 'basic_skill_haste', name: '基础技能急速提升', description: '基础技能类别技能急速增加25点。', value: parameter('basic_skill_haste'), affectedSkillScope: { mode: 'CATEGORIES', skillKeys: [], skillCategoryKeys: ['common'] } })]
    }],
    triggerRules: [{
      ruleKey: 'initialize_basic_skill_haste', name: '初始化龙之力量', description: '装备持有时对现有common技能类别应用25点技能急速；仅完成配置与回读。', sortOrder: 10,
      eventSource: { eventType: 'SOURCE_INITIALIZED', detail: {} }, conditionGroups: [],
      actions: [{ actionKey: 'execute_basic_skill_haste', name: '执行基础技能急速', actionType: 'EXECUTE_EFFECT', sortOrder: 10, targetContext: 'EVENT_SOURCE', detail: { effectKey: 'basic_skill_haste' }, runtimeInputBindings: [], resultModifiers: [] }],
      perTargetCooldown: null, maxTriggersPerProcess: null
    }],
    pendingRules: ['专注意志需要英雄技能与装备技能来源区分，含被动伤害且原文CastIDLockout=1，即每次施法1000毫秒锁定；每目标冷却不能替代。另需6秒刷新与4层，DAMAGE乘区待配；未写宽泛触发。'],
    pendingEffects: [{
      effectKey: 'skill_damage_bonus', resultType: 'DAMAGE_MODIFIER', target: 'SOURCE',
      valueRule: effectValue(parameter('skill_damage_bonus_per_stack')),
      detail: { modifierZoneKey: null, direction: 'DEALT', operation: 'INCREASE', damageTypeKey: null, deliveryKind: 'SKILL', originKind: 'ANY', criticalFilter: 'ANY' },
      reason: 'DAMAGE修正乘区目录为空，且技能/被动分类与每次施法叠层尚未由当前触发条件完整表达。'
    }],
    relation: { equipmentKey: 'item_3161', skillKey: 'item_3161_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/3161/mDataValues/SpellDamageIncrease、Items/3161/mDataValues/AHBase、Items/3161/mDataValues/StackDuration、Items/3161/mDataValues/StackCount、Items/3161/mDataValues/CastIDLockout、Items/3161/mFlatPhysicalDamageMod、Items/3161/mFlatHPPoolMod、Items/3161/mItemDataClient/mTooltipData/mLocKeys', evidence: 'SpellDamageIncrease=0.03、AHBase=25、StackDuration=6、StackCount=4、CastIDLockout=1秒；直接属性为45攻击力、450生命值。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_3161_tooltip、entries/generatedtip_item_3161_externaldescription', evidence: '龙之力量提供25基础技能急速；专注意志为技能造成伤害后的3%/层、6秒、4层。' },
      { file: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json', pointer: '/data/3161/description、/data/3161/stats', evidence: '官方说明与客户端一致。' }
    ],
    arithmetic: [{ sample: '基础技能急速', expected: 25, actual: 25, unit: '急速点；仅算术样例，未执行运行时' }, { sample: '专注意志理论满层增益', expected: 0.12, actual: 0.03 * 4, unit: '比例，小数0.12等于12%；仅算术样例，未执行运行时' }]
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
async function main() {
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
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) await main();
