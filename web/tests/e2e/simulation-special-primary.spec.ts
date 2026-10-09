import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { DoneResult, RunRequest } from '../../src/types/genericEngine';
import type { SimulationSnapshot } from '../../src/types/simulationSnapshot';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';
import { simulationComparisonSelection } from '../fixtures/simulationSnapshotRequests';
import { isolatedSimulationSelection } from '../fixtures/simulationSkillSources';

const api = process.env.SIMULATION_API_BASE || 'http://127.0.0.1:8080';
const snapshotPath = `${api}/api/admin/games/lol/simulation-snapshot`;
const proofDirectory = resolve('output/phase5c');
type Hero = 'ashe' | 'jhin';
type Scenario = {
  hero: Hero;
  sourceLevel?: number;
  sourceEquipmentKeys?: string[];
  targetEquipmentKeys?: string[];
  disabledEquipmentSkills?: string[];
  passiveEnabled?: boolean;
};
type RunOptions = {
  ammo?: 0 | 1 | 4;
  durationMs?: number;
  iterations?: number;
  sourceHp?: number;
  targetHp?: number;
  boundaries?: boolean;
  recordVariants?: boolean;
};

test.beforeEach(async ({ page }) => {
  test.skip(process.env.SIMULATION_LIVE_API !== '1', '需要真实5C完整配置、5173服务与最终Wasm');
  const bytes = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  expect(bytes.length).toBe(WASM_IDENTITY.bytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(WASM_IDENTITY.sha256);
  await page.goto('/');
  const browserIdentity = await page.evaluate(async () => {
    const response = await fetch('/src/engine/wasm/tinygo_engine_v2.wasm');
    if (!response.ok) throw new Error(`最终Wasm读取失败：${response.status}`);
    const buffer = await response.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return { bytes: buffer.byteLength, sha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') };
  });
  expect(browserIdentity).toEqual(WASM_IDENTITY);
});

async function realSnapshot(request: APIRequestContext, scenario: Scenario): Promise<SimulationSnapshot> {
  const selection = simulationComparisonSelection({
    sourceCharacterKey: `champion_${scenario.hero}`, sourceLevel: scenario.sourceLevel ?? 18,
    targetCharacterKey: 'champion_malphite', targetLevel: 18,
    basicAttackSkillKey: `${scenario.hero}_basic_attack`, basicAttackLevel: 1,
    sourceEquipmentKeys: scenario.sourceEquipmentKeys ?? [], targetEquipmentKeys: scenario.targetEquipmentKeys ?? []
  });
  const candidateResponse = await request.post(snapshotPath, { data: selection });
  expect(candidateResponse.status(), '只读真实候选快照').toBe(200);
  const candidate = await candidateResponse.json() as SimulationSnapshot;
  const isolated = isolatedSimulationSelection(candidate);
  const passive = isolated.sourceSkillSettings.find(row => row.skillKey === `${scenario.hero}_p` && row.origin.kind === 'CHARACTER');
  if (!passive) throw new Error(`真实绑定缺少${scenario.hero}_p，等待管理页保存，不构造替代`);
  passive.enabled = scenario.passiveEnabled ?? true;
  if (passive.enabled) passive.skillLevel = 1;
  for (const side of ['source', 'target'] as const) {
    for (const source of candidate[side].skillSources.filter(row => row.origin.kind === 'EQUIPMENT')) {
      isolated[`${side}SkillSettings`].push({ origin: source.origin, skillKey: source.skillKey,
        enabled: !scenario.disabledEquipmentSkills?.includes(source.skillKey) });
    }
  }
  const response = await request.post(snapshotPath, { data: isolated });
  expect(response.status(), '实际来源开关经只读快照接口装配').toBe(200);
  const snapshot = await response.json() as SimulationSnapshot;
  expect(snapshot.selection).toEqual(isolated);
  for (const side of ['source', 'target'] as const) for (const source of snapshot[side].skillSources) {
    const setting = isolated[`${side}SkillSettings`].find(row => row.skillKey === source.skillKey
      && JSON.stringify(row.origin) === JSON.stringify(source.origin));
    expect(source.enabled, `${side}.${source.skillKey}保留真正来源开关`).toBe(setting?.enabled ?? true);
    if (source.origin.kind === 'CHARACTER' && !(side === 'source'
      && [snapshot.selection.basicAttackSkillKey, `${scenario.hero}_p`].includes(source.skillKey)) && source.skillStatus === 'ENABLED') {
      expect(source.enabled, '明确关闭其它英雄自然来源').toBe(false);
    }
  }
  return snapshot;
}

function configuration(snapshot: SimulationSnapshot, skillKey: string) {
  const matches = snapshot.skillConfigurations.filter(row => row.skill.skillKey === skillKey);
  expect(matches, `必须读取真实完整配置${skillKey}`).toHaveLength(1);
  return matches[0]!;
}

function parameter(snapshot: SimulationSnapshot, skillKey: string, parameterKey: string) {
  const row = configuration(snapshot, skillKey).parameters.find(item => item.parameterKey === parameterKey);
  if (!row) throw new Error(`真实参数缺少${skillKey}.${parameterKey}`);
  if (row.valueMode === 'FIXED' && row.fixedValue !== null) return row.fixedValue;
  if (row.valueMode === 'CHARACTER_LEVEL' && row.levelValues?.[String(snapshot.selection.sourceLevel)] !== undefined) {
    return row.levelValues[String(snapshot.selection.sourceLevel)]!;
  }
  throw new Error(`真实参数${skillKey}.${parameterKey}未保存本次明确等级值；不补作者参数`);
}

function saveProof(name: string, snapshot: SimulationSnapshot, result: {
  prepared?: { compileRequest: unknown }; runRequest?: RunRequest;
  probes?: Array<{ runRequest: RunRequest }>; variants?: Array<{ runRequest: RunRequest }>;
}) {
  mkdirSync(proofDirectory, { recursive: true });
  const runVariants = result.runRequest ? [
    { ...result.runRequest, sampling: { ...result.runRequest.sampling, disabled: true } },
    { ...result.runRequest, recordBudget: { maxAttackRecords: 0, maxDamageRecords: 0, maxMechanicRecords: 0 } },
    { ...result.runRequest, recordBudget: { maxAttackRecords: 1, maxDamageRecords: 1, maxMechanicRecords: 1 } },
    ...(result.probes ?? []).map(row => row.runRequest)
  ] : [];
  writeFileSync(resolve(proofDirectory, `${name}-compile-run.json`), JSON.stringify({ wasm: WASM_IDENTITY, snapshot,
    compileRequest: result.prepared?.compileRequest ?? null, runRequest: result.runRequest ?? null, runVariants }, null, 2));
  writeFileSync(resolve(proofDirectory, `${name}-proof.json`), JSON.stringify({ wasm: WASM_IDENTITY, snapshot, result }, null, 2));
}

async function runScenario(page: Page, name: string, snapshot: SimulationSnapshot, options: RunOptions = {}) {
  const outcome = await page.evaluate(async ({ snapshot, options }) => {
    const adapterPath = '/src/engine/simulationAdapter.ts';
    const clientPath = '/src/engine/genericEngineClient.ts';
    const continuousPath = '/src/engine/continuousAttackRequest.ts';
    const equipmentPath = '/src/engine/simulationEquipment.ts';
    const passivePath = '/src/engine/simulationEquipmentPassives.ts';
    const assessmentPath = '/src/engine/continuousAttackResult.ts';
    const { prepareSimulation, inspectSimulationSnapshot } = await import(adapterPath) as typeof import('../../src/engine/simulationAdapter');
    const { GenericEngineClient, GenericEngineClientError } = await import(clientPath) as typeof import('../../src/engine/genericEngineClient');
    const { continuousAttackRequest } = await import(continuousPath) as typeof import('../../src/engine/continuousAttackRequest');
    const { simulationHealthLimit } = await import(equipmentPath) as typeof import('../../src/engine/simulationEquipment');
    const { equipmentRangeRequirements } = await import(passivePath) as typeof import('../../src/engine/simulationEquipmentPassives');
    const { assessContinuousAttackResult } = await import(assessmentPath) as typeof import('../../src/engine/continuousAttackResult');
    const preflightPath = '/src/engine/skillFormulaPreflight.ts', proofPath = '/src/engine/approvedFormulaValues.ts';
    const { preflightSkillFormulas } = await import(preflightPath) as typeof import('../../src/engine/skillFormulaPreflight');
    const { validateConsumedFormulaValues, validateApprovedFormulaValues } = await import(proofPath) as typeof import('../../src/engine/approvedFormulaValues');
    let stage = '真实来源与作者树检查';
    let prepared: Awaited<ReturnType<typeof prepareSimulation>> | undefined;
    let compile: import('../../src/types/genericEngine').CompileResult | undefined;
    let runRequest: RunRequest | undefined;
    let done: DoneResult | undefined;
    let release: import('../../src/types/genericEngine').GenericReleaseDonePayload | undefined;
    const client = new GenericEngineClient();
    const formulaPreflight = await preflightSkillFormulas(snapshot, client);
    const runTrace: Array<{ name: string; sessionId: string; liveWorker: boolean; requestedDurationMs: number;
      durationMs: number; stopReason: string; elapsedMs: number }> = [];
    const probes: Array<{ name: string; runRequest: RunRequest; done: DoneResult;
      assessment: ReturnType<typeof assessContinuousAttackResult> }> = [];
    const variants: Array<{ name: string; runRequest: RunRequest; done: DoneResult;
      assessment: ReturnType<typeof assessContinuousAttackResult> }> = [];
    const runSameWorker = async (request: RunRequest, name: string) => {
      if (!client.hasLiveWorker || request.sessionId !== compile?.sessionId) throw new Error('必须保留同一真实Worker与编译会话');
      const startedAt = performance.now();
      const result = await client.run(request);
      if (!result.ok) throw new Error(JSON.stringify(result));
      runTrace.push({ name, sessionId: request.sessionId, liveWorker: client.hasLiveWorker,
        requestedDurationMs: request.stopPolicy.durationMs, durationMs: result.summary.durationMs, stopReason: result.summary.stopReason,
        elapsedMs: performance.now() - startedAt });
      return result;
    };
    try {
      const inspected = inspectSimulationSnapshot(snapshot);
      const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
      const ratios: Record<string, number> = { champion_ashe: .658, champion_jhin: .625, champion_malphite: .736 };
      for (const row of inspected.requirements) if (row.storedValue === undefined) {
        const key = row.attribute.attributeKey;
        if (key === 'attack_speed_ratio') {
          const ratio = ratios[snapshot[row.side].character.characterKey];
          if (ratio === undefined) throw new Error(`${row.side}缺少明确资料攻速收益系数`);
          inputs[row.side][key] = ratio;
        } else if (key === 'melee_attack' && row.side === 'source') {
          inputs.source[key] = 0;
        } else if (key === 'attack_speed' && row.side === 'source' && snapshot.selection.sourceCharacterKey === 'champion_jhin') {
          const baseline = snapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === 'jhin_p')
            ?.parameters.find(parameter => parameter.parameterKey === 'base_attack_speed');
          if (baseline?.valueMode !== 'FIXED' || baseline.fixedValue === null || baseline.fixedValue <= 0) {
            throw new Error('真实烬基础攻速资料参数未保存，不能猜测场景补充值');
          }
          inputs.source[key] = baseline.fixedValue;
        } else if (key.endsWith('_percent') || ['critical_strike_chance', 'ability_power', 'ability_haste', 'armor_pen_flat', 'magic_pen_flat', 'tenacity_percent'].includes(key)) {
          inputs[row.side][key] = 0;
        } else {
          throw new Error(`未保存必要属性${row.side}.${key}；专项只补明确零比例与资料系数，不补造基础属性`);
        }
      }
      const assumptions = equipmentRangeRequirements(snapshot).map(row => ({ owner: row.owner, equipmentKey: row.equipmentKey,
        target: row.owner === 'source' ? 'target' as const : 'source' as const, inRange: true as const }));
      const mechanicInputs = options.ammo === undefined ? [] : inspected.mechanicRequirements.map(row => ({
        side: row.side, origin: row.origin, skillKey: row.skillKey, stateKey: row.stateKey, value: options.ammo!
      }));
      if (options.ammo !== undefined && mechanicInputs.length !== 1) throw new Error('真实主体必须声明唯一弹药，不能构造替代状态');
      prepared = await prepareSimulation(snapshot, inputs, {
        source: options.sourceHp ?? simulationHealthLimit(snapshot, 'source')!,
        target: options.targetHp ?? simulationHealthLimit(snapshot, 'target')!
      }, assumptions, mechanicInputs);
      stage = '真实最终Worker编译';
      compile = await client.compile(prepared.compileRequest);
      if (!compile.ok || !compile.sessionId) throw new Error(JSON.stringify(compile.errors));
      validateConsumedFormulaValues(prepared.approvedFormulaValues, prepared.compileRequest.formulas ?? [], compile.metadata?.approvedStaticValues ?? {});
      validateApprovedFormulaValues(prepared.compileRequest.formulas ?? [], compile.metadata?.approvedStaticValues ?? {});
      stage = '原生连续运行';
      const continuous = await continuousAttackRequest(prepared, snapshot, {
        durationMs: options.durationMs ?? 6000, attackSpeedInputMax: 10
      }, compile.sessionId);
      runRequest = continuous.runRequest;
      done = await runSameWorker(runRequest, 'continuous');
      const assessment = assessContinuousAttackResult(prepared.compileRequest, runRequest, done, prepared.operationOrigins);
      const expected = JSON.stringify(done);
      const iterations = options.iterations ?? 1;
      const startedAt = performance.now();
      stage = '同Worker完整JSON重复';
      for (let iteration = 1; iteration < iterations; iteration++) {
        if (JSON.stringify(await runSameWorker(runRequest, `repeat_${iteration + 1}`)) !== expected) {
          throw new Error(`同一Worker第${iteration + 1}次完整JSON不同`);
        }
      }
      const elapsedMs = performance.now() - startedAt;
      const pressureElapsedMs = runTrace.reduce((total, row) => total + row.elapsedMs, 0);
      if (options.boundaries) {
        stage = '真实攻击、普通冷却与装填边界';
        const times = new Map<string, number>();
        const attacks = done.attackRecords ?? [];
        if (attacks[0]?.startAtMs && attacks[0].startAtMs > 0) {
          times.set('first_before', attacks[0].startAtMs - 1);
          times.set('first_at', attacks[0].startAtMs);
        }
        if (attacks[1]) {
          times.set('second_before', attacks[1].startAtMs - 1);
          times.set('second_at', attacks[1].startAtMs);
        }
        const fourth = done.mechanicRecords?.find(row => row.kind === 'STATE_CHANGED' && row.beforeValue === 1 && row.useRef !== null);
        if (fourth && fourth.timeMs > 0) {
          times.set('fourth_before', fourth.timeMs - 1);
          times.set('fourth_at', fourth.timeMs);
        }
        const wait = done.mechanicRecords?.find(row => row.kind === 'WAIT_STARTED' && row.readyAtMs !== null);
        if (wait?.readyAtMs) {
          times.set('reload_before', wait.readyAtMs - 1);
          times.set('reload_at', wait.readyAtMs);
          times.set('reload_after', wait.readyAtMs + 1);
        }
        for (const [name, durationMs] of times) {
          const request = { ...runRequest, stopPolicy: { ...runRequest.stopPolicy, durationMs } };
          const result = await runSameWorker(request, name);
          probes.push({ name, runRequest: request, done: result,
            assessment: assessContinuousAttackResult(prepared.compileRequest, request, result, prepared.operationOrigins) });
        }
        if (options.ammo === 0) {
          const before = times.get('first_before');
          if (before === undefined) throw new Error('初态0必须产生真实首发前等待边界');
          for (const [name, recordBudget] of [
            ['first_before_records_zero', { maxAttackRecords: 0, maxDamageRecords: 0, maxMechanicRecords: 0 }],
            ['first_before_records_one', { maxAttackRecords: 1, maxDamageRecords: 1, maxMechanicRecords: 1 }],
            ['first_before_mechanics_omitted', { maxAttackRecords: 1000, maxDamageRecords: 2000 }]
          ] as const) {
            const request = { ...runRequest, stopPolicy: { ...runRequest.stopPolicy, durationMs: before }, recordBudget };
            const result = await runSameWorker(request, name);
            probes.push({ name, runRequest: request, done: result,
              assessment: assessContinuousAttackResult(prepared.compileRequest, request, result, prepared.operationOrigins) });
          }
        }
      }
      if (options.recordVariants) {
        stage = '记录预算与采样对照';
        for (const [name, request] of [
          ['sampling_disabled', { ...runRequest, sampling: { ...runRequest.sampling, disabled: true } }],
          ['records_zero', { ...runRequest, recordBudget: { maxAttackRecords: 0, maxDamageRecords: 0, maxMechanicRecords: 0 } }],
          ['records_one', { ...runRequest, recordBudget: { maxAttackRecords: 1, maxDamageRecords: 1, maxMechanicRecords: 1 } }]
        ] as const) {
          const result = await runSameWorker(request, name);
          variants.push({ name, runRequest: request, done: result,
            assessment: assessContinuousAttackResult(prepared.compileRequest, request, result, prepared.operationOrigins) });
        }
      }
      stage = '原会话释放';
      const liveWorker = client.hasLiveWorker;
      release = await client.release(compile.sessionId, prepared.compileRequest.rulesHash);
      return { status: 'returned' as const, prepared, formulaPreflight, compile, runRequest, done, assessment, release,
        iterations, elapsedMs, pressureElapsedMs, liveWorker, fullJsonConsistent: true, runTrace, probes, variants };
    } catch (error) {
      let releaseFailure: string | undefined;
      if (compile?.sessionId && prepared && client.hasLiveWorker && !release) {
        try { release = await client.release(compile.sessionId, prepared.compileRequest.rulesHash); }
        catch (releaseError) { releaseFailure = String(releaseError); }
      }
      return { status: 'failed' as const, failure: { stage, message: String(error),
        ...(error instanceof GenericEngineClientError ? { engineError: error.engineError } : {}) }, prepared, formulaPreflight, compile, runRequest, done,
        release, releaseFailure, options, runTrace, probes, variants };
    } finally { client.terminate(); }
  }, { snapshot, options });
  saveProof(name, snapshot, outcome);
  if (outcome.status === 'failed') throw new Error(`${name}：${outcome.failure.stage}：${outcome.failure.message}`);
  expect(outcome.assessment.issues, '不绕过正式结果检查或伪装完整验收').toEqual([]);
  expect(outcome.assessment.complete).toBe(true);
  expect(outcome.release).toMatchObject({ ok: true, released: true, sessionId: outcome.compile.sessionId });
  expect(outcome.liveWorker).toBe(true);
  expect(outcome.done.summary.warningCount).toBe(0);
  return outcome;
}

type Result = Awaited<ReturnType<typeof runScenario>>;

async function independentCases<ScenarioCase>(cases: readonly ScenarioCase[], run: (value: ScenarioCase) => Promise<void>) {
  const failures: string[] = [];
  for (const value of cases) {
    try { await test.step(`真实配置分组${JSON.stringify(value)}`, async () => run(value)); }
    catch (error) { failures.push(`${JSON.stringify(value)}：${String(error)}`); }
  }
  expect(failures, '独立分组全部运行后汇总失败，不用跳过断言冒充通过').toEqual([]);
}

function primaryDamage(result: Result, done = result.done) {
  return done.damageRecords!.filter(row => row.abilityRef === result.prepared.basicAttackBinding.hitAbilityRef);
}

function actor(done: DoneResult, side: 'source' | 'target') {
  return done.finalSnapshot.combatants.find(row => row.key === side)!;
}

function probeResult(result: Result, name: string) {
  const row = result.probes.find(item => item.name === name);
  if (!row) throw new Error(`缺少真实Worker边界${name}`);
  expect(row.done.summary.warningCount).toBe(0);
  expect(row.done.finalSnapshot.timeMs).toBe(row.runRequest.stopPolicy.durationMs);
  return row;
}

function probe(result: Result, name: string) {
  const row = probeResult(result, name);
  expect(row.done.recording!.mechanicRecordsTruncated).toBe(false);
  return row.done;
}

function assertHealthAndCounts(result: Result) {
  const done = result.done;
  const attacks = done.attackRecords!;
  const damages = done.damageRecords!;
  expect(done.summary.basicAttack).toMatchObject({ startedCount: attacks.length, hitCount: attacks.length, completedCount: attacks.length });
  expect(attacks.map(row => row.attackIndex)).toEqual(attacks.map((_, index) => index + 1));
  expect(damages.some(row => row.operationRef.includes('skills.shared_basic_attack.')), '不额外叠共享普攻').toBe(false);
  const hp = Object.fromEntries(result.runRequest.initialSnapshot.combatants.map(row => [row.key, row.attributes.hp!.current!])) as Record<'source' | 'target', number>;
  const losses = { source: 0, target: 0 };
  const healing = { source: 0, target: 0 };
  const dealt = { source: 0, target: 0 };
  for (const [index, row] of damages.entries()) {
    expect(row.damageId).toBeGreaterThan(index ? damages[index - 1]!.damageId : 0);
    const source = row.source as 'source' | 'target';
    const target = row.target as 'source' | 'target';
    expect(['source', 'target']).toContain(source);
    expect(target).toBe(source === 'source' ? 'target' : 'source');
    expect(row.hpBefore).toBeCloseTo(hp[target], 8);
    expect(row.sourceHpBefore).toBeCloseTo(hp[source], 8);
    expect(row.actualHpLoss).toBeCloseTo(row.hpBefore - row.hpAfter, 8);
    expect(row.sourceHpAfter!).toBeGreaterThanOrEqual(row.sourceHpBefore!);
    losses[target] += row.actualHpLoss;
    dealt[source] += row.postDefenseDamage;
    healing[source] += row.sourceHpAfter! - row.sourceHpBefore!;
    hp[target] = row.hpAfter;
    hp[source] = row.sourceHpAfter!;
    const attack = attacks.find(item => item.useRef === row.useRef)!;
    expect(attack, '装备、反伤与主体必须对应原真实攻击').toBeDefined();
    expect(row.attackIndex).toBe(attack.attackIndex);
    expect(row.timeMs).toBe(attack.hitAtMs);
  }
  for (const side of ['source', 'target'] as const) {
    expect(done.summary[`${side}FinalHp`]).toBeCloseTo(hp[side], 8);
    expect(done.summary[`${side}HpLoss`]).toBeCloseTo(losses[side], 8);
    expect(done.summary[`${side}VampHealing`]).toBeCloseTo(healing[side], 8);
    expect(done.summary[`${side}DamageDealt`]).toBeCloseTo(dealt[side], 8);
    expect(actor(done, side).attributes.hp!.current).toBeCloseTo(hp[side], 8);
  }
  for (const attack of attacks) {
    const ownDamage = damages.filter(row => row.useRef === attack.useRef && row.source === 'source');
    expect(attack.postDefenseDamage, '逐刀正向伤害不混入反伤').toBeCloseTo(ownDamage.reduce((total, row) => total + row.postDefenseDamage, 0), 8);
    expect(attack.actualHpLoss).toBeCloseTo(ownDamage.reduce((total, row) => total + row.actualHpLoss, 0), 8);
    expect(attack.nextStartAtMs === null || attack.nextStartAtMs === Math.max(attack.finalReadyAtMs!, attack.mechanicReadyAtMs ?? 0)).toBe(true);
  }
}

function assertAshe(snapshot: SimulationSnapshot, result: Result, enabled = true) {
  const bodies = primaryDamage(result);
  expect(bodies).toHaveLength(result.done.attackRecords!.length);
  const source = actor(result.done, 'source');
  const damage = source.attributes.attack_damage!.resolved;
  const chance = source.attributes.critical_strike_chance!.resolved;
  const bonus = source.attributes.critical_strike_damage_bonus_percent!.resolved;
  for (const [index, row] of bodies.entries()) {
    expect(row.operationRef).toBe(`skills.ashe_basic_attack.effects.${enabled && index > 0 ? 'attack_hit' : 'attack_hit_unfrosted'}.results.damage`);
    expect(row).not.toHaveProperty('eligible');
    expect(row.critPartPostResistance).toBe(0);
    expect(row.rawAmount).toBeCloseTo(damage * (enabled && index > 0 ? 1 + chance * (1 + bonus) : 1), 8);
  }
  const slow = actor(result.done, 'target').effectiveStatuses?.flatMap(row => row.contributions).filter(row => row.statusKey === 'frost_shot') ?? [];
  expect(slow).toHaveLength(enabled ? 1 : 0);
  if (enabled) {
    expect(slow[0]!.strength).toBe(parameter(snapshot, 'ashe_p', 'slow_ratio_actual'));
    expect(slow[0]!.expireAt).toBe(result.done.attackRecords!.at(-1)!.hitAtMs! + parameter(snapshot, 'ashe_p', 'slow_duration_ms'));
  }
  const hitLinks = result.done.evidence.items.filter(row => row.kind === 'link_application'
    && row.data?.eventType === 'event/hit_link_applied' && row.ref?.startsWith('skills.ashe_basic_attack.'));
  expect(hitLinks).toHaveLength(bodies.length);
  expect(hitLinks.every(row => row.data?.count === 1)).toBe(true);
  assertHealthAndCounts(result);
}

function assertJhin(snapshot: SimulationSnapshot, result: Result) {
  const primary = configuration(snapshot, 'jhin_basic_attack');
  expect(primary.internalStates).toHaveLength(1);
  expect(primary.internalStates[0]).toMatchObject({ stateKey: 'ammo', stateType: 'AMMO', scope: 'SKILL', detail: {
    initialValue: { kind: 'FIXED', value: 4 }, maxValue: { kind: 'FIXED', value: 4 },
    recoveryIntervalValue: { kind: 'PARAMETER', parameterKey: 'reload_time_ms' },
    recoveryMode: 'ALL_AT_ONCE', recoveryStartCondition: 'WHEN_EMPTY'
  } });
  expect(primary.processes).toHaveLength(1);
  expect(primary.processes[0]!.stateOperations).toEqual([expect.objectContaining({ operation: 'CONSUME', stateKey: 'ammo',
    stateSkillKey: 'jhin_basic_attack', value: { kind: 'FIXED', value: 1 }, moment: { momentType: 'PROCESS_START', stepKey: null } })]);
  expect(primary.triggerRules.filter(row => row.eventSource.eventType === 'SKILL_HIT').flatMap(row =>
    row.conditionGroups.flatMap(group => group.conditions)).map(row => row.conditionType === 'INTERNAL_STATE_CHECK'
    ? [row.detail.valueKind, row.detail.comparator, row.detail.comparisonValue] : [row.conditionType]))
    .toEqual(expect.arrayContaining([
      ['ATTACK_START_VALUE', 'GT', { kind: 'FIXED', value: 1 }],
      ['ATTACK_START_VALUE', 'EQ', { kind: 'FIXED', value: 1 }]
    ]));
  assertJhinFixedSpeed(snapshot, result);
  const attacks = result.done.attackRecords!;
  const changes = result.done.mechanicRecords!.filter(row => row.kind === 'STATE_CHANGED' && row.useRef !== null);
  expect(changes).toHaveLength(attacks.length);
  const multiplier = parameter(snapshot, 'jhin_basic_attack', 'critical_damage_modifier')
    * (parameter(snapshot, 'jhin_basic_attack', 'base_critical_multiplier')
      + actor(result.done, 'source').attributes.critical_strike_damage_bonus_percent!.resolved);
  for (const [index, attack] of attacks.entries()) {
    const change = changes[index]!;
    expect(change).toMatchObject({ owner: 'source', skillKey: 'jhin_basic_attack', stateKey: 'ammo',
      useRef: attack.useRef, timeMs: attack.startAtMs, afterValue: change.beforeValue - 1 });
    expect(change.beforeValue).toBeGreaterThanOrEqual(1);
    const bodies = primaryDamage(result).filter(row => row.useRef === attack.useRef);
    const fourth = change.beforeValue === 1;
    expect(bodies).toHaveLength(fourth ? 2 : 1);
    expect(bodies[0]!.operationRef).toBe(`skills.jhin_basic_attack.effects.${fourth ? 'fourth_hit' : 'attack_hit'}.results.damage`);
    if (fourth) {
      expect(bodies[0]!.effectiveCritChance).toBe(1);
      expect(bodies[0]!.rawAmount).toBeCloseTo(bodies[0]!.baseRawAmount! * multiplier, 8);
      const bonus = bodies[1]!;
      expect(bonus.operationRef).toBe('skills.jhin_basic_attack.effects.fourth_hit.results.missing_health_damage');
      expect(bonus.damageId).toBeGreaterThan(bodies[0]!.damageId);
      expect(bonus).not.toHaveProperty('eligible');
      expect(bonus.critPartPostResistance).toBe(0);
      expect(bonus.rawAmount).toBeCloseTo((actor(result.done, 'target').attributes.hp!.max! - bonus.hpBefore)
        * parameter(snapshot, 'jhin_basic_attack', 'fourth_shot_execute_percent'), 8);
      const linked = result.done.evidence.items.find(row => row.kind === 'link_application'
        && row.ref === 'skills.jhin_basic_attack.effects.fourth_hit.results.hit_link' && row.data?.useRef === attack.useRef);
      expect(linked?.data).toMatchObject({ count: 1, skillKey: 'jhin_basic_attack' });
    } else {
      const chance = actor(result.done, 'source').attributes.critical_strike_chance!.resolved;
      expect(bodies[0]!.effectiveCritChance).toBe(chance);
      expect(bodies[0]!.rawAmount).toBeCloseTo(bodies[0]!.baseRawAmount! * (1 + chance * (multiplier - 1)), 8);
    }
    if (index) expect(attack.startAtMs).toBe(attacks[index - 1]!.nextStartAtMs);
  }
  const hitLinks = result.done.evidence.items.filter(row => row.kind === 'link_application'
    && row.data?.eventType === 'event/hit_link_applied' && row.ref?.startsWith('skills.jhin_basic_attack.'));
  expect(hitLinks).toHaveLength(attacks.length);
  for (const wait of result.done.mechanicRecords!.filter(row => row.kind === 'WAIT_STARTED')) {
    expect(wait.useRef, '装填等待不是一次新攻击使用，合法身份为null').toBeNull();
    expect(wait.readyAtMs).toBe(wait.timeMs + parameter(snapshot, 'jhin_basic_attack', 'reload_time_ms'));
    const end = result.done.mechanicRecords!.find(row => row.kind === 'WAIT_ENDED' && row.timeMs === wait.readyAtMs);
    if (wait.readyAtMs! <= result.done.summary.durationMs && result.done.summary.stopReason === 'duration_reached') {
      expect(end).toMatchObject({ beforeValue: 0, afterValue: 4, stateKey: 'ammo', useRef: null });
    }
  }
  assertHealthAndCounts(result);
}

function assertJhinFixedSpeed(snapshot: SimulationSnapshot, result: Result) {
  const passive = configuration(snapshot, 'jhin_p');
  expect(passive.effects).toHaveLength(1);
  expect(passive.effects[0]!.lifecycle).toMatchObject({ instanceScope: 'SOURCE', expiryMode: 'EXPLICIT_ONLY', reapplicationStackMode: 'KEEP' });
  const speed = passive.effects[0]!.results.filter(row => row.resultType === 'ATTRIBUTE_CHANGE' && row.detail.attributeKey === 'attack_speed');
  expect(speed).toHaveLength(1);
  expect(speed[0]).toMatchObject({ target: 'SOURCE', detail: { operation: 'SET', modifierZoneKey: null },
    lifecycleBehavior: { valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED', reapplicationValueMode: 'REPLACE' },
    valueRule: { value: { kind: 'PARAMETER', parameterKey: 'fixed_attack_speed_actual' } } });
  expect(result.prepared.compileRequest.rules.attributeDerivations!.filter(row => row.combatantKey === 'source'
    && row.attributeKey === 'attack_speed'), '固定攻速只声明一次').toHaveLength(1);
}

function assertJhinConversions(snapshot: SimulationSnapshot, result: Result) {
  assertJhinFixedSpeed(snapshot, result);
  const passive = configuration(snapshot, 'jhin_p');
  expect(passive.effects[0]!.results, '完整转换专项要求真实AD第二结果已保存').toHaveLength(2);
  const damage = passive.effects[0]!.results.find(row => row.resultType === 'ATTRIBUTE_CHANGE' && row.detail.attributeKey === 'attack_damage');
  expect(damage).toMatchObject({ target: 'SOURCE', detail: { operation: 'INCREASE', modifierZoneKey: 'attribute_percent_multiply' },
    lifecycleBehavior: { valueReadMode: 'MOMENT_EVALUATION', stackValueMode: 'SHARED', reapplicationValueMode: null },
    valueRule: { value: { kind: 'FORMULA', formulaKey: 'total_attack_damage_percent' } } });
  expect(result.prepared.compileRequest.rules.attributeDerivations!.filter(row => row.combatantKey === 'source'
    && row.attributeKey === 'attack_damage'), '攻击力只转换一次').toHaveLength(1);
  const passiveOrigin = result.prepared.skillOrigins.find(row => row.side === 'source' && row.skillKey === 'jhin_p')!;
  const passiveProvider = result.prepared.compileRequest.sharedProviders!.find(row => row.providerKey === passiveOrigin.definitionRef)!;
  expect(passiveProvider.modifiers ?? [], '同一转换不再复制为修正结果').toEqual([]);
}

function assertVariants(result: Result) {
  expect(result.variants.map(row => row.name)).toEqual(['sampling_disabled', 'records_zero', 'records_one']);
  for (const variant of result.variants) {
    expect(variant.assessment.factsValid, '记录预算不改变已提交的完整汇总事实是否合法').toBe(true);
    expect(variant.done.summary, '记录预算不能改变完整结算汇总').toEqual(result.done.summary);
    expect(variant.done.finalSnapshot, '记录预算不能改变最终属性、库存、过程或生命').toEqual(result.done.finalSnapshot);
    if (variant.name === 'sampling_disabled') {
      expect(variant.assessment.complete).toBe(true);
      expect(variant.done.series).toEqual([]);
      expect(variant.done.damageRecords).toEqual(result.done.damageRecords);
      expect(variant.done.recording).toEqual(result.done.recording);
    } else {
      expect(variant.done.recording!.damageRecordsTruncated).toBe(true);
      expect(variant.assessment.complete, '有限记录截断不改变结算完整性，明细缺失由recording独立标识').toBe(true);
      expect(variant.assessment.execution.complete).toBe(true);
      expect(variant.done.attackRecords).toHaveLength(variant.name === 'records_zero' ? 0 : 1);
      expect(variant.done.damageRecords).toHaveLength(variant.name === 'records_zero' ? 0 : 1);
      const maximum = variant.name === 'records_zero' ? 0 : 1;
      for (const kind of ['attack', 'damage', 'mechanic'] as const) {
        const label = kind === 'attack' ? 'Attack' : kind === 'damage' ? 'Damage' : 'Mechanic';
        const total = result.done.recording![`${kind}RecordCount`];
        const returned = Math.min(total, maximum);
        expect(variant.done.recording![`${kind}RecordCount`]).toBe(total);
        expect(variant.done.recording![`returned${label}Records`]).toBe(returned);
        expect(variant.done.recording![`dropped${label}Records`]).toBe(total - returned);
        expect(variant.done.recording![`${kind}RecordsTruncated`]).toBe(total > returned);
      }
    }
  }
}

test('5C最小真实艾希首刀无冰霜，后续强化互斥且不叠共享', async ({ page, request }) => {
  await independentCases([['真实艾希首刀与冰霜', false], ['真实艾希火炮直接暴击属性与冰霜', true]] as const, async ([name, gear]) => {
    const snapshot = await realSnapshot(request, { hero: 'ashe', sourceEquipmentKeys: gear ? ['item_3094'] : [],
      disabledEquipmentSkills: gear ? ['item_3094_passive'] : [] });
    const primary = configuration(snapshot, 'ashe_basic_attack');
    expect(primary.formulas).toHaveLength(4);
    expect(primary.effects).toHaveLength(3);
    expect(primary.triggerRules).toHaveLength(3);
    expect(primary.triggerRules.filter(row => row.eventSource.eventType === 'SKILL_HIT')
      .flatMap(row => row.conditionGroups.flatMap(group => group.conditions)).map(row =>
        row.conditionType === 'STATUS_CHECK' ? row.detail.checkKind : row.conditionType).sort()).toEqual(['ABSENT', 'PRESENT']);
    const result = await runScenario(page, name, snapshot);
    assertAshe(snapshot, result);
    if (gear) {
      expect(actor(result.done, 'source').attributes.critical_strike_chance!.resolved).toBe(.25);
      expect(primaryDamage(result)[1]!.rawAmount).toBeGreaterThan(primaryDamage(result)[0]!.rawAmount);
    }
  });
});

test('5C真实艾希被动关闭，无冰霜减速且每刀仍为普通主体', async ({ page, request }) => {
  const snapshot = await realSnapshot(request, { hero: 'ashe', passiveEnabled: false,
    sourceEquipmentKeys: ['item_3094'], disabledEquipmentSkills: ['item_3094_passive'] });
  const result = await runScenario(page, '真实艾希关闭被动无减速', snapshot);
  expect(result.prepared.skillOrigins.find(row => row.side === 'source' && row.skillKey === 'ashe_p')!.providerRef).toBeUndefined();
  expect(actor(result.done, 'target').providers.some(row => row.statusContributions?.some(status => status.statusKey === 'frost_shot'))).toBe(false);
  assertAshe(snapshot, result, false);
});

test('5C真实烬显式库存0、1、4，每刀只消费一发并跨第五发装填', async ({ page, request }) => {
  const snapshot = await realSnapshot(request, { hero: 'jhin' });
  await independentCases([undefined, 0, 1, 4] as const, async ammo => {
    const result = await runScenario(page, ammo === undefined ? '真实烬作者初值4独立对照' : `真实烬显式库存${ammo}装填边界`, snapshot,
      { ammo, durationMs: 10_000, boundaries: true, recordVariants: ammo === 0 });
    expect(result.prepared.mechanicStateInputs).toEqual(ammo === undefined ? [] : [{ side: 'source', origin: { kind: 'CHARACTER', characterKey: 'champion_jhin' },
      skillKey: 'jhin_basic_attack', stateKey: 'ammo', value: ammo }]);
    const primaryProvider = result.prepared.compileRequest.sharedProviders!.find(row => row.providerKey === 'selected_basic_attack_definition')!;
    expect(primaryProvider.initialStateSchema!.ammo).toMatchObject({ stateKind: 'ammo', defaultValue: ammo ?? 4, maxValue: 4 });
    const mount = result.prepared.compileRequest.combatants.find(row => row.key === 'source')!.providers
      .find(row => row.providerRef === 'selected_basic_attack')!;
    expect(mount.initialState ?? {}, '显式库存写声明初值，不伪造已变化的挂载状态').toEqual({});
    expect(result.runRequest.initialSnapshot.combatants.find(row => row.key === 'source')!.providers
      .find(row => row.providerRef === 'selected_basic_attack')!.state, '保持严格fresh挂载').toEqual({});
    expect(result.done.attackRecords!.length).toBeGreaterThanOrEqual(5);
    expect(result.done.attackRecords![0]!.startAtMs).toBe(ammo === 0 ? 2500 : 0);
    expect(result.done.summary.basicAttack).toMatchObject({ initialMechanicReadyAtMs: ammo === 0 ? 2500 : null });
    assertJhin(snapshot, result);
    if (ammo === 0) {
      const before = probeResult(result, 'first_before');
      expect(before.runRequest.stopPolicy.durationMs).toBe(2499);
      expect(before.done.summary.basicAttack).toMatchObject({ startedCount: 0, hitCount: 0, completedCount: 0, initialMechanicReadyAtMs: 2500 });
      expect(before.done.attackRecords).toEqual([]);
      expect(before.done.damageRecords).toEqual([]);
      expect(before.done.summary.execution!.complete).toBe(true);
      expect(before.assessment).toMatchObject({ complete: true, factsValid: true, issues: [] });
      for (const name of ['first_before_records_zero', 'first_before_records_one', 'first_before_mechanics_omitted']) {
        const variant = probeResult(result, name);
        expect(variant.runRequest.stopPolicy.durationMs).toBe(2499);
        expect(variant.done.summary).toEqual(before.done.summary);
        expect(variant.done.finalSnapshot).toEqual(before.done.finalSnapshot);
        expect(variant.done.attackRecords).toEqual([]);
        expect(variant.done.damageRecords).toEqual([]);
        expect(variant.assessment).toMatchObject({ complete: true, factsValid: true, issues: [] });
      }
      expect(probeResult(result, 'first_before_records_zero').done.mechanicRecords).toEqual([]);
      expect(probeResult(result, 'first_before_records_one').done.mechanicRecords)
        .toEqual([expect.objectContaining({ kind: 'WAIT_STARTED', timeMs: 0, readyAtMs: 2500, useRef: null })]);
      expect(probeResult(result, 'first_at').runRequest.stopPolicy.durationMs).toBe(2500);
      expect(probe(result, 'first_at').summary.basicAttack).toMatchObject({ startedCount: 1, hitCount: 1, completedCount: 1, initialMechanicReadyAtMs: 2500 });
      expect(result.done.mechanicRecords![0]).toMatchObject({ kind: 'WAIT_STARTED', timeMs: 0, beforeValue: 0, readyAtMs: 2500, useRef: null });
      assertVariants(result);
    }
    if (ammo === 1) expect(primaryDamage(result)[0]!.operationRef).toContain('fourth_hit.results.damage');
    if (ammo === 4 || ammo === undefined) {
      expect(primaryDamage(result).filter(row => row.operationRef.endsWith('missing_health_damage'))[0]!.attackIndex).toBe(4);
      const before = probe(result, 'fourth_before');
      expect(before.summary.basicAttack!.hitCount).toBe(3);
      expect(actor(before, 'source').providerState.selected_basic_attack).toMatchObject({ state: { ammo: 1 } });
    }
    const before = probe(result, 'reload_before');
    const at = probe(result, 'reload_at');
    expect(at.summary.basicAttack!.startedCount).toBe(before.summary.basicAttack!.startedCount + 1);
    expect(at.summary.basicAttack).toEqual(probe(result, 'reload_after').summary.basicAttack);
  });
});

test('5C真实烬第四发强制暴击与当前帧缺血附伤，独立吸血不重复暴击', async ({ page, request }) => {
  const snapshot = await realSnapshot(request, { hero: 'jhin', sourceEquipmentKeys: ['item_3153', 'item_3094'],
    disabledEquipmentSkills: ['item_3094_passive'] });
  const result = await runScenario(page, '真实烬第四发数值与独立吸血', snapshot, { ammo: 1, durationMs: 2501, sourceHp: 500, targetHp: 1000 });
  assertJhin(snapshot, result);
  const [body, bonus] = primaryDamage(result);
  expect(actor(result.done, 'source').attributes.critical_strike_chance!.resolved).toBe(.25);
  expect(body!.effectiveCritChance).toBe(1);
  expect(body!.multiplier).toBe(1.5);
  expect(body!.baseRawAmount).toBeCloseTo(actor(result.done, 'source').attributes.attack_damage!.resolved, 8);
  expect(bonus!.hpBefore).toBeCloseTo(body!.hpAfter, 8);
  const maximum = snapshot.target.selectedLevelValues.hp!;
  expect(bonus!.rawAmount).toBeCloseTo((maximum - body!.hpAfter) * .25, 8);
  expect(bonus!.rawAmount).not.toBeCloseTo((maximum - 1000) * .25, 5);
  const next = primaryDamage(result).find(row => row.attackIndex === 2)!;
  expect(next.effectiveCritChance).toBe(.25);
  expect(next.rawAmount).toBeCloseTo(next.baseRawAmount! * 1.125, 8);
  for (const row of [body!, bonus!]) {
    expect(row.sourceHpAfter! - row.sourceHpBefore!).toBeCloseTo(row.postDefenseDamage * .1, 8);
    expect(row.sourceHpAfter!).toBeLessThan(actor(result.done, 'source').attributes.hp!.max!);
  }
});

test('5C真实烬普通冷却与弹药共同就绪，不在任一等待结束前开始', async ({ page, request }) => {
  const snapshot = await realSnapshot(request, { hero: 'jhin', sourceLevel: 1 });
  await independentCases([1, 4] as const, async ammo => {
    const result = await runScenario(page, `真实烬普通冷却与库存${ammo}共同门禁`, snapshot, { ammo, durationMs: 7000, boundaries: true });
    assertJhin(snapshot, result);
    const first = result.done.attackRecords![0]!;
    expect(first.finalReadyAtMs).toBe(1600);
    expect(first.mechanicReadyAtMs).toBe(ammo === 1 ? 2500 : null);
    expect(result.done.attackRecords![1]!.startAtMs).toBe(ammo === 1 ? 2500 : 1600);
    expect(probe(result, 'second_before').summary.basicAttack!.startedCount).toBe(1);
    expect(probe(result, 'second_at').summary.basicAttack!.startedCount).toBe(2);
  });
});

test('5C真实烬攻速装备只转换攻击力，等级1与18固定攻速不提高', async ({ page, request }) => {
  for (const level of [1, 18]) {
    const baseSnapshot = await realSnapshot(request, { hero: 'jhin', sourceLevel: level });
    const gearSnapshot = await realSnapshot(request, { hero: 'jhin', sourceLevel: level, sourceEquipmentKeys: ['item_1042'] });
    const base = await runScenario(page, `真实烬等级${level}无装备属性转换`, baseSnapshot, { ammo: 4, durationMs: 7000 });
    const gear = await runScenario(page, `真实烬等级${level}短剑攻速转攻击力`, gearSnapshot, { ammo: 4, durationMs: 7000 });
    const speed = parameter(gearSnapshot, 'jhin_p', 'fixed_attack_speed_actual');
    expect(speed).toBeCloseTo(.625 * (1 + .03 * (level - 1)), 8);
    for (const result of [base, gear]) {
      assertJhin(result === base ? baseSnapshot : gearSnapshot, result);
      assertJhinConversions(result === base ? baseSnapshot : gearSnapshot, result);
      expect(result.done.attackRecords!.every(row => Math.abs(row.attackSpeed - speed) < 1e-9)).toBe(true);
      expect(actor(result.done, 'source').attributes.attack_speed!.resolved).toBeCloseTo(speed, 8);
      const source = actor(result.done, 'source');
      const expectedRatio = parameter(gearSnapshot, 'jhin_p', 'level_attack_damage_percent')
        + .35 * source.attributes.critical_strike_chance!.resolved + .3 * source.attributes.bonus_attack_speed_percent!.resolved;
      expect(source.attributes.attack_damage!.resolved).toBeCloseTo(source.attributes.attack_damage!.base * (1 + expectedRatio), 8);
    }
    expect(gear.done.attackRecords!.map(row => row.startAtMs)).toEqual(base.done.attackRecords!.map(row => row.startAtMs));
    expect(actor(gear.done, 'source').attributes.attack_damage!.resolved).toBeGreaterThan(actor(base.done, 'source').attributes.attack_damage!.resolved);
  }
});

for (const hero of ['ashe', 'jhin'] as const) for (const [name, sourceEquipmentKeys, targetEquipmentKeys] of [
  ['鬼索破败与荆棘', ['item_3124', 'item_3153'], ['item_3075']],
  ['鬼索智慧末刃与冰心', ['item_3124', 'item_3091'], ['item_3110']]
] as const) {
  test(`5C真实${hero === 'ashe' ? '艾希' : '烬'}${name}，同Worker100次完整JSON一致与释放`, async ({ page, request }) => {
    const snapshot = await realSnapshot(request, { hero, sourceEquipmentKeys: [...sourceEquipmentKeys], targetEquipmentKeys: [...targetEquipmentKeys] });
    const result = await runScenario(page, `真实${hero === 'ashe' ? '艾希' : '烬'}${name}同Worker100次`, snapshot,
      { iterations: 100, durationMs: 30_000, sourceHp: 500, recordVariants: true, ...(hero === 'jhin' ? { ammo: 4 as const } : {}) });
    if (hero === 'ashe') assertAshe(snapshot, result);
    else {
      assertJhin(snapshot, result);
      assertJhinConversions(snapshot, result);
    }
    const attacks = result.done.attackRecords!;
    const extra = result.done.evidence.items.filter(row => row.kind === 'link_application'
      && row.ref?.includes('skills.item_3124_passive.') && row.data?.eventType === 'event/hit_link_applied' && Number(row.data.count) > 0);
    expect(extra.length, '必须真的到达鬼索额外命中，不能只证明普通附伤').toBeGreaterThan(0);
    const extraCount = extra.reduce((total, row) => total + Number(row.data!.count), 0);
    for (const item of ['item_3124', sourceEquipmentKeys[1]]) {
      const rows = result.done.damageRecords!.filter(row => row.operationRef.startsWith(`skills.${item}_passive.`));
      expect(rows).toHaveLength(attacks.length + extraCount);
      const linkedRules = configuration(snapshot, `${item}_passive`).triggerRules.filter(row => row.eventSource.eventType === 'HIT_LINK_APPLIED').map(row => row.ruleKey);
      const linked = rows.filter(row => linkedRules.some(key => row.abilityRef.endsWith(`.ability[${key}]`)));
      expect(linked).toHaveLength(attacks.length + extraCount);
      for (const attack of attacks) {
        expect(rows.filter(row => row.useRef === attack.useRef)).toHaveLength(1 + extra.filter(row => row.data!.useRef === attack.useRef)
          .reduce((total, row) => total + Number(row.data!.count), 0));
      }
      if (item === 'item_3153') for (const row of rows) {
        expect(row.operationRef).toContain('on_hit_damage_ranged');
        expect(row.rawAmount).toBeCloseTo(row.hpBefore * parameter(snapshot, 'item_3153_passive', 'on_hit_damage_ratio_ranged'), 8);
      }
      if (item === 'item_3091') expect(rows.every(row => row.rawAmount === 45)).toBe(true);
    }
    const reflected = result.done.damageRecords!.filter(row => row.source === 'target');
    expect(reflected).toHaveLength(targetEquipmentKeys[0] === 'item_3075' ? attacks.length : 0);
    if (targetEquipmentKeys[0] === 'item_3110') expect(result.prepared.equipmentAssumptions)
      .toEqual([{ owner: 'target', equipmentKey: 'item_3110', target: 'source', inRange: true }]);
    const repeated = result.runTrace.filter(row => row.name === 'continuous' || row.name.startsWith('repeat_'));
    expect(repeated).toHaveLength(100);
    expect(new Set(result.runTrace.map(row => row.sessionId)).size).toBe(1);
    expect(result.runTrace.every(row => row.liveWorker)).toBe(true);
    expect(repeated.every(row => row.requestedDurationMs === 30_000)).toBe(true);
    expect(result.fullJsonConsistent).toBe(true);
    expect(result.done.summary.execution!.requestedDurationMs).toBe(30_000);
    assertVariants(result);
  });
}
