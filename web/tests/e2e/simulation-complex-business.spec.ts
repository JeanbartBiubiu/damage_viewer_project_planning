
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { CompileRequest, CompileResult, DoneResult, RunRequest } from '../../src/types/genericEngine';

import type { NumericValue } from '../../src/types/numericValue';
import type { SkillConfiguration } from '../../src/types/skillConfiguration';
import type { SimulationSnapshot, SimulationSkillPhase } from '../../src/types/simulationSnapshot';
import { simulationSkillSourceIdentity } from '../../src/services/simulationSkillSourceIdentity';
import { readMixedLiveSnapshot } from '../fixtures/simulationMixedLive';
import { chooseSimulationEntity, chooseSimulationLevel } from '../fixtures/simulationSelection';
import { confirmSimulationConfiguration } from '../fixtures/simulationSnapshotRequests';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';

const api = process.env.SIMULATION_API_BASE || 'http://127.0.0.1:8080';
const output = resolve('output/phase6c/business');
const wasmPath = resolve('src/engine/wasm/tinygo_engine_v2.wasm');
const expectedHash = WASM_IDENTITY.sha256;
const nativeHost = process.env.SIMULATION_GENERIC_HOST || 'C:/project/damage_wasm_dev/wasm/tinygo_engine_v2/scripts/generic-abi-host.mjs';

type BusinessCase = {
  name: string; skill: 'vi_q' | 'missfortune_r'; kind: 'damage' | 'failure' | 'counter' | 'third' | 'equipment' | 'channel';
  duration: number; releaseAt?: number; failure?: 'ACTIVE_CANCELLED' | 'EVENT_ABORTED'; cancelAt?: number;
  expectedRaw?: number; background?: boolean; withW?: boolean; miss?: boolean; attacks?: number;
  equipment?: string[]; external?: Record<string, number>; hurtSource?: boolean;
};
type PreparedBusiness = {
  compileRequest: CompileRequest;
  operationOrigins: Array<{ skillKey: string; providerDefinitionRef: string; [key: string]: unknown }>;
  skillOrigins: Array<{ skillKey: string; side: string; providerRef?: string; definitionRef?: string; [key: string]: unknown }>;
  ignoredCastCosts: unknown[];
};
type BusinessRun = {
  snapshot: SimulationSnapshot; scenario: BusinessCase; prepared: PreparedBusiness; compile: CompileResult; runRequest: RunRequest;
  runVariants: RunRequest[]; baseline: DoneResult; iterations: number; release: { ok: boolean; released: boolean };
  externalInputs: { source: Record<string, number>; target: Record<string, number> }; scout?: { duration: number; attackCount: number };
};

test.beforeEach(async ({ page }, info) => {
  if (!info.title.includes('页面读取')) await page.addInitScript(({ api, token }) => {
    localStorage.setItem('damage-viewer.web.api-base-url', api);
    localStorage.setItem('damage-viewer.web.admin-token', token);
  }, { api, token: process.env.SIMULATION_ADMIN_TOKEN || 'local-readonly-business-tests' });
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin !== new URL(api).origin || !url.pathname.startsWith('/api/')) return;
    if (request.method() !== 'GET' && request.method() !== 'OPTIONS'
      && !(request.method() === 'POST' && url.pathname.endsWith('/simulation-snapshot'))) {
      throw new Error(`真实专项禁止业务写入：${request.method()} ${url.pathname}`);
    }
  });
});

function ready(skill: BusinessCase['skill']) {
  test.skip(skill === 'vi_q' ? process.env.SIMULATION_COMPLEX_Q_READY !== '1' : process.env.SIMULATION_COMPLEX_MF_READY !== '1',
    '必须由负责人确认真实作者完整保存；未保存不读取替身、不计验收成功');
}

function identity() {
  const bytes = readFileSync(wasmPath);
  const result = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), status: 'final' };
  expect(result).toMatchObject({ bytes: WASM_IDENTITY.bytes, sha256: expectedHash });
  if (process.env.SIMULATION_EXPECTED_WASM_SHA256) expect(result.sha256).toBe(process.env.SIMULATION_EXPECTED_WASM_SHA256.toLowerCase());
  return result;
}

async function finalSnapshot(request: APIRequestContext, scenario: BusinessCase) {
  const phases: SimulationSkillPhase[] = scenario.skill === 'vi_q' ? ['INITIAL', 'CHARGE_RELEASE', 'CANCEL'] : ['INITIAL', 'CANCEL'];
  const snapshot = await readMixedLiveSnapshot(request, api, scenario.skill === 'vi_q' ? 'vi' : 'missfortune', [scenario.skill], scenario.equipment ?? [], {
    sourceLevel: 18, targetLevel: 18, backgroundAttack: scenario.background === true,
    naturalSkills: scenario.withW ? ['vi_w'] : [], phaseKinds: { [scenario.skill]: phases }
  });
  const original = await request.get(`${api}/api/admin/games/lol/skills/${scenario.skill}/configuration`);
  expect(original.status()).toBe(200);
  const current = await original.json() as SkillConfiguration;
  const saved = snapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === scenario.skill)!;
  expect(saved).toEqual(current);
  expect(snapshot.selection.plannedSkills[0]!.skillLevel).toBe(1);
  const steps = saved.processes[0]!.steps;
  if (scenario.skill === 'vi_q') {
    expect([saved.parameters.length, saved.formulas.length, saved.effects.length, saved.processes.length, steps.length, saved.triggerRules.length])
      .toEqual([15, 4, 5, 1, 2, 6]);
    expect(steps.map(step => step.stepType)).toEqual(['IMMEDIATE', 'CHARGE']);
    if (steps[1]!.stepType !== 'CHARGE') throw new Error('真实Q缺少充能步骤');
    expect(steps[1]!.detail.releaseAtMaximum).toBe(false);
    expect(saved.processes[0]!.cooldown?.startMoment).toMatchObject({ momentType: 'STEP_EXECUTION', stepKey: steps[1]!.stepKey });
  } else {
    const channel = steps.find(step => step.stepType === 'CHANNEL');
    expect(channel?.detail.firstExecution).toBe('CUSTOM_WINDOW');
    expect(channel?.occupiesAction).toBe(true);
  }
  if (scenario.withW) {
    const configuration = snapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === 'vi_w')!;
    expect(configuration.triggerRules).toHaveLength(4);
    expect(configuration.triggerRules.find(rule => rule.ruleKey === 'count_q_hit')?.eventSource)
      .toMatchObject({ eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'vi_q' } });
  }
  return snapshot;
}

async function workerRun(page: Page, snapshot: SimulationSnapshot, scenario: BusinessCase): Promise<BusinessRun> {
  await page.goto('/');
  const ignoredCostsApproved = process.env.SIMULATION_BUSINESS_IGNORE_CAST_COSTS === '1';
  const explicitInputs = JSON.parse(process.env.SIMULATION_BUSINESS_ATTRIBUTE_INPUTS || '{"source":{},"target":{}}') as {
    source: Record<string, number>; target: Record<string, number>
  };
  return await page.evaluate(async ({ snapshot, scenario, ignoredCostsApproved, explicitInputs, expectedHash, expectedBytes }) => {
    const bytes = await (await fetch('/src/engine/wasm/tinygo_engine_v2.wasm')).arrayBuffer();
    const servedHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (bytes.byteLength !== expectedBytes || servedHash !== expectedHash) throw new Error('浏览器实际Wasm不是指定最终产物');
    const workerPath = '/tests/fixtures/simulationMixedWorker.ts';
    const adapterPath = '/src/engine/simulationAdapter.ts';
    const costPath = '/src/engine/simulationActiveSkills.ts';
    const { runMixedWorkerCase } = await import(workerPath) as typeof import('../fixtures/simulationMixedWorker');
    const { inspectSimulationSnapshot } = await import(adapterPath) as typeof import('../../src/engine/simulationAdapter');
    const { simulationCastCostCandidates } = await import(costPath) as typeof import('../../src/engine/simulationActiveSkills');
    const clientPath = '/src/engine/genericEngineClient.ts', preflightPath = '/src/engine/skillFormulaPreflight.ts';
    const { GenericEngineClient } = await import(clientPath) as typeof import('../../src/engine/genericEngineClient');
    const { preflightSkillFormulas } = await import(preflightPath) as typeof import('../../src/engine/skillFormulaPreflight');
    const inspectionPreflight = await preflightSkillFormulas(snapshot, new GenericEngineClient());
    const costs = simulationCastCostCandidates(snapshot);
    if (costs.length && !ignoredCostsApproved) throw new Error('真实作者含施法成本；必须明确批准本场不模拟成本，不能静默裁掉');
    const externalInputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    const zeros = new Set(['ability_power', 'ability_haste', 'critical_strike_chance', 'critical_strike_damage_bonus_percent',
      'life_steal_percent', 'omnivamp_percent', 'physical_vamp_percent', 'spell_vamp_percent', 'armor_pen_flat', 'magic_pen_flat']);
    for (const row of inspectSimulationSnapshot(snapshot, costs).requirements) {
      const key = row.attribute.attributeKey;
      const selected = row.side === 'source' ? scenario.external?.[key] : undefined;
      const value = selected ?? explicitInputs[row.side]?.[key] ?? (zeros.has(key) || key.endsWith('_percent') ? 0 : undefined);
      if (row.storedValue !== undefined) {
        if (selected !== undefined && selected !== row.storedValue) throw new Error(`${row.side}.${key}已录固有值，现有补值接口不能覆盖；需明确场景修正能力`);
        continue;
      }
      if (value === undefined) throw new Error(`${row.side}.${key}缺少必要外部输入，不能推测英雄系数或固有值`);
      externalInputs[row.side][key] = value;
    }
    const health = { source: snapshot.source.selectedLevelValues.hp * (scenario.hurtSource ? .5 : 1), target: snapshot.target.selectedLevelValues.hp };
    if (!(health.source > 0 && health.target > 0)) throw new Error('真实初始生命缺值，不能伪造生命上限');
    const plan = snapshot.selection.plannedSkills[0]!;
    const action = (instructionKey: string, atMs: number, phaseKind: 'INITIAL' | 'CHARGE_RELEASE' | 'CANCEL', parentInstructionKey: string | null, sortOrder: number) => ({
      ...plan, instructionKey, atMs, phaseKind, parentInstructionKey, sortOrder, targetSide: 'target' as const,
      hitPreset: phaseKind === 'INITIAL' ? scenario.miss ? 'MISS' as const : 'TARGET_HIT' as const : null
    });
    const actions = [action('first', 0, 'INITIAL', null, 0)];
    if (scenario.releaseAt !== undefined) actions.push(action('release', scenario.releaseAt, 'CHARGE_RELEASE', 'first', 1));
    if (scenario.cancelAt !== undefined) actions.push(action('cancel', scenario.cancelAt, 'CANCEL', 'first', 1));
    if (scenario.kind === 'failure') {
      const boundary = (scenario.failure === 'ACTIVE_CANCELLED' ? scenario.cancelAt! : 6000) + 3000;
      actions.push(action('before', boundary - 1, 'INITIAL', null, 2), action('boundary', boundary, 'INITIAL', null, 3));
    }
    const inputs = { actions, durationMs: scenario.duration, recordTimeSeries: true, attackSpeedInputMax: 10,
      maxSkillActionRecords: 64, maxSkillUseRecords: 1024, maxHealingRecords: 1024 };
    const before = JSON.stringify(snapshot);
    let scout: { duration: number; attackCount: number } | undefined;
    if (scenario.attacks) {
      const observed = await runMixedWorkerCase(snapshot, inputs, 1, costs, externalInputs, health);
      const attacks = observed.baseline.attackRecords ?? [];
      if (attacks.length < scenario.attacks) throw new Error(`真实观察只完成${attacks.length}刀，不能伪造第${scenario.attacks}刀边界`);
      const observedHitAt = attacks[scenario.attacks - 1]!.hitAtMs;
      if (typeof observedHitAt !== 'number' || !Number.isSafeInteger(observedHitAt) || observedHitAt <= 0) throw new Error('真实普攻边界未提交或不是合法时点');
      inputs.durationMs = observedHitAt;
      scout = { duration: inputs.durationMs, attackCount: scenario.attacks };
    }
    const run = await runMixedWorkerCase(snapshot, inputs, 100, costs, externalInputs, health);
    if (JSON.stringify(snapshot) !== before) throw new Error('真实作者快照被专项修改');
    return { snapshot, scenario, ...run, inspectionPreflight, externalInputs, scout };
  }, { snapshot, scenario, ignoredCostsApproved, explicitInputs, expectedHash, expectedBytes: WASM_IDENTITY.bytes }) as unknown as BusinessRun;
}

function actor(done: DoneResult, side: 'source' | 'target') {
  return done.finalSnapshot.combatants.find(actor => actor.key === side)!;
}
function skillDamage(done: DoneResult, skill: string) {
  return (done.damageRecords ?? []).filter(row => row.operationRef.startsWith(`skills.${skill}.`));
}
function counter(run: BusinessRun, done: DoneResult) {
  const origin = run.prepared.skillOrigins.find(origin => origin.side === 'source' && origin.skillKey === 'vi_w');
  if (!origin?.providerRef || !origin.definitionRef) throw new Error('真实W未进入完整自然来源');
  const definition = run.prepared.compileRequest.sharedProviders!.find(provider => provider.providerKey === origin.definitionRef)!;
  const keys = Object.keys(definition.initialStateSchema!).filter(key => key === 'consecutive_hits' || key.endsWith('_consecutive_hits'));
  expect(keys).toHaveLength(1);
  const bag = actor(done, 'source').providerState[origin.providerRef] as { targetState?: { values: Record<string, number> } } | undefined;
  if (!bag?.targetState) {
    const declaration = definition.initialStateSchema![keys[0]!] as { defaultValue?: number };
    expect(declaration.defaultValue, 'MISS没有新目标包时只能读真实声明初值').toBe(0);
    expect(skillDamage(done, 'vi_w')).toHaveLength(0);
    return declaration.defaultValue!;
  }
  return bag.targetState.values[keys[0]!];
}

function numericValue(value: NumericValue, configuration: SkillConfiguration, run: BusinessRun, _done: DoneResult) {
  if (value.kind === 'FIXED') return value.value;
  if (value.kind === 'PARAMETER') {
    const parameter = configuration.parameters.find(row => row.parameterKey === value.parameterKey);
    if (!parameter) throw new Error('实际参数目录缺少' + value.parameterKey);
    const grade = run.snapshot.source.skillSources.find(row => row.skillKey === configuration.skill.skillKey && row.enabled)?.skillLevel;
    const selected = parameter.valueMode === 'FIXED' ? parameter.fixedValue
      : parameter.valueMode === 'RUNTIME_INPUT' ? undefined
        : parameter.levelValues?.[String(parameter.valueMode === 'SKILL_LEVEL' ? grade : run.snapshot.selection.sourceLevel)];
    if (typeof selected !== 'number' || !Number.isFinite(selected)) throw new Error('实际参数没有明确静态值：' + parameter.parameterKey);
    return selected;
  }
  const program = run.prepared.compileRequest.formulas?.find(row => row.skillKey === configuration.skill.skillKey && row.key.endsWith('/' + value.formulaKey));
  const approved = program ? run.compile.metadata?.approvedStaticValues?.[program.key] : undefined;
  if (typeof approved !== 'number' || !Number.isFinite(approved)) throw new Error('实际公式没有原生静态核定值：' + value.formulaKey);
  return approved;
}
function assertAuthorFormula(value: NumericValue, configuration: SkillConfiguration, run: BusinessRun) {
  if (value.kind !== 'FORMULA') return;
  const original = configuration.formulas.find(row => row.formulaKey === value.formulaKey);
  const transported = run.prepared.compileRequest.formulas?.filter(row => row.skillKey === configuration.skill.skillKey && row.key.endsWith('/' + value.formulaKey));
  expect(original).toBeDefined();
  expect(transported?.length).toBeGreaterThan(0);
  for (const program of transported ?? []) expect(program.expression).toEqual(original!.expression);
}

function checkBusiness(run: BusinessRun, done: DoneResult) {
  const scenario = run.scenario;
  expect(done.summary.execution?.complete).toBe(true);
  expect(done.summary.warningCount).toBe(0);
  const configuration = run.snapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === scenario.skill)!;
  const process = done.finalSnapshot.processInstances!.find(instance => instance.skillKey === scenario.skill && instance.startedAtMs === 0)!;
  const damage = skillDamage(done, scenario.skill);
  const source = actor(done, 'source');
  const ownActions = done.skillActionRecords ?? [];
  const equipmentDamage = (done.damageRecords ?? []).filter(row => row.operationRef.startsWith('skills.item_'));
  expect(equipmentDamage.filter(row => row.instructionKey === 'first' || row.useRef === process.useKey), 'Q／MF不得虚构装备普攻附伤').toHaveLength(0);
  if (scenario.skill === 'vi_q') {
    if (scenario.kind === 'failure') {
      const failedAt = scenario.failure === 'ACTIVE_CANCELLED' ? scenario.cancelAt! : 6000;
      expect(process).toMatchObject({ status: 'failed', failureReason: scenario.failure, finishedAtMs: failedAt, stepExecutionIndex: 0, cooldownStarted: false });
      expect(done.summary.skillUses).toMatchObject({ releasedCount: 0, hitCount: 0, failedCount: 1, inFlightCount: 1 });
      expect(damage).toHaveLength(0);
      expect(ownActions.find(action => action.instructionKey === 'before')).toMatchObject({ outcome: 'REJECTED', reason: 'cooldown_not_ready' });
      expect(ownActions.find(action => action.instructionKey === 'boundary')).toMatchObject({ outcome: 'ACCEPTED', actualAtMs: failedAt + 3000 });
      if (scenario.failure === 'EVENT_ABORTED') expect(ownActions.find(action => action.instructionKey === 'release')?.outcome).toBe('REJECTED');
      const initial = run.prepared.compileRequest.rules.skillActionBindings!.find(binding => binding.skillKey === scenario.skill)!
        .controls.find(control => control.action === 'INITIAL')!;
      expect(source.cooldowns[initial.abilityRef]).toMatchObject({ readyAtMs: failedAt + 3000, remainingMs: 0 });
      return;
    }
    expect(process).toMatchObject({ status: 'complete', stepExecutionIndex: 1, lastExecutionAtMs: scenario.releaseAt, cooldownStarted: true });
    expect(done.summary.skillUses).toMatchObject({ startedCount: 1, releasedCount: 1, hitCount: scenario.miss ? 0 : 1, completedCount: 1 });
    expect(damage).toHaveLength(scenario.miss ? 0 : 1);
    if (!scenario.miss) {
      const result = configuration.effects.find(effect => effect.effectKey === 'charged_damage')!.results.find(result => result.resultType === 'DAMAGE')!;
      assertAuthorFormula(result.valueRule!.value, configuration, run);
      expect(Number.isFinite(damage[0]!.rawAmount)).toBe(true);
      expect(damage[0]!.rawAmount).toBeGreaterThan(0);
      expect(damage[0]!.attackIndex).toBeNull();
      expect(damage[0]!.useRef).toBe(process.useKey);
      if (scenario.expectedRaw !== undefined) {
        const initial = run.runRequest.initialSnapshot.combatants.find(actor => actor.key === 'source')!.attributes.attack_damage;
        expect(initial.base, '初态固有AD必须来自真实角色等级值，不写死140').toBe(run.snapshot.source.selectedLevelValues.attack_damage);
        expect(initial.resolved - initial.base, '冻结真实初态BONUS').toBe(0);
        expect(source.attributes.attack_damage.resolved - source.attributes.attack_damage.base, '读实际BONUS，不把140固有AD当额外AD').toBe(0);
        expect(source.attributes.ability_power?.resolved ?? 0).toBe(0);
        expect(damage[0]!.rawAmount).toBeCloseTo(scenario.expectedRaw, 8);
      }
    }
    if (scenario.withW) {
      const wDamage = skillDamage(done, 'vi_w');
      const links = done.evidence.items.filter(item => item.kind === 'link_application' && item.ref?.includes('item_3124_passive')
        && item.data?.eventType === 'event/hit_link_applied' && Number(item.data.count) > 0);
      expect(links.filter(item => item.data?.useRef === process.useKey), 'Q没有装备命中联动资格').toHaveLength(0);
      const total = (scenario.miss ? 0 : 1) + (done.summary.basicAttack?.hitCount ?? 0) + links.reduce((sum, item) => sum + Number(item.data!.count), 0);
      expect(wDamage).toHaveLength(Math.floor(total / 3));
      expect(counter(run, done)).toBe(total % 3);
      if (scenario.kind === 'counter') expect(counter(run, done)).toBe(scenario.miss ? 0 : 1);
      if (scenario.miss) {
        const origin = run.prepared.skillOrigins.find(origin => origin.side === 'source' && origin.skillKey === 'vi_w')!;
        expect(source.providerState[origin.providerRef!], 'MISS不得创建虚构W目标计数包').toBeUndefined();
        expect(done.finalSnapshot.processInstances?.filter(instance => instance.skillKey === 'vi_w')).toEqual([]);
      }
      if (scenario.kind === 'third') {
        expect(done.summary.basicAttack).toMatchObject({ startedCount: 2, hitCount: 2 });
        expect(wDamage).toHaveLength(1);
        expect(wDamage[0]!.attackIndex).toBe(2);
        const before = run.runRequest.initialSnapshot.combatants.find(actor => actor.key === 'target')!.attributes.armor.resolved;
        expect(wDamage[0]!.resistanceFactor, '第三次附伤先按未削甲的护甲结算').toBeCloseTo(100 / (100 + before), 8);
        const w = run.snapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === 'vi_w')!;
        const ratio = numericValue({ kind: 'PARAMETER', parameterKey: 'armor_shred_ratio' }, w, run, done);
        expect(actor(done, 'target').attributes.armor.resolved, '附伤后实际削甲').toBeCloseTo(before * (1 - ratio), 8);
      }
      if (scenario.kind === 'equipment' && scenario.equipment?.includes('item_3124')) expect(links.length).toBeGreaterThan(0);
      if (scenario.kind === 'equipment') {
        const item = scenario.equipment!.find(key => key === 'item_3153' || key === 'item_3091')!;
        const itemConfiguration = run.snapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === `${item}_passive`)!;
        const linkedEffects = itemConfiguration.triggerRules.filter(rule => rule.eventSource.eventType === 'HIT_LINK_APPLIED')
          .flatMap(rule => rule.actions).filter(action => action.actionType === 'EXECUTE_EFFECT').map(action => action.detail.effectKey);
        const linkedDamage = skillDamage(done, `${item}_passive`).filter(row => linkedEffects.some(key => row.operationRef.includes(`.effects.${key}.`)));
        expect(linkedEffects.length, '只核对真实作者的额外命中联动入口').toBeGreaterThan(0);
        expect(linkedDamage).toHaveLength(links.reduce((sum, item) => sum + Number(item.data!.count), 0));
        for (const row of linkedDamage) {
          const link = links.find(item => item.timeMs === row.timeMs && item.data?.useRef === row.useRef);
          expect(link, '装备附伤必须关联真实额外命中，不补造普通攻击或Q的命中联动').toBeDefined();
          expect(row.attackIndex).toBeGreaterThan(0);
        }
      }
      const w = run.snapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === 'vi_w')!;
      const result = w.effects.find(effect => effect.effectKey === 'third_hit_damage')!.results[0]!;
      if (result.resultType !== 'DAMAGE') throw new Error('实际W附伤种类不符');
      expect(result.detail).toMatchObject({ deliveryKind: 'SKILL', originKind: 'DIRECT', vampQualification: 'RESOLVED' });
      expect(result.detail.vampOverrides).toContainEqual({ vampType: 'LIFE_STEAL', mode: 'DISABLED', basisOutputKind: null, efficiencyValue: null });
      if (scenario.hurtSource) for (const row of wDamage) {
        const rate = scenario.external?.omnivamp_percent ?? 0;
        expect(row.sourceHpBefore! + row.postDefenseDamage * rate).toBeLessThan(source.attributes.hp.max);
        expect(row.sourceHpAfter! - row.sourceHpBefore!).toBeCloseTo(row.postDefenseDamage * rate, 8);
      }
    }
    return;
  }
  const channel = configuration.processes[0]!.steps.find(step => step.stepType === 'CHANNEL');
  if (!channel || channel.stepType !== 'CHANNEL') throw new Error('真实MF缺少指定窗口');
  expect(numericValue(channel.detail.durationValue, configuration, run, done)).toBe(3000);
  expect(numericValue(channel.detail.executionCountValue, configuration, run, done)).toBe(14);
  expect(numericValue(channel.detail.firstExecutionOffsetValue!, configuration, run, done)).toBe(50);
  expect(numericValue(channel.detail.lastExecutionOffsetValue!, configuration, run, done)).toBe(2900);
  const count = scenario.cancelAt === undefined ? 14 : 5;
  const times = Array.from({ length: count }, (_, index) => Math.round(process.stepStartedAtMs + 50 + 2850 * index / 13));
  expect(damage.map(row => row.timeMs)).toEqual(times);
  expect(new Set(damage.map(row => row.hitRef)).size).toBe(count);
  expect(damage.every(row => row.attackIndex === null && row.useRef === process.useKey)).toBe(true);
  expect(done.summary.skillUses).toMatchObject({ startedCount: 1, releasedCount: count, hitCount: count });
  expect(process.repeat).toMatchObject({ executionCount: 14, executionIndex: count, firstExecutionOffsetMs: 50, lastExecutionOffsetMs: 2900, nextExecutionAtMs: null });
  expect(process.actionOccupancies.find(row => row.stepKey === channel.stepKey)).toMatchObject({ expectedEndAtMs: process.stepStartedAtMs + 3000,
    finishedAtMs: scenario.cancelAt ?? process.stepStartedAtMs + 3000 });
  expect(process.cooldownStarted).toBe(true);
  const cooldown = configuration.processes[0]!.cooldown;
  if (!cooldown) throw new Error('真实MF缺少原普通冷却声明');
  const initial = run.prepared.compileRequest.rules.skillActionBindings!.find(binding => binding.skillKey === scenario.skill)!
    .controls.find(control => control.action === 'INITIAL')!;
  const cooldownStart = cooldown.startMoment.momentType === 'PROCESS_START' ? process.startedAtMs
    : cooldown.startMoment.momentType === 'STEP_START' ? process.stepStartedAtMs
      : cooldown.startMoment.momentType === 'STEP_EXECUTION' ? times[0]
        : cooldown.startMoment.momentType === 'PROCESS_COMPLETE' ? process.finishedAtMs : undefined;
  if (cooldownStart === undefined || cooldownStart === null) throw new Error('真实MF冷却起算口径未核定');
  expect(source.cooldowns[initial.abilityRef], '原普通冷却只按首次真实时点起算，不随14段重新起算')
    .toMatchObject({ readyAtMs: cooldownStart + Math.round(numericValue(cooldown.durationValue, configuration, run, done)) });
  expect(process.status).toBe(scenario.cancelAt === undefined ? 'complete' : 'failed');
  if (scenario.cancelAt === undefined) expect(process.stepCompletedAtMs).toBe(process.stepStartedAtMs + 3000);
  else expect(process).toMatchObject({ failureReason: 'ACTIVE_CANCELLED', finishedAtMs: 1000 });
  const results = configuration.effects.flatMap(effect => effect.results).filter(result => result.resultType === 'DAMAGE');
  const bound = configuration.triggerRules.filter(rule => rule.eventSource.eventType === 'SKILL_HIT')
    .flatMap(rule => rule.actions).find(action => action.actionType === 'EXECUTE_EFFECT');
  if (!bound || bound.actionType !== 'EXECUTE_EFFECT') throw new Error('真实MF缺少完整命中效果入口');
  const result = configuration.effects.find(effect => effect.effectKey === bound.detail.effectKey)!.results.find(result => result.resultType === 'DAMAGE')!;
  assertAuthorFormula(result.valueRule!.value, configuration, run);
  const expected = damage[0]!.rawAmount;
  expect(Number.isFinite(expected) && expected > 0).toBe(true);
  expect(results.length).toBeGreaterThan(0);
  for (const row of damage) expect(row.rawAmount).toBeCloseTo(expected, 8);
  for (const result of results) {
    expect(result.spellShieldBlockScope).toBeNull();
    if (result.resultType !== 'DAMAGE') throw new Error('实际MF结果种类不符');
    expect(result.detail).toMatchObject({ deliveryKind: 'SKILL', originKind: 'DIRECT', vampQualification: 'RESOLVED' });
  }
  const binding = run.prepared.compileRequest.rules.skillActionBindings!.find(binding => binding.skillKey === scenario.skill)!;
  const provider = run.prepared.compileRequest.sharedProviders!.find(provider => provider.providerKey === binding.providerDefinitionRef)!;
  const hitKey = binding.hitBindings[0]!.hitAbilityRef.match(/\.ability\[([^\]]+)\]$/)![1]!;
  const ability = provider.abilities!.find(ability => ability.abilityKey === hitKey)!;
  const operations = ability.operations!.flatMap(operation => operation.skillHit?.candidates.flatMap(candidate => candidate.operations) ?? [])
    .filter(operation => operation.operation === 'damage');
  const matches = (matcher: { all?: string[]; any?: string[]; none?: string[] }, types: readonly string[]) =>
    (matcher.all ?? []).every(type => types.includes(type)) && (!matcher.any?.length || matcher.any.some(type => types.includes(type)))
      && !(matcher.none ?? []).some(type => types.includes(type));
  for (const operation of operations) {
    expect(operation.types).toEqual(expect.arrayContaining(['damage_trait/delivery_skill', 'damage_trait/origin_direct']));
    expect(operation.vampQualification).toBe('RESOLVED');
    const eligible = (run.prepared.compileRequest.rules.vampRules ?? []).filter(rule => matches(rule.abilityMatcher, ability.types ?? [])
      && matches(rule.damageMatcher, operation.types ?? []));
    expect(eligible.map(rule => rule.vampType), '空覆盖按真实全局匹配保留全能吸血，不授予生命偷取').toEqual(['OMNIVAMP']);
  }
  if (scenario.hurtSource) for (const row of damage) expect(row.sourceHpAfter! - row.sourceHpBefore!)
    .toBeCloseTo(row.postDefenseDamage * (scenario.external?.omnivamp_percent ?? 0), 8);
  for (const [key, value] of Object.entries(scenario.external ?? {})) expect(source.attributes[key]?.resolved).toBe(value);
}

async function nodeProof(run: BusinessRun) {
  const host = await import(pathToFileURL(nativeHost).href) as {
    instantiateGenericHost(path: string): Promise<{ exports: WebAssembly.Exports }>;
    compileCanonicalSession(exports: WebAssembly.Exports, fixture: unknown): { sessionId: string; rulesHash: string };
    runCanonicalSession(exports: WebAssembly.Exports, fixture: unknown, sessionId: string, hash: string): DoneResult;
    releaseCanonicalSession(exports: WebAssembly.Exports, sessionId: string, hash: string): unknown;
  };
  const wasm = identity();
  const fixture = { wasm, compileRequest: run.prepared.compileRequest, runRequest: run.runRequest };
  const instance = await host.instantiateGenericHost(wasmPath);
  const compiled = host.compileCanonicalSession(instance.exports, fixture);
  let baseline: DoneResult | undefined;
  try {
    for (let iteration = 0; iteration < 200; iteration++) {
      const done = host.runCanonicalSession(instance.exports, fixture, compiled.sessionId, compiled.rulesHash);
      checkBusiness(run, done);
      if (baseline) assert.deepEqual(done, baseline, `独立Node第${iteration + 1}次结果变化`);
      else { baseline = done; assert.deepEqual(done, run.baseline, '独立Node与实际Worker业务结果不一致'); }
    }
    return { iterations: 200, summary: baseline!.summary, resultHash: createHash('sha256').update(JSON.stringify(baseline)).digest('hex') };
  } finally { host.releaseCanonicalSession(instance.exports, compiled.sessionId, compiled.rulesHash); }
}

async function execute(page: Page, request: APIRequestContext, scenario: BusinessCase) {
  const snapshot = await finalSnapshot(request, scenario);
  const result = await workerRun(page, snapshot, scenario);
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, `real-${scenario.name}-observed-worker.json`), JSON.stringify({ wasm: identity(), result }, null, 2));
  expect(result.iterations).toBe(100);
  expect(result.release).toMatchObject({ ok: true, released: true });
  checkBusiness(result, result.baseline);
  const node = await nodeProof(result);
  mkdirSync(output, { recursive: true });
  const name = `real-${scenario.name}`;
  writeFileSync(resolve(output, `${name}-compile-run.json`), JSON.stringify({ wasm: identity(), snapshot,
    scenario, externalInputs: result.externalInputs, compileRequest: result.prepared.compileRequest, runRequest: result.runRequest, runVariants: result.runVariants }, null, 2));
  writeFileSync(resolve(output, `${name}-business-proof.json`), JSON.stringify({ wasm: identity(), result, node }, null, 2));
  return result;
}

for (const [releaseAt, expectedRaw] of [[0, 40], [625, 70], [1250, 100], [5999, 100]]) test(`@Q 真实Q ${releaseAt}毫秒：原伤${expectedRaw}、真实初态BONUS与封顶`, async ({ page, request }) => {
  ready('vi_q');
  await execute(page, request, { name: `vi-q-charge-${releaseAt}`, skill: 'vi_q', kind: 'damage', releaseAt, expectedRaw, duration: releaseAt + 1 });
});
for (const failure of ['EVENT_ABORTED', 'ACTIVE_CANCELLED'] as const) test(`@Q 真实Q ${failure}：零命中、失败冷却、边界前后再进入`, async ({ page, request }) => {
  ready('vi_q');
  await execute(page, request, { name: `vi-q-${failure.toLowerCase()}`, skill: 'vi_q', kind: 'failure', failure,
    ...(failure === 'EVENT_ABORTED' ? { releaseAt: 6000, duration: 9000 } : { cancelAt: 625, duration: 3625 }) });
});
for (const miss of [false, true]) test(`@Q 真实Q ${miss ? 'MISS不推进W' : '一次真实命中只给W加一'}，不虚构装备附伤`, async ({ page, request }) => {
  ready('vi_q');
  await execute(page, request, { name: `vi-q-w-${miss ? 'miss' : 'one'}`, skill: 'vi_q', kind: 'counter', releaseAt: 0, duration: 1, withW: true, miss });
});
test('@Q 真实Q加两刀普攻：第三次W先附伤后削甲', async ({ page, request }) => {
  ready('vi_q');
  await execute(page, request, { name: 'vi-q-two-aa-third-w', skill: 'vi_q', kind: 'third', releaseAt: 0, duration: 5000, background: true, withW: true, attacks: 2 });
});
for (const [name, lifeSteal, omnivamp] of [['life-only', .1, 0], ['omni-only', 0, .1]] as const) test(`@Q 真实W ${name}：缺血对照不借满血截断掩盖资格`, async ({ page, request }) => {
  ready('vi_q');
  await execute(page, request, { name: `vi-w-vamp-${name}`, skill: 'vi_q', kind: 'third', releaseAt: 0, duration: 5000,
    background: true, withW: true, attacks: 2, hurtSource: true, external: { life_steal_percent: lifeSteal, omnivamp_percent: omnivamp } });
});
for (const item of ['item_3153', 'item_3091']) test(`@Q 真实Q／W与鬼索加${item}：额外命中参与W，Q自身不发装备附伤`, async ({ page, request }) => {
  ready('vi_q');
  const common = { skill: 'vi_q' as const, kind: 'equipment' as const, releaseAt: 0, duration: 10000, background: true, withW: true, attacks: 9 };
  const control = await execute(page, request, { ...common, name: `vi-equipment-${item}-without-guinsoo`, equipment: [item] });
  const linked = await execute(page, request, { ...common, name: `vi-equipment-${item}-with-guinsoo`, equipment: ['item_3124', item] });
  const linkedW = skillDamage(linked.baseline, 'vi_w'), controlW = skillDamage(control.baseline, 'vi_w');
  expect(linkedW.length > controlW.length || linkedW.some((row, index) => row.attackIndex! < (controlW[index]?.attackIndex ?? Infinity)),
    '真实额外命中应使W更早触发或增加次数，而不要求每个观察边界必然多一次').toBe(true);
});
for (const chance of [0, .5, 1]) for (const extraCrit of [0, .25]) test(`@MF 真实MF 暴击${chance}／额外暴伤${extraCrit}：14段窗口与原公式期望`, async ({ page, request }) => {
  ready('missfortune_r');
  await execute(page, request, { name: `mf-r-crit-${chance}-bonus-${extraCrit}`, skill: 'missfortune_r', kind: 'channel', duration: 3000,
    hurtSource: true, external: { critical_strike_chance: chance, critical_strike_damage_bonus_percent: extraCrit, life_steal_percent: .1, omnivamp_percent: .1 } });
});
test('@MF 真实MF 1000毫秒取消：仅首5段、无后续段、占用实际退出', async ({ page, request }) => {
  ready('missfortune_r');
  await execute(page, request, { name: 'mf-r-cancel-1000', skill: 'missfortune_r', kind: 'channel', duration: 3000, cancelAt: 1000 });
});

for (const skill of ['vi_q', 'missfortune_r'] as const) test(`${skill === 'vi_q' ? '@Q' : '@MF'} 真实管理与模拟页面读取、实际运行及截图`, async ({ page, request }) => {
  ready(skill);
  page.setDefaultTimeout(20_000);
  mkdirSync(output, { recursive: true });
  const scenario: BusinessCase = { name: `${skill}-real-page`, skill, kind: skill === 'vi_q' ? 'damage' : 'channel', duration: 3000, releaseAt: skill === 'vi_q' ? 625 : undefined };
  const snapshot = await finalSnapshot(request, scenario);
  await page.goto('/#/skills');
  const toolbar = page.locator('.app-toolbar');
  const initialList = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).origin === api
    && new URL(response.url()).pathname === '/api/admin/games/lol/skills' && !new URL(response.url()).searchParams.has('keyword')
    && response.request().headers().authorization === `Bearer ${process.env.SIMULATION_ADMIN_TOKEN || 'local-readonly-business-tests'}`);
  await toolbar.getByPlaceholder('http://localhost:8080', { exact: true }).fill(api);
  await toolbar.getByPlaceholder('粘贴 Admin JWT', { exact: true }).fill(process.env.SIMULATION_ADMIN_TOKEN || 'local-readonly-business-tests');
  await toolbar.getByRole('button', { name: '应用', exact: true }).click();
  const game = toolbar.locator('.app-toolbar-field--game .arco-select');
  await expect(game).not.toHaveClass(/arco-select-disabled/);
  await game.click();
  await page.locator(`#${await game.getAttribute('aria-controls')}`).getByRole('option', { name: /^lol \/ / }).click();
  await expect(game).toContainText('lol /');
  await expect(toolbar.getByText('就绪', { exact: true })).toBeVisible();
  await expect(page.getByText(`当前 API 基址：${api}`, { exact: true })).toBeVisible();
  expect((await initialList).status()).toBe(200);
  await expect(page.getByRole('button', { name: '新增技能', exact: true })).toBeEnabled();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await page.getByLabel('技能关键词', { exact: true }).fill(skill);
  const listRead = page.waitForResponse(response => response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/admin/games/lol/skills' && new URL(response.url()).searchParams.get('keyword') === skill);
  await page.getByRole('button', { name: '查询', exact: true }).click();
  expect((await listRead).status()).toBe(200);
  await expect(page.getByLabel('技能关键词', { exact: true })).toHaveValue(skill);
  await expect(page.locator('tr', { hasText: skill })).toHaveCount(1);
  await page.locator('tr', { hasText: skill }).getByRole('button', { name: '编辑配置', exact: true }).click();
  const workspace = page.locator('[aria-label="技能统一编辑工作区"]');
  await expect(workspace).toBeVisible();
  await workspace.getByRole('navigation', { name: '技能配置模块' }).getByRole('button', { name: '施放过程', exact: true }).click();
  await expect(workspace.getByRole('button', { name: '保存更改', exact: true })).toBeDisabled();
  await page.screenshot({ path: resolve(output, `real-${skill}-configuration-page.png`), fullPage: true });
  await page.goto('/#/simulation/basic-attack');
  await chooseSimulationEntity(page, '攻击方角色', snapshot.selection.sourceCharacterKey);
  await chooseSimulationLevel(page, '攻击方等级', 18);
  await chooseSimulationEntity(page, '目标角色', snapshot.selection.targetCharacterKey);
  await chooseSimulationLevel(page, '目标等级', 18);
  await chooseSimulationEntity(page, '普攻技能', 'shared_basic_attack');
  await chooseSimulationLevel(page, '普攻技能等级', 1);
  await expect(page.getByRole('button', { name: '读取场景快照', exact: true })).toBeEnabled();
  const candidateRead = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/admin/games/lol/simulation-snapshot');
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  const candidateResponse = await candidateRead;
  expect(candidateResponse.status(), await candidateResponse.text()).toBe(200);
  const candidateSnapshot = await candidateResponse.json() as SimulationSnapshot;
  await expect(page.getByRole('region', { name: '攻击方角色技能来源', exact: true }).getByText(new RegExp(skill)).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '读取场景快照', exact: true })).toBeEnabled();
  await page.getByRole('checkbox', { name: '指定技能行动计划', exact: true }).locator('xpath=ancestor::label').click();
  for (const side of ['source', 'target'] as const) for (const source of candidateSnapshot[side].skillSources) {
    if (source.origin.kind !== 'CHARACTER' || source.skillStatus !== 'ENABLED') continue;
    const label = `${side === 'source' ? '攻击方' : '目标'}来源 ${simulationSkillSourceIdentity(source.origin, source.skillKey)}`;
    const enabled = side === 'source' && source.skillKey === skill;
    const checkbox = page.getByRole('checkbox', { name: `${label} 开启`, exact: true });
    if (await checkbox.isChecked() !== enabled) await checkbox.locator('xpath=ancestor::label').click();
    await expect(checkbox).toBeChecked({ checked: enabled });
    if (enabled) {
      const rank = page.getByRole('combobox', { name: `${label} 等级`, exact: true });
      await rank.click();
      await page.locator(`#${await rank.getAttribute('aria-controls')}`).getByRole('option', { name: '1', exact: true }).click();
      await expect(rank).toContainText('1');
    }
  }
  await chooseSimulationEntity(page, '攻击方主动技能候选', skill);
  await page.getByRole('button', { name: '添加首次尝试', exact: true }).click();
  if (skill === 'vi_q') await page.getByRole('button', { name: '添加首次尝试', exact: true }).click();
  await page.getByLabel('技能尝试时刻 skill_instruction_1', { exact: true }).fill('0');
  if (skill === 'vi_q') {
    await page.locator('.arco-select[aria-label="技能阶段 skill_instruction_2"]').click();
    await page.getByRole('option', { name: '蓄力释放', exact: true }).click();
    await page.getByLabel('技能尝试时刻 skill_instruction_2', { exact: true }).fill('625');
    await page.locator('.arco-select[aria-label="关联首次指令 skill_instruction_2"]').click();
    await page.getByRole('option', { name: /skill_instruction_1/ }).click();
  }
  await page.locator('.arco-select[aria-label="技能命中预设 skill_instruction_1"]').click();
  await page.getByRole('option', { name: '释放后对唯一目标尝试命中', exact: true }).click();
  await expect(page.getByRole('button', { name: '读取场景快照', exact: true })).toBeEnabled();
  const finalRead = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/admin/games/lol/simulation-snapshot');
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  const pageSnapshotResponse = await finalRead;
  expect(pageSnapshotResponse.status()).toBe(200);
  const pageSnapshot = await pageSnapshotResponse.json() as SimulationSnapshot;
  expect(pageSnapshot.selection.plannedSkills[0]!.skillLevel).toBe(1);
  expect(pageSnapshot.source.skillSources.find(source => source.skillKey === skill && source.origin.kind === 'CHARACTER')?.skillLevel).toBe(1);
  await confirmSimulationConfiguration(page);
  const costBoxes = page.getByRole('checkbox', { name: /^声明施法成本 / });
  if (await costBoxes.count() && process.env.SIMULATION_BUSINESS_IGNORE_CAST_COSTS !== '1') throw new Error('真实页面成本排除未获明确批准');
  for (const checkbox of await costBoxes.all()) {
    if (!await checkbox.isChecked()) await checkbox.locator('xpath=ancestor::label').click();
  }
  await page.getByRole('button', { name: '将缺失属性填写为0', exact: true }).click();
  await page.getByLabel('攻击方初始当前生命', { exact: true }).fill(String(snapshot.source.selectedLevelValues.hp));
  await page.getByLabel('目标初始当前生命', { exact: true }).fill(String(snapshot.target.selectedLevelValues.hp));
  await page.getByLabel('观察时长（毫秒）', { exact: true }).fill('3000');
  await page.screenshot({ path: resolve(output, `real-${skill}-simulation-config-page.png`), fullPage: true });
  await page.getByRole('button', { name: '执行指定技能计划', exact: true }).click();
  await expect(page.getByText('指定技能计划观察完成，会话已释放', { exact: false })).toBeVisible({ timeout: 120_000 });
  const result = page.getByRole('region', { name: '指定技能结果', exact: true });
  await expect(result).toContainText(skill === 'vi_q' ? '释放1，真实命中1' : '释放14，真实命中14');
  const download = page.waitForEvent('download');
  await result.getByRole('button', { name: '下载主动冻结档案', exact: true }).click();
  const archivePath = resolve(output, `real-${skill}-page-archive.json`);
  await (await download).saveAs(archivePath);
  const archive = JSON.parse(readFileSync(archivePath, 'utf8')) as {
    snapshot: SimulationSnapshot; runResult: DoneResult; wasm: { sha256: string }; cleanup: string;
  };
  expect(archive.wasm.sha256).toBe(expectedHash);
  expect(archive.cleanup).toBe('released');
  expect(archive.snapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === skill))
    .toEqual(snapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === skill));
  expect(archive.runResult.summary.execution?.complete).toBe(true);
  const damage = skillDamage(archive.runResult, skill);
  expect(damage).toHaveLength(skill === 'vi_q' ? 1 : 14);
  if (skill === 'vi_q') expect(damage[0]).toMatchObject({ timeMs: 625, rawAmount: 70 });
  else expect(damage.map(row => row.timeMs)).toEqual(Array.from({ length: 14 }, (_, index) => Math.round(50 + 2850 * index / 13)));
  await result.scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, `real-${skill}-simulation-result-page.png`), fullPage: true });
});
