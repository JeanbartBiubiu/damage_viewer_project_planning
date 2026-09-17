import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(directory, '..', '..', '..', '..');
const output = name => path.join(directory, name);
const source = relative => path.join(repositoryRoot, relative);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readGzipJson(file) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function writeJson(file, value) {
  fs.writeFileSync(output(file), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const clientFile = source('数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz');
const stringTableFile = source('数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz');
const officialFile = source('数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json');
const candidateFile = source('数据参考/全量录入-2026-09/装备效果候选/装备效果候选.json');

const client = readGzipJson(clientFile);
const stringTable = readGzipJson(stringTableFile);
const official = readJson(officialFile);
const candidates = readJson(candidateFile);
const coverage = readJson(source('数据参考/全量录入-2026-09/装备效果补证/来源与覆盖.json'));
const officialManifest = readJson(source('数据参考/全量录入-2026-09/装备符文/资料清单.json'));
const candidateByKey = new Map(candidates.items.map(item => [item.equipmentKey, item]));

const selected = [
  {
    equipmentKey: 'item_2502',
    equipmentName: '无终恨意',
    skillKey: 'item_2502_passive',
    skillName: '无终恨意·苦楚',
    stringKeys: [
      'item_2502_tooltip',
      'generatedtip_item_2502_description',
      'generatedtip_item_2502_tooltipinventorywithextendedbehaviorhint',
    ],
    directAttributes: { hp: 400, armor: 50, ability_haste: 15 },
    candidate: {
      parameters: [
        { parameterKey: 'drain_range', name: '苦楚作用半径', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 650, unit: '游戏距离单位', description: '当前绑定树DrainRange=650；附近目标判定范围，未把它当作伤害数值。' },
        { parameterKey: 'proc_interval_ms', name: '苦楚周期', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 4000, unit: '毫秒', description: '当前绑定树Cooldown=4秒；每次周期按4000毫秒记录。' },
        { parameterKey: 'bonus_health_damage_ratio', name: '苦楚额外生命值伤害比例', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.03, unit: '小数比例', description: '当前绑定树BonusHealthDrainPercentage=0.03，基数为绑定计算树所指的持有者额外生命值；mStat=12的属性枚举待接口语义确认。' },
        { parameterKey: 'heal_multiplier', name: '苦楚伤害治疗倍率', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 2.5, unit: '伤害倍数', description: '当前绑定树HealMultiplier=2.5；治疗基数是本次实际造成的苦楚伤害，官方说明为250%。' },
      ],
      formulas: [
        { formulaKey: 'drain_damage', name: '苦楚魔法伤害', status: '待属性枚举确认', sourceBinding: { mStat: 12, mStatFormula: 2, mDataValue: 'BonusHealthDrainPercentage' }, expression: null, description: '保留当前绑定树，不把未确认的mStat=12擅自映射为系统属性。' },
        { formulaKey: 'self_heal_from_drain_damage', name: '苦楚自我治疗', status: '待同次结果内联', sourceBinding: { mSpellCalculationKey: 'DrainCalc', mMultiplier: 'HealMultiplier' }, expression: null, description: '当前公式契约只允许基础运算树；先保留客户端同次计算引用，不用未确认的结果节点或跨公式子节点。' },
      ],
      effects: [
        { effectKey: 'drain_damage_and_heal', name: '苦楚周期魔法伤害与治疗', lifecycle: { durationValue: null, periodicIntervalValue: { kind: 'PARAMETER', parameterKey: 'proc_interval_ms' }, firstPeriodicExecution: 'AFTER_INTERVAL', maxStacksValue: { kind: 'FIXED', value: 1 }, applicationStacksValue: { kind: 'FIXED', value: 1 }, instanceScope: 'SOURCE', reapplicationStackMode: 'KEEP', reapplicationDurationMode: 'REFRESH_ALL', expiryMode: 'END_OF_COMBAT_STATE' }, results: [{ resultKey: 'drain_damage', name: '对附近英雄的魔法伤害', resultType: 'DAMAGE', target: 'TARGET', damageTypeKey: 'magic', valueRule: { kind: 'FORMULA', formulaKey: 'drain_damage' } }, { resultKey: 'self_heal', name: '按实际伤害治疗持有者', resultType: 'DIRECT_HEAL', target: 'SOURCE', valueRule: { kind: 'FORMULA', formulaKey: 'self_heal_from_drain_damage' } }] },
      ],
      triggerBoundary: '需要“与英雄战斗状态”开始、结束和650范围内英雄目标筛选；当前只整理周期组成，不写无条件触发。',
      pending: ['mStat=12与额外生命值属性键的接口映射', '战斗状态开始/结束事件、范围目标筛选及重置时点'],
      arithmetic: [{ sample: '本次实际伤害100点时的治疗', calculation: '100 × 2.5', expected: 250, unit: '生命值' }, { sample: '额外生命值1000点且mStat=12确认为额外生命时', calculation: '1000 × 0.03', expected: 30, unit: '魔法伤害；属性枚举仍待核对' }],
    },
  },
  {
    equipmentKey: 'item_2504',
    equipmentName: '败魔',
    skillKey: 'item_2504_passive',
    skillName: '败魔·法师之祸',
    stringKeys: ['item_2504_tooltip', 'generatedtip_item_2504_description', 'generatedtip_item_2504_tooltipinventorywithextendedbehaviorhint'],
    directAttributes: { hp: 400, magic_resistance: 80, base_hp_regen_percent: 1 },
    candidate: {
      parameters: [
        { parameterKey: 'shield_ratio', name: '法师之祸魔法护盾比例', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.15, unit: '小数比例', description: '当前绑定树ShieldAmount=0.15；绑定计算树使用mStat=12，基数待系统属性枚举确认。' },
        { parameterKey: 'no_magic_damage_duration_ms', name: '未受魔法伤害等待时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 15000, unit: '毫秒', description: '当前绑定树OutOfCombatDuration=15秒；这里的“脱离”指连续未受到魔法伤害，不泛化为脱离战斗。' },
      ],
      formulas: [{ formulaKey: 'magic_shield_amount', name: '法师之祸护盾值', status: '待属性枚举确认', sourceBinding: { mStat: 12, mDataValue: 'ShieldAmount' }, expression: null, description: '保留客户端绑定计算树；未确认mStat=12前不写成任意最大生命属性。' }],
      effects: [{ effectKey: 'magic_shield', name: '法师之祸魔法护盾', lifecycle: { durationValue: null, periodicIntervalValue: null, firstPeriodicExecution: null, maxStacksValue: { kind: 'FIXED', value: 1 }, applicationStacksValue: { kind: 'FIXED', value: 1 }, instanceScope: 'SOURCE', reapplicationStackMode: 'REPLACE', reapplicationDurationMode: 'KEEP', expiryMode: 'WHEN_ABSORBED' }, results: [{ resultKey: 'shield', name: '持有者魔法护盾', resultType: 'SHIELD', target: 'SOURCE', valueRule: { kind: 'FORMULA', formulaKey: 'magic_shield_amount' }, spellShieldBlockScope: null }] }],
      triggerBoundary: '需要对魔法伤害事件计时：每次受到魔法伤害都重置15000毫秒计时；计时完成才授予普通魔法护盾。该护盾不是“格挡下一个技能”的法术护盾。',
      pending: ['mStat=12基数映射', 'DAMAGE_TAKEN魔法类型筛选、计时初始化、护盾被吸收后的再次获取'],
      arithmetic: [{ sample: '最大生命值2000且mStat=12确认指向最大生命时', calculation: '2000 × 0.15', expected: 300, unit: '护盾值' }, { sample: '受到魔法伤害后的边界', calculation: 't=0受到魔法伤害，t=14999不授予，t=15000才进入授予检查', expected: '按计时事件顺序确认', unit: '毫秒' }],
    },
  },
  {
    equipmentKey: 'item_3026',
    equipmentName: '守护天使',
    skillKey: 'item_3026_passive',
    skillName: '守护天使·重生',
    stringKeys: ['item_3026_tooltip', 'generatedtip_item_3026_description', 'generatedtip_item_3026_tooltipinventorywithextendedbehaviorhint'],
    directAttributes: { attack_damage: 55, armor: 45 },
    candidate: {
      parameters: [
        { parameterKey: 'stasis_duration_ms', name: '重生凝滞时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 4000, unit: '毫秒', description: '当前装备对象mEffectAmount[1]=4秒；致命伤害后先凝滞。' },
        { parameterKey: 'revive_base_hp_ratio', name: '重生基础生命值比例', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.5, unit: '小数比例', description: '当前装备对象mEffectAmount[0]=0.5；恢复持有者基础生命值的50%。' },
        { parameterKey: 'revive_max_mana_ratio', name: '重生最大法力比例', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 1, unit: '小数比例', description: '当前装备对象mEffectAmount[3]=1；恢复最大法力值的100%，无最大法力时不臆造替代资源。' },
        { parameterKey: 'revive_cooldown_ms', name: '重生冷却时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 300000, unit: '毫秒', description: '当前装备对象mEffectAmount[2]=300秒；与未绑定旧辅助对象的60秒冷却分开。' },
      ],
      formulas: [{ formulaKey: 'revive_base_health', name: '重生基础生命值恢复', expression: { nodeType: 'OPERATION', operation: 'MULTIPLY', operands: [{ nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'base_hp', attributeValueKind: 'TOTAL' }, { nodeType: 'PARAMETER', parameterKey: 'revive_base_hp_ratio' }] } }, { formulaKey: 'revive_max_mana', name: '重生最大法力恢复', expression: { nodeType: 'OPERATION', operation: 'MULTIPLY', operands: [{ nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'max_mana', attributeValueKind: 'TOTAL' }, { nodeType: 'PARAMETER', parameterKey: 'revive_max_mana_ratio' }] } }],
      effects: [{ effectKey: 'lethal_stasis', name: '致命伤害后的凝滞', lifecycle: { durationValue: { kind: 'PARAMETER', parameterKey: 'stasis_duration_ms' }, periodicIntervalValue: null, firstPeriodicExecution: null, maxStacksValue: { kind: 'FIXED', value: 1 }, applicationStacksValue: { kind: 'FIXED', value: 1 }, instanceScope: 'SOURCE', reapplicationStackMode: 'KEEP', reapplicationDurationMode: 'KEEP', expiryMode: 'ALL_AT_ONCE' }, results: [{ resultKey: 'stasis', name: '凝滞', resultType: 'STASIS', target: 'SOURCE', valueRule: { kind: 'FIXED', value: 1 }, status: '待接口结果类型确认' }] }, { effectKey: 'revive_restore', name: '凝滞结束后的生命与法力恢复', lifecycle: { durationValue: null, periodicIntervalValue: null, firstPeriodicExecution: null, maxStacksValue: { kind: 'FIXED', value: 1 }, applicationStacksValue: { kind: 'FIXED', value: 1 }, instanceScope: 'SOURCE', reapplicationStackMode: 'KEEP', reapplicationDurationMode: 'KEEP', expiryMode: 'ONCE_AFTER_DELAY' }, results: [{ resultKey: 'base_health_restore', name: '基础生命值恢复', resultType: 'DIRECT_HEAL', target: 'SOURCE', valueRule: { kind: 'FORMULA', formulaKey: 'revive_base_health' } }, { resultKey: 'max_mana_restore', name: '最大法力值恢复', resultType: 'RESOURCE_RESTORE', target: 'SOURCE', valueRule: { kind: 'FORMULA', formulaKey: 'revive_max_mana' } }] }],
      triggerBoundary: '需要识别“将受到致命伤害”并在凝滞结束后一次性复活；不能把普通DAMAGE_TAKEN或扣血后事件冒充该时序。',
      pending: ['致命伤害前置事件与不可选取/凝滞结果类型', '300秒持有者冷却门控与复活后再次触发', '基础生命/最大法力属性键由接口契约核对'],
      excludedBinding: [{ objectPath: 'Items/Spells/GuardianAngel', reason: '该未绑定辅助对象的cooldownTime=60与当前装备对象mEffectAmount[2]=300冲突；本候选不使用它的旧说明或冷却。' }],
      arithmetic: [{ sample: '基础生命值1200的重生生命恢复', calculation: '1200 × 0.5', expected: 600, unit: '生命值' }, { sample: '最大法力值1000的重生法力恢复', calculation: '1000 × 1', expected: 1000, unit: '法力值' }, { sample: '重生冷却边界', calculation: 't=0触发后，t=3999仍凝滞，t=4000恢复；t<300000再次致命不应再次触发', expected: '按事件时序确认', unit: '毫秒' }],
    },
  },
  {
    equipmentKey: 'item_3084',
    equipmentName: '心之钢',
    skillKey: 'item_3084_passive',
    skillName: '心之钢·庞然吞食',
    stringKeys: ['item_3084_tooltip', 'item_3084_tooltipdynamic', 'item_3084_tooltipextended', 'generatedtip_item_3084_description'],
    directAttributes: { hp: 900, base_hp_regen_percent: 1 },
    candidate: {
      parameters: [
        { parameterKey: 'per_target_cooldown_ms', name: '庞然吞食每目标冷却', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 30000, unit: '毫秒', description: '当前绑定树PerTargetCooldown=30秒；按目标分别计时，不写成持有者统一冷却。' },
        { parameterKey: 'base_damage', name: '庞然吞食基础伤害', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 70, unit: '物理伤害点', description: '当前绑定树BaseDamage=70。' },
        { parameterKey: 'max_health_damage_ratio', name: '庞然吞食最大生命伤害比例', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.06, unit: '小数比例', description: '当前绑定树HPRatio=0.06；基数为持有者最大生命值。' },
        { parameterKey: 'damage_to_max_health_ratio', name: '伤害转最大生命值比例', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.1, unit: '小数比例', description: '当前绑定树DamageToMaxHealthRatio=0.10；基数为本次庞然吞食额外伤害。' },
        { parameterKey: 'tracking_distance', name: '庞然吞食跟踪距离', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 700, unit: '游戏距离单位', description: '当前绑定树DistanceToChampion=700。' },
        { parameterKey: 'tracking_tick_count', name: '庞然吞食跟踪次数', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 6, unit: '次', description: '当前绑定树NumTicksToTrigger=6；与500毫秒间隔合计3秒。' },
        { parameterKey: 'tracking_tick_interval_ms', name: '庞然吞食跟踪间隔', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 500, unit: '毫秒', description: '当前绑定树TrackerTickRate=0.5秒，换算为500毫秒。' },
        { parameterKey: 'tracking_buff_duration_ms', name: '庞然吞食跟踪状态持续时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 5000, unit: '毫秒', description: '当前绑定树RangeTrackingBuffDuration=5秒；与六次充能所需3000毫秒分开记录，实际刷新时点待核。' },
        { parameterKey: 'health_size_threshold', name: '体型提升生命值门槛', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 1000, unit: '最大生命值点', description: '当前绑定树HealthSizeThreshold=1000。' },
        { parameterKey: 'size_ratio_per_threshold', name: '体型提升比例', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.03, unit: '小数比例', description: '当前绑定树SizeAmount=0.03；体型上限由SizeCap=0.30单独约束。' },
        { parameterKey: 'size_ratio_cap', name: '体型提升上限', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.3, unit: '小数比例', description: '当前绑定树SizeCap=0.30。' },
      ],
      formulas: [{ formulaKey: 'empowered_attack_damage', name: '庞然吞食额外物理伤害', expression: { nodeType: 'OPERATION', operation: 'ADD', operands: [{ nodeType: 'PARAMETER', parameterKey: 'base_damage' }, { nodeType: 'OPERATION', operation: 'MULTIPLY', operands: [{ nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'hp', attributeValueKind: 'TOTAL' }, { nodeType: 'PARAMETER', parameterKey: 'max_health_damage_ratio' }] }] } }, { formulaKey: 'max_health_gain', name: '庞然吞食最大生命值获得', status: '待将伤害公式内联', sourceBinding: { mModifiedGameCalculation: 'DamageProcCalc', mMultiplier: 'DamageToMaxHealthRatio' }, expression: null, description: '不把另一个公式作为子节点；待mStat=12属性语义确认后内联ADD/MULTIPLY运算树。' }, { formulaKey: 'tracking_duration_ms', name: '六次跟踪总时间', expression: { nodeType: 'OPERATION', operation: 'MULTIPLY', operands: [{ nodeType: 'PARAMETER', parameterKey: 'tracking_tick_count' }, { nodeType: 'PARAMETER', parameterKey: 'tracking_tick_interval_ms' }] } }],
      effects: [{ effectKey: 'empowered_attack', name: '充能攻击额外物理伤害', lifecycle: { durationValue: null, periodicIntervalValue: null, firstPeriodicExecution: null, maxStacksValue: { kind: 'FIXED', value: 1 }, applicationStacksValue: { kind: 'FIXED', value: 1 }, instanceScope: 'TARGET', reapplicationStackMode: 'REPLACE', reapplicationDurationMode: 'KEEP', expiryMode: 'ON_NEXT_ATTACK' }, results: [{ resultKey: 'physical_damage', name: '充能攻击额外物理伤害', resultType: 'DAMAGE', target: 'TARGET', valueRule: { kind: 'FORMULA', formulaKey: 'empowered_attack_damage' }, detail: { damageTypeKey: 'physics', deliveryKind: 'BASIC_ATTACK', originKind: 'DIRECT' } }, { resultKey: 'max_health_gain', name: '伤害转最大生命值', resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE', valueRule: { kind: 'FORMULA', formulaKey: 'max_health_gain' }, detail: { attributeKey: 'hp', operation: 'INCREASE', modifierZoneKey: 'attribute_flat_add' } }] }, { effectKey: 'size_increase', name: '歌利亚巨人体型提升', lifecycle: { durationValue: null, periodicIntervalValue: null, firstPeriodicExecution: null, maxStacksValue: { kind: 'PARAMETER', parameterKey: 'size_ratio_cap' }, applicationStacksValue: { kind: 'FIXED', value: 1 }, instanceScope: 'SOURCE', reapplicationStackMode: 'KEEP', reapplicationDurationMode: 'KEEP', expiryMode: 'PERSISTENT' }, results: [], status: '数值已确证，体型属性结果键待接口契约确认' }],
      triggerBoundary: '需要700距离内英雄持续跟踪6次、下一次对该目标的攻击消费充能、每目标30秒冷却；不能把“攻击造成伤害”无条件扩展到所有目标。',
      pending: ['距离跟踪事件、5000毫秒跟踪状态与六次周期的开始/重置关系', '每目标充能消费和30秒冷却结构', '体型属性结果键'],
      arithmetic: [{ sample: '持有者最大生命值2000时的额外伤害', calculation: '70 + 2000 × 0.06', expected: 190, unit: '物理伤害' }, { sample: '同次伤害转最大生命值', calculation: '190 × 0.10', expected: 19, unit: '最大生命值' }, { sample: '六次跟踪时间', calculation: '6 × 500', expected: 3000, unit: '毫秒；第6次完成后才可检查充能攻击' }, { sample: '达到体型上限后再加一次', calculation: 'min(0.30, 已有体型比例 + 0.03)', expected: '不超过0.30', unit: '比例；上限后的第11次门槛不再增加' }],
    },
  },
  {
    equipmentKey: 'item_4632',
    equipmentName: '翠绿屏障',
    skillKey: 'item_4632_passive',
    skillName: '翠绿屏障·废除',
    stringKeys: ['item_4632_tooltip', 'generatedtip_item_4632_description', 'generatedtip_item_4632_tooltipinventorywithextendedbehaviorhint'],
    directAttributes: { ability_power: 40, magic_resistance: 25 },
    candidate: {
      parameters: [{ parameterKey: 'spell_shield_cooldown_ms', name: '法术护盾冷却', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 60000, unit: '毫秒', description: '当前绑定树SpellShieldCooldown=60秒；同时存在Cooldown=60，统一按60000毫秒记录，不表示格挡前预先消耗。' }],
      formulas: [],
      effects: [{ effectKey: 'spell_shield', name: '废除法术护盾', lifecycle: { durationValue: null, periodicIntervalValue: null, firstPeriodicExecution: null, maxStacksValue: { kind: 'FIXED', value: 1 }, applicationStacksValue: { kind: 'FIXED', value: 1 }, instanceScope: 'SOURCE', reapplicationStackMode: 'REPLACE', reapplicationDurationMode: 'KEEP', expiryMode: 'ON_SUCCESSFUL_BLOCK' }, results: [{ resultKey: 'spell_shield_block', name: '格挡下一个敌方技能', resultType: 'SPELL_SHIELD', target: 'SOURCE', valueRule: { kind: 'FIXED', value: 1 }, spellShieldBlockScope: 'NEXT_ENEMY_SPELL', detail: { successfulBlockConsumes: true, cooldownParameterKey: 'spell_shield_cooldown_ms' } }] }],
      triggerBoundary: '来源明确是提供一层法术护盾；必须在敌方技能成功被护盾格挡后消费这一层并开始60000毫秒冷却。未成功命中、普通攻击或护盾尚未存在时不得提前消费。SOURCE_INITIALIZED可作为授予初始护盾的候选入口，结果仍指向SOURCE。',
      pending: ['SPELL_SHIELD结果类型及成功格挡回调是否可存', '冷却起点和冷却结束后的重新授予事件', '敌方技能判定不扩展为普通攻击或任意伤害'],
      arithmetic: [{ sample: '初始化持有者', calculation: 'SOURCE_INITIALIZED → 1层法术护盾', expected: '护盾存在', unit: '不带数值' }, { sample: '成功格挡后的消费', calculation: '成功格挡1次 → 0层，冷却60000毫秒', expected: '明确消费', unit: '毫秒' }, { sample: '冷却内再次受到敌方技能', calculation: 't=59999不能重新授予，t=60000后才允许下一层', expected: '按冷却事件确认', unit: '毫秒' }],
    },
  },
  {
    equipmentKey: 'item_6672',
    equipmentName: '海妖杀手',
    skillKey: 'item_6672_passive',
    skillName: '海妖杀手·放倒它',
    stringKeys: ['item_6672_tooltip', 'generatedtip_item_6672_description', 'generatedtip_item_6672_tooltipinventorywithextendedbehaviorhint', 'buff_6672buff_tooltip'],
    directAttributes: { attack_damage: 45, bonus_attack_speed_percent: 0.4, move_speed_percent: 0.04 },
    candidate: {
      parameters: [
        { parameterKey: 'attack_count', name: '放倒它攻击次数', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 3, unit: '次', description: '当前绑定树AttackCount=3；每第三次攻击进入额外伤害判定。' },
        { parameterKey: 'buff_duration_ms', name: '放倒它计数状态持续时间', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 4000, unit: '毫秒', description: '当前绑定树BuffDuration=4秒；计数状态是否按持有者或目标分组待核。' },
        { parameterKey: 'maximum_damage_multiplier', name: '放倒它伤害上限倍率', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 1.75, unit: '伤害倍数', description: '当前绑定树MaxAmpNumber=1.75；基数为当前等级基础伤害。' },
        { parameterKey: 'ranged_damage_multiplier', name: '远程伤害倍率', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.8, unit: '伤害倍数', description: '当前绑定树RangedDamageMultiplier=0.8；来源攻击类型分支，不按双方距离猜测。' },
        { parameterKey: 'base_damage_level_one', name: '放倒它等级一基础伤害', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 150, unit: '物理伤害点', description: '当前绑定树DamageAmount的mLevel1Value=150。' },
        { parameterKey: 'damage_breakpoint_level', name: '放倒它伤害成长起点', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 9, unit: '角色等级', description: '当前绑定树DamageAmount在9级起按每级5点成长；不是技能等级。' },
        { parameterKey: 'damage_bonus_per_level', name: '放倒它等级成长', valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 5, unit: '每级物理伤害点', description: '当前绑定树DamageAmount的mBonusPerLevelAtAndAfter=5。' },
      ],
      formulas: [{ formulaKey: 'maximum_damage', name: '放倒它伤害上限', status: '待等级伤害内联', sourceBinding: { mModifiedGameCalculation: 'DamageAmount', mMultiplier: 'MaxAmpNumber' }, expression: null }, { formulaKey: 'ranged_damage', name: '远程放倒它伤害', status: '待等级伤害内联', sourceBinding: { mModifiedGameCalculation: 'DamageAmount', mMultiplier: 'RangedDamageMultiplier' }, expression: null }, { formulaKey: 'damage_amount_by_character_level', name: '按角色等级的基础伤害', status: '当前公式集合不能直接表达等级断点', sourceBinding: { level1: 150, breakpointLevel: 9, bonusPerLevelAtAndAfter: 5 }, expression: null }],
      effects: [{ effectKey: 'third_attack_damage', name: '第三次攻击额外物理伤害', lifecycle: { durationValue: { kind: 'PARAMETER', parameterKey: 'buff_duration_ms' }, periodicIntervalValue: null, firstPeriodicExecution: null, maxStacksValue: { kind: 'FIXED', value: 1 }, applicationStacksValue: { kind: 'FIXED', value: 1 }, instanceScope: 'SOURCE', reapplicationStackMode: 'REPLACE', reapplicationDurationMode: 'REFRESH_ALL', expiryMode: 'ON_THIRD_ATTACK' }, results: [{ resultKey: 'physical_damage', name: '基于目标已损失生命的额外物理伤害', resultType: 'DAMAGE', target: 'TARGET', valueRule: { kind: 'FORMULA', formulaKey: 'damage_amount_by_character_level' }, detail: { damageTypeKey: 'physics', deliveryKind: 'BASIC_ATTACK', originKind: 'ON_HIT', damageCapFormulaKey: 'maximum_damage', rangedMultiplierFormulaKey: 'ranged_damage' } }] }],
      triggerBoundary: '需要按攻击计数识别第三次攻击，并把额外伤害的提升基数限定为目标已损失生命值；当前不把普通攻击事件本身当成已完成的第三次计数规则。',
      pending: ['角色等级断点公式转系统参数的方式', '攻击计数状态的持有者/目标范围、4秒刷新和第三次消费', '目标已损失生命到1.75倍上限的插值曲线', '攻击特效链是否由当前普通攻击事件安全承载'],
      arithmetic: [{ sample: '角色等级1的近战基础伤害', calculation: '150', expected: 150, unit: '物理伤害；来源mLevel1Value' }, { sample: '角色等级18的基础伤害（断点原文）', calculation: '150 + (18 - 9) × 5', expected: 195, unit: '物理伤害；按客户端断点的候选算例' }, { sample: '等级18伤害上限', calculation: '195 × 1.75', expected: 341.25, unit: '物理伤害；目标已损失生命插值尚待确认' }, { sample: '已达到上限后再触发一次', calculation: 'min(当前提升结果, 基础伤害 × 1.75)', expected: '仍为上限，不超过1.75倍', unit: '第4次及以后不继续超过上限；计数重置时点待核' }],
    },
  },
];

function selectedRaw(item) {
  const id = item.equipmentKey.replace('item_', '');
  const key = `Items/${id}`;
  const raw = client[key];
  if (!raw) throw new Error(`冻结客户端缺少 ${key}`);
  const relevantNames = [
    'mDisplayName', 'itemID', 'spellName', 'mEffectAmount', 'mDataValues', 'DataValuesModeOverride',
    'mItemCalculations', 'mItemAttributes', 'mItemGroups', 'mFlatHPPoolMod', 'mFlatPhysicalDamageMod',
    'mFlatMagicDamageMod', 'mFlatArmorMod', 'mFlatSpellBlockMod', 'mPercentMovementSpeedMod',
    'mPercentAttackSpeedMod', 'mPercentBaseHPRegenMod', 'mAbilityHasteMod', 'PhysicalLethality',
    'mItemDataAvailability', 'mItemDataClient', 'effectRadius',
  ];
  const relevant = {};
  for (const name of relevantNames) {
    if (Object.prototype.hasOwnProperty.call(raw, name)) relevant[name] = clone(raw[name]);
  }
  const boundSpellObjects = {};
  for (const [objectPath, value] of Object.entries(client)) {
    if (objectPath.startsWith(`${key}/Spells/`)) boundSpellObjects[objectPath] = clone(value);
  }
  const strings = {};
  for (const stringKey of item.stringKeys) {
    const value = stringTable.entries[stringKey];
    if (value == null) throw new Error(`冻结字符串表缺少 ${stringKey}`);
    strings[stringKey] = value;
  }
  const officialItem = official.data[id];
  if (!officialItem) throw new Error(`官方装备资料缺少 ${id}`);
  const candidate = candidateByKey.get(item.equipmentKey);
  return {
    equipmentKey: item.equipmentKey,
    equipmentName: item.equipmentName,
    clientObjectPath: key,
    clientObject: relevant,
    boundSpellObjects,
    currentBoundStringTable: strings,
    official: {
      sourceVersion: '16.17.1',
      sourceUrl: 'https://ddragon.leagueoflegends.com/cdn/16.17.1/data/zh_CN/item.json',
      sourcePointer: `/data/${id}`,
      name: officialItem.name,
      description: officialItem.description,
      stats: clone(officialItem.stats),
    },
    frozenCandidateEvidence: candidate ? {
      sourcePointer: candidate.sourcePointer,
      sourceDescription: candidate.sourceDescription,
      missingRequiredEvidence: clone(candidate.missingRequiredEvidence),
      boundaryReview: candidate.boundaryReview,
    } : null,
  };
}

const generatedAt = new Date().toISOString();
const frozenSources = {
  batch: 'Luna第九批',
  generatedAt,
  status: '仅来源冻结和候选整理，尚未调用业务写接口',
  selectedEquipmentKeys: selected.map(item => item.equipmentKey),
  sourcePolicy: {
    clientVersion: '16.17',
    officialVersion: '16.17.1',
    clientBindingFile: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz',
    clientStringTableFile: '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz',
    officialFile: '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json',
    rule: '当前装备对象及其绑定的扩展说明优先；同压缩文件中未被当前装备对象引用、且数值冲突的旧辅助对象不作为当前机制来源。',
    sourceDigests: coverage['原始资料'].filter(entry => [
      '客户端原始资料/items-16.17.cdtb.bin.json.gz',
      '客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz',
    ].includes(entry.文件)).map(entry => ({ file: entry.文件, version: entry['目录或公告版本'], rawSHA256: entry['原始SHA256'], compressedSHA256: entry['压缩SHA256'] })),
    officialDigest: officialManifest.sources.find(entry => entry.file === '官方原始资料/item-16.17.1-zh_CN.json'),
  },
  relationPreflight: {
    method: 'GET',
    endpointPattern: '/api/admin/games/lol/equipment-skill-relations?equipmentKey={key}',
    skillEndpointPattern: '/api/admin/games/lol/skills/{skillKey}',
    authorization: '仅使用公开占位 local-entry；未保存凭据',
    checkedAt: '2026-09-08',
    responses: selected.map(item => ({ equipmentKey: item.equipmentKey, status: 200, body: { items: [], total: 0 }, conclusion: '未发现装备技能挂载关系；装备主体与图片资料不计作技能占用。' })),
    skillResponses: selected.map(item => ({ skillKey: item.skillKey, status: 404, body: { error: { code: '404.SKILL_NOT_FOUND', details: { skillKey: item.skillKey }, message: '技能不存在' } }, conclusion: '技能键尚未占用，可作为候选新建键。' })),
  },
  objects: selected.map(selectedRaw),
};

const candidatesOutput = {
  batch: 'Luna第九批',
  generatedAt,
  status: '待主负责人审查；本文件不是业务接口写入记录',
  writeBoundary: '只允许本目录文件；不写业务API、不写共享字典、不写其他批次。',
  objects: selected.map(item => ({
    equipmentKey: item.equipmentKey,
    equipmentName: item.equipmentName,
    skill: {
      skillKey: item.skillKey,
      name: item.skillName,
      maxLevel: 1,
      status: '候选',
      description: '只保存当前冻结来源明确的独立组成；触发、时序或属性枚举未确认处单列待审，不把候选当成运行时完成。',
      sourceStringKeys: item.stringKeys,
    },
    directAttributes: item.directAttributes,
    candidate: item.candidate,
    relation: { equipmentKey: item.equipmentKey, skillKey: item.skillKey, sortOrder: 10 },
    representativeImage: { planned: true, relation: '复用装备现有代表图；本阶段不写图片接口。' },
  })),
};

const boundaryExamples = {
  batch: 'Luna第九批',
  generatedAt,
  scope: '边界算例用于主负责人审查候选含义，不代表API、浏览器或运行时验证。',
  objects: selected.map(item => ({ equipmentKey: item.equipmentKey, equipmentName: item.equipmentName, examples: item.candidate.arithmetic, requiredChecks: item.candidate.pending })),
};

writeJson('冻结来源.json', frozenSources);
writeJson('录入候选.json', candidatesOutput);
writeJson('边界算例.json', boundaryExamples);

const counts = candidatesOutput.objects.reduce((summary, object) => {
  summary.skills += 1;
  summary.parameters += object.candidate.parameters.length;
  summary.formulas += object.candidate.formulas.length;
  summary.effects += object.candidate.effects.length;
  return summary;
}, { skills: 0, parameters: 0, formulas: 0, effects: 0 });
console.log(JSON.stringify({ generatedAt, objects: candidatesOutput.objects.length, counts }, null, 2));
