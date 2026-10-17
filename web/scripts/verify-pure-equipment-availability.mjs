/**
 * 单件纯属性装备的真实只读验证，不证明隔离夹具中的整英雄可用。
 * 先运行 node scripts/verify-pure-equipment-availability.mjs --mode pilot，
 * 再运行 node scripts/verify-pure-equipment-availability.mjs --mode all。
 * 需要已运行的正式后端和 Vite；本脚本不启动服务、不写业务数据。
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputIndex = process.argv.indexOf('--output');
const outputRoot = resolve(webRoot, outputIndex < 0
  ? `output/pure-equipment-${new Date().toISOString().replace(/[:.]/g, '-')}` : process.argv[outputIndex + 1]);
assert(outputRoot.startsWith(resolve(webRoot, 'output') + '/') || outputRoot.startsWith(resolve(webRoot, 'output') + '\\'), '证据必须位于Web输出目录');
assert(!existsSync(outputRoot), '不覆盖已有证据目录');
const scopePath = resolve(webRoot, '../../damage_backend_dev/server/data_manage/src/main/resources/simulation-scope/lol/combat-analysis.json');
const apiBase = process.env.SIMULATION_LIVE_API_BASE_URL ?? 'http://127.0.0.1:8080';
const webBase = process.env.SIMULATION_WEB_BASE_URL ?? 'http://127.0.0.1:5173';
const token = process.env.SIMULATION_LIVE_ADMIN_TOKEN ?? '';
const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex < 0 ? 'pilot' : process.argv[modeIndex + 1];
assert(['pilot', 'all'].includes(mode), '--mode 只接受 pilot 或 all');
const workersIndex = process.argv.indexOf('--workers');
const workerCount = workersIndex < 0 ? mode === 'all' ? 2 : 1 : Number(process.argv[workersIndex + 1]);
assert(Number.isSafeInteger(workerCount) && workerCount >= 1 && workerCount <= 4, '--workers需要1到4个独立页面');
const pilots = ['item_1036', 'item_1028', 'item_1042'];
const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const equivalent = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const json = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + '\n'); };
const scriptSha256 = hash(readFileSync(fileURLToPath(import.meta.url)));
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const requests = { get: 0, snapshotPost: 0, businessWrites: [] };
const browserErrors = [];
const results = [];
// 行为证据来自下方独立逐击、生命账及真实攻速断言；不按名称排除其它属性。
const behaviorVerifiedAttributes = new Set(['hp', 'attack_damage', 'bonus_attack_speed_percent', 'armor', 'armor_pen_flat',
  'armor_pen_percent', 'critical_strike_chance', 'critical_strike_damage_bonus_percent', 'life_steal_percent', 'omnivamp_percent']);
let identity;

async function readApi(suffix, body) {
  assert(body === undefined || suffix === 'simulation-snapshot', '禁止向业务写接口发送请求');
  if (body === undefined) requests.get++; else requests.snapshotPost++;
  const response = await fetch(`${apiBase}/api/admin/games/lol/${suffix}`, {
    method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  assert.equal(response.status, 200, `${suffix.split('?')[0]} HTTP ${response.status}`);
  return response.json();
}
async function directory() {
  const value = await readApi('simulation-availability?' + new URLSearchParams(identity));
  assert.equal(value.gameId, 'lol'); assert.equal(value.profile, 'combat-analysis-v1'); assert.equal(value.digestVersion, 'simulation-availability-v1');
  for (const entry of value.equipment) {
    assert.equal(entry.verification.wasmSha256, identity.wasmSha256); assert.equal(entry.verification.adapterVersion, identity.adapterVersion);
  }
  return value;
}
const proofIdentity = (catalog, entry) => ({ gameId: catalog.gameId, profile: catalog.profile, digestVersion: catalog.digestVersion,
  scopeDigest: catalog.scopeDigest, sharedDigest: catalog.sharedDigest, key: entry.key, contentDigest: entry.contentDigest,
  externalDigest: entry.verification.externalDigest, coverage: entry.verification.requiredCoverage,
  wasmSha256: entry.verification.wasmSha256, adapterVersion: entry.verification.adapterVersion });
function assertStable(before, after, keys) {
  for (const key of keys) {
    const left = before.equipment.find(row => row.key === key), right = after.equipment.find(row => row.key === key);
    assert(left && right && equivalent(proofIdentity(before, left), proofIdentity(after, right)), `${key} 目录身份发生变化，不签发候选`);
  }
}
function rawFile(key, level, owner, value) {
  const path = resolve(outputRoot, key, `level-${String(level).padStart(2, '0')}-${owner}.json.gz`);
  const bytes = gzipSync(Buffer.from(JSON.stringify(value)), { level: 6 });
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes);
  return { path: relative(webRoot, path).replaceAll('\\', '/'), sha256: hash(bytes), bytes: bytes.length };
}

async function runSnapshot(page, snapshot, owner, equipmentKey, expectedSelection) {
  return page.evaluate(async ({ snapshot, owner, equipmentKey, expectedSelection }) => {
    const { validateSimulationSnapshot } = await import('/src/services/simulationSnapshotClient.ts');
    const { preflightSkillFormulas } = await import('/src/engine/skillFormulaPreflight.ts');
    const { inspectSimulationSnapshot, prepareSimulation } = await import('/src/engine/simulationAdapter.ts');
    const { continuousAttackRequest } = await import('/src/engine/continuousAttackRequest.ts');
    const { assessContinuousAttackResult } = await import('/src/engine/continuousAttackResult.ts');
    const { simulationHealthLimit } = await import('/src/engine/simulationEquipment.ts');
    const { validateApprovedFormulaValues, validateConsumedFormulaValues } = await import('/src/engine/approvedFormulaValues.ts');
    validateSimulationSnapshot(snapshot, 'lol', expectedSelection);
    const client = window.__pureEquipmentClient;
    let sessionId = null, prepared;
    const preflight = await preflightSkillFormulas(snapshot, client);
    const inspection = inspectSimulationSnapshot(snapshot);
    const inputs = { source: {}, target: {} };
    const inputReasons = [];
    for (const row of inspection.requirements) if (row.storedValue === undefined) {
      const key = row.attribute.attributeKey;
      const value = key === 'attack_speed_ratio' ? 0.5 : 0;
      if (row.attribute.minValue !== null && value < row.attribute.minValue
        || row.attribute.maxValue !== null && value > row.attribute.maxValue) throw new Error(`测试显式值违反 ${row.side}.${key} 属性范围`);
      inputs[row.side][key] = value;
      inputReasons.push({ side: row.side, attributeKey: key, value,
        reason: key === 'attack_speed_ratio' ? '独立隔离测试的显式攻速系数，不声称英雄真实缺失值' : '独立隔离测试明确设为0，不写回角色数据' });
    }
    const limits = { source: simulationHealthLimit(snapshot, 'source'), target: simulationHealthLimit(snapshot, 'target') };
    const health = { source: limits.source * 0.5, target: limits.target };
    try {
      prepared = await prepareSimulation(snapshot, inputs, health);
      const compiled = await client.compile(prepared.compileRequest);
      if (!compiled.ok || !compiled.sessionId) throw new Error('真实场景编译失败：' + JSON.stringify(compiled.errors));
      sessionId = compiled.sessionId;
      validateConsumedFormulaValues(prepared.approvedFormulaValues, prepared.compileRequest.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
      validateApprovedFormulaValues(prepared.compileRequest.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
      const run = await continuousAttackRequest(prepared, snapshot, { durationMs: 2000, attackSpeedInputMax: 10, recordTimeSeries: true }, sessionId);
      const done = await client.run(run.runRequest);
      const assessment = assessContinuousAttackResult(prepared.compileRequest, run.runRequest, done, prepared.operationOrigins);
      if (!assessment.complete || assessment.issues.length) throw new Error('真实结果核对失败：' + JSON.stringify(assessment.issues));
      const repeated = await client.run(run.runRequest);
      if (JSON.stringify(done) !== JSON.stringify(repeated)) throw new Error('同一会话第二次运行不一致');
      const release = await client.release(sessionId, prepared.compileRequest.rulesHash);
      if (!release.released || release.sessionId !== sessionId) throw new Error('会话释放未确认');
      sessionId = null;
      return { snapshot, owner, equipmentKey, inputs, inputReasons, initialHealth: health, healthLimits: limits, preflight, inspection,
        prepared, compiled, run, done, repeated, assessment, release };
    } finally { if (sessionId && client.hasLiveWorker) await client.release(sessionId, prepared?.compileRequest.rulesHash); }
  }, { snapshot, owner, equipmentKey, expectedSelection });
}

function assertions(result, baseline, expectedValues) {
  const { snapshot, owner, equipmentKey, done, prepared, initialHealth, healthLimits } = result;
  const checks = [];
  const close = (actual, expected, label) => {
    assert.equal(typeof actual, 'number', `${label} 缺少真实数值`);
    assert(Math.abs(actual - expected) <= 1e-8 * Math.max(1, Math.abs(actual), Math.abs(expected)), `${label}: ${actual} != ${expected}`);
    checks.push({ label, actual, expected });
  };
  const baseValue = (side, key) => snapshot[side].selectedLevelValues[key] ?? result.inputs[side][key] ?? 0;
  const value = (side, key) => baseValue(side, key) + (owner === side ? expectedValues[key] ?? 0 : 0);
  const actor = side => done.finalSnapshot.combatants.find(row => row.key === side);
  for (const side of ['source', 'target']) {
    assert.equal(snapshot.selection[`${side}CharacterKey`], baseline.snapshot.selection[`${side}CharacterKey`]);
    assert(equivalent(snapshot[side].selectedLevelValues, baseline.snapshot[side].selectedLevelValues), '夹具角色固有属性发生漂移');
    const selected = snapshot[side].selectedEquipment;
    assert.equal(selected.length, side === owner ? 1 : 0);
    if (side === owner) {
      assert.equal(selected[0].equipment.equipmentKey, equipmentKey);
      assert.equal(selected[0].attachedSkills.length, 0);
      assert(equivalent(selected[0].attributes.attributeValues, expectedValues), '真实快照装备直接属性不同');
      const mounts = actor(side).providers.filter(row => row.providerRef === `${owner}_equipment_${equipmentKey}`);
      assert.equal(mounts.length, 1); assert.equal(mounts[0].owner, owner); assert.equal(mounts[0].source, owner);
      const provider = prepared.compileRequest.sharedProviders.find(row => row.providerKey === mounts[0].definitionRef);
      assert.equal(provider.modifiers.length, Object.keys(expectedValues).length);
      for (const [key, amount] of Object.entries(expectedValues)) {
        const modifier = provider.modifiers.filter(row => row.target === `self.attr.${key}`);
        assert.equal(modifier.length, 1); assert.equal(modifier[0].valuePolicy, 'add');
        close(modifier[0].value.value, amount, `${side}.${key} 编译增量`);
        close(actor(side).attributes[key]?.base, baseValue(side, key), `${side}.${key} 固有值不被装备覆盖`);
        if (key !== 'hp') close(actor(side).attributes[key]?.resolved, value(side, key), `${side}.${key} 运行时直接属性`);
      }
    } else {
      assert.equal(actor(side).providers.filter(row => row.providerRef.includes('_equipment_')).length, 0);
      for (const key of Object.keys(expectedValues)) {
        if (key === 'hp') continue;
        const old = baseline.done.finalSnapshot.combatants.find(row => row.key === side).attributes[key];
        const current = actor(side).attributes[key];
        if (!old) assert.equal(current, undefined, `${side}.${key} 不能泄漏到反侧`);
        else close(current?.resolved, old.resolved, `${side}.${key} 反侧保持基线`);
      }
    }
    close(healthLimits[side], value(side, 'hp'), `${side} 生命上限`);
    close(actor(side).attributes.hp.max, value(side, 'hp'), `${side} 运行时最大生命`);
    const expectedSpeed = baseValue(side, 'attack_speed') + value(side, 'attack_speed_ratio') * value(side, 'bonus_attack_speed_percent');
    close(actor(side).attributes.attack_speed.resolved, expectedSpeed, `${side} 运行时攻速派生`);
  }
  assert.equal(done.summary.targetDamageDealt, 0, '目标不自主攻击');
  assert(done.attackRecords.length >= 2 && done.attackRecords.every(row => row.completed), '必须有真实开始并完成的连续普攻');
  const damage = value('source', 'attack_damage');
  const chance = Math.min(1, Math.max(0, value('source', 'critical_strike_chance')));
  const multiplier = 2 + value('source', 'critical_strike_damage_bonus_percent');
  const expectedRaw = damage * (1 + chance * (multiplier - 1));
  const resistance = value('target', 'armor');
  const effective = Math.min(resistance, Math.max(0, resistance * (1 - Math.min(1, Math.max(0, value('source', 'armor_pen_percent')))) - Math.max(0, value('source', 'armor_pen_flat'))));
  const factor = 100 / (100 + Math.max(effective, 0)) - Math.min(effective, 0) / (100 - Math.min(effective, 0));
  for (const row of done.damageRecords) {
    assert.equal(row.source, 'source'); assert.equal(row.target, 'target'); assert.equal(row.owner, 'source'); assert.equal(row.damageType, 'physics');
    close(row.baseRawAmount, damage, '逐击攻击力实际读取'); close(row.rawAmount, expectedRaw, '逐击期望暴击伤害');
    close(row.resistanceFactor, factor, '逐击护甲与穿透倍率'); close(row.postDefenseDamage, expectedRaw * factor, '逐击结算伤害');
  }
  const expectedSourceSpeed = baseValue('source', 'attack_speed') + value('source', 'attack_speed_ratio') * value('source', 'bonus_attack_speed_percent');
  for (const attack of done.attackRecords) close(attack.attackSpeed, expectedSourceSpeed, '真实普攻攻速');
  const expectedHealing = done.summary.sourceDamageDealt * (value('source', 'life_steal_percent') + value('source', 'omnivamp_percent'));
  close(done.summary.sourceVampHealing, expectedHealing, '生命偷取与全能吸血实际治疗');
  close(done.summary.sourceFinalHp, initialHealth.source + expectedHealing, '攻击方最终生命');
  close(done.summary.targetFinalHp, initialHealth.target - done.summary.targetHpLoss, '目标最终生命账');
  assert.equal(done.summary.execution.complete, true); assert.equal(done.summary.execution.budgetCause, null);
  return checks;
}

mkdirSync(outputRoot, { recursive: true });
writeFileSync(resolve(outputRoot, `collector-source-${mode}.mjs`), readFileSync(fileURLToPath(import.meta.url)));
const scope = JSON.parse(readFileSync(scopePath, 'utf8'));
assert.equal(scope.gameId, 'lol'); assert.equal(scope.profile, 'combat-analysis-v1');
const eligible = scope.equipment.filter(row => row.requiresSkillBindings === false && row.attributesOnlyEvidence?.reason?.trim()
  && row.attributesOnlyEvidence?.evidenceRefs?.length);
assert.equal(eligible.length, 47, '当前明确纯属性来源的范围数量变化，需重新核对范围');
const keysIndex = process.argv.indexOf('--equipment-keys');
const requestedKeys = keysIndex < 0 ? null : process.argv[keysIndex + 1]?.split(',');
assert(requestedKeys === null || requestedKeys.length > 0 && requestedKeys.every(key => /^[a-z][a-z0-9_]{0,63}$/.test(key))
  && new Set(requestedKeys).size === requestedKeys.length, '装备键必须明确且不重复');
const selected = requestedKeys ? requestedKeys.map(key => eligible.find(row => row.key === key))
  : mode === 'pilot' ? pilots.map(key => eligible.find(row => row.key === key)) : eligible;
assert(selected.every(Boolean));
const browser = await chromium.launch({ headless: true });
const pages = [];
let page, startDirectory, candidate;
async function createPageClient() {
  const created = await browser.newPage();
  pages.push(created);
  created.on('pageerror', error => browserErrors.push(error.message));
  created.on('request', request => {
    const method = request.method(), url = new URL(request.url());
    if (['PUT', 'PATCH', 'DELETE', 'POST'].includes(method) && !url.pathname.endsWith('/simulation-snapshot')) {
      requests.businessWrites.push({ method, path: url.pathname });
    }
  });
  await created.goto(webBase + '/');
  const loadedIdentity = await created.evaluate(async () => {
    const { SIMULATION_AVAILABILITY_IDENTITY } = await import('/src/services/simulationAvailabilityClient.ts');
    const { GenericEngineClient } = await import('/src/engine/genericEngineClient.ts');
    window.__pureEquipmentClient = new GenericEngineClient();
    return SIMULATION_AVAILABILITY_IDENTITY;
  });
  return { page: created, identity: loadedIdentity };
}
try {
  ({ page, identity } = await createPageClient());
  const wasmBytes = readFileSync(resolve(webRoot, 'src/engine/wasm/tinygo_engine_v2.wasm'));
  assert.equal(hash(wasmBytes), identity.wasmSha256);
  const browserWasmHash = await page.evaluate(async () => {
    const bytes = await (await fetch('/src/engine/wasm/tinygo_engine_v2.wasm')).arrayBuffer();
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
  });
  assert.equal(browserWasmHash, identity.wasmSha256);
  startDirectory = await directory();
  json(resolve(outputRoot, `directory-before-${mode}.json`), startDirectory);
  const relationRows = {};
  for (const side of ['source', 'target']) {
    const key = side === 'source' ? 'champion_twistedfate' : 'champion_annie';
    relationRows[side] = (await readApi('character-skill-relations?characterKey=' + key)).items;
    assert.equal(relationRows[side].filter(row => row.skillKey === 'shared_basic_attack' && row.skillStatus === 'ENABLED').length, 1);
  }
  const baseSelection = level => ({ sourceCharacterKey: 'champion_twistedfate', targetCharacterKey: 'champion_annie', sourceLevel: level, targetLevel: level,
    basicAttackSkillKey: 'shared_basic_attack', basicAttackLevel: 1, plannedSkills: [], sourceEquipmentKeys: [], targetEquipmentKeys: [],
    sourceBuildConfigurations: [], targetBuildConfigurations: [],
    ...Object.fromEntries(['source', 'target'].map(side => [`${side}SkillSettings`, relationRows[side].filter(row => row.skillStatus === 'ENABLED').map(row => ({
      origin: { kind: 'CHARACTER', characterKey: side === 'source' ? 'champion_twistedfate' : 'champion_annie' }, skillKey: row.skillKey,
      enabled: side === 'source' && row.skillKey === 'shared_basic_attack', ...(side === 'source' && row.skillKey === 'shared_basic_attack' ? { skillLevel: 1 } : {})
    }))])) });
  const levels = (await readApi('level-config'));
  const declaredLevels = Array.from({ length: levels.maxLevel - levels.minLevel + 1 }, (_, index) => levels.minLevel + index);
  assert(equivalent(declaredLevels, Array.from({ length: 18 }, (_, index) => index + 1)), '当前验证只接受明确的1..18级');
  const baselines = new Map();
  for (const level of declaredLevels) {
    const selection = baseSelection(level);
    const snapshot = await readApi('simulation-snapshot', selection);
    const result = await runSnapshot(page, snapshot, null, null, selection);
    assertions(result, result, {});
    const raw = rawFile('baseline', level, 'none', result);
    baselines.set(level, result);
    json(resolve(outputRoot, 'baseline', `level-${String(level).padStart(2, '0')}-assertions.json`), { level, raw, summary: result.done.summary,
      fixtureNotice: '只开启共享普攻，关闭未完兄弟；不构成崔斯特或安妮整英雄可用证明', explicitInputs: result.inputReasons });
  }
  async function verifyItem(workerPage, item) {
    const before = await directory();
    assertStable(startDirectory, before, [item.key]);
    const entry = before.equipment.find(row => row.key === item.key);
    const reportPath = resolve(outputRoot, item.key, 'verification.json');
    let lastAttempt = null;
    try {
      const wanted = entry.verification.requiredCoverage;
      assert(wanted && wanted.equipmentMode === 'single-item' && wanted.skills.length === 0, `${item.key} 不属于无技能的单件验证范围`);
      assert(equivalent(wanted.characterLevels, declaredLevels) && equivalent(wanted.sides, ['source', 'target']));
      const relations = await readApi('equipment-skill-relations?equipmentKey=' + item.key);
      assert.equal(relations.total, 0); assert.equal(relations.items.length, 0, '真实装备具有技能绑定，不按纯属性跳过');
      const attributes = (await readApi('equipment/' + item.key + '/attributes')).attributeValues;
      assert(Object.keys(attributes).length, '纯属性装备不能是空属性');
      assert(Object.values(attributes).every(Number.isFinite), '装备属性必须是明确有限值');
      const signature = hash(canonical({ identity: proofIdentity(before, entry), scriptSha256, attributes }));
      if (mode === 'all' && existsSync(reportPath)) {
        const old = JSON.parse(readFileSync(reportPath, 'utf8'));
        if (old.passed && old.signature === signature && old.cases.length === declaredLevels.length * 2
          && old.cases.every(row => existsSync(resolve(webRoot, row.raw.path)) && hash(readFileSync(resolve(webRoot, row.raw.path))) === row.raw.sha256)) {
          results.push({ key: item.key, passed: true, readyEvidenceComplete: old.behaviorEvidence.readyEvidenceComplete, reused: true,
            report: relative(webRoot, reportPath).replaceAll('\\', '/'), cases: old.cases.length });
          console.log(`${item.key}: 已核对并复用 ${old.cases.length} 个当前身份真实运行记录`);
          return;
        }
      }
      const cases = [];
      for (const level of declaredLevels) for (const owner of ['source', 'target']) {
        const selection = { ...baseSelection(level), [`${owner}EquipmentKeys`]: [item.key] };
        const snapshot = await readApi('simulation-snapshot', selection);
        for (const side of ['source', 'target']) {
          const enabled = snapshot[side].skillSources.filter(row => row.enabled && row.skillStatus === 'ENABLED').map(row => row.skillKey);
          assert(equivalent(enabled, side === 'source' ? ['shared_basic_attack'] : []), '隔离场景未显式关闭兄弟来源');
        }
        lastAttempt = { level, owner };
        let result;
        try { result = await runSnapshot(workerPage, snapshot, owner, item.key, selection); }
        catch (error) {
          lastAttempt.raw = rawFile(item.key, level, owner, { snapshot, owner, equipmentKey: item.key, error: error.message });
          throw error;
        }
        const raw = rawFile(item.key, level, owner, result);
        lastAttempt.raw = raw;
        const checks = assertions(result, baselines.get(level), attributes);
        cases.push({ level, owner, raw, checks, explicitInputs: result.inputReasons, repeatedIdentical: true,
          formulaPreflight: result.preflight, released: result.release.released, started: result.done.summary.basicAttack.startedCount,
          completed: result.done.summary.basicAttack.completedCount, snapshotDigest: snapshot.snapshotDigest, rulesHash: result.prepared.compileRequest.rulesHash });
      }
      assertStable(before, await directory(), [item.key]);
      const unconsumedKeys = Object.keys(attributes).filter(key => !behaviorVerifiedAttributes.has(key));
      const behaviorEvidence = { readyEvidenceComplete: unconsumedKeys.length === 0,
        consumedKeys: Object.keys(attributes).filter(key => behaviorVerifiedAttributes.has(key)), unconsumedKeys,
        notice: '方向性属性在适用一方实际消费、另一方只查状态；其它未消费属性继续待核验，不排除、不签PASSED' };
      json(reportPath, { key: item.key, name: item.name, passed: true, runId, scriptSha256, signature, identity: proofIdentity(before, entry),
        scopeEvidence: item.attributesOnlyEvidence, attributes, cases, equipmentSkillBindings: 0, behaviorEvidence,
        fixtureNotice: '单件装备隔离验证；崔斯特/安妮未完成兄弟显式关闭，不证明整英雄或任意六件组合；无装备自身技能需触发',
        statistics: { cases: cases.length, actualRuns: cases.length * 2, repeatCountPerCase: 2 } });
      results.push({ key: item.key, passed: true, readyEvidenceComplete: behaviorEvidence.readyEvidenceComplete,
        report: relative(webRoot, reportPath).replaceAll('\\', '/'), cases: cases.length, unconsumedKeys });
      console.log(`${item.key}: ${cases.length} 例 / ${cases.length * 2} 次真实运行通过；${behaviorEvidence.readyEvidenceComplete ? '行为证据完整' : '仍待行为核验：' + unconsumedKeys.join(',')}`);
    } catch (error) {
      const failure = { key: item.key, passed: false, runId, scriptSha256, message: error.message, lastAttempt };
      json(resolve(outputRoot, item.key, 'failure.json'), failure); results.push(failure); console.log(`${item.key}: 未通过：${error.message}`);
    }
    json(resolve(outputRoot, `progress-${mode}.json`), { runId, identity, results, requests });
  }
  const workers = [page];
  while (workers.length < workerCount) {
    const second = await createPageClient();
    assert(equivalent(second.identity, identity), '两个独立页面的引擎身份不一致');
    workers.push(second.page);
  }
  let next = 0, globalError = null;
  await Promise.all(workers.map(async workerPage => {
    while (next < selected.length && !globalError) {
      const item = selected[next++];
      try { await verifyItem(workerPage, item); } catch (error) { globalError ??= error; }
    }
  }));
  if (globalError) throw globalError;
  results.sort((left, right) => left.key.localeCompare(right.key));
  const after = await directory();
  json(resolve(outputRoot, `directory-after-${mode}.json`), after);
  assertStable(startDirectory, after, results.filter(row => row.passed).map(row => row.key));
  assert.equal(hash(readFileSync(resolve(webRoot, 'src/engine/wasm/tinygo_engine_v2.wasm'))), identity.wasmSha256, '验证期间正式Wasm字节变化');
  assert.equal(requests.businessWrites.length, 0); assert.equal(browserErrors.length, 0, '浏览器出现运行错误');
  candidate = { schemaVersion: 'simulation-verification-v1', gameId: 'lol', profile: 'combat-analysis-v1',
    digestVersion: 'simulation-availability-v1', scopeDigest: startDirectory.scopeDigest, sharedDigest: startDirectory.sharedDigest, ...identity,
    entries: results.filter(row => row.passed && row.readyEvidenceComplete).map(row => {
      const report = JSON.parse(readFileSync(resolve(webRoot, row.report), 'utf8'));
      return { kind: 'EQUIPMENT', key: row.key, contentDigest: report.identity.contentDigest, externalDigest: report.identity.externalDigest,
        outcome: 'PASSED', coverage: report.identity.coverage, evidenceRefs: [row.report], issues: [] };
    }) };
  json(resolve(outputRoot, `simulation-verification-candidate-${mode}.json`), candidate);
} finally {
  for (const ownedPage of pages) if (!ownedPage.isClosed()) await ownedPage.evaluate(() => { window.__pureEquipmentClient?.terminate(); }).catch(() => undefined);
  await browser.close();
  json(resolve(outputRoot, `summary-${mode}.json`), { runId, mode, scriptSha256, workerCount, identity, candidateGenerated: Boolean(candidate),
    selected: selected.map(row => row.key), passed: results.filter(row => row.passed).length, failed: results.filter(row => !row.passed).length,
    readyEvidenceComplete: results.filter(row => row.passed && row.readyEvidenceComplete).length,
    stateOnlyUnverified: results.filter(row => row.passed && !row.readyEvidenceComplete).length, independentPages: pages.length,
    results, requests, browserErrors, completedAt: new Date().toISOString(),
    limitations: ['单件装备不证明任意六件组合', '隔离夹具不证明整英雄', '未被本场读取的直接属性只证明实际运行状态中的属性值，不宣称未开放机制已执行'] });
}
assert.equal(results.filter(row => !row.passed).length, 0, '有失败装备，不能签发为全部通过');
console.log(`完成：${results.length} 件，证明候选 ${candidate.entries.length} 项；无业务写入。`);
