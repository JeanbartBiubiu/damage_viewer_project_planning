import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { CompileRequest, GenericFormulaExpr, ModifierDefinition, RunRequest } from '../../src/types/genericEngine';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';
import { createExplicitDamageInput } from '../fixtures/formulaPhase4AuthorInput';
import { authoredConstantDefense } from '../fixtures/authoredDamageFormula';
import { parseMechanismCase } from '../mechanisms/mechanismCase';
import { compareMechanismExpectation, projectMechanismResult } from '../mechanisms/mechanismRunner';

type Scenario = { compileRequest: CompileRequest; runRequest: RunRequest };

for (const caseKey of ['grouped_attribute_2145', 'grouped_timed_outgoing_expiry']) {
  test(`正式Worker生产适配：${caseKey}编译、运行、同会话重放与释放`, async ({ page }, info) => {
    const file = resolve(`tests/mechanisms/cases/${caseKey}.json`);
    const definition = parseMechanismCase(readFileSync(file), file);
    const workers: string[] = [];
    page.on('worker', worker => workers.push(worker.url()));
    await page.addInitScript(() => {
      const scope = window as typeof window & { groupedMessages: Array<{ type: string; id: string }> };
      scope.groupedMessages = [];
      const original = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function(message, ...options) {
        if (message && typeof message === 'object' && ['init', 'compile', 'run', 'release'].includes(message.type)) {
          scope.groupedMessages.push({ type: message.type, id: message.id });
        }
        return original.apply(this, [message, ...options] as Parameters<typeof original>);
      };
    });
    await page.route('**/grouped-amplification-harness', route => route.fulfill({ contentType: 'text/html',
      body: '<!doctype html><title>分组增幅正式工作线程冒烟</title>' }));
    await page.goto('/grouped-amplification-harness');
    const result = await page.evaluate(async ({ snapshot, scenario }) => {
      const { GenericEngineClient } = await import(/* @vite-ignore */ '/src/engine/genericEngineClient.ts');
      const { preflightSkillFormulas } = await import(/* @vite-ignore */ '/src/engine/skillFormulaPreflight.ts');
      const { prepareSimulation } = await import(/* @vite-ignore */ '/src/engine/simulationAdapter.ts');
      const { simulationAutomaticCastCosts } = await import(/* @vite-ignore */ '/src/engine/simulationActiveSkills.ts');
      const { validateSimulationSnapshot } = await import(/* @vite-ignore */ '/src/services/simulationSnapshotClient.ts');
      const { continuousAttackRequest } = await import(/* @vite-ignore */ '/src/engine/continuousAttackRequest.ts');
      const { skillActionRequest } = await import(/* @vite-ignore */ '/src/engine/skillActionRequest.ts');
      const { assessContinuousAttackResult } = await import(/* @vite-ignore */ '/src/engine/continuousAttackResult.ts');
      const { assessSkillActionResult } = await import(/* @vite-ignore */ '/src/engine/skillActionResult.ts');
      const { validateApprovedFormulaValues, validateConsumedFormulaValues } = await import(/* @vite-ignore */ '/src/engine/approvedFormulaValues.ts');
      const wasmPath = '/src/engine/wasm/tinygo_engine_v2.wasm';
      const wasmResponse = await fetch(wasmPath);
      if (!wasmResponse.ok) throw new Error(`正式Wasm HTTP ${wasmResponse.status}`);
      const wasm = await wasmResponse.arrayBuffer();
      const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', wasm))]
        .map(value => value.toString(16).padStart(2, '0')).join('');
      validateSimulationSnapshot(snapshot, snapshot.gameId, snapshot.selection);
      const client = new GenericEngineClient();
      let value;
      try {
        const ignoredCosts = simulationAutomaticCastCosts(snapshot);
        await preflightSkillFormulas(snapshot, client, () => true, scenario.sceneParameterInputs ?? []);
        const prepared = await prepareSimulation(snapshot, structuredClone(scenario.attributeInputs ?? { source: {}, target: {} }),
          scenario.initialHealth, scenario.equipmentAssumptions ?? [], scenario.mechanicStateInputs ?? [], ignoredCosts,
          scenario.sceneParameterInputs ?? [], scenario.initialResourceInputs ?? []);
        const compiled = await client.compile(prepared.compileRequest);
        if (!compiled.ok || !compiled.sessionId) throw new Error(JSON.stringify(compiled.errors));
        validateConsumedFormulaValues(prepared.approvedFormulaValues, prepared.compileRequest.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
        validateApprovedFormulaValues(prepared.compileRequest.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
        const common = { durationMs: scenario.durationMs, recordTimeSeries: false, attackSpeedInputMax: scenario.attackSpeedInputMax ?? 10 };
        const built = scenario.mode === 'skill_action'
          ? await skillActionRequest(prepared, snapshot, { ...common, actions: scenario.actions ?? [], maxSkillActionRecords: 1000,
            maxSkillUseRecords: 1000, maxHealingRecords: 1000, maxResourceChangeRecords: 1000 }, compiled.sessionId)
          : await continuousAttackRequest(prepared, snapshot, common, compiled.sessionId);
        const runRequest = { ...built.runRequest, runtimeOptions: { ...built.runRequest.runtimeOptions,
          equipmentAssumptions: prepared.equipmentAssumptions, skillOrigins: prepared.skillOrigins, mechanicStateInputs: prepared.mechanicStateInputs } };
        const done = await client.run(runRequest);
        const repeated = await client.run(runRequest);
        const assessment = scenario.mode === 'skill_action'
          ? assessSkillActionResult(prepared.compileRequest, runRequest, done, prepared.operationOrigins)
          : assessContinuousAttackResult(prepared.compileRequest, runRequest, done, prepared.operationOrigins);
        const released = await client.release(compiled.sessionId, prepared.compileRequest.rulesHash);
        value = { prepared, compiled, runRequest, done, repeated, assessment, released };
      } finally { client.terminate(); }
      return { ...value, wasm: { path: wasmPath, bytes: wasm.byteLength, sha256 }, workerAliveAfterTerminate: client.hasLiveWorker,
        messages: (window as typeof window & { groupedMessages: Array<{ type: string; id: string }> }).groupedMessages };
    }, { snapshot: definition.buildSnapshot(), scenario: definition.scenario });
    const evidence = info.outputPath(`${caseKey}-worker-evidence.json`);
    writeFileSync(evidence, JSON.stringify({ caseKey, fixtureSha256: definition.fileSha256,
      entry: '/grouped-amplification-harness', workers, result }, null, 2) + '\n');
    await info.attach(`${caseKey}-worker-evidence`, { contentType: 'application/json', path: evidence });
    expect(result.wasm).toMatchObject(WASM_IDENTITY);
    expect(workers.some(url => url.includes('genericEngineWorker'))).toBe(true);
    expect(result.messages.map(row => row.type)).toEqual(expect.arrayContaining(['compile', 'run', 'release']));
    expect(result.messages.filter(row => row.type === 'run')).toHaveLength(2);
    expect(result.repeated).toEqual(result.done);
    expect(result.released.released).toBe(true);
    expect(result.assessment.complete, JSON.stringify(result.assessment)).toBe(true);
    expect(result.assessment.issues).toEqual([]);
    expect(result.workerAliveAfterTerminate).toBe(false);
    const projection = projectMechanismResult(result.prepared.operationOrigins, result.prepared.compileRequest,
      result.runRequest, result.done, definition.expected);
    expect(compareMechanismExpectation(projection, definition.expected)).toEqual([]);
  });
}

const value = (value: number): GenericFormulaExpr => ({ op: 'const', value });
function healthCondition(comparator: 'lt' | 'gt', threshold: GenericFormulaExpr): GenericFormulaExpr {
  return { op: 'if', args: [
    { op: 'read', path: 'damage.type.physics' },
    { op: 'if', args: [
      { op: 'read', path: 'damage.trait.delivery_basic_attack' },
      { op: 'if', args: [
        { op: 'read', path: 'damage.trait.origin_direct' },
        { op: 'if', args: [
          { op: 'eq', args: [{ op: 'read', path: 'damage.self' }, value(0)] },
          { op: comparator, args: [
            { op: 'div', args: [{ op: 'read', path: 'target.attr.hp.current' }, { op: 'read', path: 'target.attr.hp.max' }] }, threshold
          ] }, value(0)
        ] }, value(0)
      ] }, value(0)
    ] }, value(0)
  ] };
}
function healthModifier(comparator: 'lt' | 'gt' = 'lt', threshold = value(comparator === 'lt' ? 0.4 : 0.6)): ModifierDefinition {
  return { modifierKey: 'health_bonus', kind: 'pipeline', command: 'damage', channel: 'all_damage',
    stage: 'outgoing_pre_mitigation', bucket: 'all_instances', priority: 10, valuePolicy: 'multiply',
    value: value(1.08), condition: healthCondition(comparator, threshold) };
}
// 作者明确提供本专项的通用修正公式与挂载；不转换管理端伤害修正或来源审核模型。
function scenario(hp: number, owner: 'source' | 'target' = 'source', options: {
  hits?: number; self?: boolean; type?: string; delivery?: string; origin?: string; modifiers?: ModifierDefinition[];
} = {}): Scenario {
  const { compileRequest: request, runRequest: run } = createExplicitDamageInput();
  run.schemaVersion = request.schemaVersion; run.schemaHash = request.schemaHash; run.rulesHash = request.rulesHash;
  request.typeCatalog.types.push({ key: 'physics', domain: 'damage' }, { key: 'hp', domain: 'attribute' },
    { key: 'damage/magic', domain: 'damage' }, { key: 'damage/true', domain: 'damage' },
    ...['delivery_basic_attack', 'delivery_skill', 'origin_direct', 'origin_reflected'].map(key => ({ key: `damage_trait/${key}`, domain: 'damage_trait' })));
  request.rules.damageTypeFormulas = [
    { damageType: 'damage/physical', formula: authoredConstantDefense('1') },
    { damageType: 'physics', formula: authoredConstantDefense('1') },
    { damageType: 'damage/magic', formula: authoredConstantDefense('1') },
    { damageType: 'damage/true', formula: authoredConstantDefense('1') }
  ];
  for (const actor of request.combatants) {
    actor.providers = [];
    actor.attributes.hp = { base: 1000, current: actor.key === owner && !options.self ? 900 : hp, max: 1000, resolved: 1000 };
  }
  for (const actor of run.initialSnapshot.combatants) {
    actor.providers = []; actor.attributes.hp = { base: 1000, current: actor.key === owner && !options.self ? 900 : hp, max: 1000, resolved: 1000 };
  }
  const body = request.sharedProviders![0]!;
  const operation = body.abilities![0]!.operations![0]!;
  operation.damageType = options.type ?? 'physics'; operation.target = options.self ? 'self' : 'target';
  operation.types = [`damage_trait/${options.delivery ?? 'delivery_basic_attack'}`, `damage_trait/${options.origin ?? 'origin_direct'}`];
  body.abilities![0]!.operations = Array.from({ length: options.hits ?? 1 }, () => structuredClone(operation));
  request.sharedProviders!.push({ providerKey: 'declared_bonus', stableId: 'declared_bonus', kind: 'passive', modifiers: options.modifiers ?? [healthModifier()] });
  for (const provider of request.sharedProviders!) {
    request.combatants.find(actor => actor.key === owner)!.providers.push({ providerRef: provider.providerKey, definitionRef: provider.providerKey });
    run.initialSnapshot.combatants.find(actor => actor.key === owner)!.providers.push({ providerRef: provider.providerKey,
      definitionRef: provider.providerKey, source: owner, owner, stacks: 1, expireAt: null, state: {} });
  }
  const entry = run.driverPlan.entries[0]!;
  entry.source = owner; entry.target = owner === 'source' ? 'target' : 'source';
  entry.abilityRef = `${owner}.provider[${body.providerKey}].ability[basic_attack]`;
  return { compileRequest: request, runRequest: run };
}
async function run(page: Page, input: Scenario, restore = false) {
  await page.route('**/damage-modifier-harness', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>通用逐笔门槛运行核验</title>' }));
  await page.goto('/damage-modifier-harness');
  return page.evaluate(async ({ input, restore }) => {
    const { GenericEngineClient } = await import(/* @vite-ignore */ '/src/engine/genericEngineClient.ts');
    const client = new GenericEngineClient();
    try {
      const compiled = await client.compile(input.compileRequest);
      if (!compiled.ok) return { compiled, scenario: input };
      input.runRequest.sessionId = compiled.sessionId;
      const done = await client.run(input.runRequest);
      let resumed;
      if (restore) {
        const next = structuredClone(input.runRequest);
        next.initialSnapshot = done.finalSnapshot;
        next.driverPlan.entries[0]!.firstAtMs = done.finalSnapshot.timeMs + 1;
        next.stopPolicy.durationMs = done.finalSnapshot.timeMs + 100;
        resumed = await client.run(next);
      }
      const released = await client.release(compiled.sessionId!, input.compileRequest.rulesHash);
      return { compiled, scenario: input, done, resumed, released };
    } finally { client.terminate(); }
  }, { input, restore });
}

test('最终产物摘要记录与实际Worker严格生命边界', async ({ page }, info) => {
  const wasm = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  expect(wasm.length).toBe(WASM_IDENTITY.bytes);
  expect(createHash('sha256').update(wasm).digest('hex')).toBe(WASM_IDENTITY.sha256);
  await info.attach('wasm-identity', { contentType: 'application/json', body: Buffer.from(JSON.stringify(WASM_IDENTITY)) });
  for (const [comparison, hp, damage] of [['lt', 399, 108], ['lt', 400, 100], ['lt', 401, 100], ['gt', 601, 108], ['gt', 600, 100], ['gt', 599, 100]] as const) {
    const result = await run(page, scenario(hp, 'source', { modifiers: [healthModifier(comparison)] }));
    await info.attach(`boundary-${comparison}-${hp}`, { contentType: 'application/json', body: Buffer.from(JSON.stringify(result)) });
    expect(result.compiled.ok, JSON.stringify(result.compiled)).toBe(true);
    expect(result.released?.released).toBe(true);
    expect(result.done!.summary.sourceDamageDealt).toBeCloseTo(damage, 8);
    expect(result.done!.summary.targetFinalHp).toBeCloseTo(hp - damage, 8);
    expect(result.done!.summary.sourceFinalHp).toBe(900);
  }
});
test('同一帧多笔与恢复后重新读取生命，反向拥有者与自伤资格正确', async ({ page }, info) => {
  const multiple = await run(page, scenario(450, 'source', { hits: 2 }));
  expect(multiple.compiled.ok, JSON.stringify(multiple.compiled)).toBe(true);
  expect(multiple.done!.summary.sourceDamageDealt).toBe(208);
  const restored = await run(page, scenario(450), true);
  expect(restored.done!.summary.sourceDamageDealt).toBe(100);
  expect(restored.resumed!.summary.sourceDamageDealt).toBe(108);
  expect(restored.resumed!.summary.targetFinalHp).toBe(242);
  const reversed = await run(page, scenario(399, 'target'));
  expect(reversed.done!.summary.targetDamageDealt).toBe(108);
  expect(reversed.done!.summary.sourceFinalHp).toBe(291);
  expect(reversed.done!.summary.targetFinalHp).toBe(900);
  const self = await run(page, scenario(399, 'source', { self: true }));
  expect(self.done!.summary.sourceFinalHp).toBe(299);
  for (const result of [multiple, restored, reversed, self]) expect(result.released?.released).toBe(true);
  await info.attach('multi-restore-reverse-self', { contentType: 'application/json', body: Buffer.from(JSON.stringify({ multiple, restored, reversed, self })) });
});
test('实际Worker保持类型、产生方式与来源过滤，不合资格不增伤', async ({ page }, info) => {
  const results = [];
  for (const variant of [{ type: 'damage/magic' }, { delivery: 'delivery_skill' }, { origin: 'origin_reflected' }]) {
    const result = await run(page, scenario(399, 'source', variant));
    expect(result.compiled.ok, JSON.stringify(result.compiled)).toBe(true);
    expect(result.done!.summary.sourceDamageDealt).toBe(100);
    expect(result.released?.released).toBe(true);
    results.push(result);
  }
  const unavailable = healthModifier(); unavailable.condition = value(0);
  const result = await run(page, scenario(399, 'source', { modifiers: [unavailable] }));
  expect(result.done!.summary.sourceDamageDealt).toBe(100);
  expect(result.released?.released).toBe(true);
  await info.attach('explicit-filter-inputs', { contentType: 'application/json', body: Buffer.from(JSON.stringify({ results, result })) });
});
test('同区未命中动态金额不求值，独立乘区仍相乘', async ({ page }, info) => {
  const low = healthCondition('lt', value(0.4)), high = healthCondition('gt', value(0.6));
  const sameZone = healthModifier();
  sameZone.condition = { op: 'max', args: [low, high] };
  sameZone.value = { op: 'add', args: [value(1), { op: 'add', args: [
    { op: 'if', args: [low, value(0.08), value(0)] },
    { op: 'if', args: [high, { op: 'div', args: [
      { op: 'read', path: 'target.attr.power.base' }, { op: 'read', path: 'target.attr.power.current' }
    ] }, value(0)] }
  ] }] };
  const input = scenario(399, 'source', { modifiers: [sameZone] });
  input.compileRequest.typeCatalog.types.push({ key: 'power', domain: 'attribute' });
  input.compileRequest.combatants[1]!.attributes.power = { base: 1, current: 0, max: 1, resolved: 1 };
  input.runRequest.initialSnapshot.combatants[1]!.attributes.power = { base: 1, current: 0, max: 1, resolved: 1 };
  const lazy = await run(page, input);
  expect(lazy.compiled.ok, JSON.stringify(lazy.compiled)).toBe(true);
  expect(lazy.done!.summary.sourceDamageDealt).toBe(108);
  const independent = { ...healthModifier(), modifierKey: 'separate', priority: 20, condition: value(1), value: value(1.1) };
  const multiplied = await run(page, scenario(399, 'source', { modifiers: [healthModifier(), independent] }));
  expect(multiplied.done!.summary.sourceDamageDealt).toBeCloseTo(118.8, 8);
  // 同一个明确公式中的两笔加算不应产生两个乘算修正。
  const added = healthModifier(); added.value = { op: 'add', args: [value(1), { op: 'add', args: [value(0.08), value(0.1)] }] };
  const additive = await run(page, scenario(399, 'source', { modifiers: [added] }));
  expect(additive.done!.summary.sourceDamageDealt).toBeCloseTo(118, 8);
  for (const result of [lazy, multiplied, additive]) expect(result.released?.released).toBe(true);
  await info.attach('short-circuit-and-declared-zones', { contentType: 'application/json', body: Buffer.from(JSON.stringify({ lazy, multiplied, additive })) });
});
test('共同十进制原和与作者显式取一位分别遵守真实浮点门槛', async ({ page }, info) => {
  const threshold = { op: 'ref', ref: 'declared_threshold' };
  const input = scenario(300, 'source', { modifiers: [healthModifier('lt', threshold)] });
  input.compileRequest.formulas = [{ key: 'declared_threshold', scope: 'game', parameters: [], expression: {
    inputs: [], stages: [{ key: 'sum', name: '明确十进制门槛', expression: { op: 'add', args: [{ op: 'const', value: '0.1' }, { op: 'const', value: '0.2' }] } }], outputStageKey: 'sum'
  } }];
  const unrounded = await run(page, input);
  expect(unrounded.compiled.ok, JSON.stringify(unrounded.compiled)).toBe(true);
  expect(unrounded.done!.summary.sourceDamageDealt).toBe(108);
  expect(unrounded.released?.released).toBe(true);
  await info.attach('decimal-original-float', { contentType: 'application/json', body: Buffer.from(JSON.stringify(unrounded)) });
  const rounded = structuredClone(input.compileRequest.formulas);
  rounded[0]!.expression.stages[0]!.expression = { op: 'round', args: [rounded[0]!.expression.stages[0]!.expression], decimals: 1 };
  for (const [hp, expected] of [[300, 100], [299, 108]]) {
    const scene = scenario(hp!, 'source', { modifiers: [healthModifier('lt', threshold)] });
    scene.compileRequest.formulas = rounded;
    const result = await run(page, scene);
    expect(result.compiled.ok, JSON.stringify(result.compiled)).toBe(true);
    expect(result.done!.summary.sourceDamageDealt).toBe(expected);
    expect(result.released?.released).toBe(true);
    await info.attach(`decimal-boundary-${hp}`, { contentType: 'application/json', body: Buffer.from(JSON.stringify(result)) });
  }
});
