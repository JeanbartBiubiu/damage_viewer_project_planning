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
const effectValue = (value) => ({
  value,
  fixedMultiplier: 1,
  fixedMinValue: 0,
  fixedMaxValue: null
});
const damageResult = ({ resultKey = 'damage', name, description, target = 'TARGET', value, damageTypeKey, originKind = 'DIRECT' }) => ({
  resultKey,
  name,
  resultType: 'DAMAGE',
  target,
  description,
  sortOrder: 10,
  lifecycleBehavior: null,
  spellShieldBlockScope: null,
  valueRule: effectValue(value),
  detail: {
    damageTypeKey,
    deliveryKind: 'BASIC_ATTACK',
    originKind,
    critical: { mode: 'DISALLOWED', multiplierValue: null },
    vampRules: []
  }
});
const fixedLifecycle = (durationValue, instanceScope = 'SOURCE') => ({
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
const persistentBehavior = (reapplicationValueMode = 'REPLACE') => ({
  moment: 'PERSISTENT',
  valueReadMode: 'APPLICATION_SNAPSHOT',
  stackValueMode: 'SHARED',
  reapplicationValueMode,
  periodicExecutionMode: null
});
const spellShieldBehavior = {
  moment: 'PERSISTENT',
  valueReadMode: null,
  stackValueMode: null,
  reapplicationValueMode: null,
  periodicExecutionMode: null
};
const attributeResult = ({ resultKey, name, description, attributeKey, value, target = 'SOURCE', modifierZoneKey = 'attribute_flat_add', lifecycleBehavior = null }) => ({
  resultKey,
  name,
  resultType: 'ATTRIBUTE_CHANGE',
  target,
  description,
  sortOrder: 10,
  lifecycleBehavior,
  spellShieldBlockScope: null,
  valueRule: effectValue(value),
  detail: { attributeKey, operation: 'INCREASE', modifierZoneKey }
});

const objects = [
  {
    equipmentKey: 'item_3075',
    equipmentName: '荆棘之甲',
    skill: {
      skillKey: 'item_3075_passive',
      name: '荆棘之甲·荆棘',
      description: '被一次攻击命中后，对攻击者造成20加来源额外护甲10%的魔法反伤。本批保存确证的伤害组成；受击方向和英雄目标重伤状态的运行时接线待补。',
      maxLevel: 1,
      status: 'ENABLED',
      sortOrder: 0,
      skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'base_damage', name: '荆棘基础反伤', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 20, levelValues: null, description: '荆棘基础魔法反伤，单位：伤害点。', sortOrder: 10 },
      { parameterKey: 'bonus_armor_ratio', name: '额外护甲反伤倍率', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.1, levelValues: null, description: '以来源额外护甲为基数的反伤倍率，小数1表示100%。', sortOrder: 20 },
      { parameterKey: 'grievous_amount', name: '重伤比例', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.4, levelValues: null, description: '冻结说明中的重伤比例，小数0.4表示40%；重伤状态暂未引用共享状态字典。', sortOrder: 30 },
      { parameterKey: 'grievous_duration_ms', name: '重伤持续时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 3000, levelValues: null, description: '重伤持续时间，单位：毫秒；状态接线待补。', sortOrder: 40 }
    ],
    formulas: [{
      formulaKey: 'thorn_damage',
      name: '荆棘魔法反伤',
      description: '20点基础反伤加来源额外护甲的10%。',
      sortOrder: 10,
      expression: operation('ADD', parameterNode('base_damage'), operation('MULTIPLY', parameterNode('bonus_armor_ratio'), attribute('SOURCE', 'armor', 'BONUS')))
    }],
    effects: [{
      effectKey: 'thorn_damage',
      name: '荆棘魔法反伤',
      description: '保存被攻击后对攻击者造成的魔法反伤组成，伤害来源标为反射；受击方向规则和重伤状态未在本批猜测接线。',
      sortOrder: 10,
      lifecycle: null,
      results: [damageResult({ name: '反射魔法伤害', description: '20加来源额外护甲10%的魔法反伤。', value: formula('thorn_damage'), damageTypeKey: 'magic', originKind: 'REFLECTED' })]
    }],
    triggerRules: [{
      ruleKey: 'reflect_on_basic_attack_taken',
      name: '受到普攻命中后反伤',
      description: '按冻结说明把直接的普通攻击伤害筛选为受击事件，并以事件来源对象作为反伤目标；重伤状态另因共享状态目录缺失而待补。',
      sortOrder: 10,
      eventSource: { eventType: 'DAMAGE_TAKEN', detail: { damageTypeKey: null, deliveryKind: 'BASIC_ATTACK', originKind: 'DIRECT' } },
      conditionGroups: [],
      actions: [{ actionKey: 'execute_thorn_damage', name: '执行荆棘反伤', actionType: 'EXECUTE_EFFECT', sortOrder: 10, targetContext: 'EVENT_SOURCE', detail: { effectKey: 'thorn_damage' }, runtimeInputBindings: [], resultModifiers: [] }],
      perTargetCooldown: null,
      maxTriggersPerProcess: null
    }],
    pendingRules: ['重伤状态键不在现有共享状态目录中，本批不创建共享状态；英雄目标判断和3秒持续时间仅保存为参数。'],
    relation: { equipmentKey: 'item_3075', skillKey: 'item_3075_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/3075/mDataValues、Items/3075/mItemCalculations/TotalDamage', evidence: 'BaseDamage=20；BonusArmorDamageRatio=0.10000000149011612；TotalDamage由基础值与来源额外护甲倍率组成。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries.item_3075_tooltip', evidence: '被一次攻击命中后，对攻击者造成魔法伤害；英雄目标施加持续3秒的40%重伤。' }
    ],
    arithmetic: [{ sample: '来源额外护甲200', expected: 40, actual: 20 + 0.1 * 200, unit: '伤害点' }]
  },
  {
    equipmentKey: 'item_3076',
    equipmentName: '棘刺背心',
    skill: {
      skillKey: 'item_3076_passive',
      name: '棘刺背心·荆棘',
      description: '被一次攻击命中后，对攻击者造成固定10点魔法反伤。本批按冻结客户端完整对象保存固定伤害；重伤状态与受击方向接线待补。',
      maxLevel: 1,
      status: 'ENABLED',
      sortOrder: 0,
      skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'base_damage', name: '荆棘基础反伤', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 10, levelValues: null, description: '冻结客户端对象中的固定魔法反伤，单位：伤害点。', sortOrder: 10 },
      { parameterKey: 'grievous_amount', name: '重伤比例', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.4, levelValues: null, description: '冻结说明中的重伤比例，小数0.4表示40%；重伤状态暂未引用共享状态字典。', sortOrder: 20 },
      { parameterKey: 'grievous_duration_ms', name: '重伤持续时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 3000, levelValues: null, description: '重伤持续时间，单位：毫秒；状态接线待补。', sortOrder: 30 }
    ],
    formulas: [],
    effects: [{
      effectKey: 'thorn_damage',
      name: '荆棘固定魔法反伤',
      description: '保存冻结客户端确证的固定10点魔法反伤；官方静态装备说明的0点仅作差异记录，不覆盖客户端完整对象。',
      sortOrder: 10,
      lifecycle: null,
      results: [damageResult({ name: '固定反射魔法伤害', description: '固定10点魔法反伤。', value: parameter('base_damage'), damageTypeKey: 'magic', originKind: 'REFLECTED' })]
    }],
    triggerRules: [{
      ruleKey: 'reflect_on_basic_attack_taken',
      name: '受到普攻命中后反伤',
      description: '按冻结说明把直接的普通攻击伤害筛选为受击事件，并以事件来源对象作为反伤目标；重伤状态另因共享状态目录缺失而待补。',
      sortOrder: 10,
      eventSource: { eventType: 'DAMAGE_TAKEN', detail: { damageTypeKey: null, deliveryKind: 'BASIC_ATTACK', originKind: 'DIRECT' } },
      conditionGroups: [],
      actions: [{ actionKey: 'execute_thorn_damage', name: '执行荆棘反伤', actionType: 'EXECUTE_EFFECT', sortOrder: 10, targetContext: 'EVENT_SOURCE', detail: { effectKey: 'thorn_damage' }, runtimeInputBindings: [], resultModifiers: [] }],
      perTargetCooldown: null,
      maxTriggersPerProcess: null
    }],
    pendingRules: ['客户端对象未给出额外护甲倍率，不建立3075的倍率公式。', '重伤状态键不在现有共享状态目录中，本批不创建共享状态；英雄目标判断和3秒持续时间仅保存为参数。'],
    relation: { equipmentKey: 'item_3076', skillKey: 'item_3076_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/3076/mDataValues、Items/3076/mItemCalculations/TotalDamage', evidence: '完整对象明确BaseDamage=10；BonusArmorDamageRatio无值；TotalDamage只有BaseDamage。' },
      { file: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json', pointer: 'data.3076', evidence: '直接属性30护甲，文本显示0魔法伤害；与冻结客户端对象的10点伤害存在差异，按客户端完整对象保存伤害并在报告标记。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries.item_3076_tooltip', evidence: '文本确认被攻击命中、魔法伤害、40%重伤3秒。' }
    ],
    arithmetic: [{ sample: '任意来源额外护甲', expected: 10, actual: 10, unit: '伤害点' }]
  },
  {
    equipmentKey: 'item_3057',
    equipmentName: '耀光',
    skill: {
      skillKey: 'item_3057_passive',
      name: '耀光·咒刃',
      description: '施放技能后，下一次普通攻击造成来源基础攻击力1倍的额外物理伤害。本批保存数值组成；施放后就绪、下一次攻击消费和冷却运行时接线待补。',
      maxLevel: 1,
      status: 'ENABLED',
      sortOrder: 0,
      skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'spellblade_ad_ratio', name: '咒刃基础攻击力倍率', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 1, levelValues: null, description: '咒刃额外物理伤害对来源基础攻击力的倍率，小数1表示100%。', sortOrder: 10 },
      { parameterKey: 'spellblade_cooldown_ms', name: '咒刃冷却时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 1500, levelValues: null, description: '客户端咒刃冷却时间，单位：毫秒；冷却消费规则待运行时接线。', sortOrder: 20 }
    ],
    formulas: [{
      formulaKey: 'spellblade_damage',
      name: '咒刃额外物理伤害',
      description: '来源基础攻击力乘以1倍咒刃倍率。',
      sortOrder: 10,
      expression: operation('MULTIPLY', parameterNode('spellblade_ad_ratio'), attribute('SOURCE', 'attack_damage', 'BASE'))
    }],
    effects: [{
      effectKey: 'spellblade_damage',
      name: '咒刃额外物理伤害',
      description: '保存下一次普通攻击的额外物理伤害组成；技能施放后就绪与消费规则待补。',
      sortOrder: 10,
      lifecycle: null,
      results: [damageResult({ name: '咒刃物理伤害', description: '来源基础攻击力1倍的额外物理伤害。', value: formula('spellblade_damage'), damageTypeKey: 'physics' })]
    }],
    triggerRules: [],
    pendingRules: ['“施放技能后下一次普通攻击”需要就绪标记、消费和冷却状态；当前批不把所有普通攻击直接接成咒刃。'],
    relation: { equipmentKey: 'item_3057', skillKey: 'item_3057_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/3057/mDataValues、Items/3057/mItemCalculations/SpellbladeDamage', evidence: 'SpellbladeDamage为来源基础攻击力乘1；SpellbladeCooldown=1.5秒。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries.item_3057_tooltip', evidence: '施放技能后下一次普通攻击造成额外物理伤害。' }
    ],
    arithmetic: [{ sample: '来源基础攻击力100', expected: 100, actual: 1 * 100, unit: '伤害点' }]
  },
  {
    equipmentKey: 'item_3078',
    equipmentName: '三相之力',
    skill: {
      skillKey: 'item_3078_passive',
      name: '三相之力·咒刃与加快',
      description: '施放技能后下一次普通攻击造成来源基础攻击力2倍的额外物理伤害；攻击单位时提供20点移动速度，持续2秒。本批保存两部分确证组成，咒刃就绪消费待运行时接线。',
      maxLevel: 1,
      status: 'ENABLED',
      sortOrder: 0,
      skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'spellblade_ad_ratio', name: '咒刃基础攻击力倍率', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 2, levelValues: null, description: '咒刃额外物理伤害对来源基础攻击力的倍率，小数1表示100%。', sortOrder: 10 },
      { parameterKey: 'spellblade_cooldown_ms', name: '咒刃冷却时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 1500, levelValues: null, description: '客户端咒刃冷却时间，单位：毫秒；冷却消费规则待运行时接线。', sortOrder: 20 },
      { parameterKey: 'move_speed_bonus', name: '加快移动速度', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 20, levelValues: null, description: '攻击单位后增加的固定移动速度，单位：移动速度点。', sortOrder: 30 },
      { parameterKey: 'move_speed_duration_ms', name: '加快持续时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 2000, levelValues: null, description: '加快持续时间，单位：毫秒。', sortOrder: 40 }
    ],
    formulas: [{
      formulaKey: 'spellblade_damage',
      name: '咒刃额外物理伤害',
      description: '来源基础攻击力乘以2倍咒刃倍率。',
      sortOrder: 10,
      expression: operation('MULTIPLY', parameterNode('spellblade_ad_ratio'), attribute('SOURCE', 'attack_damage', 'BASE'))
    }],
    effects: [
      {
        effectKey: 'spellblade_damage',
        name: '咒刃额外物理伤害',
        description: '保存下一次普通攻击的额外物理伤害组成；技能施放后就绪与消费规则待补。',
        sortOrder: 10,
        lifecycle: null,
        results: [damageResult({ name: '咒刃物理伤害', description: '来源基础攻击力2倍的额外物理伤害。', value: formula('spellblade_damage'), damageTypeKey: 'physics' })]
      },
      {
        effectKey: 'move_speed',
        name: '加快移动速度',
        description: '攻击一个单位后，来源增加20点移动速度，持续2秒。',
        sortOrder: 20,
        lifecycle: fixedLifecycle(parameter('move_speed_duration_ms')),
        results: [attributeResult({ resultKey: 'move_speed', name: '固定移动速度增加', description: '增加20点固定移动速度。', attributeKey: 'move_speed', value: parameter('move_speed_bonus'), lifecycleBehavior: persistentBehavior() })]
      }
    ],
    triggerRules: [{
      ruleKey: 'grant_move_speed_on_basic_attack_hit',
      name: '攻击命中获得加快',
      description: '客户端说明明确为攻击一个单位后提供持续2秒的20点移动速度；本规则只接入普攻命中这一已有事件，不扩大咒刃触发范围。',
      sortOrder: 20,
      eventSource: { eventType: 'BASIC_ATTACK_HIT', detail: {} },
      conditionGroups: [],
      actions: [{ actionKey: 'execute_move_speed', name: '执行加快移动速度', actionType: 'EXECUTE_EFFECT', sortOrder: 10, targetContext: 'CURRENT_TARGET', detail: { effectKey: 'move_speed' }, runtimeInputBindings: [], resultModifiers: [] }],
      perTargetCooldown: null,
      maxTriggersPerProcess: null
    }],
    pendingRules: ['咒刃部分需要施法后就绪标记、下一次普通攻击消费和冷却恢复；不以普攻命中规则代替。'],
    relation: { equipmentKey: 'item_3078', skillKey: 'item_3078_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/3078/mDataValues、Items/3078/mItemCalculations/SpellbladeDamage', evidence: 'SpellbladeMultiplier=2；MoveSpeedBonus=20；MSDuration=2；SpellbladeCooldown=1.5秒。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries.item_3078_tooltip', evidence: '施放技能后下一次普攻造成额外物理伤害；攻击一个单位提供持续2秒的20移动速度。' }
    ],
    arithmetic: [
      { sample: '来源基础攻击力100', expected: 200, actual: 2 * 100, unit: '伤害点' },
      { sample: '攻击命中后的移动速度', expected: 20, actual: 20, unit: '移动速度点，持续2000毫秒' }
    ]
  },
  {
    equipmentKey: 'item_3100',
    equipmentName: '巫妖之祸',
    skill: {
      skillKey: 'item_3100_passive',
      name: '巫妖之祸·咒刃',
      description: '施放技能后10秒内下一次攻击获得50%额外攻击速度，并造成来源基础攻击力75%加总法术强度45%的额外魔法伤害。本批保存伤害与就绪攻击速度组成，状态消费待运行时接线。',
      maxLevel: 1,
      status: 'ENABLED',
      sortOrder: 0,
      skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'spellblade_ad_ratio', name: '咒刃基础攻击力倍率', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.75, levelValues: null, description: '咒刃伤害对来源基础攻击力的倍率，小数1表示100%。', sortOrder: 10 },
      { parameterKey: 'spellblade_ap_ratio', name: '咒刃法术强度倍率', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.45, levelValues: null, description: '咒刃伤害对来源总法术强度的倍率，小数1表示100%。', sortOrder: 20 },
      { parameterKey: 'attack_speed_bonus', name: '咒刃额外攻击速度', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.5, levelValues: null, description: '咒刃就绪攻击获得的额外攻击速度比例，小数0.5表示50%。', sortOrder: 30 },
      { parameterKey: 'ready_duration_ms', name: '咒刃就绪窗口', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 10000, levelValues: null, description: '施法后咒刃就绪窗口，单位：毫秒。', sortOrder: 40 },
      { parameterKey: 'spellblade_cooldown_ms', name: '咒刃冷却时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 1500, levelValues: null, description: '客户端咒刃冷却时间，单位：毫秒；冷却消费规则待运行时接线。', sortOrder: 50 }
    ],
    formulas: [{
      formulaKey: 'spellblade_damage',
      name: '咒刃额外魔法伤害',
      description: '来源基础攻击力75%加总法术强度45%。',
      sortOrder: 10,
      expression: operation('ADD', operation('MULTIPLY', parameterNode('spellblade_ad_ratio'), attribute('SOURCE', 'attack_damage', 'BASE')), operation('MULTIPLY', parameterNode('spellblade_ap_ratio'), attribute('SOURCE', 'ability_power', 'TOTAL')))
    }],
    effects: [
      {
        effectKey: 'spellblade_damage',
        name: '咒刃额外魔法伤害',
        description: '保存施法后下一次攻击的额外魔法伤害组成；就绪与一次攻击消费规则待补。',
        sortOrder: 10,
        lifecycle: null,
        results: [damageResult({ name: '咒刃魔法伤害', description: '来源基础攻击力75%加总法术强度45%的额外魔法伤害。', value: formula('spellblade_damage'), damageTypeKey: 'magic' })]
      },
      {
        effectKey: 'spellblade_attack_speed',
        name: '咒刃就绪攻击速度',
        description: '咒刃就绪窗口内的下一次攻击获得50%额外攻击速度；本效果保存持续窗口，下一次攻击消费待运行时接线。',
        sortOrder: 20,
        lifecycle: fixedLifecycle(parameter('ready_duration_ms')),
        results: [attributeResult({ resultKey: 'attack_speed', name: '额外攻击速度', description: '增加50%额外攻击速度比例。', attributeKey: 'bonus_attack_speed_percent', value: parameter('attack_speed_bonus'), lifecycleBehavior: persistentBehavior() })]
      }
    ],
    triggerRules: [],
    pendingRules: ['“施放技能后下一次攻击”需要就绪标记和一次攻击消费；当前批不把全部普攻直接接成巫妖咒刃。'],
    relation: { equipmentKey: 'item_3100', skillKey: 'item_3100_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/3100/mDataValues、Items/3100/mItemCalculations/SpellbladeDamage', evidence: 'SpellbladeADRatio=0.75；LichBaneAPValue=0.45；SheenASBuff=0.5；SpellBladeDuration=10；SpellbladeCooldown=1.5秒。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries.item_3100_tooltip', evidence: '施放技能后10秒内下一次攻击获得50%攻击速度并造成额外魔法伤害。' }
    ],
    arithmetic: [{ sample: '来源基础攻击力100、总法术强度200', expected: 165, actual: 0.75 * 100 + 0.45 * 200, unit: '伤害点' }]
  },
  {
    equipmentKey: 'item_3102',
    equipmentName: '女妖面纱',
    skill: {
      skillKey: 'item_3102_passive',
      name: '女妖面纱·废除',
      description: '提供一层法术护盾来格挡下一个敌方技能，冷却时间40秒。本批保存法术护盾结果和冷却参数；护盾初始化、被格挡后消费和受英雄伤害重置待运行时接线。',
      maxLevel: 1,
      status: 'ENABLED',
      sortOrder: 0,
      skillCategoryKeys: ['passive']
    },
    parameters: [
      { parameterKey: 'spell_shield_cooldown_ms', name: '法术护盾冷却时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 40000, levelValues: null, description: '法术护盾冷却时间，单位：毫秒。', sortOrder: 10 }
    ],
    formulas: [],
    effects: [{
      effectKey: 'spell_shield',
      name: '法术护盾',
      description: '保存格挡下一个敌方技能的法术护盾结果；护盾初始化、消费和冷却重置规则待运行时接线。',
      sortOrder: 10,
      lifecycle: {
        durationValue: null,
        maxStacksValue: fixed(1),
        applicationStacksValue: fixed(1),
        instanceScope: 'SOURCE',
        reapplicationStackMode: 'KEEP',
        reapplicationDurationMode: null,
        expiryMode: 'EXPLICIT_ONLY',
        periodicIntervalValue: null,
        firstPeriodicExecution: null
      },
      results: [{
        resultKey: 'spell_shield',
        name: '格挡下一个敌方技能',
        resultType: 'SPELL_SHIELD',
        target: 'SOURCE',
        description: '格挡下一个敌方技能。',
        sortOrder: 10,
        lifecycleBehavior: spellShieldBehavior,
        spellShieldBlockScope: null,
        valueRule: null,
        detail: {}
      }]
    }],
    triggerRules: [],
    pendingRules: ['护盾应在装备生效时初始化并在成功格挡后消费；现有记录没有可直接复用的装备初始化事件。', '“冷却未完毕前受到英雄伤害则重置40秒”需要受击目标类别与冷却重置运行时语义。'],
    relation: { equipmentKey: 'item_3102', skillKey: 'item_3102_passive', sortOrder: 10 },
    sourceRefs: [
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz', pointer: 'Items/3102/mDataValues、Items/3102/mItemDataClient/mTooltipData/mLocKeys', evidence: 'Cooldown=40秒；客户端键明确法术护盾及冷却说明。' },
      { file: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz', pointer: 'entries.item_3102_tooltip、entries.item_3102_tooltipextended', evidence: '提供一层法术护盾格挡下一个敌方技能；冷却完毕前受到英雄伤害会重新开始计算。' }
    ],
    arithmetic: [{ sample: '冷却换算', expected: 40000, actual: 40 * 1000, unit: '毫秒' }]
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
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { status: response.status, data };
}

function isSuccess(result) {
  return result.status >= 200 && result.status < 300;
}

function compareFields(expected, actual, path = '', rows = []) {
  if (expected === null || typeof expected !== 'object') {
    rows.push({ path, expected, actual, equal: Object.is(expected, actual) });
    return rows;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      rows.push({ path, expected, actual, equal: false });
      return rows;
    }
    rows.push({ path: `${path}[]`, expectedCount: expected.length, actualCount: actual.length, equal: expected.length === actual.length });
    expected.forEach((value, index) => compareFields(value, actual[index], `${path}[${index}]`, rows));
    return rows;
  }
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    rows.push({ path, expected, actual, equal: false });
    return rows;
  }
  for (const [key, value] of Object.entries(expected)) {
    compareFields(value, actual[key], path ? `${path}.${key}` : key, rows);
  }
  return rows;
}

function mismatches(expected, actual) {
  return compareFields(expected, actual).filter((field) => !field.equal);
}

function listItems(data) {
  return Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
}

function mustSuccess(result, label) {
  if (!isSuccess(result)) {
    throw new Error(`${label} failed: HTTP ${result.status} ${JSON.stringify(result.data)}`);
  }
  return result;
}

async function hashFile(relativePath) {
  const absolutePath = new URL(`../../../../${relativePath}`, import.meta.url);
  try {
    const bytes = await readFile(absolutePath);
    return { relativePath, sha256: createHash('sha256').update(bytes).digest('hex') };
  } catch (error) {
    return { relativePath, missing: true, error: String(error.message ?? error) };
  }
}

async function writeResource({ kind, path, createPath, body, apply, record }) {
  const before = await request('GET', path);
  if (isSuccess(before)) {
    const fields = compareFields(body, before.data);
    if (fields.some((field) => !field.equal)) {
      throw new Error(`${kind} existing value differs; refusing overwrite: ${JSON.stringify(fields.filter((field) => !field.equal))}`);
    }
    record.push({ kind, path, state: 'same', expected: body, readback: before.data, fields });
    return before.data;
  }
  if (before.status !== 404) {
    throw new Error(`${kind} preflight failed: HTTP ${before.status} ${JSON.stringify(before.data)}`);
  }
  const row = { kind, path, state: apply ? 'created' : 'missing', expected: body, preflight: { status: before.status, data: before.data } };
  if (!apply) {
    record.push(row);
    return null;
  }
  const written = await request('POST', createPath, body);
  if (!isSuccess(written)) {
    const afterFailure = await request('GET', path);
    if (isSuccess(afterFailure)) {
      const fields = compareFields(body, afterFailure.data);
      if (!fields.some((field) => !field.equal)) {
        row.state = 'created-by-confirmed-retry';
        row.write = { status: written.status, data: written.data };
        row.readback = afterFailure.data;
        row.fields = fields;
        record.push(row);
        return afterFailure.data;
      }
    }
    throw new Error(`${kind} write failed and GET did not confirm same value: HTTP ${written.status} ${JSON.stringify(written.data)}`);
  }
  const read = mustSuccess(await request('GET', path), `${kind} readback`);
  row.write = { status: written.status, data: written.data };
  row.readback = read.data;
  row.fields = compareFields(body, read.data);
  if (row.fields.some((field) => !field.equal)) {
    throw new Error(`${kind} readback differs: ${JSON.stringify(row.fields.filter((field) => !field.equal))}`);
  }
  record.push(row);
  return read.data;
}

async function imageRecord(object, applyImages, record) {
  const equipmentImagePath = `/equipment/${encodeURIComponent(object.equipmentKey)}/representative-image`;
  const skillImagePath = `/skills/${encodeURIComponent(object.skill.skillKey)}/representative-image`;
  const equipmentImage = mustSuccess(await request('GET', equipmentImagePath), `${object.equipmentKey} equipment image`).data;
  const imageKey = equipmentImage?.image?.imageKey;
  if (!imageKey) throw new Error(`${object.equipmentKey} has no enabled representative image`);
  const skillImageResponse = await request('GET', skillImagePath);
  if (!isSuccess(skillImageResponse)) {
    if (skillImageResponse.status === 404) {
      record.push({ kind: 'representative-image', path: skillImagePath, state: 'skill-missing', equipmentImagePath, equipmentImage, expectedImageKey: imageKey });
      return;
    }
    throw new Error(`skill image preflight failed: HTTP ${skillImageResponse.status} ${JSON.stringify(skillImageResponse.data)}`);
  }
  const currentImage = skillImageResponse.data?.image;
  if (currentImage) {
    if (currentImage.imageKey !== imageKey) {
      throw new Error(`${object.skill.skillKey} representative image differs: expected ${imageKey}, got ${currentImage.imageKey}`);
    }
    record.push({ kind: 'representative-image', path: skillImagePath, state: 'same', equipmentImagePath, equipmentImage, expectedImageKey: imageKey, readback: skillImageResponse.data });
    return;
  }
  const row = { kind: 'representative-image', path: skillImagePath, state: applyImages ? 'created' : 'missing', equipmentImagePath, equipmentImage, expectedImageKey: imageKey, preflight: skillImageResponse.data };
  if (applyImages) {
    const written = await request('PUT', skillImagePath, { imageKey });
    if (!isSuccess(written)) {
      const afterFailure = await request('GET', skillImagePath);
      if (!isSuccess(afterFailure) || afterFailure.data?.image?.imageKey !== imageKey) {
        throw new Error(`representative image write failed: HTTP ${written.status} ${JSON.stringify(written.data)}`);
      }
      row.state = 'created-by-confirmed-retry';
      row.write = { status: written.status, data: written.data };
      row.readback = afterFailure.data;
    } else {
      const read = mustSuccess(await request('GET', skillImagePath), `${object.skill.skillKey} image readback`);
      row.write = { status: written.status, data: written.data };
      row.readback = read.data;
    }
    if (row.readback?.image?.imageKey !== imageKey) throw new Error(`representative image readback differs for ${object.skill.skillKey}`);
  }
  record.push(row);
}

async function relationRecord(object, apply, record) {
  const path = `/equipment-skill-relations?equipmentKey=${encodeURIComponent(object.equipmentKey)}`;
  const before = mustSuccess(await request('GET', path), `${object.equipmentKey} relation preflight`).data;
  const existing = listItems(before).find((item) => item.skillKey === object.skill.skillKey);
  if (existing) {
    const fields = compareFields(object.relation, existing);
    if (fields.some((field) => !field.equal)) {
      throw new Error(`relation existing value differs: ${JSON.stringify(fields.filter((field) => !field.equal))}`);
    }
    record.push({ kind: 'equipment-skill-relation', path, state: 'same', expected: object.relation, readback: existing, fields, listReadback: before });
    return;
  }
  const row = { kind: 'equipment-skill-relation', path, state: apply ? 'created' : 'missing', expected: object.relation, preflight: before };
  if (!apply) {
    record.push(row);
    return;
  }
  const written = await request('POST', '/equipment-skill-relations', object.relation);
  if (!isSuccess(written)) {
    const afterFailure = mustSuccess(await request('GET', path), `${object.equipmentKey} relation confirmation`).data;
    const confirmed = listItems(afterFailure).find((item) => item.skillKey === object.skill.skillKey);
    if (!confirmed) throw new Error(`relation write failed: HTTP ${written.status} ${JSON.stringify(written.data)}`);
    const fields = compareFields(object.relation, confirmed);
    if (fields.some((field) => !field.equal)) throw new Error(`relation failed with differing confirmed value: ${JSON.stringify(fields.filter((field) => !field.equal))}`);
    row.state = 'created-by-confirmed-retry';
    row.write = { status: written.status, data: written.data };
    row.readback = confirmed;
    row.fields = fields;
    row.listReadback = afterFailure;
    record.push(row);
    return;
  }
  const after = mustSuccess(await request('GET', path), `${object.equipmentKey} relation readback`).data;
  const confirmed = listItems(after).find((item) => item.skillKey === object.skill.skillKey);
  if (!confirmed) throw new Error(`relation readback missing ${object.skill.skillKey}`);
  row.write = { status: written.status, data: written.data };
  row.readback = confirmed;
  row.fields = compareFields(object.relation, confirmed);
  row.listReadback = after;
  if (row.fields.some((field) => !field.equal)) throw new Error(`relation readback differs: ${JSON.stringify(row.fields.filter((field) => !field.equal))}`);
  record.push(row);
}

async function runObject(object, { apply, applyImages }) {
  const skillPath = `/skills/${encodeURIComponent(object.skill.skillKey)}`;
  const record = {
    equipmentKey: object.equipmentKey,
    equipmentName: object.equipmentName,
    skillKey: object.skill.skillKey,
    sourceRefs: object.sourceRefs,
    pendingRules: object.pendingRules,
    arithmetic: object.arithmetic,
    components: []
  };
  const skill = await writeResource({ kind: 'skill', path: skillPath, createPath: '/skills', body: object.skill, apply, record: record.components });
  if (!skill) {
    record.status = '待录入';
    record.missingComponentCount = 1 + object.parameters.length + object.formulas.length + object.effects.length + object.triggerRules.length + 2;
    return record;
  }
  for (const item of object.parameters) {
    await writeResource({ kind: `parameter:${item.parameterKey}`, path: `${skillPath}/parameters/${encodeURIComponent(item.parameterKey)}`, createPath: `${skillPath}/parameters`, body: item, apply, record: record.components });
  }
  for (const item of object.formulas) {
    await writeResource({ kind: `formula:${item.formulaKey}`, path: `${skillPath}/formulas/${encodeURIComponent(item.formulaKey)}`, createPath: `${skillPath}/formulas`, body: item, apply, record: record.components });
  }
  for (const item of object.effects) {
    await writeResource({ kind: `effect:${item.effectKey}`, path: `${skillPath}/effects/${encodeURIComponent(item.effectKey)}`, createPath: `${skillPath}/effects`, body: item, apply, record: record.components });
  }
  for (const item of object.triggerRules) {
    await writeResource({ kind: `trigger-rule:${item.ruleKey}`, path: `${skillPath}/trigger-rules/${encodeURIComponent(item.ruleKey)}`, createPath: `${skillPath}/trigger-rules`, body: item, apply, record: record.components });
  }
  await relationRecord(object, apply, record.components);
  await imageRecord(object, applyImages, record.components);
  record.status = '已完成可保存组成';
  return record;
}

async function buildSourceHashes() {
  const rows = [];
  for (const file of sourceFiles) rows.push(await hashFile(file));
  return rows;
}

function summary(records) {
  const components = records.flatMap((record) => record.components ?? []);
  const fields = components.flatMap((component) => component.fields ?? []);
  const count = (prefix) => components.filter((component) => component.kind.startsWith(prefix)).length;
  return {
    equipmentCount: records.length,
    skillCount: count('skill'),
    parameterCount: count('parameter:'),
    formulaCount: count('formula:'),
    effectCount: count('effect:'),
    triggerRuleCount: count('trigger-rule:'),
    relationCount: count('equipment-skill-relation'),
    representativeImageCount: count('representative-image'),
    componentCount: components.length,
    fieldCount: fields.length,
    mismatchCount: fields.filter((field) => !field.equal).length,
    missingCount: components.filter((component) => component.state === 'missing' || component.state === 'skill-missing').length
  };
}

const apply = process.argv.includes('--apply');
const applyImages = process.argv.includes('--apply-images');
const writeCandidate = process.argv.includes('--write-candidate');
if (writeCandidate) {
  await writeFile(candidatePath, `${JSON.stringify({ generatedAt: new Date().toISOString(), objects }, null, 2)}\n`, 'utf8');
}

const records = [];
for (const object of objects) {
  records.push(await runObject(object, { apply, applyImages }));
}
const result = {
  generatedAt: new Date().toISOString(),
  mode: applyImages ? (apply ? '补缺并独立补图' : '独立补图') : (apply ? '补缺' : '只读逐字段回读'),
  apiBaseUrl,
  gameId: 'lol',
  source: {
    version: '16.17.1',
    clientDirectoryVersion: '16.17',
    hashes: await buildSourceHashes(),
    note: '仅保存冻结来源确证的独立组成；未把配置保存或接口回读称为运行时验证。'
  },
  objects: records,
  summary: summary(records)
};
await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ mode: result.mode, summary: result.summary, evidencePath: evidencePath.pathname, candidatePath: writeCandidate ? candidatePath.pathname : null }, null, 2));
