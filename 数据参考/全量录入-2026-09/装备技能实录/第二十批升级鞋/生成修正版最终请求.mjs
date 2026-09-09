import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATE_PATH = path.join(HERE, '修正版最终候选.json');
const SOURCE_PATH = path.join(HERE, '冻结来源.json');
const BEFORE_PATH = path.join(HERE, '写前保护快照.json');
const OUTPUT_PATH = path.join(HERE, '修正版最终请求.json');
const EXPECTED_CANDIDATE_SHA = '9dc1b9628720c0afc91d9e835649ae6899dd9bfcbacac136fae7c7081ab79f62';
const EXPECTED_SOURCE_SHA = '3861cdd2d66da43deb99aca9c085c894258f58a21bfdfc967b9feaa71203e649';
const EXPECTED_BEFORE_SHA = 'b928abf4069b9a1b65f5eba0801bc3ecf72035b86f793eee523e440222aef463';

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function clone(value) { return structuredClone(value); }
function fail(message) { throw new Error(message); }

const candidateSha = sha(CANDIDATE_PATH);
const sourceSha = sha(SOURCE_PATH);
const beforeSha = sha(BEFORE_PATH);
if (candidateSha !== EXPECTED_CANDIDATE_SHA) fail(`修正版候选哈希变化：${candidateSha}`);
if (sourceSha !== EXPECTED_SOURCE_SHA) fail(`冻结来源哈希变化：${sourceSha}`);
if (beforeSha !== EXPECTED_BEFORE_SHA) fail(`写前快照哈希变化：${beforeSha}`);

const candidate = readJson(CANDIDATE_PATH);
const source = readJson(SOURCE_PATH);
const before = readJson(BEFORE_PATH);
if (candidate.apiWrites !== 0 || before.apiWrites !== 0 || before.noBusinessWrites !== true) fail('发现非只读标记');
if (candidate.sourceFreezeSha256 !== sourceSha || candidate.currentSnapshotSha256 !== beforeSha) fail('候选未绑定冻结来源或写前快照');
if (candidate.objects.length !== 5) fail('候选技能数量不是5');

const selected = candidate.objects.map(object => ({
  equipmentKey: object.equipmentKey,
  skillKey: object.skillKey,
  equipmentName: object.equipmentName,
  skillName: object.apiPayload.skill.name,
}));
const sourceKeys = source.objects.map(object => object.equipmentKey);
if (JSON.stringify(sourceKeys) !== JSON.stringify(selected.map(x => x.equipmentKey))) fail('候选范围与冻结来源不一致');

const requests = [];
for (const object of candidate.objects) {
  const skillPath = `/skills/${encodeURIComponent(object.skillKey)}`;
  const payload = object.apiPayload;
  if (JSON.stringify(payload.skill.skillCategoryKeys) !== JSON.stringify(['passive'])) fail(`${object.skillKey}分类不是passive`);
  requests.push({
    sequence: requests.length + 1,
    kind: 'skill', equipmentKey: object.equipmentKey, skillKey: object.skillKey,
    method: 'POST', route: '/skills', readRoute: skillPath,
    body: clone(payload.skill),
  });
  for (const body of payload.parameters ?? []) {
    requests.push({
      sequence: requests.length + 1,
      kind: 'parameter', equipmentKey: object.equipmentKey, skillKey: object.skillKey,
      method: 'POST', route: `${skillPath}/parameters`,
      readRoute: `${skillPath}/parameters/${encodeURIComponent(body.parameterKey)}`,
      body: clone(body),
    });
  }
  for (const body of payload.formulas ?? []) {
    requests.push({
      sequence: requests.length + 1,
      kind: 'formula', equipmentKey: object.equipmentKey, skillKey: object.skillKey,
      method: 'POST', route: `${skillPath}/formulas`,
      readRoute: `${skillPath}/formulas/${encodeURIComponent(body.formulaKey)}`,
      body: clone(body),
    });
  }
  for (const kind of ['effects', 'processes', 'internalStates', 'triggerRules']) {
    if ((payload[kind] ?? []).length !== 0) fail(`${object.skillKey}不应生成${kind}`);
  }
  requests.push({
    sequence: requests.length + 1,
    kind: 'relation', equipmentKey: object.equipmentKey, skillKey: object.skillKey,
    method: 'POST', route: '/equipment-skill-relations',
    readRoute: `/equipment-skill-relations?equipmentKey=${encodeURIComponent(object.equipmentKey)}`,
    body: clone(payload.relation),
  });
  requests.push({
    sequence: requests.length + 1,
    kind: 'representativeImage', equipmentKey: object.equipmentKey, skillKey: object.skillKey,
    method: 'PUT', route: `${skillPath}/representative-image`,
    readRoute: `${skillPath}/representative-image`,
    body: clone(payload.representativeImage),
  });
}

const requestSummary = Object.fromEntries(
  ['skill', 'parameter', 'formula', 'relation', 'representativeImage']
    .map(kind => [kind, requests.filter(request => request.kind === kind).length]),
);
requestSummary.total = requests.length;
const expected = { skill: 5, parameter: 28, formula: 5, relation: 5, representativeImage: 5, total: 48 };
if (JSON.stringify(requestSummary) !== JSON.stringify(expected)) fail(`请求计数错误：${JSON.stringify(requestSummary)}`);
if (requests.some(request => request.kind === 'skill' && JSON.stringify(request.body.skillCategoryKeys) !== JSON.stringify(['passive']))) fail('存在非passive技能分类');
if (requests.some(request => request.kind === 'parameter' && ['shield_breakpoint_level', 'shield_bonus_per_level'].includes(request.body.parameterKey))) fail('断点说明参数仍在请求中');

const output = {
  generatedAt: new Date().toISOString(),
  stage: '修正版最终候选对应的受保护请求清单，未写业务',
  gameId: 'lol',
  apiBaseUrl: 'http://127.0.0.1:8080/api/admin/games/lol',
  clientVersion: candidate.clientVersion,
  officialVersion: candidate.officialVersion,
  gameSourceBuild: candidate.gameSourceBuild,
  authHeaderPersisted: false,
  noApply: true,
  apiWrites: 0,
  candidateSha256: candidateSha,
  sourceSha256: sourceSha,
  beforeSha256: beforeSha,
  candidatePath: '修正版最终候选.json',
  sourcePath: '冻结来源.json',
  beforePath: '写前保护快照.json',
  scope: selected,
  requestSummary,
  requests,
  omittedComponentKinds: ['effects', 'processes', 'internalStates', 'triggerRules'],
  pendingTargetQualifications: candidate.pendingTargetQualifications ?? [],
  sourceOnly: {
    shieldBreakpointParameters: 'item_3173/item_3174 的等级断点9与每级加成10仅在来源核对报告中，未进入此请求。',
  },
};
if (fs.existsSync(OUTPUT_PATH)) fail(`修正版最终请求已存在：${OUTPUT_PATH}`);
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({
  outputPath: OUTPUT_PATH, requestSha256: sha(OUTPUT_PATH), candidateSha256: candidateSha,
  sourceSha256: sourceSha, beforeSha256: beforeSha, requestSummary, apiWrites: 0,
}));
