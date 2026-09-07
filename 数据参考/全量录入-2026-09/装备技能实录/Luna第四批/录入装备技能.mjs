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
const resourceResult = ({ resultKey = 'resource_change', name, description, target = 'SOURCE', value, attributeKey = 'mana', operation = 'RESTORE' }) => ({
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

const skippedObjects = [
  {
    equipmentKey: 'item_3031', equipmentName: '无尽之刃', skillKey: null,
    action: '跳过新技能创建',
    reason: '冻结16.17客户端的Item_3031_Tooltip为空，mDataValues与mItemCalculations均没有独立被动；官方说明只有直接属性。本批不重复创建技能。',
    directAttributes: { attack_damage: 75, critical_strike_chance: 0.25, critical_strike_damage_bonus_percent: 0.3 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/3031/mFlatPhysicalDamageMod、mFlatCritChanceMod、mFlatCritDamageMod、mItemCalculations、mDataValues、mItemDataClient/mTooltipData/mLocKeys', evidence: '直接属性为75攻击力、25%暴击几率、30%暴击伤害；客户端没有独立计算式，Item_3031_Tooltip为空。' },
      { file: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json', pointer: '/data/3031/description、/data/3031/stats', evidence: '官方说明仅列75攻击力、25%暴击几率、30%暴击伤害，无额外被动段。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_3031_tooltip、entries/GeneratedTip_Item_3031_Description', evidence: '绑定提示为空或只生成直接属性，没有独立效果文案。' }
    ],
    pendingRules: [], arithmetic: [{ sample: '直接属性核对', expected: true, actual: true, unit: '只保留装备基础属性，未创建技能' }]
  }
];

export const objects = [
  {
    equipmentKey: 'item_3072', equipmentName: '饮血剑',
    skill: {
      skillKey: 'item_3072_passive', name: '饮血剑·灵液护盾',
      description: '保存16.17客户端确证的生命偷取溢出护盾上限：角色等级1至8为165，9级起每级增加15，18级315。上限不是实际授予量；实际溢出生命偷取金额和事件尚缺，未创建护盾效果。原始DecayTime=25只留来源，不推定完整生命周期。装备已有80攻击力和15%生命偷取，不重复施加。',
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'overshield_by_character_level', name: '灵液护盾上限', valueType: 'INTEGER', valueMode: 'CHARACTER_LEVEL', fixedValue: null, levelValues: { '1': 165, '2': 165, '3': 165, '4': 165, '5': 165, '6': 165, '7': 165, '8': 165, '9': 180, '10': 195, '11': 210, '12': 225, '13': 240, '14': 255, '15': 270, '16': 285, '17': 300, '18': 315 }, description: '当前OvershieldCalc展开的护盾上限，单位：护盾点；1至8级165，9级180，此后每级加15，18级315。实际授予量来自溢出生命偷取，不能把上限直接给满。', sortOrder: 10 }
    ],
    formulas: [],
    effects: [],
    triggerRules: [],
    pendingRules: ['当前作者配置结构缺少“生命偷取溢出治疗”的金额及事件，无法准确表达实际护盾授予量；上限参数保留，不能以SOURCE_INITIALIZED直接给满护盾。', '客户端DecayTime=25与Threshold=0.699999988079071只留在原始字段证据；尚未证明完整衰减/结束条件，不将25秒自动解释为持续到期。'],
    relation: { equipmentKey: 'item_3072', skillKey: 'item_3072_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/3072/mDataValues、Items/3072/mItemCalculations/OvershieldCalc/mFormulaParts[0]、Items/3072/mItemDataClient/mTooltipData/mLocKeys', evidence: 'DecayTime=25；Threshold=0.699999988079071；护盾计算Level1=165，等级9起每级增加15；直接属性80攻击力、0.15生命偷取。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_3072_tooltip、entries/Item_3072_TooltipExternal、entries/GeneratedTip_Item_3072_Description', evidence: '生命偷取溢出治疗转护盾，护盾上限来自OvershieldCalc。' },
      { file: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json', pointer: '/data/3072/description、/data/3072/stats', evidence: '官方说明为80攻击力、15%生命偷取和灵液护盾；基础属性已由装备自身保存。' }
    ],
    arithmetic: [{ sample: '角色等级1与8护盾上限', expected: 165, actual: 165, unit: '护盾上限点数' }, { sample: '角色等级9护盾上限', expected: 180, actual: 165 + 15, unit: '护盾上限点数' }, { sample: '角色等级18护盾上限', expected: 315, actual: 165 + 10 * 15, unit: '护盾上限点数' }]
  },
  {
    equipmentKey: 'item_3508', equipmentName: '夺萃之镰',
    skill: {
      skillKey: 'item_3508_passive', name: '夺萃之镰·咒刃',
      description: '保存16.17客户端确证的咒刃额外物理伤害与攻击特效法力回复：1.25×来源基础攻击力+50×来源暴击率，法力回复为该伤害的50%。装备已有50攻击力、20技能急速和25%暴击几率，不在技能中重复施加；施法后就绪、下一次普攻消费及1.5秒冷却接线待补。',
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'spellblade_base_ad_ratio', name: '咒刃基础攻击力倍率', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 1.25, levelValues: null, description: '咒刃额外物理伤害对来源基础攻击力的倍率，小数1表示100%。', sortOrder: 10 },
      { parameterKey: 'spellblade_crit_chance_multiplier', name: '咒刃暴击率倍率', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 50, levelValues: null, description: '客户端CritChanceMultiplier=50；来源暴击率按0至1的小数直接乘50，不是把50写成0.5。', sortOrder: 20 },
      { parameterKey: 'mana_refund_damage_multiplier', name: '法力回复伤害倍率', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.5, levelValues: null, description: '客户端TotalManaRefund为SpellbladeDamage乘0.5，小数1表示100%。', sortOrder: 30 },
      { parameterKey: 'spellblade_cooldown_ms', name: '咒刃冷却时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 1500, levelValues: null, description: '客户端SpellbladeCooldown=1.5秒，单位：毫秒；冷却消费规则待接线。', sortOrder: 50 }
    ],
    formulas: [
      { formulaKey: 'spellblade_damage', name: '咒刃额外物理伤害', description: '1.25倍来源基础攻击力加50倍来源暴击率。', sortOrder: 10, expression: operation('ADD', operation('MULTIPLY', parameterNode('spellblade_base_ad_ratio'), attribute('SOURCE', 'attack_damage', 'BASE')), operation('MULTIPLY', parameterNode('spellblade_crit_chance_multiplier'), attribute('SOURCE', 'critical_strike_chance', 'TOTAL'))) },
      { formulaKey: 'total_mana_refund', name: '咒刃攻击特效法力回复', description: '咒刃额外物理伤害的50%。', sortOrder: 20, expression: operation('MULTIPLY', parameterNode('mana_refund_damage_multiplier'), operation('ADD', operation('MULTIPLY', parameterNode('spellblade_base_ad_ratio'), attribute('SOURCE', 'attack_damage', 'BASE')), operation('MULTIPLY', parameterNode('spellblade_crit_chance_multiplier'), attribute('SOURCE', 'critical_strike_chance', 'TOTAL')))) }
    ],
    effects: [
      { effectKey: 'spellblade_damage', name: '咒刃额外物理伤害', description: '保存施法后下一次普通攻击的额外物理伤害组成，攻击特效标为普攻命中；就绪与消费不由普攻全量替代。', sortOrder: 10, lifecycle: null, results: [damageResult({ resultKey: 'spellblade_damage', name: '咒刃物理伤害', description: '1.25倍来源基础攻击力加50倍来源暴击率的额外物理伤害。', value: formula('spellblade_damage'), target: 'TARGET', damageTypeKey: 'physics', deliveryKind: 'BASIC_ATTACK' })] },
      { effectKey: 'total_mana_refund', name: '咒刃攻击特效法力回复', description: '保存攻击特效法力回复组成，实际施放和攻击命中时点待接线。', sortOrder: 20, lifecycle: null, results: [resourceResult({ resultKey: 'total_mana_refund', name: '法力回复', description: '咒刃额外物理伤害的50%恢复为来源法力值。', value: formula('total_mana_refund'), target: 'SOURCE', attributeKey: 'mana', operation: 'RESTORE' })] }
    ],
    triggerRules: [],
    pendingRules: ['施放后的就绪状态、下一次普攻同时执行伤害和回蓝、消费及1500毫秒冷却待配置，不把所有普攻直接接为咒刃。', '旧2026-06 Wiki记录中的10000毫秒就绪窗口不属于冻结16.17来源，已移出当前参数；当前版本的失效窗口需补证。', '法力回复是本轮1V1相关资源组成，已保存独立效果；还须完成实际触发配置，不能因为战斗运行不在本轮而永久跳过。'],
    relation: { equipmentKey: 'item_3508', skillKey: 'item_3508_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/3508/mDataValues、Items/3508/mItemCalculations/SpellbladeDamage、Items/3508/mItemCalculations/TotalManaRefund', evidence: 'BaseADRatio=1.25；CritChanceMultiplier=50；TotalManaRefund为SpellbladeDamage乘0.5；SpellbladeCooldown=1.5秒；直接属性50攻击力、20技能急速、25%暴击几率。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_3508_tooltip、entries/Item_3508_TooltipExternal、entries/GeneratedTip_Item_3508_TooltipInventory', evidence: '施放技能后下一次普通攻击造成额外物理伤害并提供法力值，标记为攻击特效。' },
      { file: '文档记录/详细设计/wasm/通用ABI-夺萃之镰Spellblade机制详细设计.md', pointer: '第1节数值真源与第2节伤害合同', evidence: '历史参考：10000毫秒就绪窗口来自旧2026-06 Wiki，不作为本批16.17数值来源。伤害、回蓝和1500毫秒冷却分别以当前冻结客户端为准。' },
      { file: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json', pointer: '/data/3508/description、/data/3508/stats', evidence: '官方说明为咒刃额外物理伤害与法力值攻击特效；基础属性已由装备自身保存。' }
    ],
    arithmetic: [{ sample: '基础攻击力100、暴击率0.25', expected: 137.5, actual: 1.25 * 100 + 50 * 0.25, unit: '额外物理伤害点' }, { sample: '对应法力回复', expected: 68.75, actual: 0.5 * (1.25 * 100 + 50 * 0.25), unit: '法力点' }, { sample: '1.5秒冷却换算', expected: 1500, actual: 1.5 * 1000, unit: '毫秒' }]
  },
  {
    equipmentKey: 'item_6676', equipmentName: '收集者',
    skill: {
      skillKey: 'item_6676_passive', name: '收集者·死',
      description: '保存16.17客户端确证的斩杀阈值：你的伤害使英雄生命值低于5%时执行斩杀。装备已有50攻击力、10固定护甲穿透和25%暴击几率，不在技能中重复施加；击杀额外25金币按本批范围跳过。',
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'execute_threshold', name: '斩杀生命值阈值', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.05, levelValues: null, description: '目标生命值低于5%时执行斩杀，小数0.05表示5%。', sortOrder: 10 }
    ],
    formulas: [{ formulaKey: 'execute_threshold_health', name: '斩杀生命点数阈值', description: '5%比例乘目标总生命值得到绝对生命点数；总生命值2000时阈值100。来源严格低于5%的条件还须在合法触发中配置。', sortOrder: 10, expression: operation('MULTIPLY', parameterNode('execute_threshold'), attribute('TARGET', 'hp', 'TOTAL')) }],
    effects: [{
      effectKey: 'execute_below_threshold', name: '低于阈值斩杀', description: '斩杀结果读取目标最大生命5%的绝对生命点数。通用EXECUTE比较为小于或等于；来源要求低于5%，必须在合法触发中另配严格小于条件，本独立效果不代表机制完成。', sortOrder: 10, lifecycle: null,
      results: [executeResult({ resultKey: 'execute_below_threshold', name: '斩杀', description: '绝对生命点数阈值引用execute_threshold_health，不能将比例0.05当成0.05点生命。严格小于及伤害来源、英雄目标条件仍待配置。', value: formula('execute_threshold_health'), attributeKey: 'hp', target: 'TARGET' })]
    }],
    triggerRules: [],
    pendingRules: ['来源语义是“你的伤害”结算后检查英雄目标；DAMAGE_DEALT事件存在，但TARGET_CATEGORY_CHECK按现有管理结构只适用于SKILL_HIT或BASIC_ATTACK_HIT，无法同时覆盖所有伤害并准确限定英雄。本批不接一个会误杀小兵或漏掉技能伤害的宽泛规则。', '来源要求生命严格低于5%，通用EXECUTE结果判断为小于或等于绝对阈值，后续合法触发必须配置严格LT；最大生命2000时剩余100不符合来源条件，99符合。', '击杀英雄额外25金币属于本批明确跳过的金币效果，不计入待补机制。'],
    relation: { equipmentKey: 'item_6676', skillKey: 'item_6676_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/6676/mDataValues、Items/6676/mFlatPhysicalDamageMod、Items/6676/mFlatCritChanceMod、Items/6676/PhysicalLethality', evidence: 'ExecuteThreshold=0.05000000074505806；GoldAmount=25；直接属性50攻击力、25%暴击几率、10固定护甲穿透。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_6676_tooltip、entries/GeneratedTip_Item_6676_Description', evidence: '你的伤害会处决低于5%生命值的英雄；击杀英雄提供25额外金币。' },
      { file: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json', pointer: '/data/6676/description、/data/6676/stats', evidence: '官方说明与客户端一致；金币段按任务范围跳过。' }
    ],
    arithmetic: [{ sample: '目标最大生命值2000，5%阈值', expected: 100, actual: 0.05 * 2000, unit: '生命点阈值' }]
  },
  {
    equipmentKey: 'item_3140', equipmentName: '水银饰带',
    skill: {
      skillKey: 'item_3140_active', name: '水银饰带·水银',
      description: '保存16.17客户端确证的主动冷却：90秒。主动说明为移除所有控制类减益效果但滞空除外；现有状态操作只能按单个已登记状态移除，不能准确表达通用控制类别和滞空例外，因此本批不创建缩窄后的错误效果。',
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: []
    },
    parameters: [
      { parameterKey: 'active_cooldown_ms', name: '水银主动冷却', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 90000, levelValues: null, description: '客户端Cooldown=90秒，单位：毫秒。', sortOrder: 10 }
    ],
    formulas: [], effects: [], triggerRules: [],
    pendingRules: ['当前STATUS_OPERATION只能引用单个已存在状态；共享状态目录当前没有通用控制类别，也没有滞空排除条件。若只移除现有眩晕会把“所有控制类减益”错误缩小，因此不写效果或主动触发。', 'API已有的技能分类只有普通技能、被动技能和位移技能；本主动技能使用空分类列表，不新增共享分类。'],
    relation: { equipmentKey: 'item_3140', skillKey: 'item_3140_active', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/3140/mDataValues/Cooldown、Items/3140/mFlatSpellBlockMod、Items/3140/mItemDataClient/mTooltipData/mLocKeys', evidence: 'Cooldown=90秒；直接属性30魔法抗性；主动键为Item_3140_Active。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_3140_active、entries/Item_3140_ActiveExternal', evidence: '主动移除所有控制类减益效果，滞空除外。' },
      { file: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json', pointer: '/data/3140/description、/data/3140/stats', evidence: '官方说明为30魔法抗性和水银主动；基础属性已由装备自身保存。' }
    ],
    arithmetic: [{ sample: '90秒换算', expected: 90000, actual: 90 * 1000, unit: '毫秒' }]
  },
  {
    equipmentKey: 'item_3157', equipmentName: '中娅沙漏',
    skill: {
      skillKey: 'item_3157_active', name: '中娅沙漏·时间停止',
      description: '保存16.17客户端确证的主动冷却和凝滞中的无敌组成：持续2.5秒、冷却120秒、来源承受全类型伤害免疫。不可选取、行动限制和主动施放接线分别待补；装备已有105法术强度和50护甲，不在技能中重复施加。',
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: []
    },
    parameters: [
      { parameterKey: 'stasis_duration_ms', name: '凝滞持续时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 2500, levelValues: null, description: '客户端Duration=2.5秒，单位：毫秒。', sortOrder: 10 },
      { parameterKey: 'active_cooldown_ms', name: '时间停止冷却', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 120000, levelValues: null, description: '客户端Cooldown=120秒，单位：毫秒。', sortOrder: 20 }
    ],
    formulas: [],
    effects: [{
      effectKey: 'stasis_damage_immunity', name: '凝滞伤害免疫', description: '保存凝滞期间对所有伤害类型的免疫组成，持续时间来自stasis_duration_ms；不可选取和行动限制不混入该结果。', sortOrder: 10,
      lifecycle: timedLifecycle(parameter('stasis_duration_ms')),
      results: [damageImmunityResult({ resultKey: 'stasis_damage_immunity', name: '全类型伤害免疫', description: '来源在凝滞持续期间免疫所有伤害类型。', target: 'SOURCE', damageTypeKey: null, deliveryKind: 'ANY', originKind: 'ANY' })]
    }],
    triggerRules: [],
    pendingRules: ['现有结果类型可以表达全类型DAMAGE_IMMUNITY，已保存该独立组成；不可选取和凝滞行动限制属于现有作者配置结构缺口，不是一个新增状态键即可完成。', '主动施放过程可以用现有结构继续配置；它与尚不可完整表达的不可选取及行动限制分开记账，不把SOURCE_INITIALIZED用于主动技能。', 'API已有的技能分类没有主动分类，本技能使用空分类列表，不新增共享分类。'],
    relation: { equipmentKey: 'item_3157', skillKey: 'item_3157_active', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/3157/mDataValues/Duration、Items/3157/mDataValues/Cooldown、Items/3157/mEffectAmount、Items/3157/mFlatArmorMod、Items/3157/mFlatMagicDamageMod、Items/3157/mItemDataClient/mTooltipData/mLocKeys', evidence: 'Duration=2.5秒；Cooldown=120秒；效果数组2.5/120；直接属性50护甲、105法术强度。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_3157_active、entries/item_3157_tooltipextended、entries/Item_3157_ActiveExternal', evidence: '主动进入凝滞状态2.5秒，冷却由客户端替换值显示。' },
      { file: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json', pointer: '/data/3157/description、/data/3157/stats', evidence: '官方说明为105法术强度、50护甲和进入凝滞2.5秒；基础属性已由装备自身保存。' }
    ],
    arithmetic: [{ sample: '2.5秒换算', expected: 2500, actual: 2.5 * 1000, unit: '毫秒' }, { sample: '120秒换算', expected: 120000, actual: 120 * 1000, unit: '毫秒' }]
  }
];


const sourceFiles = [
  '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz',
  '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz',
  '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json',
  '文档记录/详细设计/wasm/通用ABI-夺萃之镰Spellblade机制详细设计.md'
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
async function runObject(object, { apply, applyImages }) {
  const skillPath = `/skills/${encodeURIComponent(object.skill.skillKey)}`;
  const record = { equipmentKey: object.equipmentKey, equipmentName: object.equipmentName, skillKey: object.skill.skillKey, sourceRefs: object.sourceRefs, pendingRules: object.pendingRules, arithmetic: object.arithmetic, components: [] };
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
export { skippedObjects, compareFields, request };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
