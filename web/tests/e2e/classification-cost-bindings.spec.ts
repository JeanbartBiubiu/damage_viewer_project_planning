import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { GameCalculationConfiguration, GameCalculationRulesResponse } from '../../src/types/gameCalculationRules';
import type { SimulationSelection, SimulationSnapshot } from '../../src/types/simulationSnapshot';
import { authoredCostRef, authoredAuraPairSample, classificationCostBindingsSample } from '../fixtures/classificationCostBindings';
import { chooseSimulationEntity, chooseSimulationLevel } from '../fixtures/simulationSelection';
import { confirmSimulationConfiguration } from '../fixtures/simulationSnapshotRequests';
import { syncSimulationSkillSources } from '../fixtures/simulationSkillSources';

const API = 'http://127.0.0.1:19611';
const TOKEN = 'classification-bindings-fixture';
type ApiState = {
  sample: SimulationSnapshot;
  rules: GameCalculationRulesResponse;
  directoryRules: GameCalculationRulesResponse | null;
  earlierSkillCategory: string | null;
  snapshotRules: GameCalculationRulesResponse | null;
  otherRules: GameCalculationRulesResponse;
  rulesFailure: boolean;
  gate: { gameId: string; wait: Promise<void> } | null;
  snapshotGate: Promise<void> | null;
  writeOutcome: 'ok' | 'rejected' | 'uncertain';
  writes: Array<{ baseDigest: string; configuration: GameCalculationConfiguration }>;
  reads: string[];
  errors: string[];
};

function identity() {
  const bytes = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  const value = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  if (process.env.SIMULATION_EXPECTED_WASM_SHA256) expect(value.sha256).toBe(process.env.SIMULATION_EXPECTED_WASM_SHA256.toLowerCase());
  return value;
}
async function verifyWasm(page: Page) {
  const observed = await page.evaluate(async () => {
    const bytes = await (await fetch('/src/engine/wasm/tinygo_engine_v2.wasm')).arrayBuffer();
    return { bytes: bytes.byteLength, sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map(value => value.toString(16).padStart(2, '0')).join('') };
  });
  expect(observed).toEqual(identity());
}
async function archive(info: TestInfo, data: unknown) {
  const output = resolve('output/category-cost-bindings');
  mkdirSync(output, { recursive: true });
  const path = resolve(output, `browser-proof-${createHash('sha256').update(info.title).digest('hex').slice(0, 16)}.json`);
  writeFileSync(path, JSON.stringify({ test: info.title, wasm: identity(), data }, null, 2));
  await info.attach('本批最终产物与完整请求结果', { path, contentType: 'application/json' });
}

/** 真实组件及Worker，只替换明确作者数据的HTTP，不作为正式实库写入证据。 */
async function installApi(page: Page): Promise<ApiState> {
  const sample = classificationCostBindingsSample();
  const otherRules = structuredClone(sample.catalogs.calculationRules);
  otherRules.gameId = 'other';
  otherRules.configuration!.basicAttackCategoryKey = null;
  otherRules.configuration!.equipmentPassiveCategoryKey = null;
  otherRules.configuration!.ignorableCastCostAttributeKeys = [];
  const state: ApiState = { sample, rules: structuredClone(sample.catalogs.calculationRules), directoryRules: null,
    earlierSkillCategory: null, snapshotRules: null, otherRules, rulesFailure: false, gate: null, snapshotGate: null,
    writeOutcome: 'ok', writes: [], reads: [], errors: [] };
  page.on('pageerror', error => state.errors.push(error.message));
  await page.addInitScript(({ api, token }) => {
    localStorage.setItem('damage-viewer.web.api-base-url', api);
    localStorage.setItem('damage-viewer.web.admin-token', token);
    const scope = window as typeof window & { bindingWorkerMessages: Array<{ type: string; rulesHash: string | null }> };
    scope.bindingWorkerMessages = [];
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, ...options) {
      if (message && typeof message === 'object' && ['compile', 'run', 'release'].includes(message.type)) {
        scope.bindingWorkerMessages.push({ type: message.type, rulesHash: message.request?.rulesHash ?? message.expectedRulesHash ?? null });
      }
      return Reflect.apply(original, this, [message, ...options]);
    };
  }, { api: API, token: TOKEN });
  await page.route(`${API}/api/**`, async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
    const url = new URL(request.url());
    const reply = (data: unknown) => route.fulfill({ json: data });
    if (url.pathname === '/api/games') return reply([{ gameId: 'demo', gameName: '作者绑定游戏', representativeImageKey: null },
      { gameId: 'other', gameName: '其他绑定游戏', representativeImageKey: null }]);
    expect(request.headers().authorization).toBe(`Bearer ${TOKEN}`);
    const gameId = url.pathname.split('/')[4]!;
    const resource = url.pathname.replace(/^\/api\/admin\/games\/[^/]+\//, '');
    const sample = gameId === 'demo' ? state.sample : JSON.parse(JSON.stringify(state.sample).replaceAll('"demo"', '"other"')) as SimulationSnapshot;
    if (resource === 'calculation-rules' && request.method() === 'PUT') {
      const body = request.postDataJSON() as ApiState['writes'][number];
      expect(Object.keys(body).sort()).toEqual(['baseDigest', 'configuration']);
      expect(Object.keys(body.configuration).sort()).toEqual(['criticalChanceAttributeKey', 'criticalMultiplierMin', 'attackSpeedAttributeKey',
        'basicAttackCategoryKey', 'equipmentPassiveCategoryKey', 'ignorableCastCostAttributeKeys', 'attributeDerivations'].sort());
      expect(body.baseDigest).toBe(state.rules.baseDigest);
      state.writes.push(structuredClone(body));
      if (state.writeOutcome === 'rejected') return route.fulfill({ status: 400, json: { error: { code: '400.INVALID_REQUEST', message: '保存候选被拒绝' } } });
      state.rules = { gameId, baseDigest: createHash('sha256').update(JSON.stringify(body.configuration)).digest('hex'), configuration: structuredClone(body.configuration) };
      if (state.writeOutcome === 'uncertain') return route.fulfill({ status: 500, json: { error: { code: '500.INTERNAL_ERROR', message: '写入响应未确认' } } });
      return reply(state.rules);
    }
    if (resource === 'simulation-snapshot') {
      expect(request.method()).toBe('POST');
      state.reads.push(`${gameId}/${resource}`);
      const snapshot = structuredClone(sample);
      snapshot.selection = request.postDataJSON() as SimulationSelection;
      snapshot.catalogs.calculationRules = structuredClone(gameId === 'demo' ? state.snapshotRules ?? state.rules : state.otherRules);
      for (const side of ['source', 'target'] as const) snapshot[side].selectedEquipment = snapshot[side].selectedEquipment
        .filter(item => snapshot.selection[`${side}EquipmentKeys`].includes(item.equipment.equipmentKey));
      const skills = new Set(['source', 'target'].flatMap(side => {
        const actor = snapshot[side as 'source' | 'target'];
        return [...actor.attachedSkills, ...actor.selectedEquipment.flatMap(item => item.attachedSkills)].map(row => row.skillKey);
      }));
      snapshot.skillConfigurations = snapshot.skillConfigurations.filter(row => skills.has(row.skill.skillKey));
      syncSimulationSkillSources(snapshot);
      snapshot.snapshotDigest = createHash('sha256').update(JSON.stringify({ ...snapshot, snapshotDigest: undefined, readAt: undefined })).digest('hex');
      if (state.snapshotGate) await state.snapshotGate;
      return reply(snapshot);
    }
    expect(request.method(), '专项除保护保存和只读快照外不得写业务数据').toBe('GET');
    state.reads.push(`${gameId}/${resource}`);
    if (resource === 'calculation-rules') {
      const rules = structuredClone(gameId === 'demo' ? state.directoryRules ?? state.rules : state.otherRules);
      if (state.gate?.gameId === gameId) await state.gate.wait;
      if (state.rulesFailure) return route.fulfill({ status: 500, json: { error: { message: '计算规则读取失败' } } });
      return reply(rules).catch(() => undefined); // 已取消的旧上下文读取可能已被浏览器中止。
    }
    if (resource === 'level-config') return reply(sample.catalogs.levelConfig);
    if (resource === 'vamp-rules') return reply(sample.catalogs.vampRules);
    if (resource === 'attributes') return reply({ items: sample.catalogs.attributes, total: sample.catalogs.attributes.length });
    if (resource === 'skill-categories') {
      const items = [...sample.catalogs.skillCategories];
      if (state.earlierSkillCategory) items.push({ ...items[0]!, skillCategoryKey: state.earlierSkillCategory });
      return reply({ items, total: items.length });
    }
    if (resource === 'characters') return reply({ items: [sample.source.character, sample.target.character], total: 2 });
    if (resource === 'equipment') return reply({ items: [...sample.source.selectedEquipment, ...sample.target.selectedEquipment].map(row => row.equipment),
      total: sample.source.selectedEquipment.length + sample.target.selectedEquipment.length });
    if (resource === 'build-systems') return reply({ items: [], total: 0 });
    if (resource === 'character-skill-relations') {
      const actor = url.searchParams.get('characterKey') === sample.source.character.characterKey ? sample.source : sample.target;
      return reply({ items: actor.attachedSkills, total: actor.attachedSkills.length });
    }
    if (/^skills\/[^/]+$/.test(resource)) {
      const skill = structuredClone(sample.skillConfigurations.find(row => row.skill.skillKey === resource.split('/')[1])!.skill);
      if (skill.skillKey === 'sample_basic_attack' && state.earlierSkillCategory) skill.skillCategoryKeys = [state.earlierSkillCategory];
      return reply(skill);
    }
    if (resource.endsWith('representative-image')) return reply({ image: null });
    throw new Error(`未定义作者绑定专项接口：${request.method()} ${resource}`);
  });
  return state;
}

async function pick(page: Page, label: string, key: string) {
  const select = page.locator(`.arco-select[aria-label="${label}"]`);
  await select.click();
  await select.locator('input').fill(key);
  const popup = page.locator(`#${await select.getAttribute('aria-controls')}`);
  await popup.getByRole('option').filter({ hasText: key }).click();
  await page.getByRole('heading', { name: /游戏计算规则|攻击方配置/ }).first().click();
}
async function chooseOtherGame(page: Page) {
  await page.locator('.app-toolbar-field--game .arco-select').click();
  await page.getByRole('option', { name: /其他绑定游戏/ }).click();
}
async function setupPlan(page: Page) {
  await chooseSimulationEntity(page, '攻击方角色', 'actor_a');
  await chooseSimulationLevel(page, '攻击方等级', 1);
  await chooseSimulationEntity(page, '目标角色', 'actor_b');
  await chooseSimulationLevel(page, '目标等级', 1);
  await page.getByRole('checkbox', { name: '指定技能行动计划', exact: true }).locator('xpath=ancestor::label').click();
  await chooseSimulationEntity(page, '攻击方主动技能候选', 'sample_active');
  await page.getByRole('button', { name: '添加首次尝试', exact: true }).click();
  await page.getByRole('checkbox', { name: '开启背景普攻', exact: true }).locator('xpath=ancestor::label').click();
  await chooseSimulationEntity(page, '普攻技能', 'sample_basic_attack');
  await chooseSimulationLevel(page, '普攻技能等级', 1);
  await pick(page, '攻击方装备', 'item_1043');
  await page.locator('.arco-select[aria-label="技能命中预设 skill_instruction_1"]').click();
  await page.getByRole('option', { name: '释放后对唯一目标尝试命中', exact: true }).click();
  await page.getByLabel('技能尝试时刻 skill_instruction_1', { exact: true }).fill('50');
}

test('最终Worker：分类与费用全部改名，明确确认后的原完整计划同会话100次且未绑定消费者拒绝', async ({ page }, info) => {
  const state = await installApi(page);
  await page.goto('/?classification-worker=1');
  await verifyWasm(page);
  const result = await page.evaluate(async () => {
    const fixturePath = '/tests/fixtures/classificationCostBindings.ts', workerPath = '/tests/fixtures/simulationMixedWorker.ts';
    const adapterPath = '/src/engine/simulationAdapter.ts', costPath = '/src/engine/simulationActiveSkills.ts';
    const clientPath = '/src/engine/genericEngineClient.ts', preflightPath = '/src/engine/skillFormulaPreflight.ts';
    const { classificationCostBindingsSample, authoredCostRef } = await import(fixturePath) as typeof import('../fixtures/classificationCostBindings');
    const { runMixedWorkerCase } = await import(workerPath) as typeof import('../fixtures/simulationMixedWorker');
    const { inspectSimulationSnapshot } = await import(adapterPath) as typeof import('../../src/engine/simulationAdapter');
    const { simulationCastCostCandidates } = await import(costPath) as typeof import('../../src/engine/simulationActiveSkills');
    const { GenericEngineClient } = await import(clientPath) as typeof import('../../src/engine/genericEngineClient');
    const { preflightSkillFormulas } = await import(preflightPath) as typeof import('../../src/engine/skillFormulaPreflight');
    const snapshot = classificationCostBindingsSample();
    await preflightSkillFormulas(snapshot, new GenericEngineClient());
    const errors: Record<string, string> = {};
    try { inspectSimulationSnapshot(snapshot); } catch (error) { errors.unconfirmedCost = String(error); }
    for (const field of ['basicAttackCategoryKey', 'equipmentPassiveCategoryKey'] as const) {
      const broken = structuredClone(snapshot); broken.catalogs.calculationRules.configuration![field] = null;
      try { inspectSimulationSnapshot(broken, [authoredCostRef]); } catch (error) { errors[field] = String(error); }
    }
    const plan = snapshot.selection.plannedSkills[0]!;
    const inputs = { actions: [{ origin: plan.origin, skillKey: plan.skillKey, skillLevel: plan.skillLevel, instructionKey: 'author_first',
      atMs: 50, sortOrder: 0, phaseKind: 'INITIAL' as const, parentInstructionKey: null, targetSide: 'target' as const, hitPreset: 'TARGET_HIT' as const }],
      durationMs: 2000, attackSpeedInputMax: 10, recordTimeSeries: true, maxSkillActionRecords: 32, maxSkillUseRecords: 128, maxHealingRecords: 256 };
    const candidates = simulationCastCostCandidates(snapshot);
    return { snapshot, candidates, errors, result: await runMixedWorkerCase(snapshot, inputs, 100, [authoredCostRef]) };
  });
  expect(result.candidates).toEqual([authoredCostRef]);
  expect(result.errors.unconfirmedCost).toContain('资源改变');
  expect(result.errors.basicAttackCategoryKey).toContain('catalogs.calculationRules.configuration.basicAttackCategoryKey');
  expect(result.errors.equipmentPassiveCategoryKey).toContain('catalogs.calculationRules.configuration.equipmentPassiveCategoryKey');
  expect(result.result.iterations).toBe(100);
  expect(result.result.baseline.summary.skillActions!.acceptedCount).toBe(1);
  expect(result.result.baseline.damageRecords!.some(row => row.operationRef.startsWith('skills.item_1043_passive.'))).toBe(true);
  for (const actor of result.result.prepared.compileRequest.combatants) expect(actor.attributes).not.toHaveProperty('spell_fee');
  expect(result.result.release.released).toBe(true);
  expect(state.errors).toEqual([]);
  await archive(info, result);
});

test('最终Worker普通basic_attack作者分类不会变成普攻，真实SKILL命中和分类吸血匹配保持100次', async ({ page }, info) => {
  const state = await installApi(page);
  await page.goto('/?ordinary-category=1');
  await verifyWasm(page);
  const data = await page.evaluate(async () => {
    const fixturePath = '/tests/fixtures/classificationCostBindings.ts', workerPath = '/tests/fixtures/simulationMixedWorker.ts';
    const { classificationCostBindingsSample, authoredCostRef } = await import(fixturePath) as typeof import('../fixtures/classificationCostBindings');
    const { runMixedWorkerCase } = await import(workerPath) as typeof import('../fixtures/simulationMixedWorker');
    const snapshot = classificationCostBindingsSample();
    snapshot.skillConfigurations.find(row => row.skill.skillKey === authoredCostRef.skillKey)!.skill.skillCategoryKeys = ['basic_attack'];
    snapshot.catalogs.skillCategories.push({ ...snapshot.catalogs.skillCategories[0]!, skillCategoryKey: 'basic_attack', name: '普通作者分类' });
    snapshot.catalogs.attributes.push({ ...snapshot.catalogs.attributes[0]!, attributeKey: 'spell_vamp', name: '作者技能吸血比例' });
    for (const side of ['source', 'target'] as const) {
      snapshot[side].selectedLevelValues.spell_vamp = side === 'source' ? .1 : 0;
      snapshot[side].attributes.levelValues['1'] = { ...snapshot[side].selectedLevelValues };
    }
    snapshot.catalogs.vampRules.rules.push({ vampType: 'OMNIVAMP', sourceAttributeKey: 'spell_vamp', basisOutputKind: 'POST_DEFENSE_DAMAGE',
      defaultEfficiency: 1, deliveryKinds: ['SKILL'], originKinds: ['DIRECT'], skillCategoryKeys: ['basic_attack'] });
    const plan = snapshot.selection.plannedSkills[0]!;
    const inputs = { actions: [{ origin: plan.origin, skillKey: plan.skillKey, skillLevel: plan.skillLevel, instructionKey: 'ordinary_first',
      atMs: 50, sortOrder: 0, phaseKind: 'INITIAL' as const, parentInstructionKey: null, targetSide: 'target' as const, hitPreset: 'TARGET_HIT' as const }],
      durationMs: 2000, attackSpeedInputMax: 10, recordTimeSeries: true, maxSkillActionRecords: 32, maxSkillUseRecords: 128, maxHealingRecords: 256 };
    return { snapshot, result: await runMixedWorkerCase(snapshot, inputs, 100, [authoredCostRef]) };
  });
  const active = data.result.prepared.compileRequest.sharedProviders!.find(row => row.skillKey === authoredCostRef.skillKey)!;
  for (const ability of active.abilities!.filter(row => row.kind === 'active')) {
    expect(ability.types).toContain('ability/skill_category/basic_attack');
    expect(ability.types).not.toContain('ability/basic_attack');
  }
  expect(data.result.prepared.compileRequest.rules.vampRules!.find(row => row.vampType === 'OMNIVAMP')!.abilityMatcher)
    .toEqual({ any: ['ability/skill_category/basic_attack'] });
  const damage = data.result.baseline.damageRecords!.find(row => row.instructionKey === 'ordinary_first')!;
  expect(data.result.baseline.evidence.items.some(row => row.ref === 'event/skill_hit' && row.data?.skillKey === authoredCostRef.skillKey)).toBe(true);
  expect(data.result.baseline.evidence.items.some(row => row.ref === 'event/basic_attack_hit' && row.data?.skillKey === authoredCostRef.skillKey)).toBe(false);
  expect(damage.attackIndex).toBeNull();
  expect(data.result.baseline.summary.sourceVampHealing).toBeCloseTo(damage.postDefenseDamage * .1, 9);
  expect(data.result.iterations).toBe(100);
  expect(data.result.release.released).toBe(true);
  expect(state.errors).toEqual([]);
  await archive(info, data);
});

test('真实选择与计划页：早期目录不能替代快照绑定，费用不自动忽略，读取漂移保留草稿并拒绝本次运行', async ({ page }, info) => {
  const state = await installApi(page);
  state.directoryRules = structuredClone(state.rules);
  state.directoryRules.configuration!.basicAttackCategoryKey = 'earlier_strike';
  state.earlierSkillCategory = 'earlier_strike';
  await page.goto('/?classification-plan=1#/simulation/basic-attack');
  await verifyWasm(page);
  await setupPlan(page);
  const read = page.getByRole('button', { name: '读取场景快照', exact: true });
  await read.click(); await expect(read).toBeEnabled();
  const cost = page.getByRole('checkbox', { name: '声明施法成本 authored_cost.consume_fee', exact: true });
  await expect(cost.locator('xpath=ancestor::label')).toBeVisible(); await expect(cost).not.toBeChecked();
  await expect(page.getByText('快照已读取，但编译准入检查未通过', { exact: false })).toBeVisible();
  await confirmSimulationConfiguration(page);
  await cost.locator('xpath=ancestor::label').click();
  await page.getByRole('button', { name: '将缺失属性填写为0', exact: true }).click();
  await page.getByLabel('攻击方初始当前生命', { exact: true }).fill('250');
  await page.getByLabel('目标初始当前生命', { exact: true }).fill('500');
  await expect(page.getByLabel('攻击方补充属性 spell_fee', { exact: true })).toHaveCount(0);
  await page.getByLabel('观察时长（毫秒）', { exact: true }).fill('2000');
  await page.getByLabel('攻速输入上界', { exact: true }).fill('10');
  const run = page.getByRole('button', { name: '执行指定技能计划', exact: true });
  await run.click();
  await expect(page.getByText('指定技能计划观察完成，会话已释放', { exact: false })).toBeVisible();
  const runCount = () => page.evaluate(() => (window as typeof window & { bindingWorkerMessages: Array<{ type: string }> })
    .bindingWorkerMessages.filter(row => row.type === 'run').length);
  expect(await runCount()).toBe(1);
  state.snapshotRules = structuredClone(state.rules);
  state.snapshotRules.configuration!.ignorableCastCostAttributeKeys = [];
  const driftedRules = structuredClone(state.snapshotRules);
  await run.click();
  await expect(page.getByText('技能作者配置、来源或构筑已变化，草稿已保留', { exact: false })).toBeVisible();
  await expect(page.getByLabel('技能尝试时刻 skill_instruction_1', { exact: true })).toHaveValue('50');
  await expect(page.getByLabel('攻击方初始当前生命', { exact: true })).toHaveCount(0); // 准入失败时该输入暂不展示，草稿仍保留。
  await expect(cost).toHaveCount(0);
  await expect(run).toHaveCount(0);
  expect(await runCount()).toBe(1);
  state.snapshotRules = null;
  await read.click(); await expect(read).toBeEnabled();
  await expect(page.getByLabel('攻击方初始当前生命', { exact: true })).toHaveValue('250');
  await expect(page.getByLabel('目标初始当前生命', { exact: true })).toHaveValue('500');
  await expect(page.getByLabel('技能尝试时刻 skill_instruction_1', { exact: true })).toHaveValue('50');
  expect(await runCount()).toBe(1);
  expect(state.errors).toEqual([]);
  await archive(info, { directoryRules: state.directoryRules, driftedRules, reads: state.reads, workerRuns: await runCount(), restoredDraftHealth: { source: 250, target: 500 } });
});

for (const kind of ['unbound', 'read_failure'] as const) test(`选择页${kind}明确提示且不恢复旧分类候选`, async ({ page }) => {
  const state = await installApi(page);
  if (kind === 'unbound') state.rules.configuration!.basicAttackCategoryKey = null;
  else state.rulesFailure = true;
  await page.goto('/#/simulation/basic-attack');
  await chooseSimulationEntity(page, '攻击方角色', 'actor_a');
  if (kind === 'unbound') {
    await expect(page.getByText('尚未配置普通攻击分类用途绑定。', { exact: true })).toBeVisible();
    await page.locator('.simulation-entity-select[aria-label="普攻技能"]').click();
    await expect(page.getByRole('option').filter({ hasText: 'sample_basic_attack' })).toHaveCount(0);
    await page.getByRole('heading', { name: '攻击方配置', exact: true }).click();
    await page.getByRole('checkbox', { name: '指定技能行动计划', exact: true }).locator('xpath=ancestor::label').click();
    await chooseSimulationEntity(page, '攻击方主动技能候选', 'sample_active');
  } else {
    await expect(page.getByText('普攻列表读取失败：', { exact: false })).toContainText('计算规则读取失败');
    await expect(page.locator('.simulation-entity-select[aria-label="普攻技能"]')).toHaveClass(/arco-select-disabled/);
    state.rulesFailure = false;
    await page.getByRole('button', { name: '重试普攻列表', exact: true }).click();
    await chooseSimulationEntity(page, '普攻技能', 'sample_basic_attack');
  }
  expect(state.errors).toEqual([]);
});

test('选择页切换游戏后迟到绑定不覆盖新上下文，取消切换继续保留当前草稿', async ({ page }) => {
  const state = await installApi(page);
  let deliver!: () => void;
  state.gate = { gameId: 'demo', wait: new Promise<void>(resolve => { deliver = resolve; }) };
  await page.goto('/#/simulation/basic-attack');
  await chooseSimulationEntity(page, '攻击方角色', 'actor_a');
  await expect.poll(() => state.reads.filter(path => path === 'demo/calculation-rules').length).toBeGreaterThanOrEqual(1);
  await chooseOtherGame(page);
  await chooseSimulationEntity(page, '攻击方角色', 'actor_a');
  await expect(page.getByText('尚未配置普通攻击分类用途绑定。', { exact: true })).toBeVisible();
  deliver();
  await page.locator('.simulation-entity-select[aria-label="普攻技能"]').click();
  await expect(page.getByRole('option').filter({ hasText: 'sample_basic_attack' })).toHaveCount(0);
  await page.getByRole('heading', { name: '攻击方配置', exact: true }).click();
  await chooseSimulationLevel(page, '攻击方等级', 1);
  await page.getByRole('checkbox', { name: '指定技能行动计划', exact: true }).locator('xpath=ancestor::label').click();
  await chooseSimulationEntity(page, '攻击方主动技能候选', 'sample_active');
  await page.getByRole('button', { name: '添加首次尝试', exact: true }).click();
  await page.getByLabel('技能尝试时刻 skill_instruction_1', { exact: true }).fill('37');
  await chooseSimulationEntity(page, '目标角色', 'actor_b');
  await chooseSimulationLevel(page, '目标等级', 1);
  let deliverSnapshot!: () => void;
  state.snapshotGate = new Promise<void>(resolve => { deliverSnapshot = resolve; });
  const read = page.getByRole('button', { name: '读取场景快照', exact: true });
  await read.click();
  await expect.poll(() => state.reads.filter(path => path === 'other/simulation-snapshot').length).toBe(1);
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('.app-toolbar-field--game .arco-select').click();
  await page.getByRole('option', { name: /^demo \/ 作者绑定游戏$/ }).click();
  await expect(page.locator('.app-toolbar-field--game')).toContainText('other');
  await expect(page.locator('.simulation-entity-select[aria-label="攻击方角色"]')).toContainText(state.sample.source.character.name);
  await expect(page.getByLabel('技能尝试时刻 skill_instruction_1', { exact: true })).toHaveValue('37');
  deliverSnapshot();
  await expect(read).toBeEnabled();
  expect(state.errors).toEqual([]);
});

test('游戏计算规则页面：真实目录选择、完整保护保存、失败草稿和不确定写入独立回读', async ({ page }, info) => {
  const state = await installApi(page);
  state.rules.configuration!.basicAttackCategoryKey = null;
  state.rules.configuration!.equipmentPassiveCategoryKey = null;
  state.rules.configuration!.ignorableCastCostAttributeKeys = [];
  const original = structuredClone(state.rules);
  await page.goto('/#/game-settings');
  const basic = page.locator('.arco-select[aria-label="普通攻击分类"]');
  await expect(basic).not.toHaveClass(/arco-select-disabled/);
  await expect(basic).not.toContainText('authored_strike');
  await pick(page, '普通攻击分类', 'authored_strike');
  await pick(page, '装备被动分类', 'authored_strike');
  const save = page.getByRole('button', { name: '保存计算规则', exact: true });
  await save.click();
  await expect(page.getByText('category_usage_conflict', { exact: false })).toBeVisible();
  expect(state.writes).toEqual([]);
  await pick(page, '装备被动分类', 'authored_item');
  await pick(page, '可明确忽略的施法费用属性', 'spell_fee');
  state.writeOutcome = 'rejected';
  await save.click();
  await expect(page.getByText('保存候选被拒绝', { exact: false })).toBeVisible();
  await expect(basic).toContainText('authored_strike');
  await expect(page.locator('.arco-select[aria-label="可明确忽略的施法费用属性"]')).toContainText('spell_fee');
  state.writeOutcome = 'uncertain';
  await save.click();
  await expect(page.getByRole('button', { name: '重新读取计算规则确认', exact: true })).toBeVisible();
  await expect(save).toBeDisabled();
  await expect(basic).toHaveClass(/arco-select-disabled/);
  const expected = { ...original.configuration!, basicAttackCategoryKey: 'authored_strike', equipmentPassiveCategoryKey: 'authored_item', ignorableCastCostAttributeKeys: ['spell_fee'] };
  expect(state.writes).toEqual([{ baseDigest: original.baseDigest, configuration: expected }, { baseDigest: original.baseDigest, configuration: expected }]);
  await page.getByRole('button', { name: '重新读取计算规则确认', exact: true }).click();
  await expect(page.getByText('计算规则已独立读回确认。', { exact: true })).toBeVisible();
  await expect(basic).not.toHaveClass(/arco-select-disabled/);
  expect(state.rules.configuration).toEqual(expected);
  expect(state.errors).toEqual([]);
  await archive(info, { original, writes: state.writes, final: state.rules, reads: state.reads });
});

test('游戏计算规则迟到读取不串游戏，取消刷新保留费用与分类草稿', async ({ page }) => {
  const state = await installApi(page);
  let deliver!: () => void;
  state.gate = { gameId: 'demo', wait: new Promise<void>(resolve => { deliver = resolve; }) };
  await page.goto('/#/game-settings');
  await expect.poll(() => state.reads.filter(path => path === 'demo/calculation-rules').length).toBeGreaterThanOrEqual(1);
  await chooseOtherGame(page);
  const basic = page.locator('.arco-select[aria-label="普通攻击分类"]');
  await expect(basic).not.toHaveClass(/arco-select-disabled/);
  await expect(basic).not.toContainText('authored_strike');
  deliver();
  await pick(page, '普通攻击分类', 'authored_strike');
  await pick(page, '可明确忽略的施法费用属性', 'spell_fee');
  const reads = state.reads.filter(path => path === 'other/calculation-rules').length;
  await page.getByRole('button', { name: '刷新计算规则', exact: true }).click();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(basic).toContainText('authored_strike');
  await expect(page.locator('.arco-select[aria-label="可明确忽略的施法费用属性"]')).toContainText('spell_fee');
  expect(state.reads.filter(path => path === 'other/calculation-rules').length).toBe(reads);
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

for (const different of [false, true]) test(`最终Worker两个独立永久光环：${different ? '不同' : '同一'}重命名对手属性完整叠加、100次及释放重编`, async ({ page }, info) => {
  const state = await installApi(page);
  const snapshot = authoredAuraPairSample(different);
  await page.goto('/?classification-auras=1');
  await verifyWasm(page);
  const data = await page.evaluate(async snapshot => {
    const adapterPath = '/src/engine/simulationAdapter.ts', clientPath = '/src/engine/genericEngineClient.ts';
    const preflightPath = '/src/engine/skillFormulaPreflight.ts', continuousPath = '/src/engine/continuousAttackRequest.ts';
    const { inspectSimulationSnapshot, prepareSimulation } = await import(adapterPath) as typeof import('../../src/engine/simulationAdapter');
    const { GenericEngineClient } = await import(clientPath) as typeof import('../../src/engine/genericEngineClient');
    const { preflightSkillFormulas } = await import(preflightPath) as typeof import('../../src/engine/skillFormulaPreflight');
    const { continuousAttackRequest } = await import(continuousPath) as typeof import('../../src/engine/continuousAttackRequest');
    const client = new GenericEngineClient();
    try {
      const preflight = await preflightSkillFormulas(snapshot, client);
      const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
      for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) inputs[row.side][row.attribute.attributeKey] = 0;
      const assumptions = snapshot.target.selectedEquipment.map(item => ({ owner: 'target' as const, equipmentKey: item.equipment.equipmentKey, target: 'source' as const, inRange: true }));
      const prepared = await prepareSimulation(snapshot, inputs, { source: 500, target: 500 }, assumptions);
      const compiled = await client.compile(prepared.compileRequest);
      if (!compiled.ok || !compiled.sessionId) throw new Error(JSON.stringify(compiled.errors));
      const run = await continuousAttackRequest(prepared, snapshot, { durationMs: 3000, attackSpeedInputMax: 10, recordTimeSeries: true }, compiled.sessionId);
      const done = await client.run(run.runRequest);
      for (let iteration = 1; iteration < 100; iteration++) if (JSON.stringify(await client.run(run.runRequest)) !== JSON.stringify(done)) throw new Error(`同会话第${iteration + 1}次不同`);
      const released = await client.release(compiled.sessionId, compiled.rulesHash);
      const again = await client.compile(prepared.compileRequest);
      if (!again.ok || !again.sessionId) throw new Error(JSON.stringify(again.errors));
      const recompiled = await client.run({ ...run.runRequest, sessionId: again.sessionId, expectedRulesHash: again.rulesHash });
      const secondRelease = await client.release(again.sessionId, again.rulesHash);
      return { preflight, prepared, compiled, run, done, released, recompiled, secondRelease, sameSessionRuns: 100 };
    } finally { client.terminate(); }
  }, snapshot);
  const source = data.done.finalSnapshot.combatants.find(row => row.key === 'source')!;
  expect(source.attributes.authored_tempo!.resolved).toBeCloseTo(different ? .8 : .4, 10);
  expect(source.attributes.authored_guard!.resolved).toBeCloseTo(different ? 19 : 38, 10);
  expect(data.done.attackRecords!.map(row => row.startAtMs)).toEqual(different ? [0, 1250, 2500] : [0, 2500]);
  const origins = data.prepared.skillOrigins.filter(row => row.side === 'target' && row.origin.kind === 'EQUIPMENT');
  expect(origins.map(row => row.origin.kind === 'EQUIPMENT' ? row.origin.equipmentKey : '')).toEqual(['authored_aura_a', 'authored_aura_b']);
  expect(new Set(origins.map(row => row.providerRef)).size).toBe(2);
  expect(data.recompiled).toEqual(data.done);
  expect(data.released.released && data.secondRelease.released).toBe(true);
  expect(data.sameSessionRuns).toBe(100);
  expect(state.errors).toEqual([]);
  await archive(info, { snapshot, ...data });
});
