import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { fileURLToPath } from 'node:url';

// 独立第二轮全量GET；不读取受保护写入器运行目录，也不发送任何业务写请求。
// --after-apply用于主负责人授权写入后的完整候选、保护对象和实际公式回读。
const here = path.dirname(fileURLToPath(import.meta.url));
const apiBase = 'http://127.0.0.1:8080/api/admin/games/lol';
const candidateName = '修订一-完整候选.json';
const planName = '修订一-写前请求意图.json';
const snapshotName = '实际现值保护快照.json';
const sourceName = '来源哈希汇总.json';
const oldCandidateName = '完整候选.json';
const oldPlanName = '写前请求意图.json';
const oldMathName = '独立数学核算.json';
const revisionMathName = '修订一-独立数学核算.json';
const heroes = ['nasus', 'chogath', 'galio', 'rammus'];
const skills = heroes.flatMap(hero => ['p', 'q', 'w', 'e', 'r'].map(slot => `${hero}_${slot}`));
const kinds = [
  ['parameters', 'parameterKey', 'parameters'],
  ['formulas', 'formulaKey', 'formulas'],
  ['effects', 'effectKey', 'effects'],
  ['processes', 'processKey', 'processes'],
  ['internalStates', 'stateKey', 'internal-states'],
  ['triggerRules', 'ruleKey', 'trigger-rules'],
];
const catalogKinds = [
  ['skill-categories', 'skillCategoryKey'],
  ['attributes', 'attributeKey'],
  ['modifier-zones', 'modifierZoneKey'],
  ['damage-types', 'damageTypeKey'],
];
const expected = {
  candidateSha256: '7fddee3b4b2fd121d3c053ba20388a69e38e2069a42ad7b80a054c56b70ce5c9',
  planSha256: 'b542da6edbc8fedba977ea20bb61e78ab436ae9a9fd7f290f6419b8bb19e855a',
  oldCandidateSha256: '723d467d65d4942ec64261530b863f3cd0d06e101fcc3b38731feeb3af1f93d2',
  oldPlanSha256: '9a220bc33362948aa170c518e551a64cf34dcfe1def8b291b19bdd3410586d9a',
  snapshotSha256: 'c422962b4c93fb0d642fe294b2dc1b7044566985039a141f8291a1151f74387f',
  sourceSha256: '57a9546ba221db52063ba438aa9454e251c296f64e621918b54524505f0e97d0',
  oldMathSha256: 'ce8bc87a5bc17026c805f3f1f35296d054b980799d9aec12762dfedd2ffae686',
  revisionMathSha256: '910d4db5adbeca11b85c19e894766df1be3c9e0e24586876347855520ad0a638',
  requestCount: 158,
  formulaCount: 24,
  baselineDetails: 69,
  lists: 120,
};
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--after-apply')) throw new Error('只接受默认当前回读或 --after-apply');
const afterApply = args.includes('--after-apply');

const sha256 = value => createHash('sha256').update(value).digest('hex');
const readBytes = name => fs.readFileSync(path.join(here, name));
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const rows = value => Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : Array.isArray(value?.data) ? value.data : Array.isArray(value?.data?.items) ? value.data.items : [];
const endpointKind = kind => kinds.find(item => item[0] === kind)?.[2];
const keyOf = (skillKey, kind, id) => `${skillKey}/${kind}/${id}`;
const serverFields = new Set(['gameId', 'skillKey', 'createdAt', 'updatedAt']);
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
const diff = (left, right, at = '$') => {
  if (equal(left, right)) return null;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return { path: at, expected: left, actual: right };
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return { path: at, expected: left, actual: right };
    for (let index = 0; index < left.length; index++) {
      const child = diff(left[index], right[index], `${at}[${index}]`);
      if (child) return child;
    }
    return null;
  }
  for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
    if (!(key in left) || !(key in right)) return { path: `${at}.${key}`, expected: left[key], actual: right[key] };
    const child = diff(left[key], right[key], `${at}.${key}`);
    if (child) return child;
  }
  return null;
};
const businessDiff = (left, right) => diff(canonical(left), canonical(right));
const exactDiff = (left, right) => diff(exactCanonical(left), exactCanonical(right));
const listSummaryDiff = (item, detail) => {
  if (!item || !detail) return { path: '$', expected: '详情对象', actual: detail };
  const countFields = {
    actionCount: 'actions',
    conditionGroupCount: 'conditionGroups',
    effectBindingCount: 'effectBindings',
    resultCount: 'results',
    stateOperationCount: 'stateOperations',
    stepCount: 'steps',
  };
  for (const [key, expectedValue] of Object.entries(item)) {
    // 触发规则详情接口不返回列表摘要中的更新时间；列表行和详情仍分别做冻结全字段保护。
    if (key === 'updatedAt' && !(key in detail)) continue;
    const actualValue = countFields[key]
      ? Array.isArray(detail[countFields[key]]) ? detail[countFields[key]].length : undefined
      : key === 'eventType'
        ? detail.eventSource?.eventType
        : key === 'maxTriggersPerProcessEnabled'
          ? detail.maxTriggersPerProcess !== null && detail.maxTriggersPerProcess !== undefined
          : key === 'perTargetCooldownEnabled'
            ? detail.perTargetCooldown !== null && detail.perTargetCooldown !== undefined
      : key === 'lifecycleEnabled'
        ? detail.lifecycle !== null && detail.lifecycle !== undefined
        : detail[key];
    if (!equal(expectedValue, actualValue)) return { path: key, expected: expectedValue, actual: actualValue };
  }
  return null;
};

const candidateBytes = readBytes(candidateName);
const planBytes = readBytes(planName);
const snapshotBytes = readBytes(snapshotName);
const sourceBytes = readBytes(sourceName);
const oldCandidateBytes = readBytes(oldCandidateName);
const oldPlanBytes = readBytes(oldPlanName);
const oldMathBytes = readBytes(oldMathName);
const revisionMathBytes = readBytes(revisionMathName);
const candidate = JSON.parse(candidateBytes);
const plan = JSON.parse(planBytes);
const baseline = JSON.parse(snapshotBytes);
const staticFailures = [];
const staticChecks = [];
const check = (name, passed, detail = null) => {
  const row = { name, passed: Boolean(passed), detail };
  staticChecks.push(row);
  if (!row.passed) staticFailures.push(row);
  return row.passed;
};
const hashCheck = (name, bytes, expectedHash) => check(name, sha256(bytes) === expectedHash, sha256(bytes));
hashCheck('修订候选哈希', candidateBytes, expected.candidateSha256);
hashCheck('修订请求计划哈希', planBytes, expected.planSha256);
hashCheck('旧候选保持原字节', oldCandidateBytes, expected.oldCandidateSha256);
hashCheck('旧请求保持原字节', oldPlanBytes, expected.oldPlanSha256);
hashCheck('现值快照保持原字节', snapshotBytes, expected.snapshotSha256);
hashCheck('来源清单保持原字节', sourceBytes, expected.sourceSha256);
hashCheck('旧数学结果保持原字节', oldMathBytes, expected.oldMathSha256);
hashCheck('修订数学结果保持原字节', revisionMathBytes, expected.revisionMathSha256);

const candidateEntries = [];
const candidateByKey = new Map();
for (const skillKey of skills) for (const [kind, key] of kinds) for (const body of candidate.skills?.[skillKey]?.write?.[kind] ?? []) {
  const id = body[key];
  const entry = { skillKey, kind, id, body, detailRoute: `/skills/${encodeURIComponent(skillKey)}/${endpointKind(kind)}/${encodeURIComponent(id ?? '')}` };
  const compound = keyOf(skillKey, kind, id);
  candidateEntries.push(entry);
  if (candidateByKey.has(compound)) check(`候选组成不重复${compound}`, false, '重复键');
  candidateByKey.set(compound, entry);
}
check('候选组成恰为158项', candidateEntries.length === expected.requestCount, candidateEntries.length);
check('请求计划恰为158条', plan.requestCount === expected.requestCount && plan.requests?.length === expected.requestCount, { requestCount: plan.requestCount, actual: plan.requests?.length });
check('请求计划绑定候选', plan.candidateSha256 === expected.candidateSha256, plan.candidateSha256);

const baselineComponentByKey = new Map();
for (const skillKey of skills) for (const [kind, key] of kinds) {
  const component = baseline.components?.[skillKey]?.[kind];
  const list = component?.list ?? [];
  const details = component?.details ?? [];
  for (const row of list) {
    const id = row[key];
    baselineComponentByKey.set(keyOf(skillKey, kind, id), { list: row, detail: details.find(item => item.stableKey === id)?.response });
  }
}
check('冻结已有组成恰为69项', baselineComponentByKey.size === expected.baselineDetails, baselineComponentByKey.size);

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(here, '修订一-独立回读', runId);
const httpJournal = path.join(runDir, '所有GET原始响应.jsonl');
const calls = [];
const failures = [];
const protection = { catalogs: {}, characters: {}, relations: {}, subjects: {}, images: {} };
const lists = [];
const details = [];
const detailByKey = new Map();
const componentConflicts = [];
const protectionConflicts = [];
const catalogReferences = [];
const catalogConflicts = [];
const formulaChecks = [];
const shieldNoDefaultChecks = [];
await fsp.mkdir(runDir, { recursive: true });
const appendJsonl = async value => {
  const handle = await fsp.open(httpJournal, 'a');
  try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); } finally { await handle.close(); }
};
const saveJson = async (name, value) => { await fsp.writeFile(path.join(runDir, name), jsonBytes(value)); };
const request = async route => {
  if (typeof route !== 'string' || !route.startsWith('/') || route.includes('://') || route.includes('..')) throw new Error(`非法GET路径：${route}`);
  const sequence = calls.length + 1;
  const startedAt = new Date().toISOString();
  await appendJsonl({ sequence, phase: '请求前', at: startedAt, method: 'GET', route });
  const started = Date.now();
  let result;
  try {
    const response = await fetch(apiBase + route, { method: 'GET', headers: { Authorization: `Bearer ${process.env.HERO20_API_TOKEN ?? 'local-entry'}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    const raw = await response.text();
    let data = null;
    let parseError = false;
    try { data = raw ? JSON.parse(raw) : null; } catch { parseError = true; }
    result = { sequence, method: 'GET', route, status: response.status, ok: response.ok && !parseError, data, ...(parseError ? { parseError: true, responseBytes: Buffer.byteLength(raw), responseSha256: sha256(raw) } : {}) };
  } catch (error) {
    result = { sequence, method: 'GET', route, status: null, ok: false, data: null, error: `${error.name}: ${error.message}` };
  }
  calls.push(result);
  await appendJsonl({ ...result, phase: '请求后', at: new Date().toISOString(), elapsedMs: Date.now() - started });
  return result;
};
const mustGet = async route => {
  const result = await request(route);
  if (!result.ok) throw new Error(`GET失败：${route} status=${result.status ?? 'network'}${result.error ? ` ${result.error}` : ''}`);
  return result;
};
const fetchProtection = async () => {
  for (const [name] of catalogKinds) protection.catalogs[name] = (await mustGet(`/${name}`)).data;
  for (const hero of heroes) {
    const characterKey = `champion_${hero}`;
    protection.characters[hero] = (await mustGet(`/characters/${encodeURIComponent(characterKey)}`)).data;
    protection.relations[hero] = (await mustGet(`/character-skill-relations?characterKey=${encodeURIComponent(characterKey)}`)).data;
  }
  for (const skillKey of skills) {
    protection.subjects[skillKey] = (await mustGet(`/skills/${encodeURIComponent(skillKey)}`)).data;
    protection.images[skillKey] = (await mustGet(`/skills/${encodeURIComponent(skillKey)}/representative-image`)).data;
  }
};
const walkCatalogReferences = () => {
  const maps = Object.fromEntries(catalogKinds.map(([name, key]) => [key, new Map(rows(protection.catalogs[name]).map(item => [item[key], item]))]));
  const walk = (value, at) => {
    if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${at}[${index}]`));
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (maps[key] && typeof child === 'string') {
        const item = maps[key].get(child);
        const row = { at: `${at}.${key}`, key, value: child, status: item?.status ?? null, enabled: item?.status === 'ENABLED' };
        catalogReferences.push(row);
        if (!row.enabled) catalogConflicts.push(row);
      }
      walk(child, `${at}.${key}`);
    }
  };
  for (const entry of candidateEntries) walk(entry.body, keyOf(entry.skillKey, entry.kind, entry.id));
  const passive = maps.skillCategoryKey?.get('passive');
  const required = { at: 'required.skillCategoryKeys.passive', key: 'skillCategoryKey', value: 'passive', status: passive?.status ?? null, enabled: passive?.status === 'ENABLED' };
  catalogReferences.push(required);
  if (!required.enabled) catalogConflicts.push(required);
};
const fetchComponents = async () => {
  for (const skillKey of skills) for (const [kind, key, endpoint] of kinds) {
    const route = `/skills/${encodeURIComponent(skillKey)}/${endpoint}`;
    const response = await mustGet(route);
    const items = rows(response.data);
    const ids = items.map(item => item[key]);
    if (ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) componentConflicts.push({ type: '重复或非法列表键', skillKey, kind, ids });
    lists.push({ skillKey, kind, route, status: response.status, items });
    const seen = new Set();
    for (const item of items) {
      const id = item[key];
      const compound = keyOf(skillKey, kind, id);
      seen.add(compound);
      const detailRoute = `${route}/${encodeURIComponent(id)}`;
      const detailResponse = await mustGet(detailRoute);
      const summaryDifference = listSummaryDiff(item, detailResponse.data);
      if (summaryDifference) componentConflicts.push({ type: '列表详情摘要不一致', skillKey, kind, id, diff: summaryDifference });
      const baselineEntry = baselineComponentByKey.get(compound);
      const candidateEntry = candidateByKey.get(compound);
      if (!baselineEntry && !candidateEntry) componentConflicts.push({ type: '计划外已有组成', skillKey, kind, id });
      if (baselineEntry) {
        const listDifference = exactDiff(baselineEntry.list, item);
        const detailDifference = exactDiff(baselineEntry.detail, detailResponse.data);
        if (listDifference) componentConflicts.push({ type: '冻结列表行漂移', skillKey, kind, id, diff: listDifference });
        if (detailDifference) componentConflicts.push({ type: '冻结详情漂移', skillKey, kind, id, diff: detailDifference });
      } else if (candidateEntry) {
        const candidateDifference = businessDiff(candidateEntry.body, detailResponse.data);
        if (candidateDifference) componentConflicts.push({ type: '候选详情异值', skillKey, kind, id, diff: candidateDifference });
      }
      const record = { skillKey, kind, id, route: detailRoute, status: detailResponse.status, listItem: item, data: detailResponse.data, listSummaryDiff: summaryDifference };
      details.push(record);
      detailByKey.set(compound, record);
    }
    for (const [compound] of baselineComponentByKey.entries()) if (compound.startsWith(`${skillKey}/${kind}/`) && !seen.has(compound)) componentConflicts.push({ type: '冻结组成从列表消失', skillKey, kind, id: compound.slice(`${skillKey}/${kind}/`.length) });
    for (const entry of candidateEntries.filter(item => item.skillKey === skillKey && item.kind === kind)) if (!seen.has(keyOf(entry.skillKey, entry.kind, entry.id))) {
      if (afterApply) componentConflicts.push({ type: '授权后候选组成缺失', skillKey, kind, id: entry.id });
    }
  }
};

const defaultAttributes = () => ({
  SOURCE: { ability_power: { TOTAL: 100, BASE: 90, BONUS: 10 }, attack_damage: { TOTAL: 120, BASE: 80, BONUS: 40 }, hp: { TOTAL: 1800, BASE: 1500, BONUS: 300 }, armor: { TOTAL: 100, BASE: 60, BONUS: 40 }, magic_resistance: { TOTAL: 80, BASE: 40, BONUS: 40 } },
  TARGET: { ability_power: { TOTAL: 0, BASE: 0, BONUS: 0 }, attack_damage: { TOTAL: 80, BASE: 60, BONUS: 20 }, hp: { TOTAL: 2000, BASE: 1800, BONUS: 200 }, armor: { TOTAL: 100, BASE: 80, BONUS: 20 }, magic_resistance: { TOTAL: 80, BASE: 60, BONUS: 20 } },
});
const sampleRuntime = parameter => parameter.valueType === 'INTEGER' ? 2 : 17.5;
const liveParameter = (skillKey, key, rank, runtime) => {
  const record = detailByKey.get(keyOf(skillKey, 'parameters', key));
  if (!record) throw new Error(`缺少业务参数详情：${skillKey}/${key}`);
  const p = record.data;
  if (p.valueMode === 'FIXED') return p.fixedValue;
  if (p.valueMode === 'SKILL_LEVEL') return p.levelValues?.[String(rank)];
  if (p.valueMode === 'CHARACTER_LEVEL') return p.levelValues?.[String(runtime.level ?? 10)];
  if (p.valueMode === 'RUNTIME_INPUT') return runtime.values?.[key] ?? sampleRuntime(p);
  throw new Error(`未知业务参数模式：${skillKey}/${key}/${p.valueMode}`);
};
const liveAttribute = (attributes, owner, key, kind) => {
  const value = attributes?.[owner]?.[key]?.[kind];
  if (value == null) throw new Error(`缺少属性输入：${owner}.${key}.${kind}`);
  return Number(value);
};
const evaluate = (node, skillKey, context, at = '$') => {
  if (!node || typeof node !== 'object') throw new Error(`非法公式节点：${at}`);
  if (node.nodeType === 'PARAMETER') {
    const value = liveParameter(skillKey, node.parameterKey, context.rank, context.runtime);
    if (value == null || !Number.isFinite(Number(value))) throw new Error(`业务参数无值：${skillKey}/${node.parameterKey}`);
    return Number(value);
  }
  if (node.nodeType === 'ATTRIBUTE') return liveAttribute(context.attributes, node.attributeOwner, node.attributeKey, node.attributeValueKind);
  if (node.nodeType !== 'OPERATION' || !Array.isArray(node.operands) || node.operands.length !== 2) throw new Error(`不支持的公式节点：${at}`);
  const left = evaluate(node.operands[0], skillKey, context, `${at}.left`);
  const right = evaluate(node.operands[1], skillKey, context, `${at}.right`);
  if (node.operation === 'ADD') return left + right;
  if (node.operation === 'SUBTRACT') return left - right;
  if (node.operation === 'MULTIPLY') return left * right;
  if (node.operation === 'DIVIDE') { if (right === 0) throw new Error(`除数为0：${at}`); return left / right; }
  if (node.operation === 'MIN') return Math.min(left, right);
  if (node.operation === 'MAX') return Math.max(left, right);
  throw new Error(`未知运算：${node.operation}`);
};
const formulaReferences = formula => {
  const parameters = new Set();
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (node.nodeType === 'PARAMETER') parameters.add(node.parameterKey);
    for (const child of Object.values(node)) if (child && typeof child === 'object') walk(child);
  };
  walk(formula.expression);
  return [...parameters];
};
const verifyLiveMath = () => {
  for (const entry of candidateEntries.filter(item => item.kind === 'formulas')) {
    const actual = detailByKey.get(keyOf(entry.skillKey, entry.kind, entry.id));
    if (!actual) { if (afterApply) failures.push({ message: '业务公式详情缺失', detail: keyOf(entry.skillKey, entry.kind, entry.id) }); continue; }
    const difference = businessDiff(entry.body, actual.data);
    if (difference) { failures.push({ message: '业务公式与候选不一致', detail: { key: keyOf(entry.skillKey, entry.kind, entry.id), diff: difference } }); continue; }
    try {
      const value = evaluate(actual.data.expression, entry.skillKey, { rank: 3, runtime: { level: 10, values: {} }, attributes: defaultAttributes() });
      const passed = Number.isFinite(value) && value > 0;
      formulaChecks.push({ skillKey: entry.skillKey, formulaKey: entry.id, value, passed, parameters: formulaReferences(actual.data) });
      if (!passed) failures.push({ message: '业务公式结果非正数', detail: { key: keyOf(entry.skillKey, entry.kind, entry.id), value } });
    } catch (error) {
      failures.push({ message: '业务公式实际求值失败', detail: { key: keyOf(entry.skillKey, entry.kind, entry.id), error: String(error.message ?? error) } });
    }
  }
  const shieldRatio = detailByKey.get(keyOf('galio_w', 'parameters', 'passive_shield_health_ratio_by_skill_level'))?.data;
  const shieldSource = detailByKey.get(keyOf('galio_w', 'parameters', 'source_hp_for_passive_shield'))?.data;
  if (shieldRatio) shieldNoDefaultChecks.push({ parameterKey: shieldRatio.parameterKey, valueMode: shieldRatio.valueMode, fixedValue: shieldRatio.fixedValue, levelValues: shieldRatio.levelValues, passed: shieldRatio.valueMode === 'SKILL_LEVEL' && shieldRatio.fixedValue === null && Object.keys(shieldRatio.levelValues ?? {}).length === 5 });
  if (shieldSource) shieldNoDefaultChecks.push({ parameterKey: shieldSource.parameterKey, valueMode: shieldSource.valueMode, fixedValue: shieldSource.fixedValue, levelValues: shieldSource.levelValues, passed: shieldSource.valueMode === 'RUNTIME_INPUT' && shieldSource.fixedValue === null && shieldSource.levelValues === null });
  if (shieldNoDefaultChecks.some(item => !item.passed)) failures.push({ message: '加里奥W护盾默认边界不符', detail: shieldNoDefaultChecks });
};

const execution = { at: new Date().toISOString(), mode: afterApply ? '写后独立全量GET与实值核算' : '当前独立全量GET', apiBase, candidateSha256: expected.candidateSha256, planSha256: expected.planSha256, source: 'client16.17/official16.17.1', apiWrites: 0, businessWrites: 0, staticChecks, staticFailures, expected: { catalogs: 4, characters: 4, relations: 4, subjects: 20, images: 20, lists: expected.lists, frozenDetails: expected.baselineDetails, candidateDetails: expected.requestCount + expected.baselineDetails, formulas: expected.formulaCount } };
try {
  if (staticFailures.length) throw new Error(`静态冻结校验失败${staticFailures.length}项`);
  await fetchProtection();
  for (const [name] of catalogKinds) {
    const difference = exactDiff(baseline.catalogs?.[name], protection.catalogs[name]);
    if (difference) protectionConflicts.push({ type: 'catalog', name, diff: difference });
  }
  for (const hero of heroes) {
    const characterDifference = exactDiff(baseline.characters?.[hero], protection.characters[hero]);
    const relationDifference = exactDiff(baseline.relations?.[hero], protection.relations[hero]);
    if (characterDifference) protectionConflicts.push({ type: 'character', hero, diff: characterDifference });
    if (relationDifference) protectionConflicts.push({ type: 'relation', hero, diff: relationDifference });
  }
  for (const skillKey of skills) {
    const subjectDifference = exactDiff(baseline.subjects?.[skillKey], protection.subjects[skillKey]);
    const imageDifference = exactDiff(baseline.images?.[skillKey], protection.images[skillKey]);
    if (subjectDifference) protectionConflicts.push({ type: 'subject', skillKey, diff: subjectDifference });
    if (imageDifference) protectionConflicts.push({ type: 'image', skillKey, diff: imageDifference });
  }
  walkCatalogReferences();
  await fetchComponents();
  if (protectionConflicts.length) failures.push({ message: '保护对象发生漂移', detail: protectionConflicts });
  if (catalogConflicts.length) failures.push({ message: '目录引用缺失或未启用', detail: catalogConflicts });
  if (componentConflicts.length) failures.push({ message: '组成列表或详情发生冲突', detail: componentConflicts });
  verifyLiveMath();
  await saveJson('独立保护对象.json', protection);
  await saveJson('独立全量组件现值.json', { phase: afterApply ? '写后独立全量GET' : '当前独立全量GET', protection, lists, details, counts: { catalogs: 4, characters: 4, relations: 4, subjects: 20, images: 20, lists: lists.length, details: details.length }, protectionConflicts, catalogReferences, catalogConflicts, componentConflicts });
  const candidatePresent = candidateEntries.filter(entry => detailByKey.has(keyOf(entry.skillKey, entry.kind, entry.id))).length;
  const allMethodsGet = calls.every(item => item.method === 'GET');
  if (!allMethodsGet) failures.push({ message: '独立回读出现非GET请求' });
  if (afterApply && candidatePresent !== expected.requestCount) failures.push({ message: '写后候选组成未全部存在', detail: { candidatePresent, expected: expected.requestCount } });
  execution.actual = { calls: calls.length, methods: calls.reduce((out, item) => { out[item.method] = (out[item.method] ?? 0) + 1; return out; }, {}), statuses: calls.reduce((out, item) => { out[String(item.status)] = (out[String(item.status)] ?? 0) + 1; return out; }, {}), lists: lists.length, details: details.length, candidatePresent, candidateMissing: expected.requestCount - candidatePresent, frozenPresent: details.filter(item => baselineComponentByKey.has(keyOf(item.skillKey, item.kind, item.id))).length, protectionConflicts: protectionConflicts.length, catalogConflicts: catalogConflicts.length, componentConflicts: componentConflicts.length };
  execution.math = { businessMathReady: afterApply && formulaChecks.length === expected.formulaCount && failures.length === 0, formulaCount: formulaChecks.length, positiveFormulaCount: formulaChecks.filter(item => item.passed).length, shieldNoDefaultChecks };
  execution.status = failures.length === 0 ? (afterApply ? 'PASS' : 'CURRENT_READBACK') : 'REVISE';
} catch (error) {
  failures.push({ message: error.message, name: error.name });
  execution.status = 'REVISE';
  execution.error = { name: error.name, message: error.message };
}
execution.failures = failures;
execution.apiWrites = calls.filter(item => item.method !== 'GET').length;
execution.businessWrites = execution.apiWrites;
execution.finishedAt = new Date().toISOString();
await saveJson('执行结果.json', execution);
await fsp.writeFile(path.join(runDir, '运行锁.json'), JSON.stringify({ at: new Date().toISOString(), runId, mode: execution.mode, apiWrites: execution.apiWrites, status: execution.status }, null, 2) + '\n');
console.log(JSON.stringify({ status: execution.status, runId, calls: calls.length, methods: execution.actual?.methods ?? {}, statuses: execution.actual?.statuses ?? {}, lists: lists.length, details: details.length, candidatePresent: execution.actual?.candidatePresent ?? 0, formulas: formulaChecks.length, positiveFormulaCount: formulaChecks.filter(item => item.passed).length, protectionConflicts: protectionConflicts.length, catalogConflicts: catalogConflicts.length, componentConflicts: componentConflicts.length, failures: failures.length, businessMathReady: execution.math?.businessMathReady ?? false, output: runDir }, null, 2));
if (failures.length) process.exitCode = 1;
