import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { BuildConfiguration, BuildDefinition } from '../../src/types/build';
import type { SimulationSelection, SimulationSnapshot } from '../../src/types/simulationSnapshot';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';
import { simulationComparisonSelection } from '../fixtures/simulationSnapshotRequests';
import { isolatedSimulationSelection } from '../fixtures/simulationSkillSources';

const api = process.env.SIMULATION_API_BASE || 'http://127.0.0.1:8080';
const path = `${api}/api/admin/games/lol/simulation-snapshot`;

test.beforeEach(async ({ page }) => {
  test.skip(process.env.SIMULATION_LIVE_API !== '1', '需真实配置和最终Wasm');
  const bytes = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  expect(bytes.length).toBe(WASM_IDENTITY.bytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(WASM_IDENTITY.sha256);
  await page.goto('/');
});

async function snapshotFor(request: APIRequestContext, patch: Partial<SimulationSelection> = {}) {
  const response = await request.post(path, { data: simulationComparisonSelection({
    sourceCharacterKey: 'champion_kogmaw', sourceLevel: 3, targetLevel: 3, ...patch
  }) });
  expect(response.status()).toBe(200);
  return await response.json() as SimulationSnapshot;
}

async function isolatedKog(request: APIRequestContext, grade: number, build?: BuildConfiguration, enabled = true) {
  const candidate = await snapshotFor(request, { sourceBuildConfigurations: build ? [build] : [] });
  const selection = isolatedSimulationSelection(candidate);
  for (const side of ['source', 'target'] as const) {
    selection[`${side}SkillSettings`] = candidate[side].skillSources.filter(source => !(side === 'source'
      && source.origin.kind === 'CHARACTER' && source.skillKey === candidate.selection.basicAttackSkillKey))
      .map(source => ({ origin: source.origin, skillKey: source.skillKey,
        enabled: side === 'source' && (source.skillKey === 'kogmaw_q' && enabled || source.skillKey === 'rune_5005_passive'),
        ...(source.skillKey === 'kogmaw_q' ? { skillLevel: grade } : {}) }));
  }
  const response = await request.post(path, { data: selection });
  expect(response.status()).toBe(200);
  return await response.json() as SimulationSnapshot;
}

async function runeBuild(request: APIRequestContext) {
  const response = await request.get(`${api}/api/admin/games/lol/build-systems/runes/definition`);
  expect(response.status()).toBe(200);
  const definition = await response.json() as BuildDefinition;
  expect(definition.system.selectionRules.groupRoles.map(row => row.roleKey)).toEqual(['primary', 'secondary', 'shards']);
  const choices = (roleKey: string, groupKey: string, slots: string[]) => slots.map(slotKey => ({
    roleKey, groupKey, slotKey,
    optionKey: definition.groups.find(group => group.groupKey === groupKey)!.slots.find(slot => slot.slotKey === slotKey)!.optionKeys[0]!, rank: 1
  }));
  const configuration: BuildConfiguration = { systemKey: 'runes',
    groupAssignments: [{ roleKey: 'primary', groupKey: 'rune_path_8000' }, { roleKey: 'secondary', groupKey: 'rune_path_8400' },
      { roleKey: 'shards', groupKey: 'rune_shards' }], budgets: {},
    selections: [...choices('primary', 'rune_path_8000', ['keystone', 'minor_1', 'minor_2', 'minor_3']),
      ...choices('secondary', 'rune_path_8400', ['minor_1', 'minor_2']), ...choices('shards', 'rune_shards', ['offense', 'flex', 'defense'])] };
  configuration.selections.find(row => row.slotKey === 'offense')!.optionKey = 'rune_5005';
  return configuration;
}

async function runNatural(page: Page, snapshot: SimulationSnapshot, iterations = 3) {
  return page.evaluate(async ({ snapshot, iterations }) => {
    const adapterPath = '/src/engine/simulationAdapter.ts';
    const clientPath = '/src/engine/genericEngineClient.ts';
    const continuousPath = '/src/engine/continuousAttackRequest.ts';
    const equipmentPath = '/src/engine/simulationEquipment.ts';
    const { prepareSimulation, inspectSimulationSnapshot } = await import(adapterPath) as typeof import('../../src/engine/simulationAdapter');
    const { GenericEngineClient } = await import(clientPath) as typeof import('../../src/engine/genericEngineClient');
    const { continuousAttackRequest } = await import(continuousPath) as typeof import('../../src/engine/continuousAttackRequest');
    const { simulationHealthLimit } = await import(equipmentPath) as typeof import('../../src/engine/simulationEquipment');
    const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) {
      inputs[row.side][row.attribute.attributeKey] = row.attribute.attributeKey === 'attack_speed_ratio'
        ? row.side === 'source' ? .665 : .668 : 0;
    }
    const prepared = await prepareSimulation(snapshot, inputs, { source: simulationHealthLimit(snapshot, 'source')!, target: simulationHealthLimit(snapshot, 'target')! });
    const client = new GenericEngineClient();
    let compiled;
    try {
      compiled = await client.compile(prepared.compileRequest);
      if (!compiled.ok || !compiled.sessionId) throw new Error(JSON.stringify(compiled.errors));
      const continuous = await continuousAttackRequest(prepared, snapshot, { durationMs: 2000, attackSpeedInputMax: 10 }, compiled.sessionId);
      const first = await client.run(continuous.runRequest);
      if (!first.ok) throw new Error(JSON.stringify(first));
      const expected = JSON.stringify(first);
      for (let index = 1; index < iterations; index++) {
        const repeated = await client.run(continuous.runRequest);
        if (JSON.stringify(repeated) !== expected) throw new Error('同编译会话重复运行不一致');
      }
      const release = await client.release(compiled.sessionId, prepared.compileRequest.rulesHash);
      return { prepared, compile: compiled, runRequest: continuous.runRequest, done: first, release, iterations };
    } finally { client.terminate(); }
  }, { snapshot, iterations });
}

test('5A真实HTTP保留默认完整绑定和缺等级提示，旧GET及非法来源/构筑拒绝', async ({ page, request }) => {
  const snapshot = await snapshotFor(request);
  expect(snapshot.source.skillSources).toHaveLength(snapshot.source.attachedSkills.length);
  expect(snapshot.source.skillSources.every(source => source.enabled)).toBe(true);
  expect(snapshot.source.skillSources.find(source => source.skillKey === 'kogmaw_q')!.inactiveReason).toBe('LEVEL_REQUIRED');
  expect(snapshot.target.skillSources.find(source => source.skillKey === 'shared_basic_attack')!.inactiveReason).toBe('NO_AUTONOMOUS_ATTACK');
  const inspection = await page.evaluate(async snapshot => {
    const adapterPath = '/src/engine/simulationAdapter.ts';
    const { inspectSimulationSnapshot } = await import(adapterPath);
    try { inspectSimulationSnapshot(snapshot); return null; } catch (error) { return String(error); }
  }, snapshot);
  expect(inspection).toMatch(/默认自然技能|等级/);
  expect((await request.get(path)).status()).toBe(405);
  const selection = isolatedSimulationSelection(snapshot);
  expect((await request.post(path, { data: { ...selection, sourceSkillSettings: [{ origin: { kind: 'CHARACTER', characterKey: 'champion_ahri' },
    skillKey: 'kogmaw_q', enabled: false }] } })).status()).toBe(409);
  const build = await runeBuild(request);
  build.groupAssignments[1]!.groupKey = build.groupAssignments[0]!.groupKey;
  expect((await request.post(path, { data: { ...selection, sourceBuildConfigurations: [build] } })).status()).toBe(409);
});

test('5A真实克格莫Q等级1/3/5、未学及禁用，常驻首刀生效且不执行主动兄弟', async ({ page, request }, testInfo) => {
  const results = [];
  for (const grade of [1, 3, 5, 0]) {
    const snapshot = await isolatedKog(request, grade);
    const result = await runNatural(page, snapshot);
    const bonus = grade === 0 ? 0 : .05 * grade;
    expect(result.done.attackRecords![0]!.attackSpeed).toBeCloseTo(snapshot.source.selectedLevelValues.attack_speed! + .665 * bonus, 8);
    expect(result.done.attackRecords![0]!.startAtMs).toBe(0);
    expect(result.done.damageRecords).toHaveLength(result.done.attackRecords!.length);
    expect(result.prepared.compileRequest.sharedProviders!.filter(provider => provider.providerKey.includes('natural_skill'))
      .flatMap(provider => provider.listeners ?? []).every(listener => listener.eventMatcher.all!.includes('event/source_initialized'))).toBe(true);
    expect(result.release).toMatchObject({ ok: true, released: true });
    results.push({ grade, attackSpeed: result.done.attackRecords![0]!.attackSpeed, rulesHash: result.prepared.compileRequest.rulesHash,
      snapshotDigest: snapshot.snapshotDigest, origins: result.prepared.skillOrigins });
  }
  const disabled = await runNatural(page, await isolatedKog(request, 3, undefined, false));
  expect(disabled.done.attackRecords![0]!.attackSpeed).toBeCloseTo(.690993, 8);
  await testInfo.attach('真实Q等级及独立来源', { body: JSON.stringify(results), contentType: 'application/json' });
});

test('5A真实完整符文授予与Q叠加，逐来源禁用不改变构筑选择及另一来源', async ({ page, request }, testInfo) => {
  const build = await runeBuild(request);
  const snapshot = await isolatedKog(request, 3, build);
  const expectedGrants = snapshot.source.selectedBuilds[0]!.configuration.selections.flatMap(choice =>
    snapshot.source.selectedBuilds[0]!.definition.skillRelations.filter(grant => grant.optionKey === choice.optionKey && grant.activationRank <= choice.rank));
  expect(snapshot.source.skillSources.filter(source => source.origin.kind === 'BUILD_OPTION')).toHaveLength(expectedGrants.length);
  expect(snapshot.source.selectedBuilds[0]!.configuration.selections).toHaveLength(9);
  const combined = await runNatural(page, snapshot, 200);
  expect(combined.done.attackRecords![0]!.attackSpeed).toBeCloseTo(.690993 + .665 * .25, 8);
  const setting = snapshot.selection.sourceSkillSettings.find(source => source.skillKey === 'rune_5005_passive')!;
  setting.enabled = false;
  const response = await request.post(path, { data: snapshot.selection });
  expect(response.status()).toBe(200);
  const disabled = await response.json() as SimulationSnapshot;
  expect(disabled.source.selectedBuilds[0]!.configuration).toEqual(snapshot.source.selectedBuilds[0]!.configuration);
  const withoutRune = await runNatural(page, disabled);
  expect(withoutRune.done.attackRecords![0]!.attackSpeed).toBeCloseTo(.690993 + .665 * .15, 8);
  expect(withoutRune.prepared.skillOrigins.find(source => source.skillKey === 'kogmaw_q')!.enabled).toBe(true);
  expect(withoutRune.prepared.compileRequest.rulesHash).not.toBe(combined.prepared.compileRequest.rulesHash);
  const directory = resolve('output/phase5a');
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'real-natural-compile-run.json'), JSON.stringify({ wasm: WASM_IDENTITY, snapshot,
    compileRequest: combined.prepared.compileRequest, runRequest: combined.runRequest, runVariants: [
      { ...combined.runRequest, sampling: { ...combined.runRequest.sampling, disabled: true } },
      { ...combined.runRequest, recordBudget: { maxAttackRecords: 0, maxDamageRecords: 0 } }
    ] }, null, 2));
  writeFileSync(resolve(directory, 'real-natural-proof.json'), JSON.stringify({ wasm: WASM_IDENTITY, combined, withoutRune }, null, 2));
  await testInfo.attach('真实符文最终Worker及200次同会话', { body: JSON.stringify({ wasm: WASM_IDENTITY, combined, withoutRune }), contentType: 'application/json' });
});
