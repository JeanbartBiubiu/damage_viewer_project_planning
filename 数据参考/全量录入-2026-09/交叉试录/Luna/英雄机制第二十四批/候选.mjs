import { readFile } from 'node:fs/promises';

export {
  evidence, clean, levels, val, fval, fixed, pn, attr, op, add, sub, mul, div,
  valueRule, behavior, life, begin, parameter, data, effectData, literal, runtime,
  unknownCurve, formula, result, effect, manaEffect, pending, exclude, excludeData,
  requireCalc, markCalc, sourceProof, common, ammoData, ammoCount, finish
};

const evidence = JSON.parse(await readFile(new URL('./根绑定与数值证据.json', import.meta.url), 'utf8'));
const textEvidence = JSON.parse(await readFile(new URL('./补充文本证据.json', import.meta.url), 'utf8'));
const clean = value => Math.round(Number(value) * 1000000) / 1000000;
const levels = values => Object.fromEntries(values.map((value, index) => [String(index + 1), value]));
const val = parameterKey => ({ kind: 'PARAMETER', parameterKey });
const fval = formulaKey => ({ kind: 'FORMULA', formulaKey });
const fixed = value => ({ kind: 'FIXED', value });
const pn = parameterKey => ({ nodeType: 'PARAMETER', parameterKey });
const attr = (attributeKey, attributeOwner = 'SOURCE', attributeValueKind = 'TOTAL') => ({
  nodeType: 'ATTRIBUTE', attributeOwner, attributeKey, attributeValueKind
});
const op = (operation, left, right) => ({ nodeType: 'OPERATION', operation, operands: [left, right] });
const add = (...items) => items.reduce((left, right) => op('ADD', left, right));
const sub = (left, right) => op('SUBTRACT', left, right);
const mul = (left, right) => op('MULTIPLY', left, right);
const div = (left, right) => op('DIVIDE', left, right);
const valueRule = value => ({ value, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null });
const behavior = {
  moment: 'PERSISTENT',
  valueReadMode: 'APPLICATION_SNAPSHOT',
  stackValueMode: 'SHARED',
  reapplicationValueMode: 'REPLACE',
  periodicExecutionMode: null
};
const valueRef = value => value?.nodeType === 'PARAMETER' ? { kind: 'PARAMETER', parameterKey: value.parameterKey } : value;
const life = durationValue => ({
  durationValue: valueRef(durationValue),
  maxStacksValue: fixed(1),
  applicationStacksValue: fixed(1),
  instanceScope: 'SOURCE',
  reapplicationStackMode: 'KEEP',
  reapplicationDurationMode: durationValue ? 'REFRESH_ALL' : null,
  expiryMode: durationValue ? 'ALL_AT_ONCE' : 'EXPLICIT_ONLY',
  periodicIntervalValue: null,
  firstPeriodicExecution: null
});

const expressionNodeTypes = new Set(['PARAMETER', 'ATTRIBUTE', 'OPERATION']);
function assertExpression(node, path) {
  if (!node || typeof node !== 'object' || !expressionNodeTypes.has(node.nodeType)) {
    throw Error('公式表达式含不支持节点 ' + path);
  }
  if (node.nodeType === 'PARAMETER' && !node.parameterKey) throw Error('公式参数键缺失 ' + path);
  if (node.nodeType === 'ATTRIBUTE' && (!node.attributeOwner || !node.attributeKey || !node.attributeValueKind)) {
    throw Error('公式属性字段缺失 ' + path);
  }
  if (node.nodeType === 'OPERATION') {
    if (!Array.isArray(node.operands) || node.operands.length !== 2) throw Error('公式运算元必须是二元 ' + path);
    node.operands.forEach((child, index) => assertExpression(child, path + '.operands[' + index + ']'));
  }
}

export const plan = {
  meta: {
    executor: '第二十四批由Codex执行代理准备；只读来源与候选，未业务写入',
    gameId: 'lol',
    note: '客户端16.17、官方16.17.1与构建16.17.8104348来源已冻结；本批只生成候选，不调用业务写接口。',
    sources: evidence.heroes.map(hero => ({ id: hero.id, client: hero.client, official: hero.official })),
    scope: '雪人骑士、北地之怒、亡灵战神、雷霆咆哮各P/Q/W/E/R，共20个技能位。保留当前根绑定中明确的技能数值、公式、同目标多段、强化与再施放、自身护盾和属性收益、单一敌人资格及明确法力消耗；独立召唤、纯小兵野怪、纯建筑、纯视野和未知事件逐支路留证或排除，不扩大到混合主技能。',
    unitPolicy: '正文直接写百分号或乘100的字段按正文单位核对；比例参数使用0至1，百分数点参数保留百分数点。秒转换为毫秒只用于明确时长或冷却参数。等级断点、角色等级树和运行输入不猜线性、不补默认；上限、同目标多段和再施放关系只有来源明确时才进入候选。',
    attributeBoundary: '只使用当前六类属性目录已存在且当前根树明确的SOURCE/TOTAL或SOURCE/BONUS攻击力、法术强度、生命值、护甲和魔法抗性；mStat=2且mStatFormula=2按已证窄口径绑定额外攻击力，mStat=12且mStatFormula=2绑定额外生命值，mStat=6且mStatFormula=2绑定额外魔法抗性。mStat=1且mStatFormula=2的额外护甲选择器没有共享窄证，本批使用无默认来源额外护甲运行输入。没有mStatFormula的属性按当前正文和根树语义单独说明，不由字段名猜测。',
    forbidden: '本批不生成即时伤害、直接治疗、自动触发、持续过程、内部状态或控制状态；只保存可独立定义的数学量、低风险自身护盾、明确法力消耗和自益属性组成。'
  },
  skills: {}
};

function findSpell(skillKey) {
  for (const hero of evidence.heroes) {
    const spell = hero.spells.find(item => item.skillKey === skillKey);
    if (spell) return { hero, spell };
  }
  return null;
}

function begin(skillKey) {
  const found = findSpell(skillKey);
  if (!found) throw Error('来源证据缺技能 ' + skillKey);
  const { hero, spell } = found;
  const candidate = {
    skillKey,
    name: spell.official.name,
    maxLevel: spell.maxrank ?? 1,
    source: {
      hero: hero.id,
      rootPath: hero.rootPath,
      spellPath: spell.binding,
      clientSha256: hero.client.sha256,
      officialSha256: hero.official.sha256,
      currentBoundText: textEvidence.skills?.[skillKey] ?? null
    },
    write: { parameters: [], formulas: [], effects: [], processes: [], internalStates: [], triggerRules: [] },
    proofs: [],
    pending: [],
    excluded: []
  };
  plan.skills[skillKey] = candidate;
  return { c: candidate, s: spell.official, p: spell.object.mSpell };
}

function parameter(x, key, name, values, description, mode) {
  const array = (Array.isArray(values) ? values : [values]).map(clean);
  if (!array.length || !array.every(Number.isFinite)) throw Error('缺值 ' + x.c.skillKey + '/' + key);
  const variable = mode === 'SKILL_LEVEL' || (mode == null && new Set(array).size > 1);
  const body = {
    parameterKey: key,
    name,
    valueType: array.every(Number.isInteger) ? 'INTEGER' : 'DECIMAL',
    valueMode: mode ?? (variable ? 'SKILL_LEVEL' : 'FIXED'),
    fixedValue: variable ? null : array[0],
    levelValues: variable ? levels(array) : null,
    description,
    sortOrder: (x.c.write.parameters.length + 1) * 10
  };
  x.c.write.parameters.push(body);
  return pn(key);
}

function rawData(x, source) {
  return (x.p.DataValues ?? x.p.mDataValues ?? []).find(item => (item.name ?? item.mName) === source);
}

function data(x, source, key, name, options = {}) {
  const rawEntry = rawData(x, source);
  const raw = rawEntry?.values ?? rawEntry?.mValues;
  const offset = options.offset ?? 1;
  const count = x.c.maxLevel;
  if (!Array.isArray(raw) || raw.length < count + offset) throw Error('数据字段缺失 ' + x.c.skillKey + '/' + source);
  const scale = options.scale ?? 1;
  const values = raw.slice(offset, offset + count).map(value => options.integer ? Math.round(Number(value) * scale) : clean(Number(value) * scale));
  x.c.proofs.push({ parameterKey: key, source: 'DataValues.' + source, raw, offset, values, scale });
  return parameter(
    x,
    key,
    name,
    values,
    options.description ?? ('当前根绑定 DataValues.' + source + ' 取索引' + offset + '至' + (offset + count - 1) + (options.unit ? '；单位' + options.unit : '') + (scale !== 1 ? '；按正文单位换算为系统值' : '')),
    options.mode
  );
}

function effectData(x, index, key, name, options = {}) {
  const rawList = x.p.mEffectAmount;
  const offset = options.offset ?? 1;
  const count = x.c.maxLevel;
  const raw = Array.isArray(rawList) ? rawList[index - 1]?.value : null;
  if (!Array.isArray(raw) || raw.length < count + offset) throw Error('效果字段缺失 ' + x.c.skillKey + '/mEffectAmount[' + index + ']');
  const scale = options.scale ?? 1;
  const values = raw.slice(offset, offset + count).map(value => clean(Number(value) * scale));
  x.c.proofs.push({ parameterKey: key, source: 'mEffectAmount[' + index + '].value', raw, offset, values, scale });
  return parameter(
    x,
    key,
    name,
    values,
    options.description ?? ('当前根绑定 mEffectAmount[' + index + '] 取索引' + offset + '至' + (offset + count - 1) + (options.unit ? '；单位' + options.unit : '') + (scale !== 1 ? '；按正文单位换算为系统值' : '')),
    options.mode
  );
}

function literal(x, key, name, value, description, source, mode) {
  const values = Array.isArray(value) ? value : [value];
  if (!values.length || !values.every(Number.isFinite)) throw Error('字面值无效 ' + x.c.skillKey + '/' + key);
  x.c.proofs.push({ parameterKey: key, source: source ?? '官方中文正文或明确派生', values });
  return parameter(x, key, name, values, description, mode);
}

function runtime(x, key, name, description, type = 'DECIMAL') {
  x.c.write.parameters.push({
    parameterKey: key,
    name,
    valueType: type,
    valueMode: 'RUNTIME_INPUT',
    fixedValue: null,
    levelValues: null,
    description,
    sortOrder: (x.c.write.parameters.length + 1) * 10
  });
}

function unknownCurve(x, key, name, raw, source, description, type = 'DECIMAL') {
  runtime(x, key, name + '（实际值外供）', description, type);
  x.c.proofs.push({ parameterKey: key, source, raw, values: null, sourcePending: true, semantic: description });
  pending(x, '等级节点求值：' + key, description, '来源');
  return pn(key);
}

function formula(x, key, name, expression, description) {
  assertExpression(expression, x.c.skillKey + '/' + key);
  x.c.write.formulas.push({ formulaKey: key, name, expression, description, sortOrder: (x.c.write.formulas.length + 1) * 10 });
}

function result(key, name, resultType, target, value, detail, lifecycleBehavior = null, block = null, description = null) {
  return {
    resultKey: key,
    name,
    resultType,
    target,
    description,
    sortOrder: 10,
    lifecycleBehavior,
    spellShieldBlockScope: block,
    valueRule: value ? valueRule(value) : null,
    detail
  };
}

function effect(x, key, name, results, lifecycle = null, description = null) {
  x.c.write.effects.push({ effectKey: key, name, description, sortOrder: (x.c.write.effects.length + 1) * 10, lifecycle, results });
}

function manaEffect(x, description = '仅记录官方基础法力消耗；实际扣除资格、扣除时点与资源不足处理尚未接线。') {
  if (!x.c.write.parameters.some(item => item.parameterKey === 'mana_cost')) return;
  if (x.c.write.effects.some(item => item.effectKey === 'mana_cost')) return;
  effect(x, 'mana_cost', '施放法力消耗', [
    result('consume_mana', '消耗法力', 'RESOURCE_CHANGE', 'SOURCE', val('mana_cost'), { attributeKey: 'mana', operation: 'CONSUME' })
  ], null, description);
}

function ammoData(x, key, name) {
  const raw = x.p.mAmmoRechargeTime;
  const offset = 1;
  const count = x.c.maxLevel;
  if (!Array.isArray(raw) || raw.length < count + offset) throw Error('弹药恢复字段缺失 ' + x.c.skillKey);
  const values = raw.slice(offset, offset + count).map(value => Math.round(Number(value) * 1000));
  x.c.proofs.push({ parameterKey: key, source: 'mAmmoRechargeTime', raw, offset, values, scale: 1000 });
  return parameter(x, key, name, values, '当前根 mAmmoRechargeTime 取等级索引1至上限并换算为毫秒；这是弹药恢复时间，不把0.25秒的展示冷却字段当作实际再施放间隔。');
}

function ammoCount(x, key = 'ammo_max', name = '最大弹药数') {
  const raw = x.p.mMaxAmmo;
  const offset = 1;
  const count = x.c.maxLevel;
  if (!Array.isArray(raw) || raw.length < count + offset) throw Error('最大弹药字段缺失 ' + x.c.skillKey);
  const values = raw.slice(offset, offset + count);
  x.c.proofs.push({ parameterKey: key, source: 'mMaxAmmo', raw, offset, values, scale: 1 });
  return parameter(x, key, name, values, '当前根 mMaxAmmo 取等级索引1至上限；最大弹药数，不表示残暴值。');
}

function pending(x, component, reason, kind = '配置') {
  x.c.pending.push({ kind, component, reason });
}

function exclude(x, component, reason) {
  x.c.excluded.push({ component, reason });
}

function excludeData(x, source, semantic) {
  const item = rawData(x, source);
  x.c.proofs.push({ source: 'DataValues.' + source, raw: item?.values ?? item?.mValues ?? null, excluded: true, semantic });
  x.c.excluded.push({ component: 'DataValues.' + source, reason: semantic });
}

function requireCalc(x, key) {
  const calculation = x.p.mSpellCalculations?.[key];
  if (!calculation) throw Error('缺计算树 ' + x.c.skillKey + '/' + key);
  return calculation;
}

function markCalc(x, key, semantic) {
  sourceProof(x, 'mSpellCalculations.' + key, requireCalc(x, key), semantic);
}

function sourceProof(x, source, raw, semantic, extra = {}) {
  x.c.proofs.push({ source, raw, semantic, ...extra });
  if (extra.excluded) x.c.excluded.push({ component: source, reason: semantic });
}

function common(x, options = {}) {
  const useCooldown = options.cooldown !== false;
  const useMana = options.mana !== false;
  const useCast = options.cast !== false;
  const official = x.s;
  const n = x.c.maxLevel;
  const p = x.p;
  if (useCooldown) {
    if (!Array.isArray(official.cooldown) || official.cooldown.length !== n) throw Error('官方冷却数组缺失 ' + x.c.skillKey);
    if (official.cooldown.every(value => Number(value) === 0)) sourceProof(x, 'official.cooldown', official.cooldown, '官方基础冷却明确为0；不创建0毫秒冷却参数。', { excluded: true });
    else {
      const root = Array.isArray(p.cooldownTime) ? p.cooldownTime.slice(1, n + 1) : null;
      const matches = root && root.length === n && root.every((value, index) => Math.abs(Number(value) - Number(official.cooldown[index])) < 0.0001);
      literal(x, 'cooldown_ms', '基础冷却时间（毫秒）', official.cooldown.map(value => Math.round(Number(value) * 1000)), matches ? '官方逐级冷却与当前根 cooldownTime 索引1至上限逐级一致；不含技能急速或其他技能修正。' : '官方逐级冷却作为冻结候选；当前根 cooldownTime 缺失或逐级不一致，保留差异，不把缺失当作零。', matches ? 'official.cooldown + mSpell.cooldownTime' : 'official.cooldown；根 cooldownTime 差异');
      if (!matches) pending(x, '官方冷却与当前根字段差异', '官方逐级冷却和当前根 cooldownTime 没有逐级一致证据；本批保留官方值，根字段继续留源。', '来源');
    }
  }
  if (useMana) {
    if (!Array.isArray(official.cost) || official.cost.length !== n) throw Error('官方法力数组缺失 ' + x.c.skillKey);
    if (official.cost.every(value => Number(value) === 0)) sourceProof(x, 'official.cost', official.cost, '官方基础成本全为0；不创建0法力参数或效果。', { excluded: true });
    else {
      const root = Array.isArray(p.manaValues?.values) ? p.manaValues.values.slice(0, n) : null;
      const matches = root && root.length === n && root.every((value, index) => Math.abs(Number(value) - Number(official.cost[index])) < 0.0001);
      literal(x, 'mana_cost', '基础法力消耗', official.cost, matches ? '官方cost与当前根manaValues逐级一致；法力值；未包含持续资源。' : '官方cost保留基础法力消耗；当前根manaValues缺失或逐级不一致，保留差异，不将缺失当作零。', matches ? 'official.cost + mSpell.manaValues' : 'official.cost；根manaValues差异');
      if (!matches) pending(x, '官方法力与当前根字段差异', '官方cost和当前根manaValues没有逐级一致证据；本批保留官方值，根字段继续留源。', '来源');
      manaEffect(x);
    }
  }
  if (useCast) {
    const spellCast = Number.isFinite(p.spellCastTime);
    const mCast = Number.isFinite(p.mCastTime);
    if (spellCast && mCast && Math.abs(Number(p.spellCastTime) - Number(p.mCastTime)) > 0.0001) pending(x, 'spellCastTime与mCastTime冲突', '当前根两个施法时长字段不一致；不擅自选择其中一个作为完整命中时点。', '来源');
    else if (spellCast && Number(p.spellCastTime) >= 0) literal(x, 'cast_time_ms', '施法时间（毫秒）', Math.round(Number(p.spellCastTime) * 1000), '当前根spellCastTime；仅保存根字段，不表示命中发生在施法结束。', 'mSpell.spellCastTime');
    else if (mCast && Number(p.mCastTime) >= 0) literal(x, 'cast_time_ms', '施法时间（毫秒）', Math.round(Number(p.mCastTime) * 1000), '当前根mCastTime；仅保存根字段，不表示命中发生在施法结束。', 'mSpell.mCastTime');
    else if ((spellCast && Number(p.spellCastTime) < 0) || (mCast && Number(p.mCastTime) < 0)) pending(x, '施法时间为负占位', '当前根施法时长字段为负值占位；不换算成负毫秒，保留原字段待核。', '来源');
    else pending(x, '施法时间缺失', '当前根没有可用施法时长字段；不补写0毫秒。', '来源');
  }
}

function finish(x) {
  for (const item of x.p.DataValues ?? x.p.mDataValues ?? []) {
    const source = 'DataValues.' + (item.name ?? item.mName);
    if (!x.c.proofs.some(proof => proof.source === source)) sourceProof(x, source, item.values ?? item.mValues ?? null, '原始数据字段完整留源；当前候选没有独立数值消费，不按字段名猜测含义。', { sourcePending: true });
  }
  for (const key of Object.keys(x.p.mSpellCalculations ?? {})) {
    const source = 'mSpellCalculations.' + key;
    if (!x.c.proofs.some(proof => proof.source === source)) sourceProof(x, source, requireCalc(x, key), '原始计算树完整留源；当前候选没有独立消费，不重复创建无消费者公式。', { sourcePending: true });
  }
  x.c.disposition = {
    范围外: x.c.excluded,
    来源待核: x.c.pending.filter(item => item.kind === '来源'),
    系统缺口: x.c.pending.filter(item => item.kind === '系统'),
    尚未接线: x.c.pending.filter(item => !['来源', '系统'].includes(item.kind))
  };
  x.c.status = '确定组成候选；未保存、未接线和范围外分支不表示完整战斗机制';
}
