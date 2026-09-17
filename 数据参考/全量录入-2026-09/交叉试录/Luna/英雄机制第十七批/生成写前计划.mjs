import fs from 'node:fs';
import { createHash } from 'node:crypto';

const here = new URL('./', import.meta.url);
const candidateBytes = fs.readFileSync(new URL('完整候选.json', here));
const candidate = JSON.parse(candidateBytes);
const readOnlyBytes = fs.readFileSync(new URL('只读保护与公共参数.json', here));
const readOnly = JSON.parse(readOnlyBytes);

if (readOnly.summary?.requests !== 53 || readOnly.summary?.failures !== 0 || readOnly.summary?.apiWrites !== 0) {
  throw Error('只读保护证据不是53个请求、0失败、0写入，禁止生成写前计划。');
}
if (candidate.meta?.apiWrites !== 0) throw Error('候选已带业务写入标记，禁止生成写前计划。');

const routes = {
  parameters: 'parameters',
  formulas: 'formulas',
  effects: 'effects',
  processes: 'processes',
  internalStates: 'internal-states',
  triggerRules: 'trigger-rules'
};
const requests = [];
const reused = [];
const order = Object.keys(candidate.skills);

for (const skillKey of order) {
  const skill = candidate.skills[skillKey];
  const reusedSet = new Set(skill.reusedParameters ?? []);
  for (const parameterKey of skill.reusedParameters ?? []) reused.push({ skillKey, parameterKey });
  for (const [kind, rows] of Object.entries(skill.write)) {
    const routePart = routes[kind];
    if (!routePart) throw Error('未知组成类别 ' + kind);
    for (const body of rows) {
      const stableKey = body.parameterKey ?? body.formulaKey ?? body.effectKey ?? body.processKey ?? body.stateKey ?? body.ruleKey;
      if (!stableKey) throw Error('写前组成缺稳定键 ' + skillKey + '/' + kind);
      if (kind === 'parameters' && reusedSet.has(stableKey)) continue;
      requests.push({ method: 'POST', route: '/skills/' + skillKey + '/' + routePart, skillKey, kind, stableKey, body });
    }
  }
}

const counts = Object.fromEntries(Object.keys(routes).map(kind => [kind, requests.filter(item => item.kind === kind).length]));
const candidatePlanSha256 = createHash('sha256').update(JSON.stringify(candidate)).digest('hex');
const candidateSha256 = createHash('sha256').update(candidateBytes).digest('hex');
const readOnlySha256 = createHash('sha256').update(readOnlyBytes).digest('hex');
const report = {
  at: new Date().toISOString(),
  status: '仅准备POST意图，未获本批业务写入授权',
  policy: {
    businessWrites: 0,
    apiCalls: 0,
    method: '只生成冻结计划，不执行请求',
    endpoint: 'http://127.0.0.1:8080/api/admin/games/lol',
    bearer: '由开发环境提供；认证值不写入文件'
  },
  scope: candidate.meta.scope,
  source: 'client16.17/official16.17.1',
  candidateSha256,
  candidatePlanSha256,
  readOnlySha256,
  selectionSourceSha256: readOnly.selectionSourceSha256,
  currentReadOnly: readOnly.summary,
  protectedReadOnly: {
    publicParameterDetails: 22,
    characters: 4,
    characterSkillRelations: 4,
    representativeImages: 20,
    catalogs: 3,
    apiWrites: 0
  },
  reusedPublicParameters: reused,
  counts,
  requestCount: requests.length,
  requests
};

fs.writeFileSync(new URL('写前计划.json', here), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({
  status: report.status,
  requestCount: report.requestCount,
  counts,
  reusedPublicParameters: reused.length,
  apiCalls: 0,
  businessWrites: 0,
  candidateSha256,
  readOnlySha256
}, null, 2));
