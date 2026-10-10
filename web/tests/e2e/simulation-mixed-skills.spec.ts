import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { readMixedLiveSnapshot } from '../fixtures/simulationMixedLive';
import type { SimulationSnapshot } from '../../src/types/simulationSnapshot';
import { chooseSimulationEntity, chooseSimulationLevel } from '../fixtures/simulationSelection';
import { simulationMixedSample } from '../fixtures/simulationMixedSkills';
import { syncSimulationSkillSources } from '../fixtures/simulationSkillSources';
import { confirmSimulationConfiguration } from '../fixtures/simulationSnapshotRequests';
import { simulationSkillSourceIdentity } from '../../src/services/simulationSkillSourceIdentity';

const output = resolve('output/phase6b');
function wasmIdentity() {
  const bytes = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  const identity = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    status: process.env.SIMULATION_EXPECTED_WASM_SHA256 ? 'final' : 'candidate' };
  if (process.env.SIMULATION_EXPECTED_WASM_SHA256) expect(identity.sha256).toBe(process.env.SIMULATION_EXPECTED_WASM_SHA256.toLowerCase());
  return identity;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  const observed = await page.evaluate(async () => {
    const response = await fetch('/src/engine/wasm/tinygo_engine_v2.wasm');
    const bytes = await response.arrayBuffer();
    return { bytes: bytes.byteLength, sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('') };
  });
  const identity = wasmIdentity();
  expect(observed).toEqual({ bytes: identity.bytes, sha256: identity.sha256 });
});

async function runConstruct(page: Page, backgroundAttack = true, occupiesAction = true) {
  const result = await page.evaluate(async ({ backgroundAttack, occupiesAction }) => {
    const fixturePath = '/tests/fixtures/simulationMixedSkills.ts';
    const workerPath = '/tests/fixtures/simulationMixedWorker.ts';
    const { simulationMixedSample, mixedInputs } = await import(fixturePath) as typeof import('../fixtures/simulationMixedSkills');
    const { runMixedWorkerCase } = await import(workerPath) as typeof import('../fixtures/simulationMixedWorker');
    const snapshot = simulationMixedSample(backgroundAttack, occupiesAction);
    return { snapshot, result: await runMixedWorkerCase(snapshot, mixedInputs(snapshot)) };
  }, { backgroundAttack, occupiesAction });
  mkdirSync(output, { recursive: true });
  const label = `construct-${backgroundAttack ? 'mixed' : 'pure'}-${occupiesAction ? 'occupied' : 'free'}`;
  writeFileSync(resolve(output, `${label}-compile-run.json`), JSON.stringify({ wasm: wasmIdentity(), snapshot: result.snapshot,
    compileRequest: result.result.prepared.compileRequest, runRequest: result.result.runRequest, runVariants: result.result.runVariants }, null, 2));
  writeFileSync(resolve(output, `${label}-worker-proof.json`), JSON.stringify(result, null, 2));
  return result.result;
}

test('独立构造：同A竞争、冷却前／边界／之后、行动释放与唯一下一刀，同Worker100次', async ({ page }) => {
  const result = await runConstruct(page);
  expect(result.baseline.summary.skillActions).toMatchObject({ plannedCount: 6, acceptedCount: 3, rejectedCount: 3 });
  expect(result.baseline.summary.basicAttack!.initialActionReadyAtMs).toBe(200);
  expect(result.baseline.attackRecords![0]!.startAtMs).toBe(200);
  for (const attack of result.baseline.attackRecords!) if (attack.nextStartAtMs !== null) {
    expect(attack.nextStartAtMs).toBe(Math.max(attack.finalReadyAtMs!, attack.mechanicReadyAtMs ?? 0, attack.actionReadyAtMs ?? 0));
  }
  expect(result.baseline.damageRecords!.filter(row => row.instructionKey).every(row => row.attackIndex === null && !!row.hitRef)).toBe(true);
  expect(result.release.released).toBe(true);
});

test('独立构造：不占用仍拒绝同技能在途重入，首刀0，无行动贡献必须null', async ({ page }) => {
  const result = await runConstruct(page, true, false);
  expect(result.baseline.summary.skillActions).toMatchObject({ plannedCount: 6, acceptedCount: 3, rejectedCount: 3 });
  expect(result.baseline.summary.basicAttack!.initialActionReadyAtMs).toBeNull();
  expect(result.baseline.attackRecords![0]!.startAtMs).toBe(0);
  expect(result.baseline.attackRecords!.every(row => row.actionReadyAtMs === null)).toBe(true);
});

test('独立构造：主动命中中途变速按实际重命名依赖核对，逐刀原生时钟与同Worker100次保持', async ({ page }, testInfo) => {
  const data = await page.evaluate(async () => {
    const fixturePath = '/tests/fixtures/simulationMixedSkills.ts';
    const workerPath = '/tests/fixtures/simulationMixedWorker.ts';
    const { simulationChangingSpeedSample, changingSpeedInputs } = await import(fixturePath) as typeof import('../fixtures/simulationMixedSkills');
    const { runMixedWorkerCase } = await import(workerPath) as typeof import('../fixtures/simulationMixedWorker');
    const snapshot = simulationChangingSpeedSample();
    const inputs = changingSpeedInputs(snapshot);
    return { snapshot, result: await runMixedWorkerCase(snapshot, inputs) };
  });
  const result = data.result;
  expect(result.baseline.summary.skillActions).toMatchObject({ plannedCount: 1, acceptedCount: 1, rejectedCount: 0 });
  expect(result.baseline.attackRecords!.map(row => row.startAtMs)).toEqual([0, 934, 1767, 2600]);
  expect(result.baseline.attackRecords![0]).toMatchObject({ readyAtMs: 1000, finalReadyAtMs: 934, nextStartAtMs: 934 });
  expect(result.baseline.attackRecords!.map(row => row.attackSpeed)).toEqual([1, 1.2, 1.2, 1.2]);
  expect(result.baseline.attackRecords!.every(row => row.actionReadyAtMs === null)).toBe(true);
  expect(result.baseline.finalSnapshot.combatants[0]!.attributes.saved_extra!.resolved).toBe(.2);
  expect(result.baseline.finalSnapshot.combatants[0]!.attributes.saved_tempo!.resolved).toBe(1.2);
  expect(result.release.released).toBe(true);
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, 'construct-changing-speed-compile-run.json'), JSON.stringify({ wasm: wasmIdentity(), ...data }, null, 2));
  await testInfo.attach('主动命中中途变速实际Worker档案', { body: JSON.stringify({ wasm: wasmIdentity(), ...data }), contentType: 'application/json' });
});

test('独立构造：纯主动多条累计、直接治疗与完整观察，不挂假普攻', async ({ page }) => {
  const result = await runConstruct(page, false);
  expect(result.baseline.summary.skillActions).toMatchObject({ plannedCount: 6, acceptedCount: 3, rejectedCount: 3 });
  expect(result.runRequest.driverPlan.basicAttack).toBeUndefined();
  expect(result.baseline.summary.sourceDirectHealing).toBeGreaterThan(0);
  expect(result.baseline.attackRecords).toEqual([]);
});

test('独立构造：64条明确首次累计，不隐式重复挂载或恢复截断记录', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const fixturePath = '/tests/fixtures/simulationActiveSkill.ts';
    const workerPath = '/tests/fixtures/simulationMixedWorker.ts';
    const { simulationActiveSample } = await import(fixturePath) as typeof import('../fixtures/simulationActiveSkill');
    const { runMixedWorkerCase } = await import(workerPath) as typeof import('../fixtures/simulationMixedWorker');
    const snapshot = simulationActiveSample();
    const plan = snapshot.selection.plannedSkills[0]!;
    const inputs = { actions: Array.from({ length: 64 }, (_, index) => ({ origin: plan.origin, skillKey: plan.skillKey, skillLevel: plan.skillLevel,
      instructionKey: `planned_${String(index).padStart(2, '0')}`, atMs: index, sortOrder: 0, phaseKind: 'INITIAL' as const,
      parentInstructionKey: null, targetSide: 'target' as const, hitPreset: 'TARGET_HIT' as const })),
      durationMs: 200, recordTimeSeries: false, maxSkillActionRecords: 64, maxSkillUseRecords: 256, maxHealingRecords: 256 };
    return { snapshot, result: await runMixedWorkerCase(snapshot, inputs) };
  });
  expect(result.result.baseline.summary.skillActions).toMatchObject({ plannedCount: 64, acceptedCount: 1, rejectedCount: 63 });
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, 'construct-64-actions-compile-run.json'), JSON.stringify({ wasm: wasmIdentity(), snapshot: result.snapshot,
    compileRequest: result.result.prepared.compileRequest, runRequest: result.result.runRequest, runVariants: result.result.runVariants }, null, 2));
});

test('独立构造：10急速作者公式的小数冷却原生舍入为3636／6364毫秒', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const fixturePath = '/tests/fixtures/simulationMixedSkills.ts';
    const workerPath = '/tests/fixtures/simulationMixedWorker.ts';
    const { simulationHasteSample, mixedAction, mixedInputs } = await import(fixturePath) as typeof import('../fixtures/simulationMixedSkills');
    const { runMixedWorkerCase } = await import(workerPath) as typeof import('../fixtures/simulationMixedWorker');
    const snapshot = simulationHasteSample();
    const inputs = { ...mixedInputs(snapshot), durationMs: 7000, actions: [
      mixedAction(snapshot, 'sample_active', 'q_first', 0), mixedAction(snapshot, 'sample_second', 'w_first', 100),
      mixedAction(snapshot, 'sample_active', 'q_before', 3635), mixedAction(snapshot, 'sample_active', 'q_at', 3636),
      mixedAction(snapshot, 'sample_second', 'w_before', 6463), mixedAction(snapshot, 'sample_second', 'w_at', 6464)
    ] };
    return { snapshot, result: await runMixedWorkerCase(snapshot, inputs) };
  });
  expect(result.result.baseline.summary.skillActions).toMatchObject({ plannedCount: 6, acceptedCount: 4, rejectedCount: 2 });
  expect(result.result.baseline.skillActionRecords!.filter(row => row.outcome === 'REJECTED').map(row => row.instructionKey)).toEqual(['q_before', 'w_before']);
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, 'construct-fractional-haste-compile-run.json'), JSON.stringify({ wasm: wasmIdentity(), snapshot: result.snapshot,
    compileRequest: result.result.prepared.compileRequest, runRequest: result.result.runRequest, runVariants: result.result.runVariants }, null, 2));
});

test('独立构造：完整强化待击只由实际首次激活，普攻不再次激活，超时和原生冷却保留', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const fixturePath = '/tests/fixtures/simulationMixedSkills.ts';
    const workerPath = '/tests/fixtures/simulationMixedWorker.ts';
    const { simulationEmpoweredSample, mixedInputs } = await import(fixturePath) as typeof import('../fixtures/simulationMixedSkills');
    const { runMixedWorkerCase } = await import(workerPath) as typeof import('../fixtures/simulationMixedWorker');
    const snapshot = simulationEmpoweredSample();
    return { snapshot, result: await runMixedWorkerCase(snapshot, mixedInputs(snapshot)) };
  });
  const bonus = result.result.baseline.damageRecords!.filter(row => row.operationRef.startsWith('skills.item_1043_passive.'));
  expect(bonus).toHaveLength(2);
  expect(bonus.map(row => row.attackIndex)).toEqual([1, 2]);
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, 'construct-empowered-compile-run.json'), JSON.stringify({ wasm: wasmIdentity(), snapshot: result.snapshot,
    compileRequest: result.result.prepared.compileRequest, runRequest: result.result.runRequest, runVariants: result.result.runVariants }, null, 2));
});

test('独立页面：稳定计划标识，编辑时刻不读快照且过期，执行前重读并防摘要漂移', async ({ page }) => {
  test.setTimeout(30000);
  const sample = simulationMixedSample();
  let snapshotReads = 0;
  let drift = false;
  const businessRequests: Array<{ method: string; path: string }> = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('damage-viewer.web.api-base-url', 'http://127.0.0.1:19606');
    localStorage.setItem('damage-viewer.web.admin-token', 'independent-readonly-fixture');
    const scope = window as typeof window & { simulationWorkerMessages: Array<{ type: string; rulesHash: string | null; instructionKeys: string[] }> };
    scope.simulationWorkerMessages = [];
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, ...options) {
      if (message && typeof message === 'object' && ['compile', 'run', 'release'].includes(message.type)) {
        scope.simulationWorkerMessages.push({ type: message.type,
          rulesHash: message.request?.rulesHash ?? message.expectedRulesHash ?? null,
          instructionKeys: message.request?.driverPlan?.skillActions?.map((action: { instructionKey: string }) => action.instructionKey) ?? [] });
      }
      return Reflect.apply(original, this, [message, ...options]);
    };
  });
  await page.route('**/api/**', async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
    const url = new URL(request.url());
    businessRequests.push({ method: request.method(), path: url.pathname });
    const reply = (data: unknown) => route.fulfill({ json: data });
    if (url.pathname === '/api/games') return reply([{ gameId: 'demo', gameName: '独立页面构造', representativeImageKey: null }]);
    const resource = url.pathname.replace(/^\/api\/admin\/games\/[^/]+\//, '');
    if (resource === 'simulation-snapshot') {
      expect(request.method()).toBe('POST'); snapshotReads++;
      const snapshot = structuredClone(sample); snapshot.selection = request.postDataJSON();
      snapshot.snapshotDigest = (drift ? '7' : '6').repeat(64);
      return reply(syncSimulationSkillSources(snapshot));
    }
    expect(request.method(), '构造页面不写任何业务数据').toBe('GET');
    if (resource === 'level-config') return reply(sample.catalogs.levelConfig);
    if (resource === 'characters') return reply({ items: [sample.source.character, sample.target.character], total: 2 });
    if (resource === 'equipment' || resource === 'build-systems') return reply({ items: [], total: 0 });
    if (resource === 'attributes') return reply({ items: sample.catalogs.attributes, total: sample.catalogs.attributes.length });
    if (resource === 'character-skill-relations') {
      const actor = url.searchParams.get('characterKey') === sample.source.character.characterKey ? sample.source : sample.target;
      return reply({ items: actor.attachedSkills, total: actor.attachedSkills.length });
    }
    if (/^skills\/[^/]+$/.test(resource)) return reply(sample.skillConfigurations.find(configuration => configuration.skill.skillKey === resource.split('/')[1])!.skill);
    if (resource.endsWith('/representative-image')) return reply({ image: null });
    throw new Error(`未预期目录请求${resource}`);
  });
  await page.goto('/?phase6b-ui=1#/simulation/basic-attack');
  await chooseSimulationEntity(page, '攻击方角色', 'actor_a');
  await chooseSimulationLevel(page, '攻击方等级', 1);
  await chooseSimulationEntity(page, '目标角色', 'actor_b');
  await chooseSimulationLevel(page, '目标等级', 1);
  await page.getByRole('checkbox', { name: '指定技能行动计划', exact: true }).locator('xpath=ancestor::label').click();
  await chooseSimulationEntity(page, '攻击方主动技能候选', 'sample_active');
  await page.getByRole('button', { name: '添加首次尝试', exact: true }).click();
  await page.getByRole('button', { name: '添加首次尝试', exact: true }).click();
  await expect(page.getByLabel('技能尝试时刻 skill_instruction_2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除指令 skill_instruction_1', exact: true }).click();
  await expect(page.getByLabel('技能尝试时刻 skill_instruction_2', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: '开启背景普攻', exact: true }).locator('xpath=ancestor::label').click();
  await chooseSimulationEntity(page, '普攻技能', 'sample_basic_attack');
  await chooseSimulationLevel(page, '普攻技能等级', 1);
  const preset = page.locator('.arco-select[aria-label="技能命中预设 skill_instruction_2"]');
  await preset.click();
  await page.getByRole('option', { name: '释放后对唯一目标尝试命中', exact: true }).click();
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  await confirmSimulationConfiguration(page);
  await page.getByRole('button', { name: '将缺失属性填写为0', exact: true }).click();
  await page.getByLabel('攻击方初始当前生命', { exact: true }).fill('300');
  await page.getByLabel('目标初始当前生命', { exact: true }).fill('5000');
  await page.getByLabel('观察时长（毫秒）', { exact: true }).fill('1500');
  await page.getByLabel('攻速输入上界', { exact: true }).fill('10');
  await page.getByRole('button', { name: '执行指定技能计划', exact: true }).click();
  await expect(page.getByRole('heading', { name: '技能与背景普攻混合观察结果', exact: true })).toBeVisible();
  await expect(page.getByText('指定技能计划观察完成，会话已释放', { exact: false })).toBeVisible();
  const before = snapshotReads;
  await page.getByLabel('技能尝试时刻 skill_instruction_2', { exact: true }).fill('50');
  await expect(page.getByText('上一份冻结结果已过期', { exact: false })).toBeVisible();
  expect(snapshotReads).toBe(before);
  await page.getByRole('button', { name: '执行指定技能计划', exact: true }).click();
  await expect(page.getByText('指定技能计划观察完成，会话已释放', { exact: false })).toBeVisible();
  expect(snapshotReads).toBe(before + 1);
  const workerCounts = () => page.evaluate(() => {
    const messages = (window as typeof window & { simulationWorkerMessages: Array<{ type: string; rulesHash: string | null; instructionKeys: string[] }> }).simulationWorkerMessages;
    return { preflightCompiles: messages.filter(message => message.type === 'compile' && message.rulesHash === 'skill-formula-preflight').length,
      formalCompiles: messages.filter(message => message.type === 'compile' && message.rulesHash !== 'skill-formula-preflight').length,
      runs: messages.filter(message => message.type === 'run').map(message => message.instructionKeys),
      releases: messages.filter(message => message.type === 'release').length };
  });
  const beforeDrift = await workerCounts();
  expect(beforeDrift.formalCompiles).toBe(2);
  expect(beforeDrift.runs).toEqual([['skill_instruction_2'], ['skill_instruction_2']]);
  drift = true;
  await page.getByRole('button', { name: '执行指定技能计划', exact: true }).click();
  await expect(page.getByText('技能作者配置、来源或构筑已变化，草稿已保留。最新配置已完成共同公式预检，请核对并明确确认后重新执行本次场景。', { exact: true })).toBeVisible();
  await expect(page.getByLabel('技能尝试时刻 skill_instruction_2', { exact: true })).toHaveValue('50');
  await expect(page.getByRole('button', { name: '确认最新技能配置', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '执行指定技能计划', exact: true })).toBeDisabled();
  const afterDrift = await workerCounts();
  expect(afterDrift).toEqual({ ...beforeDrift, preflightCompiles: beforeDrift.preflightCompiles + 1, releases: beforeDrift.releases + 1 });
  expect(businessRequests.every(request => request.method === 'GET' || request.method === 'POST' && request.path.endsWith('/simulation-snapshot'))).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: resolve(output, 'independent-plan-page.png'), fullPage: true });
});

async function runLive(page: Page, snapshot: SimulationSnapshot, label: string, hasteSupplement = 0,
  options: { vampRate?: number; sourceHealthRatio?: number; cooldownAttempt?: boolean; cooldownAtMs?: number } = {}) {
  const result = await page.evaluate(async ({ snapshot, hasteSupplement, options }) => {
    const workerPath = '/tests/fixtures/simulationMixedWorker.ts';
    const adapterPath = '/src/engine/simulationAdapter.ts';
    const numericPath = '/src/engine/numericAdapter.ts';
    const activePath = '/src/engine/simulationActiveSkills.ts';
    const { runMixedWorkerCase } = await import(workerPath) as typeof import('../fixtures/simulationMixedWorker');
    const { inspectSimulationSnapshot, prepareSimulation } = await import(adapterPath) as typeof import('../../src/engine/simulationAdapter');
    const { tryFoldConstant } = await import(numericPath) as typeof import('../../src/engine/numericAdapter');
    const { simulationCastCostCandidates } = await import(activePath) as typeof import('../../src/engine/simulationActiveSkills');
    const clientPath = '/src/engine/genericEngineClient.ts', preflightPath = '/src/engine/skillFormulaPreflight.ts';
    const { GenericEngineClient } = await import(clientPath) as typeof import('../../src/engine/genericEngineClient');
    const { preflightSkillFormulas } = await import(preflightPath) as typeof import('../../src/engine/skillFormulaPreflight');
    const inspectionPreflight = await preflightSkillFormulas(snapshot, new GenericEngineClient());
    const costs = simulationCastCostCandidates(snapshot);
    if (costs.some(cost => cost.effectKey !== 'mana_cost' || cost.resultKey !== 'consume_mana' || cost.bindingKey !== 'mana_cost')) {
      throw new Error('真实样本出现未核定成本，不能自动忽略必要消费');
    }
    const attributes = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    for (const row of inspectSimulationSnapshot(snapshot, costs).requirements) if (row.storedValue === undefined) {
      const key = row.attribute.attributeKey;
      if (key === 'ability_power') attributes[row.side][key] = row.side === 'source' ? 100 : 0;
      else if (key === 'bonus_attack_damage') attributes[row.side][key] = 0;
      else if (key === 'ability_haste') attributes[row.side][key] = row.side === 'source' ? hasteSupplement : 0;
      else if (key === 'life_steal_percent' || key === 'omnivamp_percent') attributes[row.side][key] = row.side === 'source' ? options.vampRate ?? .1 : 0;
      else if (key.endsWith('_percent') || ['critical_strike_chance', 'armor_pen_flat', 'magic_pen_flat'].includes(key)) attributes[row.side][key] = 0;
      else throw new Error(`实际组成缺少${row.side}.${key}，不猜固有属性`);
    }
    const prepared = await prepareSimulation(snapshot, attributes, { source: snapshot.source.selectedLevelValues.hp! * .3,
      target: snapshot.target.selectedLevelValues.hp! }, [], [], costs);
    const first = prepared.compileRequest.rules.skillActionBindings![0]!;
    const process = prepared.compileRequest.sharedProviders!.find(provider => provider.providerKey === first.providerDefinitionRef)!.processes![0]!;
    const delay = process.steps[0]!.delayMs ? tryFoldConstant(process.steps[0]!.delayMs!) : 0;
    if (delay === null) throw new Error('实际施法延时需要可核定有限作者时点');
    const actions = snapshot.selection.plannedSkills.map((plan, index) => {
      const binding = prepared.compileRequest.rules.skillActionBindings!.find(binding => binding.skillKey === plan.skillKey)!;
      return { origin: plan.origin, skillKey: plan.skillKey, skillLevel: plan.skillLevel,
        instructionKey: `real_first_${index}`, atMs: 0, sortOrder: index, phaseKind: 'INITIAL' as const, parentInstructionKey: null,
        targetSide: binding.hitBindings.length ? 'target' as const : 'source' as const,
        hitPreset: binding.hitBindings.length ? 'TARGET_HIT' as const : null };
    });
    if (actions.length > 1) actions.push({ ...actions[1]!, instructionKey: 'real_after_release', atMs: delay });
    if (options.cooldownAttempt) actions.push({ ...actions[0]!, instructionKey: 'real_cooldown_rejected', atMs: 1000 });
    const initialActions = [...actions];
    if (options.cooldownAtMs !== undefined) actions.push({ ...actions[0]!, instructionKey: 'real_cd_before', atMs: options.cooldownAtMs - 1 },
      { ...actions[0]!, instructionKey: 'real_cd_at', atMs: options.cooldownAtMs });
    const inputs = { actions, durationMs: Math.max(2000, delay + 1500, (options.cooldownAtMs ?? 0) + 2000), recordTimeSeries: false, attackSpeedInputMax: 10,
      maxSkillActionRecords: 64, maxSkillUseRecords: 256, maxHealingRecords: 256 };
    const inputVariants = options.cooldownAtMs === undefined ? [] : [{ ...inputs, actions: [...initialActions,
      { ...actions[0]!, instructionKey: 'real_cd_after', atMs: options.cooldownAtMs + 1 }] }];
    return { ...await runMixedWorkerCase(snapshot, inputs, 100, costs, attributes, {
      source: snapshot.source.selectedLevelValues.hp! * (options.sourceHealthRatio ?? .3), target: snapshot.target.selectedLevelValues.hp! }, inputVariants), inspectionPreflight };
  }, { snapshot, hasteSupplement, options });
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, `real-${label}-compile-run.json`), JSON.stringify({ wasm: wasmIdentity(), snapshot,
    compileRequest: result.prepared.compileRequest, runRequest: result.runRequest, runVariants: result.runVariants }, null, 2));
  writeFileSync(resolve(output, `real-${label}-worker-proof.json`), JSON.stringify({ wasm: wasmIdentity(), result }, null, 2));
  return result;
}

test('真实库奇Q加耀光：成功首次激活、下一次普攻完整一次消费，不裁状态或退款', async ({ request, page }) => {
  test.skip(process.env.SIMULATION_LIVE_API !== '1', '真实HTTP、明确作者占用和状态归属须由负责人保存');
  const snapshot = await readMixedLiveSnapshot(request, process.env.SIMULATION_API_BASE || 'http://127.0.0.1:8080', 'corki', ['corki_q'], ['item_3057']);
  const result = await runLive(page, snapshot, 'corki-q-spellblade');
  expect(result.baseline.summary.skillActions!.acceptedCount).toBe(1);
  const bonus = result.baseline.damageRecords!.filter(row => row.operationRef.startsWith('skills.item_3057_passive.'));
  expect(bonus).toHaveLength(1);
  expect(bonus[0]!.attackIndex).toBe(1);
  expect(bonus[0]!.owner).toBe('source');
  expect(bonus[0]!.useRef).toBe(result.baseline.attackRecords![0]!.useRef);
  expect(result.baseline.summary.sourceVampHealing).toBeGreaterThan(0);
});

test('真实安妮Q／W加耀光：同英雄真实来源、同刻忙拒绝、释放后另一技能完整命中', async ({ request, page }) => {
  test.skip(process.env.SIMULATION_LIVE_API !== '1', '真实HTTP、INITIAL和占用须由负责人保存');
  const snapshot = await readMixedLiveSnapshot(request, process.env.SIMULATION_API_BASE || 'http://127.0.0.1:8080', 'annie', ['annie_q', 'annie_w'], ['item_3057']);
  const result = await runLive(page, snapshot, 'annie-qw-spellblade');
  expect(result.baseline.summary.skillActions).toMatchObject({ plannedCount: 3, acceptedCount: 2, rejectedCount: 1 });
  expect(new Set(result.baseline.skillUseRecords!.filter(row => row.kind === 'HIT').map(row => row.skillKey))).toEqual(new Set(['annie_q', 'annie_w']));
  expect(result.prepared.coverage.some(row => row.authorPath === 'skills.annie_q.effects.kill_mana_refund' && !!row.note)).toBe(true);
  expect(snapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === 'annie_q')!.effects.some(effect => effect.effectKey === 'kill_mana_refund')).toBe(true);
});

test('真实安妮Q／W：先独立装配普通命中与混合生命账，再与装备联合', async ({ request, page }) => {
  test.skip(process.env.SIMULATION_LIVE_API !== '1', '真实HTTP及明确作者字段须由负责人保存');
  const snapshot = await readMixedLiveSnapshot(request, process.env.SIMULATION_API_BASE || 'http://127.0.0.1:8080', 'annie', ['annie_q', 'annie_w']);
  const result = await runLive(page, snapshot, 'annie-qw-independent');
  expect(result.baseline.summary.skillActions).toMatchObject({ plannedCount: 3, acceptedCount: 2, rejectedCount: 1 });
  expect(result.baseline.summary.sourceVampHealing).toBeGreaterThan(0);
  expect(result.baseline.summary.skillUses!.hitCount).toBe(2);
});

test('真实1级索拉卡R加背景普攻：一次直接治疗、非零双吸血、完整生命链与溢出', async ({ request, page }) => {
  test.skip(process.env.SIMULATION_LIVE_API !== '1', '真实HTTP和R占用须由负责人保存');
  const snapshot = await readMixedLiveSnapshot(request, process.env.SIMULATION_API_BASE || 'http://127.0.0.1:8080', 'soraka', ['soraka_r'], [],
    { sourceLevel: 1, targetLevel: 1 });
  const result = await runLive(page, snapshot, 'soraka-r-aa-vamp', 0, { vampRate: .2, cooldownAttempt: true });
  expect(result.baseline.summary.skillActions).toMatchObject({ plannedCount: 2, acceptedCount: 1, rejectedCount: 1 });
  expect(result.baseline.healingRecords).toHaveLength(1);
  expect(result.baseline.summary.sourceDirectHealing).toBeGreaterThan(0);
  expect(result.baseline.summary.sourceVampHealing).toBeGreaterThan(0);
  expect(result.prepared.compileRequest.combatants[0]!.attributes).toMatchObject({ life_steal_percent: { base: .2 }, omnivamp_percent: { base: .2 } });
  const overflow = await runLive(page, snapshot, 'soraka-r-aa-overflow', 0, { vampRate: .2, sourceHealthRatio: 1, cooldownAttempt: true });
  expect(overflow.baseline.summary.sourceDirectHealing).toBe(0);
  expect(overflow.baseline.healingRecords![0]!.overheal).toBeGreaterThan(0);
  expect(overflow.baseline.summary.sourceFinalHp).toBe(snapshot.source.selectedLevelValues.hp);
});

test('真实安妮Q／W＋耀光：实际10／110急速冷却边界，普通普攻冷却不折扣', async ({ request, page }) => {
  test.skip(process.env.SIMULATION_LIVE_API !== '1', '真实作者冷却公式与装备来源须由负责人保存');
  const snapshot = await readMixedLiveSnapshot(request, process.env.SIMULATION_API_BASE || 'http://127.0.0.1:8080', 'annie', ['annie_q', 'annie_w'], ['item_3057']);
  const ordinary = await runLive(page, snapshot, 'annie-qw-haste10-boundary', 0, { cooldownAtMs: 3636 });
  const hasted = await runLive(page, snapshot, 'annie-qw-haste110-boundary', 100, { cooldownAtMs: 1905 });
  for (const result of [ordinary, hasted]) {
    expect(result.baseline.skillActionRecords!.find(row => row.instructionKey === 'real_cd_before')!.outcome).toBe('REJECTED');
    expect(result.baseline.skillActionRecords!.find(row => row.instructionKey === 'real_cd_at')!.outcome).toBe('ACCEPTED');
    expect(result.inputVariantResults[0]!.skillActionRecords!.find(row => row.instructionKey === 'real_cd_after')!.outcome).toBe('ACCEPTED');
  }
  expect(ordinary.baseline.finalSnapshot.combatants[0]!.attributes.ability_haste).toMatchObject({ base: 0, resolved: 10 });
  expect(hasted.baseline.finalSnapshot.combatants[0]!.attributes.ability_haste).toMatchObject({ base: 100, resolved: 110 });
  const before = ordinary.baseline.attackRecords![0]!;
  const after = hasted.baseline.attackRecords![0]!;
  expect(after.attackSpeed).toBe(before.attackSpeed);
  expect(after.readyAtMs! - after.startAtMs).toBe(before.readyAtMs! - before.startAtMs);
});

test('真实页面：安妮Q／W＋耀光完整选择、普通拒绝、真实结果与冻结明细截图', async ({ request, page }) => {
  test.skip(process.env.SIMULATION_LIVE_API !== '1', '真实管理数据与最终Wasm须可读');
  const api = process.env.SIMULATION_API_BASE || 'http://127.0.0.1:8080';
  const selected = await readMixedLiveSnapshot(request, api, 'annie', ['annie_q', 'annie_w'], ['item_3057']);
  await page.addInitScript(api => {
    localStorage.setItem('damage-viewer.web.api-base-url', api);
    localStorage.setItem('damage-viewer.web.admin-token', 'local-readonly-check');
  }, api);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).origin !== api || request.method() === 'OPTIONS') return;
    expect(request.method() === 'GET' || request.method() === 'POST' && request.url().endsWith('/simulation-snapshot'), '真实页面不写管理数据').toBe(true);
  });
  await page.goto('/?phase6b-real=1#/simulation/basic-attack');
  await chooseSimulationEntity(page, '攻击方角色', 'champion_annie');
  await chooseSimulationLevel(page, '攻击方等级', 18);
  await chooseSimulationEntity(page, '目标角色', 'champion_malphite');
  await chooseSimulationLevel(page, '目标等级', 18);
  await page.getByRole('checkbox', { name: '指定技能行动计划', exact: true }).locator('xpath=ancestor::label').click();
  await page.getByRole('checkbox', { name: '开启背景普攻', exact: true }).locator('xpath=ancestor::label').click();
  for (const skillKey of ['annie_q', 'annie_w']) {
    await chooseSimulationEntity(page, '攻击方主动技能候选', skillKey);
    await page.getByRole('button', { name: '添加首次尝试', exact: true }).click();
  }
  await chooseSimulationEntity(page, '普攻技能', 'shared_basic_attack');
  await chooseSimulationLevel(page, '普攻技能等级', 1);
  const equipment = page.locator('.simulation-equipment-select[aria-label="攻击方装备"]');
  await equipment.click(); await equipment.locator('input').fill('item_3057');
  await page.getByRole('option').filter({ has: page.getByText('item_3057', { exact: true }) }).click();
  await page.getByRole('heading', { name: '攻击方配置', exact: true }).click();
  for (const key of ['skill_instruction_1', 'skill_instruction_2']) {
    await page.locator(`.arco-select[aria-label="技能命中预设 ${key}"]`).click();
    await page.getByRole('option', { name: '释放后对唯一目标尝试命中', exact: true }).click();
  }
  const read = page.getByRole('button', { name: '读取场景快照', exact: true });
  await read.click(); await expect(read).toBeEnabled();
  for (const side of ['source', 'target'] as const) for (const source of selected[side].skillSources.filter(source => source.origin.kind === 'CHARACTER'
    && !(side === 'source' && ['annie_q', 'annie_w', 'shared_basic_attack'].includes(source.skillKey)))) {
    const checkbox = page.getByRole('checkbox', { name: `${side === 'source' ? '攻击方' : '目标'}来源 ${simulationSkillSourceIdentity(source.origin, source.skillKey)} 开启`, exact: true });
    if (await checkbox.isChecked()) await checkbox.locator('xpath=ancestor::label').click();
  }
  for (const skillKey of ['annie_q', 'annie_w']) {
    const identity = simulationSkillSourceIdentity({ kind: 'CHARACTER', characterKey: 'champion_annie' }, skillKey);
    await page.locator(`.arco-select[aria-label='攻击方来源 ${identity} 等级']`).click();
    await page.getByRole('option', { name: '1', exact: true }).click();
  }
  await read.click(); await expect(read).toBeEnabled();
  await confirmSimulationConfiguration(page);
  for (const skillKey of ['annie_q', 'annie_w']) await page.getByRole('checkbox', {
    name: `声明施法成本 mana_cost.consume_mana`, exact: true
  }).nth(skillKey === 'annie_q' ? 0 : 1).locator('xpath=ancestor::label').click();
  await page.getByRole('button', { name: '将缺失属性填写为0', exact: true }).click();
  await page.getByLabel('攻击方初始当前生命', { exact: true }).fill(String(selected.source.selectedLevelValues.hp! * .3));
  await page.getByLabel('目标初始当前生命', { exact: true }).fill(String(selected.target.selectedLevelValues.hp!));
  await page.getByLabel('观察时长（毫秒）', { exact: true }).fill('2000');
  const speedLimit = page.getByLabel('攻速输入上界', { exact: true });
  if (await speedLimit.count()) await speedLimit.fill('10');
  await page.getByRole('button', { name: '执行指定技能计划', exact: true }).click();
  await expect(page.getByText('指定技能计划观察完成，会话已释放', { exact: false })).toBeVisible({ timeout: 30000 });
  const results = page.locator('section[aria-label="指定技能结果"]');
  await expect(results.getByText('拒绝1', { exact: false })).toBeVisible();
  mkdirSync(output, { recursive: true });
  await page.locator('section[aria-label="指定技能计划"]').screenshot({ path: resolve(output, 'real-plan-inputs.png') });
  await results.screenshot({ path: resolve(output, 'real-plan-results.png') });
  expect(errors).toEqual([]);
});
