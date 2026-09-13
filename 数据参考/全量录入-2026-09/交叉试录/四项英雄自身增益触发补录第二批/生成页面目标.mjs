import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(here, '08-页面目标.json');
if (fs.existsSync(output)) throw new Error('08-页面目标.json 已存在，拒绝覆盖。');
const frozen = JSON.parse(fs.readFileSync(path.join(here, '02-冻结请求.json'), 'utf8'));
const readback = JSON.parse(fs.readFileSync(path.join(here, '07-独立GET回读.json'), 'utf8'));
assert.equal(frozen.status, 'FROZEN'); assert.equal(readback.status, 'PASS');
const checks = new Map(readback.targetChecks.map(item => [item.skillKey + '/' + item.ruleKey, item]));
const targets = frozen.requests.map(request => {
  const check = checks.get(request.skillKey + '/' + request.ruleKey); assert(check); assert.deepEqual(check.effectKeys, request.effectKeys);
  return { id: request.id, skillKey: request.skillKey, ownerKey: request.ownerKey, effectKeys: request.effectKeys, ruleKey: request.ruleKey, ruleName: request.body.name, eventType: request.body.eventSource.eventType, actions: request.body.actions.map(action => ({ actionKey: action.actionKey, actionName: action.name, effectKey: action.detail.effectKey, targetContext: action.targetContext })), expectedActionCount: request.body.actions.length, expectedConditionGroupCount: request.body.conditionGroups.length };
});
const payload = { schemaVersion: 1, generatedAt: new Date().toISOString(), status: 'PASS', source: '冻结请求与独立GET回读自动交集', targetCount: targets.length, targets, targetSha256: crypto.createHash('sha256').update(JSON.stringify(targets)).digest('hex'), boundary: '只包含已写入且独立回读通过的四项，暂缓分支不进入页面目标。' };
fs.writeFileSync(output, JSON.stringify(payload, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' }); process.stdout.write(JSON.stringify({ status: payload.status, targetCount: payload.targetCount, targetSha256: payload.targetSha256, targets }, null, 2));
