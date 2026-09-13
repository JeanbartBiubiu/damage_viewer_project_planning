import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(here, '11-完整事件明细补充回读.json');
if (fs.existsSync(outputPath)) throw new Error('11-完整事件明细补充回读.json 已存在，拒绝覆盖。');

const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
if (!token) throw new Error('缺少非空 DAMAGE_ENTRY_TOKEN；令牌不会保存或输出。');
const baseUrl = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const shaBytes = value => crypto.createHash('sha256').update(value).digest('hex');
const fileSha = file => shaBytes(fs.readFileSync(file));

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

const canonicalSha = value => shaBytes(JSON.stringify(canonical(value)));

function fullRule(value) {
  return canonical({
    ruleKey: value.ruleKey,
    name: value.name,
    description: value.description ?? null,
    sortOrder: value.sortOrder,
    eventSource: value.eventSource,
    conditionGroups: value.conditionGroups || [],
    actions: value.actions || [],
    perTargetCooldown: value.perTargetCooldown ?? null,
    maxTriggersPerProcess: value.maxTriggersPerProcess ?? null
  });
}

function priorNormalizer(value) {
  const eventType = value.eventSource.eventType;
  return canonical({
    ruleKey: value.ruleKey,
    name: value.name,
    description: value.description ?? null,
    sortOrder: value.sortOrder,
    eventSource: {
      eventType,
      detail: eventType === 'SOURCE_INITIALIZED' ? {} : {
        sourceSkillKey: value.eventSource.detail?.sourceSkillKey ?? null,
        useKind: value.eventSource.detail?.useKind ?? null
      }
    },
    conditionGroups: value.conditionGroups || [],
    actions: value.actions || [],
    perTargetCooldown: value.perTargetCooldown ?? null,
    maxTriggersPerProcess: value.maxTriggersPerProcess ?? null
  });
}

async function mapLimit(values, limit, worker) {
  const result = new Array(values.length);
  let cursor = 0;
  async function run() {
    while (cursor < values.length) {
      const index = cursor++;
      result[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, run));
  return result;
}

const log = [];
async function get(relativePath) {
  const response = await fetch(baseUrl + relativePath, {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000)
  });
  log.push({ method: 'GET', path: relativePath, status: response.status });
  assert.equal(response.status, 200, relativePath + ' 非200');
  return response.json();
}

const frozen = readJson(path.join(here, '02-冻结请求.json'));
const write = readJson(path.join(here, '06-写入与即时回读.json'));
const review = readJson(path.join(here, '05-独立写前评审.json'));
const originalManifest = path.join(here, '10-证据清单.json');
const priorReadbackPath = path.join(here, '..', '四项英雄自身增益触发补录第二批', '07-独立GET回读.json');
const priorReadback = readJson(priorReadbackPath);
assert.equal(write.status, 'PASS');
assert.equal(write.businessWrites, 3);
assert.equal(write.requestAudit.methods.POST, 3);
assert.equal(review.status, 'APPROVED');
assert.equal(review.approvedBatchSha256, frozen.batchSha256);
assert.equal(priorReadback.ruleCount, 139);
assert.equal(priorReadback.allRulesSha256, 'cc6631f602cd5976e458be90f95e381428ea14f6555fdb31ac6f8e67d8e34d03');

const document = await get('/skills');
assert.equal(document.total, 1062);
const skillKeys = document.items.map(item => item.skillKey).sort();
const lists = await mapLimit(skillKeys, 8, async skillKey => ({
  skillKey,
  summaries: await get('/skills/' + encodeURIComponent(skillKey) + '/trigger-rules')
}));
const identities = lists.flatMap(item => item.summaries.map(summary => ({
  skillKey: item.skillKey,
  ruleKey: summary.ruleKey,
  summaryUpdatedAt: summary.updatedAt,
  summaryEventType: summary.eventType
}))).sort((left, right) => left.skillKey.localeCompare(right.skillKey) || left.ruleKey.localeCompare(right.ruleKey));
assert.equal(identities.length, 142);
const rules = await mapLimit(identities, 8, async identity => ({
  ...identity,
  detail: fullRule(await get('/skills/' + encodeURIComponent(identity.skillKey) + '/trigger-rules/' + encodeURIComponent(identity.ruleKey)))
}));

const targetIds = new Set(frozen.requests.map(item => item.skillKey + '/' + item.ruleKey));
const oldRules = rules.filter(item => !targetIds.has(item.skillKey + '/' + item.ruleKey));
const newRules = rules.filter(item => targetIds.has(item.skillKey + '/' + item.ruleKey));
assert.equal(oldRules.length, 139);
assert.equal(newRules.length, 3);
assert.equal(rules.filter(item => item.detail.eventSource.eventType === 'SOURCE_INITIALIZED').length, 29);

const legacyOldRules = oldRules.map(item => ({
  skillKey: item.skillKey,
  ruleKey: item.ruleKey,
  detail: priorNormalizer(item.detail)
}));
assert.equal(canonicalSha(legacyOldRules), priorReadback.allRulesSha256, '旧139条规则的既有规范化散列变化');

const byId = new Map(rules.map(item => [item.skillKey + '/' + item.ruleKey, item]));
for (const request of frozen.requests) {
  const current = byId.get(request.skillKey + '/' + request.ruleKey);
  assert(current, '缺少新增规则：' + request.id);
  assert.deepEqual(current.detail, fullRule(request.body), '新增规则完整事件明细不符：' + request.id);
}

const reviewAt = Date.parse(review.capturedAt);
assert(Number.isFinite(reviewAt));
const oldAfterReview = oldRules.filter(item => Date.parse(item.summaryUpdatedAt) >= reviewAt);
const newBeforeReview = newRules.filter(item => Date.parse(item.summaryUpdatedAt) < reviewAt);
assert.equal(oldAfterReview.length, 0, '存在独立批准后更新的旧规则');
assert.equal(newBeforeReview.length, 0, '新增规则更新时间早于独立批准');
assert(log.every(item => item.method === 'GET' && item.status === 200));

const nonGetPaths = write.requestAudit.nonGetPaths;
assert.deepEqual(nonGetPaths, frozen.requests.map(item => ({ method: 'POST', path: item.route })));
const fullOldRules = oldRules.map(item => ({
  skillKey: item.skillKey,
  ruleKey: item.ruleKey,
  summaryUpdatedAt: item.summaryUpdatedAt,
  detail: item.detail
}));
const fullRules = rules.map(item => ({
  skillKey: item.skillKey,
  ruleKey: item.ruleKey,
  summaryUpdatedAt: item.summaryUpdatedAt,
  detail: item.detail
}));
const output = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  status: 'PASS_WITH_CORRECTION',
  methodPolicy: 'GET_ONLY',
  authorizationValueRecorded: false,
  businessWrites: 0,
  correction: {
    affectedFiles: ['04-写入前现值.json', '05-独立写前评审.json', '07-独立GET回读.json', '10-证据清单.json'],
    originalLimitation: '原批次的全量规则规范化把所有事件明细缩成空对象，因而原“旧139条规则不变”散列没有覆盖非初始化事件的来源技能、使用种类及其他事件专属明细。',
    unaffectedProof: '三个新增规则本身都是空明细SOURCE_INITIALIZED，完整请求体比较和三条POST结果不受该规范化缺口影响；写入流水只有三个新增路由。',
    repairedProof: '本轮保存142条规则的完整eventSource.detail当前基线；旧139条规则仍匹配上一批较完整的既有规范化散列，且独立批准后没有任何旧规则更新时间。'
  },
  sourceEvidence: {
    frozenBatchSha256: frozen.batchSha256,
    originalManifestSha256: fileSha(originalManifest),
    priorReadbackRelativePath: '../四项英雄自身增益触发补录第二批/07-独立GET回读.json',
    priorReadbackSha256: fileSha(priorReadbackPath),
    priorRuleCount: priorReadback.ruleCount,
    priorCanonicalRulesSha256: priorReadback.allRulesSha256,
    scriptSha256: fileSha(fileURLToPath(import.meta.url))
  },
  requestAudit: {
    getCount: log.length,
    statusCounts: { 200: log.length },
    pathsSha256: canonicalSha(log.map(item => item.path))
  },
  current: {
    skillCount: skillKeys.length,
    ruleCount: rules.length,
    sourceInitializedCount: 29,
    oldRulesCount: oldRules.length,
    newRulesCount: newRules.length,
    legacyOldRulesSha256: canonicalSha(legacyOldRules),
    fullOldRulesSha256: canonicalSha(fullOldRules),
    fullAllRulesSha256: canonicalSha(fullRules)
  },
  timestampAudit: {
    independentApprovalAt: review.capturedAt,
    oldRulesAtOrAfterApproval: oldAfterReview.length,
    newRulesBeforeApproval: newBeforeReview.length,
    latestOldRuleUpdatedAt: oldRules.map(item => item.summaryUpdatedAt).sort().at(-1),
    newRuleUpdatedAt: newRules.map(item => ({ skillKey: item.skillKey, ruleKey: item.ruleKey, updatedAt: item.summaryUpdatedAt }))
  },
  writeRouteAudit: {
    businessWrites: write.businessWrites,
    methods: write.requestAudit.methods,
    nonGetPaths
  },
  rules: fullRules,
  boundary: '补充回读修正旧规则全量散列的事件明细覆盖口径，并建立可供后续精确比较的当前142条完整规则基线；不新增或修改业务数据。'
};
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
process.stdout.write(JSON.stringify({
  status: output.status,
  getCount: output.requestAudit.getCount,
  current: output.current,
  timestampAudit: output.timestampAudit,
  writeRouteAudit: output.writeRouteAudit,
  businessWrites: 0
}, null, 2));
