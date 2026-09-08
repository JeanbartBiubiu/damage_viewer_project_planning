import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiBaseUrl = 'http://127.0.0.1:8080/api/admin/games/lol';
const token = 'local-entry';
const evidencePath = new URL('./逐字段回读证据.json', import.meta.url);
const candidatePath = new URL('./录入候选.json', import.meta.url);
const ultimateScope = JSON.parse(await readFile(new URL('./终极技能范围证据.json', import.meta.url), 'utf8'));
if (ultimateScope.accepted?.length !== 170 || ultimateScope.skillKeys?.length !== 170 || new Set(ultimateScope.skillKeys).size !== 170 || ultimateScope.skillKeys.includes('udyr_r') || !ultimateScope.skillKeys.includes('ez_r')) {
  throw new Error('终极技能范围证据不符合第八批固定范围');
}

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
const dynamicPersistentBehavior = {
  moment: 'PERSISTENT', valueReadMode: 'MOMENT_EVALUATION', stackValueMode: 'SHARED',
  reapplicationValueMode: null, periodicExecutionMode: null
};
const spellShieldBehavior = {
  moment: 'PERSISTENT', valueReadMode: null, stackValueMode: null,
  reapplicationValueMode: null, periodicExecutionMode: null
};
const periodicGrowthLifecycle = () => ({
  durationValue: null,
  maxStacksValue: fixed(10),
  applicationStacksValue: fixed(1),
  instanceScope: 'SOURCE',
  reapplicationStackMode: 'INCREASE',
  reapplicationDurationMode: null,
  expiryMode: 'EXPLICIT_ONLY',
  periodicIntervalValue: fixed(60000),
  firstPeriodicExecution: 'AFTER_INTERVAL'
});
const periodicGrowthBehavior = {
  moment: 'PERIODIC', valueReadMode: 'MOMENT_EVALUATION', stackValueMode: null,
  reapplicationValueMode: null, periodicExecutionMode: 'ONCE_PER_INSTANCE'
};
const periodicAttributeResult = ({ resultKey, name, description, attributeKey, value, lifecycleBehavior }) => ({
  resultKey, name, resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE', description, sortOrder: 10,
  lifecycleBehavior, spellShieldBlockScope: null, valueRule: effectValue(value),
  detail: { attributeKey, operation: 'INCREASE', modifierZoneKey: null }
});
const timedPeriodicLifecycle = ({ durationValue, intervalValue, instanceScope = 'TARGET', maxStacksValue = fixed(1), reapplicationStackMode = 'KEEP', reapplicationDurationMode = 'REFRESH_ALL', expiryMode = 'ALL_AT_ONCE' }) => ({
  durationValue,
  maxStacksValue,
  applicationStacksValue: fixed(1),
  instanceScope,
  reapplicationStackMode,
  reapplicationDurationMode,
  expiryMode,
  periodicIntervalValue: intervalValue,
  firstPeriodicExecution: 'AFTER_INTERVAL'
});
const stackedTargetLifecycle = (durationValue, maxStacksValue) => ({
  durationValue,
  maxStacksValue,
  applicationStacksValue: fixed(1),
  instanceScope: 'TARGET',
  reapplicationStackMode: 'INCREASE',
  reapplicationDurationMode: 'REFRESH_ALL',
  expiryMode: 'ALL_AT_ONCE',
  periodicIntervalValue: null,
  firstPeriodicExecution: null
});
const stackedTargetBehavior = {
  moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'PER_STACK',
  reapplicationValueMode: null, periodicExecutionMode: null
};
const periodicDamageBehavior = {
  moment: 'PERIODIC', valueReadMode: 'MOMENT_EVALUATION', stackValueMode: null,
  reapplicationValueMode: null, periodicExecutionMode: 'ONCE_PER_INSTANCE'
};
const championTargetGroup = (groupKey = 'champion_target') => ({
  groupKey, name: '英雄目标', sortOrder: 10,
  conditions: [{
    conditionKey: 'target_is_champion', conditionType: 'TARGET_CATEGORY_CHECK', sortOrder: 10,
    detail: { categories: ['CHAMPION'] }
  }]
});
const objects = [
  {
    equipmentKey: 'item_3032', equipmentName: '育恩塔尔荒野箭',
    directAttributes: { attack_damage: 50, bonus_attack_speed_percent: 0.45, critical_strike_chance: 0 },
    skill: {
      skillKey: 'item_3032_passive', name: '育恩塔尔荒野箭·疾风骤雨',
      description: '保存16.17客户端与官方16.17.1共同确证的30%攻击速度、6秒持续、30秒冷却、普通攻击缩短1秒和暴击缩短2秒；常规模式熟能生巧每次近战攻击增加0.004、远程攻击增加0.002暴击几率，达到0.25上限封顶。普通攻击命中规则和持有者冷却接线仍待补齐，装备直接属性不在技能结果中重复施加。',
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'crit_cap_ratio', name: '熟能生巧暴击上限', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.25, levelValues: null, description: '永久获得暴击几率上限，小数0.25表示25%；常规模式近战每次攻击增加0.004、远程每次攻击增加0.002，达到该上限后不再增加。ARAM与SWIFTPLAY覆盖值不混入。', sortOrder: 10 },
      { parameterKey: 'attack_speed_bonus_ratio', name: '疾风骤雨攻击速度增幅', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.3, levelValues: null, description: '触发后额外攻击速度30%，小数0.3表示30%。', sortOrder: 20 },
      { parameterKey: 'attack_speed_duration_ms', name: '疾风骤雨持续时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 6000, levelValues: null, description: '攻击速度增幅持续6秒，单位：毫秒。', sortOrder: 30 },
      { parameterKey: 'attack_buff_cooldown_ms', name: '疾风骤雨冷却时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 30000, levelValues: null, description: '攻击英雄触发后的冷却为30秒，单位：毫秒。当前触发规则未用错误的逐目标冷却替代持有者内部冷却。', sortOrder: 40 },
      { parameterKey: 'attack_cooldown_reduction_ms', name: '普通攻击冷却缩短', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 1000, levelValues: null, description: '攻击使疾风骤雨冷却缩短1秒，单位：毫秒。', sortOrder: 50 },
      { parameterKey: 'critical_cooldown_reduction_ms', name: '暴击冷却缩短', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 2000, levelValues: null, description: '暴击时该冷却缩短2秒，单位：毫秒。', sortOrder: 60 },
      { parameterKey: 'crit_bonus_per_attack_melee', name: '熟能生巧近战每次攻击暴击增量', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.004, levelValues: null, description: '常规模式每次近战攻击永久增加0.004暴击几率，小数0.004表示0.4个百分点；由熟能生巧0.25上限封顶。ARAM与SWIFTPLAY覆盖值不混入。', sortOrder: 70 },
      { parameterKey: 'crit_bonus_per_attack_ranged', name: '熟能生巧远程每次攻击暴击增量', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.002, levelValues: null, description: '常规模式每次远程攻击永久增加0.002暴击几率，小数0.002表示0.2个百分点；由熟能生巧0.25上限封顶。ARAM与SWIFTPLAY覆盖值不混入。', sortOrder: 80 }
    ],
    formulas: [],
    effects: [{
      effectKey: 'attack_speed_buff', name: '疾风骤雨攻击速度增幅', description: '对英雄普通攻击命中后，使装备持有者获得30%额外攻击速度，持续6秒。',
      sortOrder: 10,
      lifecycle: timedLifecycle(parameter('attack_speed_duration_ms')),
      results: [{
        resultKey: 'attack_speed', name: '额外攻击速度', resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE',
        description: '增加持有者bonus_attack_speed_percent属性0.30；小数0.30表示30个百分点。',
        sortOrder: 10, lifecycleBehavior: persistentBehavior('REPLACE', 'APPLICATION_SNAPSHOT'),
        spellShieldBlockScope: null, valueRule: effectValue(parameter('attack_speed_bonus_ratio')),
        detail: { attributeKey: 'bonus_attack_speed_percent', operation: 'INCREASE', modifierZoneKey: 'attribute_flat_add' }
      }]
    }],
    triggerRules: [],
    pendingRules: [
      '常规模式近战每次攻击增加0.004、远程每次攻击增加0.002，达到0.25上限封顶；ARAM与SWIFTPLAY覆盖值不混入。',
      '缺少持有者30秒冷却门控的攻击触发规则已撤回，正常脚本不得重建。保留独立攻速效果；补齐来源内部冷却及攻击/暴击缩短后再接线，不用逐目标冷却近似。',
      'BASIC_ATTACK_HIT只证明普通攻击事件；技能触发攻击特效是否复用该事件留待运行链核对。'
    ],
    pendingEffects: [],
    relation: { equipmentKey: 'item_3032', skillKey: 'item_3032_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/3032/mDataValues/ASDuration、CritMax、Cooldown、AACDR、CritCDR、ASMod、CritPerStackMelee、StackRangedMultiplier、mFlatPhysicalDamageMod、mPercentAttackSpeedMod、mItemCalculations/CritPerStackCalc', evidence: 'ASDuration=6、CritMax=25、Cooldown=30、AACDR=1、CritCDR=2、ASMod=0.3；CritPerStackCalc后缀为“%”，结合CritPerStackMelee=0.4和StackRangedMultiplier=0.5，已确证常规近战每次攻击增加0.004、远程每次攻击增加0.002；直接属性50攻击力、0.45额外攻击速度。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_3032_tooltip、entries/GeneratedTip_Item_3032_Description', evidence: '攻击永久获得暴击几率至多25%；攻击敌方英雄获得6秒30%攻击速度、30秒冷却；攻击缩短1秒，暴击缩短2秒。' },
      { file: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json', pointer: '/data/3032/description、/data/3032/stats', evidence: '官方说明与冻结客户端的持续时间、冷却和缩短值一致。' }
    ],
    arithmetic: [
      { sample: '一次英雄攻击触发的攻击速度增幅', expected: 0.3, actual: 0.3, unit: '额外攻击速度比例；小数0.3表示30%，持续6000毫秒' },
      { sample: '普通攻击与暴击冷却缩短', expected: 1000, actual: 1000, unit: '普通攻击缩短1000毫秒；暴击分支另为2000毫秒' }
    ]
  },
  {
    equipmentKey: 'item_3050', equipmentName: '基克的聚合',
    directAttributes: { hp: 300, armor: 25, magic_resistance: 25, ability_haste: 10 },
    skill: {
      skillKey: 'item_3050_passive', name: '基克的聚合·霜火风暴',
      description: '保存终极技能急速15点、施放终极技能后5000毫秒就绪窗口，以及风暴持续5000毫秒、半径350、每秒30点魔法伤害、30%减速和45000毫秒冷却等冻结确证组成。终极技能急速使用当前根R带Trait_Ultimate且已有唯一角色挂载的170个技能键初始化；风暴就绪、接近英雄启动、跳频、减速状态和持有者冷却仍待准确接线，不用无条件规则冒充完整机制。',
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'storm_duration_ms', name: '霜火风暴持续时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 5000, levelValues: null, description: '风暴持续5秒，单位：毫秒。', sortOrder: 10 },
      { parameterKey: 'storm_radius', name: '霜火风暴作用半径', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 350, levelValues: null, description: '客户端绑定树StormRadius=350，单位：游戏距离单位。', sortOrder: 20 },
      { parameterKey: 'storm_damage_per_second', name: '霜火风暴每秒魔法伤害', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 30, levelValues: null, description: '每秒造成30点魔法伤害，单位：伤害点/秒。', sortOrder: 30 },
      { parameterKey: 'storm_slow_ratio', name: '霜火风暴减速比例', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.3, levelValues: null, description: '减速30%，小数0.3表示30%；减速状态键尚未在现有共享状态目录中确认。', sortOrder: 40 },
      { parameterKey: 'ultimate_haste', name: '冰晶燃烧终极技能急速', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 15, levelValues: null, description: '冻结客户端UltimateHaste=15，终极技能急速单位为急速点；作用于已核对的终极技能集合。', sortOrder: 50 },
      { parameterKey: 'ready_duration_ms', name: '霜火风暴就绪窗口', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 5000, levelValues: null, description: '冻结客户端ReadyDuration=5秒，施放终极技能后风暴就绪窗口为5000毫秒。', sortOrder: 60 },
      { parameterKey: 'storm_cooldown_ms', name: '霜火风暴触发冷却', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 45000, levelValues: null, description: '客户端绑定树Cooldown=45，单位：毫秒。', sortOrder: 60 }
    ],
    formulas: [],
    effects: [{
      effectKey: 'ultimate_haste', name: '冰晶燃烧终极技能急速',
      description: '装备持有者的170个已核对终极技能获得15点技能急速；技能键来自当前根R的Trait_Ultimate标记和唯一角色挂载回读。',
      sortOrder: 10,
      lifecycle: {
        durationValue: null, maxStacksValue: fixed(1), applicationStacksValue: fixed(1), instanceScope: 'SOURCE',
        reapplicationStackMode: 'KEEP', reapplicationDurationMode: null, expiryMode: 'EXPLICIT_ONLY',
        periodicIntervalValue: null, firstPeriodicExecution: null
      },
      results: [{
        resultKey: 'ultimate_haste', name: '终极技能急速提升', resultType: 'SKILL_HASTE_MODIFIER', target: 'SOURCE',
        description: '对核对的终极技能集合增加15点技能急速。', sortOrder: 10,
        lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED', reapplicationValueMode: 'KEEP', periodicExecutionMode: null },
        spellShieldBlockScope: null,
        valueRule: effectValue(parameter('ultimate_haste')),
        detail: { operation: 'INCREASE', affectedSkillScope: { mode: 'SKILLS', skillKeys: ultimateScope.skillKeys, skillCategoryKeys: [] } }
      }]
    }],
    triggerRules: [{
      ruleKey: 'initialize_ultimate_haste', name: '初始化冰晶燃烧终极技能急速',
      description: '装备持有者初始化时，对已核对的170个终极技能执行冰晶燃烧终极技能急速效果。', sortOrder: 10,
      eventSource: { eventType: 'SOURCE_INITIALIZED', detail: {} }, conditionGroups: [],
      actions: [{
        actionKey: 'execute_ultimate_haste', name: '执行终极技能急速', actionType: 'EXECUTE_EFFECT', sortOrder: 10,
        targetContext: 'EVENT_SOURCE', detail: { effectKey: 'ultimate_haste' }, runtimeInputBindings: [], resultModifiers: []
      }],
      perTargetCooldown: null, maxTriggersPerProcess: null
    }],
    pendingRules: [
      '终极技能急速已按根R的Trait_Ultimate和唯一角色挂载回读保存170个技能键，并由SOURCE_INITIALIZED初始化；Udyr因缺少根R标记保留待核，不加入。',
      '风暴就绪窗口5000毫秒已保存，施放终极技能后的就绪消费与接近英雄启动仍待准确接线；不写会误触发所有技能的规则。',
      '风暴作用半径350已作为参数保存，但现有周期结果没有范围筛选字段；敌方英雄目标选择和多人范围需运行链继续接线。',
      '原周期伤害效果和仅由“每秒”推定的1000毫秒跳频参数已撤回，正常录入入口不得重建；30%减速未创建STATUS_OPERATION，45秒冷却只保存参数，未用逐目标冷却替代持有者冷却。'
    ],
    pendingEffects: [{ effectKey: 'storm_slow', resultType: 'STATUS_OPERATION', reason: '减速比例已保存；现有共享状态目录未提供已确证的减速状态键。' }],
    relation: { equipmentKey: 'item_3050', skillKey: 'item_3050_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/3050/mDataValues/Duration、Cooldown、SlowAmount、DamagePerSecond、StormRadius、UltimateHaste、ReadyDuration、mScripts', evidence: 'Duration=5、Cooldown=45、SlowAmount=0.3、DamagePerSecond=30、StormRadius=350；mScripts含3050。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_3050_tooltip、entries/GeneratedTip_Item_3050_Description', evidence: '终极技能召唤5秒风暴，对敌方英雄每秒30魔法伤害和30%减速。' },
      { file: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json', pointer: '/data/3050/description、/data/3050/stats', evidence: '官方说明与客户端绑定树共同确证风暴持续、伤害和减速；作用半径、冷却取客户端绑定树。' }
    ],
    arithmetic: [
      { sample: '一次完整风暴的单目标原始魔法伤害', expected: 150, actual: 30 * 5, unit: '点；按每秒30点、持续5秒的数值样例，不代表周期时序或运行时结算' }
    ]
  },
  {
    equipmentKey: 'item_3071', equipmentName: '黑色切割者',
    directAttributes: { hp: 400, attack_damage: 45, ability_haste: 20 },
    skill: {
      skillKey: 'item_3071_passive', name: '黑色切割者·切割',
      description: '保存对英雄造成物理伤害时的6%护甲削减、6秒持续和最多5层目标属性变化；同时保留冻结客户端MSBonusSplit确证的热烈移动速度参数：近战20、远程10、持续2秒。官方当前说明渲染为0的占位差异保留；数值已由当前绑定计算核定，移动速度效果与合法触发待配置。护甲削减使用独立目标属性百分比修改区。',
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'armor_shred_ratio_per_stack', name: '切割每层护甲削减', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.06, levelValues: null, description: '每层降低目标护甲6%，小数0.06表示6个百分点。', sortOrder: 10 },
      { parameterKey: 'armor_shred_duration_ms', name: '切割持续时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 6000, levelValues: null, description: '护甲削减持续6秒，单位：毫秒。', sortOrder: 20 },
      { parameterKey: 'armor_shred_max_stacks', name: '切割最大层数', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 5, levelValues: null, description: '最多5层；第五层后再次触发不增加层数。', sortOrder: 30 },
      { parameterKey: 'damage_internal_cooldown_ms', name: '切割伤害内部间隔', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 10, levelValues: null, description: '客户端InternalCD=0.01秒，按毫秒记录为10；触发语义仍需伤害事件核对。', sortOrder: 40 },
      { parameterKey: 'heated_move_speed_client_value', name: '热烈客户端移动速度值', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 20, levelValues: null, description: '冻结客户端MSBonusSplit确证近战移动速度20；远程移动速度10另存参数；持续2秒。官方当前说明渲染为0的占位差异保留；数值已由当前绑定计算核定，移动速度效果与合法触发待配置。', sortOrder: 50 },
      { parameterKey: 'heated_move_speed_duration_ms', name: '热烈移动速度持续时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 2000, levelValues: null, description: '冻结客户端MSBonusSplit确证热烈移动速度持续2秒；近战20、远程10已分别记录。官方当前说明渲染为0的占位差异保留；数值已由当前绑定计算核定，移动速度效果与合法触发待配置。', sortOrder: 60 },
      { parameterKey: 'heated_move_speed_ranged_value', name: '热烈远程移动速度值', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 10, levelValues: null, description: '冻结客户端MSBonusSplit确证远程移动速度10；近战20、持续2秒分别记录。官方当前说明渲染为0的占位差异保留；数值已由当前绑定计算核定，移动速度效果与合法触发待配置。', sortOrder: 70 }
    ],
    formulas: [],
    effects: [{
      effectKey: 'armor_shred', name: '切割目标护甲削减',
      description: '对确证目标应用每层6%的护甲降低，持续6秒，最多5层；百分比减益使用目标属性百分比修改区。',
      sortOrder: 10,
      lifecycle: stackedTargetLifecycle(parameter('armor_shred_duration_ms'), parameter('armor_shred_max_stacks')),
      results: [{
        resultKey: 'armor_reduction', name: '目标护甲降低', resultType: 'ATTRIBUTE_CHANGE', target: 'TARGET',
        description: '每层降低目标护甲6个百分点；第五层后第六次触发保持30%总削减。',
        sortOrder: 10, lifecycleBehavior: stackedTargetBehavior, spellShieldBlockScope: null,
        valueRule: effectValue(parameter('armor_shred_ratio_per_stack')),
        detail: { attributeKey: 'armor', operation: 'DECREASE', modifierZoneKey: 'item_3071_armor_reduction' }
      }]
    }],
    triggerRules: [],
    pendingRules: [
      '来源触发是对英雄造成物理伤害，现有DAMAGE_DEALT事件可筛物理伤害但不能同时提供英雄TARGET_CATEGORY_CHECK；不改成只监听普攻，也不写会误伤小兵的无条件触发。',
      '当前MSBonusSplit.mRangedMultiplier=0.5只用于20×0.5=10的远程移动速度值，不参与6%的护甲削减计算；数值已由当前绑定计算核定，移动速度效果与合法触发待配置。',
      '数值已由当前绑定计算核定；官方说明渲染0保留占位差异，移动速度效果与合法触发待配置。'
    ],
    pendingEffects: [{ effectKey: 'heated_move_speed', resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE', reason: '数值已由当前绑定计算核定；官方说明渲染0保留占位差异，移动速度效果与合法触发待配置。' }],
    relation: { equipmentKey: 'item_3071', skillKey: 'item_3071_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/3071/mDataValues/DebuffDuration、MoveSpeedBonus、MoveSpeedDuration、InternalCD、MaxStacks、ShredPerStack、RangedMod、mItemCalculations/MSBonusSplit、mFlatHPPoolMod、mFlatPhysicalDamageMod、mAbilityHasteMod', evidence: 'DebuffDuration=6、MoveSpeedBonus=20、MoveSpeedDuration=2、InternalCD=0.01、MaxStacks=5、ShredPerStack=0.06、RangedMod=0.5；MSBonusSplit的mRangedMultiplier只用于20×0.5=10的远程移动速度值，不参与6%的护甲削减计算。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_3071_tooltip、entries/GeneratedTip_Item_3071_Description', evidence: '对英雄造成物理伤害时将护甲降低6%，持续6秒，可叠加5次；热烈说明当前文本值为0。' },
      { file: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json', pointer: '/data/3071/description、/data/3071/stats', evidence: '官方说明与客户端共同确证切割段；热烈移动速度显示0，与客户端20冲突。' }
    ],
    arithmetic: [
      { sample: '黑切第五层目标护甲总削减', expected: 0.3, actual: 5 * 0.06, unit: '比例；小数0.3表示30%' },
      { sample: '第五层后再次触发', expected: 0.3, actual: Math.min(6, 5) * 0.06, unit: '比例；第六次不超过5层' }
    ]
  },
  {
    equipmentKey: 'item_3803', equipmentName: '万世催化石',
    directAttributes: { hp: 300, mana: 375 },
    skill: {
      skillKey: 'item_3803_passive', name: '万世催化石·永恒',
      description: '保存来自英雄的减免前伤害10%回蓝、技能法力消耗25%自疗、单次施放上限20和维持型技能每秒上限20参数。客户端EternityCDPerCast=1000毫秒作为原字段保留，适用事件范围待证；不把它扩展为普通施法全局冷却或受击回蓝冷却。damage_input明确接收减免前英雄伤害；技能消耗、英雄来源筛选和持续技能统计仍待接线。',
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'mana_restore_ratio_from_damage', name: '所受伤害回蓝比例', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.1, levelValues: null, description: '来自英雄所受伤害的10%转为法力，小数0.1表示10%。', sortOrder: 10 },
      { parameterKey: 'health_restore_ratio_from_mana_cost', name: '法力消耗治疗比例', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.25, levelValues: null, description: '技能法力消耗的25%转为自身治疗，小数0.25表示25%。', sortOrder: 20 },
      { parameterKey: 'health_restore_cap_per_cast', name: '单次技能治疗上限', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 20, levelValues: null, description: '客户端EternityMaxHealPerCast=20，单位：生命点/次。', sortOrder: 30 },
      { parameterKey: 'eternity_internal_cooldown_ms', name: '永恒内部冷却', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 1000, levelValues: null, description: '客户端EternityCDPerCast=1秒（1000毫秒）原字段；适用事件范围待证，不解释为普通施法全局冷却或受击回蓝冷却。', sortOrder: 40 },
      { parameterKey: 'damage_input', name: '受击伤害运行时输入', valueType: 'DECIMAL', valueMode: 'RUNTIME_INPUT', fixedValue: null, levelValues: null, description: '来自英雄的减免前伤害运行时输入，单位：伤害点；不使用防御结算后的伤害值。英雄来源和事件绑定待配置。', sortOrder: 50 },
      { parameterKey: 'mana_cost_input', name: '技能法力消耗运行时输入', valueType: 'DECIMAL', valueMode: 'RUNTIME_INPUT', fixedValue: null, levelValues: null, description: '待触发绑定提供的本次技能法力消耗，持续技能规则待核。', sortOrder: 60 },
      { parameterKey: 'health_restore_cap_per_second', name: '维持型技能每秒治疗上限', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 20, levelValues: null, description: '当前绑定扩展说明只确证维持型技能每秒最多治疗20生命；本参数只记录上限，不构造逐秒治疗金额或流程。', sortOrder: 70 }
    ],
    formulas: [
      { formulaKey: 'mana_restore_from_damage', name: '所受伤害转法力', description: '运行时输入是来自英雄的减免前伤害，乘10%回蓝比例；英雄来源和输入事件留待触发绑定。', sortOrder: 10, expression: operation('MULTIPLY', parameterNode('damage_input'), parameterNode('mana_restore_ratio_from_damage')) },
      { formulaKey: 'health_restore_uncapped', name: '法力消耗转治疗未封顶值', description: '运行时法力消耗乘25%治疗比例。', sortOrder: 20, expression: operation('MULTIPLY', parameterNode('mana_cost_input'), parameterNode('health_restore_ratio_from_mana_cost')) },
      { formulaKey: 'health_restore_from_skill_cost', name: '法力消耗转治疗封顶值', description: '单次治疗取25%法力消耗与20点上限的较小值；公式树内联25%乘法，避免把公式结果误当表达式节点。', sortOrder: 30, expression: operation('MIN', operation('MULTIPLY', parameterNode('mana_cost_input'), parameterNode('health_restore_ratio_from_mana_cost')), parameterNode('health_restore_cap_per_cast')) }
    ],
    effects: [
      {
        effectKey: 'mana_from_hero_damage', name: '受击回蓝', description: '以来自英雄的减免前伤害运行时输入的10%恢复持有者法力；英雄来源和伤害事件仍待触发绑定。客户端EternityCDPerCast=1000毫秒只作为原字段保留，适用范围待证，不预设受击回蓝冷却。',
        sortOrder: 10, lifecycle: null,
        results: [resourceResult({ resultKey: 'mana_restore', name: '恢复法力', description: '恢复来自英雄的减免前伤害输入的10%法力。', target: 'SOURCE', value: formula('mana_restore_from_damage'), attributeKey: 'mana', operation: 'RESTORE' })]
      },
      {
        effectKey: 'health_from_skill_cost', name: '施法自疗', description: '以运行时技能法力消耗的25%治疗持有者，单次通过公式封顶20点。',
        sortOrder: 20, lifecycle: null,
        results: [healResult({ resultKey: 'health_restore', name: '恢复生命', description: '恢复25%运行时技能法力消耗，且单次不超过20点。', value: formula('health_restore_from_skill_cost') })]
      }
    ],
    triggerRules: [],
    pendingRules: [
      'DAMAGE_TAKEN虽能提供受击事件，但当前事件没有英雄目标类别条件；不把来自任意对象的伤害都当成来源中的英雄伤害。',
      'damage_input已按当前绑定说明固定为来自英雄的减免前伤害；英雄来源筛选和输入事件仍待接线。',
      'SOURCE_CAST_RESOURCE_COST绑定只在带明确sourceSkillKey的SKILL_HIT规则上可用，本装备不能凭空列出所有英雄技能键；EternityCDPerCast适用范围待证，不暗示通用冷却。'
    ],
    pendingEffects: [],
    relation: { equipmentKey: 'item_3803', skillKey: 'item_3803_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/3803/mDataValues/EternityManaRestore、EternityHealthRestore、EternityMaxHealPerCast、EternityCDPerCast、mFlatHPPoolMod、flatMPPoolMod', evidence: 'EternityManaRestore=0.1、EternityHealthRestore=0.25、EternityMaxHealPerCast=20、EternityCDPerCast=1；直接属性300生命、375法力。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_3803_tooltip、entries/GeneratedTip_Item_3803_Description', evidence: '来自英雄的10%所受伤害回复法力；施放技能按25%法力消耗治疗自身；客户端补充单次治疗上限20和1秒内部冷却。' },
      { file: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json', pointer: '/data/3803/description、/data/3803/stats', evidence: '官方说明与客户端绑定值共同确证永恒比例；上限和内部冷却取客户端绑定树。' }
    ],
    arithmetic: [
      { sample: '英雄伤害100的回蓝', expected: 10, actual: 100 * 0.1, unit: '法力点；仅算术样例' },
      { sample: '技能消耗100的治疗', expected: 20, actual: Math.min(100 * 0.25, 20), unit: '生命点；单次上限20' },
      { sample: '技能消耗80的治疗', expected: 20, actual: Math.min(80 * 0.25, 20), unit: '生命点；达到上限后继续施法仍不超过20' }
    ]
  },
  {
    equipmentKey: 'item_6653', equipmentName: '兰德里的折磨',
    directAttributes: { hp: 300, ability_power: 60 },
    skill: {
      skillKey: 'item_6653_passive', name: '兰德里的折磨·折磨与受苦',
      description: '保存灼烧2%目标最大生命/秒、持续3秒以及客户端0.5秒跳频；另保存受苦每秒2%增伤、最多3层即6%上限参数。当前未创建不存在的伤害修正乘区，伤害型技能筛选和战斗层数处理留待接线。',
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'burn_ratio_per_second', name: '折磨每秒目标生命比例', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.02, levelValues: null, description: '每秒造成目标最大生命2%的魔法伤害，小数0.02表示2%。', sortOrder: 10 },
      { parameterKey: 'burn_duration_ms', name: '折磨灼烧持续时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 3000, levelValues: null, description: '灼烧持续3秒，单位：毫秒。', sortOrder: 20 },
      { parameterKey: 'burn_tick_interval_ms', name: '折磨灼烧跳频', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 500, levelValues: null, description: '客户端TickFrequency=0.5秒，单位：毫秒。', sortOrder: 30 },
      { parameterKey: 'milliseconds_to_seconds', name: '毫秒换算秒', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.001, levelValues: null, description: '将500毫秒换算为0.5秒的换算常数。', sortOrder: 40 },
      { parameterKey: 'suffer_bonus_per_second', name: '受苦每秒额外伤害比例', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.02, levelValues: null, description: '与英雄战斗时每秒额外伤害2%，小数0.02表示2个百分点。', sortOrder: 50 },
      { parameterKey: 'suffer_bonus_cap', name: '受苦额外伤害上限', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.06, levelValues: null, description: '额外伤害最多6%，小数0.06表示6个百分点。', sortOrder: 60 },
      { parameterKey: 'suffer_max_stacks', name: '受苦最大层数', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 3, levelValues: null, description: '客户端MaxStackNumber=3；达到第三层后的第四次计时不再增加。', sortOrder: 70 },
      { parameterKey: 'suffer_counter_duration_ms', name: '受苦计数持续时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 3000, levelValues: null, description: '客户端BuffCounterDuration=3秒；战斗结束及计数刷新规则待核。', sortOrder: 80 }
    ],
    formulas: [
      { formulaKey: 'burn_tick_seconds', name: '灼烧单次跳频秒数', description: '500毫秒乘0.001换算为0.5秒。', sortOrder: 10, expression: operation('MULTIPLY', parameterNode('burn_tick_interval_ms'), parameterNode('milliseconds_to_seconds')) },
      { formulaKey: 'burn_ratio_per_tick', name: '灼烧单次比例', description: '每秒2%乘0.5秒跳频，得到每次1%最大生命；公式树内联毫秒换算。', sortOrder: 20, expression: operation('MULTIPLY', parameterNode('burn_ratio_per_second'), operation('MULTIPLY', parameterNode('burn_tick_interval_ms'), parameterNode('milliseconds_to_seconds'))) },
      { formulaKey: 'burn_damage_per_tick', name: '灼烧单次魔法伤害', description: '目标最大生命乘每次跳频比例；公式树内联每秒比例和跳频换算。', sortOrder: 30, expression: operation('MULTIPLY', attribute('TARGET', 'hp', 'TOTAL'), operation('MULTIPLY', parameterNode('burn_ratio_per_second'), operation('MULTIPLY', parameterNode('burn_tick_interval_ms'), parameterNode('milliseconds_to_seconds')))) }
    ],
    effects: [{
      effectKey: 'burn', name: '折磨周期灼烧', description: '对伤害型技能命中的目标按目标最大生命计算魔法灼烧；每500毫秒一次，持续3秒。',
      sortOrder: 10,
      lifecycle: timedPeriodicLifecycle({ durationValue: parameter('burn_duration_ms'), intervalValue: parameter('burn_tick_interval_ms'), instanceScope: 'TARGET' }),
      results: [{
        resultKey: 'magic_burn', name: '目标最大生命比例魔法伤害', resultType: 'DAMAGE', target: 'TARGET',
        description: '每次跳频造成目标最大生命1%的魔法伤害；1%由2%每秒乘0.5秒得到。',
        sortOrder: 10, lifecycleBehavior: periodicDamageBehavior, spellShieldBlockScope: null,
        valueRule: effectValue(formula('burn_damage_per_tick')),
        detail: { damageTypeKey: 'magic', deliveryKind: 'SKILL', originKind: 'DIRECT', critical: { mode: 'DISALLOWED', multiplierValue: null }, vampRules: [] }
      }]
    }],
    triggerRules: [],
    pendingRules: [
      '灼烧只应由伤害型技能触发；现有SKILL_HIT没有伤害类型字段，DAMAGE_DEALT虽可筛魔法技能但不能同时限定英雄类别，不写宽泛触发。',
      '受苦每秒2%最多3层的伤害修正需要DAMAGE修正乘区，当前该目录为空；只保存比例、层数和计数持续时间，不把它伪造成属性加成。',
      '战斗结束处理、灼烧再次命中的重施规则与完整目标范围未在本批声明为运行时完成。小兵/野怪专属的40点上限和1250生命阈值不录入。'
    ],
    pendingEffects: [{ effectKey: 'suffer_damage_modifier', resultType: 'DAMAGE_MODIFIER', target: 'SOURCE', reason: '每层额外伤害比例已确证，但当前没有可用伤害修正乘区，且战斗计时/英雄目标筛选未形成完整效果。' }],
    relation: { equipmentKey: 'item_6653', skillKey: 'item_6653_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/6653/mDataValues/BurnDuration、BurnPercentHealthDamage、DamageIncreasePerSecond、DamageIncreaseMax、TickFrequency、MonsterDamageCap、MaxDamageHPThreshold、BuffCounterDuration、MaxStackNumber', evidence: 'BurnDuration=3、BurnPercentHealthDamage=0.02、DamageIncreasePerSecond=0.02、DamageIncreaseMax=0.06、TickFrequency=0.5、BuffCounterDuration=3、MaxStackNumber=3；MonsterDamageCap和MaxDamageHPThreshold只属于怪物上限支路。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_6653_tooltip、entries/GeneratedTip_Item_6653_Description', evidence: '伤害型技能灼烧目标每秒2%最大生命、持续3秒；与英雄战斗每秒2%额外伤害，最多6%。' },
      { file: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json', pointer: '/data/6653/description、/data/6653/stats', evidence: '官方说明与客户端共同确证灼烧和受苦比例、持续和上限。' }
    ],
    arithmetic: [
      { sample: '目标最大生命2000的单次灼烧', expected: 20, actual: 2000 * 0.02 * 0.5, unit: '点魔法伤害；每500毫秒一次' },
      { sample: '3秒灼烧总跳数', expected: 6, actual: 3000 / 500, unit: '次；仅算术样例' },
      { sample: '受苦第三层与第四次计时', expected: 0.06, actual: Math.min(3, 4) * 0.02, unit: '额外伤害比例；第四次不超过6%' }
    ]
  },
  {
    equipmentKey: 'item_8010', equipmentName: '放血者的诅咒',
    directAttributes: { hp: 400, ability_power: 65, ability_haste: 15 },
    skill: {
      skillKey: 'item_8010_passive', name: '放血者的诅咒·恶劣衰朽',
      description: '保存技能或被动对英雄造成魔法伤害时的7.5%魔抗削减、6秒持续和最多4层；同一段技能施放对每个英雄至多增加一层，另有300毫秒限制。当前不挂宽泛触发规则，不把每次合法魔法伤害直接当作独立层。',
      maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'mr_shred_ratio_per_stack', name: '恶劣衰朽每层魔抗削减', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.075, levelValues: null, description: '每层降低目标魔法抗性7.5%，小数0.075表示7.5个百分点。', sortOrder: 10 },
      { parameterKey: 'mr_shred_duration_ms', name: '恶劣衰朽持续时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 6000, levelValues: null, description: '魔抗削减持续6秒，单位：毫秒。', sortOrder: 20 },
      { parameterKey: 'mr_shred_max_stacks', name: '恶劣衰朽最大层数', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 4, levelValues: null, description: '最多4层；第四层后再次触发不增加层数。', sortOrder: 30 },
      { parameterKey: 'magic_damage_internal_cooldown_ms', name: '恶劣衰朽内部间隔', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 300, levelValues: null, description: '客户端InternalCD=0.3秒，单位：毫秒；具体按技能或被动伤害的计数时点待核。', sortOrder: 40 }
    ],
    formulas: [],
    effects: [{
      effectKey: 'magic_resistance_shred', name: '恶劣衰朽目标魔抗削减',
      description: '技能或被动对英雄造成魔法伤害时应用7.5%魔抗削减，持续6秒，最多4层；同一段技能施放对每个英雄至多增加一层，另有300毫秒限制。当前未挂触发规则，避免宽泛复用。',
      sortOrder: 10,
      lifecycle: stackedTargetLifecycle(parameter('mr_shred_duration_ms'), parameter('mr_shred_max_stacks')),
      results: [{
        resultKey: 'magic_resistance_reduction', name: '目标魔法抗性降低', resultType: 'ATTRIBUTE_CHANGE', target: 'TARGET',
        description: '每层降低目标7.5%魔法抗性；同一段技能施放对每个英雄至多一层，另有300毫秒限制；达到第四层后不再增加层数。',
        sortOrder: 10, lifecycleBehavior: stackedTargetBehavior, spellShieldBlockScope: null,
        valueRule: effectValue(parameter('mr_shred_ratio_per_stack')),
        detail: { attributeKey: 'magic_resistance', operation: 'DECREASE', modifierZoneKey: 'item_8010_magic_resistance_reduction' }
      }]
    }],
    triggerRules: [],
    pendingRules: [
      '来源触发覆盖技能或被动魔法伤害并限定英雄；现有DAMAGE_DEALT可筛魔法但没有同时限定英雄的目标类别条件，不写会误伤非英雄或漏掉被动支路的宽泛规则。',
      '单一来源按4层计算为30%削减，已使用独立RATIO_ADD乘区；与黑色切割者或其他百分比减抗来源的先后和剩余比例组合未在当前作者配置中确认。',
      '0.3秒内部间隔已作为参数保存，具体对多段技能和被动伤害如何去重待运行链核对。'
    ],
    pendingEffects: [],
    relation: { equipmentKey: 'item_8010', skillKey: 'item_8010_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/8010/mDataValues/ShredPerStack、DebuffDuration、InternalCD、MaxStacks、mFlatHPPoolMod、mFlatMagicDamageMod、mAbilityHasteMod', evidence: 'ShredPerStack=0.075、DebuffDuration=6、InternalCD=0.3、MaxStacks=4。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries/item_8010_tooltip、entries/GeneratedTip_Item_8010_Description', evidence: '技能或被动对英雄造成魔法伤害时，持续6秒的7.5%魔抗削减，可叠加4次。' },
      { file: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json', pointer: '/data/8010/description、/data/8010/stats', evidence: '官方说明与客户端绑定值共同确证每层、持续和上限。' }
    ],
    arithmetic: [
      { sample: '放血者第四层目标魔抗总削减', expected: 0.3, actual: 4 * 0.075, unit: '比例；小数0.3表示30%' },
      { sample: '第四层后再次触发', expected: 0.3, actual: Math.min(4, 5) * 0.075, unit: '比例；第五次不超过4层' }
    ]
  }
];
const sourceFiles = [
  '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz',
  '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz',
  '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json',
];

async function request(method, path, body) {
  if (method === 'DELETE') throw new Error('正常录入入口禁止删除；删除只能由有界纠错入口执行');
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
