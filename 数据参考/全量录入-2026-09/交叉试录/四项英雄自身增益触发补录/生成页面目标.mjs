import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const frozenPath = path.join(here, '02-冻结请求.json');
const readbackPath = path.join(here, '07-独立GET回读.json');
const outputPath = path.join(here, '08-页面目标.json');
if (fs.existsSync(outputPath)) throw new Error('08-页面目标.json 已存在，拒绝覆盖。');
const frozen = JSON.parse(fs.readFileSync(frozenPath, 'utf8'));
const readback = JSON.parse(fs.readFileSync(readbackPath, 'utf8'));
assert.equal(frozen.status, 'FROZEN');
assert.equal(readback.status, 'PASS');
const byIdentity = new Map(readback.targetChecks.map(item => [item.skillKey + '/' + item.ruleKey, item]));
const targets = frozen.requests.map(request => {
  const check = byIdentity.get(request.skillKey + '/' + request.ruleKey);
  assert(check, '独立回读缺少页面目标：' + request.id);
  assert.equal(check.effectKey, request.effectKey);
  return {
    id: request.id,
    skillKey: request.skillKey,
    ownerKey: request.ownerKey,
    effectKey: request.effectKey,
    ruleKey: request.ruleKey,
    ruleName: request.body.name,
    eventType: request.body.eventSource.eventType,
    actionKey: request.body.actions[0].actionKey,
    actionName: request.body.actions[0].name,
    expectedActionCount: request.body.actions.length,
    expectedConditionGroupCount: request.body.conditionGroups.length
  };
});
assert.equal(targets.length, 4);
const payload = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: 'PASS',
  source: '02-冻结请求.json与07-独立GET回读.json自动交集',
  targetCount: targets.length,
  targets,
  targetSha256: crypto.createHash('sha256').update(JSON.stringify(targets)).digest('hex'),
  boundary: '只包含已写入且独立回读通过的四项；没有把暂缓分支加入页面目标。'
};
fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
process.stdout.write(JSON.stringify({ status: payload.status, targetCount: payload.targetCount, targetSha256: payload.targetSha256, targets: payload.targets }, null, 2));
