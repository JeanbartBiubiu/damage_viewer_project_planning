import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// 这个脚本只读实际录入脚本的回读文件。它不调用业务接口，也不使用候选生成器的中间结果代替实际对象。
const herePath = path.dirname(fileURLToPath(import.meta.url));
const archivePath = path.join(herePath, '恢复交付');
const expectedCandidateSha256 = 'd5668bcda66786383f9bc0bbcf02464cee3dc7c34417f3bd244ecd0fdc0ecae1';
const expectedPlanSha256 = 'eefb4349d27c7ac42b3192eac33981551b5dfeebe2fbdb4957f1948feeed3991';
const expectedOriginalSnapshotSha256 = '79142b374fba9a9b5f099dda33525788ca1071ea35bc668b5998721cabe8f834';
const expectedOriginalCandidateSha256 = 'a98792185a594829b214f1aaeb0ba1503cfa34d72ac1af9a88302b4d906e31c7';
const batchDir = herePath;
const candidatePath = path.join(archivePath, '最终候选.json');
const planPath = path.join(archivePath, '最终写前计划.json');
const sourcePath = path.join(batchDir, '根绑定与数值证据.json');
const beforePath = path.join(batchDir, '写前现值.json');
const originalCandidatePath = path.join(batchDir, '完整候选.json');
const sourceExamplesPath = path.join(batchDir, '独立源值与算例.json');
const kinds = [
  ['parameters', 'parameterKey', 'parameters'],
  ['formulas', 'formulaKey', 'formulas'],
  ['effects', 'effectKey', 'effects'],
  ['processes', 'processKey', 'processes'],
  ['internalStates', 'stateKey', 'internal-states'],
  ['triggerRules', 'ruleKey', 'trigger-rules'],
];
const skills = ['viktor', 'orianna', 'syndra', 'taliyah'].flatMap(hero => ['p', 'q', 'w', 'e', 'r'].map(slot => `${hero}_${slot}`));
const heroes = ['viktor', 'orianna', 'syndra', 'taliyah'];
const catalogKinds = [['attributes', 'attributeKey'], ['modifier-zones', 'modifierZoneKey'], ['damage-types', 'damageTypeKey'], ['statuses', 'statusKey']];
const serverFields = new Set(['gameId', 'skillKey', 'createdAt', 'updatedAt']);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const canonical = value => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).filter(key => !serverFields.has(key)).sort().map(key => [key, canonical(value[key])]))
    : value;
const stable = value => canonical(value);
const firstDiff = (expected, actual, at = '$') => {
  if (Object.is(expected, actual)) return null;
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') return {path: at, expected, actual};
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) return {path: at, expected, actual};
    for (let index = 0; index < expected.length; index++) {
      const diff = firstDiff(expected[index], actual[index], `${at}[${index}]`);
      if (diff) return diff;
    }
    return null;
  }
  for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
    if (!(key in expected) || !(key in actual)) return {path: `${at}.${key}`, expected: expected[key], actual: actual[key]};
    const diff = firstDiff(expected[key], actual[key], `${at}.${key}`);
    if (diff) return diff;
  }
  return null;
};
const compareFull = (expected, actual) => firstDiff(stable(expected), stable(actual));
const rows = response => Array.isArray(response?.data)
  ? response.data
  : Array.isArray(response?.data?.items)
    ? response.data.items
    : [];
const argValue = (args, name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const args = process.argv.slice(2);
if (args.some((arg, index) => arg.startsWith('--') && !['--run-dir', '--out'].includes(arg))) throw Error('只接受 --run-dir 和 --out');
const runDirArg = argValue(args, '--run-dir');
if (!runDirArg) throw Error('必须指定实际录入脚本的执行记录目录：--run-dir <目录>');
const runDir = path.resolve(runDirArg);
const allowedRunRoots = [path.join(batchDir, '执行记录'), path.join(batchDir, '独立回读')];
if (!allowedRunRoots.some(root => {
  const relative = path.relative(root, runDir);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
})) throw Error('执行记录目录必须位于本批执行记录或独立回读目录内');
const executionPath = path.join(runDir, '执行结果.json');
if (!fs.existsSync(executionPath)) throw Error('执行记录缺少执行结果.json');
const execution = readJson(executionPath);
const phase = fs.existsSync(path.join(runDir, '最终全量组件现值.json')) ? '写后' : '写前';
const componentPath = path.join(runDir, phase === '写后' ? '最终全量组件现值.json' : '写前组件现值.json');
if (!fs.existsSync(componentPath)) throw Error(`执行记录缺少${phase}组件现值文件`);
const components = readJson(componentPath);
const protectionPath = path.join(runDir, phase === '写后' ? '写后保护.json' : '写前保护.json');
if (!fs.existsSync(protectionPath)) throw Error(`执行记录缺少${phase}保护文件`);
const protection = readJson(protectionPath);
const candidateBytes = fs.readFileSync(candidatePath);
const planBytes = fs.readFileSync(planPath);
if (sha256(candidateBytes) !== expectedCandidateSha256) throw Error('归档最终候选散列变化');
if (sha256(planBytes) !== expectedPlanSha256) throw Error('归档最终计划散列变化');
if (execution.candidateFileSha256 !== expectedCandidateSha256 || execution.originalSnapshotSha256 !== expectedOriginalSnapshotSha256) throw Error('执行记录冻结散列不符');
if (sha256(fs.readFileSync(originalCandidatePath)) !== expectedOriginalCandidateSha256) throw Error('原始完整候选散列变化');
if (sha256(fs.readFileSync(beforePath)) !== expectedOriginalSnapshotSha256) throw Error('写前现值散列变化');
const candidate = JSON.parse(candidateBytes);
const plan = JSON.parse(planBytes);
const source = readJson(sourcePath);
const examples = readJson(sourceExamplesPath);
const failures = [];
const checks = [];
const missingComponents = [];
const fullComparisons = [];
const listChecks = [];
const formulaChecks = [];
const sourceChecks = [];
const inputRejections = [];
const notes = [];
const check = (name, passed, details = null) => {
  checks.push({name, passed});
  if (!passed) failures.push({name, details});
};
const close = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(1e-5, Math.abs(b) * 2e-6);
const idFieldOf = kind => kinds.find(item => item[0] === kind)?.[1];
const expectedEntries = [];
for (const skillKey of skills) {
  const skill = candidate.skills?.[skillKey];
  if (!skill) throw Error(`候选缺少技能槽 ${skillKey}`);
  for (const [kind, idField] of kinds) {
    for (const body of skill.write?.[kind] ?? []) expectedEntries.push({skillKey, kind, id: body[idField], body});
  }
}
check('最终候选20槽', skills.length === 20 && Object.keys(candidate.skills ?? {}).join('|') === skills.join('|'));
check('最终候选组成219项', expectedEntries.length === 219);
check('写后/写前阶段明确', phase === '写后' || phase === '写前', {phase});
const actualByKey = new Map();
for (const record of components.details ?? []) {
  const key = `${record.skillKey}/${record.kind}/${record.id}`;
  if (actualByKey.has(key)) check(`实际详情无重复 ${key}`, false);
  actualByKey.set(key, record);
  check(`实际详情GET成功 ${key}`, record.status === 200 && record.data && typeof record.data === 'object', {status: record.status});
}
for (const entry of expectedEntries) {
  const key = `${entry.skillKey}/${entry.kind}/${entry.id}`;
  const actual = actualByKey.get(key);
  if (!actual || actual.status !== 200 || !actual.data) {
    missingComponents.push({skillKey: entry.skillKey, kind: entry.kind, id: entry.id, route: actual?.route ?? null});
    continue;
  }
  const diff = compareFull(entry.body, actual.data);
  fullComparisons.push({skillKey: entry.skillKey, kind: entry.kind, id: entry.id, passed: !diff, diff});
  check(`业务对象完整回读 ${key}`, !diff, diff);
}
for (const record of components.details ?? []) {
  const key = `${record.skillKey}/${record.kind}/${record.id}`;
  if (!expectedEntries.some(entry => `${entry.skillKey}/${entry.kind}/${entry.id}` === key)) check(`无候选之外详情 ${key}`, false);
}
const expectedBySkillKind = new Map();
for (const entry of expectedEntries) expectedBySkillKind.set(`${entry.skillKey}/${entry.kind}`, (expectedBySkillKind.get(`${entry.skillKey}/${entry.kind}`) ?? []).concat([entry]));
const listSummaryDiff = (item, detail) => {
  for (const [key, expected] of Object.entries(item ?? {})) {
    const actual = key === 'resultCount'
      ? Array.isArray(detail?.results) ? detail.results.length : undefined
      : key === 'lifecycleEnabled'
        ? detail?.lifecycle !== null && detail?.lifecycle !== undefined
        : detail?.[key];
    if (JSON.stringify(stable(expected)) !== JSON.stringify(stable(actual))) return {path: key, expected, actual};
  }
  return null;
};
for (const list of components.lists ?? []) {
  const idField = idFieldOf(list.kind);
  const items = Array.isArray(list.items) ? list.items : [];
  const ids = items.map(item => item[idField]);
  const unique = new Set(ids);
  check(`列表GET成功 ${list.skillKey}/${list.kind}`, list.status === 200 && unique.size === items.length && ids.every(id => typeof id === 'string'));
  const expected = expectedBySkillKind.get(`${list.skillKey}/${list.kind}`) ?? [];
  const expectedIds = new Set(expected.map(item => item.body[idField]));
  for (const item of items) {
    const key = `${list.skillKey}/${list.kind}/${item[idField]}`;
    const detail = actualByKey.get(key);
    const summaryDiff = detail ? listSummaryDiff(item, detail.data) : {path: '$', expected: 'detail', actual: 'missing'};
    listChecks.push({skillKey: list.skillKey, kind: list.kind, id: item[idField], passed: !summaryDiff, diff: summaryDiff});
    check(`列表与详情完整对应 ${key}`, !summaryDiff, summaryDiff);
    check(`列表对象在最终候选 ${key}`, expectedIds.has(item[idField]));
  }
}
const expectedMissing = new Map((components.missing ?? []).map(item => [`${item.skillKey}/${item.kind}/${item.id}`, item]));
const actualMissingKeys = new Set(missingComponents.map(item => `${item.skillKey}/${item.kind}/${item.id}`));
const expectedMissingKeys = new Set(expectedMissing.keys());
check('执行记录缺项与实际缺项一致', phase === '写后' || (actualMissingKeys.size === expectedMissingKeys.size && [...actualMissingKeys].every(key => expectedMissingKeys.has(key))), {phase, expectedMissing: expectedMissingKeys.size, actualMissing: actualMissingKeys.size});
const catalogRows = Object.fromEntries(catalogKinds.map(([name]) => [name, rows(protection.catalogs?.[name])]));
const catalogSets = {
  attributeKey: new Set(catalogRows.attributes.map(item => item.attributeKey)),
  modifierZoneKey: new Set(catalogRows['modifier-zones'].map(item => item.modifierZoneKey)),
  damageTypeKey: new Set(catalogRows['damage-types'].map(item => item.damageTypeKey)),
  statusKey: new Set(catalogRows.statuses.map(item => item.statusKey)),
};
for (const [key, value] of [['attributeKey', 'mana'], ['attributeKey', 'move_speed_percent'], ['modifierZoneKey', 'attribute_flat_add']]) {
  const item = catalogRows[key === 'attributeKey' ? 'attributes' : 'modifier-zones'].find(row => row[key] === value);
  check(`实际目录存在 ${key}=${value}`, Boolean(item) && item.status === 'ENABLED', item ?? null);
}
const walk = (value, fn, at = '$') => {
  if (!value || typeof value !== 'object') return;
  fn(value, at);
  for (const [key, child] of Object.entries(value)) {
    if (Array.isArray(child)) child.forEach((item, index) => walk(item, fn, `${at}.${key}[${index}]`));
    else if (child && typeof child === 'object') walk(child, fn, `${at}.${key}`);
  }
};
for (const entry of expectedEntries) {
  walk(entry.body, (node, at) => {
    if (node.nodeType === 'ATTRIBUTE') {
      const exists = catalogSets.attributeKey.has(node.attributeKey);
      check(`公式/效果属性目录 ${entry.skillKey}/${entry.kind}/${entry.id}${at}`, exists, node);
    }
    if (node.detail?.attributeKey) check(`效果属性目录 ${entry.skillKey}/${entry.id}${at}`, catalogSets.attributeKey.has(node.detail.attributeKey), node.detail);
    if (node.detail?.modifierZoneKey) check(`效果修正区目录 ${entry.skillKey}/${entry.id}${at}`, catalogSets.modifierZoneKey.has(node.detail.modifierZoneKey), node.detail);
    if (node.detail?.absorbedDamageTypeKey) check(`护盾伤害类别目录 ${entry.skillKey}/${entry.id}${at}`, catalogSets.damageTypeKey.has(node.detail.absorbedDamageTypeKey), node.detail);
  });
}
const spells = new Map(source.heroes.flatMap(hero => hero.spells.map(spell => [spell.skillKey, spell])));
const rootDir = dirname(source.sourceIndex);
const runtimeKeys = new Map();
const formulaActual = new Map();
for (const entry of expectedEntries.filter(item => item.kind === 'parameters')) {
  if (!runtimeKeys.has(entry.skillKey)) runtimeKeys.set(entry.skillKey, new Set());
  if (entry.body.valueMode === 'RUNTIME_INPUT') runtimeKeys.get(entry.skillKey).add(entry.id);
}
for (const entry of expectedEntries.filter(item => item.kind === 'formulas')) formulaActual.set(`${entry.skillKey}/${entry.id}`, entry);
const parameterActual = new Map();
for (const record of components.details ?? []) if (record.kind === 'parameters' && record.status === 200) parameterActual.set(`${record.skillKey}/${record.id}`, record.data);
const ops = {ADD: (a, b) => a + b, SUBTRACT: (a, b) => a - b, MULTIPLY: (a, b) => a * b, DIVIDE: (a, b) => a / b, MIN: Math.min, MAX: Math.max};
const baseAttrs = {
  'SOURCE.ability_power.TOTAL': 100,
  'SOURCE.attack_damage.TOTAL': 200,
  'SOURCE.attack_damage.BASE': 150,
  'SOURCE.attack_damage.BONUS': 50,
  'SOURCE.mana.TOTAL': 2000,
  'SOURCE.mana.BONUS': 1000,
  'SOURCE.mana.MISSING': 800,
  'SOURCE.hp.BONUS': 500,
};
const parameterValue = (skillKey, key, context) => {
  const parameter = parameterActual.get(`${skillKey}/${key}`);
  if (!parameter) throw Error(`实际参数缺失 ${skillKey}/${key}`);
  if (parameter.valueMode === 'FIXED') {
    if (parameter.fixedValue === null || parameter.fixedValue === undefined) throw Error(`固定参数没有值 ${skillKey}/${key}`);
    return parameter.fixedValue;
  }
  if (parameter.valueMode === 'SKILL_LEVEL') {
    const value = parameter.levelValues?.[String(context.rank)];
    if (value === null || value === undefined) throw Error(`技能等级参数缺少等级${context.rank} ${skillKey}/${key}`);
    return value;
  }
  if (parameter.valueMode === 'RUNTIME_INPUT') {
    if (!Object.hasOwn(context.inputs ?? {}, key)) throw Error(`缺少实际运行输入 ${skillKey}/${key}`);
    return context.inputs[key];
  }
  throw Error(`未授权参数模式 ${skillKey}/${key}/${parameter.valueMode}`);
};
const evaluate = (skillKey, node, context) => {
  if (node?.nodeType === 'PARAMETER') return parameterValue(skillKey, node.parameterKey, context);
  if (node?.nodeType === 'ATTRIBUTE') {
    const key = `${node.attributeOwner}.${node.attributeKey}.${node.attributeValueKind}`;
    if (!Object.hasOwn(context.attrs ?? {}, key)) throw Error(`缺少实际属性 ${key}`);
    return context.attrs[key];
  }
  if (node?.nodeType === 'OPERATION' && ops[node.operation] && Array.isArray(node.operands) && node.operands.length === 2) return ops[node.operation](...node.operands.map(child => evaluate(skillKey, child, context)));
  throw Error(`非法公式节点 ${JSON.stringify(node)}`);
};
const contextFromCase = row => ({rank: row.rank ?? 1, inputs: {...(row.inputs ?? {})}, attrs: {...baseAttrs, ...(row.attrs ?? {})}});
const manualCases = Array.isArray(examples.manualCases) ? examples.manualCases : [];
const distinctContexts = formulaKey => {
  const rowsForFormula = manualCases.filter(row => `${row.skillKey}/${row.formulaKey}` === formulaKey);
  const sourceRows = rowsForFormula.length ? rowsForFormula : [{rank: 1, inputs: {}, attrs: baseAttrs}];
  const seen = new Set();
  return sourceRows.map(contextFromCase).filter(context => {
    const key = JSON.stringify(context);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
const rawCalc = (skillKey, key, context, seen = []) => {
  if (seen.includes(key)) throw Error(`原计算树循环 ${skillKey}/${key}`);
  const spell = spells.get(skillKey);
  const calculation = spell?.object?.mSpell?.mSpellCalculations?.[key];
  if (!calculation) throw Error(`原计算树缺失 ${skillKey}/${key}`);
  const sourcePath = `mSpellCalculations.${key}`;
  let value;
  if (calculation.__type === 'GameCalculationModified') value = rawCalc(skillKey, calculation.mModifiedGameCalculation, context, [...seen, key]);
  else if (calculation.__type === 'GameCalculation' && calculation.mFormulaParts?.length) value = calculation.mFormulaParts.reduce((sum, node, index) => sum + rawNode(skillKey, node, context, `${sourcePath}.mFormulaParts[${index}]`), 0);
  else throw Error(`原计算种类未核 ${skillKey}/${key}`);
  if (calculation.mMultiplier) value *= rawNode(skillKey, calculation.mMultiplier, context, `${sourcePath}.mMultiplier`);
  return value;
};
const rawNode = (skillKey, node, context, sourceLocation) => {
  const spell = spells.get(skillKey)?.object?.mSpell;
  const datum = name => {
    const found = (spell?.DataValues ?? []).find(item => item.name?.toLowerCase() === name?.toLowerCase());
    if (!found?.values) throw Error(`原数据缺失 ${skillKey}/${name}`);
    return found.values[context.rank];
  };
  if (['ByCharLevelInterpolationCalculationPart', 'ByCharLevelBreakpointsCalculationPart', 'ByCharLevelFormulaCalculationPart', '{4ce08984}'].includes(node?.__type)) {
    const proof = candidate.skills[skillKey].proofs?.find(item => item.source === sourceLocation && item.parameterKey && item.sourcePending);
    if (!proof) throw Error(`等级曲线没有保持外部输入 ${skillKey}/${sourceLocation}`);
    if (!Object.hasOwn(context.inputs ?? {}, proof.parameterKey)) throw Error(`等级曲线缺少实际输入 ${skillKey}/${proof.parameterKey}`);
    return context.inputs[proof.parameterKey];
  }
  const stat = () => {
    const statId = node?.mStat ?? 0;
    const statFormula = node?.mStatFormula ?? 0;
    if (statId === 0 && statFormula === 0) return context.attrs['SOURCE.ability_power.TOTAL'];
    if (statId === 2 && statFormula === 0) return context.attrs['SOURCE.attack_damage.TOTAL'];
    if (statId === 2 && statFormula === 1) return context.attrs['SOURCE.attack_damage.BASE'];
    if (statId === 2 && statFormula === 2) return context.attrs['SOURCE.attack_damage.BONUS'];
    if (statId === 12 && statFormula === 2) return context.attrs['SOURCE.hp.BONUS'];
    throw Error(`原属性未证 ${skillKey}/${statId}/${statFormula}`);
  };
  switch (node?.__type) {
    case 'NamedDataValueCalculationPart': return datum(node.mDataValue);
    case 'NumberCalculationPart': if (!Object.hasOwn(node, 'mNumber')) throw Error(`原常数缺值 ${skillKey}`); return node.mNumber;
    case 'StatByNamedDataValueCalculationPart': return stat() * datum(node.mDataValue);
    case 'StatByCoefficientCalculationPart': return stat() * node.mCoefficient;
    case 'StatBySubPartCalculationPart': return stat() * rawNode(skillKey, node.mSubpart, context, `${sourceLocation}.mSubpart`);
    case 'SumOfSubPartsCalculationPart': if (!node.mSubparts?.length) throw Error(`原求和为空 ${skillKey}`); return node.mSubparts.reduce((sum, child, index) => sum + rawNode(skillKey, child, context, `${sourceLocation}.mSubparts[${index}]`), 0);
    case 'ProductOfSubPartsCalculationPart': return rawNode(skillKey, node.mPart1, context, `${sourceLocation}.mPart1`) * rawNode(skillKey, node.mPart2, context, `${sourceLocation}.mPart2`);
    default: throw Error(`原节点未核 ${skillKey}/${node?.__type}`);
  }
};
for (const hero of source.heroes) {
  try {
    const compressed = fs.readFileSync(resolve(rootDir, hero.client.path));
    const raw = gunzipSync(compressed);
    const official = fs.readFileSync(resolve(rootDir, hero.official.path));
    check(`${hero.id}客户端压缩原文冻结`, sha256(compressed) === hero.client.compressedSha256 && sha256(raw) === hero.client.sha256);
    check(`${hero.id}官方原文冻结`, sha256(official) === hero.official.sha256);
    const object = JSON.parse(raw);
    for (const spell of hero.spells) check(`${spell.skillKey}根绑定完整`, stable(object[spell.binding]) && JSON.stringify(stable(object[spell.binding])) === JSON.stringify(stable(spell.object)));
  } catch (error) {
    failures.push({name: `${hero.id}来源完整性`, details: String(error.message ?? error)});
  }
}
for (const formulaEntry of expectedEntries.filter(item => item.kind === 'formulas')) {
  const formulaId = `${formulaEntry.skillKey}/${formulaEntry.id}`;
  const actualFormula = formulaEntry && actualByKey.get(`${formulaEntry.skillKey}/formulas/${formulaEntry.id}`);
  if (!actualFormula?.data?.expression) {
    formulaChecks.push({formulaKey: formulaId, status: 'MISSING_COMPONENT', passed: null, actualStatus: actualFormula?.status ?? null});
    continue;
  }
  const formula = actualFormula.data;
  const nodeErrors = [];
  walk(formula.expression, (node, at) => {
    if (!node.nodeType) return;
    if (!['PARAMETER', 'ATTRIBUTE', 'OPERATION'].includes(node.nodeType)) nodeErrors.push({at, nodeType: node.nodeType});
    if (node.nodeType === 'PARAMETER' && !parameterActual.has(`${formulaEntry.skillKey}/${node.parameterKey}`)) nodeErrors.push({at, missingParameter: node.parameterKey});
    if (node.nodeType === 'ATTRIBUTE' && !catalogSets.attributeKey.has(node.attributeKey)) nodeErrors.push({at, missingAttribute: node.attributeKey});
  });
  check(`实际公式节点和引用 ${formulaId}`, nodeErrors.length === 0, nodeErrors);
  const contexts = distinctContexts(formulaId);
  const proof = candidate.skills[formulaEntry.skillKey].proofs?.find(item => item.formulaKey === formulaEntry.id && item.source?.startsWith('mSpellCalculations.'));
  if (!proof) check(`公式原树证明 ${formulaId}`, false);
  for (const context of contexts) {
    let apiValue;
    let sourceValue;
    let error = null;
    let sourceError = null;
    try { apiValue = evaluate(formulaEntry.skillKey, formula.expression, context); } catch (reason) { error = String(reason.message ?? reason); }
    if (proof && !error) {
      try { sourceValue = rawCalc(formulaEntry.skillKey, proof.source.slice('mSpellCalculations.'.length), context); } catch (reason) { sourceError = String(reason.message ?? reason); }
    }
    const missingInput = Boolean(error && error.includes('缺少实际运行输入')) || Boolean(sourceError && sourceError.includes('缺少实际输入'));
    if (missingInput) {
      inputRejections.push({formulaKey: formulaId, rank: context.rank, reason: error ?? sourceError});
      formulaChecks.push({formulaKey: formulaId, rank: context.rank, status: 'MISSING_INPUT_REJECTED', passed: true, apiValue: null, sourceValue: null, error: error ?? sourceError});
      continue;
    }
    const passed = !error && !sourceError && close(apiValue, sourceValue);
    formulaChecks.push({formulaKey: formulaId, rank: context.rank, status: passed ? 'PASSED' : 'FAILED', passed, apiValue, sourceValue, error, sourceError, inputs: context.inputs, attrs: context.attrs});
    check(`实际参数公式与原树 ${formulaId}#${formulaChecks.length}`, passed, formulaChecks.at(-1));
    const reference = manualCases.find(row => `${row.skillKey}/${row.formulaKey}` === formulaId && (row.rank ?? 1) === context.rank && JSON.stringify(row.inputs ?? {}) === JSON.stringify(context.inputs ?? {}));
    if (reference && Number.isFinite(reference.expected)) {
      const referencePassed = close(apiValue, reference.expected);
      check(`冻结算例交叉 ${formulaId}#${formulaChecks.length}`, referencePassed, {actual: apiValue, expected: reference.expected});
    }
    sourceChecks.push({formulaKey: formulaId, rank: context.rank, passed, apiValue, sourceValue});
  }
}
for (const [skillKey, runtime] of runtimeKeys) {
  for (const key of runtime) {
    const used = [...formulaActual.values()].some(formula => formula.skillKey === skillKey && JSON.stringify(formula.body.expression).includes(key));
    if (!used) notes.push(`${skillKey}/${key}是外供参数，当前没有公式消费；没有为它制造直通公式。`);
  }
}
for (const entry of expectedEntries.filter(item => item.kind === 'effects')) {
  for (const result of entry.body.results ?? []) {
    check(`效果不默认伤害或直接治疗 ${entry.skillKey}/${entry.id}/${result.resultKey}`, !['DAMAGE', 'DIRECT_HEAL'].includes(result.resultType));
  }
}
const expectedFull = phase === '写后' ? 219 : 28;
const successfulDetails = [...actualByKey.values()].filter(record => record.status === 200).length;
check(`${phase}详情数量`, successfulDetails === expectedFull, {successfulDetails, expectedFull});
if (phase === '写前' && missingComponents.length !== 191) notes.push(`当前是写前预检，191项新增组件尚未落地；不对缺项虚报数学通过。`);
if (phase === '写后' && missingComponents.length > 0) check('写后没有缺失组件', false, {missing: missingComponents});
if (phase === '写前' && execution.apiWrites !== 0) check('写前执行记录没有业务写入', false, {apiWrites: execution.apiWrites});
if (phase === '写后' && execution.apiWrites > 191) check('写后写入数量不超过191', false, {apiWrites: execution.apiWrites});
const status = failures.length
  ? 'REVISE'
  : missingComponents.length
    ? 'WAITING_FOR_COMPONENTS'
    : 'READY_FOR_INDEPENDENT_REVIEW';
const outputPath = path.resolve(argValue(args, '--out') ?? path.join(runDir, '实际读后数学核算.json'));
const relativeOutput = path.relative(batchDir, outputPath);
if (relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput)) throw Error('数学结果只能写入第十五批目录');
const report = {
  at: new Date().toISOString(),
  status,
  phase,
  runId: execution.runId,
  candidateSha256: expectedCandidateSha256,
  planSha256: expectedPlanSha256,
  originalSnapshotSha256: expectedOriginalSnapshotSha256,
  sourceVersion: 'client16.17/official16.17.1',
  scope: '读取实际参数、公式、效果详情后独立求值；与冻结客户端原树和明确算例交叉核对。未知输入拒绝求值，不代表战斗运行通过。',
  checks: checks.length,
  failedChecks: failures.length,
  failures,
  readback: {phase, successfulDetails, expectedFull, missingComponents, fullComparisons, listChecks},
  formulas: {total: expectedEntries.filter(item => item.kind === 'formulas').length, checks: formulaChecks, sourceChecks, inputRejections},
  requiredCatalogReferences: [
    {catalogKey: 'attributeKey', value: 'mana', present: catalogRows.attributes.some(item => item.attributeKey === 'mana' && item.status === 'ENABLED')},
    {catalogKey: 'attributeKey', value: 'move_speed_percent', present: catalogRows.attributes.some(item => item.attributeKey === 'move_speed_percent' && item.status === 'ENABLED')},
    {catalogKey: 'modifierZoneKey', value: 'attribute_flat_add', present: catalogRows['modifier-zones'].some(item => item.modifierZoneKey === 'attribute_flat_add' && item.status === 'ENABLED')},
  ],
  notes: [...new Set(notes)],
};
await fsp.writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({status, phase, runId: execution.runId, checks: checks.length, failedChecks: failures.length, successfulDetails, missingComponents: missingComponents.length, formulaChecks: formulaChecks.length, inputRejections: inputRejections.length, output: outputPath}));
if (failures.length) process.exitCode = 1;
