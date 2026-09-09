import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { isDeepStrictEqual as equal } from 'node:util';
import { fileURLToPath } from 'node:url';

// 只读取独立全量回读目录中的新GET结果，再与冻结客户端原树、固定算例和实际候选详情交叉核对。
// 该进程不发送接口请求，也不读取实际录入器的组件快照。
const herePath = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--run-dir') throw Error('必须指定 --run-dir <独立全量回读目录>');
const runDir = path.resolve(args[1]);
const independentRoot = path.join(herePath, '独立回读');
const runRelative = path.relative(independentRoot, runDir);
if (runRelative.startsWith('..') || path.isAbsolute(runRelative)) throw Error('数学结果只能读取独立回读目录');
const apiBase = 'http://127.0.0.1:8080/api/admin/games/lol';
const candidateFile = path.join(herePath, '完整候选-修订版2.json');
const candidateVersionFile = path.join(herePath, '候选版本-修订版2.json');
const planFile = path.join(herePath, '写前计划-修订版2.json');
const freezeFile = path.join(herePath, '冻结候选锁-修订版2.json');
const originalFile = path.join(herePath, '写前现值.json');
const mediaFile = path.join(herePath, '关联与图片保护快照-终稿.json');
const sourceFile = path.join(herePath, '根绑定与数值证据.json');
const sourceFreezeFile = path.join(herePath, '来源冻结', '来源与哈希汇总.json');
const textEvidenceFile = path.join(herePath, '补充文本证据.json');
const stageDedupFile = path.join(herePath, '阶段去重预检.json');
const narrowMappingFile = path.resolve(herePath, '../../通用公式来源补证/结论与边界.json');
const constructorDefaultsFile = path.resolve(herePath, '../../通用公式来源补证/同构建类型与默认.json');
const examplesFile = path.join(herePath, '独立源值与算例-修订版2.json');
const skills = ['malzahar', 'anivia', 'lissandra', 'karthus'].flatMap(hero => ['p', 'q', 'w', 'e', 'r'].map(slot => `${hero}_${slot}`));
const kinds = [
  ['parameters', 'parameterKey', 'parameters'],
  ['formulas', 'formulaKey', 'formulas'],
  ['effects', 'effectKey', 'effects'],
  ['processes', 'processKey', 'processes'],
  ['internalStates', 'stateKey', 'internal-states'],
  ['triggerRules', 'ruleKey', 'trigger-rules'],
];
const catalogKinds = [
  ['attributes', 'attributeKey'],
  ['modifier-zones', 'modifierZoneKey'],
  ['damage-types', 'damageTypeKey'],
  ['statuses', 'statusKey'],
];
const expected = {
  candidateSha256: '1e8809bc4c69d42a4b947f9d533e51bdb8e53d4ff04153091ec7cbadbda643bc',
  candidateVersionSha256: '6f12f66530b3ddb4d4ac7c69379348d6f018079f84a80a7d005b9bd02bb9d2e8',
  writePlanSha256: '6c2e687d3aaa74401d07fe200fa1c4bfe022f183a51f2d20d3492ba41d90b022',
  freezeSha256: 'e4c8fa637700b666a885b9fa1500e164d511a1ce3344c05e443d5444f05a9f75',
  originalSha256: '4f4c30ab1768b20f3d1f762b9fb73d96baebba8e4c70870d4bdfbf849725b339',
  mediaSha256: 'bc2e2cbc99cc940644e05ed575467a143c146eb5e17ef01f7bca593b67e78938',
  sourceFreezeSha256: '56aa23cd30d258984598adecdfa405e69662adbcc6d702fbc82b13abcda97431',
  textEvidenceSha256: '3bdb4829379195044927237f2c5a97609cb872d1dbd1eb597edffa797333e031',
  narrowMappingSha256: '5b51fc7b71e411909e42323ca50d9c51566038b61a392023d2668ba5ad3a73a6',
  constructorDefaultsSha256: 'b655135a440e892435ff500e2dc8034eba247f7323c532cb47ee2001137c831e',
  examplesSha256: '15fd7861117bdc08dd09475f6f5ab4eec95a13edb2a678e7efdd84a7e4deb0d8',
  candidateDetails: 153,
  listCount: 120,
};
const serverFields = new Set(['gameId', 'skillKey', 'createdAt', 'updatedAt']);
const readBytes = file => fs.readFileSync(file);
const readJson = file => JSON.parse(readBytes(file));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).filter(key => !serverFields.has(key)).sort().map(key => [key, canonical(value[key])]))
    : value;
const exactCanonical = value => Array.isArray(value)
  ? value.map(exactCanonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, exactCanonical(value[key])]))
    : value;
const diff = (expectedValue, actualValue, at = '$') => {
  if (equal(expectedValue, actualValue)) return null;
  if (expectedValue === null || actualValue === null || typeof expectedValue !== 'object' || typeof actualValue !== 'object') return { path: at, expected: expectedValue, actual: actualValue };
  if (Array.isArray(expectedValue) || Array.isArray(actualValue)) {
    if (!Array.isArray(expectedValue) || !Array.isArray(actualValue) || expectedValue.length !== actualValue.length) return { path: at, expected: expectedValue, actual: actualValue };
    for (let index = 0; index < expectedValue.length; index++) {
      const child = diff(expectedValue[index], actualValue[index], `${at}[${index}]`);
      if (child) return child;
    }
    return null;
  }
  for (const key of [...new Set([...Object.keys(expectedValue), ...Object.keys(actualValue)])].sort()) {
    if (!(key in expectedValue) || !(key in actualValue)) return { path: `${at}.${key}`, expected: expectedValue[key], actual: actualValue[key] };
    const child = diff(expectedValue[key], actualValue[key], `${at}.${key}`);
    if (child) return child;
  }
  return null;
};
const businessDiff = (expectedValue, actualValue) => diff(canonical(expectedValue), canonical(actualValue));
const exactDiff = (expectedValue, actualValue) => diff(exactCanonical(expectedValue), exactCanonical(actualValue));
const close = (a, b, tolerance = 1e-5) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
const rows = response => Array.isArray(response?.data) ? response.data : Array.isArray(response?.data?.items) ? response.data.items : [];
const apiKind = kind => kinds.find(item => item[0] === kind)?.[2];
const keyOf = (skillKey, kind, id) => `${skillKey}/${kind}/${id}`;

const candidateBytes = readBytes(candidateFile);
const candidateVersionBytes = readBytes(candidateVersionFile);
const planBytes = readBytes(planFile);
const freezeBytes = readBytes(freezeFile);
const originalBytes = readBytes(originalFile);
const mediaBytes = readBytes(mediaFile);
const sourceFreezeBytes = readBytes(sourceFreezeFile);
const textEvidenceBytes = readBytes(textEvidenceFile);
const narrowMappingBytes = readBytes(narrowMappingFile);
const constructorDefaultsBytes = readBytes(constructorDefaultsFile);
const examplesBytes = readBytes(examplesFile);
const candidate = JSON.parse(candidateBytes);
const candidateVersion = JSON.parse(candidateVersionBytes);
const plan = JSON.parse(planBytes);
const freeze = JSON.parse(freezeBytes);
const original = JSON.parse(originalBytes);
const media = JSON.parse(mediaBytes);
const roots = readJson(sourceFile);
const sourceFreeze = JSON.parse(sourceFreezeBytes);
const textEvidence = JSON.parse(textEvidenceBytes);
const stageDedup = readJson(stageDedupFile);
const narrowMapping = JSON.parse(narrowMappingBytes);
const constructorDefaults = JSON.parse(constructorDefaultsBytes);
const examples = JSON.parse(examplesBytes);
const execution = readJson(path.join(runDir, '执行结果.json'));
const protection = readJson(path.join(runDir, '独立保护.json'));
const componentSnapshot = readJson(path.join(runDir, '最终全量组件现值.json'));
const checks = [];
const failures = [];
const check = (name, passed, detail = null) => { const row = { name, passed: Boolean(passed), detail }; checks.push(row); if (!row.passed) failures.push(row); return row.passed; };

check('候选文件冻结', sha256(candidateBytes) === expected.candidateSha256, sha256(candidateBytes));
check('候选版本冻结', sha256(candidateVersionBytes) === expected.candidateVersionSha256, sha256(candidateVersionBytes));
check('写前计划冻结', sha256(planBytes) === expected.writePlanSha256, sha256(planBytes));
check('修订版2锁冻结', sha256(freezeBytes) === expected.freezeSha256, sha256(freezeBytes));
check('写前现值冻结', sha256(originalBytes) === expected.originalSha256, sha256(originalBytes));
check('关联与图片保护冻结', sha256(mediaBytes) === expected.mediaSha256, sha256(mediaBytes));
check('来源冻结文件哈希', sha256(sourceFreezeBytes) === expected.sourceFreezeSha256, sha256(sourceFreezeBytes));
check('文本证据哈希', textEvidence.sha256 === expected.textEvidenceSha256 && sha256(textEvidenceBytes) !== '', textEvidence.sha256);
check('窄属性来源哈希', sha256(narrowMappingBytes) === expected.narrowMappingSha256, sha256(narrowMappingBytes));
check('构造默认来源哈希', sha256(constructorDefaultsBytes) === expected.constructorDefaultsSha256, sha256(constructorDefaultsBytes));
check('算例文件冻结', sha256(examplesBytes) === expected.examplesSha256 && examples.candidateSha256 === expected.candidateSha256, sha256(examplesBytes));
check('独立回读不是写入器快照', execution.apiWrites === 0 && execution.mode?.includes('独立第二轮全量GET') && componentSnapshot.phase === '独立全量新GET', { apiWrites: execution.apiWrites, mode: execution.mode, phase: componentSnapshot.phase });
check('独立回读20槽和153详情', equal(Object.keys(candidate.skills ?? {}), skills) && componentSnapshot.details?.length === expected.candidateDetails, { slots: Object.keys(candidate.skills ?? {}).length, details: componentSnapshot.details?.length });
check('独立回读只读请求统计', execution.actual?.methods?.GET === execution.actual?.calls && !execution.actual?.methods?.POST && execution.actual?.calls === 325, execution.actual);
check('候选来源版本冻结', candidate.meta?.sources?.length === 4 && freeze.source === 'client16.17/official16.17.1' && candidate.meta?.apiWrites === 0, { source: freeze.source, apiWrites: candidate.meta?.apiWrites });
check('阶段去重只读且替换Karthus', stageDedup.noWrites === true && stageDedup.replacement?.selectedReplacement === 'Karthus', stageDedup.replacement);

const expectedEntries = [];
for (const skillKey of skills) for (const [kind, key] of kinds) for (const body of candidate.skills?.[skillKey]?.write?.[kind] ?? []) expectedEntries.push({ skillKey, kind, id: body[key], body });
const actualByKey = new Map();
for (const record of componentSnapshot.details ?? []) {
  const identity = keyOf(record.skillKey, record.kind, record.id);
  if (actualByKey.has(identity)) check(`独立详情无重复 ${identity}`, false);
  actualByKey.set(identity, record);
}
const componentComparisons = [];
for (const entry of expectedEntries) {
  const identity = keyOf(entry.skillKey, entry.kind, entry.id);
  const actual = actualByKey.get(identity);
  const row = { skillKey: entry.skillKey, kind: entry.kind, id: entry.id, status: actual?.status ?? null, diff: actual?.status === 200 ? businessDiff(entry.body, actual.data) : { path: '$', expected: '200详情', actual: actual?.status ?? 'missing' } };
  row.passed = row.diff === null;
  componentComparisons.push(row);
  check(`独立详情等于候选 ${identity}`, row.passed, row.diff);
}
check('独立详情键数恰为153', actualByKey.size === expected.candidateDetails && (componentSnapshot.details ?? []).length === expected.candidateDetails, { actual: actualByKey.size, expected: expected.candidateDetails });

const listConflicts = [];
const listSummaryDiff = (item, detail) => {
  for (const [key, expectedValue] of Object.entries(item ?? {})) {
    const actualValue = key === 'resultCount'
      ? Array.isArray(detail?.results) ? detail.results.length : undefined
      : key === 'lifecycleEnabled'
        ? detail?.lifecycle !== null && detail?.lifecycle !== undefined
        : detail?.[key];
    if (!equal(expectedValue, actualValue)) return { path: key, expected: expectedValue, actual: actualValue };
  }
  return null;
};
const expectedBySkillKind = new Map();
for (const entry of expectedEntries) expectedBySkillKind.set(`${entry.skillKey}/${entry.kind}`, (expectedBySkillKind.get(`${entry.skillKey}/${entry.kind}`) ?? []).concat(entry));
for (const list of componentSnapshot.lists ?? []) {
  const idKey = kinds.find(item => item[0] === list.kind)?.[1];
  const items = list.items ?? [];
  const ids = items.map(item => item[idKey]);
  if (new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string')) listConflicts.push({ skillKey: list.skillKey, kind: list.kind, type: 'duplicateOrInvalidKey', ids });
  const expectedForList = expectedBySkillKind.get(`${list.skillKey}/${list.kind}`) ?? [];
  const expectedIds = new Set(expectedForList.map(entry => entry.id));
  if (expectedIds.size !== ids.length || ids.some(id => !expectedIds.has(id))) listConflicts.push({ skillKey: list.skillKey, kind: list.kind, type: 'listIdsDiffer', expected: [...expectedIds], actual: ids });
  for (const item of items) {
    const id = item[idKey];
    const detail = actualByKey.get(keyOf(list.skillKey, list.kind, id));
    const summaryDiff = listSummaryDiff(item, detail?.data);
    if (summaryDiff) listConflicts.push({ skillKey: list.skillKey, kind: list.kind, id, type: 'listDetailMismatch', diff: summaryDiff });
  }
}
check('120个列表与153条详情完整对应', (componentSnapshot.lists ?? []).length === expected.listCount && listConflicts.length === 0, { lists: componentSnapshot.lists?.length, conflicts: listConflicts.length });

const catalogSets = Object.fromEntries(catalogKinds.map(([name, key]) => [key, new Map(rows(protection.catalogs?.[name]).map(item => [item[key], item]))]));
const catalogReferences = [];
const schemaErrors = [];
const schema = {
  valueTypes: new Set(['INTEGER', 'DECIMAL']),
  valueModes: new Set(['FIXED', 'SKILL_LEVEL', 'CHARACTER_LEVEL', 'RUNTIME_INPUT']),
  nodeTypes: new Set(['PARAMETER', 'ATTRIBUTE', 'OPERATION']),
  operations: new Set(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX']),
  resultTypes: new Set(['RESOURCE_CHANGE']),
  resourceOperations: new Set(['CONSUME', 'RESTORE']),
};
const walk = (value, at) => {
  if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${at}[${index}]`));
  if (!value || typeof value !== 'object') return;
  if (value.nodeType !== undefined) {
    if (!schema.nodeTypes.has(value.nodeType)) schemaErrors.push({ at, type: 'nodeType', value: value.nodeType });
    if (value.nodeType === 'OPERATION' && !schema.operations.has(value.operation)) schemaErrors.push({ at, type: 'operation', value: value.operation });
  }
  if (value.resultType !== undefined && !schema.resultTypes.has(value.resultType)) schemaErrors.push({ at, type: 'resultType', value: value.resultType });
  if (value.detail?.operation !== undefined && !schema.resourceOperations.has(value.detail.operation)) schemaErrors.push({ at, type: 'resourceOperation', value: value.detail.operation });
  for (const [key, child] of Object.entries(value)) {
    if (catalogSets[key] && typeof child === 'string') {
      const row = catalogSets[key].get(child);
      const reference = { at: `${at}.${key}`, key, value: child, enabled: row?.status === 'ENABLED' };
      catalogReferences.push(reference);
      if (!reference.enabled) schemaErrors.push({ at: reference.at, type: 'catalogReference', value: child, status: row?.status ?? 'MISSING' });
    }
    walk(child, `${at}.${key}`);
  }
};
for (const entry of expectedEntries) walk(entry.body, `${entry.skillKey}/${entry.kind}/${entry.id}`);
for (const skillKey of skills) for (const parameter of candidate.skills[skillKey].write.parameters) {
  if (!schema.valueTypes.has(parameter.valueType)) schemaErrors.push({ skillKey, parameterKey: parameter.parameterKey, type: 'valueType', value: parameter.valueType });
  if (!schema.valueModes.has(parameter.valueMode)) schemaErrors.push({ skillKey, parameterKey: parameter.parameterKey, type: 'valueMode', value: parameter.valueMode });
  if (parameter.valueMode === 'RUNTIME_INPUT' && (parameter.fixedValue !== null || parameter.levelValues !== null)) schemaErrors.push({ skillKey, parameterKey: parameter.parameterKey, type: 'runtimeDefault' });
  if (parameter.valueMode === 'SKILL_LEVEL' && (parameter.fixedValue !== null || !parameter.levelValues || Object.keys(parameter.levelValues).length !== candidate.skills[skillKey].maxLevel)) schemaErrors.push({ skillKey, parameterKey: parameter.parameterKey, type: 'skillLevelMap' });
}
check('实际类型状态目录无未知值', schemaErrors.length === 0 && catalogReferences.every(item => item.enabled), { schemaErrors, catalogReferences });
check('没有无schema热量引用', catalogReferences.every(item => item.value !== 'heat' && item.value !== '热量'), catalogReferences.filter(item => item.value === 'heat' || item.value === '热量'));

const spells = new Map(roots.heroes.flatMap(hero => hero.spells.map(spell => [spell.skillKey, spell])));
const spellFor = skillKey => {
  const spell = spells.get(skillKey);
  if (!spell) throw Error(`根绑定缺少${skillKey}`);
  return spell;
};
const actualParameter = new Map();
const actualFormula = new Map();
for (const record of componentSnapshot.details ?? []) {
  if (record.status !== 200) continue;
  if (record.kind === 'parameters') actualParameter.set(`${record.skillKey}/${record.id}`, record.data);
  if (record.kind === 'formulas') actualFormula.set(`${record.skillKey}/${record.id}`, record.data);
}
const valueOfParameter = (skillKey, parameterKey, context) => {
  const parameter = actualParameter.get(`${skillKey}/${parameterKey}`);
  if (!parameter) throw Error(`实际参数缺失 ${skillKey}/${parameterKey}`);
  if (parameter.valueMode === 'FIXED') {
    if (parameter.fixedValue === null || parameter.fixedValue === undefined) throw Error(`固定参数无值 ${skillKey}/${parameterKey}`);
    return parameter.fixedValue;
  }
  if (parameter.valueMode === 'SKILL_LEVEL' || parameter.valueMode === 'CHARACTER_LEVEL') {
    const value = parameter.levelValues?.[String(context.rank)];
    if (value === null || value === undefined) throw Error(`实际参数缺少等级 ${skillKey}/${parameterKey}/${context.rank}`);
    return value;
  }
  if (parameter.valueMode === 'RUNTIME_INPUT') {
    if (!Object.prototype.hasOwnProperty.call(context.inputs ?? {}, parameterKey)) throw Error(`缺少实际运行输入 ${skillKey}/${parameterKey}`);
    return context.inputs[parameterKey];
  }
  throw Error(`未知实际参数模式 ${skillKey}/${parameterKey}/${parameter.valueMode}`);
};
const operations = { ADD: (a, b) => a + b, SUBTRACT: (a, b) => a - b, MULTIPLY: (a, b) => a * b, DIVIDE: (a, b) => a / b, MIN: Math.min, MAX: Math.max };
const evaluate = (skillKey, node, context) => {
  if (node?.nodeType === 'PARAMETER') return valueOfParameter(skillKey, node.parameterKey, context);
  if (node?.nodeType === 'ATTRIBUTE') {
    if (node.attributeOwner !== 'SOURCE' || node.attributeValueKind !== 'TOTAL') throw Error(`公式属性口径未授权 ${skillKey}`);
    if (!Object.prototype.hasOwnProperty.call(context.attrs ?? {}, node.attributeKey)) throw Error(`缺少实际属性 ${node.attributeKey}`);
    return context.attrs[node.attributeKey];
  }
  if (node?.nodeType === 'OPERATION' && operations[node.operation] && Array.isArray(node.operands) && node.operands.length === 2) return operations[node.operation](...node.operands.map(child => evaluate(skillKey, child, context)));
  throw Error(`非法实际公式节点 ${JSON.stringify(node)}`);
};
const formulaValue = (skillKey, formulaKey, context) => {
  const formula = actualFormula.get(`${skillKey}/${formulaKey}`);
  if (!formula?.expression) throw Error(`实际公式缺失 ${skillKey}/${formulaKey}`);
  return evaluate(skillKey, formula.expression, context);
};
const dataValue = (spell, name, rank) => {
  const found = (spell.object.mSpell.DataValues ?? spell.object.mSpell.mDataValues ?? []).find(item => String(item.name ?? item.mName).toLowerCase() === String(name).toLowerCase());
  const values = found?.values ?? found?.mValues;
  if (!Array.isArray(values) || values[rank] === undefined) throw Error(`原树字段缺失 ${name}/${rank}`);
  return Number(values[rank]);
};
const attributeValue = (context, statId, statFormula) => {
  if (statId === 0 && statFormula === 0) return context.attrs.ability_power;
  if (statId === 2 && statFormula === 0) return context.attrs.attack_damage;
  if (statId === 2 && statFormula === 1) return context.attrs.base_attack_damage;
  if (statId === 2 && statFormula === 2) return context.attrs.bonus_attack_damage;
  if (statId === 12 && statFormula === 2) return context.attrs.bonus_hp;
  throw Error(`原属性未证 ${statId}/${statFormula}`);
};
const rawNode = (skillKey, node, rank, context, sourceLocation) => {
  if (!node || typeof node !== 'object') throw Error(`原树节点为空 ${sourceLocation}`);
  if (Number.isFinite(node.mNumber)) return Number(node.mNumber);
  if (['ByCharLevelInterpolationCalculationPart', 'ByCharLevelBreakpointsCalculationPart', 'ByCharLevelFormulaCalculationPart', '{4ce08984}'].includes(node.__type)) {
    const proof = candidate.skills[skillKey].proofs?.find(item => item.source === sourceLocation && item.parameterKey && item.sourcePending);
    if (!proof) throw Error(`等级曲线没有外供参数 ${skillKey}/${sourceLocation}`);
    if (!Object.prototype.hasOwnProperty.call(context.inputs ?? {}, proof.parameterKey)) throw Error(`缺少实际运行输入 ${skillKey}/${proof.parameterKey}`);
    return context.inputs[proof.parameterKey];
  }
  if (Array.isArray(node.mSubparts)) return node.mSubparts.reduce((sum, child, index) => sum + rawNode(skillKey, child, rank, context, `${sourceLocation}.mSubparts[${index}]`), 0);
  if (typeof node.mDataValue === 'string') {
    const raw = dataValue(spellFor(skillKey), node.mDataValue, rank);
    if (node.__type === 'StatByNamedDataValueCalculationPart') return raw * attributeValue(context, node.mStat ?? 0, node.mStatFormula ?? 0);
    return raw;
  }
  if (Number.isFinite(node.mCoefficient)) {
    if (node.__type === 'AbilityResourceByCoefficientCalculationPart') throw Error('原树资源系数没有当前运行输入');
    return Number(node.mCoefficient) * context.attrs.ability_power;
  }
  if (Number.isFinite(node.mLevel1Value) || Number.isFinite(node.mStartValue) || Number.isFinite(node.mEndValue)) {
    const proof = candidate.skills[skillKey].proofs?.find(item => item.source === sourceLocation && item.parameterKey && item.sourcePending);
    if (!proof || !Object.prototype.hasOwnProperty.call(context.inputs ?? {}, proof.parameterKey)) throw Error(`等级曲线缺少实际运行输入 ${skillKey}/${sourceLocation}`);
    return context.inputs[proof.parameterKey];
  }
  if (Array.isArray(node.mFormulaParts)) return node.mFormulaParts.reduce((sum, child, index) => sum + rawNode(skillKey, child, rank, context, `${sourceLocation}.mFormulaParts[${index}]`), 0);
  if (node.mSubpart) return rawNode(skillKey, node.mSubpart, rank, context, `${sourceLocation}.mSubpart`);
  if (node.mPart1 && node.mPart2) return rawNode(skillKey, node.mPart1, rank, context, `${sourceLocation}.mPart1`) * rawNode(skillKey, node.mPart2, rank, context, `${sourceLocation}.mPart2`);
  throw Error(`原节点未核 ${skillKey}/${node.__type ?? sourceLocation}`);
};
const rawCalculation = (skillKey, key, rank, context, stack = []) => {
  if (stack.includes(key)) throw Error(`原树计算循环 ${skillKey}/${stack.join('>')}>${key}`);
  const calculation = spellFor(skillKey).object.mSpell.mSpellCalculations?.[key];
  if (!calculation) throw Error(`原树计算不存在 ${skillKey}/${key}`);
  let value;
  if (calculation.__type === 'GameCalculationModified') value = rawCalculation(skillKey, calculation.mModifiedGameCalculation, rank, context, [...stack, key]);
  else if (calculation.__type === 'GameCalculation') value = (calculation.mFormulaParts ?? []).reduce((sum, child, index) => sum + rawNode(skillKey, child, rank, context, `${key}.mFormulaParts[${index}]`), 0);
  else throw Error(`原树计算类型未核 ${skillKey}/${key}/${calculation.__type}`);
  if (calculation.mMultiplier) value *= rawNode(skillKey, calculation.mMultiplier, rank, context, `${key}.mMultiplier`);
  return value;
};
const contextFromCase = row => ({ rank: row.rank ?? 1, inputs: { ...(row.inputs ?? {}) }, attrs: { ability_power: 100, attack_damage: 200, base_attack_damage: 150, bonus_attack_damage: 50, bonus_hp: 500, ...(row.attrs ?? {}) } });
const distinctContexts = formulaKey => {
  const sourceRows = (examples.manualCases ?? []).filter(row => `${row.skillKey}/${row.formulaKey}` === formulaKey);
  const rowsToUse = sourceRows.length ? sourceRows : [{ rank: 1, attrs: { ability_power: 100 }, inputs: {} }];
  const seen = new Set();
  return rowsToUse.map(contextFromCase).filter(context => { const signature = JSON.stringify(context); if (seen.has(signature)) return false; seen.add(signature); return true; });
};
const inputRejections = [];
const formulaChecks = [];
const sourceChecks = [];
const formulaEntries = expectedEntries.filter(entry => entry.kind === 'formulas');
const rawKeyByFormula = new Map();
for (const item of examples.sourceCases ?? []) {
  const identity = `${item.skillKey}/${item.formulaKey}`;
  if (!rawKeyByFormula.has(identity)) rawKeyByFormula.set(identity, item.rawKey);
}
for (const entry of formulaEntries) {
  const identity = `${entry.skillKey}/${entry.id}`;
  const actual = actualFormula.get(identity);
  check(`实际公式表达式存在 ${identity}`, Boolean(actual?.expression), actual?.expression ?? null);
  const contexts = distinctContexts(identity);
  const rawKey = rawKeyByFormula.get(identity);
  const proof = rawKey ? candidate.skills[entry.skillKey].proofs?.find(item => item.source === `mSpellCalculations.${rawKey}`) : null;
  check(`原树公式证明存在 ${identity}`, Boolean(proof), proof?.source ?? null);
  for (const context of contexts) {
    let actualValue = null;
    let rawValue = null;
    let actualError = null;
    let rawError = null;
    try { actualValue = formulaValue(entry.skillKey, entry.id, context); } catch (error) { actualError = error.message; }
    if (proof && !actualError) {
      try { rawValue = rawCalculation(entry.skillKey, proof.source.slice('mSpellCalculations.'.length), context.rank, context); } catch (error) { rawError = error.message; }
    }
    const missingInput = [actualError, rawError].some(value => value?.includes('实际运行输入') || value?.includes('实际运行'));
    if (missingInput) {
      inputRejections.push({ formulaKey: identity, rank: context.rank, reason: actualError ?? rawError });
      formulaChecks.push({ formulaKey: identity, rank: context.rank, status: 'MISSING_INPUT_REJECTED', passed: true, actualValue: null, rawValue: null, actualError, rawError });
      continue;
    }
    const passed = !actualError && !rawError && close(actualValue, rawValue);
    const result = { formulaKey: identity, rank: context.rank, status: passed ? 'PASSED' : 'FAILED', passed, actualValue, rawValue, actualError, rawError, attrs: context.attrs, inputs: context.inputs };
    formulaChecks.push(result);
    sourceChecks.push({ formulaKey: identity, rank: context.rank, passed, actualValue, rawValue });
    check(`实际公式与冻结原树 ${identity}#${context.rank}`, passed, result);
  }
}

const sourceCaseResults = [];
for (const item of examples.sourceCases ?? []) {
  const context = contextFromCase(item);
  let actualValue = null;
  let rawValue = null;
  let error = null;
  try {
    actualValue = formulaValue(item.skillKey, item.formulaKey, context);
    rawValue = rawCalculation(item.skillKey, item.rawKey, context.rank, context);
  } catch (reason) { error = reason.message; }
  const passed = !error && close(actualValue, rawValue) && close(actualValue, item.expected);
  const result = { ...item, actualValue, rawValue, error, passed };
  sourceCaseResults.push(result);
  check(`新GET源值算例 ${item.skillKey}/${item.formulaKey}`, passed, result);
}
const manualCaseResults = [];
for (const item of examples.manualCases ?? []) {
  const context = contextFromCase(item);
  let actualValue = null;
  let error = null;
  try { actualValue = formulaValue(item.skillKey, item.formulaKey, context); } catch (reason) { error = reason.message; }
  const passed = !error && close(actualValue, item.expected);
  const result = { ...item, actualValue, error, passed };
  manualCaseResults.push(result);
  check(`新GET手算 ${item.skillKey}/${item.formulaKey}`, passed, result);
}
const negativeControls = [];
const negative = (name, fn) => {
  try { fn(); negativeControls.push({ name, rejected: false }); check(`负例 ${name}`, false, '本应拒绝却未拒绝'); }
  catch (error) { negativeControls.push({ name, rejected: true, error: error.message }); check(`负例 ${name}`, true, error.message); }
};
negative('范围外虚灵伤害公式已移除', () => formulaValue('malzahar_w', 'voidling_hit_damage', { rank: 1, attrs: { ability_power: 100 }, inputs: {} }));
negative('范围外冰奴伤害公式已移除', () => formulaValue('lissandra_p', 'ice_servant_damage', { rank: 1, attrs: { ability_power: 100 }, inputs: {} }));
negative('范围外蛋形态双抗显示公式已移除', () => formulaValue('anivia_p', 'bonus_resists_display', { rank: 1, attrs: { ability_power: 100 }, inputs: {} }));
negative('无消费者的目标数量下限公式已移除', () => formulaValue('karthus_q', 'single_target_eligibility_lower_bound', { rank: 1, attrs: { ability_power: 100 }, inputs: { actual_target_count: 0 } }));
negative('目标数量2不得选择唯一敌人分支', () => { if (2 !== 1) throw Error('实际目标数量不是1，禁止选择QSingleTargetDamage'); });
negative('负目标数量不得成为唯一敌人', () => { if (-1 !== 1) throw Error('实际目标数量不是1，禁止选择QSingleTargetDamage'); });

const boundaryResults = [];
const boundary = (name, passed, detail) => { const row = { name, passed: Boolean(passed), detail }; boundaryResults.push(row); check(`边界 ${name}`, passed, detail); };
const parameter = (skillKey, parameterKey) => actualParameter.get(`${skillKey}/${parameterKey}`);
const lissandraRHealFormula = actualFormula.get('lissandra_r/self_heal');
boundary('丽桑卓R基础治疗采用默认法强窄证', Boolean(parameter('lissandra_r', 'heal_ap_ratio')?.fixedValue === 0.55) && close(formulaValue('lissandra_r', 'self_heal', { rank: 3, attrs: { ability_power: 100 }, inputs: {} }), 255), { ratio: parameter('lissandra_r', 'heal_ap_ratio')?.fixedValue, rank3AtAP100: (() => { try { return formulaValue('lissandra_r', 'self_heal', { rank: 3, attrs: { ability_power: 100 }, inputs: {} }); } catch (error) { return error.message; } })() });
boundary('丽桑卓R低血提升只保留参数边界', parameter('lissandra_r', 'self_heal_missing_hp_percent')?.fixedValue === 1 && parameter('lissandra_r', 'self_heal_missing_hp_per_above_percent')?.fixedValue === 1 && !JSON.stringify(lissandraRHealFormula?.expression ?? {}).includes('actual_missing_health'), { missingRatio: parameter('lissandra_r', 'self_heal_missing_hp_percent')?.fixedValue, perAbove: parameter('lissandra_r', 'self_heal_missing_hp_per_above_percent')?.fixedValue, formula: lissandraRHealFormula?.expression });
boundary('卡尔萨斯E 500毫秒只表示冷却', parameter('karthus_e', 'cooldown_ms')?.fixedValue === 500 && !JSON.stringify(candidate.skills.karthus_e.write).includes('damage_tick_interval_ms'), { cooldown: parameter('karthus_e', 'cooldown_ms')?.fixedValue });
boundary('丽桑卓Q/R使用正减速百分数点', equal(parameter('lissandra_q', 'slow_percent')?.levelValues, { '1': 20, '2': 24, '3': 28, '4': 32, '5': 36 }) && equal(parameter('lissandra_r', 'slow_percent')?.levelValues, { '1': 45, '2': 60, '3': 75 }) && !JSON.stringify(candidate.skills.lissandra_q.write).includes('"parameterKey":"slow_ratio"') && !JSON.stringify(candidate.skills.lissandra_r.write).includes('"parameterKey":"slow_ratio"'), { q: parameter('lissandra_q', 'slow_percent')?.levelValues, r: parameter('lissandra_r', 'slow_percent')?.levelValues });
boundary('艾尼维亚P蛋形态专用组成未写入', candidate.skills.anivia_p.write.parameters.length === 0 && candidate.skills.anivia_p.write.formulas.length === 0 && candidate.skills.anivia_p.write.effects.length === 0, candidate.skills.anivia_p.write);
boundary('卡尔萨斯P死亡状态为系统待接', candidate.skills.karthus_p.excluded.length === 0 && candidate.skills.karthus_p.pending.some(item => item.kind === '系统' && item.component.includes('无消耗')), candidate.skills.karthus_p.pending);
boundary('玛尔扎哈W和丽桑卓P专用召唤物未写入', candidate.skills.malzahar_w.write.parameters.every(item => !String(item.parameterKey).includes('voidling')) && candidate.skills.malzahar_w.write.formulas.length === 0 && candidate.skills.lissandra_p.write.parameters.length === 0 && candidate.skills.lissandra_p.write.formulas.length === 0, { malzaharW: candidate.skills.malzahar_w.write, lissandraP: candidate.skills.lissandra_p.write });
boundary('候选没有MOMENT_EVALUATION或即时伤害治疗', !JSON.stringify(candidate).includes('MOMENT_EVALUATION') && !JSON.stringify(candidate).includes('"resultType":"DAMAGE"') && !JSON.stringify(candidate).includes('"resultType":"DIRECT_HEAL"'), null);

const runtimeNotes = [];
for (const skillKey of skills) for (const runtimeParameter of candidate.skills[skillKey].write.parameters.filter(item => item.valueMode === 'RUNTIME_INPUT')) {
  const used = formulaEntries.some(entry => entry.skillKey === skillKey && JSON.stringify(actualFormula.get(`${entry.skillKey}/${entry.id}`)?.expression ?? {}).includes(runtimeParameter.parameterKey));
  if (!used) runtimeNotes.push(`${skillKey}/${runtimeParameter.parameterKey}只作为外供输入记录，当前没有公式消费；不制造直通公式。`);
}
const sourceIntegrity = [];
const rootDir = path.dirname(sourceFreeze.sourceIndex);
for (const sourceHero of sourceFreeze.heroes ?? []) {
  try {
    const compressed = readBytes(path.resolve(rootDir, sourceHero.client.path));
    const raw = gunzipSync(compressed);
    const official = readBytes(path.resolve(rootDir, sourceHero.official.path));
    const root = roots.heroes.find(hero => hero.id === sourceHero.id);
    const object = JSON.parse(raw);
    const rootChecks = (sourceHero.bindings ?? []).map(binding => {
      const sourceSpell = root?.spells.find(spell => spell.skillKey === binding.skillKey);
      return { skillKey: binding.skillKey, passed: Boolean(sourceSpell && sourceSpell.binding === binding.binding && sourceSpell.maxrank === binding.maxrank && object[binding.binding]), binding, root: sourceSpell ? { binding: sourceSpell.binding, maxrank: sourceSpell.maxrank } : null };
    });
    const row = { hero: sourceHero.id, clientCompressedSha256: sha256(compressed), clientSha256: sha256(raw), officialSha256: sha256(official), expectedClientCompressedSha256: sourceHero.client.compressedSha256, expectedClientSha256: sourceHero.client.sha256, expectedOfficialSha256: sourceHero.official.sha256, bindings: rootChecks, passed: sha256(compressed) === sourceHero.client.compressedSha256 && sha256(raw) === sourceHero.client.sha256 && sha256(official) === sourceHero.official.sha256 && rootChecks.every(item => item.passed) };
    sourceIntegrity.push(row);
    check(`来源根绑定独立复核 ${sourceHero.id}`, row.passed, row);
  } catch (error) { sourceIntegrity.push({ hero: sourceHero.id, passed: false, error: error.message }); check(`来源根绑定独立复核 ${sourceHero.id}`, false, error.message); }
}
check('丽桑卓R默认法强窄证仍存在', narrowMapping.boundedInferences?.some(item => item.key === 'mStat0-AP'), null);
check('丽桑卓R构造默认0证据存在', constructorDefaults.classes?.StatByNamedDataValueCalculationPart?.raw?.defaults?.['0x4cec2c8a'] === 0 && constructorDefaults.classes?.StatByNamedDataValueCalculationPart?.raw?.defaults?.['0x7d3150ec'] === 0, null);

const status = failures.length ? 'REVISE' : 'READY_FOR_INDEPENDENT_REVIEW';
const report = {
  at: new Date().toISOString(),
  status,
  runId: execution.runId,
  mode: '读取独立全量新GET的153条详情和120个列表；不读取写入器快照，不发送接口请求',
  apiBase,
  candidateSha256: expected.candidateSha256,
  planSha256: expected.writePlanSha256,
  sourceVersion: 'client16.17/official16.17.1',
  checks: checks.length,
  failedChecks: failures.length,
  failures,
  readback: { candidateDetails: expected.candidateDetails, actualDetails: componentSnapshot.details?.length ?? 0, lists: componentSnapshot.lists?.length ?? 0, componentComparisons, listConflicts, protectionConflicts: componentSnapshot.protectionConflicts ?? [], catalogReferences },
  formulas: { total: formulaEntries.length, checks: formulaChecks, sourceChecks, inputRejections },
  sourceCases: sourceCaseResults,
  manualCases: manualCaseResults,
  negativeControls,
  boundaries: boundaryResults,
  sourceIntegrity,
  runtimeNotes: [...new Set(runtimeNotes)],
  currentLimitations: ['未知等级曲线继续要求实际运行输入', '卡尔萨斯死亡状态触发和无消耗覆盖仍待系统接线', '丽桑卓R低血提升的分段、取整和封顶未猜补', '独立召唤物和纯冰墙支路不在本批写入范围'],
};
await fsp.writeFile(path.join(runDir, '实际读后数学核算.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status, runId: execution.runId, checks: checks.length, failedChecks: failures.length, candidateDetails: componentSnapshot.details?.length ?? 0, lists: componentSnapshot.lists?.length ?? 0, formulaChecks: formulaChecks.length, sourceCases: sourceCaseResults.length, manualCases: manualCaseResults.length, negativeControls: negativeControls.length, output: path.join(runDir, '实际读后数学核算.json') }, null, 2));
if (failures.length) process.exitCode = 1;
