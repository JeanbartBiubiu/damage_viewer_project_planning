import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const effectValue = (value, fixedMaxValue = null) => ({
  value, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue
});
const persistentBehavior = (reapplicationValueMode = 'REPLACE', valueReadMode = 'APPLICATION_SNAPSHOT') => ({
  moment: 'PERSISTENT', valueReadMode, stackValueMode: 'SHARED', reapplicationValueMode, periodicExecutionMode: null
});
const explicitLifecycle = () => ({
  durationValue: null,
  maxStacksValue: fixed(1),
  applicationStacksValue: fixed(1),
  instanceScope: 'SOURCE',
  reapplicationStackMode: 'KEEP',
  reapplicationDurationMode: null,
  expiryMode: 'EXPLICIT_ONLY',
  periodicIntervalValue: null,
  firstPeriodicExecution: null
});
const timedLifecycle = (durationValue, instanceScope = 'SOURCE') => ({
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
const periodicLifecycle = () => ({
  durationValue: null,
  maxStacksValue: fixed(1),
  applicationStacksValue: fixed(1),
  instanceScope: 'SOURCE',
  reapplicationStackMode: 'KEEP',
  reapplicationDurationMode: null,
  expiryMode: 'EXPLICIT_ONLY',
  periodicIntervalValue: fixed(5000),
  firstPeriodicExecution: 'AFTER_INTERVAL'
});
const periodicBehavior = {
  moment: 'PERIODIC', valueReadMode: 'MOMENT_EVALUATION', stackValueMode: 'SHARED',
  reapplicationValueMode: null, periodicExecutionMode: 'ONCE_PER_INSTANCE'
};
const damageResult = ({
  resultKey = 'damage', name, description, target = 'TARGET', value, damageTypeKey = 'physics',
  deliveryKind = 'BASIC_ATTACK', originKind = 'DIRECT', fixedMaxValue = null
}) => ({
  resultKey, name, resultType: 'DAMAGE', target, description, sortOrder: 10,
  lifecycleBehavior: null, spellShieldBlockScope: null,
  valueRule: effectValue(value, fixedMaxValue),
  detail: {
    damageTypeKey, deliveryKind, originKind,
    critical: { mode: 'DISALLOWED', multiplierValue: null }, vampRules: []
  }
});
const healResult = ({ resultKey = 'heal', name, description, value }) => ({
  resultKey, name, resultType: 'DIRECT_HEAL', target: 'SOURCE', description, sortOrder: 10,
  lifecycleBehavior: null, spellShieldBlockScope: null, valueRule: effectValue(value), detail: {}
});
const shieldResult = ({ resultKey = 'shield', name, description, value, damageTypeKey, lifecycleBehavior = persistentBehavior() }) => ({
  resultKey, name, resultType: 'NORMAL_SHIELD', target: 'SOURCE', description, sortOrder: 10,
  lifecycleBehavior, spellShieldBlockScope: null, valueRule: effectValue(value),
  detail: { absorbedDamageTypeKey: damageTypeKey ?? null, decayMode: 'NONE' }
});
const attributeResult = ({ resultKey, name, description, attributeKey, value, lifecycleBehavior = persistentBehavior() }) => ({
  resultKey, name, resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE', description, sortOrder: 10,
  lifecycleBehavior, spellShieldBlockScope: null, valueRule: effectValue(value),
  detail: { attributeKey, operation: 'INCREASE', modifierZoneKey: 'attribute_flat_add' }
});
const attributeModifierResult = ({ resultKey, name, description, attributeKey, value, modifierZoneKey = 'attribute_percent_bonus', lifecycleBehavior = persistentBehavior() }) => ({
  resultKey, name, resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE', description, sortOrder: 10,
  lifecycleBehavior, spellShieldBlockScope: null, valueRule: effectValue(value),
  detail: { attributeKey, operation: 'INCREASE', modifierZoneKey }
});const resourceResult = ({ resultKey = 'resource_change', name, description, target = 'SOURCE', value, attributeKey = 'mana', operation = 'RESTORE' }) => ({
  resultKey, name, resultType: 'RESOURCE_CHANGE', target, description, sortOrder: 10,
  lifecycleBehavior: null, spellShieldBlockScope: null, valueRule: effectValue(value),
  detail: { attributeKey, operation }
});
const executeResult = ({ resultKey = 'execute', name, description, target = 'TARGET', value, attributeKey = 'hp' }) => ({
  resultKey, name, resultType: 'EXECUTE', target, description, sortOrder: 10,
  lifecycleBehavior: null, spellShieldBlockScope: null, valueRule: effectValue(value), detail: { attributeKey }
});
const damageImmunityResult = ({ resultKey = 'damage_immunity', name, description, target = 'SOURCE', damageTypeKey = null, deliveryKind = 'ANY', originKind = 'ANY', lifecycleBehavior = { moment: 'PERSISTENT', valueReadMode: null, stackValueMode: null, reapplicationValueMode: null, periodicExecutionMode: null } }) => ({
  resultKey, name, resultType: 'DAMAGE_IMMUNITY', target, description, sortOrder: 10,
  lifecycleBehavior, spellShieldBlockScope: null, valueRule: null,
  detail: { damageTypeKey, deliveryKind, originKind }
});
const thresholdGroup = (thresholdFormulaKey, thresholdParameterKey) => ({
  groupKey: 'cross_below_threshold', name: '从阈值以上跌破阈值', sortOrder: 10,
  conditions: [
    {
      conditionKey: 'health_before_threshold', conditionType: 'ATTRIBUTE_COMPARE', sortOrder: 10,
      detail: {
        subject: 'SOURCE', attributeKey: 'hp', attributeValueKind: 'CURRENT_RATIO', comparator: 'GTE',
        comparisonValue: parameter(thresholdParameterKey)
      }
    },
    {
      conditionKey: 'projected_health_threshold', conditionType: 'EVENT_VALUE_COMPARE', sortOrder: 20,
      detail: { eventValueKey: 'PROJECTED_HEALTH_AFTER', comparator: 'LT', comparisonValue: formula(thresholdFormulaKey) }
    }
  ]
});

const stackedTimedLifecycle = (durationValue, maxStacksValue) => ({
  durationValue,
  maxStacksValue,
  applicationStacksValue: fixed(1),
  instanceScope: 'SOURCE',
  reapplicationStackMode: 'INCREASE',
  reapplicationDurationMode: 'REFRESH_ALL',
  expiryMode: 'ALL_AT_ONCE',
  periodicIntervalValue: null,
  firstPeriodicExecution: null
});
const permanentStackLifecycle = (maxStacksValue) => ({
  durationValue: null,
  maxStacksValue,
  applicationStacksValue: fixed(1),
  instanceScope: 'SOURCE',
  reapplicationStackMode: 'INCREASE',
  reapplicationDurationMode: null,
  expiryMode: 'EXPLICIT_ONLY',
  periodicIntervalValue: null,
  firstPeriodicExecution: null
});
const stackedAttributeBehavior = {
  moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'PER_STACK',
  reapplicationValueMode: null, periodicExecutionMode: null
};
const skillHasteBehavior = {
  moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED',
  reapplicationValueMode: 'KEEP', periodicExecutionMode: null
};
const skillHasteModifierResult = ({ resultKey, name, description, value, affectedSkillScope, lifecycleBehavior = skillHasteBehavior }) => ({
  resultKey, name, resultType: 'SKILL_HASTE_MODIFIER', target: 'SOURCE', description, sortOrder: 10,
  lifecycleBehavior, spellShieldBlockScope: null, valueRule: effectValue(value),
  detail: { operation: 'INCREASE', affectedSkillScope }
});

const skippedObjects = [];
const dynamicPersistentBehavior = {
  moment: 'PERSISTENT', valueReadMode: 'MOMENT_EVALUATION', stackValueMode: 'SHARED',
  reapplicationValueMode: null, periodicExecutionMode: null
};
const spellShieldBehavior = {
  moment: 'PERSISTENT', valueReadMode: null, stackValueMode: null,
  reapplicationValueMode: null, periodicExecutionMode: null
};
const periodicGrowthLifecycle = () => ({
  durationValue: null,
  maxStacksValue: fixed(10),
  applicationStacksValue: fixed(1),
  instanceScope: 'SOURCE',
  reapplicationStackMode: 'INCREASE',
  reapplicationDurationMode: null,
  expiryMode: 'EXPLICIT_ONLY',
  periodicIntervalValue: fixed(60000),
  firstPeriodicExecution: 'AFTER_INTERVAL'
});
const periodicGrowthBehavior = {
  moment: 'PERIODIC', valueReadMode: 'MOMENT_EVALUATION', stackValueMode: null,
  reapplicationValueMode: null, periodicExecutionMode: 'ONCE_PER_INSTANCE'
};
const periodicAttributeResult = ({ resultKey, name, description, attributeKey, value, lifecycleBehavior }) => ({
  resultKey, name, resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE', description, sortOrder: 10,
  lifecycleBehavior, spellShieldBlockScope: null, valueRule: effectValue(value),
  detail: { attributeKey, operation: 'INCREASE', modifierZoneKey: null }
});
// 当前候选是业务内容唯一输入；旧定义已留在修正前证据，不重放错误效果。
const objects = JSON.parse(await readFile(candidatePath, 'utf8')).objects;

const sourceFiles = [
  '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz',
  '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz',
  '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json',
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
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { status: response.status, data };
}
function isSuccess(result) { return result.status >= 200 && result.status < 300; }
function compareFields(expected, actual, path = '', rows = []) {
  if (expected === null || typeof expected !== 'object') { rows.push({ path, expected, actual, equal: Object.is(expected, actual) }); return rows; }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) { rows.push({ path, expected, actual, equal: false }); return rows; }
    rows.push({ path: `${path}[]`, expectedCount: expected.length, actualCount: actual.length, equal: expected.length === actual.length });
    expected.forEach((value, index) => compareFields(value, actual[index], `${path}[${index}]`, rows));
    return rows;
  }
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) { rows.push({ path, expected, actual, equal: false }); return rows; }
  for (const [key, value] of Object.entries(expected)) compareFields(value, actual[key], path ? `${path}.${key}` : key, rows);
  return rows;
}
function listItems(data) { return Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []); }
function mustSuccess(result, label) { if (!isSuccess(result)) throw new Error(`${label} failed: HTTP ${result.status} ${JSON.stringify(result.data)}`); return result; }
async function hashFile(relativePath) {
  const absolutePath = new URL(`../../../../${relativePath}`, import.meta.url);
  try { const bytes = await readFile(absolutePath); return { relativePath, sha256: createHash('sha256').update(bytes).digest('hex') }; }
  catch (error) { return { relativePath, missing: true, error: String(error.message ?? error) }; }
}
async function writeResource({ kind, path, createPath, body, apply, record }) {
  const before = await request('GET', path);
  if (isSuccess(before)) {
    const fields = compareFields(body, before.data);
    if (fields.some((field) => !field.equal)) throw new Error(`${kind} existing value differs; refusing overwrite: ${JSON.stringify(fields.filter((field) => !field.equal))}`);
    record.push({ kind, path, state: 'same', expected: body, readback: before.data, fields }); return before.data;
  }
  if (before.status !== 404) throw new Error(`${kind} preflight failed: HTTP ${before.status} ${JSON.stringify(before.data)}`);
  const row = { kind, path, state: apply ? 'created' : 'missing', expected: body, preflight: { status: before.status, data: before.data } };
  if (!apply) { record.push(row); return null; }
  const written = await request('POST', createPath, body);
  if (!isSuccess(written)) {
    const afterFailure = await request('GET', path);
    if (isSuccess(afterFailure)) {
      const fields = compareFields(body, afterFailure.data);
      if (!fields.some((field) => !field.equal)) { row.state = 'created-by-confirmed-retry'; row.write = { status: written.status, data: written.data }; row.readback = afterFailure.data; row.fields = fields; record.push(row); return afterFailure.data; }
    }
    throw new Error(`${kind} write failed and GET did not confirm same value: HTTP ${written.status} ${JSON.stringify(written.data)}`);
  }
  const read = mustSuccess(await request('GET', path), `${kind} readback`);
  row.write = { status: written.status, data: written.data }; row.readback = read.data; row.fields = compareFields(body, read.data);
  if (row.fields.some((field) => !field.equal)) throw new Error(`${kind} readback differs: ${JSON.stringify(row.fields.filter((field) => !field.equal))}`);
  record.push(row); return read.data;
}
async function relationRecord(object, apply, record) {
  const path = `/equipment-skill-relations?equipmentKey=${encodeURIComponent(object.equipmentKey)}`;
  const before = mustSuccess(await request('GET', path), `${object.equipmentKey} relation preflight`).data;
  const existing = listItems(before).find((item) => item.skillKey === object.skill.skillKey);
  if (existing) {
    const fields = compareFields(object.relation, existing);
    if (fields.some((field) => !field.equal)) throw new Error(`relation existing value differs: ${JSON.stringify(fields.filter((field) => !field.equal))}`);
    record.push({ kind: 'equipment-skill-relation', path, state: 'same', expected: object.relation, readback: existing, fields, listReadback: before }); return;
  }
  const row = { kind: 'equipment-skill-relation', path, state: apply ? 'created' : 'missing', expected: object.relation, preflight: before };
  if (!apply) { record.push(row); return; }
  const written = await request('POST', '/equipment-skill-relations', object.relation);
  const after = mustSuccess(await request('GET', path), `${object.equipmentKey} relation readback`).data;
  const confirmed = listItems(after).find((item) => item.skillKey === object.skill.skillKey);
  if (!confirmed) throw new Error(`relation write failed: HTTP ${written.status} ${JSON.stringify(written.data)}`);
  row.write = { status: written.status, data: written.data }; row.readback = confirmed; row.fields = compareFields(object.relation, confirmed); row.listReadback = after;
  if (row.fields.some((field) => !field.equal)) throw new Error(`relation readback differs: ${JSON.stringify(row.fields.filter((field) => !field.equal))}`);
  record.push(row);
}
async function imageRecord(object, applyImages, record) {
  const equipmentImagePath = `/equipment/${encodeURIComponent(object.equipmentKey)}/representative-image`;
  const skillImagePath = `/skills/${encodeURIComponent(object.skill.skillKey)}/representative-image`;
  const equipmentImage = mustSuccess(await request('GET', equipmentImagePath), `${object.equipmentKey} equipment image`).data;
  const imageKey = equipmentImage?.image?.imageKey;
  if (!imageKey) throw new Error(`${object.equipmentKey} has no enabled representative image`);
  const skillImageResponse = await request('GET', skillImagePath);
  if (!isSuccess(skillImageResponse) && skillImageResponse.status !== 404) throw new Error(`skill image preflight failed: HTTP ${skillImageResponse.status} ${JSON.stringify(skillImageResponse.data)}`);
  const currentImage = skillImageResponse.data?.image;
  if (currentImage) {
    if (currentImage.imageKey !== imageKey) throw new Error(`${object.skill.skillKey} representative image differs: expected ${imageKey}, got ${currentImage.imageKey}`);
    record.push({ kind: 'representative-image', path: skillImagePath, state: 'same', equipmentImagePath, equipmentImage, expectedImageKey: imageKey, readback: skillImageResponse.data }); return;
  }
  const row = { kind: 'representative-image', path: skillImagePath, state: applyImages ? 'created' : 'missing', equipmentImagePath, equipmentImage, expectedImageKey: imageKey, preflight: skillImageResponse.data };
  if (!applyImages) { record.push(row); return; }
  const written = await request('PUT', skillImagePath, { imageKey });
  const read = mustSuccess(await request('GET', skillImagePath), `${object.skill.skillKey} image readback`);
  row.write = { status: written.status, data: written.data }; row.readback = read.data;
  if (row.readback?.image?.imageKey !== imageKey) throw new Error(`representative image readback differs for ${object.skill.skillKey}`);
  record.push(row);
}
async function equipmentAttributesRecord(object, record) {
  const path = `/equipment/${encodeURIComponent(object.equipmentKey)}/attributes`;
  const read = mustSuccess(await request('GET', path), `${object.equipmentKey} direct attributes`);
  const actual = read.data?.attributeValues ?? read.data;
  const fields = compareFields(object.directAttributes, actual);
  if (fields.some((field) => !field.equal)) {
    throw new Error(`${object.equipmentKey} direct attributes differ: ${JSON.stringify(fields.filter((field) => !field.equal))}`);
  }
  record.components.push({ kind: 'equipment-direct-attributes', path, state: 'read', expected: object.directAttributes, readback: actual, fields });
}
async function runObject(object, { apply, applyImages }) {
  const skillPath = `/skills/${encodeURIComponent(object.skill.skillKey)}`;
  const record = { equipmentKey: object.equipmentKey, equipmentName: object.equipmentName, skillKey: object.skill.skillKey, sourceRefs: object.sourceRefs, pendingRules: object.pendingRules, pendingEffects: object.pendingEffects ?? [], arithmetic: object.arithmetic, directAttributes: object.directAttributes, components: [] };
  await equipmentAttributesRecord(object, record);
  const skill = await writeResource({ kind: 'skill', path: skillPath, createPath: '/skills', body: object.skill, apply, record: record.components });
  if (!skill) { record.status = '待录入'; record.missingComponentCount = 1 + object.parameters.length + object.formulas.length + object.effects.length + object.triggerRules.length + 2; return record; }
  for (const item of object.parameters) await writeResource({ kind: `parameter:${item.parameterKey}`, path: `${skillPath}/parameters/${encodeURIComponent(item.parameterKey)}`, createPath: `${skillPath}/parameters`, body: item, apply, record: record.components });
  for (const item of object.formulas) await writeResource({ kind: `formula:${item.formulaKey}`, path: `${skillPath}/formulas/${encodeURIComponent(item.formulaKey)}`, createPath: `${skillPath}/formulas`, body: item, apply, record: record.components });
  for (const item of object.effects) await writeResource({ kind: `effect:${item.effectKey}`, path: `${skillPath}/effects/${encodeURIComponent(item.effectKey)}`, createPath: `${skillPath}/effects`, body: item, apply, record: record.components });
  for (const item of object.processes ?? []) await writeResource({ kind: `process:${item.processKey}`, path: `${skillPath}/processes/${encodeURIComponent(item.processKey)}`, createPath: `${skillPath}/processes`, body: item, apply, record: record.components });
  for (const item of object.triggerRules) await writeResource({ kind: `trigger-rule:${item.ruleKey}`, path: `${skillPath}/trigger-rules/${encodeURIComponent(item.ruleKey)}`, createPath: `${skillPath}/trigger-rules`, body: item, apply, record: record.components });
  await relationRecord(object, apply, record.components);
  await imageRecord(object, applyImages, record.components);
  record.status = '已完成可保存组成'; return record;
}
function summary(records) {
  const components = records.flatMap((record) => record.components ?? []); const fields = components.flatMap((component) => component.fields ?? []); const count = (prefix) => components.filter((component) => component.kind.startsWith(prefix)).length;
  return { equipmentCount: records.length + skippedObjects.length, processedEquipmentCount: records.length, skippedEquipmentCount: skippedObjects.length, skillCount: count('skill'), parameterCount: count('parameter:'), formulaCount: count('formula:'), effectCount: count('effect:'), processCount: count('process:'), triggerRuleCount: count('trigger-rule:'), relationCount: count('equipment-skill-relation'), representativeImageCount: count('representative-image'), componentCount: components.length, fieldCount: fields.length, mismatchCount: fields.filter((field) => !field.equal).length, missingCount: components.filter((component) => component.state === 'missing' || component.state === 'skill-missing').length };
}
async function main() {
const apply = process.argv.includes('--apply');
const applyImages = process.argv.includes('--apply-images');
const writeCandidate = process.argv.includes('--write-candidate');
if (writeCandidate) await writeFile(candidatePath, `${JSON.stringify({ generatedAt: new Date().toISOString(), objects, skipped: skippedObjects }, null, 2)}\n`, 'utf8');
const records = [];
for (const object of objects) records.push(await runObject(object, { apply, applyImages }));
const result = {
  generatedAt: new Date().toISOString(), mode: applyImages ? (apply ? '补缺并独立补图' : '独立补图') : (apply ? '补缺' : '只读逐字段回读'), apiBaseUrl, gameId: 'lol',
  source: { version: '16.17.1', clientDirectoryVersion: '16.17', hashes: await Promise.all(sourceFiles.map(hashFile)), note: '仅保存冻结来源确证的独立组成；配置保存与接口回读不等于运行时验证。' },
  objects: records, skipped: skippedObjects, summary: summary(records)
};
await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ mode: result.mode, summary: result.summary, evidencePath: evidencePath.pathname, candidatePath: writeCandidate ? candidatePath.pathname : null }, null, 2));
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) await main();
