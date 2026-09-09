import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readBytes = name => fs.readFileSync(path.join(here, name));
const readJson = name => JSON.parse(readBytes(name));
const writeNew = (name, value) => {
  const target = path.join(here, name);
  if (fs.existsSync(target)) throw new Error(`${name}已存在，修订一禁止覆盖`);
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  fs.writeFileSync(target, bytes, { flag: 'wx' });
  return bytes;
};

const candidateBytes = readBytes('修订一候选.json');
const candidate = JSON.parse(candidateBytes);
const versionBytes = readBytes('修订一候选版本.json');
const version = JSON.parse(versionBytes);
const protectionBytes = readBytes('修订一写前保护.json');
const protection = JSON.parse(protectionBytes);
const originalBytes = readBytes('写前现值.json');
const original = JSON.parse(originalBytes);
const candidateSha256 = sha256(candidateBytes);
const candidatePlanSha256 = sha256(Buffer.from(JSON.stringify(candidate)));
const expectedCandidateSha256 = 'bb0306ca12eadabdad3d05aacb606b347bd393ffc7aa17205da345e3da08e97c';
const expectedCandidatePlanSha256 = 'aa89ecca3c72b8d4bb02a1a87180e7ac6050b5cbf267a484808e0353fd783e64';
if (candidateSha256 !== expectedCandidateSha256) throw new Error(`修订一候选散列不符：${candidateSha256}`);
if (candidatePlanSha256 !== expectedCandidatePlanSha256 || version.planSha256 !== expectedCandidatePlanSha256) throw new Error(`修订一候选计划散列不符：${candidatePlanSha256}`);
if (protection.summary?.requestCount !== 188 || protection.summary?.errorCount !== 0 || protection.summary?.apiWrites !== 0) throw new Error('修订一写前保护不是188次GET、0失败、0写入');

const order = ['riven', 'aatrox', 'rengar', 'khazix'].flatMap(hero => ['p', 'q', 'w', 'e', 'r'].map(slot => `${hero}_${slot}`));
const kinds = [
  ['parameters', 'parameterKey', 'parameters'],
  ['formulas', 'formulaKey', 'formulas'],
  ['effects', 'effectKey', 'effects'],
  ['processes', 'processKey', 'processes'],
  ['internalStates', 'stateKey', 'internal-states'],
  ['triggerRules', 'ruleKey', 'trigger-rules'],
];
if (!isDeepStrictEqual(Object.keys(candidate.skills ?? {}), order)) throw new Error('修订一候选必须精确覆盖20个技能槽');

const detailMap = new Map();
const listMap = new Map();
for (const skillKey of order) {
  const skill = protection.skills?.[skillKey];
  if (!skill?.subject?.ok) throw new Error(`缺技能主体保护 ${skillKey}`);
  for (const [kind, , idField] of kinds) {
    const component = skill.components?.[kind];
    if (!component) throw new Error(`缺六类列表保护 ${skillKey}/${kind}`);
    listMap.set(`${skillKey}/${kind}`, component.items ?? []);
    for (const entry of component.details ?? []) {
      if (entry.id && entry.detail?.ok) detailMap.set(`${skillKey}/${kind}/${entry.id}`, entry.detail.data);
    }
  }
}
if (detailMap.size !== 16) throw new Error(`已有公共详情应为16项，实际${detailMap.size}项`);
if (protection.summary?.existingNonPublicCount !== 0) throw new Error('当前已有非公共组成，停止生成修订一写前计划');

const reusedSet = new Set();
const reusedPublicParameters = [];
const requests = [];
const metadataDifferences = [];
const candidateEntries = [];
const bodyKey = (skillKey, kind, id) => `${skillKey}/${kind}/${id}`;
for (const skillKey of order) {
  const skill = candidate.skills[skillKey];
  for (const [kind, idField, apiKind] of kinds) {
    const rows = skill.write?.[kind] ?? [];
    const currentRows = listMap.get(`${skillKey}/${kind}`) ?? [];
    const currentIds = new Set(currentRows.map(row => row[idField]));
    for (const body of rows) {
      const id = body?.[idField];
      if (typeof id !== 'string') throw new Error(`组成缺稳定键 ${skillKey}/${kind}`);
      const identity = bodyKey(skillKey, kind, id);
      if (candidateEntries.some(entry => entry.identity === identity)) throw new Error(`候选组成重复 ${identity}`);
      candidateEntries.push({ identity, skillKey, kind, id, body });
      const existing = detailMap.get(identity);
      const isReused = kind === 'parameters' && (skill.reusedParameters ?? []).includes(id);
      if (existing !== undefined) {
        if (!isReused) throw new Error(`候选已有未声明复用组成 ${identity}`);
        const valueFields = ['valueType', 'valueMode', 'fixedValue', 'levelValues'];
        for (const field of valueFields) if (!isDeepStrictEqual(body[field], existing[field])) throw new Error(`公共参数值不一致 ${identity}/${field}`);
        const differingFields = Object.keys(body).filter(field => !isDeepStrictEqual(body[field], existing[field]));
        if (differingFields.length) metadataDifferences.push({ skillKey, parameterKey: id, fields: differingFields, policy: '完整保护并复用原参数，不发更新请求' });
        reusedSet.add(identity);
        reusedPublicParameters.push({ skillKey, parameterKey: id, identity });
        continue;
      }
      if (isReused) throw new Error(`声明复用参数当前缺失 ${identity}`);
      requests.push({
        method: 'POST',
        route: `/skills/${skillKey}/${apiKind}`,
        detailRoute: `/skills/${skillKey}/${apiKind}/${encodeURIComponent(id)}`,
        skillKey,
        kind,
        stableKey: id,
        body,
      });
      if (!currentIds.has(id)) continue;
    }
  }
}

const counts = Object.fromEntries(kinds.map(([kind]) => [kind, requests.filter(request => request.kind === kind).length]));
const candidateCounts = Object.fromEntries(kinds.map(([kind]) => [kind, order.reduce((sum, skillKey) => sum + candidate.skills[skillKey].write[kind].length, 0)]));
if (reusedPublicParameters.length !== 16 || requests.length !== 175) throw new Error(`修订一计划应为16复用、175新增，实际${reusedPublicParameters.length}/${requests.length}`);
if (!isDeepStrictEqual(counts, { parameters: 141, formulas: 26, effects: 8, processes: 0, internalStates: 0, triggerRules: 0 })) throw new Error(`修订一新增组成计数不符：${JSON.stringify(counts)}`);
if (candidateCounts.parameters !== 157 || candidateCounts.formulas !== 26 || candidateCounts.effects !== 8) throw new Error(`修订一候选组成计数不符：${JSON.stringify(candidateCounts)}`);
if (requests.some(request => request.method !== 'POST' || !['parameters', 'formulas', 'effects'].includes(request.kind))) throw new Error('写前计划含非允许POST');
if (new Set(requests.map(request => bodyKey(request.skillKey, request.kind, request.stableKey))).size !== requests.length) throw new Error('写前计划稳定键重复');

const report = {
  at: new Date().toISOString(),
  revision: '修订一',
  status: '仅准备POST意图，未获本批业务写入授权',
  source: 'client16.17/official16.17.1',
  policy: {
    businessWrites: 0,
    apiCalls: 0,
    method: '只生成冻结计划，不执行请求',
    endpoint: 'http://127.0.0.1:8080/api/admin/games/lol',
    bearer: '由开发环境提供；认证值不写入文件',
  },
  basedOnCandidateSha256: 'cb3dbab26bc3fc5949d1fbc193ac28da71887f0e743c1ead4885a24fc7739824',
  candidateSha256,
  candidatePlanSha256,
  candidateVersionFileSha256: sha256(versionBytes),
  protectionSha256: sha256(protectionBytes),
  originalSnapshotSha256: sha256(originalBytes),
  currentGet: protection.summary,
  protectedReadOnly: {
    catalogs: 4,
    characters: 4,
    relations: 4,
    representativeImages: 20,
    skillSubjects: 20,
    sixKindLists: 120,
    publicParameterDetails: 16,
    apiWrites: 0,
  },
  reusedPublicParameters,
  metadataDifferences,
  candidateCounts,
  counts,
  requestCount: requests.length,
  newComponentIntents: requests.length,
  requests,
  apiWrites: 0,
};
const bytes = writeNew('修订一写前计划.json', report);
console.log(JSON.stringify({
  fileSha256: sha256(bytes),
  candidateSha256,
  candidatePlanSha256,
  candidateVersionFileSha256: report.candidateVersionFileSha256,
  protectionSha256: report.protectionSha256,
  requestCount: report.requestCount,
  counts,
  reusedPublicParameters: reusedPublicParameters.length,
  businessWrites: report.policy.businessWrites,
}, null, 2));
