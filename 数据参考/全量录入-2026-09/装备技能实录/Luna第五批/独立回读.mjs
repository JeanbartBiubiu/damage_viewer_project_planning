import { readFile, writeFile } from 'node:fs/promises';

const apiBaseUrl = 'http://127.0.0.1:8080/api/admin/games/lol';
const token = 'local-entry';
const candidatePath = new URL('./录入候选.json', import.meta.url);
const evidencePath = new URL('./独立最终回读.json', import.meta.url);

function compareFields(expected, actual, path = '', rows = []) {
  if (expected === null || typeof expected !== 'object') {
    rows.push({ path, expected, actual, equal: Object.is(expected, actual) });
    return rows;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      rows.push({ path, expected, actual, equal: false });
      return rows;
    }
    rows.push({ path: `${path}[]`, expectedCount: expected.length, actualCount: actual.length, equal: expected.length === actual.length });
    expected.forEach((value, index) => compareFields(value, actual[index], `${path}[${index}]`, rows));
    return rows;
  }
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    rows.push({ path, expected, actual, equal: false });
    return rows;
  }
  for (const [key, value] of Object.entries(expected)) {
    compareFields(value, actual[key], path ? `${path}.${key}` : key, rows);
  }
  return rows;
}

async function request(path) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { status: response.status, data };
}

const candidate = JSON.parse(await readFile(candidatePath, 'utf8'));
const checks = [];
async function checkObject(label, path, expected, actual) {
  const fields = compareFields(expected, actual);
  checks.push({ label, path, status: actual === undefined ? null : 200, fields, equal: fields.every((field) => field.equal) });
}
async function checkGet(label, path, expected, transform = (value) => value) {
  const response = await request(path);
  if (response.status < 200 || response.status >= 300) {
    checks.push({ label, path, status: response.status, equal: false, error: response.data });
    return null;
  }
  const actual = transform(response.data);
  await checkObject(label, path, expected, actual);
  checks[checks.length - 1].status = response.status;
  return response.data;
}

for (const object of candidate.objects ?? []) {
  const skillPath = `/skills/${encodeURIComponent(object.skill.skillKey)}`;
  await checkGet(`${object.equipmentKey} direct attributes`, `/equipment/${encodeURIComponent(object.equipmentKey)}/attributes`, object.directAttributes, (data) => data?.attributeValues ?? data);
  await checkGet(`${object.skill.skillKey} skill`, skillPath, object.skill);
  for (const item of object.parameters ?? []) {
    await checkGet(`${object.skill.skillKey} parameter ${item.parameterKey}`, `${skillPath}/parameters/${encodeURIComponent(item.parameterKey)}`, item);
  }
  for (const item of object.formulas ?? []) {
    await checkGet(`${object.skill.skillKey} formula ${item.formulaKey}`, `${skillPath}/formulas/${encodeURIComponent(item.formulaKey)}`, item);
  }
  for (const item of object.effects ?? []) {
    await checkGet(`${object.skill.skillKey} effect ${item.effectKey}`, `${skillPath}/effects/${encodeURIComponent(item.effectKey)}`, item);
  }
  for (const item of object.triggerRules ?? []) {
    await checkGet(`${object.skill.skillKey} trigger ${item.ruleKey}`, `${skillPath}/trigger-rules/${encodeURIComponent(item.ruleKey)}`, item);
  }
  const relations = await request(`/equipment-skill-relations?equipmentKey=${encodeURIComponent(object.equipmentKey)}`);
  if (relations.status < 200 || relations.status >= 300) {
    checks.push({ label: `${object.equipmentKey} relation`, path: `/equipment-skill-relations?equipmentKey=${encodeURIComponent(object.equipmentKey)}`, status: relations.status, equal: false, error: relations.data });
  } else {
    const row = (relations.data?.items ?? []).find((item) => item.skillKey === object.skill.skillKey);
    await checkObject(`${object.equipmentKey} relation`, `/equipment-skill-relations?equipmentKey=${encodeURIComponent(object.equipmentKey)}`, object.relation, row);
    checks[checks.length - 1].status = relations.status;
  }
  const equipmentImage = await request(`/equipment/${encodeURIComponent(object.equipmentKey)}/representative-image`);
  const skillImage = await request(`${skillPath}/representative-image`);
  const equipmentImageKey = equipmentImage.data?.image?.imageKey ?? null;
  const skillImageKey = skillImage.data?.image?.imageKey ?? null;
  checks.push({
    label: `${object.skill.skillKey} representative image`,
    path: `${skillPath}/representative-image`,
    status: skillImage.status,
    equipmentImageStatus: equipmentImage.status,
    expectedImageKey: equipmentImageKey,
    actualImageKey: skillImageKey,
    equal: equipmentImage.status >= 200 && equipmentImage.status < 300
      && skillImage.status >= 200 && skillImage.status < 300
      && Boolean(equipmentImageKey) && skillImageKey === equipmentImageKey
  });
}

const fields = checks.flatMap((check) => check.fields ?? []);
const result = {
  generatedAt: new Date().toISOString(),
  mode: '独立最终GET逐字段回读',
  apiBaseUrl,
  objects: candidate.objects?.map((object) => ({ equipmentKey: object.equipmentKey, skillKey: object.skill.skillKey })) ?? [],
  checks,
  summary: {
    checkCount: checks.length,
    fieldCount: fields.length,
    mismatchCount: fields.filter((field) => !field.equal).length,
    failedCheckCount: checks.filter((check) => !check.equal).length,
    statusFailureCount: checks.filter((check) => typeof check.status === 'number' && (check.status < 200 || check.status >= 300)).length
  }
};
await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ evidencePath: evidencePath.pathname, summary: result.summary }, null, 2));
if (result.summary.failedCheckCount > 0 || result.summary.mismatchCount > 0) process.exitCode = 1;