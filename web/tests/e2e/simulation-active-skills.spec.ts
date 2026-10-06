import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { DoneResult, RunRequest } from '../../src/types/genericEngine';
import type { SimulationSnapshot } from '../../src/types/simulationSnapshot';
import type { SimulationCastCostRef } from '../../src/engine/simulationActiveSkills';
import { simulationComparisonSelection } from '../fixtures/simulationSnapshotRequests';

const api = process.env.SIMULATION_API_BASE || 'http://127.0.0.1:8080';
const output = resolve('output/phase6a');
const samples = [
  { hero: 'corki', skillKey: 'corki_q', healing: false, costs: [{ bindingKey: 'mana_cost', effectKey: 'mana_cost', resultKey: 'consume_mana' }] },
  { hero: 'garen', skillKey: 'garen_r', healing: false, costs: [] },
  { hero: 'soraka', skillKey: 'soraka_r', healing: true, costs: [{ bindingKey: 'mana_cost', effectKey: 'mana_cost', resultKey: 'consume_mana' }] }
] as const;
type Sample = typeof samples[number];

function identity() {
  const bytes = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    status: process.env.SIMULATION_EXPECTED_WASM_SHA256 ? 'final' : 'candidate' };
}

test.beforeEach(async ({ page }) => {
  test.skip(process.env.SIMULATION_LIVE_API !== '1', '需要6A真实HTTP接口及已同步Wasm；不替换服务或字节');
  const observed = identity();
  if (process.env.SIMULATION_EXPECTED_WASM_SHA256) expect(observed.sha256).toBe(process.env.SIMULATION_EXPECTED_WASM_SHA256.toLowerCase());
  await page.goto('/');
  const browser = await page.evaluate(async () => {
    const response = await fetch('/src/engine/wasm/tinygo_engine_v2.wasm');
    if (!response.ok) throw new Error(`Wasm读取失败${response.status}`);
    const bytes = await response.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return { bytes: bytes.byteLength, sha256: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') };
  });
  expect(browser).toEqual({ bytes: observed.bytes, sha256: observed.sha256 });
});

async function realSnapshot(request: APIRequestContext, sample: Sample) {
  const origin = { kind: 'CHARACTER' as const, characterKey: `champion_${sample.hero}` };
  const selection = simulationComparisonSelection({ sourceCharacterKey: origin.characterKey, sourceLevel: 18,
    targetCharacterKey: 'champion_malphite', targetLevel: 18, basicAttackSkillKey: null, basicAttackLevel: null,
    plannedSkills: [{ origin, skillKey: sample.skillKey, skillLevel: 1, phaseKinds: ['INITIAL'] }],
    sourceSkillSettings: [{ origin, skillKey: sample.skillKey, skillLevel: 1, enabled: true }] });
  const path = `${api}/api/admin/games/lol/simulation-snapshot`;
  const candidate = await request.post(path, { data: selection });
  expect(candidate.status(), '只读6A候选接口；旧服务须由负责人更新，不构造假快照').toBe(200);
  const initial = await candidate.json() as SimulationSnapshot;
  for (const side of ['source', 'target'] as const) selection[`${side}SkillSettings`] = initial[side].skillSources
    .filter(source => source.origin.kind === 'CHARACTER' && source.skillStatus === 'ENABLED').map(source => ({
      origin: source.origin, skillKey: source.skillKey, enabled: side === 'source' && source.skillKey === sample.skillKey,
      ...(side === 'source' && source.skillKey === sample.skillKey ? { skillLevel: 1 } : {})
    }));
  const response = await request.post(path, { data: selection });
  expect(response.status(), '显式关闭未核定英雄来源的隔离对照，不是默认来源已全部支持').toBe(200);
  const snapshot = await response.json() as SimulationSnapshot;
  expect(snapshot.selection).toEqual(selection);
  expect(snapshot.source.attachedSkills.some(row => row.skillKey === sample.skillKey && row.skillStatus === 'ENABLED')).toBe(true);
  return snapshot;
}

async function runSample(page: Page, snapshot: SimulationSnapshot, sample: Sample, healthRatio = 0.3, iterations = 100) {
  const costs: SimulationCastCostRef[] = sample.costs.map(cost => ({ ...cost, skillKey: sample.skillKey }));
  const result = await page.evaluate(async ({ snapshot, costs, healing, healthRatio, iterations }) => {
    const adapterPath = '/src/engine/simulationAdapter.ts';
    const requestPath = '/src/engine/skillActionRequest.ts';
    const assessmentPath = '/src/engine/skillActionResult.ts';
    const clientPath = '/src/engine/genericEngineClient.ts';
    const numericPath = '/src/engine/numericAdapter.ts';
    const { prepareSimulation, inspectSimulationSnapshot } = await import(adapterPath) as typeof import('../../src/engine/simulationAdapter');
    const { skillActionRequest } = await import(requestPath) as typeof import('../../src/engine/skillActionRequest');
    const { assessSkillActionResult } = await import(assessmentPath) as typeof import('../../src/engine/skillActionResult');
    const { GenericEngineClient } = await import(clientPath) as typeof import('../../src/engine/genericEngineClient');
    const { tryFoldConstant } = await import(numericPath) as typeof import('../../src/engine/numericAdapter');
    const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    for (const row of inspectSimulationSnapshot(snapshot, costs).requirements) if (row.storedValue === undefined) {
      const key = row.attribute.attributeKey;
      if (key === 'ability_power') inputs[row.side][key] = row.side === 'source' ? 100 : 0;
      else if (key === 'bonus_attack_damage') inputs[row.side][key] = row.side === 'source' ? 50 : 0;
      else if (key.endsWith('_percent') || ['critical_strike_chance', 'ability_haste', 'armor_pen_flat', 'magic_pen_flat'].includes(key)) inputs[row.side][key] = 0;
      else throw new Error(`真实场景缺少${row.side}.${key}；不补造固有属性`);
    }
    const maximum = snapshot.source.selectedLevelValues.hp!;
    const prepared = await prepareSimulation(snapshot, inputs, { source: maximum * healthRatio,
      target: snapshot.target.selectedLevelValues.hp! * 0.8 }, [], [], costs);
    const binding = prepared.compileRequest.rules.skillActionBindings![0]!;
    const process = prepared.compileRequest.sharedProviders!.find(row => row.providerKey === binding.providerDefinitionRef)!.processes![0]!;
    const delay = process.steps[0]!.delayMs ? tryFoldConstant(process.steps[0]!.delayMs!) : 0;
    if (delay === null || !Number.isSafeInteger(delay) || delay < 0) throw new Error('首批有限延时必须来自原声明，不按技能键猜释放时刻');
    const actionInputs = { actions: [{ ...snapshot.selection.plannedSkills[0]!, instructionKey: 'first_cast', atMs: 0, sortOrder: 0,
      phaseKind: 'INITIAL' as const, parentInstructionKey: null, targetSide: healing ? 'source' as const : 'target' as const,
      hitPreset: healing ? null : 'TARGET_HIT' as const }], durationMs: delay + 100, recordTimeSeries: true,
      maxSkillActionRecords: 32, maxSkillUseRecords: 128, maxHealingRecords: 256 };
    const client = new GenericEngineClient();
    let sessionId: string | null = null;
    const runs: Array<{ name: string; runRequest: RunRequest; done: DoneResult }> = [];
    try {
      const compiled = await client.compile(prepared.compileRequest);
      if (!compiled.ok || !compiled.sessionId) throw new Error(JSON.stringify(compiled.errors));
      sessionId = compiled.sessionId;
      const baselineRequest = await skillActionRequest(prepared, snapshot, actionInputs, sessionId);
      const baseline = await client.run(baselineRequest.runRequest);
      const checked = assessSkillActionResult(prepared.compileRequest, baselineRequest.runRequest, baseline);
      if (!checked.complete) throw new Error(JSON.stringify({ ...checked, healingRecords: baseline.healingRecords }));
      for (let iteration = 1; iteration < iterations; iteration++) {
        const repeated = await client.run(baselineRequest.runRequest);
        if (JSON.stringify(repeated) !== JSON.stringify(baseline)) throw new Error(`同Worker第${iteration + 1}次完整结果不一致`);
      }
      const variants = [
        { name: 'zero-records', request: { ...baselineRequest.runRequest, recordBudget: { maxAttackRecords: 0, maxDamageRecords: 0, maxMechanicRecords: 0,
          maxSkillActionRecords: 0, maxSkillUseRecords: 0, maxHealingRecords: 0 } } },
        { name: 'truncated-records', request: { ...baselineRequest.runRequest, recordBudget: { maxAttackRecords: 0, maxDamageRecords: 1, maxMechanicRecords: 0,
          maxSkillActionRecords: 1, maxSkillUseRecords: 1, maxHealingRecords: 0 } } },
        { name: 'sampling-disabled', request: { ...baselineRequest.runRequest, sampling: { ...baselineRequest.runRequest.sampling, disabled: true } } }
      ];
      variants.push({ name: 'scheduled-at-100', request: (await skillActionRequest(prepared, snapshot,
        { ...actionInputs, actions: [{ ...actionInputs.actions[0]!, atMs: 100 }], durationMs: delay + 200 }, sessionId)).runRequest });
      if (!healing) variants.push({ name: 'miss', request: (await skillActionRequest(prepared, snapshot,
        { ...actionInputs, actions: [{ ...actionInputs.actions[0]!, hitPreset: 'MISS' }] }, sessionId)).runRequest });
      if (delay > 1 && healthRatio > 0) variants.push({ name: 'before-release', request: (await skillActionRequest(prepared, snapshot, { ...actionInputs, durationMs: delay - 1 }, sessionId)).runRequest });
      for (const variant of variants) {
        const done = await client.run(variant.request);
        const assessment = assessSkillActionResult(prepared.compileRequest, variant.request, done);
        if (!assessment.complete) throw new Error(`${variant.name}: ${JSON.stringify(assessment)}`);
        if (['zero-records', 'truncated-records', 'sampling-disabled'].includes(variant.name)) {
          if (JSON.stringify(done.finalSnapshot) !== JSON.stringify(baseline.finalSnapshot)
            || JSON.stringify(done.summary) !== JSON.stringify(baseline.summary)) throw new Error(`${variant.name}改变完整结算`);
        }
        if (variant.name === 'miss' && (done.summary.skillUses!.hitCount || done.summary.sourceDamageDealt)) throw new Error('MISS仍产生实际命中伤害');
        if (variant.name === 'scheduled-at-100' && healthRatio > 0 && done.skillActionRecords![0]!.actualAtMs !== 100) throw new Error('未按明确指令时刻尝试或自动延期');
        if (variant.name === 'before-release' && (done.summary.skillUses!.releasedCount || done.summary.skillUses!.completedCount
          || done.summary.skillUses!.hitCount || done.summary.skillUses!.inFlightCount !== 1)) throw new Error('观察终点以前伪造释放、完成或命中');
        runs.push({ name: variant.name, runRequest: variant.request, done });
      }
      let rejectedHash = false;
      try { await client.run({ ...baselineRequest.runRequest, expectedRulesHash: 'incorrect_rules_hash' }); }
      catch { rejectedHash = true; }
      if (!rejectedHash || !client.hasLiveWorker) throw new Error('错误摘要未拒绝或同Worker被替换');
      const recovered = await client.run(baselineRequest.runRequest);
      if (JSON.stringify(recovered) !== JSON.stringify(baseline)) throw new Error('错误摘要后未恢复完整初态');
      const release = await client.release(sessionId, prepared.compileRequest.rulesHash);
      sessionId = null;
      return { prepared, runRequest: baselineRequest.runRequest, runInputHash: baselineRequest.runInputHash,
        baseline, iterations, runs, release, healthRatio, initialMaximum: maximum, delay };
    } finally {
      if (sessionId && client.hasLiveWorker) await client.release(sessionId, prepared.compileRequest.rulesHash);
      client.terminate();
    }
  }, { snapshot, costs, healing: sample.healing, healthRatio, iterations });
  mkdirSync(output, { recursive: true });
  const label = `${sample.skillKey}-${String(healthRatio).replace('.', '_')}`;
  writeFileSync(resolve(output, `${label}-compile-run.json`), JSON.stringify({ wasm: identity(), snapshot,
    compileRequest: result.prepared.compileRequest, runRequest: result.runRequest, runVariants: result.runs.map(run => run.runRequest) }, null, 2));
  writeFileSync(resolve(output, `${label}-worker-proof.json`), JSON.stringify({ wasm: identity(), snapshot, result }, null, 2));
  return result;
}

for (const sample of samples) test(`真实${sample.skillKey}单条主动、完整结果及同Worker100次`, async ({ request, page }) => {
  const snapshot = await realSnapshot(request, sample);
  const result = await runSample(page, snapshot, sample);
  expect(result.baseline.summary.skillActions).toMatchObject({ plannedCount: 1, acceptedCount: 1, rejectedCount: 0 });
  expect(result.baseline.summary.skillUses).toMatchObject({ startedCount: 1, completedCount: 1, inFlightCount: 0, hitCount: sample.healing ? 0 : 1 });
  expect(result.release.released).toBe(true);
});

test('真实索拉卡原始生命上限40%等值、两侧边界及满生命溢出', async ({ request, page }) => {
  const sample = samples[2];
  const snapshot = await realSnapshot(request, sample);
  const maximum = snapshot.source.selectedLevelValues.hp!;
  const ratios = [(maximum * .4 - .1) / maximum, .4, (maximum * .4 + .1) / maximum, 1];
  const results = [];
  for (const ratio of ratios) results.push(await runSample(page, snapshot, sample, ratio));
  const healing = results.map(result => result.baseline.healingRecords!.filter(row => row.instructionKey === 'first_cast'));
  expect(healing.every(rows => rows.length === 1), '冻结互斥分支只能治疗一次').toBe(true);
  expect(healing[0]![0]!.rawAmount).toBeGreaterThan(healing[1]![0]!.rawAmount);
  expect(healing[1]![0]!.rawAmount).toBe(healing[2]![0]!.rawAmount);
  expect(results[3]!.baseline.summary.sourceDirectHealing).toBe(0);
  expect(healing[3]![0]!.overheal).toBeGreaterThan(0);
});

test('真实库奇初始死亡时指令未到达，不伪造尝试、成功使用或命中', async ({ request, page }) => {
  const sample = samples[0];
  const snapshot = await realSnapshot(request, sample);
  const result = await runSample(page, snapshot, sample, 0);
  expect(result.baseline.summary.skillActions).toEqual({ plannedCount: 1, reachedCount: 0, acceptedCount: 0,
    rejectedCount: 0, abortedBeforeAcceptCount: 0, unreachedCount: 1 });
  expect(result.baseline.summary.skillUses).toEqual({ startedCount: 0, releasedCount: 0, hitCount: 0, completedCount: 0, failedCount: 0, inFlightCount: 0,
    stepEnteredCount: 0, stepExecutedCount: 0, stepCompletedCount: 0 });
  expect(result.baseline.skillActionRecords).toEqual([]);
  expect(result.baseline.damageRecords).toEqual([]);
});
