import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const dir = path.dirname(fileURLToPath(import.meta.url));
const candidate = JSON.parse(await readFile(path.join(dir, '录入候选.json'), 'utf8'));
const preflight = JSON.parse(await readFile(path.join(dir, '纠错本次预检.json'), 'utf8'));
const source = JSON.parse(await readFile(path.join(dir, '冻结来源补证.json'), 'utf8'));
const ultimateScope = JSON.parse(await readFile(path.join(dir, '终极技能范围证据.json'), 'utf8'));
const apiBase = '/api/admin/games/lol';
const operations = [];
let order = 0;
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const withoutMeta = (value, stableKey) => {
  const out = clone(value);
  if (out && typeof out === 'object') {
    for (const key of ['gameId', 'skillKey', 'createdAt', 'updatedAt']) delete out[key];
    if (stableKey) delete out[stableKey];
  }
  return out;
};
const subjectData = skillKey => {
  const row = preflight.skills[skillKey]?.subject;
  assert.equal(row?.status, 200, `${skillKey} subject preflight`);
  return row.data;
};
const componentData = (skillKey, kind, key, idField) => {
  const rows = preflight.skills[skillKey]?.[kind]?.details ?? [];
  const row = rows.find(item => item.id === key);
  assert.equal(row?.response?.status, 200, `${skillKey}/${kind}/${key} preflight`);
  return row.response.data;
};
const parameterData = (skillKey, key) => componentData(skillKey, 'parameters', key, 'parameterKey');
const formulaData = (skillKey, key) => componentData(skillKey, 'formulas', key, 'formulaKey');
const effectData = (skillKey, key) => componentData(skillKey, 'effects', key, 'effectKey');
const currentZone = key => preflight.modifierZones.targetDetails[key];
const addUpdate = ({ skillKey, kind, key, pathPart, before, request, after, note }) => {
  operations.push({
    order: ++order,
    action: 'UPDATE',
    method: 'PUT',
    endpoint: `${apiBase}${pathPart}`,
    target: { skillKey, kind, key },
    note,
    precondition: { status: 200, body: before },
    request,
    expectedAfter: { status: 200, body: after }
  });
};
const addCreate = ({ skillKey = null, kind, key, pathPart, request, note }) => {
  operations.push({
    order: ++order,
    action: 'CREATE',
    method: 'POST',
    endpoint: `${apiBase}${pathPart}`,
    target: { skillKey, kind, key },
    note,
    precondition: { status: 404 },
    request,
    expectedAfter: { status: 200, body: request }
  });
};
const addDelete = ({ skillKey, kind, key, pathPart, before, note }) => {
  operations.push({
    order: ++order,
    action: 'DELETE',
    method: 'DELETE',
    endpoint: `${apiBase}${pathPart}`,
    target: { skillKey, kind, key },
    note,
    precondition: { status: 200, body: before },
    request: null,
    expectedAfter: { status: 404 }
  });
};
const skillRequestBody = (skillKey, description) => {
  const current = subjectData(skillKey);
  return {
    name: current.name,
    description,
    maxLevel: current.maxLevel,
    status: current.status,
    sortOrder: current.sortOrder,
    skillCategoryKeys: clone(current.skillCategoryKeys)
  };
};
const parameterRequestBody = (data, changes = {}) => ({
  name: changes.name ?? data.name,
  valueType: changes.valueType ?? data.valueType,
  valueMode: changes.valueMode ?? data.valueMode,
  fixedValue: Object.hasOwn(changes, 'fixedValue') ? changes.fixedValue : data.fixedValue,
  levelValues: Object.hasOwn(changes, 'levelValues') ? changes.levelValues : data.levelValues,
  description: changes.description ?? data.description,
  sortOrder: changes.sortOrder ?? data.sortOrder
});
const newParameter = ({ parameterKey, name, valueType, fixedValue, description, sortOrder }) => ({
  parameterKey, name, valueType, valueMode: 'FIXED', fixedValue, levelValues: null, description, sortOrder
});
const formulaRequestBody = (data, changes = {}) => ({
  name: changes.name ?? data.name,
  description: changes.description ?? data.description,
  sortOrder: changes.sortOrder ?? data.sortOrder,
  expression: changes.expression ?? clone(data.expression)
});
const effectRequestBody = (data, changes = {}) => ({
  name: changes.name ?? data.name,
  description: changes.description ?? data.description,
  sortOrder: changes.sortOrder ?? data.sortOrder,
  lifecycle: Object.hasOwn(changes, 'lifecycle') ? changes.lifecycle : clone(data.lifecycle),
  results: changes.results ?? clone(data.results)
});
const skill = key => candidate.objects.find(o => o.skill.skillKey === key);

assert.equal(preflight.modifierZones.list.status, 200);
assert.equal(currentZone('item_3071_armor_reduction')?.status, 404);
assert.equal(currentZone('item_8010_magic_resistance_reduction')?.status, 404);
assert.equal(ultimateScope.accepted.length, 170);
assert.equal(ultimateScope.skillKeys.length, 170);
assert.equal(new Set(ultimateScope.skillKeys).size, 170);
assert.ok(ultimateScope.pending.some(item => item.championId === 'Udyr'));
assert.ok(ultimateScope.skillKeys.includes('ez_r'));
assert.ok(!ultimateScope.skillKeys.includes('udyr_r'));

const subject3032Before = withoutMeta(subjectData('item_3032_passive'), 'skillKey');
const subject3032After = skillRequestBody('item_3032_passive', '保存16.17客户端与官方16.17.1共同确证的30%攻击速度、6秒持续、30秒冷却、普通攻击缩短1秒和暴击缩短2秒；常规模式熟能生巧每次近战攻击增加0.004、远程攻击增加0.002暴击几率，达到0.25上限封顶。普通攻击命中规则和持有者冷却接线仍待补齐，装备直接属性不在技能结果中重复施加。');
addUpdate({ skillKey: 'item_3032_passive', kind: 'skill', key: 'item_3032_passive', pathPart: '/skills/item_3032_passive', before: subject3032Before, request: subject3032After, after: subject3032After, note: '把已核定的常规近战与远程暴击增量写入技能说明，避免候选入口继续保留未核定口径。' });
const cap3032 = parameterData('item_3032_passive', 'crit_cap_ratio');
const cap3032After = parameterRequestBody(cap3032, { description: '永久获得暴击几率上限，小数0.25表示25%；常规模式近战每次攻击增加0.004、远程每次攻击增加0.002，达到该上限后不再增加。ARAM与SWIFTPLAY覆盖值不混入。' });
addUpdate({ skillKey: 'item_3032_passive', kind: 'parameter', key: 'crit_cap_ratio', pathPart: '/skills/item_3032_passive/parameters/crit_cap_ratio', before: withoutMeta(cap3032, 'parameterKey'), request: cap3032After, after: cap3032After, note: '修正原参数中“增量待来源核定”的过时说明。' });
addCreate({ skillKey: 'item_3032_passive', kind: 'parameter', key: 'crit_bonus_per_attack_melee', pathPart: '/skills/item_3032_passive/parameters', request: newParameter({ parameterKey: 'crit_bonus_per_attack_melee', name: '熟能生巧近战每次攻击暴击增量', valueType: 'DECIMAL', fixedValue: 0.004, description: '常规模式每次近战攻击永久增加0.004暴击几率，小数0.004表示0.4个百分点；由熟能生巧0.25上限封顶。ARAM与SWIFTPLAY覆盖值不混入。', sortOrder: 70 }), note: '保存冻结纠错方案核定的常规近战每次攻击增量。' });
addCreate({ skillKey: 'item_3032_passive', kind: 'parameter', key: 'crit_bonus_per_attack_ranged', pathPart: '/skills/item_3032_passive/parameters', request: newParameter({ parameterKey: 'crit_bonus_per_attack_ranged', name: '熟能生巧远程每次攻击暴击增量', valueType: 'DECIMAL', fixedValue: 0.002, description: '常规模式每次远程攻击永久增加0.002暴击几率，小数0.002表示0.2个百分点；由熟能生巧0.25上限封顶。ARAM与SWIFTPLAY覆盖值不混入。', sortOrder: 80 }), note: '保存冻结纠错方案核定的常规远程每次攻击增量。' });

const subject3050Before = withoutMeta(subjectData('item_3050_passive'), 'skillKey');
const subject3050After = skillRequestBody('item_3050_passive', '保存终极技能急速15点、施放终极技能后5000毫秒就绪窗口，以及风暴持续5000毫秒、半径350、每秒30点魔法伤害、30%减速和45000毫秒冷却等冻结确证组成。终极技能急速使用当前根R带Trait_Ultimate且已有唯一角色挂载的170个技能键初始化；风暴就绪、接近英雄启动、跳频、减速状态和持有者冷却仍待准确接线，不用无条件规则冒充完整机制。');
const stormEffectBefore = effectData('item_3050_passive', 'storm_magic_damage');
addDelete({ skillKey: 'item_3050_passive', kind: 'effect', key: 'storm_magic_damage', pathPart: '/skills/item_3050_passive/effects/storm_magic_damage', before: withoutMeta(stormEffectBefore, 'effectKey'), note: '撤回未完成范围筛选和触发接线的周期伤害效果；每秒30参数保留。' });
const stormIntervalBefore = parameterData('item_3050_passive', 'storm_tick_interval_ms');
addDelete({ skillKey: 'item_3050_passive', kind: 'parameter', key: 'storm_tick_interval_ms', pathPart: '/skills/item_3050_passive/parameters/storm_tick_interval_ms', before: withoutMeta(stormIntervalBefore, 'parameterKey'), note: '撤回仅由“每秒”推定的1000毫秒跳频参数，避免把显示文本当作周期时序确证。' });
addCreate({ skillKey: 'item_3050_passive', kind: 'parameter', key: 'ultimate_haste', pathPart: '/skills/item_3050_passive/parameters', request: newParameter({ parameterKey: 'ultimate_haste', name: '冰晶燃烧终极技能急速', valueType: 'INTEGER', fixedValue: 15, description: '冻结客户端UltimateHaste=15，终极技能急速单位为急速点；作用于已核对的终极技能集合。', sortOrder: 50 }), note: '补齐客户端绑定树确证的终极技能急速15点。' });
addCreate({ skillKey: 'item_3050_passive', kind: 'parameter', key: 'ready_duration_ms', pathPart: '/skills/item_3050_passive/parameters', request: newParameter({ parameterKey: 'ready_duration_ms', name: '霜火风暴就绪窗口', valueType: 'INTEGER', fixedValue: 5000, description: '冻结客户端ReadyDuration=5秒，施放终极技能后风暴就绪窗口为5000毫秒。', sortOrder: 60 }), note: '补齐客户端绑定树确证的终极技能施放后5秒就绪窗口；就绪消费和启动条件另列待配。' });
const hasteEffect = {
  effectKey: 'ultimate_haste',
  name: '冰晶燃烧终极技能急速',
  description: '装备持有者的170个已核对终极技能获得15点技能急速；技能键来自当前根R的Trait_Ultimate标记和唯一角色挂载回读。',
  sortOrder: 10,
  lifecycle: {
    durationValue: null,
    maxStacksValue: { kind: 'FIXED', value: 1 },
    applicationStacksValue: { kind: 'FIXED', value: 1 },
    instanceScope: 'SOURCE',
    reapplicationStackMode: 'KEEP',
    reapplicationDurationMode: null,
    expiryMode: 'EXPLICIT_ONLY',
    periodicIntervalValue: null,
    firstPeriodicExecution: null
  },
  results: [{
    resultKey: 'ultimate_haste',
    name: '终极技能急速提升',
    resultType: 'SKILL_HASTE_MODIFIER',
    target: 'SOURCE',
    description: '对核对的终极技能集合增加15点技能急速。',
    sortOrder: 10,
    lifecycleBehavior: {
      moment: 'PERSISTENT',
      valueReadMode: 'APPLICATION_SNAPSHOT',
      stackValueMode: 'SHARED',
      reapplicationValueMode: 'KEEP',
      periodicExecutionMode: null
    },
    spellShieldBlockScope: null,
    valueRule: {
      value: { kind: 'PARAMETER', parameterKey: 'ultimate_haste' },
      fixedMultiplier: 1,
      fixedMinValue: 0,
      fixedMaxValue: null
    },
    detail: {
      operation: 'INCREASE',
      affectedSkillScope: { mode: 'SKILLS', skillKeys: clone(ultimateScope.skillKeys), skillCategoryKeys: [] }
    }
  }]
};
addCreate({ skillKey: 'item_3050_passive', kind: 'effect', key: 'ultimate_haste', pathPart: '/skills/item_3050_passive/effects', request: hasteEffect, note: '使用已有SKILL_HASTE_MODIFIER结果形状保存15点终极技能急速，范围严格取170个根R标记与角色挂载回读技能键。' });
const hasteRule = {
  ruleKey: 'initialize_ultimate_haste',
  name: '初始化冰晶燃烧终极技能急速',
  description: '装备持有者初始化时，对已核对的170个终极技能执行冰晶燃烧终极技能急速效果。',
  sortOrder: 10,
  eventSource: { eventType: 'SOURCE_INITIALIZED', detail: {} },
  conditionGroups: [],
  actions: [{
    actionKey: 'execute_ultimate_haste',
    name: '执行终极技能急速',
    actionType: 'EXECUTE_EFFECT',
    sortOrder: 10,
    targetContext: 'EVENT_SOURCE',
    detail: { effectKey: 'ultimate_haste' },
    runtimeInputBindings: [],
    resultModifiers: []
  }],
  perTargetCooldown: null,
  maxTriggersPerProcess: null
};
addCreate({ skillKey: 'item_3050_passive', kind: 'trigger-rule', key: 'initialize_ultimate_haste', pathPart: '/skills/item_3050_passive/trigger-rules', request: hasteRule, note: '使用SOURCE_INITIALIZED保存无条件终极技能急速；不把所有_r后缀当作终极技能。' });
addUpdate({ skillKey: 'item_3050_passive', kind: 'skill', key: 'item_3050_passive', pathPart: '/skills/item_3050_passive', before: subject3050Before, request: subject3050After, after: subject3050After, note: '更新技能主体说明，明确新增急速和就绪窗口及仍待接线边界。' });

const subject3071Before = withoutMeta(subjectData('item_3071_passive'), 'skillKey');
const subject3071After = skillRequestBody('item_3071_passive', '保存对英雄造成物理伤害时的6%护甲削减、6秒持续和最多5层目标属性变化；同时保留冻结客户端MSBonusSplit确证的热烈移动速度参数：近战20、远程10、持续2秒。官方当前说明渲染为0的占位差异保留；数值已由当前绑定计算核定，移动速度效果与合法触发待配置。护甲削减使用独立目标属性百分比修改区。');
addUpdate({ skillKey: 'item_3071_passive', kind: 'skill', key: 'item_3071_passive', pathPart: '/skills/item_3071_passive', before: subject3071Before, request: subject3071After, after: subject3071After, note: '同步技能主体说明，补齐客户端已确证的远程10参数并保留来源差异边界。' });
const moveSpeedMeleeBefore = parameterData('item_3071_passive', 'heated_move_speed_client_value');
const moveSpeedMeleeAfter = parameterRequestBody(moveSpeedMeleeBefore, { description: '冻结客户端MSBonusSplit确证近战移动速度20；远程移动速度10另存参数；持续2秒。官方当前说明渲染为0的占位差异保留；数值已由当前绑定计算核定，移动速度效果与合法触发待配置。' });
addUpdate({ skillKey: 'item_3071_passive', kind: 'parameter', key: 'heated_move_speed_client_value', pathPart: '/skills/item_3071_passive/parameters/heated_move_speed_client_value', before: withoutMeta(moveSpeedMeleeBefore, 'parameterKey'), request: moveSpeedMeleeAfter, after: moveSpeedMeleeAfter, note: '更新近战移动速度说明，去除远程系数待核的过时口径。' });
const moveSpeedDurationBefore = parameterData('item_3071_passive', 'heated_move_speed_duration_ms');
const moveSpeedDurationAfter = parameterRequestBody(moveSpeedDurationBefore, { description: '冻结客户端MSBonusSplit确证热烈移动速度持续2秒；近战20、远程10已分别记录。官方当前说明渲染为0的占位差异保留；数值已由当前绑定计算核定，移动速度效果与合法触发待配置。' });
addUpdate({ skillKey: 'item_3071_passive', kind: 'parameter', key: 'heated_move_speed_duration_ms', pathPart: '/skills/item_3071_passive/parameters/heated_move_speed_duration_ms', before: withoutMeta(moveSpeedDurationBefore, 'parameterKey'), request: moveSpeedDurationAfter, after: moveSpeedDurationAfter, note: '更新移动速度持续时间说明并标明近战、远程参数均已记录。' });
addCreate({ skillKey: 'item_3071_passive', kind: 'parameter', key: 'heated_move_speed_ranged_value', pathPart: '/skills/item_3071_passive/parameters', request: newParameter({ parameterKey: 'heated_move_speed_ranged_value', name: '热烈远程移动速度值', valueType: 'INTEGER', fixedValue: 10, description: '冻结客户端MSBonusSplit确证远程移动速度10；近战20、持续2秒分别记录。官方当前说明渲染为0的占位差异保留；数值已由当前绑定计算核定，移动速度效果与合法触发待配置。', sortOrder: 70 }), note: '补齐冻结客户端确证的热烈远程移动速度10参数。' });

const zone3071 = {
  modifierZoneKey: 'item_3071_armor_reduction',
  name: '黑色切割者护甲削减乘区',
  domain: 'ATTRIBUTE',
  calculationMode: 'RATIO_ADD',
  applicationStage: 'ATTRIBUTE_PERCENT',
  description: '黑色切割者目标护甲百分比削减独立乘区；同效果每层加算，不与其他来源共用同一乘区。',
  status: 'ENABLED',
  sortOrder: 200
};
addCreate({ kind: 'modifier-zone', key: zone3071.modifierZoneKey, pathPart: '/modifier-zones', request: zone3071, note: '新增经方案和独立审查批准的黑切护甲削减独立乘区。' });
const armorEffectBefore = effectData('item_3071_passive', 'armor_shred');
const armorEffectAfter = clone(armorEffectBefore);
armorEffectAfter.results[0].detail.modifierZoneKey = zone3071.modifierZoneKey;
const armorEffectRequest = effectRequestBody(armorEffectAfter);
addUpdate({ skillKey: 'item_3071_passive', kind: 'effect', key: 'armor_shred', pathPart: '/skills/item_3071_passive/effects/armor_shred', before: withoutMeta(armorEffectBefore, 'effectKey'), request: armorEffectRequest, after: armorEffectRequest, note: '仅替换护甲削减结果的乘区引用，保留DECREASE、PER_STACK、目标实例和层数上限。' });

const damageInputBefore = parameterData('item_3803_passive', 'damage_input');
const subject3803Before = withoutMeta(subjectData('item_3803_passive'), 'skillKey');
const subject3803After = skillRequestBody('item_3803_passive', '保存来自英雄的减免前伤害10%回蓝、技能法力消耗25%自疗、单次施放上限20和维持型技能每秒上限20参数。客户端EternityCDPerCast=1000毫秒作为原字段保留，适用事件范围待证；不把它扩展为普通施法全局冷却或受击回蓝冷却。damage_input明确接收减免前英雄伤害；技能消耗、英雄来源筛选和持续技能统计仍待接线。');
addUpdate({ skillKey: 'item_3803_passive', kind: 'skill', key: 'item_3803_passive', pathPart: '/skills/item_3803_passive', before: subject3803Before, request: subject3803After, after: subject3803After, note: '主体说明明确减免前英雄伤害和维持型每秒上限。' });
const damageInputAfter = parameterRequestBody(damageInputBefore, { description: '来自英雄的减免前伤害运行时输入，单位：伤害点；不使用防御结算后的伤害值。英雄来源和事件绑定待配置。' });
addUpdate({ skillKey: 'item_3803_passive', kind: 'parameter', key: 'damage_input', pathPart: '/skills/item_3803_passive/parameters/damage_input', before: withoutMeta(damageInputBefore, 'parameterKey'), request: damageInputAfter, after: damageInputAfter, note: '按客户端扩展说明把受击回蓝的输入口径固定为减免前英雄伤害。' });
const eternityCooldownBefore = parameterData('item_3803_passive', 'eternity_internal_cooldown_ms');
const eternityCooldownAfter = parameterRequestBody(eternityCooldownBefore, { description: '客户端EternityCDPerCast=1秒（1000毫秒）原字段；适用事件范围待证，不解释为普通施法全局冷却或受击回蓝冷却。' });
addUpdate({ skillKey: 'item_3803_passive', kind: 'parameter', key: 'eternity_internal_cooldown_ms', pathPart: '/skills/item_3803_passive/parameters/eternity_internal_cooldown_ms', before: withoutMeta(eternityCooldownBefore, 'parameterKey'), request: eternityCooldownAfter, after: eternityCooldownAfter, note: '修正永恒内部冷却说明，保留原字段但不预设其适用事件。' });
addCreate({ skillKey: 'item_3803_passive', kind: 'parameter', key: 'health_restore_cap_per_second', pathPart: '/skills/item_3803_passive/parameters', request: newParameter({ parameterKey: 'health_restore_cap_per_second', name: '维持型技能每秒治疗上限', valueType: 'INTEGER', fixedValue: 20, description: '当前绑定扩展说明只确证维持型技能每秒最多治疗20生命；本参数只记录上限，不构造逐秒治疗金额或流程。', sortOrder: 70 }), note: '把“每次施放或每秒（维持型技能）20”拆出独立每秒上限参数。' });
const manaFormulaBefore = formulaData('item_3803_passive', 'mana_restore_from_damage');
const manaFormulaAfter = formulaRequestBody(manaFormulaBefore, { description: '运行时输入是来自英雄的减免前伤害，乘10%回蓝比例；英雄来源和输入事件留待触发绑定。' });
addUpdate({ skillKey: 'item_3803_passive', kind: 'formula', key: 'mana_restore_from_damage', pathPart: '/skills/item_3803_passive/formulas/mana_restore_from_damage', before: withoutMeta(manaFormulaBefore, 'formulaKey'), request: manaFormulaAfter, after: manaFormulaAfter, note: '同步公式说明，避免把减免前口径留在候选外。' });
const manaEffectBefore = effectData('item_3803_passive', 'mana_from_hero_damage');
const manaEffectAfter = clone(manaEffectBefore);
manaEffectAfter.description = '以来自英雄的减免前伤害运行时输入的10%恢复持有者法力；英雄来源和伤害事件仍待触发绑定。客户端EternityCDPerCast=1000毫秒只作为原字段保留，适用范围待证，不预设受击回蓝冷却。';
manaEffectAfter.results[0].description = '恢复来自英雄的减免前伤害输入的10%法力。';
const manaEffectRequest = effectRequestBody(manaEffectAfter);
addUpdate({ skillKey: 'item_3803_passive', kind: 'effect', key: 'mana_from_hero_damage', pathPart: '/skills/item_3803_passive/effects/mana_from_hero_damage', before: withoutMeta(manaEffectBefore, 'effectKey'), request: manaEffectRequest, after: manaEffectRequest, note: '同步受击回蓝效果和结果说明的减免前英雄伤害口径。' });

const subject8010Before = withoutMeta(subjectData('item_8010_passive'), 'skillKey');
const subject8010After = skillRequestBody('item_8010_passive', '保存技能或被动对英雄造成魔法伤害时的7.5%魔抗削减、6秒持续和最多4层；同一段技能施放对每个英雄至多增加一层，另有300毫秒限制。当前不挂宽泛触发规则，不把每次合法魔法伤害直接当作独立层。');
addUpdate({ skillKey: 'item_8010_passive', kind: 'skill', key: 'item_8010_passive', pathPart: '/skills/item_8010_passive', before: subject8010Before, request: subject8010After, after: subject8010After, note: '同步同一段技能施放的每英雄单层和300毫秒限制，避免宽泛触发口径。' });

const zone8010 = {
  modifierZoneKey: 'item_8010_magic_resistance_reduction',
  name: '放血者的诅咒魔抗削减乘区',
  domain: 'ATTRIBUTE',
  calculationMode: 'RATIO_ADD',
  applicationStage: 'ATTRIBUTE_PERCENT',
  description: '放血者的诅咒目标魔法抗性百分比削减独立乘区；同效果每层加算，不与其他来源共用同一乘区。',
  status: 'ENABLED',
  sortOrder: 210
};
addCreate({ kind: 'modifier-zone', key: zone8010.modifierZoneKey, pathPart: '/modifier-zones', request: zone8010, note: '新增经方案和独立审查批准的放血者魔抗削减独立乘区。' });
const mrEffectBefore = effectData('item_8010_passive', 'magic_resistance_shred');
const mrEffectAfter = clone(mrEffectBefore);
mrEffectAfter.description = '技能或被动对英雄造成魔法伤害时应用7.5%魔抗削减，持续6秒，最多4层；同一段技能施放对每个英雄至多增加一层，另有300毫秒限制。当前未挂触发规则，避免宽泛复用。';
mrEffectAfter.results[0].description = '每层降低目标7.5%魔法抗性；同一段技能施放对每个英雄至多一层，另有300毫秒限制；达到第四层后不再增加层数。';
mrEffectAfter.results[0].detail.modifierZoneKey = zone8010.modifierZoneKey;
const mrEffectRequest = effectRequestBody(mrEffectAfter);
addUpdate({ skillKey: 'item_8010_passive', kind: 'effect', key: 'magic_resistance_shred', pathPart: '/skills/item_8010_passive/effects/magic_resistance_shred', before: withoutMeta(mrEffectBefore, 'effectKey'), request: mrEffectRequest, after: mrEffectRequest, note: '仅替换魔抗削减结果的乘区引用，保留DECREASE、PER_STACK、目标实例和层数上限。' });

const result = {
  generatedAt: new Date().toISOString(),
  batch: 'Luna第八批',
  gameId: 'lol',
  mode: '待主负责人核对；未写业务API',
  apiBase,
  credentials: '未保存凭据；执行入口固定使用公开占位 local-entry',
  scope: {
    equipmentKeys: ['item_3032', 'item_3050', 'item_3071', 'item_3803', 'item_6653', 'item_8010'],
    skillKeys: ['item_3032_passive', 'item_3050_passive', 'item_3071_passive', 'item_3803_passive', 'item_6653_passive', 'item_8010_passive'],
    modifierZoneKeys: ['item_3071_armor_reduction', 'item_8010_magic_resistance_reduction'],
    excluded: ['未改动item_6653；其现有参数、公式和灼烧效果在本次方案中只做保留核对。', '不恢复item_3032此前已撤回的错误普通攻击规则。']
  },
  sources: {
    historicalCandidate: '录入候选.json（保留；本文件只列纠错动作）',
    preflight: '纠错本次预检.json（本次执行前重新GET，未保存凭据）',
    frozenSource: '冻结来源补证.json',
    correctionPlan: '纠错方案.md',
    ultimateScope: '终极技能范围证据.json（170个accepted，Udyr留pending，含ez_r）',
    rawSourceVersion: source.version
  },
  preflightSummary: {
    zoneListStatus: preflight.modifierZones.list.status,
    existingZoneKeys: preflight.modifierZones.list.data.items.map(item => item.modifierZoneKey),
    newZoneStatuses: Object.fromEntries(Object.entries(preflight.modifierZones.targetDetails).map(([key, value]) => [key, value.status])),
    skillComponentCounts: Object.fromEntries(Object.entries(preflight.skills).map(([key, value]) => [key, {
      subject: value.subject.status,
      parameters: value.parameters.details.length,
      formulas: value.formulas.details.length,
      effects: value.effects.details.length,
      triggerRules: value.triggerRules.details.length
    }]))
  },
  ultimateSkillScope: {
    count: ultimateScope.skillKeys.length,
    skillKeys: clone(ultimateScope.skillKeys),
    evidence: '仅采用终极技能范围证据.accepted；Udyr因根R没有Trait_Ultimate留待核对，不加入；ez_r已加入。'
  },
  operations,
  noChangeAudit: [{
    equipmentKey: 'item_6653',
    reason: '现有数值与AST保留；DAMAGE修正乘区为空、首次跳时序和范围筛选仍待核，不在本轮写入错误效果。'
  }],
  expectedWriteCount: operations.length,
  expectedNewResources: {
    parameters: 6,
    effects: 1,
    triggerRules: 1,
    modifierZones: 2,
    updates: 14,
    deletes: 2,
    total: operations.length
  },
  expectedFinalComponentCounts: {
    item_3032_passive: { parameters: 8, formulas: 0, effects: 1, triggerRules: 0 },
    item_3050_passive: { parameters: 7, formulas: 0, effects: 1, triggerRules: 1 },
    item_3071_passive: { parameters: 7, formulas: 0, effects: 1, triggerRules: 0 },
    item_3803_passive: { parameters: 7, formulas: 3, effects: 2, triggerRules: 0 },
    item_6653_passive: { parameters: 8, formulas: 3, effects: 1, triggerRules: 0 },
    item_8010_passive: { parameters: 4, formulas: 0, effects: 1, triggerRules: 0 },
    modifierZonesTotal: 4
  },
  boundaries: [
    '本候选只保存能由当前管理接口表达的急速初始化、参数、说明和独立属性乘区引用；风暴就绪消费、接近英雄启动、跳频、减速状态、伤害/技能目标联合筛选、持有者冷却及攻击计数仍未伪造。',
    '终极技能集合按根R的Trait_Ultimate和唯一角色挂载回读生成，不按_r后缀推断；Udyr保持待核。',
    '配置写入、逐字段GET回读和页面体验不能代替战斗、Wasm或运行时验证。',
    '执行脚本必须每项先GET；同值跳过，不同值停止；删除项只在GET仍与本预检快照一致时删除。'
  ]
};
await writeFile(path.join(dir, '纠错payload候选.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ file: '纠错payload候选.json', operations: operations.length, expectedNewResources: result.expectedNewResources, preflight: result.preflightSummary, ultimateSkillCount: ultimateScope.skillKeys.length }, null, 2));
