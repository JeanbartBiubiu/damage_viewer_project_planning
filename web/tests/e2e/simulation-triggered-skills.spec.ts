import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { DamageRecord, DoneResult, RunRequest } from '../../src/types/genericEngine';
import type { FormulaExpressionNode } from '../../src/types/skillFormula';
import type { SimulationSelection, SimulationSnapshot } from '../../src/types/simulationSnapshot';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';
import { simulationComparisonSelection } from '../fixtures/simulationSnapshotRequests';
import { isolatedSimulationSelection } from '../fixtures/simulationSkillSources';

const api = process.env.SIMULATION_API_BASE || 'http://127.0.0.1:8080';
const path = `${api}/api/admin/games/lol/simulation-snapshot`;

test.beforeEach(async ({ page }) => {
  test.skip(process.env.SIMULATION_LIVE_API !== '1', '需要真实5B配置和最终Wasm');
  const bytes = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  expect(bytes.length).toBe(WASM_IDENTITY.bytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(WASM_IDENTITY.sha256);
  await page.goto('/');
});

async function triggeredSnapshot(request: APIRequestContext, patch: Partial<SimulationSelection> = {}, enabled = true, skillLevel?: number) {
  const response = await request.post(path, { data: simulationComparisonSelection({
    sourceCharacterKey: 'champion_jax', sourceLevel: 18, targetCharacterKey: 'champion_malphite', targetLevel: 18, ...patch
  }) });
  expect(response.status()).toBe(200);
  const candidate = await response.json() as SimulationSnapshot;
  const selection = isolatedSimulationSelection(candidate);
  const skillKey = selection.sourceCharacterKey === 'champion_vi' ? 'vi_w' : 'jax_p';
  const setting = selection.sourceSkillSettings.find(row => row.origin.kind === 'CHARACTER' && row.skillKey === skillKey);
  if (!setting) throw new Error(`真实角色绑定缺少${skillKey}，不能构造作者配置替代`);
  setting.enabled = enabled;
  setting.skillLevel = skillLevel ?? (skillKey === 'vi_w' ? 5 : 1);
  const final = await request.post(path, { data: selection });
  expect(final.status()).toBe(200);
  return await final.json() as SimulationSnapshot;
}

type TriggeredRunOptions = {
  sourceAttributes?: Partial<Record<'life_steal_percent' | 'omnivamp_percent', number>>;
  initialHealth?: Partial<Record<'source' | 'target', number>>;
  viHitBoundaries?: boolean;
  viCounterExpiry?: boolean;
};

async function runTriggered(page: Page, snapshot: SimulationSnapshot, iterations = 1, durationMs = 6000, options: TriggeredRunOptions = {}) {
  return await page.evaluate(async ({ snapshot, iterations, durationMs, options }) => {
    const adapterPath = '/src/engine/simulationAdapter.ts';
    const clientPath = '/src/engine/genericEngineClient.ts';
    const continuousPath = '/src/engine/continuousAttackRequest.ts';
    const equipmentPath = '/src/engine/simulationEquipment.ts';
    const passivePath = '/src/engine/simulationEquipmentPassives.ts';
    const assessmentPath = '/src/engine/continuousAttackResult.ts';
    const { prepareSimulation, inspectSimulationSnapshot, singleAttackRequest } = await import(adapterPath) as typeof import('../../src/engine/simulationAdapter');
    const { GenericEngineClient } = await import(clientPath) as typeof import('../../src/engine/genericEngineClient');
    const { continuousAttackRequest } = await import(continuousPath) as typeof import('../../src/engine/continuousAttackRequest');
    const { simulationHealthLimit } = await import(equipmentPath) as typeof import('../../src/engine/simulationEquipment');
    const { equipmentRangeRequirements } = await import(passivePath) as typeof import('../../src/engine/simulationEquipmentPassives');
    const { assessContinuousAttackResult } = await import(assessmentPath) as typeof import('../../src/engine/continuousAttackResult');
    const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    const requirements = inspectSimulationSnapshot(snapshot).requirements;
    for (const row of requirements) {
      const key = row.attribute.attributeKey;
      const explicit = row.side === 'source' ? options.sourceAttributes?.[key as keyof NonNullable<TriggeredRunOptions['sourceAttributes']>] : undefined;
      if (explicit !== undefined && row.storedValue !== undefined && explicit !== row.storedValue) {
        throw new Error(`source.${key}已保存固有值，场景补充值不能覆盖；不修改真实快照绕过`);
      }
      if (row.storedValue === undefined) inputs[row.side][key] = explicit ?? (key === 'attack_speed_ratio'
        ? snapshot[row.side].character.characterKey === 'champion_vi' ? .644 : .638 : key === 'melee_attack' ? 1 : 0);
    }
    for (const key of Object.keys(options.sourceAttributes ?? {})) {
      if (!requirements.some(row => row.side === 'source' && row.attribute.attributeKey === key)) {
        throw new Error(`source.${key}不是实际装配所需属性，不能偷偷改编译请求`);
      }
    }
    const assumptions = equipmentRangeRequirements(snapshot).map(row => ({ owner: row.owner, equipmentKey: row.equipmentKey,
      target: row.owner === 'source' ? 'target' as const : 'source' as const, inRange: true as const }));
    const prepared = await prepareSimulation(snapshot, inputs,
      { source: options.initialHealth?.source ?? simulationHealthLimit(snapshot, 'source')!,
        target: options.initialHealth?.target ?? simulationHealthLimit(snapshot, 'target')! }, assumptions);
    const client = new GenericEngineClient();
    let compile: import('../../src/types/genericEngine').CompileResult | undefined;
    const probes: Array<{ name: string; runRequest: RunRequest; done: DoneResult }> = [];
    const runTrace: Array<{ name: string; sessionId: string; requestedDurationMs: number; durationMs: number; stopReason: string }> = [];
    const runSameWorker = async (runRequest: RunRequest, name: string) => {
      if (!client.hasLiveWorker || runRequest.sessionId !== compile?.sessionId) throw new Error('必须保留同一真实Worker与编译会话');
      const done = await client.run(runRequest);
      if (!done.ok) throw new Error(`${name}: ${JSON.stringify(done)}`);
      runTrace.push({ name, sessionId: runRequest.sessionId, requestedDurationMs: runRequest.stopPolicy.durationMs,
        durationMs: done.summary.durationMs, stopReason: done.summary.stopReason });
      return done;
    };
    try {
      compile = await client.compile(prepared.compileRequest);
      if (!compile.ok || !compile.sessionId) throw new Error(JSON.stringify(compile.errors));
      const continuous = await continuousAttackRequest(prepared, snapshot, { durationMs, attackSpeedInputMax: 10 }, compile.sessionId);
      const done = await runSameWorker(continuous.runRequest, 'continuous');
      const assessment = assessContinuousAttackResult(prepared.compileRequest, continuous.runRequest, done, prepared.operationOrigins);
      if (!assessment.complete) throw new Error(JSON.stringify(assessment.issues));
      const expected = JSON.stringify(done);
      const startedAt = performance.now();
      for (let iteration = 1; iteration < iterations; iteration++) {
        const repeated = await runSameWorker(continuous.runRequest, `repeat_${iteration + 1}`);
        if (JSON.stringify(repeated) !== expected) throw new Error('同编译会话重复运行不同');
      }
      const elapsedMs = performance.now() - startedAt;
      if (options.viHitBoundaries || options.viCounterExpiry) {
        const hits = done.attackRecords!.filter(row => row.hitAtMs !== null);
        if (hits.length < 4) throw new Error('真实连续运行未到第四刀，不能伪造第三刀边界');
        if (options.viHitBoundaries) for (const [name, timeMs] of [
          ['second_hit', hits[1]!.hitAtMs!], ['before_third_hit', hits[2]!.hitAtMs! - 1],
          ['third_hit', hits[2]!.hitAtMs!], ['fourth_hit', hits[3]!.hitAtMs!]
        ] as const) {
          const runRequest = { ...continuous.runRequest, stopPolicy: { ...continuous.runRequest.stopPolicy, durationMs: timeMs } };
          probes.push({ name, runRequest, done: await runSameWorker(runRequest, name) });
        }
        if (options.viCounterExpiry) {
          const configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'vi_w')!;
          const marker = configuration.parameters.find(row => row.parameterKey === 'marker_duration_ms');
          if (marker?.valueMode !== 'FIXED' || marker.fixedValue !== 4000) throw new Error('真实计数期限不是冻结的4000毫秒');
          const single = singleAttackRequest(prepared.compileRequest, compile.sessionId);
          const secondHitAtMs = hits[1]!.hitAtMs!;
          for (const [name, thirdAtMs, durationMs] of [
            ['counter_before_expiry', null, secondHitAtMs + marker.fixedValue - 1],
            ['counter_at_expiry', null, secondHitAtMs + marker.fixedValue],
            ['third_before_expiry', secondHitAtMs + marker.fixedValue - 1, secondHitAtMs + marker.fixedValue - 1],
            ['third_at_expiry', secondHitAtMs + marker.fixedValue, secondHitAtMs + marker.fixedValue]
          ] as const) {
            const times = [hits[0]!.startAtMs, hits[1]!.startAtMs, ...(thirdAtMs === null ? [] : [thirdAtMs])];
            const uses = times.map((_, index) => `vi_expiry_attack_${index + 1}`);
            const runRequest: RunRequest = { ...single, runtimeOptions: continuous.runRequest.runtimeOptions,
              driverPlan: { ...single.driverPlan, entries: times.flatMap((timeMs, index) => single.driverPlan.entries.map(entry => ({
                ...entry, entryKey: `${uses[index]}_${entry.priority === 0 ? 'start' : 'hit'}`, firstAtMs: timeMs
              }))) },
              skillUses: uses.map(useKey => ({ ...single.skillUses![0]!, useKey })),
              attackStartFacts: uses.map(useRef => ({ driverEntryKey: `${useRef}_start`, useRef })),
              skillHitFacts: uses.map(useRef => ({ driverEntryKey: `${useRef}_hit`, useRef, sequence: 1 })),
              stopPolicy: { ...single.stopPolicy, durationMs, stopWhenNoEvents: false },
              sampling: continuous.runRequest.sampling, safetyBudget: continuous.runRequest.safetyBudget,
              recordBudget: continuous.runRequest.recordBudget };
            probes.push({ name, runRequest, done: await runSameWorker(runRequest, name) });
          }
        }
      }
      const release = await client.release(compile.sessionId, prepared.compileRequest.rulesHash);
      return { prepared, compile, runRequest: continuous.runRequest, done, assessment, release, iterations, elapsedMs, probes, runTrace };
    } finally { client.terminate(); }
  }, { snapshot, iterations, durationMs, options });
}

function saveProof(name: string, snapshot: SimulationSnapshot, result: Awaited<ReturnType<typeof runTriggered>>) {
  const directory = resolve('output/phase5b');
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, `${name}-compile-run.json`), JSON.stringify({ wasm: WASM_IDENTITY, snapshot,
    compileRequest: result.prepared.compileRequest, runRequest: result.runRequest, runVariants: [
      { ...result.runRequest, sampling: { ...result.runRequest.sampling, disabled: true } },
      { ...result.runRequest, recordBudget: { maxAttackRecords: 0, maxDamageRecords: 0 } }
    ] }, null, 2));
  writeFileSync(resolve(directory, `${name}-proof.json`), JSON.stringify({ wasm: WASM_IDENTITY, snapshot, result }, null, 2));
}

function jaxStacks(result: Awaited<ReturnType<typeof runTriggered>>) {
  const origin = result.prepared.skillOrigins.find(row => row.skillKey === 'jax_p' && row.side === 'source')!;
  const definition = result.prepared.compileRequest.sharedProviders!.find(row => row.providerKey === origin.definitionRef)!;
  const key = Object.keys(definition.initialStateSchema!).find(row => row.endsWith('effect_relentless_attack_speed'))!;
  const actor = result.done.finalSnapshot.combatants.find(row => row.key === 'source')!;
  const state = actor.providerState[origin.providerRef!] as { state: Record<string, number> };
  return state.state[key];
}

test('5B真实贾克斯开始叠层改变首个等待，达到8层且关闭后不产生来源', async ({ page, request }, testInfo) => {
  const snapshot = await triggeredSnapshot(request);
  const on = await runTriggered(page, snapshot);
  const off = await runTriggered(page, await triggeredSnapshot(request, {}, false));
  expect(on.done.attackRecords![1]!.startAtMs).toBeLessThan(off.done.attackRecords![1]!.startAtMs);
  expect(on.done.summary.basicAttack!.startedCount).toBeGreaterThanOrEqual(8);
  expect(jaxStacks(on)).toBe(8);
  expect(on.done.damageRecords).toHaveLength(on.done.attackRecords!.length);
  expect(off.prepared.skillOrigins.find(row => row.skillKey === 'jax_p' && row.side === 'source')!.providerRef).toBeUndefined();
  expect(on.release.released).toBe(true);
  saveProof('真实贾克斯开始叠层', snapshot, on);
  await testInfo.attach('真实Jax最终Worker', { body: JSON.stringify({ on, off }), contentType: 'application/json' });
});

for (const [name, sourceEquipmentKeys, targetEquipmentKeys] of [
  ['鬼索破败与荆棘', ['item_3124', 'item_3153'], ['item_3075']],
  ['鬼索智慧末刃与冰心', ['item_3124', 'item_3091'], ['item_3110']]
] as const) {
  test(`5B真实贾克斯${name}，联动不增加开始次数且同会话100次一致`, async ({ page, request }, testInfo) => {
    const snapshot = await triggeredSnapshot(request, { sourceEquipmentKeys: [...sourceEquipmentKeys], targetEquipmentKeys: [...targetEquipmentKeys] });
    const result = await runTriggered(page, snapshot, 100, 30_000);
    expect(result.done.summary.basicAttack!.startedCount).toBe(result.done.summary.basicAttack!.hitCount);
    expect(result.done.damageRecords!.length).toBeGreaterThan(result.done.attackRecords!.length);
    expect(jaxStacks(result)).toBe(Math.min(8, result.done.summary.basicAttack!.startedCount));
    expect(result.release.released).toBe(true);
    saveProof(`真实贾克斯${name}`, snapshot, result);
    await testInfo.attach('真实组合最终Worker及100次', { body: JSON.stringify(result), contentType: 'application/json' });
  });
}

test('5B构造动态期限嵌入真实装备形状，命名公式经最终Worker编译并执行', async ({ page, request }, testInfo) => {
  const snapshot = await triggeredSnapshot(request, { sourceEquipmentKeys: ['item_3153'] });
  const configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'item_3153_passive')!;
  const slow = configuration.effects.find(row => row.results.some(result => result.resultType === 'STATUS_OPERATION'))!;
  const duration = slow.lifecycle!.durationValue!;
  expect(duration.kind).toBe('PARAMETER');
  if (duration.kind !== 'PARAMETER') throw new Error('真实期限不是已核定参数');
  configuration.formulas.push({ ...configuration.formulas[0]!, formulaKey: 'constructed_duration', name: '独立构造期限',
    expression: { nodeType: 'OPERATION', operation: 'ADD', operands: [
      { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'attack_range', attributeValueKind: 'BASE' },
      { nodeType: 'PARAMETER', parameterKey: duration.parameterKey }
    ] } });
  slow.lifecycle!.durationValue = { kind: 'FORMULA', formulaKey: 'constructed_duration' };
  const result = await runTriggered(page, snapshot);
  expect(result.prepared.compileRequest.formulas!.some(row => row.key.includes('/status/') && row.key.endsWith('/constructed_duration'))).toBe(true);
  expect(result.release.released).toBe(true);
  saveProof('独立构造动态期限', snapshot, result);
  await testInfo.attach('独立构造，不是实库配置验收', { body: JSON.stringify(result), contentType: 'application/json' });
});

type TriggeredResult = Awaited<ReturnType<typeof runTriggered>>;

function viConfiguration(snapshot: SimulationSnapshot) {
  const configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'vi_w');
  if (!configuration) throw new Error('真实快照缺少vi_w，不能构造配置替代');
  expect(configuration.parameters).toHaveLength(9);
  expect(configuration.parameters.find(row => row.parameterKey === 'trigger_hit_count')).toMatchObject({ valueMode: 'FIXED', fixedValue: 3 });
  expect(configuration.parameters.find(row => row.parameterKey === 'marker_duration_ms')).toMatchObject({ valueMode: 'FIXED', fixedValue: 4000 });
  expect(configuration.internalStates.find(row => row.stateKey === 'consecutive_hits')).toMatchObject({
    stateType: 'COUNTER', scope: 'TARGET', detail: { initialValue: { kind: 'FIXED', value: 0 },
      maxValue: { kind: 'PARAMETER', parameterKey: 'trigger_hit_count' },
      durationValue: { kind: 'PARAMETER', parameterKey: 'marker_duration_ms' } }
  });
  for (const [ruleKey, eventType] of [['count_basic_hit', 'BASIC_ATTACK_HIT'], ['count_hit_link', 'HIT_LINK_APPLIED']] as const) {
    expect(configuration.triggerRules.find(row => row.ruleKey === ruleKey)).toMatchObject({ eventSource: { eventType },
      actions: [{ actionType: 'START_PROCESS', detail: { processKey: 'advance_hit_count' } }] });
  }
  const resolve = configuration.triggerRules.find(row => row.ruleKey === 'resolve_third_hit')!;
  expect(resolve.eventSource).toMatchObject({ eventType: 'PROCESS_MOMENT', detail: {
    processKey: 'advance_hit_count', moment: { momentType: 'PROCESS_COMPLETE' } }
  });
  expect(resolve.conditionGroups.flatMap(group => group.conditions)).toEqual(expect.arrayContaining([
    expect.objectContaining({ conditionType: 'INTERNAL_STATE_CHECK', detail: expect.objectContaining({
      stateSkillKey: 'vi_w', stateKey: 'consecutive_hits', valueKind: 'VALUE', comparator: 'GTE',
      comparisonValue: { kind: 'PARAMETER', parameterKey: 'trigger_hit_count' } }) })
  ]));
  expect([...resolve.actions].sort((left, right) => left.sortOrder - right.sortOrder).map(row => ({ actionType: row.actionType, detail: row.detail }))).toEqual([
    { actionType: 'EXECUTE_EFFECT', detail: { effectKey: 'third_hit_damage' } },
    { actionType: 'EXECUTE_EFFECT', detail: { effectKey: 'armor_shred' } },
    { actionType: 'EXECUTE_EFFECT', detail: { effectKey: 'attack_speed' } },
    { actionType: 'START_PROCESS', detail: { processKey: 'reset_hit_count' } }
  ]);
  for (const processKey of ['advance_hit_count', 'reset_hit_count']) {
    const process = configuration.processes.find(row => row.processKey === processKey)!;
    expect(process.steps.every(row => row.stepType === 'IMMEDIATE')).toBe(true);
    expect(process.stateOperations.some(row => row.stateSkillKey === 'vi_w' && row.stateKey === 'consecutive_hits')).toBe(true);
  }
  const damage = configuration.effects.find(row => row.effectKey === 'third_hit_damage')!.results.find(row => row.resultKey === 'damage')!;
  expect(damage).toMatchObject({ resultType: 'DAMAGE', target: 'TARGET', valueRule: { value: { kind: 'FORMULA', formulaKey: 'damage' } },
    detail: { damageTypeKey: 'physics', vampQualification: 'RESOLVED' } });
  const formula = configuration.formulas.find(row => row.formulaKey === 'damage')!;
  const nodes = (node: FormulaExpressionNode): FormulaExpressionNode[] => [node,
    ...(node.nodeType === 'OPERATION' ? node.operands.flatMap(nodes) : [])];
  expect(nodes(formula.expression)).toContainEqual({ nodeType: 'OPERATION', operation: 'ADD', operands: [
    { nodeType: 'ATTRIBUTE', attributeOwner: 'TARGET', attributeKey: 'hp', attributeValueKind: 'CURRENT' },
    { nodeType: 'ATTRIBUTE', attributeOwner: 'TARGET', attributeKey: 'hp', attributeValueKind: 'MISSING' }
  ] });
  expect(nodes(formula.expression).some(row => row.nodeType === 'ATTRIBUTE' && row.attributeKey === 'hp' && row.attributeValueKind === 'TOTAL')).toBe(false);
  return configuration;
}

function viDamage(result: TriggeredResult, done = result.done) {
  const origins = result.prepared.operationOrigins.filter(row => row.skillKey === 'vi_w' && row.effectKey === 'third_hit_damage' && row.resultKey === 'damage');
  expect(origins.length, '必须有真实W伤害作者结果映射').toBeGreaterThan(0);
  return done.damageRecords!.filter(row => origins.some(origin => origin.abilityRef === row.abilityRef && origin.operationRef === row.operationRef
    && origin.providerDefinitionRef === row.providerDefinitionRef));
}

function primaryDamage(result: TriggeredResult, done = result.done) {
  return done.damageRecords!.filter(row => row.abilityRef === result.prepared.basicAttackBinding.hitAbilityRef);
}

function viCounter(result: TriggeredResult, done = result.done) {
  const origin = result.prepared.skillOrigins.find(row => row.skillKey === 'vi_w' && row.side === 'source')!;
  const definition = result.prepared.compileRequest.sharedProviders!.find(row => row.providerKey === origin.definitionRef)!;
  const keys = Object.keys(definition.initialStateSchema!).filter(row => row === 'consecutive_hits' || row.endsWith('_consecutive_hits'));
  expect(keys).toHaveLength(1);
  const key = keys[0]!;
  expect(definition.initialStateSchema![key]).toMatchObject({ valueType: 'integer', defaultValue: 0, maxValue: 3,
    durationMs: 4000, refreshPolicy: 'refresh_on_write' });
  const actor = done.finalSnapshot.combatants.find(row => row.key === 'source')!;
  const bag = actor.providerState[origin.providerRef!] as { targetState: { target: string; values: Record<string, number>; expireAt: Record<string, number> } };
  expect(bag.targetState.target).toBe('target');
  return { key, value: bag.targetState.values[key], expireAt: bag.targetState.expireAt[key] };
}

function viProbe(result: TriggeredResult, name: string) {
  const probe = result.probes.find(row => row.name === name);
  if (!probe) throw new Error(`缺少真实Worker边界${name}`);
  expect(probe.done.recording!.damageRecordsTruncated).toBe(false);
  expect(probe.done.summary.warningCount).toBe(0);
  return probe;
}

function assertArmor(row: DamageRecord, armor: number) {
  expect(row.damageType).toBe('damage/physics');
  expect(row.resistanceBeforePenetration).toBeCloseTo(armor, 8);
  expect(row.effectiveResistance).toBeCloseTo(armor, 8);
  expect(row.resistanceFactor).toBeCloseTo(100 / (100 + armor), 8);
  expect(row.postDefenseDamage).toBeCloseTo(row.rawAmount * 100 / (100 + armor), 8);
}

test('5B真实蔚W等级1/3/5，第三刀附伤后才削甲且使用最大生命', async ({ page, request }, testInfo) => {
  for (const [grade, hpRatio, attackSpeedBonus] of [[1, .04, .3], [3, .06, .4], [5, .08, .5]] as const) {
    const snapshot = await triggeredSnapshot(request, { sourceCharacterKey: 'champion_vi', sourceEquipmentKeys: ['item_1036'] }, true, grade);
    const configuration = viConfiguration(snapshot);
    expect(snapshot.selection.targetCharacterKey).toBe('champion_malphite');
    expect(snapshot.selection.targetLevel).toBe(18);
    const result = await runTriggered(page, snapshot, 1, 6000, { initialHealth: { source: 500, target: 1000 }, viHitBoundaries: true });
    const source = result.prepared.compileRequest.combatants.find(row => row.key === 'source')!;
    const target = result.prepared.compileRequest.combatants.find(row => row.key === 'target')!;
    const origin = result.prepared.skillOrigins.find(row => row.side === 'source' && row.skillKey === 'vi_w')!;
    expect(origin.skillLevel).toBe(grade);
    const definition = result.prepared.compileRequest.sharedProviders!.find(row => row.providerKey === origin.definitionRef)!;
    for (const ability of definition.abilities!) {
      expect(ability.params).toMatchObject({ attack_speed_ratio: attackSpeedBonus, max_health_damage_percent_points: hpRatio * 100 });
      for (const [parameterKey, actual] of Object.entries(ability.params!)) {
        const parameter = configuration.parameters.find(row => row.parameterKey === parameterKey)!;
        expect(['FIXED', 'SKILL_LEVEL']).toContain(parameter.valueMode);
        const expected = parameter.valueMode === 'FIXED' ? parameter.fixedValue : parameter.levelValues![String(grade)];
        expect(actual).toBe(expected);
      }
    }
    const second = viProbe(result, 'second_hit').done;
    const beforeThird = viProbe(result, 'before_third_hit').done;
    const third = viProbe(result, 'third_hit').done;
    const fourth = viProbe(result, 'fourth_hit').done;
    expect(second.summary.basicAttack!.hitCount).toBe(2);
    expect(beforeThird.summary.basicAttack!.hitCount).toBe(2);
    expect(viCounter(result, second).value).toBe(2);
    expect(viCounter(result, beforeThird).value).toBe(2);
    expect(viDamage(result, second)).toHaveLength(0);
    expect(viDamage(result, beforeThird)).toHaveLength(0);
    expect(third.summary.basicAttack!.hitCount).toBe(3);
    expect(fourth.summary.basicAttack!.hitCount).toBe(4);
    expect(viCounter(result, third).value).toBe(0);
    expect(viCounter(result, fourth).value).toBe(1);
    const bodies = primaryDamage(result, fourth);
    expect(bodies).toHaveLength(4);
    const damage = viDamage(result, third);
    expect(damage).toHaveLength(1);
    expect(damage[0]!.attackIndex).toBe(3);
    expect(damage[0]!.damageId).toBeGreaterThan(bodies[2]!.damageId);
    expect(damage[0]!.useRef).toBe(bodies[2]!.useRef);
    for (const body of bodies.slice(0, 3)) assertArmor(body, target.attributes.armor!.resolved);
    assertArmor(damage[0]!, target.attributes.armor!.resolved);
    assertArmor(bodies[3]!, target.attributes.armor!.resolved * .8);
    const bonusAd = source.attributes.attack_damage!.resolved - source.attributes.attack_damage!.base;
    expect(bonusAd).toBeGreaterThan(0);
    const ratio = hpRatio + bonusAd / 100 * .035;
    expect(target.attributes.hp!.current).toBeLessThan(target.attributes.hp!.max);
    expect(damage[0]!.rawAmount).toBeCloseTo(target.attributes.hp!.max * ratio, 8);
    expect(Math.abs(damage[0]!.rawAmount - damage[0]!.hpBefore * ratio)).toBeGreaterThan(1);
    expect(third.finalSnapshot.combatants.find(row => row.key === 'target')!.attributes.armor!.resolved).toBeCloseTo(target.attributes.armor!.resolved * .8, 8);
    expect(fourth.attackRecords![3]!.attackSpeed).toBeCloseTo(third.attackRecords![2]!.attackSpeed + source.attributes.attack_speed_ratio!.resolved * attackSpeedBonus, 8);
    expect(result.release.released).toBe(true);
    saveProof(`真实蔚W等级${grade}第三刀边界`, snapshot, result);
    await testInfo.attach(`真实蔚W等级${grade}最终Worker`, { body: JSON.stringify(result), contentType: 'application/json' });
  }
});

test('5B真实蔚目标计数刷新后4秒到期，期限前后第三刀对照不伪造状态', async ({ page, request }, testInfo) => {
  const snapshot = await triggeredSnapshot(request, { sourceCharacterKey: 'champion_vi' });
  viConfiguration(snapshot);
  const result = await runTriggered(page, snapshot, 1, 6000, { initialHealth: { source: 500, target: 1000 }, viCounterExpiry: true });
  const before = viProbe(result, 'counter_before_expiry');
  const expired = viProbe(result, 'counter_at_expiry');
  expect(viCounter(result, before.done).value).toBe(2);
  expect(viCounter(result, before.done).expireAt).toBe(expired.runRequest.stopPolicy.durationMs);
  expect(viCounter(result, expired.done).value).toBe(0);
  expect(viCounter(result, expired.done).expireAt).toBeUndefined();
  expect(expired.done.evidence.items).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'provider_target_state_expired',
    timeMs: expired.runRequest.stopPolicy.durationMs, data: expect.objectContaining({ stateKey: viCounter(result, expired.done).key, target: 'target' }) })]));
  for (const probe of [before, expired]) {
    expect(probe.runRequest.initialSnapshot.timeMs).toBe(0);
    expect(primaryDamage(result, probe.done)).toHaveLength(2);
    expect(viDamage(result, probe.done)).toHaveLength(0);
    expect(probe.done.finalSnapshot.timeMs).toBe(probe.runRequest.stopPolicy.durationMs);
  }
  const thirdBefore = viProbe(result, 'third_before_expiry');
  const thirdAt = viProbe(result, 'third_at_expiry');
  for (const probe of [thirdBefore, thirdAt]) {
    expect(primaryDamage(result, probe.done)).toHaveLength(3);
    expect(primaryDamage(result, probe.done)[2]!.timeMs).toBe(probe.runRequest.stopPolicy.durationMs);
  }
  expect(viDamage(result, thirdBefore.done)).toHaveLength(1);
  expect(viCounter(result, thirdBefore.done).value).toBe(0);
  expect(viDamage(result, thirdAt.done)).toHaveLength(0);
  expect(viCounter(result, thirdAt.done).value).toBe(1);
  expect(result.release.released).toBe(true);
  saveProof('真实蔚计数4秒到期对照', snapshot, result);
  await testInfo.attach('真实配置，原生两次普攻后等待4秒，不是连续自动攻击或伪造计数', { body: JSON.stringify(result), contentType: 'application/json' });
});

test('5B真实蔚W仅生命偷取不吸血、仅全能吸血可入账，主体自身吸血保留', async ({ page, request }, testInfo) => {
  const snapshot = await triggeredSnapshot(request, { sourceCharacterKey: 'champion_vi' });
  viConfiguration(snapshot);
  for (const [name, lifeSteal, omnivamp] of [['仅生命偷取', .1, 0], ['仅全能吸血', 0, .1]] as const) {
    const result = await runTriggered(page, snapshot, 1, 6000, { initialHealth: { source: 500, target: 1000 }, viHitBoundaries: true,
      sourceAttributes: { life_steal_percent: lifeSteal, omnivamp_percent: omnivamp } });
    const source = result.prepared.compileRequest.combatants.find(row => row.key === 'source')!;
    expect(source.attributes.life_steal_percent!.resolved).toBe(lifeSteal);
    expect(source.attributes.omnivamp_percent!.resolved).toBe(omnivamp);
    expect(source.attributes.hp!.current).toBe(500);
    const done = viProbe(result, 'third_hit').done;
    const bodies = primaryDamage(result, done);
    const damage = viDamage(result, done);
    expect(bodies).toHaveLength(3);
    expect(damage).toHaveLength(1);
    let totalHealing = 0;
    for (const row of [...bodies, ...damage]) {
      expect(row.sourceHpBefore).not.toBeNull();
      expect(row.sourceHpAfter).not.toBeNull();
      const isW = damage.includes(row);
      const expected = row.postDefenseDamage * (isW ? omnivamp : lifeSteal + omnivamp);
      expect(row.sourceHpBefore! + expected, '不能用满血截断证明W禁止生命偷取').toBeLessThan(source.attributes.hp!.max);
      expect(row.sourceHpAfter! - row.sourceHpBefore!).toBeCloseTo(expected, 8);
      if (!isW) expect(row.sourceHpAfter! - row.sourceHpBefore!).toBeGreaterThan(0);
      totalHealing += expected;
    }
    const wHealing = damage[0]!.sourceHpAfter! - damage[0]!.sourceHpBefore!;
    if (omnivamp > 0) expect(wHealing).toBeGreaterThan(0);
    else expect(wHealing).toBe(0);
    expect(done.summary.sourceVampHealing).toBeCloseTo(totalHealing, 8);
    expect(done.summary.sourceFinalHp).toBeCloseTo(500 + totalHealing, 8);
    expect(result.release.released).toBe(true);
    saveProof(`真实蔚W${name}`, snapshot, result);
    await testInfo.attach(`真实蔚W${name}实际吸血入账`, { body: JSON.stringify(result), contentType: 'application/json' });
  }
});

for (const [name, sourceEquipmentKeys, targetEquipmentKeys] of [
  ['鬼索破败与荆棘', ['item_3124', 'item_3153'], ['item_3075']],
  ['鬼索智慧末刃与冰心', ['item_3124', 'item_3091'], ['item_3110']]
] as const) {
  test(`5B真实蔚${name}，额外命中参与W而不增加真实开始，同Worker100次一致`, async ({ page, request }, testInfo) => {
    const snapshot = await triggeredSnapshot(request, { sourceCharacterKey: 'champion_vi',
      sourceEquipmentKeys: [...sourceEquipmentKeys], targetEquipmentKeys: [...targetEquipmentKeys] });
    viConfiguration(snapshot);
    const result = await runTriggered(page, snapshot, 100, 30_000, { initialHealth: { source: 500 } });
    const controlSnapshot = await triggeredSnapshot(request, { sourceCharacterKey: 'champion_vi',
      sourceEquipmentKeys: sourceEquipmentKeys.filter(key => key !== 'item_3124'), targetEquipmentKeys: [...targetEquipmentKeys] });
    const control = await runTriggered(page, controlSnapshot, 1, 30_000, { initialHealth: { source: 500 } });
    const attacks = result.done.attackRecords!;
    const bodies = primaryDamage(result);
    const damage = viDamage(result);
    expect(result.done.summary.basicAttack).toMatchObject({ startedCount: attacks.length, hitCount: attacks.length, completedCount: attacks.length });
    expect(bodies).toHaveLength(attacks.length);
    expect(attacks.map(row => row.attackIndex)).toEqual(attacks.map((_, index) => index + 1));
    const links = result.done.evidence.items.filter(row => row.kind === 'link_application' && row.ref?.includes('item_3124_passive')
      && row.data?.eventType === 'event/hit_link_applied' && Number(row.data.count) > 0);
    expect(links.length, '必须真实运行到鬼索额外命中，不能只看到普通附伤').toBeGreaterThan(0);
    let count = 0;
    const expectedW: number[] = [];
    for (const [index, attack] of attacks.entries()) {
      if (index) expect(attack.startAtMs).toBeGreaterThan(attacks[index - 1]!.startAtMs);
      expect(bodies[index]!.useRef).toBe(attack.useRef);
      expect(bodies[index]!.timeMs).toBe(attack.hitAtMs);
      const extraHits = links.filter(row => row.data!.useRef === attack.useRef);
      for (const link of extraHits) {
        expect(link.timeMs).toBe(attack.hitAtMs);
        expect(link.data).toMatchObject({ source: 'source', target: 'target', skillKey: 'shared_basic_attack' });
        expect(Number.isSafeInteger(link.data!.count)).toBe(true);
      }
      count += 1 + extraHits.reduce((total, row) => total + Number(row.data!.count), 0);
      while (count >= 3) { expectedW.push(attack.attackIndex); count -= 3; }
    }
    expect(damage.map(row => row.attackIndex)).toEqual(expectedW);
    expect(viCounter(result).value).toBe(count);
    for (const row of damage) {
      const attack = attacks.find(attack => attack.useRef === row.useRef)!;
      expect(row.attackIndex).toBe(attack.attackIndex);
      expect(row.timeMs).toBe(attack.hitAtMs);
    }
    const controlDamage = viDamage(control);
    expect(controlDamage.map(row => row.attackIndex)).toEqual(controlDamage.map((_, index) => (index + 1) * 3));
    const commonHits = Math.min(attacks.length, control.done.attackRecords!.length);
    const earlier = damage.some((row, index) => row.attackIndex <= commonHits && row.attackIndex < (index + 1) * 3);
    const more = damage.filter(row => row.attackIndex <= commonHits).length > controlDamage.filter(row => row.attackIndex <= commonHits).length;
    expect(earlier || more, '按相同真实攻击序号比较，不用鬼索直接攻速差冒充计数收益').toBe(true);
    expect(result.iterations).toBe(100);
    expect(result.runTrace).toHaveLength(100);
    expect(new Set(result.runTrace.map(row => row.sessionId)).size).toBe(1);
    expect(result.runTrace.every(row => row.requestedDurationMs === 30_000)).toBe(true);
    expect(result.done.summary.execution!.requestedDurationMs).toBe(30_000);
    if (result.done.summary.execution!.targetKilled) {
      expect(result.done.summary.stopReason).toBe('target_dead');
      expect(result.done.summary.durationMs).toBeLessThan(30_000);
      expect(result.done.summary.execution!.targetKilledAtMs).toBe(result.done.summary.durationMs);
      expect(result.done.summary.targetFinalHp).toBe(0);
    } else {
      expect(result.done.summary.stopReason).toBe('duration_reached');
      expect(result.done.summary.durationMs).toBe(30_000);
    }
    expect(result.release.released).toBe(true);
    expect(control.release.released).toBe(true);
    saveProof(`真实蔚${name}`, snapshot, result);
    saveProof(`真实蔚${name}无鬼索对照`, controlSnapshot, control);
    await testInfo.attach('真实蔚组合与无鬼索对照，保留请求30秒与实际停止', { body: JSON.stringify({ result, control }), contentType: 'application/json' });
  });
}

test('5B真实蔚与墨菲特两侧共享普攻，B自然来源不自主驱动', async ({ page, request }, testInfo) => {
  const candidate = await triggeredSnapshot(request, { sourceCharacterKey: 'champion_vi' });
  const selection = { ...candidate.selection, targetSkillSettings: candidate.selection.targetSkillSettings.map(row =>
    row.skillKey === 'shared_basic_attack' ? { ...row, enabled: true, skillLevel: 1 } : row) };
  const response = await request.post(path, { data: selection });
  expect(response.status()).toBe(200);
  const snapshot = await response.json() as SimulationSnapshot;
  expect(snapshot.selection.targetCharacterKey).toBe('champion_malphite');
  expect(snapshot.selection.targetLevel).toBe(18);
  expect(snapshot.target.skillSources.find(row => row.skillKey === 'shared_basic_attack')).toMatchObject({ enabled: true, inactiveReason: 'NO_AUTONOMOUS_ATTACK' });
  const result = await runTriggered(page, snapshot, 1, 6000, { initialHealth: { source: 500 } });
  const origins = result.prepared.skillOrigins.filter(row => row.skillKey === 'shared_basic_attack');
  expect(origins).toHaveLength(2);
  expect(origins.find(row => row.side === 'source')).toMatchObject({ enabled: true, skillLevel: 1 });
  expect(origins.find(row => row.side === 'target')).toMatchObject({ enabled: true, skillLevel: 1, inactiveReason: 'NO_AUTONOMOUS_ATTACK' });
  expect(origins.find(row => row.side === 'target')!.providerRef).toBeUndefined();
  expect(result.done.attackRecords!.every(row => row.source === 'source' && row.target === 'target')).toBe(true);
  expect(viDamage(result).length).toBeGreaterThan(0);
  expect(result.done.damageRecords!.every(row => row.source === 'source' && row.target === 'target')).toBe(true);
  expect(result.done.summary.targetDamageDealt).toBe(0);
  expect(result.done.summary.abilityStats.filter(row => row.abilityRef.startsWith('target.provider[') && row.castCount > 0)).toHaveLength(0);
  expect(result.release.released).toBe(true);
  saveProof('真实蔚两侧共享普攻无B自主驱动', snapshot, result);
  await testInfo.attach('真实双方共享普攻最终Worker', { body: JSON.stringify(result), contentType: 'application/json' });
});
