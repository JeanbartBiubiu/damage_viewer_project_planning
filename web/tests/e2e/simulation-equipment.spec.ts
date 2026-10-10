import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { SimulationAttributeInputs, SimulationEquipmentAssumption, SimulationInitialHealth, SimulationSelection, SimulationSnapshot } from '../../src/types/simulationSnapshot';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';
import { equipmentSimulationSample } from '../fixtures/simulationEquipment';
import { permanentEquipmentSimulationSample } from '../fixtures/simulationPermanentEquipment';
import { chooseSimulationEntity, chooseSimulationLevel, installSimulationSelectionApi } from '../fixtures/simulationSelection';
import { confirmSimulationConfiguration } from '../fixtures/simulationSnapshotRequests';
import { syncSimulationSkillSources } from '../fixtures/simulationSkillSources';

const API = 'http://127.0.0.1:19114';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=';

test.beforeEach(() => {
  const wasm = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  expect(wasm.length).toBe(WASM_IDENTITY.bytes);
  expect(createHash('sha256').update(wasm).digest('hex')).toBe(WASM_IDENTITY.sha256);
});

async function chooseEquipment(page: Page, side: '攻击方' | '目标', key: string) {
  const select = page.locator(`.simulation-equipment-select[aria-label="${side}装备"]`);
  await expect(select).not.toHaveClass(/arco-select-disabled/);
  await select.locator('input').fill(key);
  const popup = page.locator(`#${await select.getAttribute('aria-controls')}`);
  await popup.getByRole('option').filter({ hasText: key }).click();
  await page.keyboard.press('Escape');
}

async function installFixture(page: Page, permanent = false) {
  const sample = equipmentSimulationSample();
  const requests: SimulationSelection[] = [];
  const methods: { path: string; method: string }[] = [];
  const mode = { fail: false, missingRatio: false, passive: false, hold: false };
  let pending: (() => void) | null = null;
  await page.addInitScript(api => {
    localStorage.setItem('damage-viewer.web.api-base-url', api);
    localStorage.setItem('damage-viewer.web.admin-token', 'equipment-fixture-only');
  }, API);
  page.on('request', request => {
    if (request.url().includes('/api/')) methods.push({ path: new URL(request.url()).pathname, method: request.method() });
  });
  await page.route('**/api/games', route => route.fulfill({ json: [{ gameId: 'lol', gameName: '独立装备结构用例', representativeImageKey: null }] }));
  await installSimulationSelectionApi(page, API, 'lol', sample);
  const items = equipmentSimulationSample(['item_1028', 'item_1036', 'item_1042']).source.selectedEquipment.map(row => row.equipment);
  if (permanent) items.push(...permanentEquipmentSimulationSample(['item_3065', 'item_3110']).source.selectedEquipment.map(row => row.equipment));
  items.push(...Array.from({ length: 4 }, (_, index) => ({ ...items[0]!, equipmentKey: `unverified_${index}`, name: `未核定样例${index}` })));
  await page.route(`${API}/api/admin/games/lol/equipment`, route => route.fulfill({ json: { items, total: items.length } }));
  await page.route(`${API}/api/admin/games/lol/equipment/*/representative-image`, route => {
    const key = new URL(route.request().url()).pathname.split('/').at(-2)!;
    return route.fulfill({ json: { image: ['item_1036', 'item_1028'].includes(key)
      ? { imageKey: `${key}_icon`, name: '装备图标', enabled: true } : null } });
  });
  await page.route(`${API}/api/admin/games/lol/images/*`, route => route.fulfill({ json: {
    gameId: 'lol', imageKey: new URL(route.request().url()).pathname.split('/').at(-1), name: '装备图标', description: null,
    imageBase64: PNG, mimeType: 'image/png', byteSize: 68, width: 1, height: 1, enabled: true,
    createdAt: '2026-10-04T00:00:00Z', updatedAt: '2026-10-04T00:00:00Z'
  } }));
  await page.route(`${API}/api/admin/games/lol/simulation-snapshot`, async route => {
    expect(route.request().method()).toBe('POST');
    const selection = route.request().postDataJSON() as SimulationSelection;
    expect(Object.keys(selection).sort()).toEqual(['sourceCharacterKey', 'sourceLevel', 'targetCharacterKey', 'targetLevel',
      'basicAttackSkillKey', 'basicAttackLevel', 'plannedSkills', 'sourceEquipmentKeys', 'targetEquipmentKeys',
      'sourceBuildConfigurations', 'targetBuildConfigurations', 'sourceSkillSettings', 'targetSkillSettings'].sort());
    expect(selection.plannedSkills).toEqual([]);
    requests.push(selection);
    if (mode.hold) await new Promise<void>(resolveRequest => { pending = resolveRequest; });
    if (mode.fail) {
      await route.fulfill({ status: 409, json: { error: { message: '明确测试读取失败', code: '409.SIMULATION_SNAPSHOT_INVALID' } } }).catch(() => undefined);
      return;
    }
    const sampleBuilder = permanent ? permanentEquipmentSimulationSample : equipmentSimulationSample;
    const snapshot = sampleBuilder(selection.sourceEquipmentKeys, selection.targetEquipmentKeys);
    snapshot.selection = selection;
    if (mode.missingRatio) snapshot.catalogs.attributes = snapshot.catalogs.attributes.filter(row => row.attributeKey !== 'attack_speed_ratio');
    if (mode.passive && snapshot.source.selectedEquipment[0]) {
      const item = snapshot.source.selectedEquipment[0];
      item.attachedSkills.push({ gameId: 'lol', equipmentKey: item.equipment.equipmentKey, equipmentName: item.equipment.name,
        skillKey: snapshot.selection.basicAttackSkillKey, skillName: '明确测试关系', skillStatus: 'ENABLED', sortOrder: 0 });
    }
    syncSimulationSkillSources(snapshot);
    snapshot.snapshotDigest = createHash('sha256').update(JSON.stringify([snapshot.selection, snapshot.source.skillSources, snapshot.target.skillSources])).digest('hex');
    await route.fulfill({ json: snapshot }).catch(() => undefined);
  });
  await page.goto('/#/simulation/basic-attack');
  await chooseSimulationEntity(page, '攻击方角色', sample.selection.sourceCharacterKey);
  await chooseSimulationEntity(page, '目标角色', sample.selection.targetCharacterKey);
  await chooseSimulationLevel(page, '攻击方等级', 1);
  await chooseSimulationLevel(page, '目标等级', 1);
  await chooseSimulationEntity(page, '普攻技能', sample.selection.basicAttackSkillKey);
  await chooseSimulationLevel(page, '普攻技能等级', 1);
  return { mode, requests, methods, unblock: () => { mode.hold = false; pending?.(); } };
}

async function readSnapshot(page: Page) {
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  await expect(page.locator('#simulation-snapshot-digest')).toBeVisible();
  await confirmSimulationConfiguration(page);
}

async function runActual(page: Page, snapshot: SimulationSnapshot, inputs: SimulationAttributeInputs, initialHealth: SimulationInitialHealth, testInfo: TestInfo,
  assumptions: SimulationEquipmentAssumption[] = []) {
  const result = await page.evaluate(async ({ snapshot, inputs, initialHealth, assumptions }) => {
    const adapterPath = '/src/engine/simulationAdapter.ts';
    const clientPath = '/src/engine/genericEngineClient.ts';
    const continuousPath = '/src/engine/continuousAttackRequest.ts';
    const singleResultPath = '/src/engine/singleAttackResult.ts';
    const continuousResultPath = '/src/engine/continuousAttackResult.ts';
    const { prepareSimulation, singleAttackRequest } = await import(adapterPath) as typeof import('../../src/engine/simulationAdapter');
    const { GenericEngineClient } = await import(clientPath) as typeof import('../../src/engine/genericEngineClient');
    const { continuousAttackRequest } = await import(continuousPath) as typeof import('../../src/engine/continuousAttackRequest');
    const { assessSingleAttackResult } = await import(singleResultPath) as typeof import('../../src/engine/singleAttackResult');
    const { assessContinuousAttackResult } = await import(continuousResultPath) as typeof import('../../src/engine/continuousAttackResult');
    const prepared = await prepareSimulation(snapshot, inputs, initialHealth, assumptions);
    const client = new GenericEngineClient();
    let compiled, single, continuous, repeatedContinuous, singleAssessment, continuousAssessment, release, error;
    try {
      compiled = await client.compile(prepared.compileRequest);
      if (!compiled.ok || !compiled.sessionId) throw new Error(JSON.stringify(compiled.errors));
      const singleRequest = singleAttackRequest(prepared.compileRequest, compiled.sessionId);
      singleRequest.runtimeOptions = { ...singleRequest.runtimeOptions, equipmentAssumptions: assumptions, skillOrigins: prepared.skillOrigins };
      single = await client.run(singleRequest);
      singleAssessment = assessSingleAttackResult(prepared.compileRequest, singleRequest, single);
      const continuousPrepared = await continuousAttackRequest(prepared, snapshot, { durationMs: 2000, attackSpeedInputMax: 2, recordTimeSeries: false }, compiled.sessionId);
      continuous = await client.run(continuousPrepared.runRequest);
      continuousAssessment = assessContinuousAttackResult(prepared.compileRequest, continuousPrepared.runRequest, continuous, prepared.operationOrigins);
      repeatedContinuous = await client.run(continuousPrepared.runRequest);
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally {
      try {
        if (compiled?.sessionId && client.hasLiveWorker) release = await client.release(compiled.sessionId, prepared.compileRequest.rulesHash);
      } finally { client.terminate(); }
    }
    return { prepared, compiled, single, continuous, repeatedContinuous, singleAssessment, continuousAssessment, release, error, liveWorker: client.hasLiveWorker };
  }, { snapshot, inputs, initialHealth, assumptions });
  await testInfo.attach('装备实际引擎档案', { body: JSON.stringify({ snapshot, ...result, wasm: WASM_IDENTITY }), contentType: 'application/json' });
  expect(result.error).toBeUndefined();
  expect(result.compiled?.ok).toBe(true);
  expect(result.singleAssessment?.complete).toBe(true);
  expect(result.continuousAssessment?.complete).toBe(true);
  expect(result.repeatedContinuous).toEqual(result.continuous);
  expect(result.release?.released).toBe(true);
  expect(result.liveWorker).toBe(false);
  return result;
}

for (const side of ['攻击方', '目标'] as const) {
  test(`${side}装备支持中文名称与标识搜索，已选装备仍可搜索且清空恢复列表`, async ({ page }) => {
    await installFixture(page);
    const select = page.getByRole('combobox', { name: `${side}装备`, exact: true });
    const input = select.locator('input');
    await input.fill('长');
    const popup = page.locator(`#${await select.getAttribute('aria-controls')}`);
    const sword = popup.getByRole('option').filter({ hasText: 'item_1036' });
    await expect(sword).toBeVisible();
    await expect(sword.getByRole('img', { name: '样例长剑', exact: true })).toHaveAttribute('src', PNG);
    await expect(popup.getByRole('option')).toHaveCount(1);
    await input.pressSequentially('剑');
    await expect(sword).toBeVisible();
    await expect(input).toBeFocused();
    await input.press('Backspace');
    await expect(sword).toBeVisible();
    await expect(input).toBeFocused();
    await input.fill(' 样例长剑 ');
    await expect(sword).toBeVisible();
    await input.fill(' ITEM_1036 ');
    await expect(sword).toBeVisible();
    await sword.click();
    await page.keyboard.press('Escape');
    await expect(select.locator('.arco-select-tag')).toHaveCount(1);
    await expect(select.locator('.arco-select-tag').getByRole('img', { name: '样例长剑', exact: true })).toHaveAttribute('src', PNG);
    await input.fill('长');
    await expect(sword).toBeVisible();
    await expect(select.locator('.arco-select-tag')).toHaveCount(1);
    await input.fill('不存在的装备');
    await expect(popup.getByRole('option')).toHaveCount(0);
    await input.fill('');
    await expect(popup.getByRole('option')).toHaveCount(7);
    await expect(sword).toBeVisible();
    await page.keyboard.press('Escape');
  });
}

test('装备图标按可见选项读取，双方共用缓存，缺图和读取失败仍可选择', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const fixture = await installFixture(page);
  const equipmentImageReads = () => fixture.methods.filter(row => /\/equipment\/[^/]+\/representative-image$/.test(row.path));
  const swordDownloads = () => fixture.methods.filter(row => row.path.endsWith('/images/item_1036_icon'));
  expect(equipmentImageReads()).toHaveLength(0);
  await page.route(`${API}/api/admin/games/lol/images/item_1028_icon`, route => route.fulfill({ status: 500, json: { message: '图片暂不可读' } }));
  await chooseEquipment(page, '攻击方', 'item_1036');
  await chooseEquipment(page, '目标', 'item_1036');
  for (const side of ['攻击方', '目标']) {
    await expect(page.getByRole('combobox', { name: `${side}装备`, exact: true })
      .locator('.arco-select-tag').getByRole('img', { name: '样例长剑', exact: true })).toHaveAttribute('src', PNG);
  }
  expect(equipmentImageReads().filter(row => row.path.endsWith('/equipment/item_1036/representative-image'))).toHaveLength(1);
  expect(new Set(equipmentImageReads().map(row => row.path)).size).toBe(equipmentImageReads().length);
  expect(swordDownloads()).toHaveLength(1);
  await page.reload();
  await chooseEquipment(page, '攻击方', 'item_1036');
  await expect(page.getByRole('combobox', { name: '攻击方装备', exact: true })
    .locator('.arco-select-tag').getByRole('img', { name: '样例长剑', exact: true })).toHaveAttribute('src', PNG);
  expect(swordDownloads()).toHaveLength(1);
  await chooseEquipment(page, '目标', 'unverified_0');
  const target = page.getByRole('combobox', { name: '目标装备', exact: true });
  await expect(target.getByLabel('未核定样例0 未上传图片')).toBeVisible();
  await chooseEquipment(page, '目标', 'item_1028');
  await expect(target.locator('.arco-select-tag').filter({ hasText: 'item_1028' })
    .locator('.resource-image-thumb-placeholder')).toBeVisible();
  await expect(target.locator('.arco-select-tag')).toHaveCount(2);
  expect(fixture.methods.some(row => row.path.endsWith('/images'))).toBe(false);
  expect(fixture.methods.every(row => row.method === 'GET' || row.method === 'OPTIONS')).toBe(true);
  expect(errors).toEqual([]);
});

test('页面纯属性选装进入真实编译、单次、连续与冻结装备档案，所有业务请求只读', async ({ page }) => {
  const fixture = await installFixture(page);
  await chooseEquipment(page, '攻击方', 'item_1036');
  await chooseEquipment(page, '目标', 'item_1028');
  await readSnapshot(page);
  await page.getByRole('button', { name: '将缺失属性填写为0', exact: true }).click();
  await page.getByRole('button', { name: '双方以满生命开始', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '目标初始当前生命', exact: true })).toHaveValue('740');
  await page.getByRole('button', { name: '编译验证', exact: true }).click();
  await expect(page.getByText('仅编译验证通过，不代表单次/连续计算通过。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '执行一次普攻', exact: true }).click();
  await expect(page.getByTestId('single-attack-target-initial-hp')).toHaveText('740');
  await page.getByRole('spinbutton', { name: '观察时长（毫秒）', exact: true }).fill('2000');
  await page.getByRole('spinbutton', { name: '攻速输入上界', exact: true }).fill('2');
  await page.getByRole('button', { name: '连续普攻', exact: true }).click();
  await expect(page.getByText('连续普攻已完成观察，目标未被击杀，会话正常释放。', { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载连续运行档案', exact: true }).click();
  const download = await downloadPromise;
  const archive = JSON.parse(readFileSync((await download.path())!, 'utf8'));
  expect(archive.snapshot.selection).toMatchObject({ sourceEquipmentKeys: ['item_1036'], targetEquipmentKeys: ['item_1028'] });
  expect(archive.equipmentOrigins.map((row: { side: string; equipmentKey: string }) => [row.side, row.equipmentKey])).toEqual([['source', 'item_1036'], ['target', 'item_1028']]);
  expect(archive.outcome).toBe('passed');
  expect(archive.skillOrigins).toEqual(expect.arrayContaining([expect.objectContaining({ side: 'source', skillKey: 'sample_basic_attack' })]));
  expect(fixture.methods.every(row => row.method === 'OPTIONS' || row.method === (row.path.endsWith('/simulation-snapshot') ? 'POST' : 'GET'))).toBe(true);
});

test('换装保留生命草稿并使旧结果过期，新上限越界明确报错；读取错误与取消不丢草稿', async ({ page }) => {
  const fixture = await installFixture(page);
  await chooseEquipment(page, '攻击方', 'item_1028');
  await readSnapshot(page);
  await page.getByRole('button', { name: '将缺失属性填写为0', exact: true }).click();
  await page.getByRole('button', { name: '双方以满生命开始', exact: true }).click();
  await page.getByRole('button', { name: '执行一次普攻', exact: true }).click();
  await expect(page.getByText('单次普攻运行通过，不代表连续攻击通过。', { exact: true })).toBeVisible();
  await chooseEquipment(page, '攻击方', 'item_1028');
  await expect(page.locator('#simulation-snapshot-digest')).toHaveCount(0);
  await expect(page.getByText('输入已改变；上一份冻结结果已过期，不代表当前场景。', { exact: true })).toBeVisible();
  await readSnapshot(page);
  const hp = page.getByRole('spinbutton', { name: '攻击方初始当前生命', exact: true });
  await expect(hp).toHaveValue('800');
  await expect(page.getByText(/当前生命草稿800超出0～650/)).toBeVisible();
  await expect(page.getByRole('button', { name: '编译验证', exact: true })).toBeDisabled();
  fixture.mode.fail = true;
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  await expect(page.getByText(/明确测试读取失败/)).toBeVisible();
  await expect(hp).toHaveValue('800');
  fixture.mode.fail = false;
  const completedReads = fixture.requests.length;
  fixture.mode.hold = true;
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  await expect.poll(() => fixture.requests.length).toBe(completedReads + 1);
  await page.getByRole('button', { name: '取消当前请求', exact: true }).click();
  fixture.unblock();
  await expect(hp).toHaveValue('800');
  await page.getByRole('button', { name: '双方以满生命开始', exact: true }).click();
  await expect(hp).toHaveValue('650');
});

test('短剑缺收益系数目录与不完整被动关系整件拒绝，长剑仍可取得快照', async ({ page }) => {
  const fixture = await installFixture(page);
  fixture.mode.missingRatio = true;
  await chooseEquipment(page, '攻击方', 'item_1042');
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  await expect(page.getByText(/缺目录不能运行短剑/)).toBeVisible();
  await expect(page.getByRole('button', { name: '编译验证', exact: true })).toHaveCount(0);
  await chooseEquipment(page, '攻击方', 'item_1042');
  await chooseEquipment(page, '攻击方', 'item_1036');
  await readSnapshot(page);
  fixture.mode.passive = true;
  await chooseEquipment(page, '目标', 'item_1036');
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  await expect(page.getByText(/装备关系需要完整单级、已启用的被动技能/)).toBeVisible();
  await expect(page.getByRole('button', { name: '执行一次普攻', exact: true })).toHaveCount(0);
});

test('短剑收益系数没有默认值或补零，显式正输入后才允许进入真实执行', async ({ page }) => {
  await installFixture(page);
  await chooseEquipment(page, '攻击方', 'item_1042');
  await readSnapshot(page);
  await page.getByRole('button', { name: '将缺失属性填写为0', exact: true }).click();
  await page.getByRole('button', { name: '双方以满生命开始', exact: true }).click();
  const ratio = page.getByRole('spinbutton', { name: '攻击方补充属性 attack_speed_ratio', exact: true });
  await expect(ratio).toHaveValue('');
  const single = page.getByRole('button', { name: '执行一次普攻', exact: true });
  await expect(single).toBeDisabled();
  await ratio.fill('0');
  await single.click();
  await expect(page.getByText(/装备攻速收益系数必须明确填写有限正数/)).toBeVisible();
  await expect(ratio).toHaveValue('0');
  await ratio.fill('0.651');
  await single.click();
  await expect(page.getByText('单次普攻运行通过，不代表连续攻击通过。', { exact: true })).toBeVisible();
});

test('每侧最多6件且不重复，同装备双侧合法，请求选择按稳定键排序', async ({ page }) => {
  const fixture = await installFixture(page);
  await chooseEquipment(page, '攻击方', 'item_1036');
  await chooseEquipment(page, '攻击方', 'item_1028');
  await chooseEquipment(page, '目标', 'item_1036');
  await readSnapshot(page);
  expect(fixture.requests[0]!.sourceEquipmentKeys).toEqual(['item_1028', 'item_1036']);
  expect(fixture.requests[0]!.targetEquipmentKeys).toEqual(['item_1036']);
  for (const key of ['item_1042', 'unverified_0', 'unverified_1', 'unverified_2']) await chooseEquipment(page, '攻击方', key);
  const select = page.locator('.simulation-equipment-select[aria-label="攻击方装备"]');
  await select.locator('input').fill('unverified_3');
  const popup = page.locator(`#${await select.getAttribute('aria-controls')}`);
  await expect(popup.getByRole('option').filter({ hasText: 'unverified_3' })).toHaveClass(/arco-select-option-wrapper-disabled/);
  await page.keyboard.press('Escape');
});

test('代表装备双侧进入实际引擎，固有零值不累计装备、生命草稿保持、每侧攻速只派生一次', async ({ page }, testInfo) => {
  await installFixture(page);
  const snapshot = equipmentSimulationSample(['item_1028', 'item_1036', 'item_1042'], ['item_1028', 'item_1042']);
  snapshot.source.selectedLevelValues.attack_damage = 0;
  snapshot.source.attributes.levelValues['1']!.attack_damage = 0;
  const inputs = { source: { critical_strike_chance: 0, critical_strike_damage_bonus_percent: 0, armor_pen_percent: 0,
    armor_pen_flat: 0, life_steal_percent: 0, attack_speed_ratio: 0.651 }, target: { attack_speed_ratio: 0.668 } };
  const result = await runActual(page, snapshot, inputs, { source: 711, target: 600 }, testInfo);
  const source = result.continuous!.finalSnapshot.combatants.find(row => row.key === 'source')!;
  const target = result.continuous!.finalSnapshot.combatants.find(row => row.key === 'target')!;
  expect(result.prepared.compileRequest.combatants[0]!.attributes.hp).toEqual({ base: 650, current: 711, max: 800, resolved: 800 });
  expect(result.continuousAssessment).toMatchObject({ sourceInitialHp: 711, targetInitialHp: 600 });
  expect(source.attributes.attack_damage).toMatchObject({ base: 0, resolved: 10 });
  expect(source.attributes.hp).toMatchObject({ base: 650, max: 800, current: 711 });
  expect(target.attributes.hp).toMatchObject({ base: 590, max: 740 });
  expect(source.attributes.hp!.resolved).toBe(source.attributes.hp!.current);
  expect(target.attributes.hp!.resolved).toBe(target.attributes.hp!.current);
  expect(source.attributes.attack_speed!.resolved).toBeCloseTo(0.7161, 10);
  expect(target.attributes.attack_speed!.resolved).toBeCloseTo(0.7348, 10);
  expect(result.continuous!.attackRecords!.every(row => Math.abs(row.attackSpeed - 0.7161) < 1e-9)).toBe(true);
  expect(source.providers).toHaveLength(4);
  expect(target.providers).toHaveLength(2);
});

test('真实服务长剑与红水晶完整作者快照进入实际引擎，不写业务数据或替换被动', async ({ page }, testInfo) => {
  test.skip(process.env.SIMULATION_LIVE_API !== '1', '必须显式启用真实只读服务；跳过不是4A验收通过');
  const base = process.env.SIMULATION_LIVE_API_BASE_URL ?? 'http://127.0.0.1:8080';
  const token = process.env.SIMULATION_LIVE_ADMIN_TOKEN ?? '';
  await page.goto('/#/simulation/basic-attack');
  const data = await page.evaluate(async ({ base, token }) => {
    const snapshotPath = '/tests/fixtures/simulationLiveSnapshot.ts';
    const equipmentPath = '/src/services/equipmentClient.ts';
    const adapterPath = '/src/engine/simulationAdapter.ts';
    const { getIsolatedSimulationSnapshot } = await import(snapshotPath) as typeof import('../fixtures/simulationLiveSnapshot');
    const { listEquipment } = await import(equipmentPath) as typeof import('../../src/services/equipmentClient');
    const { inspectSimulationSnapshot } = await import(adapterPath) as typeof import('../../src/engine/simulationAdapter');
    const catalog = (await listEquipment(base, 'lol', token)).data;
    const snapshot = await getIsolatedSimulationSnapshot(base, 'lol', {
      sourceCharacterKey: 'champion_aatrox', sourceLevel: 1, targetCharacterKey: 'champion_ahri', targetLevel: 1,
      basicAttackSkillKey: 'shared_basic_attack', basicAttackLevel: 1, plannedSkills: [], sourceEquipmentKeys: ['item_1028', 'item_1036'], targetEquipmentKeys: ['item_1028'],
      sourceBuildConfigurations: [], targetBuildConfigurations: [], sourceSkillSettings: [], targetSkillSettings: []
    }, token);
    const inputs: SimulationAttributeInputs = { source: {}, target: {} };
    for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) inputs[row.side][row.attribute.attributeKey] = 0;
    return { snapshot, inputs, catalogKeys: catalog.items.map(row => row.equipmentKey) };
  }, { base, token });
  expect(data.catalogKeys).toContain('item_1036');
  expect(data.catalogKeys).toContain('item_1028');
  const limits = (['source', 'target'] as const).map(side => data.snapshot[side].selectedLevelValues.hp! + data.snapshot[side].selectedEquipment.reduce((total, item) => total + (item.attributes.attributeValues.hp ?? 0), 0));
  await runActual(page, data.snapshot, data.inputs, { source: limits[0]!, target: limits[1]! }, testInfo);
});

test('真实服务短剑使用独立核定的角色收益系数，由原普攻过程求得原生间隔', async ({ page }, testInfo) => {
  test.skip(process.env.SIMULATION_LIVE_API !== '1', '必须显式启用真实只读服务；跳过不是4A验收通过');
  const base = process.env.SIMULATION_LIVE_API_BASE_URL ?? 'http://127.0.0.1:8080';
  const token = process.env.SIMULATION_LIVE_ADMIN_TOKEN ?? '';
  const ratioSource = {
    version: '16.19', build: '16.19.8230722+branch.releases-16-19.content.release',
    path: 'game/data/characters/aatrox/aatrox.bin.json', field: 'attackSpeedRatioModifiable.baseValue',
    sha256: 'a95ea5e44b17c164942660b920a671cb580c34e452ebab975ff08f149c7aa391',
    value: 0.6510000228881836
  };
  await page.goto('/#/simulation/basic-attack');
  const data = await page.evaluate(async ({ base, token, ratio }) => {
    const snapshotPath = '/tests/fixtures/simulationLiveSnapshot.ts';
    const adapterPath = '/src/engine/simulationAdapter.ts';
    const { getIsolatedSimulationSnapshot } = await import(snapshotPath) as typeof import('../fixtures/simulationLiveSnapshot');
    const { inspectSimulationSnapshot } = await import(adapterPath) as typeof import('../../src/engine/simulationAdapter');
    const snapshot = await getIsolatedSimulationSnapshot(base, 'lol', {
      sourceCharacterKey: 'champion_aatrox', sourceLevel: 1, targetCharacterKey: 'champion_ahri', targetLevel: 1,
      basicAttackSkillKey: 'shared_basic_attack', basicAttackLevel: 1, plannedSkills: [], sourceEquipmentKeys: ['item_1042'], targetEquipmentKeys: ['item_1028'],
      sourceBuildConfigurations: [], targetBuildConfigurations: [], sourceSkillSettings: [], targetSkillSettings: []
    }, token);
    const inputs: SimulationAttributeInputs = { source: {}, target: {} };
    for (const row of inspectSimulationSnapshot(snapshot).requirements) {
      if (row.storedValue === undefined) inputs[row.side][row.attribute.attributeKey] = row.attribute.attributeKey === 'attack_speed_ratio' ? ratio : 0;
    }
    return { snapshot, inputs };
  }, { base, token, ratio: ratioSource.value });
  const ratioDefinition = data.snapshot.catalogs.attributes.find(row => row.attributeKey === 'attack_speed_ratio');
  expect(ratioDefinition).toMatchObject({ valueType: 'DECIMAL', minValue: 0, maxValue: null, status: 'ENABLED' });
  expect(data.snapshot.source.selectedLevelValues.attack_speed_ratio).toBeUndefined();
  const result = await runActual(page, data.snapshot, data.inputs, {
    source: data.snapshot.source.selectedLevelValues.hp!, target: data.snapshot.target.selectedLevelValues.hp! + 150
  }, testInfo);
  await testInfo.attach('攻速系数独立来源与场景显式补填', { body: JSON.stringify(ratioSource), contentType: 'application/json' });
  const bonus = data.snapshot.source.selectedEquipment[0]!.attributes.attributeValues.bonus_attack_speed_percent!;
  const expectedSpeed = data.snapshot.source.selectedLevelValues.attack_speed! + ratioSource.value * bonus;
  expect(result.continuous!.attackRecords).toHaveLength(2);
  expect(result.continuous!.attackRecords![0]!.attackSpeed).toBeCloseTo(expectedSpeed, 12);
  expect(result.continuous!.attackRecords![1]!.startAtMs).toBe(1396);
  expect(result.continuous!.attackRecords![0]!.readyAtMs).toBe(1396);
  expect(result.prepared.compileRequest.rules.attributeDerivations).toHaveLength(1);
});

test('4B页面范围必须显式确认，冻结假设且修改后标记结果过期', async ({ page }, testInfo) => {
  await installFixture(page, true);
  await chooseEquipment(page, '攻击方', 'item_3065');
  await chooseEquipment(page, '目标', 'item_3110');
  await readSnapshot(page);
  await page.getByRole('button', { name: '将缺失属性填写为0', exact: true }).click();
  await page.getByRole('button', { name: '双方以满生命开始', exact: true }).click();
  await page.getByRole('spinbutton', { name: '观察时长（毫秒）', exact: true }).fill('2000');
  await page.getByRole('spinbutton', { name: '攻速输入上界', exact: true }).fill('2');
  await page.getByRole('button', { name: '连续普攻', exact: true }).click();
  await expect(page.getByText('equipmentAssumptions.target.item_3110: 范围目标必须为另一方，且必须明确确认全程在范围内', { exact: true })).toBeVisible();
  const equipmentName = permanentEquipmentSimulationSample(['item_3065'], ['item_3110']).target.selectedEquipment[0]!.equipment.name;
  const confirmation = page.getByRole('checkbox', { name: `目标${equipmentName}全程在范围内`, exact: true });
  const confirmationLabel = page.getByText(`明确确认：目标${equipmentName}的唯一对手全程在作用范围内（不模拟进出范围或多来源叠加）`, { exact: true });
  await confirmationLabel.click();
  await expect(confirmation).toBeChecked();
  await page.getByRole('button', { name: '连续普攻', exact: true }).click();
  await expect(page.getByText('连续普攻已完成观察，目标未被击杀，会话正常释放。', { exact: true })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载连续运行档案', exact: true }).click();
  const archive = JSON.parse(readFileSync((await (await downloading).path())!, 'utf8'));
  expect(archive.equipmentAssumptions).toEqual([{ owner: 'target', equipmentKey: 'item_3110', target: 'source', inRange: true }]);
  expect(archive.runRequest.runtimeOptions.equipmentAssumptions).toEqual(archive.equipmentAssumptions);
  expect(archive.runResult.attackRecords[0].attackSpeed).toBeCloseTo(.651 * .8, 10);
  expect(archive.runResult.evidence.items.filter((item: { kind: string }) => item.kind === 'source_initialized')).toHaveLength(2);
  await testInfo.attach('4B页面冻结档案', { body: JSON.stringify(archive), contentType: 'application/json' });
  await confirmationLabel.click();
  await expect(confirmation).not.toBeChecked();
  await expect(page.getByText('输入已修改或正在重新计算；当前显示上一份冻结输入的结果。', { exact: true })).toBeVisible();
});

for (const combination of [
  { name: 'A振奋B冰心', source: ['item_3065'], target: ['item_3110'] },
  { name: '双方振奋', source: ['item_3065'], target: ['item_3065'] },
  { name: 'A冰心B振奋', source: ['item_3110'], target: ['item_3065'] }
]) test(`4B真实服务${combination.name}完整作者树经最终Wasm与Worker运行释放`, async ({ page }, testInfo) => {
  test.skip(process.env.SIMULATION_LIVE_API !== '1', '需要显式启用真实服务；跳过不算验收');
  const base = process.env.SIMULATION_LIVE_API_BASE_URL ?? 'http://127.0.0.1:8080';
  const token = process.env.SIMULATION_LIVE_ADMIN_TOKEN ?? '';
  await page.goto('/#/simulation/basic-attack');
  const data = await page.evaluate(async ({ base, token, combination }) => {
    const snapshotPath = '/tests/fixtures/simulationLiveSnapshot.ts';
    const adapterPath = '/src/engine/simulationAdapter.ts';
    const { getIsolatedSimulationSnapshot } = await import(snapshotPath) as typeof import('../fixtures/simulationLiveSnapshot');
    const { inspectSimulationSnapshot } = await import(adapterPath) as typeof import('../../src/engine/simulationAdapter');
    const snapshot = await getIsolatedSimulationSnapshot(base, 'lol', {
      sourceCharacterKey: 'champion_aatrox', sourceLevel: 1, targetCharacterKey: 'champion_ahri', targetLevel: 1,
      basicAttackSkillKey: 'shared_basic_attack', basicAttackLevel: 1, plannedSkills: [], sourceEquipmentKeys: combination.source, targetEquipmentKeys: combination.target,
      sourceBuildConfigurations: [], targetBuildConfigurations: [], sourceSkillSettings: [], targetSkillSettings: []
    }, token);
    const inputs: SimulationAttributeInputs = { source: {}, target: {} };
    for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) inputs[row.side][row.attribute.attributeKey] = 0;
    if (combination.source.includes('item_3065') && snapshot.source.selectedLevelValues.life_steal_percent === undefined) inputs.source.life_steal_percent = .1;
    const health = { source: snapshot.source.selectedLevelValues.hp!, target: snapshot.target.selectedLevelValues.hp! };
    for (const side of ['source', 'target'] as const) for (const item of snapshot[side].selectedEquipment) {
      if (side !== 'source' || !combination.source.includes('item_3065')) health[side] += item.attributes.attributeValues.hp ?? 0;
    }
    const assumptions: SimulationEquipmentAssumption[] = (['source', 'target'] as const)
      .filter(owner => snapshot.selection[`${owner}EquipmentKeys`].includes('item_3110'))
      .map(owner => ({ owner, equipmentKey: 'item_3110', target: owner === 'source' ? 'target' : 'source', inRange: true }));
    return { snapshot, inputs, health, assumptions };
  }, { base, token, combination });
  const result = await runActual(page, data.snapshot, data.inputs, data.health, testInfo, data.assumptions);
  const initialization = result.continuous!.evidence.items.filter(item => item.kind === 'source_initialized');
  expect(initialization).toHaveLength(2);
  for (const item of initialization) expect(item.data).toMatchObject({ eventSource: item.ref, currentTarget: item.ref, completed: true });
  const ratio = data.snapshot.skillConfigurations.find(row => row.skill.skillKey === 'item_3110_passive')?.parameters.find(row => row.parameterKey === 'attack_speed_reduction_ratio')?.fixedValue ?? 0;
  const speed = data.snapshot.source.selectedLevelValues.attack_speed! * (combination.target.includes('item_3110') ? 1 - ratio : 1);
  expect(result.continuous!.attackRecords![0]!.attackSpeed).toBeCloseTo(speed, 12);
  expect(result.continuous!.attackRecords![0]!.startAtMs).toBe(0);
  expect(result.continuous!.attackRecords![0]!.readyAtMs).toBe(Math.round(1000 / speed));
  if (combination.source.includes('item_3065')) {
    const receivedBonus = data.snapshot.skillConfigurations.find(row => row.skill.skillKey === 'item_3065_passive')!.parameters.find(row => row.parameterKey === 'heal_shield_power_bonus')!.fixedValue!;
    const steal = data.snapshot.source.selectedLevelValues.life_steal_percent ?? data.inputs.source.life_steal_percent!;
    expect(steal).toBeGreaterThan(0);
    for (const run of [result.single!, result.continuous!]) {
      expect(run.summary.sourceFinalHp).toBeCloseTo(data.health.source + run.summary.sourceDamageDealt! * steal * (1 + receivedBonus), 10);
    }
  }
  for (const side of ['source', 'target'] as const) if (combination[side].includes('item_3065')) {
    const actor = result.continuous!.finalSnapshot.combatants.find(row => row.key === side)!;
    const mounted = actor.providers.map(row => result.prepared.compileRequest.sharedProviders!.find(provider => provider.providerKey === row.definitionRef));
    expect(mounted.filter(provider => provider?.modifiers?.some(modifier => modifier.command === 'heal'))).toHaveLength(1);
    expect(mounted.filter(provider => provider?.modifiers?.some(modifier => modifier.command === 'shield'))).toHaveLength(1);
  }
});
