import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..', '..');
const planning = 'C:/project/damage_viewer_project_planning';
const baseUrl = 'http://127.0.0.1:8080/api/admin/games/lol';
const token = process.env.DAMAGE_ENTRY_TOKEN;
if (!token) throw new Error('缺少 DAMAGE_ENTRY_TOKEN');

const componentKinds = [
  ['parameters', 'parameterKey'],
  ['formulas', 'formulaKey'],
  ['effects', 'effectKey'],
  ['processes', 'processKey'],
  ['internal-states', 'stateKey'],
  ['trigger-rules', 'ruleKey']
];
const targets = [
  {
    skillKey: 'olaf_w',
    characterKey: 'champion_olaf',
    hero: '奥拉夫',
    slot: 'W',
    candidatePath: path.join(repo, '数据参考', '全量录入-2026-09', '交叉试录', 'Cursor', '英雄机制第七批', '完整候选.json'),
    localReadbackPath: path.join(repo, '数据参考', '全量录入-2026-09', '交叉试录', 'Cursor', '英雄机制第七批', '独立全量回读.json'),
    plannedRuleKey: 'on_used'
  },
  {
    skillKey: 'garen_r',
    characterKey: 'champion_garen',
    hero: '盖伦',
    slot: 'R',
    candidatePath: path.join(planning, '数据参考', '全量录入-2026-09', '盖伦技能候选', '盖伦技能录入候选.json'),
    localReadbackPath: path.join(repo, '数据参考', '全量录入-2026-09', '交叉试录', 'Cursor', '英雄机制第六批', '最终独立回读证据.json'),
    plannedRuleKey: 'on_hit'
  }
];

const sourceFiles = [
  { hero: '奥拉夫', kind: '官方中文静态资料', path: path.join(planning, '数据参考', '全量录入-2026-09', '英雄', '原始资料', 'zh_CN', 'champion', 'Olaf.json') },
  { hero: '奥拉夫', kind: '官方英文静态资料', path: path.join(planning, '数据参考', '全量录入-2026-09', '英雄', '原始资料', 'en_US', 'champion', 'Olaf.json') },
  { hero: '奥拉夫', kind: '客户端角色根记录', path: path.join(planning, '数据参考', '全量录入-2026-09', '英雄', '角色根记录', 'Olaf.json') },
  { hero: '奥拉夫', kind: '客户端16.17原始资料', path: path.join(planning, '数据参考', '全量录入-2026-09', '技能公共参数实录', '客户端原文', 'Olaf.json.gz') },
  { hero: '奥拉夫', kind: '技能来源记录', path: path.join(planning, '数据参考', '全量录入-2026-09', 'API实录', '技能', 'records', 'olaf_w.json') },
  { hero: '奥拉夫', kind: '代表图片来源', path: path.join(planning, '数据参考', '全量录入-2026-09', 'API实录', '图片', 'prepared', 'olaf_w.png') },
  { hero: '奥拉夫', kind: '页面技能图片', path: path.join(planning, '数据参考', '全量录入-2026-09', '英雄技能全量页面输入', 'images', '02_技能', 'Olaf', 'W_OlafFrenziedStrikes.png') },
  { hero: '奥拉夫', kind: '候选机制证据', path: targets[0].candidatePath },
  { hero: '奥拉夫', kind: '上一批独立回读证据', path: targets[0].localReadbackPath },
  { hero: '奥拉夫', kind: '原始组成脚本', path: path.join(repo, '数据参考', '全量录入-2026-09', '交叉试录', 'Cursor', '英雄机制第七批', 'Cursor原始产物', '奥拉夫组成.mjs') },
  { hero: '盖伦', kind: '官方中文静态资料', path: path.join(planning, '数据参考', '全量录入-2026-09', '英雄', '原始资料', 'zh_CN', 'champion', 'Garen.json') },
  { hero: '盖伦', kind: '官方英文静态资料', path: path.join(planning, '数据参考', '全量录入-2026-09', '英雄', '原始资料', 'en_US', 'champion', 'Garen.json') },
  { hero: '盖伦', kind: '客户端16.17原始资料', path: path.join(planning, '数据参考', '全量录入-2026-09', '英雄', '成长补充原始资料', '16.17', 'garen.bin.json') },
  { hero: '盖伦', kind: '客户端16.17原始资料压缩副本', path: path.join(planning, '数据参考', '全量录入-2026-09', '技能公共参数实录', '客户端原文', 'Garen.json.gz') },
  { hero: '盖伦', kind: '技能来源记录', path: path.join(planning, '数据参考', '全量录入-2026-09', 'API实录', '技能', 'records', 'garen_r.json') },
  { hero: '盖伦', kind: '代表图片来源', path: path.join(planning, '数据参考', '全量录入-2026-09', 'API实录', '图片', 'prepared', 'garen_r.png') },
  { hero: '盖伦', kind: '页面技能图片', path: path.join(planning, '数据参考', '全量录入-2026-09', '英雄技能全量页面输入', 'images', '02_技能', 'Garen', 'R_GarenR.png') },
  { hero: '盖伦', kind: '技能实录', path: path.join(planning, '数据参考', '全量录入-2026-09', '盖伦技能实录.json') },
  { hero: '盖伦', kind: '效果回读说明', path: path.join(planning, '数据参考', '全量录入-2026-09', '盖伦效果回读-2026-09-07.md') },
  { hero: '盖伦', kind: '规划真源候选', path: path.join(planning, '数据参考', '全量录入-2026-09', '盖伦技能候选', '盖伦技能录入候选.json') },
  { hero: '盖伦', kind: '上一批独立回读证据', path: targets[1].localReadbackPath }
];
const cursorSummaryPath = path.join(repo, '数据参考', '全量录入-2026-09', '交叉试录', 'Cursor', '英雄机制第七批', 'README.md');

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const fileSha = (filePath) => sha256(fs.readFileSync(filePath));
const writeJson = (fileName, value) => fs.writeFileSync(path.join(here, fileName), `${JSON.stringify(value, null, 2)}\n`);
const digestOf = (fileName) => fileSha(path.join(here, fileName));

function parseJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sourceRecord(source) {
  if (!fs.existsSync(source.path)) throw new Error(`来源文件不存在：${source.path}`);
  const bytes = fs.readFileSync(source.path);
  const result = {
    hero: source.hero,
    kind: source.kind,
    path: source.path,
    byteSize: bytes.byteLength,
    sha256: sha256(bytes)
  };
  if (source.path.toLowerCase().endsWith('.gz')) {
    const decompressed = gunzipSync(bytes);
    result.decompressedByteSize = decompressed.byteLength;
    result.decompressedSha256 = sha256(decompressed);
  }
  return result;
}

function arrayData(response, context) {
  if (response.status !== 200) throw new Error(`${context} 预期 200，实际 ${response.status}`);
  if (Array.isArray(response.data)) return response.data;
  if (Array.isArray(response.data?.items)) return response.data.items;
  throw new Error(`${context} 没有数组结果`);
}

function requireStatus(response, expected, context) {
  if (response.status !== expected) throw new Error(`${context} 预期 ${expected}，实际 ${response.status}`);
  return response;
}

let getCount = 0;
async function get(route) {
  getCount += 1;
  const response = await fetch(baseUrl + route, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000)
  });
  const raw = await response.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { parseError: true, responseBytes: Buffer.byteLength(raw) };
    }
  }
  return { method: 'GET', route, status: response.status, data };
}

async function getMany(routes, concurrency = 24) {
  const result = new Array(routes.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= routes.length) return;
      result[index] = await get(routes[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, routes.length || 1) }, () => worker()));
  return result;
}

function stableKeys(items, key) {
  return items.map((item) => item[key]).sort();
}

function sameStringList(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function scanSkillRules(includeDetails) {
  const skillsResponse = requireStatus(await get('/skills'), 200, '全技能目录');
  const skills = arrayData(skillsResponse, '全技能目录');
  const skillKeys = skills.map((skill) => skill.skillKey).sort();
  if (new Set(skillKeys).size !== skillKeys.length) throw new Error('全技能目录存在重复 skillKey');
  const listResponses = await getMany(skillKeys.map((skillKey) => `/skills/${encodeURIComponent(skillKey)}/trigger-rules`));
  const lists = listResponses.map((response, index) => {
    requireStatus(response, 200, `技能触发规则列表 ${skillKeys[index]}`);
    const rules = arrayData(response, `技能触发规则列表 ${skillKeys[index]}`);
    const ruleKeys = rules.map((rule) => rule.ruleKey);
    if (new Set(ruleKeys).size !== ruleKeys.length) throw new Error(`技能 ${skillKeys[index]} 规则键重复`);
    return { skillKey: skillKeys[index], response, rules, ruleKeys: ruleKeys.sort() };
  });
  const ruleRefs = lists.flatMap((list) => list.ruleKeys.map((ruleKey) => ({ skillKey: list.skillKey, ruleKey })));
  const details = includeDetails
    ? await getMany(ruleRefs.map(({ skillKey, ruleKey }) => `/skills/${encodeURIComponent(skillKey)}/trigger-rules/${encodeURIComponent(ruleKey)}`))
    : [];
  if (includeDetails) {
    details.forEach((response, index) => requireStatus(response, 200, `技能触发规则详情 ${ruleRefs[index].skillKey}/${ruleRefs[index].ruleKey}`));
  }
  return {
    skillsResponse,
    skills,
    skillKeys,
    lists,
    ruleRefs,
    details: details.map((response, index) => ({ ...ruleRefs[index], response }))
  };
}

async function readTarget(target) {
  const subject = requireStatus(await get(`/skills/${target.skillKey}`), 200, `${target.skillKey} 主体`);
  const relation = requireStatus(
    await get(`/character-skill-relations?characterKey=${encodeURIComponent(target.characterKey)}`),
    200,
    `${target.characterKey} 技能关系`
  );
  const representativeImage = requireStatus(
    await get(`/skills/${target.skillKey}/representative-image`),
    200,
    `${target.skillKey} 代表图片`
  );
  const components = {};
  for (const [apiName, keyName] of componentKinds) {
    const listResponse = requireStatus(await get(`/skills/${target.skillKey}/${apiName}`), 200, `${target.skillKey}/${apiName}`);
    const items = arrayData(listResponse, `${target.skillKey}/${apiName}`);
    const keys = items.map((item) => item[keyName]);
    if (keys.some((key) => typeof key !== 'string') || new Set(keys).size !== keys.length) {
      throw new Error(`${target.skillKey}/${apiName} 存在空键或重复键`);
    }
    const detailResponses = await getMany(keys.map((key) => `/skills/${target.skillKey}/${apiName}/${encodeURIComponent(key)}`));
    detailResponses.forEach((response, index) => requireStatus(response, 200, `${target.skillKey}/${apiName}/${keys[index]}`));
    components[apiName] = {
      list: listResponse,
      details: detailResponses.map((response, index) => ({ key: keys[index], response }))
    };
  }
  return { ...target, subject, relation, representativeImage, components };
}

function findSkillNode(value, skillKey, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (value.skillKey === skillKey) return value;
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findSkillNode(child, skillKey, seen);
      if (found) return found;
    }
  } else {
    for (const child of Object.values(value)) {
      const found = findSkillNode(child, skillKey, seen);
      if (found) return found;
    }
  }
  return null;
}

function findSkillEntry(value, skillKey, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (value.skillKey === skillKey && Array.isArray(value.triggerRules)) return value;
  if (value.skill?.skillKey === skillKey && Array.isArray(value.triggerRules)) return value;
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findSkillEntry(child, skillKey, seen);
      if (found) return found;
    }
  } else {
    for (const child of Object.values(value)) {
      const found = findSkillEntry(child, skillKey, seen);
      if (found) return found;
    }
  }
  return null;
}

function rewriteUnwiredDescription(description) {
  let updated = String(description ?? '');
  updated = updated.replace(/触发规则尚未接线/g, '触发规则已配置');
  updated = updated.replace(/触发规则未接线/g, '触发规则已配置');
  updated = updated.replace(/规则尚未接线/g, '规则已配置');
  if (updated.includes('未接线')) updated = updated.replace(/未接线/g, '触发规则已配置');
  if (updated === description) updated = `${updated.replace(/[。；]?$|$/, '')}；本批已配置触发规则。`;
  return updated;
}

function makeOlafRule() {
  return {
    ruleKey: 'on_used',
    name: '挺过去主动使用启动过程',
    description: '以主动 SKILL_USED 为输入；CURRENT_TARGET 没有显式目标时回退来源对象，启动已有 cast 过程，由过程管理法力、冷却、护盾与攻速。',
    sortOrder: 10,
    eventSource: {
      eventType: 'SKILL_USED',
      detail: { sourceSkillKey: 'olaf_w', useKind: 'ACTIVE' }
    },
    conditionGroups: [],
    actions: [
      {
        actionKey: 'start_cast',
        name: '启动挺过去过程',
        actionType: 'START_PROCESS',
        sortOrder: 10,
        targetContext: 'CURRENT_TARGET',
        detail: { processKey: 'cast' },
        runtimeInputBindings: [],
        resultModifiers: []
      }
    ],
    perTargetCooldown: null,
    maxTriggersPerProcess: null
  };
}

function getGarenRule(plan) {
  const entry = findSkillEntry(plan, 'garen_r');
  const rule = entry?.triggerRules?.find((item) => item.ruleKey === 'on_hit');
  if (!rule) throw new Error('规划真源没有找到盖伦 R 的 on_hit 规则');
  return rule;
}

function descriptionUpdate(targetRecord) {
  const subject = targetRecord.subject.data;
  if (!String(subject.description ?? '').includes('未接线')) return null;
  return {
    name: subject.name,
    description: rewriteUnwiredDescription(subject.description),
    maxLevel: subject.maxLevel,
    status: subject.status,
    sortOrder: subject.sortOrder,
    skillCategoryKeys: subject.skillCategoryKeys
  };
}

function targetRuleKeys(targetRecord) {
  const list = targetRecord.components['trigger-rules'].list;
  return arrayData(list, `${targetRecord.skillKey}/trigger-rules`).map((item) => item.ruleKey);
}

const startedAt = new Date().toISOString();
const planSource = parseJsonFile(path.join(planning, '数据参考', '全量录入-2026-09', '盖伦技能候选', '盖伦技能录入候选.json'));
const sourceSnapshot = {
  schemaVersion: 1,
  capturedAt: startedAt,
  sourcePolicy: '冻结客户端16.17与官方16.17.1；不使用外部最新资料覆盖冻结内容。',
  sources: sourceFiles.map(sourceRecord),
  cursorOriginalSummary: {
    path: cursorSummaryPath,
    sha256: fileSha(cursorSummaryPath),
    note: '只记录已有原始摘要散列；不把摘要中的执行结果当作本轮实库证据。'
  },
  planningGarenRule: getGarenRule(planSource),
  requestedSkills: targets.map(({ skillKey, hero, slot, candidatePath, localReadbackPath }) => ({
    skillKey,
    hero,
    slot,
    candidatePath,
    candidateSha256: fileSha(candidatePath),
    localReadbackPath,
    localReadbackSha256: fileSha(localReadbackPath)
  }))
};
writeJson('03-来源快照.json', sourceSnapshot);

const targetRecords = [];
for (const target of targets) targetRecords.push(await readTarget(target));

const initialInventory = await scanSkillRules(true);
const stableInventory = await scanSkillRules(false);
const initialRuleKeys = initialInventory.ruleRefs.map(({ skillKey, ruleKey }) => `${skillKey}/${ruleKey}`).sort();
const stableRuleKeys = stableInventory.ruleRefs.map(({ skillKey, ruleKey }) => `${skillKey}/${ruleKey}`).sort();
const stableSkillKeys = sameStringList(initialInventory.skillKeys, stableInventory.skillKeys);
const stableRuleSet = sameStringList(initialRuleKeys, stableRuleKeys);
const stableCounts = initialInventory.ruleRefs.length === stableInventory.ruleRefs.length;
const stable = stableSkillKeys && stableRuleSet && stableCounts;
const currentRuleCount = initialInventory.ruleRefs.length;
const sourceInitializedCount = initialInventory.details.filter(({ response }) => response.data?.eventSource?.eventType === 'SOURCE_INITIALIZED').length;
const expectedCurrent = { skillCount: 1062, ruleCount: 94, sourceInitializedCount: 24 };

const candidateRules = { olaf_w: makeOlafRule(), garen_r: getGarenRule(planSource) };
const descriptionChecks = targetRecords.map((record) => ({
  skillKey: record.skillKey,
  descriptionContainsUnwired: String(record.subject.data?.description ?? '').includes('未接线'),
  currentDescription: record.subject.data?.description ?? null,
  updateBody: descriptionUpdate(record)
}));
const conflicts = [];
const writeEntries = [];
for (const record of targetRecords) {
  const updateBody = descriptionUpdate(record);
  if (updateBody) {
    writeEntries.push({
      id: `${record.skillKey}-description`,
      kind: '主体说明更新',
      method: 'PUT',
      route: `/skills/${record.skillKey}`,
      detailRoute: `/skills/${record.skillKey}`,
      expectedStatus: 200,
      body: updateBody
    });
  }
  const keys = targetRuleKeys(record);
  if (keys.includes(record.plannedRuleKey)) {
    conflicts.push({ skillKey: record.skillKey, ruleKey: record.plannedRuleKey, issue: '目标规则已存在，禁止重复创建' });
  } else {
    writeEntries.push({
      id: `${record.skillKey}-${record.plannedRuleKey}`,
      kind: '新增触发规则',
      method: 'POST',
      route: `/skills/${record.skillKey}/trigger-rules`,
      detailRoute: `/skills/${record.skillKey}/trigger-rules/${record.plannedRuleKey}`,
      expectedStatus: 201,
      body: candidateRules[record.skillKey]
    });
  }
}
const frozen = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: conflicts.length === 0 ? 'READY_FOR_INDEPENDENT_REVIEW' : 'REVISE',
  writable: conflicts.length === 0 && stable && currentRuleCount === expectedCurrent.ruleCount && sourceInitializedCount === expectedCurrent.sourceInitializedCount,
  sourceVersion: { client: '16.17', official: '16.17.1' },
  sourceSnapshotSha256: digestOf('03-来源快照.json'),
  cursorOriginalSummary: sourceSnapshot.cursorOriginalSummary,
  expectedCurrent,
  observedCurrent: {
    skillCount: initialInventory.skillKeys.length,
    ruleCount: currentRuleCount,
    sourceInitializedCount,
    stableRead: stable
  },
  targetRulesBefore: targetRecords.map((record) => ({ skillKey: record.skillKey, ruleKeys: targetRuleKeys(record) })),
  descriptionChecks,
  conflicts,
  plannedRuleAdds: writeEntries.filter((entry) => entry.kind === '新增触发规则').length,
  plannedWrites: writeEntries.length,
  writes: writeEntries
};
writeJson('02-冻结请求.json', frozen);

const baseline = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  baseUrl,
  requestPolicy: {
    method: 'GET',
    authorizationValueRecorded: false,
    businessWriteIssued: false
  },
  sourceSnapshotSha256: digestOf('03-来源快照.json'),
  frozenRequestSha256: digestOf('02-冻结请求.json'),
  expectedCurrent,
  observedCurrent: frozen.observedCurrent,
  stableVerification: {
    secondScanSkillCount: stableInventory.skillKeys.length,
    secondScanRuleCount: stableInventory.ruleRefs.length,
    secondScanRuleKeysSha256: sha256(Buffer.from(JSON.stringify(stableRuleKeys), 'utf8')),
    stableSkillKeys,
    stableRuleSet,
    stableCounts
  },
  getCount,
  businessWrites: 0,
  targets: targetRecords,
  allSkillRuleScan: {
    skillsCatalog: initialInventory.skillsResponse,
    skillCount: initialInventory.skillKeys.length,
    ruleListCount: initialInventory.lists.length,
    ruleSummaryCount: initialInventory.ruleRefs.length,
    ruleLists: initialInventory.lists.map(({ skillKey, response, rules, ruleKeys }) => ({ skillKey, response, rules, ruleKeys })),
    ruleDetails: initialInventory.details
  },
  allSkillRuleScanSecondPass: {
    skillCount: stableInventory.skillKeys.length,
    ruleListCount: stableInventory.lists.length,
    ruleSummaryCount: stableInventory.ruleRefs.length,
    skillKeys: stableInventory.skillKeys,
    ruleKeys: stableRuleKeys,
    requestStatuses: {
      skills: stableInventory.skillsResponse.status,
      triggerRuleLists: stableInventory.lists.every(({ response }) => response.status === 200) ? 200 : null
    }
  },
  preservation: {
    existingRuleCount: currentRuleCount,
    existingRuleKeys: initialRuleKeys,
    existingRuleObjects: initialInventory.details,
    expectedFinalRuleCount: 96,
    expectedNewRuleKeys: ['olaf_w/on_used', 'garen_r/on_hit']
  }
};
writeJson('04-写入前现值.json', baseline);

console.log(JSON.stringify({
  status: frozen.status,
  writable: frozen.writable,
  targetSkills: targetRecords.length,
  skillCount: initialInventory.skillKeys.length,
  currentRuleCount,
  sourceInitializedCount,
  stableRead: stable,
  plannedRuleAdds: frozen.plannedRuleAdds,
  plannedWrites: frozen.plannedWrites,
  getCount,
  sourceFileCount: sourceSnapshot.sources.length,
  sourceSnapshotSha256: digestOf('03-来源快照.json'),
  frozenRequestSha256: digestOf('02-冻结请求.json'),
  baselineSha256: digestOf('04-写入前现值.json'),
  conflicts
}, null, 2));
