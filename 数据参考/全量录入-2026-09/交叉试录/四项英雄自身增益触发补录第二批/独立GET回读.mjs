import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRule, expectedCurrent, targetConfigs } from './批次配置.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
if (!token) throw new Error('缺少非空 DAMAGE_ENTRY_TOKEN；令牌不会保存或输出。');
const baseUrl = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
const files = Object.fromEntries([['frozen', '02-冻结请求.json'], ['preflight', '04-写入前现值.json'], ['write', '06-写入与即时回读.json'], ['output', '07-独立GET回读.json']].map(([key, name]) => [key, path.join(here, name)]));
if (fs.existsSync(files.output)) throw new Error('07-独立GET回读.json 已存在，拒绝覆盖。');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const shaBytes = value => crypto.createHash('sha256').update(value).digest('hex');
function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (!value || typeof value !== 'object') return value; return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])); }
const canonicalSha = value => shaBytes(JSON.stringify(canonical(value)));
function withoutTimestamps(value) { if (Array.isArray(value)) return value.map(withoutTimestamps); if (!value || typeof value !== 'object') return value; return Object.fromEntries(Object.entries(value).filter(([key]) => !['createdAt', 'updatedAt'].includes(key)).map(([key, item]) => [key, withoutTimestamps(item)])); }
function normalizeRule(value) { const eventType = value.eventSource.eventType; return canonical({ ruleKey: value.ruleKey, name: value.name, description: value.description ?? null, sortOrder: value.sortOrder, eventSource: { eventType, detail: eventType === 'SOURCE_INITIALIZED' ? {} : { sourceSkillKey: value.eventSource.detail?.sourceSkillKey ?? null, useKind: value.eventSource.detail?.useKind ?? null } }, conditionGroups: value.conditionGroups || [], actions: value.actions || [], perTargetCooldown: value.perTargetCooldown ?? null, maxTriggersPerProcess: value.maxTriggersPerProcess ?? null }); }
async function mapLimit(values, limit, worker) { const result = new Array(values.length); let cursor = 0; async function run() { while (cursor < values.length) { const index = cursor++; result[index] = await worker(values[index], index); } } await Promise.all(Array.from({ length: Math.min(limit, values.length) }, run)); return result; }

const log = [];
async function get(relativePath) { const response = await fetch(baseUrl + relativePath, { method: 'GET', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) }); log.push({ method: 'GET', path: relativePath, status: response.status }); assert.equal(response.status, 200, relativePath + ' 非200'); return response.json(); }
const collections = [{ path: 'parameters', key: 'parameterKey' }, { path: 'formulas', key: 'formulaKey' }, { path: 'effects', key: 'effectKey' }, { path: 'processes', key: 'processKey' }, { path: 'internal-states', key: 'stateKey' }];

async function captureComposition(config) {
  const prefix = '/skills/' + encodeURIComponent(config.skillKey);
  const skill = withoutTimestamps(await get(prefix));
  const relation = withoutTimestamps(await get('/character-skill-relations?skillKey=' + encodeURIComponent(config.skillKey)));
  const image = withoutTimestamps(await get(prefix + '/representative-image'));
  const values = {};
  for (const collection of collections) {
    const list = await get(prefix + '/' + collection.path);
    const summaries = [...list].sort((left, right) => String(left[collection.key]).localeCompare(String(right[collection.key])));
    const details = [];
    for (const item of summaries) details.push(withoutTimestamps(await get(prefix + '/' + collection.path + '/' + encodeURIComponent(item[collection.key]))));
    values[collection.path] = { summaries: withoutTimestamps(summaries), details };
  }
  return { nonRule: { skill, relation, image, collections: values }, ruleSummaries: withoutTimestamps(await get(prefix + '/trigger-rules')) };
}

async function captureAllRules() {
  const document = await get('/skills');
  assert.equal(document.total, expectedCurrent.skillCount);
  const skillKeys = document.items.map(item => item.skillKey).sort();
  const lists = await mapLimit(skillKeys, 8, async skillKey => ({ skillKey, summaries: await get('/skills/' + encodeURIComponent(skillKey) + '/trigger-rules') }));
  const identities = lists.flatMap(item => item.summaries.map(summary => ({ skillKey: item.skillKey, ruleKey: summary.ruleKey }))).sort((left, right) => left.skillKey.localeCompare(right.skillKey) || left.ruleKey.localeCompare(right.ruleKey));
  const rules = await mapLimit(identities, 8, async identity => ({ ...identity, detail: normalizeRule(await get('/skills/' + encodeURIComponent(identity.skillKey) + '/trigger-rules/' + encodeURIComponent(identity.ruleKey))) }));
  return { skillCount: skillKeys.length, skillKeysSha256: canonicalSha(skillKeys), ruleCount: rules.length, sourceInitializedCount: rules.filter(item => item.detail.eventSource.eventType === 'SOURCE_INITIALIZED').length, rules, rulesSha256: canonicalSha(rules) };
}

const frozen = readJson(files.frozen);
const preflight = readJson(files.preflight);
const write = readJson(files.write);
assert.equal(write.status, 'PASS');
assert.equal(write.frozenBatchSha256, frozen.batchSha256);
assert.equal(write.businessWrites + write.alreadyLanded, targetConfigs.length);
const currentRules = await captureAllRules();
assert.equal(currentRules.ruleCount, expectedCurrent.finalRuleCount);
assert.equal(currentRules.sourceInitializedCount, expectedCurrent.finalSourceInitializedCount);
assert.equal(currentRules.skillKeysSha256, preflight.globalRules.skillKeysSha256);
const targets = new Set(targetConfigs.map(item => item.skillKey + '/' + item.ruleKey));
const oldRules = currentRules.rules.filter(item => !targets.has(item.skillKey + '/' + item.ruleKey));
assert.equal(oldRules.length, expectedCurrent.ruleCount);
assert.equal(canonicalSha(oldRules), preflight.globalRules.rulesSha256, '既有规则集合发生变化');
const byIdentity = new Map(currentRules.rules.map(item => [item.skillKey + '/' + item.ruleKey, item.detail]));
const targetChecks = [];
for (const config of targetConfigs) {
  const identity = config.skillKey + '/' + config.ruleKey;
  assert.deepEqual(byIdentity.get(identity), normalizeRule(buildRule(config)), '新增规则不符：' + identity);
  const captured = await captureComposition(config);
  const nonRuleSha256 = canonicalSha(captured.nonRule);
  const before = preflight.targets.find(item => item.id === config.id);
  assert.equal(nonRuleSha256, before.nonRuleSha256, '目标非规则组成变化：' + config.skillKey);
  assert.equal(captured.ruleSummaries.length, 1);
  assert.equal(captured.ruleSummaries[0].ruleKey, config.ruleKey);
  targetChecks.push({ id: config.id, skillKey: config.skillKey, ruleKey: config.ruleKey, effectKeys: config.actions.map(action => action.effectKey), nonRuleSha256, ruleSha256: canonicalSha(byIdentity.get(identity)) });
}
assert(log.every(item => item.method === 'GET' && item.status === 200));
const output = { schemaVersion: 1, capturedAt: new Date().toISOString(), status: 'PASS', methodPolicy: 'GET_ONLY', authorizationValueRecorded: false, businessWrites: 0, getCount: log.length, statusCounts: { 200: log.length }, skillCount: currentRules.skillCount, ruleCount: currentRules.ruleCount, sourceInitializedCount: currentRules.sourceInitializedCount, oldRulesCount: oldRules.length, oldRulesSha256: canonicalSha(oldRules), allRulesSha256: currentRules.rulesSha256, targetChecks, requestPathsSha256: canonicalSha(log.map(item => item.path)), boundary: '独立检查器只发GET；既有135条规则与四项非规则组成不变，四条新增规则精确匹配冻结请求。Wasm、宿主和真实战斗未执行。' };
fs.writeFileSync(files.output, JSON.stringify(output, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
process.stdout.write(JSON.stringify({ status: output.status, getCount: output.getCount, skillCount: output.skillCount, ruleCount: output.ruleCount, sourceInitializedCount: output.sourceInitializedCount, oldRulesCount: output.oldRulesCount, targetChecks: output.targetChecks, businessWrites: 0 }, null, 2));
