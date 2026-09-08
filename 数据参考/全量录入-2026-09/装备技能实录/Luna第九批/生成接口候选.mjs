import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');

const historical = read('录入候选.json');
const frozen = read('冻结来源.json');
const historicalByKey = new Map(historical.objects.map(object => [object.equipmentKey, object]));
const frozenByKey = new Map(frozen.objects.map(object => [object.equipmentKey, object]));

const fixed = value => ({ kind: 'FIXED', value });
const parameterValue = parameterKey => ({ kind: 'PARAMETER', parameterKey });
const formulaValue = formulaKey => ({ kind: 'FORMULA', formulaKey });
const valueRule = value => ({ value, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null });
const attribute = (attributeOwner, attributeKey, attributeValueKind) => ({
  nodeType: 'ATTRIBUTE', attributeOwner, attributeKey, attributeValueKind
});
const parameterNode = parameterKey => ({ nodeType: 'PARAMETER', parameterKey });
const operation = (operationName, left, right) => ({
  nodeType: 'OPERATION', operation: operationName, operands: [left, right]
});

const explicitLifecycle = (instanceScope = 'SOURCE', reapplicationStackMode = 'KEEP') => ({
  durationValue: null,
  maxStacksValue: fixed(1),
  applicationStacksValue: fixed(1),
  instanceScope,
  reapplicationStackMode,
  reapplicationDurationMode: null,
  expiryMode: 'EXPLICIT_ONLY',
  periodicIntervalValue: null,
  firstPeriodicExecution: null
});

const persistentBehavior = {
  moment: 'PERSISTENT',
  valueReadMode: null,
  stackValueMode: null,
  reapplicationValueMode: null,
  periodicExecutionMode: null
};

const damageResult = ({ resultKey, name, description, target = 'TARGET', value, damageTypeKey = 'physics', deliveryKind = 'BASIC_ATTACK' }) => ({
  resultKey,
  name,
  resultType: 'DAMAGE',
  target,
  description,
  sortOrder: 10,
  lifecycleBehavior: null,
  spellShieldBlockScope: null,
  valueRule: valueRule(value),
  detail: {
    damageTypeKey,
    deliveryKind,
    originKind: 'DIRECT',
    critical: { mode: 'DISALLOWED', multiplierValue: null },
    vampRules: []
  }
});

const spellShieldEffect = {
  effectKey: 'spell_shield',
  name: '废除法术护盾',
  description: '保存一层法术护盾；初始化授盾和成功格挡消费已配，60秒恢复与受伤重置待配。',
  sortOrder: 10,
  lifecycle: explicitLifecycle('SOURCE', 'REPLACE'),
  results: [{
    resultKey: 'spell_shield_block',
    name: '格挡下一个敌方技能',
    resultType: 'SPELL_SHIELD',
    target: 'SOURCE',
    description: '法术护盾结果本身不带数值；具体成功格挡范围由法术护盾事件语义决定。',
    sortOrder: 10,
    lifecycleBehavior: persistentBehavior,
    spellShieldBlockScope: null,
    valueRule: null,
    detail: {}
  }]
};

const empoweredAttackEffect = {
  effectKey: 'empowered_attack',
  name: '充能攻击额外物理伤害',
  description: '保存70加持有者最大生命值6%的额外物理伤害；距离跟踪、攻击消费、每目标冷却和永久生命转化另列待核。',
  sortOrder: 10,
  lifecycle: null,
  results: [damageResult({
    resultKey: 'physical_damage',
    name: '充能攻击额外物理伤害',
    description: '当前绑定树已确证的70加持有者最大生命值6%；持有者攻击命中消费时点尚未配置。',
    value: formulaValue('empowered_attack_damage')
  })]
};

const thirdAttackEffect = {
  effectKey: 'third_attack_damage',
  name: '第三次攻击额外物理伤害',
  description: '保存按角色等级展开的基础额外物理伤害；目标已损失生命提升、第三击计数和攻击特效接线另列待核。',
  sortOrder: 10,
  lifecycle: null,
  results: [damageResult({
    resultKey: 'physical_damage',
    name: '基础额外物理伤害',
    description: '角色等级1至18的基础值来自当前绑定DamageAmount；已损失生命提升未在本结果中伪造。',
    value: parameterValue('damage_amount_by_character_level')
  })]
};

const values = Object.fromEntries(Array.from({ length: 18 }, (_, index) => {
  const level = index + 1;
  return [String(level), level < 9 ? 150 : 150 + (level - 8) * 5];
}));

const sourceFiles = {
  client: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz',
  stringTable: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz',
  official: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json',
  historicalCandidate: '装备技能实录/Luna第九批/录入候选.json',
  frozenSource: '装备技能实录/Luna第九批/冻结来源.json'
};

const sourcePointerByKey = {
  item_2502: 'Items/2502',
  item_2504: 'Items/2504',
  item_3026: 'Items/3026',
  item_3084: 'Items/3084',
  item_4632: 'Items/4632',
  item_6672: 'Items/6672'
};

const apiParameters = {
  item_2502: [
    ['drain_range', '苦楚作用半径', 'INTEGER', 650, '当前绑定树DrainRange=650；附近目标判定范围。'],
    ['proc_interval_ms', '苦楚周期', 'INTEGER', 4000, '当前绑定树Cooldown=4秒，换算为4000毫秒。'],
    ['bonus_health_damage_ratio', '苦楚额外生命值伤害比例', 'DECIMAL', 0.03, '当前绑定树BonusHealthDrainPercentage=0.03；同源旁证确认持有者额外生命值。'],
    ['heal_multiplier', '苦楚伤害治疗倍率', 'DECIMAL', 2.5, '当前绑定树HealMultiplier=2.5；治疗基数为本次实际造成伤害。']
  ],
  item_2504: [
    ['shield_ratio', '法师之祸魔法护盾比例', 'DECIMAL', 0.15, '当前绑定树ShieldAmount=0.15；同源旁证确认持有者最大生命值。'],
    ['no_magic_damage_duration_ms', '未受魔法伤害等待时间', 'INTEGER', 15000, '当前绑定树OutOfCombatDuration=15秒，换算为15000毫秒。']
  ],
  item_3026: [
    ['stasis_duration_ms', '重生凝滞时间', 'INTEGER', 4000, '当前装备对象mEffectAmount[1]=4秒，换算为4000毫秒。'],
    ['revive_base_hp_ratio', '重生基础生命值比例', 'DECIMAL', 0.5, '当前装备对象mEffectAmount[0]=0.5；基数是基础生命值。'],
    ['revive_max_mana_ratio', '重生最大法力比例', 'DECIMAL', 1, '当前装备对象mEffectAmount[3]=1；基数是最大法力值。'],
    ['revive_cooldown_ms', '重生冷却时间', 'INTEGER', 300000, '当前装备对象mEffectAmount[2]=300秒，换算为300000毫秒。']
  ],
  item_3084: [
    ['per_target_cooldown_ms', '庞然吞食每目标冷却', 'INTEGER', 30000, '当前绑定树PerTargetCooldown=30秒，按目标分别计时。'],
    ['base_damage', '庞然吞食基础伤害', 'INTEGER', 70, '当前绑定树BaseDamage=70。'],
    ['max_health_damage_ratio', '庞然吞食最大生命伤害比例', 'DECIMAL', 0.06, '当前绑定树HPRatio=0.06，基数为持有者最大生命值。'],
    ['damage_to_max_health_ratio', '伤害转最大生命值比例', 'DECIMAL', 0.1, '当前绑定树DamageToMaxHealthRatio=0.10，基数为本次额外伤害。'],
    ['tracking_distance', '庞然吞食跟踪距离', 'INTEGER', 700, '当前绑定树DistanceToChampion=700。'],
    ['tracking_tick_count', '庞然吞食跟踪次数', 'INTEGER', 6, '当前绑定树NumTicksToTrigger=6。'],
    ['tracking_tick_interval_ms', '庞然吞食跟踪间隔', 'INTEGER', 500, '当前绑定树TrackerTickRate=0.5秒，换算为500毫秒。'],
    ['tracking_buff_duration_ms', '庞然吞食跟踪状态持续时间', 'INTEGER', 5000, '当前绑定树RangeTrackingBuffDuration=5秒，换算为5000毫秒。'],
    ['health_size_threshold', '体型提升生命值门槛', 'INTEGER', 1000, '当前绑定树HealthSizeThreshold=1000。'],
    ['size_ratio_per_threshold', '体型提升比例', 'DECIMAL', 0.03, '当前绑定树SizeAmount=0.03。'],
    ['size_ratio_cap', '体型提升上限', 'DECIMAL', 0.3, '当前绑定树SizeCap=0.30。']
  ],
  item_4632: [
    ['spell_shield_cooldown_ms', '法术护盾冷却', 'INTEGER', 60000, '当前绑定树SpellShieldCooldown=60秒，换算为60000毫秒。']
  ],
  item_6672: [
    ['attack_count', '放倒它攻击次数', 'INTEGER', 3, '当前绑定树AttackCount=3。'],
    ['buff_duration_ms', '放倒它计数状态持续时间', 'INTEGER', 4000, '当前绑定树BuffDuration=4秒，换算为4000毫秒。'],
    ['maximum_damage_multiplier', '放倒它伤害上限倍率', 'DECIMAL', 1.75, '当前绑定树MaxAmpNumber=1.75。'],
    ['ranged_damage_multiplier', '远程伤害倍率', 'DECIMAL', 0.8, '当前绑定树RangedDamageMultiplier=0.8；来源攻击类型分支。'],
    ['damage_amount_by_character_level', '放倒它按角色等级基础伤害', 'INTEGER', null, '当前绑定树DamageAmount的角色等级断点已展开为1至18级；不属于技能等级。', 'CHARACTER_LEVEL', values]
  ]
};

const apiFormulas = {
  item_2502: [{
    formulaKey: 'drain_damage', name: '苦楚魔法伤害', description: '持有者额外生命值的3%。', sortOrder: 10,
    expression: operation('MULTIPLY', attribute('SOURCE', 'hp', 'BONUS'), parameterNode('bonus_health_damage_ratio'))
  }],
  item_2504: [{
    formulaKey: 'magic_shield_amount', name: '法师之祸魔法护盾量', description: '持有者最大生命值的15%。', sortOrder: 10,
    expression: operation('MULTIPLY', attribute('SOURCE', 'hp', 'TOTAL'), parameterNode('shield_ratio'))
  }],
  item_3026: [{
    formulaKey: 'revive_base_health', name: '重生基础生命恢复量', description: '持有者基础生命值的50%；只保存恢复量公式，复活时序待配。', sortOrder: 10,
    expression: operation('MULTIPLY', attribute('SOURCE', 'hp', 'BASE'), parameterNode('revive_base_hp_ratio'))
  }, {
    formulaKey: 'revive_max_mana', name: '重生最大法力恢复量', description: '持有者最大法力值的100%；只保存恢复量公式，复活时序待配。', sortOrder: 20,
    expression: operation('MULTIPLY', attribute('SOURCE', 'mana', 'TOTAL'), parameterNode('revive_max_mana_ratio'))
  }],
  item_3084: [
    {
      formulaKey: 'empowered_attack_damage',
      name: '庞然吞食额外物理伤害',
      description: '70加持有者最大生命值6%。',
      sortOrder: 10,
      expression: operation('ADD', parameterNode('base_damage'), operation('MULTIPLY', attribute('SOURCE', 'hp', 'TOTAL'), parameterNode('max_health_damage_ratio')))
    },
    {
      formulaKey: 'tracking_duration_ms',
      name: '六次跟踪总时间',
      description: '六次跟踪，每次间隔500毫秒，合计3000毫秒。',
      sortOrder: 20,
      expression: operation('MULTIPLY', parameterNode('tracking_tick_count'), parameterNode('tracking_tick_interval_ms'))
    }
  ],
  item_6672: [
    {
      formulaKey: 'maximum_damage',
      name: '放倒它伤害上限',
      description: '按当前角色等级基础伤害乘客户端MaxAmpNumber=1.75；目标已损失生命插值仍待核。',
      sortOrder: 10,
      expression: operation('MULTIPLY', parameterNode('damage_amount_by_character_level'), parameterNode('maximum_damage_multiplier'))
    },
    {
      formulaKey: 'ranged_damage',
      name: '远程放倒它伤害',
      description: '按当前角色等级基础伤害乘客户端RangedDamageMultiplier=0.8；来源攻击类型分支。',
      sortOrder: 20,
      expression: operation('MULTIPLY', parameterNode('damage_amount_by_character_level'), parameterNode('ranged_damage_multiplier'))
    }
  ]
};

const apiEffects = {
  item_2502: [{
    effectKey: 'drain_damage', name: '苦楚单次魔法伤害', sortOrder: 10, lifecycle: null,
    description: '保存持有者额外生命值3%的单次魔法伤害；英雄战斗状态、4秒周期、650范围筛选和按实际伤害治疗另列待配。',
    results: [damageResult({ resultKey: 'magic_damage', name: '苦楚魔法伤害', description: '持有者额外生命值3%的独立伤害结果。', value: formulaValue('drain_damage'), damageTypeKey: 'magic', deliveryKind: 'SKILL' })]
  }],
  item_2504: [{
    effectKey: 'magic_shield', name: '法师之祸魔法护盾', sortOrder: 10,
    description: '保存持有者最大生命值15%的普通魔法护盾；连续15秒未受魔法伤害的授盾和再获取时序另列待配。',
    lifecycle: explicitLifecycle('SOURCE', 'KEEP'),
    results: [{
      resultKey: 'magic_shield', name: '只吸收魔法伤害的普通护盾', resultType: 'NORMAL_SHIELD', target: 'SOURCE', sortOrder: 10,
      description: '普通魔法护盾按数值吸收魔法伤害，不是格挡技能的法术护盾。',
      lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED', reapplicationValueMode: 'REPLACE', periodicExecutionMode: null },
      spellShieldBlockScope: null, valueRule: valueRule(formulaValue('magic_shield_amount')),
      detail: { absorbedDamageTypeKey: 'magic', decayMode: 'NONE' }
    }]
  }],
  item_3084: [empoweredAttackEffect],
  item_4632: [spellShieldEffect, {
    effectKey: 'consume_spell_shield', name: '成功格挡后消费法术护盾', sortOrder: 20, lifecycle: null,
    description: '只由本技能法术护盾成功格挡事件执行，显式移除持有者自身护盾；60秒恢复与受伤重置待配。',
    results: [{
      resultKey: 'remove_spell_shield', name: '移除已成功格挡的法术护盾', resultType: 'LIFECYCLE_OPERATION', target: 'SOURCE', sortOrder: 10,
      description: '成功格挡后移除来源自身的本技能护盾。', lifecycleBehavior: null, spellShieldBlockScope: null, valueRule: null,
      detail: { operation: 'REMOVE', targetEffectKey: 'spell_shield' }
    }]
  }],
  item_6672: [thirdAttackEffect]
};

const apiTriggerRules = {
  item_4632: [{
    ruleKey: 'initialize_spell_shield', name: '初始化废除法术护盾', sortOrder: 10,
    description: '装备持有者初始化时建立自身一层法术护盾；成功格挡后的60秒恢复和受伤重置待配。',
    eventSource: { eventType: 'SOURCE_INITIALIZED', detail: {} }, conditionGroups: [], maxTriggersPerProcess: null, perTargetCooldown: null,
    actions: [{ actionKey: 'execute_spell_shield', name: '授予自身法术护盾', actionType: 'EXECUTE_EFFECT', sortOrder: 10, targetContext: 'EVENT_SOURCE', runtimeInputBindings: [], resultModifiers: [], detail: { effectKey: 'spell_shield' } }]
  }, {
    ruleKey: 'consume_on_spell_block', name: '法术护盾成功格挡后消费', sortOrder: 20,
    description: '只接收本技能法术护盾成功格挡事件；普通攻击、自然结束或其他护盾格挡不触发本消费。',
    eventSource: { eventType: 'SPELL_SHIELD_BLOCKED', detail: { shieldEffectKey: 'spell_shield' } }, conditionGroups: [], maxTriggersPerProcess: null, perTargetCooldown: null,
    actions: [{ actionKey: 'consume_shield', name: '消费自身法术护盾', actionType: 'EXECUTE_EFFECT', sortOrder: 10, targetContext: 'CURRENT_TARGET', runtimeInputBindings: [], resultModifiers: [], detail: { effectKey: 'consume_spell_shield' } }]
  }]
};

const omitted = {
  item_2502: [
    { kind: 'formula', key: 'self_heal_from_drain_damage', reason: '客户端同次结果引用不能直接作为当前基础公式节点。' },
    { kind: 'trigger-rule', key: 'drain_damage_and_heal', reason: '英雄战斗状态开始/结束、4秒周期、650范围目标筛选及实际伤害治疗联动尚待配。' }
  ],
  item_2504: [
    { kind: 'trigger-rule', key: 'grant_and_regrant_magic_shield', reason: '连续15秒未受魔法伤害的计时、重置与授盾时序待配。' }
  ],
  item_3026: [
    { kind: 'effect', key: 'lethal_stasis', reason: '候选STASIS不是当前接口结果类型；不能改写成普通免疫。' },
    { kind: 'effect', key: 'revive_restore', reason: '致命伤害前置、凝滞结束一次性恢复和资源结果类型尚未完整核对。' }
  ],
  item_3084: [
    { kind: 'formula', key: 'max_health_gain', reason: '客户端同次DamageProcCalc引用需内联，但永久生命增长时点和实际/折前伤害基数未核。' },
    { kind: 'effect', key: 'size_increase', reason: '体型属性结果键未由现有契约确认。' }
  ],
  item_4632: [
    { kind: 'trigger-rule', key: 'regrant_after_cooldown', reason: '成功格挡后的60000毫秒恢复与受伤重置待配；初始化和成功消费已保存。' }
  ],
  item_6672: [
    { kind: 'trigger-rule', key: 'third_attack_counter', reason: '攻击计数状态和第三次攻击消费时点未配置。' },
    { kind: 'result-detail', key: 'missing_health_amplification', reason: '目标已损失生命到1.75倍上限的连续插值曲线未由冻结源给出。' },
    { kind: 'parameter', key: 'base_damage_level_one/damage_breakpoint_level/damage_bonus_per_level', reason: '已由CHARACTER_LEVEL的1至18级展开参数替代，原始断点仍在历史候选与独立核算证据中保留。' }
  ]
};

const pendingComponents = {
  item_2502: ['英雄战斗状态开始/结束、4秒周期和650范围英雄目标筛选', '按本次实际已造成伤害的250%治疗联动'],
  item_2504: ['连续15秒未受魔法伤害的计时、受击重置、护盾授予及耗尽后再次获取'],
  item_3026: ['致命伤害前置拦截、4秒凝滞和一次性复活恢复', '300秒持有者冷却和下一轮触发'],
  item_3084: ['700距离跟踪、500毫秒六次计数及5秒跟踪状态的开始与重置', '下一次攻击消费和每目标30秒冷却', '伤害转永久最大生命值的基数与应用时点', '体型属性结果和30%上限的应用'],
  item_4632: ['成功格挡后的60秒护盾恢复和受伤重置'],
  item_6672: ['第三击计数范围、4秒计数状态刷新和消费', '目标已损失生命到1.75倍上限的连续曲线来源', '远程0.8倍分支及最终攻击特效结果联动']
};

function toParameter([parameterKey, name, valueType, fixedValue, description, valueMode = 'FIXED', levelValues = null], sortOrder) {
  return {
    parameterKey,
    name,
    valueType,
    valueMode,
    fixedValue: valueMode === 'FIXED' ? fixedValue : null,
    levelValues: valueMode === 'FIXED' ? null : levelValues,
    description,
    sortOrder
  };
}

const objectKeys = Object.keys(apiParameters);
const objects = objectKeys.map((equipmentKey) => {
  const source = historicalByKey.get(equipmentKey);
  const frozenSource = frozenByKey.get(equipmentKey);
  const skill = {
    skillKey: source.skill.skillKey,
    name: source.skill.name,
    description: '按客户端16.17与官方16.17.1资料保存已确证的独立组成；尚缺的触发、时序和数值联动见第九批待配清单。',
    maxLevel: source.skill.maxLevel,
    status: 'ENABLED',
    sortOrder: 0,
    skillCategoryKeys: ['passive']
  };
  const parameters = apiParameters[equipmentKey].map((entry, index) => toParameter(entry, (index + 1) * 10));
  const formulas = (apiFormulas[equipmentKey] ?? []).map((formula) => ({ ...formula, expression: JSON.parse(JSON.stringify(formula.expression)) }));
  const effects = JSON.parse(JSON.stringify(apiEffects[equipmentKey] ?? []));
  const candidate = source.candidate;
  return {
    equipmentKey,
    equipmentName: source.equipmentName,
    skillKey: source.skill.skillKey,
    sourceRefs: {
      client: { file: sourceFiles.client, pointer: sourcePointerByKey[equipmentKey] },
      stringTable: { file: sourceFiles.stringTable, pointer: `${sourcePointerByKey[equipmentKey]}/mItemDataClient/mTooltipData/mLocKeys` },
      official: { file: sourceFiles.official, pointer: `/data/${equipmentKey.slice('item_'.length)}` },
      historicalCandidate: { file: sourceFiles.historicalCandidate, pointer: `/objects/${historical.objects.indexOf(source)}/candidate` },
      frozenSource: { file: sourceFiles.frozenSource, pointer: `/objects/${frozen.objects.indexOf(frozenSource)}` }
    },
    apiPayload: {
      skill,
      parameters,
      formulas,
      effects,
      triggerRules: apiTriggerRules[equipmentKey] ?? []
    },
    omittedComponents: omitted[equipmentKey] ?? [],
    fullEquipmentComplete: false,
    pendingComponents: pendingComponents[equipmentKey],
    historicalPendingNote: '下列pendingFromHistoricalCandidate仅追溯原候选；已解决映射、角色等级展开和护盾成功消费，以本文件正式组成与pendingComponents为准。',
    pendingFromHistoricalCandidate: candidate.pending
  };
});

const relations = objects.map(({ equipmentKey, skillKey }) => ({ equipmentKey, skillKey, sortOrder: 10 }));
const representativeImages = objects.map(({ equipmentKey, skillKey }) => ({
  equipmentKey,
  skillKey,
  source: '装备现有代表图',
  writePath: `/skills/${skillKey}/representative-image`,
  payloadShape: { imageKey: '由装备代表图GET回读后填入' },
  base64Included: false,
  status: '待主负责人页面/接口验收'
}));

const mappingReview = {
  status: '同一冻结客户端当前绑定计算树与中文说明交叉确认',
  fields: ['mStat=12', 'mStatFormula=2'],
  evidence: [{
    file: '数据参考/全量录入-2026-09/装备技能实录/Luna第九批/属性映射补证.json',
    pointer: '/evidence',
    note: '3084当前绑定说明最大生命值对应mStat=12且省略mStatFormula；4633当前绑定说明额外生命值对应mStat=12、mStatFormula=2。补证保存原文、原始树和源文件哈希。'
  }],
  affectedEquipmentKeys: ['item_2502', 'item_2504']
};

const levels = Array.from({ length: 18 }, (_, index) => {
  const level = index + 1;
  const increments = level < 9 ? 0 : level - 8;
  const baseDamage = values[String(level)];
  return {
    level,
    sourceLevel1Value: 150,
    breakpointLevel: 9,
    bonusPerLevelAtAndAfter: 5,
    appliedBonusCount: increments,
    calculation: increments === 0 ? '150' : `150 + ${increments} × 5`,
    baseDamage,
    maximumDamageAt1_75: Number((baseDamage * 1.75).toFixed(2)),
    rangedDamageAt0_8: Number((baseDamage * 0.8).toFixed(2))
  };
});

const levelEvidence = {
  batch: 'Luna第九批',
  equipmentKey: 'item_6672',
  skillKey: 'item_6672_passive',
  status: '来源展开完成；不代表业务API已写入或运行时已验证',
  source: {
    file: sourceFiles.client,
    pointer: 'Items/6672/mItemCalculations/DamageAmount/mFormulaParts/0',
    type: 'ByCharLevelBreakpointsCalculationPart',
    mLevel1Value: 150,
    mBreakpoints: [{ mLevel: 9, mBonusPerLevelAtAndAfter: 5 }],
    semantics: '按已审同类型回读：1至断点前保持mLevel1Value；断点等级及之后每级从断点当级增加一次bonus。'
  },
  crossReviewedEvidence: {
    file: '数据参考/全量录入-2026-09/装备技能实录/Luna第四批/修正前证据/逐字段回读证据.json',
    pointer: 'objects[item_3072]/parameters[overshield_by_character_level]',
    observed: '同一断点类型的mLevel1Value=165、断点9、每级15，独立回读为1至8级165、9级180；因此本项9级应为155，不是150。'
  },
  levelRange: [1, 18],
  rows: levels,
  checks: [
    { name: '1至8级保持默认值', expected: 150, actual: values['8'], equal: values['8'] === 150 },
    { name: '断点9级当级增加一次', expected: 155, actual: values['9'], equal: values['9'] === 155 },
    { name: '18级总基础伤害', expected: 200, actual: values['18'], equal: values['18'] === 200 },
    { name: '18级1.75倍上限', expected: 350, actual: levels[17].maximumDamageAt1_75, equal: levels[17].maximumDamageAt1_75 === 350 },
    { name: '18级远程0.8倍', expected: 160, actual: levels[17].rangedDamageAt0_8, equal: levels[17].rangedDamageAt0_8 === 160 }
  ],
  sourceGaps: [],
  note: '原目录边界算例.json保留初始概念候选；本文件是按已审断点语义重新展开的独立核算证据，接口候选只引用本文件的1至18级结果。'
};

const output = {
  batch: 'Luna第九批',
  generatedAt: new Date().toISOString(),
  status: '正式接口请求体；实际录入与回读见写入执行记录.json及独立最终回读.json，不代表完整装备机制',
  contract: {
    skill: 'POST /skills：使用apiPayload.skill',
    parameters: 'POST /skills/{skillKey}/parameters：使用apiPayload.parameters[]',
    formulas: 'POST /skills/{skillKey}/formulas：使用apiPayload.formulas[]',
    effects: 'POST /skills/{skillKey}/effects：使用apiPayload.effects[]',
    triggerRules: 'POST /skills/{skillKey}/trigger-rules：使用apiPayload.triggerRules[]',
    relation: 'POST /equipment-skill-relations：使用relations[]',
    representativeImage: 'PUT /skills/{skillKey}/representative-image：图片关系单列，不保存图片内容'
  },
  sourceFiles,
  historicalCandidatePreserved: true,
  mappingReview,
  objects,
  relations,
  representativeImages,
  counts: {
    objects: objects.length,
    skills: objects.length,
    parameters: objects.reduce((sum, object) => sum + object.apiPayload.parameters.length, 0),
    formulas: objects.reduce((sum, object) => sum + object.apiPayload.formulas.length, 0),
    effects: objects.reduce((sum, object) => sum + object.apiPayload.effects.length, 0),
    triggerRules: objects.reduce((sum, object) => sum + object.apiPayload.triggerRules.length, 0),
    relations: relations.length,
    representativeImages: representativeImages.length,
    omittedComponents: objects.reduce((sum, object) => sum + object.omittedComponents.length, 0)
  }
};

write('接口候选.json', output);
write('海妖逐等级核算.json', levelEvidence);
console.log(JSON.stringify(output.counts, null, 2));
