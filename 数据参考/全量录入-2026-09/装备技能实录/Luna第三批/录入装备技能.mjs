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

const objects = [
{
  "equipmentKey": "item_1054",
  "equipmentName": "多兰之盾",
  "skill": {
    "skillKey": "item_1054_passive",
    "name": "多兰之盾·耐久专注",
    "description": "保存受英雄伤害后的8秒回复参数、近战40与远程30的回复上限、群体或周期伤害的治疗效能。已损失生命到总回复量的函数与刷新接线待补。每5秒固定4点回复已归入装备hp_regen直接属性，小兵额外伤害按本轮范围排除。",
    "maxLevel": 1,
    "status": "ENABLED",
    "sortOrder": 0,
    "skillCategoryKeys": [
      "passive"
    ]
  },
  "parameters": [
    {
      "parameterKey": "hero_damage_regen_duration_ms",
      "name": "受击回复持续时间",
      "valueType": "INTEGER",
      "valueMode": "FIXED",
      "fixedValue": 8000,
      "levelValues": null,
      "description": "承受英雄伤害后的回复持续时间，单位：毫秒。",
      "sortOrder": 20
    },
    {
      "parameterKey": "hero_damage_regen_cap_melee",
      "name": "近战受击回复上限",
      "valueType": "INTEGER",
      "valueMode": "FIXED",
      "fixedValue": 40,
      "levelValues": null,
      "description": "受击回复近战上限，单位：生命点。具体函数待证。",
      "sortOrder": 30
    },
    {
      "parameterKey": "hero_damage_regen_cap_ranged",
      "name": "远程受击回复上限",
      "valueType": "INTEGER",
      "valueMode": "FIXED",
      "fixedValue": 30,
      "levelValues": null,
      "description": "受击回复远程上限，单位：生命点；不是0.66乘近战上限。",
      "sortOrder": 40
    },
    {
      "parameterKey": "area_periodic_heal_efficiency",
      "name": "群体周期治疗效能",
      "valueType": "DECIMAL",
      "valueMode": "FIXED",
      "fixedValue": 0.6600000262260437,
      "levelValues": null,
      "description": "群体或周期伤害触发的治疗效能，小数1表示100%；不作为远程上限。",
      "sortOrder": 50
    }
  ],
  "formulas": [],
  "effects": [],
  "triggerRules": [],
  "pendingRules": [
    "受英雄伤害后的8秒回复需要已损失生命函数、启动时点与重复受击刷新规则；本批只保存确证参数。",
    "群体或周期治疗0.66没有被误接为全局减疗或远程上限。"
  ],
  "relation": {
    "equipmentKey": "item_1054",
    "skillKey": "item_1054_passive",
    "sortOrder": 10
  },
  "sourceRefs": [
    {
      "file": "数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz",
      "pointer": "Items~11054/mDataValues/0..4、mFlatHPRegenMod",
      "evidence": "RegenDuration=8；BonusDamageToMinions=5；MaxRegenAmount=40；RangeRegenMult=0.6600000262260437；MaxRangeRegenAmount=30；FlatHPRegenMod=0.800000011920929。"
    },
    {
      "file": "数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz",
      "pointer": "entries/item_1054_tooltip、item_1054_tooltipextendedrules",
      "evidence": "每5秒回复4生命；英雄受击8秒内回复；攻击小兵额外5物理伤害；群体或周期治疗效能66%。"
    }
  ],
  "arithmetic": [
    {
      "sample": "FlatHPRegenMod=0.8 × 5",
      "expected": 4,
      "actual": 4,
      "unit": "生命点/5秒"
    }
  ]
},
  {
    equipmentKey: 'item_3153', equipmentName: '破败王者之刃',
    skill: {
      skillKey: 'item_3153_passive', name: '破败王者之刃·雾之锋与抓挠之影',
      description: '保存当前生命值百分比普攻额外物理伤害的近战与远程分支，以及三次攻击英雄后的30%减速1秒和冷却15秒参数。攻击计数窗口字段存在但当前脚本读取、目标独立计数和切换目标行为未证。',
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'on_hit_damage_ratio_melee', name: '近战当前生命伤害比例', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.09000000357627869, levelValues: null, description: '目标当前生命值的额外物理伤害比例，小数1表示100%。', sortOrder: 10 },
      { parameterKey: 'on_hit_damage_ratio_ranged', name: '远程当前生命伤害比例', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.05999999865889549, levelValues: null, description: '目标当前生命值的额外物理伤害比例，小数1表示100%。', sortOrder: 20 },
      { parameterKey: 'attack_counter_window_ms', name: '攻击计数原始窗口', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 6000, levelValues: null, description: '客户端原始字段AttackCounterDuration=6秒；当前生效脚本是否读取、计时起点和刷新方式未证，不作为已确认规则。', sortOrder: 40 },
      { parameterKey: 'slow_ratio', name: '三次攻击减速比例', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.30000001192092896, levelValues: null, description: '三次攻击英雄后的减速比例，小数0.3表示30%。', sortOrder: 50 },
      { parameterKey: 'slow_duration_ms', name: '减速持续时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 1000, levelValues: null, description: '减速持续时间，单位：毫秒。', sortOrder: 60 },
      { parameterKey: 'slow_cooldown_ms', name: '抓挠之影冷却', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 15000, levelValues: null, description: '抓挠之影冷却时间，单位：毫秒。', sortOrder: 70 }
    ],
    formulas: [
      { formulaKey: 'on_hit_damage_melee', name: '近战当前生命值额外伤害', description: '目标当前生命值乘以近战9%比例。', sortOrder: 10, expression: operation('MULTIPLY', parameterNode('on_hit_damage_ratio_melee'), attribute('TARGET', 'hp', 'CURRENT')) },
      { formulaKey: 'on_hit_damage_ranged', name: '远程当前生命值额外伤害', description: '目标当前生命值乘以远程6%比例。', sortOrder: 20, expression: operation('MULTIPLY', parameterNode('on_hit_damage_ratio_ranged'), attribute('TARGET', 'hp', 'CURRENT')) }
    ],
    effects: [
      { effectKey: 'on_hit_damage_melee', name: '近战雾之锋伤害', description: '目标当前生命值9%的额外物理伤害；普攻触发和小兵野怪上限分支待接。', sortOrder: 10, lifecycle: null, results: [damageResult({ name: '近战当前生命额外物理伤害', description: '目标当前生命值9%。', value: formula('on_hit_damage_melee'), damageTypeKey: 'physics', deliveryKind: 'BASIC_ATTACK' })] },
      { effectKey: 'on_hit_damage_ranged', name: '远程雾之锋伤害', description: '目标当前生命值6%的额外物理伤害；普攻触发和小兵野怪上限分支待接。', sortOrder: 20, lifecycle: null, results: [damageResult({ name: '远程当前生命额外物理伤害', description: '目标当前生命值6%。', value: formula('on_hit_damage_ranged'), damageTypeKey: 'physics', deliveryKind: 'BASIC_ATTACK' })] }
    ],
    triggerRules: [],
    pendingRules: ['需按来源对象近战/远程攻击类型选择分支，不能按双方实际距离选择，也不能把任一分支接到全部普攻。', '小兵和野怪上限按本轮范围排除；三次攻击计数、6秒窗口、目标独立性和减速状态键仍待补证及接线。'],
    relation: { equipmentKey: 'item_3153', skillKey: 'item_3153_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items~13153/mDataValues/0..7、mItemCalculations/MeleeItemCalcValue/RangedItemCalcValue', evidence: 'MeleeValue=0.09；RangedValue=0.06；MonsterDamageCap=100；AttackCounterDuration=6；MoveSpeedMod=-0.3；MoveSpeedDuration=1；Cooldown=15。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_3153_tooltip、item_3153_tooltipextended', evidence: '攻击造成目标当前生命值额外物理伤害；攻击英雄3次造成30%减速1秒；小兵和野怪伤害上限100。' }
    ],
    arithmetic: [{ sample: '目标当前生命值1000，近战', expected: 90, actual: 0.09 * 1000, unit: '伤害点' }, { sample: '目标当前生命值1000，远程', expected: 60, actual: 0.06 * 1000, unit: '伤害点' }]
  },
  {
    equipmentKey: 'item_3155', equipmentName: '海克斯饮魔刀',
    skill: {
      skillKey: 'item_3155_passive', name: '海克斯饮魔刀·救主灵刃',
      description: '保存魔法伤害将生命值压到30%以下时获得魔法伤害护盾、护盾持续2.5秒和冷却90秒，以及客户端近战护盾等级插值起值110、终值280、远程乘75%的参数。等级插值默认范围和逐等级计算尚未证，未将起终值冒充固定护盾。',
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'low_health_threshold', name: '低生命阈值', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.30000001192092896, levelValues: null, description: '受到将使生命值跌至30%以下的魔法伤害时触发，小数1表示100%。', sortOrder: 10 },
      { parameterKey: 'shield_duration_ms', name: '魔法护盾持续时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 2500, levelValues: null, description: '护盾持续时间，单位：毫秒。', sortOrder: 20 },
      { parameterKey: 'cooldown_ms', name: '救主灵刃冷却', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 90000, levelValues: null, description: '冷却时间，单位：毫秒。', sortOrder: 30 },
      { parameterKey: 'melee_shield_start', name: '近战护盾插值起值', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 110, levelValues: null, description: '客户端等级插值起值，单位：护盾点；不是固定护盾。', sortOrder: 40 },
      { parameterKey: 'melee_shield_end', name: '近战护盾插值终值', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 280, levelValues: null, description: '客户端等级插值终值，单位：护盾点；默认等级范围待证。', sortOrder: 50 },
      { parameterKey: 'ranged_shield_multiplier', name: '远程护盾倍率', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.75, levelValues: null, description: '远程护盾为近战计算结果的75%，小数1表示100%。', sortOrder: 60 }
    ],
    formulas: [], effects: [], triggerRules: [],
    pendingRules: ['ByCharLevelInterpolationCalculationPart默认等级范围和逐等级值尚未从当前计算器核对，暂不创建护盾效果。', '低于阈值的魔法伤害触发与90秒冷却需要护盾效果和范围分支确定后再接。'],
    relation: { equipmentKey: 'item_3155', skillKey: 'item_3155_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items~13155/mDataValues/0..2、ShieldAmount计算', evidence: 'LowHealthThreshold=0.3；ShieldLifetime=2.5；Cooldown=90；近战护盾等级插值起值110终值280；远程为75%。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_3155_tooltip', evidence: '魔法伤害使生命值低于30%时获得持续2.5秒魔法护盾，冷却90秒。' }
    ],
    arithmetic: [{ sample: '远程倍率 × 近战插值终值', expected: 210, actual: 0.75 * 280, unit: '护盾点；仅说明倍率样例，不代表所有等级' }]
  },
  {
    equipmentKey: 'item_3156', equipmentName: '玛莫提乌斯之噬',
    skill: {
      skillKey: 'item_3156_passive', name: '玛莫提乌斯之噬·救主灵刃',
      description: '保存魔法伤害低于30%生命阈值触发、近战200加150%额外攻击力魔法护盾、远程75%分支、护盾3秒、冷却90秒及10%全能吸血组成。全能吸血持续到战斗状态结束，但战斗状态进入、续期、退出与原始BuffDuration/BuffExtension的读取关系未证。',
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'shield_base', name: '近战护盾基础值', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 200, levelValues: null, description: '近战护盾基础值，单位：护盾点。', sortOrder: 10 },
      { parameterKey: 'low_health_threshold', name: '低生命阈值', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.30000001192092896, levelValues: null, description: '受到将使生命值跌至30%以下的魔法伤害时触发，小数1表示100%。', sortOrder: 20 },
      { parameterKey: 'shield_duration_ms', name: '护盾持续时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 3000, levelValues: null, description: '魔法伤害护盾持续时间，单位：毫秒。', sortOrder: 30 },
      { parameterKey: 'shield_bonus_ad_ratio', name: '额外攻击力护盾倍率', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 1.5, levelValues: null, description: '近战护盾对额外攻击力的倍率，小数1表示100%。', sortOrder: 40 },
      { parameterKey: 'ranged_shield_multiplier', name: '远程护盾倍率', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.75, levelValues: null, description: '远程护盾为近战计算结果的75%，小数1表示100%。', sortOrder: 50 },
      { parameterKey: 'omnivamp_bonus', name: '全能吸血增加', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.10000000149011612, levelValues: null, description: '救主灵刃触发后增加10%全能吸血，小数1表示100%。', sortOrder: 60 },
      { parameterKey: 'cooldown_ms', name: '救主灵刃冷却', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 90000, levelValues: null, description: '冷却时间，单位：毫秒。', sortOrder: 70 },
      { parameterKey: 'source_buff_duration_s', name: '客户端原始BuffDuration', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 5, levelValues: null, description: '客户端原始字段；当前绑定文案未证明它就是脱战判定时长，不直接用于效果生命周期。', sortOrder: 80 },
      { parameterKey: 'source_buff_extension_s', name: '客户端原始BuffExtension', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 3, levelValues: null, description: '客户端原始字段；当前绑定关系未证明其刷新规则，不直接用于效果生命周期。', sortOrder: 90 }
    ],
    formulas: [
      { formulaKey: 'shield_melee', name: '近战魔法护盾', description: '200加额外攻击力的150%。', sortOrder: 10, expression: operation('ADD', parameterNode('shield_base'), operation('MULTIPLY', parameterNode('shield_bonus_ad_ratio'), operation('SUBTRACT', attribute('SOURCE', 'attack_damage', 'TOTAL'), attribute('SOURCE', 'attack_damage', 'BASE')))) },
      { formulaKey: 'shield_ranged', name: '远程魔法护盾', description: '近战护盾计算结果乘75%。', sortOrder: 20, expression: operation('MULTIPLY', parameterNode('ranged_shield_multiplier'), operation('ADD', parameterNode('shield_base'), operation('MULTIPLY', parameterNode('shield_bonus_ad_ratio'), operation('SUBTRACT', attribute('SOURCE', 'attack_damage', 'TOTAL'), attribute('SOURCE', 'attack_damage', 'BASE'))))) }
    ],
    effects: [
      { effectKey: 'shield_melee', name: '近战救主魔法护盾', description: '近战分支：200加额外攻击力150%的魔法护盾，持续3秒。触发时的来源对象近战/远程攻击类型分支待接。', sortOrder: 10, lifecycle: timedLifecycle(parameter('shield_duration_ms')), results: [shieldResult({ name: '近战魔法护盾', description: '200加额外攻击力150%。', value: formula('shield_melee'), damageTypeKey: 'magic' })] },
      { effectKey: 'shield_ranged', name: '远程救主魔法护盾', description: '远程分支：近战护盾计算结果75%，持续3秒。触发时的来源对象近战/远程攻击类型分支待接。', sortOrder: 20, lifecycle: timedLifecycle(parameter('shield_duration_ms')), results: [shieldResult({ name: '远程魔法护盾', description: '近战护盾计算结果乘75%。', value: formula('shield_ranged'), damageTypeKey: 'magic' })] },
      { effectKey: 'omnivamp_bonus', name: '救主全能吸血增加', description: '触发后增加10%全能吸血；战斗状态结束的移除时点未接线，因此保留为可独立配置的效果组成。', sortOrder: 30, lifecycle: explicitLifecycle(), results: [attributeResult({ resultKey: 'omnivamp', name: '全能吸血增加', description: '增加10%全能吸血。', attributeKey: 'omnivamp_percent', value: parameter('omnivamp_bonus'), lifecycleBehavior: persistentBehavior('REPLACE', 'APPLICATION_SNAPSHOT') })] }
    ],
    triggerRules: [],
    pendingRules: ['魔法伤害阈值事件、冷却消费和近战/远程选择尚未接线，不能把任一护盾分支接到所有伤害。', '全能吸血效果使用仅显式移除生命周期保留组成；战斗状态结束的进入、续期和退出规则待证，不能把5秒或3秒原始字段当作脱战时长。'],
    relation: { equipmentKey: 'item_3156', skillKey: 'item_3156_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items~13156/mDataValues/0..8、mItemCalculations/ShieldAmount', evidence: 'ShieldSize=200；ShieldADScaling=1.5；RangedShieldMod=0.75；ShieldDuration=3；BuffVamp=0.1；Cooldown=90；LowHealthThreshold=0.3；BuffDuration=5；BuffExtension=3。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_3156_tooltip、item_3156_tooltipexternal', evidence: '魔法伤害低于30%生命时获得魔法护盾和10%全能吸血；护盾持续3秒，冷却90秒。' }
    ],
    arithmetic: [{ sample: '额外攻击力100，近战', expected: 350, actual: 200 + 1.5 * 100, unit: '护盾点' }, { sample: '额外攻击力100，远程', expected: 262.5, actual: 0.75 * (200 + 1.5 * 100), unit: '护盾点' }]
  },
  {
    equipmentKey: 'item_6673', equipmentName: '不朽盾弓',
    skill: {
      skillKey: 'item_6673_passive', name: '不朽盾弓·救主灵刃',
      description: '保存任意伤害将生命值压到30%以下时触发、护盾持续3秒、冷却90秒，以及客户端等级分段护盾原始字段：1级400、9级分段点、此后每级增加30、远程乘80%。分段计算器和外层计算类型语义尚未核对，未将400或8秒旧字段误作完整效果。',
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'health_threshold', name: '低生命阈值', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.30000001192092896, levelValues: null, description: '受到伤害后生命值低于30%时触发，小数1表示100%。', sortOrder: 10 },
      { parameterKey: 'shield_duration_ms', name: '护盾持续时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 3000, levelValues: null, description: '护盾持续时间，单位：毫秒。', sortOrder: 20 },
      { parameterKey: 'cooldown_ms', name: '救主灵刃冷却', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 90000, levelValues: null, description: '冷却时间，单位：毫秒。', sortOrder: 30 },
      { parameterKey: 'shield_level_one', name: '一级护盾原始值', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 400, levelValues: null, description: '客户端分段计算的1级起值，单位：护盾点；不是所有等级固定值。', sortOrder: 40 },
      { parameterKey: 'shield_level_breakpoint', name: '护盾等级分段点', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 9, levelValues: null, description: '客户端分段计算的等级分段点。', sortOrder: 50 },
      { parameterKey: 'shield_bonus_per_level', name: '分段后每级增加', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 30, levelValues: null, description: '分段点及之后每级增加的护盾值，单位：护盾点。', sortOrder: 60 },
      { parameterKey: 'ranged_shield_multiplier', name: '远程护盾倍率', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.8, levelValues: null, description: '远程护盾为近战计算结果的80%，小数1表示100%。', sortOrder: 70 }
    ],
    formulas: [], effects: [], triggerRules: [],
    pendingRules: ['ByCharLevelBreakpointsCalculationPart和外层类型{e9a3c91d}的执行语义未完成核对，暂不创建错误的护盾公式。', '阈值事件与冷却规则待护盾等级计算完成后接线；不把客户端未绑定BuffDuration=8用于护盾持续时间。'],
    relation: { equipmentKey: 'item_6673', skillKey: 'item_6673_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items~16673/mDataValues/0..3、ShieldAmount计算', evidence: 'ShieldDuration=3；Cooldown=90；HealthThreshold=0.3；护盾计算含1级400、分段点9、分段后每级30、远程0.8。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_6673_tooltip、item_6673_tooltipexternal', evidence: '受到将生命值低于30%的伤害时获得护盾，持续3秒，冷却90秒。' }
    ],
    arithmetic: [{ sample: '已知分段原始值：1级', expected: 400, actual: 400, unit: '护盾点；不代表等级9前后完整数组' }]
  },
  {
    equipmentKey: 'item_6692', equipmentName: '星蚀',
    skill: {
      skillKey: 'item_6692_passive', name: '星蚀·永升之月',
      description: '保存2秒内两次独立攻击或技能命中同一英雄后的目标最大生命值物理伤害、近战与远程护盾公式、护盾持续2秒和冷却6秒。持续伤害、同一技能多段及复合攻击的独立命中去重规则未证，因此本批不把触发条件扩大为任意命中。',
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'trigger_window_ms', name: '独立命中触发窗口', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 2000, levelValues: null, description: '两次独立攻击或技能命中的时间窗口，单位：毫秒。', sortOrder: 10 },
      { parameterKey: 'required_independent_hits', name: '所需独立命中次数', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 2, levelValues: null, description: '同一英雄需要的独立攻击或技能命中次数。', sortOrder: 20 },
      { parameterKey: 'melee_max_hp_damage_ratio', name: '近战最大生命伤害比例', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.0799999982118607, levelValues: null, description: '目标最大生命值的物理伤害比例，小数1表示100%。', sortOrder: 30 },
      { parameterKey: 'ranged_max_hp_damage_multiplier', name: '远程最大生命伤害倍率', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.625, levelValues: null, description: '远程为近战最大生命伤害的62.5%，小数1表示100%。', sortOrder: 40 },
      { parameterKey: 'shield_base', name: '近战护盾基础值', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 150, levelValues: null, description: '近战护盾基础值，单位：护盾点。', sortOrder: 50 },
      { parameterKey: 'shield_bonus_ad_ratio', name: '额外攻击力护盾倍率', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.4000000059604645, levelValues: null, description: '近战护盾对额外攻击力的倍率，小数1表示100%。', sortOrder: 60 },
      { parameterKey: 'ranged_shield_multiplier', name: '远程护盾倍率', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.5, levelValues: null, description: '远程护盾为近战计算结果的50%，小数1表示100%。', sortOrder: 70 },
      { parameterKey: 'shield_duration_ms', name: '护盾持续时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 2000, levelValues: null, description: '护盾持续时间，单位：毫秒。', sortOrder: 80 },
      { parameterKey: 'cooldown_ms', name: '永升之月冷却', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 6000, levelValues: null, description: '冷却时间，单位：毫秒。', sortOrder: 90 }
    ],
    formulas: [
      { formulaKey: 'max_hp_damage_melee', name: '近战最大生命值伤害', description: '目标最大生命值乘以8%。', sortOrder: 10, expression: operation('MULTIPLY', parameterNode('melee_max_hp_damage_ratio'), attribute('TARGET', 'hp', 'TOTAL')) },
      { formulaKey: 'max_hp_damage_ranged', name: '远程最大生命值伤害', description: '近战最大生命值伤害乘远程62.5%倍率。', sortOrder: 20, expression: operation('MULTIPLY', parameterNode('ranged_max_hp_damage_multiplier'), operation('MULTIPLY', parameterNode('melee_max_hp_damage_ratio'), attribute('TARGET', 'hp', 'TOTAL'))) },
      { formulaKey: 'shield_melee', name: '近战星蚀护盾', description: '150加额外攻击力40%。', sortOrder: 30, expression: operation('ADD', parameterNode('shield_base'), operation('MULTIPLY', parameterNode('shield_bonus_ad_ratio'), operation('SUBTRACT', attribute('SOURCE', 'attack_damage', 'TOTAL'), attribute('SOURCE', 'attack_damage', 'BASE')))) },
      { formulaKey: 'shield_ranged', name: '远程星蚀护盾', description: '近战护盾计算结果乘50%。', sortOrder: 40, expression: operation('MULTIPLY', parameterNode('ranged_shield_multiplier'), operation('ADD', parameterNode('shield_base'), operation('MULTIPLY', parameterNode('shield_bonus_ad_ratio'), operation('SUBTRACT', attribute('SOURCE', 'attack_damage', 'TOTAL'), attribute('SOURCE', 'attack_damage', 'BASE'))))) }
    ],
    effects: [
      { effectKey: 'max_hp_damage_melee', name: '近战永升之月伤害', description: '触发后造成目标最大生命值8%的物理伤害；两次独立命中去重规则待接。', sortOrder: 10, lifecycle: null, results: [damageResult({ name: '近战最大生命物理伤害', description: '目标最大生命值8%。', value: formula('max_hp_damage_melee'), target: 'TARGET', damageTypeKey: 'physics', deliveryKind: 'SKILL' })] },
      { effectKey: 'max_hp_damage_ranged', name: '远程永升之月伤害', description: '触发后造成目标最大生命值5%的物理伤害；两次独立命中去重规则待接。', sortOrder: 20, lifecycle: null, results: [damageResult({ name: '远程最大生命物理伤害', description: '目标最大生命值5%。', value: formula('max_hp_damage_ranged'), target: 'TARGET', damageTypeKey: 'physics', deliveryKind: 'SKILL' })] },
      { effectKey: 'shield_melee', name: '近战永升之月护盾', description: '近战分支：150加额外攻击力40%，持续2秒。', sortOrder: 30, lifecycle: timedLifecycle(parameter('shield_duration_ms')), results: [shieldResult({ name: '近战星蚀护盾', description: '150加额外攻击力40%。', value: formula('shield_melee'), damageTypeKey: null })] },
      { effectKey: 'shield_ranged', name: '远程永升之月护盾', description: '远程分支：近战护盾计算结果50%，持续2秒。', sortOrder: 40, lifecycle: timedLifecycle(parameter('shield_duration_ms')), results: [shieldResult({ name: '远程星蚀护盾', description: '近战护盾计算结果乘50%。', value: formula('shield_ranged'), damageTypeKey: null })] }
    ],
    triggerRules: [],
    pendingRules: ['两次独立攻击或技能命中同一英雄的计数、同一技能多段去重、持续伤害去重和冷却消费未接线。', '需按来源对象近战/远程攻击类型选择分支，保留两套效果但不接任意命中规则。'],
    relation: { equipmentKey: 'item_6692', skillKey: 'item_6692_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items~16692/mDataValues/0..7、mItemCalculations', evidence: 'WindowDuration=2；MeleePercMaxHP=0.08；RangedPercMaxHPMult=0.625；Cooldown=6；ShieldDuration=2；MeleeBaseShield=150；MeleeBonusADShieldRatio=0.4；RangedShieldMult=0.5。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_6692_tooltip、item_6692_tooltipinventory', evidence: '2秒内两次独立攻击或技能命中同一英雄；目标最大生命值物理伤害及护盾组成。' }
    ],
    arithmetic: [{ sample: '目标最大生命值2000，近战', expected: 160, actual: 0.08 * 2000, unit: '物理伤害点' }, { sample: '额外攻击力100，近战护盾', expected: 190, actual: 150 + 0.4 * 100, unit: '护盾点' }, { sample: '额外攻击力100，远程护盾', expected: 95, actual: 0.5 * (150 + 0.4 * 100), unit: '护盾点' }]
  }
];

const sourceFiles = [
  '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz',
  '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz',
  '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json'
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
  return { equipmentCount: records.length, skillCount: count('skill'), parameterCount: count('parameter:'), formulaCount: count('formula:'), effectCount: count('effect:'), triggerRuleCount: count('trigger-rule:'), relationCount: count('equipment-skill-relation'), representativeImageCount: count('representative-image'), componentCount: components.length, fieldCount: fields.length, mismatchCount: fields.filter((field) => !field.equal).length, missingCount: components.filter((component) => component.state === 'missing' || component.state === 'skill-missing').length };
}
const apply = process.argv.includes('--apply');
const applyImages = process.argv.includes('--apply-images');
const writeCandidate = process.argv.includes('--write-candidate');
if (writeCandidate) await writeFile(candidatePath, `${JSON.stringify({ generatedAt: new Date().toISOString(), objects }, null, 2)}\n`, 'utf8');
const records = [];
for (const object of objects) records.push(await runObject(object, { apply, applyImages }));
const result = {
  generatedAt: new Date().toISOString(), mode: applyImages ? (apply ? '补缺并独立补图' : '独立补图') : (apply ? '补缺' : '只读逐字段回读'), apiBaseUrl, gameId: 'lol',
  source: { version: '16.17.1', clientDirectoryVersion: '16.17', hashes: await Promise.all(sourceFiles.map(hashFile)), note: '仅保存冻结来源确证的独立组成；配置保存与接口回读不等于运行时验证。' },
  objects: records, summary: summary(records)
};
await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ mode: result.mode, summary: result.summary, evidencePath: evidencePath.pathname, candidatePath: writeCandidate ? candidatePath.pathname : null }, null, 2));
