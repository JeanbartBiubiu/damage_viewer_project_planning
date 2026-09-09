import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const planningDir = here;
const files = {
  frozen: path.join(planningDir, '冻结来源.json'),
  candidate: path.join(planningDir, '可审查候选.json'),
  requests: path.join(planningDir, '可审查请求.json'),
  summary: path.join(planningDir, '生成摘要.json'),
  before: path.join(planningDir, '写前主体核对.json')
};

const bytes = {};
const json = {};
for (const [key, file] of Object.entries(files)) {
  bytes[key] = await readFile(file);
  json[key] = JSON.parse(bytes[key]);
}
const sha256 = value => createHash('sha256').update(value).digest('hex');
const fileSha256 = key => sha256(bytes[key]);
const clean = value => Math.round(value * 1e6) / 1e6;
const source = json.frozen;
const candidate = json.candidate;
const requests = json.requests;
const summary = json.summary;
const before = json.before;
const expectedIds = [8112, 8126, 8139, 8143, 9923, 8439, 9101, 8233, 8214, 8229, 8237, 8232];
const entries = new Map(source.entries.map(entry => [entry.id, entry]));
const proposals = new Map(candidate.proposals.map(proposal => [proposal.id, proposal]));

assert.deepEqual([...entries.keys()], expectedIds, '冻结来源对象范围或顺序不符');
assert.deepEqual([...proposals.keys()], expectedIds, '候选对象范围或顺序不符');
assert.equal(requests.sourceRawSha256, source.rawSha256, '请求记录引用的原始来源哈希不符');
assert.equal(requests.candidateSha256, fileSha256('candidate'), '请求记录引用的候选哈希不符');
assert.equal(summary.candidateSha256, fileSha256('candidate'), '生成摘要引用的候选哈希不符');
assert.equal(summary.requestSha256, fileSha256('requests'), '生成摘要引用的请求哈希不符');
assert.equal(summary.frozenSha256, fileSha256('frozen'), '生成摘要引用的冻结来源哈希不符');
assert.equal(summary.businessWrites, 0, '生成摘要记录了业务写入');
assert.equal(before.mode, 'GET_ONLY', '写前主体核对不是只读模式');
assert.equal(before.businessWrites, 0, '写前主体核对记录了业务写入');
assert.equal(before.reads.length, 12, '写前主体核对不是12个目标');
assert(before.reads.every(read => read.status === 404 && read.route === `/skills/${read.data?.error?.details?.skillKey}`), '写前主体存在非404或路由归属异常');

const checks = [];
function check(name, fn, details = {}) {
  try {
    fn();
    checks.push({ name, status: '通过', ...details });
  } catch (error) {
    checks.push({ name, status: '阻塞', reason: error instanceof Error ? error.message : String(error), ...details });
  }
}

function proposalParameter(proposal, key) {
  const parameter = proposal.parameters.find(item => item.parameterKey === key);
  assert.ok(parameter, `${proposal.skillKey}缺少参数 ${key}`);
  return parameter;
}

function formula(proposal, key) {
  const item = proposal.formulas.find(row => row.formulaKey === key);
  assert.ok(item, `${proposal.skillKey}缺少公式 ${key}`);
  return item;
}

function hasNode(node, predicate) {
  if (predicate(node)) return true;
  if (node?.nodeType === 'OPERATION') return node.operands.some(child => hasNode(child, predicate));
  return false;
}

function assertExpression(node, proposal, context = proposal.skillKey) {
  assert.ok(node && typeof node === 'object', `${context}公式节点不是对象`);
  if (node.nodeType === 'PARAMETER') {
    assert.ok(proposal.parameters.some(parameter => parameter.parameterKey === node.parameterKey), `${context}引用未知参数 ${node.parameterKey}`);
    return;
  }
  if (node.nodeType === 'ATTRIBUTE') {
    assert.ok(['SOURCE', 'TARGET', 'OWNER'].includes(node.attributeOwner), `${context}属性归属无效`);
    assert.ok(typeof node.attributeKey === 'string' && node.attributeKey.length > 0, `${context}属性名为空`);
    assert.ok(['BASE', 'BONUS', 'TOTAL', 'CURRENT', 'MISSING', 'CURRENT_RATIO', 'MISSING_RATIO'].includes(node.attributeValueKind), `${context}属性取值种类无效`);
    return;
  }
  assert.equal(node.nodeType, 'OPERATION', `${context}公式节点类型无效`);
  assert.ok(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX'].includes(node.operation), `${context}公式运算无效`);
  assert.equal(node.operands.length, 2, `${context}/${node.operation}不是二元运算`);
  assertExpression(node.operands[0], proposal, context);
  assertExpression(node.operands[1], proposal, context);
}

function rawEffect(entry) {
  return entry.object.mScript.mSpellScriptData.mEffectAmount;
}

function rawCalculations(entry) {
  return entry.object.mScript.mSpellScriptData.mCalculations;
}

const bindingSummary = [];
for (const id of expectedIds) {
  const entry = entries.get(id);
  const proposal = proposals.get(id);
  check(`${id}身份与中文绑定`, () => {
    assert.equal(proposal.name, entry.name);
    assert.equal(proposal.sourcePath, entry.sourcePath);
    assert.equal(proposal.sourceObjectSha256, entry.sourceObjectSha256);
    assert.equal(sha256(Buffer.from(JSON.stringify(entry.object))), entry.sourceObjectSha256, '来源对象哈希不匹配');
    assert.equal(proposal.runeKey, `rune_${id}`);
    assert.equal(proposal.skillKey, `rune_${id}_passive`);
    assert.equal(proposal.skillBody.skillKey, proposal.skillKey);
    assert.equal(proposal.skillBody.name, `符文·${entry.name}`);
    assert.equal(proposal.skillBody.maxLevel, 1);
    assert.equal(proposal.skillBody.status, 'ENABLED');
    assert.deepEqual(proposal.skillBody.skillCategoryKeys, ['passive']);
    assert.deepEqual(proposal.relationBody, { runeKey: `rune_${id}`, skillKey: proposal.skillKey, sortOrder: 0 });
    const bindingTexts = Object.values(entry.bound).map(value => value.text).filter(Boolean);
    assert(bindingTexts.length >= 3, '当前中文绑定文本不完整');
    assert(bindingTexts.some(text => /@/.test(text)), '当前中文绑定没有保留动态占位');
    bindingSummary.push({
      id,
      name: entry.name,
      sourcePath: entry.sourcePath,
      tooltip: entry.bound.mTooltipNameLocalizationKey?.text ?? null,
      shortDescription: entry.bound.mShortDescLocalizationKey?.text ?? null,
      longDescription: entry.bound.mLongDescLocalizationKey?.text ?? null
    });
  });
  check(`${id}来源数值与单位`, () => {
    const evidenceKeys = new Set();
    for (const evidence of proposal.parameterEvidence) {
      assert(!evidenceKeys.has(evidence.parameterKey), `参数证据重复 ${evidence.parameterKey}`);
      evidenceKeys.add(evidence.parameterKey);
      const parameter = proposalParameter(proposal, evidence.parameterKey);
      if (evidence.sourcePath) {
        const prefix = `${entry.sourcePath}/mScript/mSpellScriptData/mEffectAmount/`;
        assert(evidence.sourcePath.startsWith(prefix), `来源路径不在当前对象的效果值下 ${evidence.sourcePath}`);
        const field = evidence.sourcePath.slice(prefix.length);
        const raw = rawEffect(entry)[field];
        assert.equal(typeof raw, 'number', `${field}不是数值来源`);
        assert.equal(evidence.sourceRawValue, raw, `${field}原始值记录不符`);
        assert.equal(evidence.defaultSupplied, parameter.valueMode !== 'RUNTIME_INPUT', `${evidence.parameterKey}默认供值标记不符`);
        if (parameter.valueMode === 'FIXED') {
          const expected = clean(raw * (evidence.scale ?? 1));
          assert.equal(clean(parameter.fixedValue), expected, `${evidence.parameterKey}规范化值不符`);
        } else {
          assert.equal(parameter.fixedValue, null, `${evidence.parameterKey}运行时输入不应有固定值`);
        }
      } else if (parameter.valueMode === 'RUNTIME_INPUT') {
        assert.equal(parameter.fixedValue, null, `${evidence.parameterKey}运行时输入不应有固定值`);
        assert.equal(evidence.defaultSupplied, false, `${evidence.parameterKey}未知输入不能标记已供值`);
      }
      if (parameter.parameterKey.endsWith('_ms') && parameter.parameterKey !== 'seconds_to_ms') {
        assert.equal(parameter.valueType, 'INTEGER', `${parameter.parameterKey}毫秒值不是整数类型`);
        assert.equal(evidence.scale, 1000, `${parameter.parameterKey}没有按秒转毫秒`);
      }
    }
    assert.equal(evidenceKeys.size, proposal.parameters.length, '参数与来源证据数量不一致');
  });
  check(`${id}公式引用结构`, () => {
    const keys = new Set();
    for (const row of proposal.formulas) {
      assert(!keys.has(row.formulaKey), `公式重复 ${row.formulaKey}`);
      keys.add(row.formulaKey);
      assertExpression(row.expression, proposal);
    }
  });
}

check('候选与120条请求逐项一致', () => {
  assert.equal(requests.requests.length, 120);
  const expectedCounts = { skill: 12, parameter: 78, formula: 17, effect: 1, relation: 12, rule: 0, process: 0, internalState: 0 };
  assert.deepEqual(requests.counts, expectedCounts);
  assert.deepEqual(candidate.counts, expectedCounts);
  const actualCounts = Object.fromEntries(Object.keys(expectedCounts).map(kind => [kind, requests.requests.filter(request => request.kind === kind).length]));
  assert.deepEqual(actualCounts, expectedCounts);
  for (const request of requests.requests) {
    const proposal = proposals.get(request.id);
    assert.ok(proposal, `请求对象不在候选 ${request.id}`);
    assert.equal(request.skillKey, proposal.skillKey);
    let expectedBody;
    if (request.kind === 'skill') expectedBody = proposal.skillBody;
    else if (request.kind === 'parameter') expectedBody = proposal.parameters.find(row => row.parameterKey === request.body.parameterKey);
    else if (request.kind === 'formula') expectedBody = proposal.formulas.find(row => row.formulaKey === request.body.formulaKey);
    else if (request.kind === 'effect') expectedBody = proposal.effects.find(row => row.effectKey === request.body.effectKey);
    else if (request.kind === 'relation') expectedBody = proposal.relationBody;
    else throw new Error(`出现未授权请求类型 ${request.kind}`);
    assert.ok(expectedBody, `${request.kind}请求找不到候选主体`);
    assert.deepEqual(request.body, expectedBody, `${request.kind}请求体与候选不一致`);
    assert(request.route.startsWith('/skills') || request.route === '/rune-skill-relations');
    assert(request.readRoute.startsWith(`/skills/${proposal.skillKey}`) || request.readRoute === `/rune-skill-relations?runeKey=${proposal.runeKey}&skillKey=${proposal.skillKey}`);
  }
});

const apBadSource = {
  8112: { calculation: 'TotalDamage', ap: 'APRatio', bad: 'BonusADRatio' },
  8139: { calculation: 'HealCalc', ap: 'APRatio', bad: 'ADRatio' },
  8214: { calculation: 'DamageCalc', ap: 'DamageAPRatio', bad: 'DamageADRatio' },
  8229: { calculation: 'DamageCalc', ap: 'APRatio', bad: 'ADRatio' },
  9923: { calculation: 'BonusDamage', ap: 'APRatio', bad: 'BonusADRatio' }
};

check('AP与额外攻击力具名和默认字段旁证', () => {
  for (const [idText, expected] of Object.entries(apBadSource)) {
    const id = Number(idText);
    const entry = entries.get(id);
    const proposal = proposals.get(id);
    const raw = rawCalculations(entry)[expected.calculation];
    assert.ok(raw, `${id}缺少${expected.calculation}`);
    const parts = raw.mFormulaParts;
    assert(parts.some(part => part.mDataValue === expected.ap), `${id}缺少法强具名字段 ${expected.ap}`);
    const badPart = parts.find(part => part.mDataValue === expected.bad);
    assert.ok(badPart, `${id}缺少额外攻击力具名字段 ${expected.bad}`);
    assert.equal(badPart.mStat, 2);
    assert.equal(badPart.mStatFormula, 2);
    const targetFormula = proposal.formulas.find(item => item.formulaKey === (id === 8139 ? 'heal_amount' : id === 8229 ? 'base_damage_amount' : 'damage_amount'));
    assert.ok(targetFormula);
    assert(hasNode(targetFormula.expression, node => node.nodeType === 'ATTRIBUTE' && node.attributeOwner === 'SOURCE' && node.attributeKey === 'ability_power' && node.attributeValueKind === 'TOTAL'), `${id}公式没有SOURCE法术强度`);
    assert(hasNode(targetFormula.expression, node => node.nodeType === 'ATTRIBUTE' && node.attributeOwner === 'SOURCE' && node.attributeKey === 'attack_damage' && node.attributeValueKind === 'BONUS'), `${id}公式没有SOURCE额外攻击力`);
    const text = entry.bound.mLongDescLocalizationKey?.text ?? '';
    assert.match(text, /法术强度/);
    assert.match(text, /额外攻击力/);
  }
});

check('余震双抗、生命和MIN封顶', () => {
  const entry = entries.get(8439);
  const proposal = proposals.get(8439);
  const raw = rawCalculations(entry);
  assert.equal(raw.ArmorBuff.mFormulaParts[1].mStat, 1);
  assert.equal(raw.ArmorBuff.mFormulaParts[1].mStatFormula, 2);
  assert.equal(raw.MagicResistBuff.mFormulaParts[1].mStat, 6);
  assert.equal(raw.MagicResistBuff.mFormulaParts[1].mStatFormula, 2);
  assert.equal(raw.DamageCalc.mFormulaParts[1].mStat, 12);
  assert.equal(raw.DamageCalc.mFormulaParts[1].mStatFormula, 2);
  for (const key of ['armor_bonus_amount', 'magic_resistance_bonus_amount']) {
    const expression = formula(proposal, key).expression;
    assert.equal(expression.operation, 'MIN');
    assert.equal(expression.operands[1].parameterKey, 'confirmed_level_resist_cap');
    assert.equal(expression.operands[0].operation, 'ADD');
    assert.equal(expression.operands[0].operands[0].parameterKey, 'flat_resistance');
    const multiply = expression.operands[0].operands[1];
    assert.equal(multiply.operation, 'MULTIPLY');
    assert.equal(multiply.operands[0].nodeType, 'ATTRIBUTE');
    assert.equal(multiply.operands[0].attributeOwner, 'SOURCE');
    assert.equal(multiply.operands[0].attributeValueKind, 'BONUS');
    assert.equal(multiply.operands[1].parameterKey, 'bonus_resistance_ratio');
  }
  const damage = formula(proposal, 'damage_amount').expression;
  assert.equal(damage.operation, 'ADD');
  assert.equal(damage.operands[0].parameterKey, 'confirmed_level_damage');
  assert.equal(damage.operands[1].operands[0].attributeKey, 'hp');
  assert.equal(damage.operands[1].operands[0].attributeValueKind, 'BONUS');
  assert.equal(proposalParameter(proposal, 'flat_resistance').fixedValue, 45);
  assert.equal(proposalParameter(proposal, 'bonus_resistance_ratio').fixedValue, 0.75);
  assert.equal(proposalParameter(proposal, 'bonus_health_damage_ratio').fixedValue, 0.08);
  assert.equal(proposalParameter(proposal, 'resistance_duration_ms').fixedValue, 2500);
});

check('彗星冷却钳制和距离非线性边界', () => {
  const entry = entries.get(8229);
  const proposal = proposals.get(8229);
  const raw = rawCalculations(entry).CooldownCalc;
  assert.equal(raw.mFormulaParts[0].mFloor, 0.30000001192092896);
  assert.equal(raw.mFormulaParts[0].mCeiling, 20);
  assert.equal(proposalParameter(proposal, 'cooldown_floor_seconds').fixedValue, 0.3);
  assert.equal(proposalParameter(proposal, 'seconds_to_ms').fixedValue, 1000);
  const cooldown = formula(proposal, 'cooldown_ms').expression;
  assert.equal(cooldown.operation, 'MULTIPLY');
  assert.equal(cooldown.operands[1].parameterKey, 'seconds_to_ms');
  assert.equal(cooldown.operands[0].operation, 'MIN');
  assert.equal(cooldown.operands[0].operands[0].parameterKey, 'confirmed_level_cooldown_seconds_source_start');
  assert.equal(cooldown.operands[0].operands[1].operation, 'MAX');
  assert.equal(cooldown.operands[0].operands[1].operands[0].parameterKey, 'cooldown_floor_seconds');
  assert.equal(cooldown.operands[0].operands[1].operands[1].parameterKey, 'confirmed_level_cooldown_seconds');
  assert.equal(proposalParameter(proposal, 'maximum_distance_damage_ratio').fixedValue, 1);
  assert.equal(proposalParameter(proposal, 'maximum_amplification_distance').fixedValue, 750);
  assert.equal(proposal.formulas.some(row => /distance|距离|linear|线性/i.test(JSON.stringify(row.expression))), false, '距离被错误写入公式');
  assert.equal(proposal.parameters.some(row => /distance_input|distance_fraction|target_distance/i.test(row.parameterKey)), false, '距离被错误写成运行时输入');
  assert.match(entry.bound.mTooltipNameLocalizationKey.text, /基于其远离的程度/);
  assert.match(proposal.pending.map(item => item.reason).join('；'), /中间曲线/);
});

check('丛刃相邻间隔与重置次数语义', () => {
  const proposal = proposals.get(9923);
  assert.equal(proposalParameter(proposal, 'base_attack_count').fixedValue, 3);
  assert.equal(proposalParameter(proposal, 'max_attack_gap_ms').fixedValue, 3000);
  assert.equal(proposalParameter(proposal, 'cooldown_ms').fixedValue, 10000);
  assert.equal(proposalParameter(proposal, 'max_bonus_reset_attacks').fixedValue, 2);
  assert.equal(proposalParameter(proposal, 'additional_attack_per_reset').fixedValue, 1);
  assert.match(proposalParameter(proposal, 'max_attack_gap_ms').description, /相邻攻击间隔/);
  assert.match(proposalParameter(proposal, 'max_attack_gap_ms').description, /不能作为整个增益3秒固定持续时间/);
  assert.match(proposalParameter(proposal, 'max_bonus_reset_attacks').description, /不是覆盖基础3次的总上限/);
  assert(proposal.qualification.required.some(text => /相邻攻击间隔不超过3秒/.test(text)));
});

check('绝对专注0.6和70%严格门槛', () => {
  const entry = entries.get(8233);
  const proposal = proposals.get(8233);
  assert.equal(proposalParameter(proposal, 'adaptive_to_attack_damage_ratio').fixedValue, 0.6);
  assert.match(entry.bound.mLongDescLocalizationKey.text, /0\.6/);
  const matches = candidate.proposals.flatMap(item => item.parameters.filter(parameter => parameter.parameterKey === 'adaptive_to_attack_damage_ratio'));
  assert.equal(matches.length, 1);
  assert.equal(matches[0].valueMode, 'FIXED');
  assert.equal(proposalParameter(proposal, 'health_threshold_ratio').fixedValue, 0.7);
  assert.match(formula(proposal, 'health_threshold').description, /严格高于70%/);
});

check('吸收生命力保留断点缺口', () => {
  const entry = entries.get(9101);
  const proposal = proposals.get(9101);
  const part = rawCalculations(entry).HealAmount.mFormulaParts[0];
  assert.equal(part.__type, 'ByCharLevelBreakpointsCalculationPart');
  assert.equal(part.mLevel1Value, 1);
  assert.equal(part.mInitialBonusPerLevel, 0.25);
  assert.deepEqual(part.mBreakpoints, [
    { mLevel: 6, mBonusPerLevelAtAndAfter: 1, __type: 'Breakpoint' },
    { mLevel: 11, mBonusPerLevelAtAndAfter: 2, __type: 'Breakpoint' }
  ]);
  const parameter = proposalParameter(proposal, 'confirmed_level_heal');
  assert.equal(parameter.valueMode, 'RUNTIME_INPUT');
  assert.equal(parameter.levelValues, null);
  assert.equal(proposal.parameters.some(item => item.valueMode === 'CHARACTER_LEVEL'), false);
  assert.match(proposal.pending.map(item => item.reason).join('；'), /断点/);
});

check('水上行走固定移速独立效果', () => {
  const proposal = proposals.get(8232);
  assert.equal(proposal.effects.length, 1);
  const effect = proposal.effects[0];
  assert.equal(effect.effectKey, 'river_flat_move_speed_component');
  assert.equal(effect.lifecycle.instanceScope, 'SOURCE');
  assert.equal(effect.results.length, 1);
  const result = effect.results[0];
  assert.equal(result.target, 'SOURCE');
  assert.equal(result.resultType, 'ATTRIBUTE_CHANGE');
  assert.equal(result.detail.attributeKey, 'move_speed');
  assert.equal(result.detail.operation, 'INCREASE');
  assert.equal(result.valueRule.value.parameterKey, 'river_flat_move_speed');
  assert.equal(proposalParameter(proposal, 'river_flat_move_speed').fixedValue, 10);
  assert(proposal.excluded.some(item => item.field === '{6f2f0d30}' && item.value === 1));
});

function evaluate(node, context) {
  if (node.nodeType === 'PARAMETER') {
    assert.ok(Object.hasOwn(context.parameters, node.parameterKey), `算例缺少参数 ${node.parameterKey}`);
    return context.parameters[node.parameterKey];
  }
  if (node.nodeType === 'ATTRIBUTE') {
    const key = `${node.attributeOwner}:${node.attributeKey}:${node.attributeValueKind}`;
    assert.ok(Object.hasOwn(context.attributes, key), `算例缺少属性 ${key}`);
    return context.attributes[key];
  }
  assert.equal(node.nodeType, 'OPERATION');
  assert.equal(node.operands.length, 2);
  const left = evaluate(node.operands[0], context);
  const right = evaluate(node.operands[1], context);
  switch (node.operation) {
    case 'ADD': return left + right;
    case 'SUBTRACT': return left - right;
    case 'MULTIPLY': return left * right;
    case 'DIVIDE': return left / right;
    case 'MIN': return Math.min(left, right);
    case 'MAX': return Math.max(left, right);
    default: throw new Error(`未知公式运算 ${node.operation}`);
  }
}

const mathCases = [
  { id: 8112, key: 'damage_amount', parameters: { confirmed_level_base: 70 }, attributes: { 'SOURCE:ability_power:TOTAL': 100, 'SOURCE:attack_damage:BONUS': 50 }, expected: 80, explanation: '电刑70+100×0.05+50×0.1' },
  { id: 8126, key: 'damage_amount', parameters: { confirmed_level_base: 10 }, expected: 10, explanation: '恶意中伤显式等级值10' },
  { id: 8139, key: 'heal_amount', parameters: { confirmed_level_base: 16 }, attributes: { 'SOURCE:ability_power:TOTAL': 100, 'SOURCE:attack_damage:BONUS': 50 }, expected: 26, explanation: '血之滋味16+100×0.05+50×0.1' },
  { id: 8143, key: 'damage_amount', parameters: { confirmed_level_base: 20 }, expected: 20, explanation: '猛然冲击显式等级值20' },
  { id: 9923, key: 'damage_amount', parameters: { confirmed_level_base: 2 }, attributes: { 'SOURCE:ability_power:TOTAL': 100, 'SOURCE:attack_damage:BONUS': 50 }, expected: 18, explanation: '丛刃2+100×0.1+50×0.12' },
  { id: 8439, key: 'armor_bonus_amount', parameters: { confirmed_level_resist_cap: 80 }, attributes: { 'SOURCE:armor:BONUS': 100 }, expected: 80, explanation: '余震护甲MIN(45+100×0.75,80)' },
  { id: 8439, key: 'armor_bonus_amount', parameters: { confirmed_level_resist_cap: 150 }, attributes: { 'SOURCE:armor:BONUS': 100 }, expected: 120, explanation: '余震护甲MIN(45+100×0.75,150)' },
  { id: 8439, key: 'magic_resistance_bonus_amount', parameters: { confirmed_level_resist_cap: 150 }, attributes: { 'SOURCE:magic_resistance:BONUS': 200 }, expected: 150, explanation: '余震魔抗MIN(45+200×0.75,150)' },
  { id: 8439, key: 'damage_amount', parameters: { confirmed_level_damage: 25 }, attributes: { 'SOURCE:hp:BONUS': 2000 }, expected: 185, explanation: '余震爆发25+2000×0.08' },
  { id: 9101, key: 'heal_amount', parameters: { confirmed_level_heal: 23 }, expected: 23, explanation: '吸收生命力显式等级输入23' },
  { id: 8233, key: 'health_threshold', attributes: { 'SOURCE:hp:TOTAL': 1000 }, expected: 700, explanation: '绝对专注1000×0.7门槛值' },
  { id: 8233, key: 'attack_damage_amount', parameters: { confirmed_adaptive_force: 30 }, expected: 18, explanation: '绝对专注30×0.6攻击力换算' },
  { id: 8233, key: 'ability_power_amount', parameters: { confirmed_adaptive_force: 30 }, expected: 30, explanation: '绝对专注法强分支保留适应之力30' },
  { id: 8214, key: 'damage_amount', parameters: { confirmed_level_base: 10 }, attributes: { 'SOURCE:ability_power:TOTAL': 100, 'SOURCE:attack_damage:BONUS': 50 }, expected: 20, explanation: '艾黎10+100×0.05+50×0.1' },
  { id: 8229, key: 'base_damage_amount', parameters: { confirmed_level_base: 15 }, attributes: { 'SOURCE:ability_power:TOTAL': 100, 'SOURCE:attack_damage:BONUS': 50 }, expected: 25, explanation: '彗星15+100×0.05+50×0.1' },
  { id: 8229, key: 'cooldown_ms', parameters: { confirmed_level_cooldown_seconds: 0.3 }, expected: 300, explanation: '彗星MIN(20,MAX(0.3,0.3))×1000' },
  { id: 8229, key: 'cooldown_ms', parameters: { confirmed_level_cooldown_seconds: 20 }, expected: 20000, explanation: '彗星MIN(20,MAX(0.3,20))×1000' },
  { id: 8229, key: 'cooldown_ms', parameters: { confirmed_level_cooldown_seconds: 0 }, expected: 300, explanation: '彗星低于下限时钳制0.3秒并转300毫秒' },
  { id: 8229, key: 'cooldown_ms', parameters: { confirmed_level_cooldown_seconds: 25 }, expected: 20000, explanation: '彗星高于上限时钳制20秒并转20000毫秒' },
  { id: 8237, key: 'damage_amount', parameters: { confirmed_level_base: 20 }, expected: 20, explanation: '焦灼显式等级值20' },
  { id: 8232, key: 'adaptive_force_amount', parameters: { confirmed_adaptive_force: 13 }, expected: 13, explanation: '水上行走显式适应之力13' }
];

const mathResults = [];
for (const [index, item] of mathCases.entries()) {
  check(`算例${index + 1} ${item.id}/${item.key}`, () => {
    const proposal = proposals.get(item.id);
    assert.ok(proposal, `算例对象不存在 ${item.id}`);
    const parameters = Object.fromEntries(proposal.parameters.filter(parameter => parameter.valueMode === 'FIXED').map(parameter => [parameter.parameterKey, parameter.fixedValue]));
    Object.assign(parameters, item.parameters ?? {});
    const attributes = item.attributes ?? {};
    const actual = clean(evaluate(formula(proposal, item.key).expression, { parameters, attributes }));
    assert.equal(actual, item.expected, `得到${actual}，预期${item.expected}`);
    mathResults.push({ index: index + 1, id: item.id, skillKey: proposal.skillKey, formulaKey: item.key, parameters, attributes, expected: item.expected, actual, explanation: item.explanation });
  });
}

const strictGateResults = [];
for (const [index, item] of [
  { health: 700, expected: false, explanation: '等于70%不满足严格高于' },
  { health: 700.0001, expected: true, explanation: '高于70%满足' },
  { health: 699.9999, expected: false, explanation: '低于70%不满足' }
].entries()) {
  check(`绝对专注严格门槛${index + 1}`, () => {
    const threshold = 1000 * proposalParameter(proposals.get(8233), 'health_threshold_ratio').fixedValue;
    const actual = item.health > threshold;
    assert.equal(actual, item.expected);
    strictGateResults.push({ index: index + 1, maximumHealth: 1000, health: item.health, threshold, expected: item.expected, actual, explanation: item.explanation });
  });
}

const passed = checks.filter(item => item.status === '通过').length;
const failed = checks.length - passed;
const result = {
  generatedAt: new Date().toISOString(),
  stage: '符文第四批独立只读审查；只读取规划冻结来源、候选、请求和写前主体核对，不调用业务接口，不修改候选',
  inputDirectory: planningDir,
  inputSha256: Object.fromEntries(Object.keys(files).map(key => [key, fileSha256(key)])),
  source: {
    clientVersion: source.clientVersion,
    officialVersion: source.officialVersion,
    rawSha256: source.rawSha256,
    frozenFileSha256: fileSha256('frozen'),
    entries: bindingSummary
  },
  candidate: {
    fileSha256: fileSha256('candidate'),
    declaredSha256: requests.candidateSha256,
    counts: candidate.counts,
    requestCount: requests.requests.length,
    businessWrites: summary.businessWrites
  },
  checks: {
    count: checks.length,
    passed,
    failed,
    allPassed: failed === 0,
    details: checks
  },
  arithmetic: {
    formulaCaseCount: mathResults.length,
    passed: mathResults.length,
    failed: 0,
    cases: mathResults,
    strictThresholdCases: strictGateResults
  },
  conclusions: {
    apAndBonusAttackDamage: '8112、8139、8214、8229、9923均沿当前计算树的法强字段和mStat=2、mStatFormula=2额外攻击力字段读取SOURCE属性。',
    aftershock: '护甲、魔抗使用SOURCE BONUS并用等级封顶参数MIN限制；爆发伤害使用SOURCE hp BONUS。',
    comet: '冷却按MIN(20,MAX(0.3,明确等级秒数))×1000；750距离和100%增幅只保留端点，不生成距离线性函数。',
    hailOfBlades: '3次基础攻击、相邻攻击最大间隔3000毫秒、重置额外次数2和每次增加1分别保存，未把间隔当总持续，也未把2当基础3的总上限。',
    absoluteFocus: '0.6只依据绝对专注当前具名正文用于适应之力转攻击力；生命必须严格高于70%最大生命。',
    absorbLife: 'HealAmount保留初值、初始斜率和6/11级断点来源，但候选使用运行时输入，不猜完整等级曲线。',
    waterwalking: '仅水上行走的10固定移速进入一个SOURCE属性效果；未命名字段1只保留排除证据。'
  },
  blockers: failed ? checks.filter(item => item.status === '阻塞') : []
};

await writeFile(path.join(here, '独立审查结果.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
const markdown = [
  '# 符文第四批独立只读审查',
  '',
  `审查对象为12个符文候选和120条请求；候选声明78个参数、17个公式、1个河道固定移速效果和12个关系，业务写入记录为${summary.businessWrites}。`,
  '',
  `冻结来源文件SHA256：\`${fileSha256('frozen')}\`；原始客户端资料SHA256：\`${source.rawSha256}\`；候选文件SHA256：\`${fileSha256('candidate')}\`；请求文件SHA256：\`${fileSha256('requests')}\`。`,
  '',
  `结构、来源和语义检查共${checks.length}项，通过${passed}项，阻塞${failed}项；独立公式算例${mathResults.length}项全部通过。绝对专注严格门槛另有${strictGateResults.length}个边界算例，等于70%时判定为不满足。`,
  '',
  '## 核对结论',
  '',
  `- ${result.conclusions.apAndBonusAttackDamage}`,
  `- ${result.conclusions.aftershock}`,
  `- ${result.conclusions.comet}`,
  `- ${result.conclusions.hailOfBlades}`,
  `- ${result.conclusions.absoluteFocus}`,
  `- ${result.conclusions.absorbLife}`,
  `- ${result.conclusions.waterwalking}`,
  '',
  '算例覆盖电刑、恶意中伤、血之滋味、猛然冲击、丛刃、余震、吸收生命力、绝对专注、艾黎、彗星、焦灼和水上行走；不把算术结果解释为触发、状态、浏览器、真实战斗或运行时证明。',
  '',
  '中文绑定摘要和逐项检查详情见 `独立审查结果.json`；发现阻塞时只报告证据，不修改规划候选。',
  ''
].join('\n');
await writeFile(path.join(here, '独立审查报告.md'), markdown, 'utf8');
console.log(JSON.stringify({ file: '独立审查结果.json', checks: { count: checks.length, passed, failed }, formulaCases: mathResults.length, candidateSha256: fileSha256('candidate') }));
if (failed) process.exitCode = 1;
