import { fulfillAuthSession } from '../fixtures/authSession';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { simulationSample } from '../fixtures/simulationSnapshot';
import { attributeConversionSample } from '../fixtures/simulationAttributeConversion';

/** 明确注入最终产物，核对 Web 适配与真实 Worker；默认页面产物同步仍由主负责人验收。 */
test('最终原生共同公式经Web适配及真实Worker保持50伤害与590到540', async ({ page }, info) => {
  const path = process.env.PHASE3B_WASM_PATH;
  if (!path) throw new Error('必须明确提供已核定的第三B最终Wasm路径。');
  const bytes = readFileSync(path);
  const artifact = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  const snapshot = simulationSample();
  snapshot.source.selectedLevelValues.attack_damage = 100;
  snapshot.source.attributes.levelValues['1']!.attack_damage = 100;
  snapshot.target.selectedLevelValues.armor = 100;
  snapshot.target.attributes.levelValues['1']!.armor = 100;
  await page.route('**/api/auth/me', route => fulfillAuthSession(route, false).then(() => undefined));
  await page.route('**/api/games', route => route.fulfill({ json: [] }));
  await page.goto('/#/simulation/basic-attack');
  const result = await page.evaluate(async ({ snapshot, wasmUrl }) => {
    const adapterPath = '/src/engine/simulationAdapter.ts', clientPath = '/src/engine/genericEngineClient.ts';
    const preflightPath = '/src/engine/skillFormulaPreflight.ts', proofPath = '/src/engine/approvedFormulaValues.ts';
    const { GenericEngineClient } = await import(clientPath);
    const { preflightSkillFormulas } = await import(preflightPath);
    const { validateConsumedFormulaValues, validateApprovedFormulaValues } = await import(proofPath);
    const { inspectSimulationSnapshot, prepareSimulation, singleAttackRequest } = await import(adapterPath);
    const resultPath = '/src/engine/singleAttackResult.ts';
    const { assessSingleAttackResult } = await import(resultPath);
    const client = new GenericEngineClient({ wasmUrl });
    const preflight = await preflightSkillFormulas(snapshot, client);
    const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) inputs[row.side as 'source' | 'target'][row.attribute.attributeKey] = 0;
    const prepared = await prepareSimulation(snapshot, inputs, { source: 650, target: 590 });
    let compiled, released;
    try {
      compiled = await client.compile(prepared.compileRequest);
      if (!compiled.ok || !compiled.sessionId) throw new Error(JSON.stringify(compiled.errors));
      validateConsumedFormulaValues(prepared.approvedFormulaValues, prepared.compileRequest.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
      validateApprovedFormulaValues(prepared.compileRequest.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
      const request = singleAttackRequest(prepared.compileRequest, compiled.sessionId);
      const done = await client.run(request);
      const assessment = assessSingleAttackResult(prepared.compileRequest, request, done);
      released = await client.release(compiled.sessionId, prepared.compileRequest.rulesHash);
      return { preflight, metadata: compiled.metadata, assessment, released, formulas: prepared.compileRequest.formulas };
    } finally {
      if (compiled?.sessionId && !released && client.hasLiveWorker) await client.release(compiled.sessionId, prepared.compileRequest.rulesHash);
      client.terminate();
    }
  }, { snapshot, wasmUrl: 'data:application/wasm;base64,' + bytes.toString('base64') });
  expect(result.preflight).toMatchObject({ compileCount: 1, released: true });
  expect(result.assessment).toMatchObject({ complete: true, damageDealt: 50, hpLoss: 50, targetInitialHp: 590, targetFinalHp: 540 });
  expect(result.released.released).toBe(true);
  for (const formula of result.formulas ?? []) {
    const original = snapshot.skillConfigurations[0]!.formulas.find(row => formula.key.endsWith('/' + row.formulaKey));
    expect(formula.expression).toEqual(original!.expression);
    expect(formula.skillKey).toBe(snapshot.selection.basicAttackSkillKey);
  }
  await info.attach('最终产物注入的Web及Worker证据.json', { body: JSON.stringify({ artifact, result }, null, 2), contentType: 'application/json' });
});

test('共同派生保持真实技能归属，双方按各自拥有方读取且不重写作者绑定', async ({ page }, info) => {
  const path = process.env.PHASE3B_WASM_PATH;
  if (!path) throw new Error('必须明确提供已核定的第三B最终Wasm路径。');
  const bytes = readFileSync(path);
  const artifact = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  const { snapshot, configuration } = attributeConversionSample();
  configuration.formulas[0]!.expression = {
    inputs: [
      { key: 'owner_armor', binding: { kind: 'attribute', object: 'source', attributeKey: 'armor', valueKind: 'TOTAL', view: 'current_frame' } },
      { key: 'other_armor', binding: { kind: 'attribute', object: 'target', attributeKey: 'armor', valueKind: 'TOTAL', view: 'current_frame' } }
    ], stages: [{ key: 'ratio', name: '拥有方护甲与对方护甲的转换', expression: { op: 'add', args: [
      { op: 'div', args: [{ op: 'read', inputKey: 'owner_armor' }, { op: 'const', value: '100' }] },
      { op: 'div', args: [{ op: 'read', inputKey: 'other_armor' }, { op: 'const', value: '1000' }] }
    ] } }], outputStageKey: 'ratio'
  };
  for (const [side, values] of [['source', { attack_damage: 100, armor: 50 }], ['target', { attack_damage: 60, armor: 100 }]] as const) {
    Object.assign(snapshot[side].selectedLevelValues, values, { critical_strike_chance: 0 });
    Object.assign(snapshot[side].attributes.levelValues['1']!, values, { critical_strike_chance: 0 });
  }
  await page.route('**/api/games', route => route.fulfill({ json: [] }));
  await page.goto('/#/simulation/basic-attack');
  const result = await page.evaluate(async ({ snapshot, wasmUrl }) => {
    const adapterPath = '/src/engine/simulationAdapter.ts', clientPath = '/src/engine/genericEngineClient.ts';
    const preflightPath = '/src/engine/skillFormulaPreflight.ts', proofPath = '/src/engine/approvedFormulaValues.ts';
    const { GenericEngineClient } = await import(clientPath);
    const { preflightSkillFormulas } = await import(preflightPath);
    const { validateConsumedFormulaValues, validateApprovedFormulaValues } = await import(proofPath);
    const { inspectSimulationSnapshot, prepareSimulation, singleAttackRequest } = await import(adapterPath);
    const client = new GenericEngineClient({ wasmUrl });
    const formulaPreflight = await preflightSkillFormulas(snapshot, client);
    const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) inputs[row.side as 'source' | 'target'][row.attribute.attributeKey] = 0;
    const prepared = await prepareSimulation(snapshot, inputs, { source: 650, target: 590 });
    let compiled, released;
    try {
      compiled = await client.compile(prepared.compileRequest);
      if (!compiled.ok || !compiled.sessionId) throw new Error(JSON.stringify(compiled.errors));
      validateConsumedFormulaValues(prepared.approvedFormulaValues, prepared.compileRequest.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
      validateApprovedFormulaValues(prepared.compileRequest.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
      const done = await client.run(singleAttackRequest(prepared.compileRequest, compiled.sessionId));
      if (!done.ok) throw new Error(JSON.stringify(done));
      released = await client.release(compiled.sessionId, prepared.compileRequest.rulesHash);
      return { formulaPreflight, rules: prepared.compileRequest.rules, formulas: prepared.compileRequest.formulas, done, released };
    } finally {
      if (compiled?.sessionId && !released && client.hasLiveWorker) await client.release(compiled.sessionId, prepared.compileRequest.rulesHash);
      client.terminate();
    }
  }, { snapshot, wasmUrl: 'data:application/wasm;base64,' + bytes.toString('base64') });
  for (const side of ['source', 'target'] as const) {
    const actor = result.done.finalSnapshot.combatants.find((row: { key: string }) => row.key === side)!;
    expect(actor.attributes.attack_damage.resolved).toBeCloseTo(side === 'source' ? 171.2 : 137.35, 10);
    expect(result.rules.attributeDerivations.find((row: { combatantKey: string; attributeKey: string }) => row.combatantKey === side && row.attributeKey === 'attack_damage').skillKey).toBe(configuration.skill.skillKey);
  }
  expect(result.done.summary.sourceDamageDealt).toBeCloseTo(85.6, 10);
  expect(result.done.summary.targetFinalHp).toBeCloseTo(504.4, 10);
  const formulas = result.formulas.filter((row: { skillKey: string }) => row.skillKey === configuration.skill.skillKey);
  expect(formulas.length).toBeGreaterThanOrEqual(2);
  for (const formula of formulas) expect(formula.expression).toEqual(configuration.formulas[0]!.expression);
  expect(result.released.released).toBe(true);
  await info.attach('派生拥有方及原作者共同定义证据.json', { body: JSON.stringify({ artifact, result }, null, 2), contentType: 'application/json' });
});
