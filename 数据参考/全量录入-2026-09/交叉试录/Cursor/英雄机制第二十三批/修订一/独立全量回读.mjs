import fs from 'node:fs';
import path from 'node:path';
import {
  revisionDir,
  expected,
  kinds,
  apiRoot,
  loadFrozen,
  validateFrozen,
  createRequester,
  parseComponentRoute,
  detailRoute,
  diff,
  businessDiff,
  clone,
  assert,
} from './第二十三批录入共用.mjs';

const args = new Set(process.argv.slice(2));
const afterApply = args.has('--after-apply');
const unknownArgs = [...args].filter(value => value !== '--after-apply' && value !== '--readonly');
if (unknownArgs.length) throw new Error('未知命令参数：' + unknownArgs.join(','));

const stamp = new Date().toISOString().replaceAll(':', '-');
const reportPath = path.join(revisionDir, '独立全量回读-' + (afterApply ? '写后' : '只读') + '-' + stamp + '.json');
const eventLogPath = path.join(revisionDir, '独立回读流水-' + stamp + '.jsonl');

function saveReport(report) {
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}

function findListItem(items, idField, stableKey) {
  return Array.isArray(items) ? items.find(item => item?.[idField] === stableKey) : undefined;
}

function plannedFor(plan, skillKey, kind) {
  return plan.intents.filter(item => item.skillKey === skillKey && item.kind === kind);
}

function comparePlannedListEntry(body, actual, idField) {
  if (!actual || actual[idField] !== body[idField]) return { at: '.' + idField, expected: body[idField], actual: actual?.[idField] };
  for (const field of ['name', 'sortOrder', 'description', 'valueType', 'valueMode', 'fixedValue', 'levelValues', 'lifecycle']) {
    if (Object.hasOwn(body, field) && Object.hasOwn(actual, field)) {
      const fieldDiff = diff(body[field], actual[field], '.' + field);
      if (fieldDiff) return fieldDiff;
    }
  }
  return null;
}

function compareProtectedRoute(old, current, frozen) {
  const parsed = parseComponentRoute(old.route);
  if (!parsed?.collection) {
    return current.status === old.status ? diff(old.data, current.data) : {
      at: '.status',
      expected: old.status,
      actual: current.status,
    };
  }
  if (current.status !== old.status) return {
    at: '.status',
    expected: old.status,
    actual: current.status,
  };
  if (!Array.isArray(old.data) || !Array.isArray(current.data)) return {
    at: '.data',
    expected: old.data,
    actual: current.data,
  };
  const idField = kinds.find(item => item.kind === parsed.kind).id;
  const planned = plannedFor(frozen.plan, parsed.skillKey, parsed.kind);
  const allowed = new Set(old.data.map(item => item[idField]));
  for (const item of planned) allowed.add(item.stableKey);
  for (const item of current.data) {
    if (!allowed.has(item[idField])) return {
      at: '.data',
      reason: 'unexpected_existing_component',
      stableKey: item[idField],
    };
  }
  for (const item of old.data) {
    const actual = findListItem(current.data, idField, item[idField]);
    if (!actual) return {
      at: '.data',
      reason: 'protected_component_missing',
      stableKey: item[idField],
    };
    const oldDiff = diff(item, actual);
    if (oldDiff) return oldDiff;
  }
  for (const item of planned) {
    const actual = findListItem(current.data, idField, item.stableKey);
    if (actual) {
      const listDiff = comparePlannedListEntry(item.body, actual, idField);
      if (listDiff) return listDiff;
    }
  }
  return null;
}

function collectNodes(node, out = { parameters: [], attributes: [], operations: [] }) {
  assert(node && typeof node === 'object', '实际公式节点缺失');
  if (node.nodeType === 'PARAMETER') {
    out.parameters.push(node.parameterKey);
    return out;
  }
  if (node.nodeType === 'ATTRIBUTE') {
    out.attributes.push(node.attributeOwner + '.' + node.attributeKey + '.' + node.attributeValueKind);
    return out;
  }
  assert(node.nodeType === 'OPERATION' && Array.isArray(node.operands) && node.operands.length === 2,
    '实际公式存在非二元操作', node);
  out.operations.push(node.operation);
  for (const child of node.operands) collectNodes(child, out);
  return out;
}

function strictMath(frozen, detailMap) {
  const candidate = frozen.candidate;
  const formulaDetails = new Map();
  const formulaKeys = [];
  for (const skillKey of Object.keys(candidate.skills)) {
    for (const formula of candidate.skills[skillKey].write.formulas) {
      const key = skillKey + '/formulas/' + formula.formulaKey;
      formulaKeys.push({ skillKey, formulaKey: formula.formulaKey, key });
      const actual = detailMap.get(key);
      if (actual?.expression) formulaDetails.set(key, actual);
    }
  }
  const missingFormulas = formulaKeys.filter(item => !formulaDetails.has(item.key))
    .map(item => item.skillKey + '/' + item.formulaKey);
  const parameterDetails = new Map();
  for (const skillKey of Object.keys(candidate.skills)) {
    for (const parameter of candidate.skills[skillKey].write.parameters) {
      const key = skillKey + '/parameters/' + parameter.parameterKey;
      const actual = detailMap.get(key);
      if (actual) parameterDetails.set(key, actual);
    }
  }
  const missingParameters = [];
  for (const skillKey of Object.keys(candidate.skills)) {
    for (const parameter of candidate.skills[skillKey].write.parameters) {
      if (!parameterDetails.has(skillKey + '/parameters/' + parameter.parameterKey)) {
        missingParameters.push(skillKey + '/' + parameter.parameterKey);
      }
    }
  }
  const base = {
    expressionSource: '每棵公式的expression均来自实际GET详情；候选表达式只用于静态键集合校验',
    formulaCount: formulaKeys.length,
    actualFormulaCount: formulaDetails.size,
    actualParameterCount: parameterDetails.size,
    missingFormulas,
    missingParameters,
    positiveCaseCount: 0,
    positivePassed: 0,
    missingValueChecks: [],
    missingValueRejected: 0,
    integerHalfChecks: [],
    capChecks: [],
    businessMathReady: false,
  };
  if (missingFormulas.length || missingParameters.length) {
    return {
      ...base,
      status: 'NOT_READY',
      reason: '实际GET尚未返回全部公式和参数详情，不能用候选表达式代替',
    };
  }

  const source = frozen.sourceBinding;
  const heroes = Object.fromEntries((source.heroes ?? []).map(hero => [hero.id, hero]));
  const heroIdOf = skillKey => skillKey.startsWith('amumu_') ? 'Amumu' : 'Zac';
  const slotOf = skillKey => skillKey.slice(-1).toUpperCase();
  const boundSkill = skillKey => heroes[heroIdOf(skillKey)]?.skills?.find(skill => skill.slot === slotOf(skillKey));
  const rawSpell = skillKey => {
    const value = boundSkill(skillKey)?.object?.mSpell;
    assert(value, '实际核算来源技能树缺失', skillKey);
    return value;
  };
  const rawDataValues = skillKey => rawSpell(skillKey).DataValues ?? [];
  const rawData = (skillKey, name) => {
    const item = rawDataValues(skillKey).find(value => value.name === name);
    assert(item, '实际核算来源DataValues缺失', { skillKey, name });
    return item.values;
  };
  const rawField = (skillKey, name) => {
    const value = rawSpell(skillKey)[name];
    assert(Array.isArray(value), '实际核算来源字段不是数组', { skillKey, name });
    return value;
  };
  const rawRank = (skillKey, name, level) => rawData(skillKey, name)[level];
  const rawFixed = (skillKey, name) => rawData(skillKey, name)[1];
  const rawCalc = (skillKey, key) => {
    const value = rawSpell(skillKey).mSpellCalculations?.[key];
    assert(value, '实际核算来源计算树缺失', { skillKey, key });
    return value;
  };
  const rawPart = (skillKey, key, index = 0) => rawCalc(skillKey, key).mFormulaParts[index];
  const actualParameter = (skillKey, parameterKey) => {
    const value = parameterDetails.get(skillKey + '/parameters/' + parameterKey);
    assert(value, '实际参数详情缺失', { skillKey, parameterKey });
    return value;
  };
  const levelOf = (skillKey, scenario) => scenario.levels[skillKey] ?? candidate.skills[skillKey].maxLevel;
  const readValue = (skillKey, parameterKey, scenario, overrides = {}) => {
    const item = actualParameter(skillKey, parameterKey);
    const override = overrides?.[skillKey]?.[parameterKey];
    let value = override;
    if (value === undefined) {
      if (item.valueMode === 'FIXED') value = item.fixedValue;
      else if (item.valueMode === 'SKILL_LEVEL') value = item.levelValues?.[String(levelOf(skillKey, scenario))];
      else if (item.valueMode === 'RUNTIME_INPUT') value = scenario.runtime?.[skillKey]?.[parameterKey];
      else throw new Error('未知实际参数模式：' + skillKey + '/' + parameterKey);
    }
    assert(value !== undefined && value !== null && Number.isFinite(Number(value)),
      '实际核算参数缺值', { skillKey, parameterKey });
    if (item.valueType === 'INTEGER') assert(Number.isInteger(Number(value)),
      '实际核算整数参数收到小数', { skillKey, parameterKey, value });
    return Number(value);
  };
  const readAttribute = (owner, key, valueKind, scenario) => {
    const value = scenario.attributes?.[owner]?.[key]?.[valueKind];
    assert(value !== undefined && value !== null && Number.isFinite(Number(value)),
      '实际核算属性缺值', { owner, key, valueKind });
    return Number(value);
  };
  const evaluate = (skillKey, node, scenario, overrides = {}) => {
    assert(node && typeof node === 'object', '实际表达式节点缺失', { skillKey, node });
    if (node.nodeType === 'PARAMETER') return readValue(skillKey, node.parameterKey, scenario, overrides);
    if (node.nodeType === 'ATTRIBUTE') {
      assert(['SOURCE', 'TARGET'].includes(node.attributeOwner), '实际表达式属性主体非法', node);
      assert(['TOTAL', 'BASE', 'BONUS'].includes(node.attributeValueKind), '实际表达式属性值类型非法', node);
      return readAttribute(node.attributeOwner, node.attributeKey, node.attributeValueKind, scenario);
    }
    assert(node.nodeType === 'OPERATION' && Array.isArray(node.operands) && node.operands.length === 2,
      '实际表达式必须是二元树', node);
    const left = evaluate(skillKey, node.operands[0], scenario, overrides);
    const right = evaluate(skillKey, node.operands[1], scenario, overrides);
    if (node.operation === 'ADD') return left + right;
    if (node.operation === 'SUBTRACT') return left - right;
    if (node.operation === 'MULTIPLY') return left * right;
    if (node.operation === 'DIVIDE') return left / right;
    if (node.operation === 'MIN') return Math.min(left, right);
    if (node.operation === 'MAX') return Math.max(left, right);
    throw new Error('实际表达式操作未审阅：' + node.operation);
  };
  const scenarioA = {
    id: 'A',
    levels: Object.fromEntries(Object.keys(candidate.skills).map(skillKey => [skillKey, 1])),
    attributes: {
      SOURCE: { ability_power: { TOTAL: 100 }, hp: { TOTAL: 2000, BONUS: 500 } },
      TARGET: { hp: { TOTAL: 2400 } },
    },
    runtime: {
      amumu_p: { magic_damage_base: 120 },
      amumu_e: { incoming_physical_damage: 100, source_bonus_armor: 20, source_bonus_magic_resistance: 30 },
      zac_p: { cell_heal_ratio: 0.04 },
      zac_q: { source_current_hp_for_cost: 500 },
      zac_w: { source_current_hp_for_cost: 500 },
      zac_e: { source_current_hp_for_cost: 500 },
    },
  };
  const scenarioB = {
    id: 'B',
    levels: Object.fromEntries(Object.keys(candidate.skills).map(skillKey => [skillKey, candidate.skills[skillKey].maxLevel])),
    attributes: {
      SOURCE: { ability_power: { TOTAL: 275 }, hp: { TOTAL: 3200, BONUS: 1200 } },
      TARGET: { hp: { TOTAL: 4800 } },
    },
    runtime: {
      amumu_p: { magic_damage_base: 250 },
      amumu_e: { incoming_physical_damage: 300, source_bonus_armor: 200, source_bonus_magic_resistance: 100 },
      zac_p: { cell_heal_ratio: 0.07 },
      zac_q: { source_current_hp_for_cost: 900 },
      zac_w: { source_current_hp_for_cost: 900 },
      zac_e: { source_current_hp_for_cost: 900 },
    },
  };
  const nearly = (actual, wanted, epsilon = 1e-7) => Math.abs(Number(actual) - Number(wanted)) <= epsilon;
  const expectedFormula = (skillKey, formulaKey, scenario) => {
    const level = levelOf(skillKey, scenario);
    const ap = scenario.attributes.SOURCE.ability_power.TOTAL;
    const targetHp = scenario.attributes.TARGET.hp.TOTAL;
    const sourceHpTotal = scenario.attributes.SOURCE.hp.TOTAL;
    const sourceHpBonus = scenario.attributes.SOURCE.hp.BONUS;
    if (skillKey === 'amumu_p') return scenario.runtime.amumu_p.magic_damage_base * Number(rawFixed('amumu_p', 'DamageAmp').toFixed(3));
    if (skillKey === 'amumu_q') return rawRank('amumu_q', 'BaseDamage', level) + Number(rawPart('amumu_q', 'TotalDamage', 1).mCoefficient.toFixed(2)) * ap;
    if (skillKey === 'amumu_w') {
      const points = rawRank('amumu_w', 'HealthDamage', level) + Number(rawRank('amumu_w', 'APRatio', level).toFixed(3)) * ap;
      if (formulaKey === 'total_health_damage_percent_points') return points;
      if (formulaKey === 'damage_per_second') return rawRank('amumu_w', 'BaseDamage', level) + 0.01 * points * targetHp;
    }
    if (skillKey === 'amumu_e') {
      const reductionPoints = rawRank('amumu_e', 'BaseDamageReduction', level) +
        Number(rawPart('amumu_e', 'DamageReduction', 1).mCoefficient.toFixed(2)) * scenario.runtime.amumu_e.source_bonus_armor +
        Number(rawPart('amumu_e', 'DamageReduction', 2).mCoefficient.toFixed(2)) * scenario.runtime.amumu_e.source_bonus_magic_resistance;
      const incoming = scenario.runtime.amumu_e.incoming_physical_damage;
      if (formulaKey === 'damage_reduction_points' || formulaKey === 'raw_physical_damage_reduction') return reductionPoints;
      if (formulaKey === 'capped_physical_damage_reduction') return Math.min(reductionPoints, Number(rawFixed('amumu_e', 'FlatDamageReductionMax')) * incoming);
      if (formulaKey === 'tantrum_damage') return rawRank('amumu_e', 'BaseDamage', level) + rawPart('amumu_e', 'TantrumDamage', 1).mCoefficient * ap;
    }
    if (skillKey === 'amumu_r') return rawRank('amumu_r', 'RDamage', level) + Number(rawRank('amumu_r', 'RCoefficient', level).toFixed(1)) * ap;
    if (skillKey === 'zac_p') return scenario.runtime.zac_p.cell_heal_ratio * sourceHpTotal;
    if (skillKey === 'zac_q') {
      const total = rawRank('zac_q', 'BaseDamage', level) +
        Number(rawRank('zac_q', 'APRatio', level).toFixed(1)) * ap +
        Number(rawRank('zac_q', 'HealthRatio', level).toFixed(2)) * sourceHpBonus;
      if (formulaKey === 'total_damage') return total;
      if (formulaKey === 'max_damage_tooltip') return rawPart('zac_q', 'MaxDamageTooltip', 0).mPart2.mNumber * total;
      if (formulaKey === 'health_cost') return Number(rawRank('zac_q', 'HPCost', level).toFixed(2)) * scenario.runtime.zac_q.source_current_hp_for_cost;
    }
    if (skillKey === 'zac_w') {
      const points = rawRank('zac_w', 'HealthPercentTooltip', level) +
        Number(rawRank('zac_w', 'APRatioToPercentDamage', level).toFixed(2)) * ap;
      if (formulaKey === 'damage') return rawRank('zac_w', 'BaseDamage', level) + Number(rawCalc('zac_w', 'DisplayPercentDamage').mMultiplier.mNumber.toFixed(2)) * points * targetHp;
      if (formulaKey === 'health_cost') return Number(rawRank('zac_w', 'HPCost', level).toFixed(2)) * scenario.runtime.zac_w.source_current_hp_for_cost;
    }
    if (skillKey === 'zac_e') {
      if (formulaKey === 'damage') return rawRank('zac_e', 'BaseDamage', level) + Number(rawPart('zac_e', 'Damage', 1).mCoefficient.toFixed(1)) * ap;
      if (formulaKey === 'maximum_stun_duration') return rawRank('zac_e', 'MinimumStun', level) * 1000 * rawPart('zac_e', 'MaxStun', 0).mPart2.mNumber;
      if (formulaKey === 'health_cost') return Number(rawRank('zac_e', 'HPCost', level).toFixed(2)) * scenario.runtime.zac_e.source_current_hp_for_cost;
    }
    if (skillKey === 'zac_r') {
      const bounce = rawRank('zac_r', 'BaseDamageBounce', level) + Number(rawRank('zac_r', 'BounceAPRatioTooltip', level).toFixed(1)) * ap;
      const bounces = rawRank('zac_r', 'Bounces', level);
      const subsequent = Number(rawRank('zac_r', 'DamageReductionBounce', level).toFixed(1)) * bounce;
      if (formulaKey === 'damage_per_bounce') return bounce;
      if (formulaKey === 'damage_per_subsequent_bounce') return subsequent;
      if (formulaKey === 'duration_tooltip_ms') return rawRank('zac_r', 'TimeBetweenBounces', level) * 1000 * (bounces - 1);
      if (formulaKey === 'max_damage_tooltip') return bounce + subsequent * (bounces - 1);
    }
    throw new Error('没有独立来源期望值：' + skillKey + '/' + formulaKey);
  };

  const formulaChecks = [];
  for (const item of formulaKeys) {
    const formula = formulaDetails.get(item.key);
    const cases = [scenarioA, scenarioB].map(scenario => {
      const actual = evaluate(item.skillKey, formula.expression, scenario);
      const wanted = expectedFormula(item.skillKey, item.formulaKey, scenario);
      assert(Number.isFinite(actual) && nearly(actual, wanted), '实际GET公式与来源期望不符', {
        skillKey: item.skillKey,
        formulaKey: item.formulaKey,
        scenario: scenario.id,
        actual,
        expected: wanted,
      });
      return { scenario: scenario.id, level: levelOf(item.skillKey, scenario), actual, expected: wanted, passed: true };
    });
    formulaChecks.push({ skillKey: item.skillKey, formulaKey: item.formulaKey, cases });
  }

  const missingValueChecks = [];
  const expectReject = (label, fn) => {
    try {
      fn();
    } catch (error) {
      missingValueChecks.push({ label, rejected: true, error: error.message });
      return;
    }
    throw new Error('缺值未拒绝：' + label);
  };
  for (const item of formulaKeys) {
    const formula = formulaDetails.get(item.key);
    const nodes = collectNodes(formula.expression);
    for (const parameterKey of [...new Set(nodes.parameters)]) {
      if (actualParameter(item.skillKey, parameterKey).valueMode !== 'RUNTIME_INPUT') continue;
      const missingScenario = clone(scenarioA);
      delete missingScenario.runtime?.[item.skillKey]?.[parameterKey];
      expectReject(item.skillKey + '/' + item.formulaKey + '/缺少' + parameterKey,
        () => evaluate(item.skillKey, formula.expression, missingScenario));
    }
    for (const attributePath of [...new Set(nodes.attributes)]) {
      const [owner, key, valueKind] = attributePath.split('.');
      const missingScenario = clone(scenarioA);
      delete missingScenario.attributes?.[owner]?.[key]?.[valueKind];
      expectReject(item.skillKey + '/' + item.formulaKey + '/缺少' + attributePath,
        () => evaluate(item.skillKey, formula.expression, missingScenario));
    }
  }

  const integerHalfChecks = [];
  for (const [skillKey, parameterKey] of [
    ['amumu_q', 'max_charges'],
    ['zac_r', 'bounce_count'],
    ['zac_e', 'maximum_stun_multiplier'],
  ]) {
    const scenario = clone(scenarioA);
    try {
      readValue(skillKey, parameterKey, scenario, { [skillKey]: { [parameterKey]: 0.5 } });
    } catch (error) {
      integerHalfChecks.push({ skillKey, parameterKey, attemptedValue: 0.5, rejected: true, error: error.message });
      continue;
    }
    throw new Error('整数输入未拒绝0.5：' + skillKey + '/' + parameterKey);
  }

  const capCases = [
    { label: '阿木木E等级1额外护甲100额外魔抗200承受10', level: 1, incoming: 10, armor: 100, magicResistance: 200, rawExpected: 14, expected: 5 },
    { label: '阿木木E等级1额外护甲100额外魔抗200承受100', level: 1, incoming: 100, armor: 100, magicResistance: 200, rawExpected: 14, expected: 14 },
    { label: '阿木木E等级1额外护甲100额外魔抗200承受1000', level: 1, incoming: 1000, armor: 100, magicResistance: 200, rawExpected: 14, expected: 14 },
    { label: '阿木木E等级5无额外属性承受100', level: 5, incoming: 100, armor: 0, magicResistance: 0, rawExpected: 13, expected: 13 },
    { label: '阿木木E等级5高额属性承受100', level: 5, incoming: 100, armor: 2000, magicResistance: 2000, rawExpected: 133, expected: 50 },
  ];
  const rawFormula = formulaDetails.get('amumu_e/formulas/raw_physical_damage_reduction');
  const cappedFormula = formulaDetails.get('amumu_e/formulas/capped_physical_damage_reduction');
  const capChecks = capCases.map(item => {
    const scenario = clone(scenarioA);
    scenario.levels.amumu_e = item.level;
    scenario.runtime.amumu_e = {
      incoming_physical_damage: item.incoming,
      source_bonus_armor: item.armor,
      source_bonus_magic_resistance: item.magicResistance,
    };
    const rawActual = evaluate('amumu_e', rawFormula.expression, scenario);
    const actual = evaluate('amumu_e', cappedFormula.expression, scenario);
    assert(nearly(rawActual, item.rawExpected) && nearly(actual, item.expected),
      '阿木木E实际GET封顶算例不符', { label: item.label, rawActual, rawExpected: item.rawExpected, actual, expected: item.expected });
    return { ...item, rawActual, actual, passed: true };
  });

  let operationCount = 0;
  for (const item of formulaKeys) operationCount += collectNodes(formulaDetails.get(item.key).expression).operations.length;
  return {
    ...base,
    status: 'PASSED',
    formulaChecks,
    formulaCount: formulaChecks.length,
    positiveCaseCount: formulaChecks.length * 2,
    positivePassed: formulaChecks.length * 2,
    missingValueChecks,
    missingValueRejected: missingValueChecks.length + integerHalfChecks.length,
    missingValueRejectionBreakdown: {
      runtimeOrAttribute: missingValueChecks.length,
      integerHalf: integerHalfChecks.length,
      total: missingValueChecks.length + integerHalfChecks.length,
    },
    integerHalfChecks,
    capChecks,
    binaryOperationCount: operationCount,
    binaryOperationArityPassed: true,
    businessMathReady: true,
  };
}

async function main() {
  const frozen = loadFrozen();
  const staticChecks = validateFrozen(frozen);
  const { request, events } = createRequester({ allowPost: false, journalPath: eventLogPath });
  const baseline = [];
  const detailMap = new Map();
  const protectedChecks = [];
  let error = null;

  for (const old of frozen.protection.requests) {
    const current = await request(old.route, { method: 'GET', phase: '全量保护读取' });
    baseline.push({ route: old.route, expectedStatus: old.status, status: current.status, data: current.data, error: current.error });
    const mismatch = compareProtectedRoute(old, current, frozen);
    protectedChecks.push({
      route: old.route,
      expectedStatus: old.status,
      actualStatus: current.status,
      match: mismatch === null,
      diff: mismatch,
    });
    const parsed = parseComponentRoute(old.route);
    if (parsed && !parsed.collection && current.status === 200) {
      detailMap.set(parsed.skillKey + '/' + parsed.kind + '/' + parsed.stableKey, current.data);
    }
  }

  const targetChecks = [];
  for (const plannedIntent of frozen.plan.intents) {
    const route = detailRoute(plannedIntent.skillKey, plannedIntent.kind, plannedIntent.stableKey);
    const current = await request(route, { method: 'GET', phase: '全量目标读取' });
    const state = current.status === 404
      ? 'MISSING'
      : current.status === 200
        ? (businessDiff(plannedIntent.body, current.data) === null ? 'MATCH' : 'CONFLICT')
        : 'ERROR';
    const mismatch = state === 'CONFLICT'
      ? businessDiff(plannedIntent.body, current.data)
      : state === 'ERROR'
        ? { status: current.status, error: current.error }
        : null;
    targetChecks.push({
      skillKey: plannedIntent.skillKey,
      kind: plannedIntent.kind,
      stableKey: plannedIntent.stableKey,
      route,
      status: current.status,
      state,
      diff: mismatch,
      actual: current.data,
    });
    if (current.status === 200) detailMap.set(plannedIntent.skillKey + '/' + plannedIntent.kind + '/' + plannedIntent.stableKey, current.data);
  }

  let math;
  try {
    math = strictMath(frozen, detailMap);
  } catch (caught) {
    math = {
      status: 'FAILED',
      expressionSource: '每棵公式的expression均来自实际GET详情；候选表达式只用于静态键集合校验',
      formulaCount: expected.formulaCount,
      businessMathReady: false,
      error: caught.name + ': ' + caught.message,
    };
  }

  const protectedConflicts = protectedChecks.filter(item => !item.match);
  const targetMissing = targetChecks.filter(item => item.state === 'MISSING');
  const targetMatches = targetChecks.filter(item => item.state === 'MATCH');
  const targetConflicts = targetChecks.filter(item => item.state === 'CONFLICT');
  const targetErrors = targetChecks.filter(item => item.state === 'ERROR');
  const componentListRoutes = baseline.filter(item => parseComponentRoute(item.route)?.collection);
  const componentSubjectRoutes = baseline.filter(item => /^\/skills\/[^/]+$/.test(item.route));
  const imageRoutes = baseline.filter(item => item.route.includes('/representative-image'));
  const relationRoutes = baseline.filter(item => item.route.startsWith('/character-skill-relations'));
  const catalogRoutes = baseline.filter(item => ['/attributes', '/skill-categories', '/modifier-zones', '/damage-types'].includes(item.route));
  const report = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    mode: afterApply ? 'after-apply' : 'readonly',
    apiRoot,
    apiWrites: 0,
    candidateSha256: frozen.hashes.candidate,
    planSha256: frozen.hashes.plan,
    sourceManifestSha256: frozen.hashes.sourceManifest,
    protectionSnapshotSha256: frozen.hashes.protectionSnapshot,
    sourceBindingSha256: frozen.hashes.sourceBinding,
    staticChecks,
    coverage: {
      protectedRoutes: { expected: expected.protectedGETCount, actual: baseline.length },
      catalogs: { expected: 4, actual: catalogRoutes.length, routes: catalogRoutes.map(item => item.route) },
      subjects: { expected: 10, actual: componentSubjectRoutes.length, routes: componentSubjectRoutes.map(item => item.route) },
      componentLists: { expected: 60, actual: componentListRoutes.length, routes: componentListRoutes.map(item => item.route) },
      representativeImages: { expected: 10, actual: imageRoutes.length, routes: imageRoutes.map(item => item.route) },
      relations: { expected: 2, actual: relationRoutes.length, routes: relationRoutes.map(item => item.route) },
      targetDetails: { expected: expected.postIntentCount, actual: targetChecks.length },
      componentDetails: {
        expected: expected.candidateParameterCount + expected.formulaCount + expected.effectCount,
        actual: detailMap.size,
        protectedExisting: detailMap.size - targetChecks.filter(item => item.state === 'MATCH').length,
        planned: targetChecks.filter(item => item.state === 'MATCH').length,
      },
    },
    protected: {
      planned: protectedChecks.length,
      preserved: protectedConflicts.length === 0,
      matched: protectedChecks.filter(item => item.match).length,
      conflicts: protectedConflicts,
    },
    targets: {
      planned: targetChecks.length,
      missing: targetMissing.length,
      matched: targetMatches.length,
      conflicts: targetConflicts,
      errors: targetErrors,
      checks: targetChecks,
    },
    math,
    fullBusinessFields: {
      source: 'events与businessSnapshot均保留实际GET响应正文',
      subjects: baseline.filter(item => /^\/skills\/[^/]+$/.test(item.route)),
      componentLists: componentListRoutes,
      representativeImages: imageRoutes,
      relations: relationRoutes,
      catalogs: catalogRoutes,
    },
    eventLogPath,
    events,
    finishedAt: new Date().toISOString(),
    complete: protectedConflicts.length === 0 &&
      targetMissing.length === 0 &&
      targetConflicts.length === 0 &&
      targetErrors.length === 0 &&
      math.businessMathReady === true,
    businessMathReady: math.businessMathReady === true,
    error,
  };
  saveReport(report);
  console.log(JSON.stringify({
    mode: report.mode,
    apiWrites: 0,
    reportPath,
    eventLogPath,
    candidateSha256: report.candidateSha256,
    planSha256: report.planSha256,
    protectedGETs: baseline.length,
    protectedPreserved: report.protected.preserved,
    subjects: componentSubjectRoutes.length,
    componentLists: componentListRoutes.length,
    representativeImages: imageRoutes.length,
    relations: relationRoutes.length,
    catalogs: catalogRoutes.length,
    targetDetails: targetChecks.length,
    targetMissing: targetMissing.length,
    targetMatched: targetMatches.length,
    targetConflicts: targetConflicts.length,
    targetErrors: targetErrors.length,
    actualFormulaCount: math.actualFormulaCount,
    businessMathReady: report.businessMathReady,
    complete: report.complete,
  }, null, 2));
  if (afterApply && !report.complete) process.exitCode = 1;
}

await main();
