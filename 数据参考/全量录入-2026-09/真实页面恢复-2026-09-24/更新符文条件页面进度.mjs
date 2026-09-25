import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const [stepArg, pageName, number] = process.argv.slice(2), step = Number(stepArg);
assert(Number.isInteger(step) && step >= 2 && step <= 6);
assert(/^\d{2}-[^/\\]+\.json$/.test(pageName)); assert(/^\d{2}$/.test(number));
const read = file => JSON.parse(fs.readFileSync(path.join(here, file), 'utf8'));
const rel = '数据参考/全量录入-2026-09/真实页面恢复-2026-09-24/';
const pagePath = `执行代理/sol_rune_health_gate/${pageName}`;
const readbackPath = `符文生命门槛准备/11-页面独立回读-${step}.json`;
const page = read(pagePath), after = read(readbackPath), plan = read('符文生命门槛准备/10-页面候选待前端审查.json');
const writes = plan.candidates.flatMap(c => c.writes), current = writes[step - 1];
assert.equal(page.write.method, 'POST'); assert.equal(page.write.status, 201);
assert.equal(page.write.path, '/api/admin/games/lol' + current.route);
assert.deepEqual(page.write.body, current.body); assert(page.reopened);
assert.equal(page.after.visibleDialogs, 0); assert.equal(after.status, 'PASS'); assert.equal(after.step, step); assert.equal(after.audit.length, 38);
const ledgerPath = path.join(here, '..', '阶段进度.json'), ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const before = structuredClone(ledger), batch = ledger.mechanismBatches.conditionalDamageModifierReturn;
assert.equal(batch.independentlyVerifiedWrites, step - 1, '必须按已经回读的顺序更新，不重放');
const runeIndex = step <= 3 ? 0 : 1, candidate = plan.candidates[runeIndex], runeSteps = step - runeIndex * 3;
const checkpointName = `${number}-符文条件组成页面返回.json`;
const proof = { at: new Date().toISOString(), status: runeSteps === 3 ? 'ONE_PARTIAL_RUNE_COMPONENT_CONNECTED' : 'PARTIAL_COMPONENT_PAGE_RETURN',
  capability: '每笔敌方英雄生命比例严格门槛与已有伤害过滤、乘区和引用能否正常表达并保存',
  actualExecutor: { model: 'gpt-6-sol', effort: 'max', browser: page.browser },
  step, runeKey: candidate.runeKey, currentObject: current.detailRoute,
  uniquePostStatus: 201, savedBodyExactlyApproved: true, closedAndReopened: true,
  pageEvidence: rel + pagePath, independentReadback: rel + readbackPath, independentGETs: 38,
  independentlyVerifiedWrites: step, cumulativeIndependentGETs: step * 38,
  protectedOriginalResponses: 32, references: after.references,
  scope: '本组成明确普通直接物理普攻；技能、其他伤害及特殊来源资格仍继续推进',
  historicalDescriptionsPreserved: true, sourceRuntimeInputStillWithoutDefault: true,
  originalObjectPageConnected: step >= 3, peerObjectPageConnected: step >= 6,
  formalRuntimeValidated: false, wholeRuneComplete: false, coverageChanged: false };
Object.assign(batch, { status: proof.status, evidence: rel + checkpointName, pageBusinessWrites: step,
  independentlyVerifiedWrites: step, pageState: `${candidate.name}已回读${runeSteps}笔，共${step}笔；原对象/同类及正式运行按证据继续`,
  originalObjectPageConnected: step >= 3, peerObjectPageConnected: step >= 6 });
const item = ledger.inventoryConclusions.runes.find(x => x.runeKey === candidate.runeKey); assert(item);
item.reason = runeSteps === 3
  ? '普通直接物理普攻的生命门槛乘区、效果与初始化入口已正常页面保存回读；正式运行及其他伤害来源、例外继续推进，整符文未完成。'
  : `普通直接物理普攻生命门槛组成已完成${runeSteps}笔页面保存回读；剩余入口、正式运行及其他伤害来源继续推进，整符文未完成。`;
item.realPageRecovery = { status: proof.status, evidence: rel + checkpointName, pageBusinessWrites: runeSteps,
  independentGETs: runeSteps * 38, savedObjects: candidate.writes.slice(0, runeSteps).map(w => w.detailRoute),
  wholeRuneComplete: false, runtimeValidated: false };
const protectedCopy = structuredClone(ledger);
protectedCopy.mechanismBatches.conditionalDamageModifierReturn = before.mechanismBatches.conditionalDamageModifierReturn;
protectedCopy.inventoryConclusions.runes = before.inventoryConclusions.runes;
assert.deepEqual(protectedCopy, before);
assert.deepEqual(ledger.inventoryConclusions.runes.filter(x => x.runeKey !== candidate.runeKey),
  before.inventoryConclusions.runes.filter(x => x.runeKey !== candidate.runeKey));
assert.deepEqual(ledger.inventoryConclusions.coverage, before.inventoryConclusions.coverage);
fs.writeFileSync(path.join(here, checkpointName), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ status: proof.status, step, rune: candidate.runeKey, GETs: 38, cumulativeGETs: step * 38, coverageChanged: false }));
