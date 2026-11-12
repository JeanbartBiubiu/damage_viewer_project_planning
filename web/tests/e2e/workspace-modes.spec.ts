import { fulfillAuthSession, openMaintenancePage } from '../fixtures/authSession';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { simulationSample } from '../fixtures/simulationSnapshot';
import { chooseSimulationEntity, chooseSimulationLevel, installSimulationSelectionApi } from '../fixtures/simulationSelection';
import { expectSimulationConfigurationReady, simulationSnapshotWithSelection } from '../fixtures/simulationSnapshotRequests';
import { simulationAvailabilityCatalog, simulationAvailabilitySample } from '../fixtures/simulationAvailability';
import { loadMechanismCases } from '../mechanisms/mechanismCase';
import { compareMechanismExpectation, projectMechanismResult } from '../mechanisms/mechanismRunner';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';
import type { AutomaticSkillArchive } from '../../src/pages/simulation/SimulationScenarioPanel';

// 只替换接口；普通模式用例不启动计算，末尾的混合战斗用例执行真实计算。
const API = 'http://127.0.0.1:19096';
const GAME_ID = 'workspace_demo';
const managementPaths = [
  'attributes', 'characters', 'equipment', 'builds', 'skill-categories', 'damage-types',
  'modifier-zones', 'skills', 'statuses', 'game-settings', 'images'
];

function respond(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body)
  });
}

async function installApi(page: Page) {
  const unexpected: string[] = [];
  const writes: string[] = [];
  const pageErrors: string[] = [];
  const workers: string[] = [];
  const wasmRequests: string[] = [];
  const anonymousReads: boolean[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('worker', worker => workers.push(worker.url()));
  page.on('request', request => {
    if (new URL(request.url()).pathname.endsWith('.wasm')) wasmRequests.push(request.url());
  });
  await page.addInitScript(({ api }) => {
  }, { api: API });
  await page.route('**/api/auth/me', route => fulfillAuthSession(route, false).then(() => undefined));
  await page.route('**/api/**', async route => {
    if (await fulfillAuthSession(route, false)) return;
    const request = route.request();
    const { pathname, origin } = new URL(request.url());
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: {
        'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
      } });
      return;
    }
    if (request.method() !== 'GET') {
      if (request.method() !== 'GET') writes.push(`${request.method()} ${pathname}`);
      unexpected.push(`${request.method()} ${pathname}`);
      await route.abort();
      return;
    }
    if (pathname === '/api/games') {
      await respond(route, [
        { gameId: GAME_ID, gameName: '工作模式测试', representativeImageKey: null },
        { gameId: 'other_workspace', gameName: '另一个测试游戏', representativeImageKey: null }
      ]);
      return;
    }
    const match = /^\/api\/admin\/games\/(workspace_demo|other_workspace)\/(.+)$/.exec(pathname);
    if (match) {
      anonymousReads.push(!request.headers().authorization && !request.headers().cookie && !request.headers()['x-csrf-token']);
      const [, gameId, resource] = match;
      if (resource === 'simulation-availability') {
        await respond(route, simulationAvailabilityCatalog(gameId!));
        return;
      }
      if (resource === 'calculation-rules') {
        await respond(route, { gameId, baseDigest: 'c'.repeat(64), configuration: null });
        return;
      }
      if (resource === 'level-config') {
        await respond(route, { gameId, minLevel: 1, maxLevel: 18 });
        return;
      }
      if (resource === 'vamp-rules') {
        await respond(route, { rules: [] });
        return;
      }
      if (resource === 'representative-image') {
        await respond(route, { image: null });
        return;
      }
      if (managementPaths.includes(resource!) || resource === 'build-systems') {
        await respond(route, { items: [], total: 0 });
        return;
      }
    }
    unexpected.push(`${request.method()} ${pathname}`);
    await route.abort();
  });
  return {
    assertClean(formulaPreflightOnly: boolean | 'runtime' = false) {
      expect(pageErrors, '页面异常').toEqual([]);
      expect(unexpected, '未定义接口请求').toEqual([]);
      expect(writes, '切模式不得写管理数据').toEqual([]);
      if (formulaPreflightOnly === 'runtime') {
        expect(workers.length, '页面准备与运行均使用真实线程').toBeGreaterThan(1);
        expect(workers.every(url => url.includes('genericEngineWorker'))).toBe(true);
        expect(wasmRequests, '每个线程读取正式分发产物').toHaveLength(workers.length);
      } else if (formulaPreflightOnly) {
        expect(workers, '读取完整作者配置只建立一次公式预检线程').toHaveLength(1);
        expect(workers[0]).toContain('genericEngineWorker');
        expect(wasmRequests, '公式预检使用实际产物').toHaveLength(1);
      } else {
        expect(workers, '切模式不得建立计算线程').toEqual([]);
        expect(wasmRequests, '切模式不得加载计算产物').toEqual([]);
      }
      expect(anonymousReads.every(Boolean), '游戏读取不附带凭据').toBe(true);
    }
  };
}

async function waitForGame(page: Page, gameId = GAME_ID) {
  await expect(page.locator('.app-toolbar-field--game .arco-select-view-value')).toContainText(gameId);
}

async function expectMode(page: Page, mode: 'management' | 'simulation') {
  await expect(page.getByRole('button', { name: '切换到数据管理', exact: true }))
    .toHaveAttribute('aria-pressed', String(mode === 'management'));
  await expect(page.getByRole('button', { name: '切换到计算模拟', exact: true }))
    .toHaveAttribute('aria-pressed', String(mode === 'simulation'));
  const paths = await page.locator('.nav-stack a').evaluateAll(links => links.map(link => link.getAttribute('href')));
  expect(paths).toEqual(mode === 'management'
    ? managementPaths.map(path => `#/${path}`)
    : ['#/simulation/basic-attack', '#/simulation/combat-analysis']);
  await expect(page.locator(`.nav-section[aria-label="${mode === 'management' ? '计算模拟' : '数据管理'}"]`))
    .toHaveCount(0);
}

async function expectAttributeDraft(page: Page, modal: Locator) {
  await expect(page).toHaveURL(/#\/attributes$/);
  await expectMode(page, 'management');
  await expect(modal).toBeVisible();
  await expect(modal.getByLabel('稳定标识', { exact: true })).toHaveValue('unsaved_mode_attribute');
  await expect(modal.getByLabel('属性名称', { exact: true })).toHaveValue('未保存模式属性');
}

async function handleLeave(page: Page, accept: boolean, action: () => Promise<unknown>) {
  const handled = page.waitForEvent('dialog').then(async dialog => {
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message()).toContain('当前修改尚未保存');
    if (accept) await dialog.accept();
    else await dialog.dismiss();
  });
  await action();
  await handled;
}

async function fillSimulationSelection(page: Page) {
  await chooseSimulationEntity(page, '攻击方角色', 'source_sample');
  await chooseSimulationLevel(page, '攻击方等级', 1);
  await chooseSimulationEntity(page, '目标角色', 'target_sample');
  await chooseSimulationLevel(page, '目标等级', 1);
  await chooseSimulationEntity(page, '普攻技能', 'shared_basic_attack');
  await chooseSimulationLevel(page, '普攻技能等级', 1);
}

test('根地址与未知完整路径回到管理，模拟直达和刷新保持完整路径与菜单', async ({ page }) => {
  const diagnostics = await installApi(page);
  for (const hash of ['', '#/', '#/simulation', '#/simulation/unknown', '#/characters/unexpected']) {
    await openMaintenancePage(page, `/${hash}`);
    await waitForGame(page);
    await expect(page).toHaveURL(/#\/attributes$/);
    await expectMode(page, 'management');
    await expect(page.getByRole('button', { name: '新增属性', exact: true })).toBeVisible();
  }
  for (const [path, title] of [['basic-attack', '普攻模拟'], ['combat-analysis', '混合战斗分析']]) {
    await openMaintenancePage(page, `/#/simulation/${path}`);
    await waitForGame(page);
    await expectMode(page, 'simulation');
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await page.reload();
    await waitForGame(page);
    await expect(page).toHaveURL(new RegExp(`#/simulation/${path}$`));
    await expectMode(page, 'simulation');
  }
  diagnostics.assertClean();
});

test('私有两工作模式共享所选游戏，切换不启动计算或写管理数据', async ({ page }) => {
  const diagnostics = await installApi(page);
  await openMaintenancePage(page, '/#/attributes');
  await waitForGame(page);
  await page.locator('.app-toolbar-field--game .arco-select').click();
  await page.locator('.arco-select-option:visible').filter({ hasText: 'other_workspace /' }).click();
  await waitForGame(page, 'other_workspace');
  await page.getByRole('button', { name: '切换到计算模拟', exact: true }).click();
  await expect(page).toHaveURL(/#\/simulation\/basic-attack$/);
  await expectMode(page, 'simulation');
  await expect(page.getByText('当前游戏：other_workspace', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '刷新维护会话', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '切换到数据管理', exact: true }).click();
  await expect(page).toHaveURL(/#\/attributes$/);
  await expectMode(page, 'management');
  await waitForGame(page, 'other_workspace');
  diagnostics.assertClean();
});

test('直接改地址、浏览器后退与前进按路由同步两种模式', async ({ page }) => {
  const diagnostics = await installApi(page);
  await openMaintenancePage(page, '/#/characters');
  await waitForGame(page);
  await expectMode(page, 'management');
  await page.getByRole('button', { name: '切换到计算模拟', exact: true }).click();
  await expect(page).toHaveURL(/#\/simulation\/basic-attack$/);
  await expectMode(page, 'simulation');
  await page.locator('.nav-stack').getByRole('link', { name: '混合战斗分析', exact: false }).click();
  await expect(page).toHaveURL(/#\/simulation\/combat-analysis$/);
  await expectMode(page, 'simulation');
  await page.goBack();
  await expect(page).toHaveURL(/#\/simulation\/basic-attack$/);
  await expectMode(page, 'simulation');
  await page.goBack();
  await expect(page).toHaveURL(/#\/characters$/);
  await expectMode(page, 'management');
  await page.goForward();
  await expect(page).toHaveURL(/#\/simulation\/basic-attack$/);
  await expectMode(page, 'simulation');
  await page.goForward();
  await expect(page).toHaveURL(/#\/simulation\/combat-analysis$/);
  await expectMode(page, 'simulation');
  await page.evaluate(() => { window.location.hash = '#/game-settings'; });
  await expect(page).toHaveURL(/#\/game-settings$/);
  await expectMode(page, 'management');
  diagnostics.assertClean();
});

test('真实游戏配置草稿拒绝切模式保留地址菜单与数值，确认后才切换', async ({ page }) => {
  const diagnostics = await installApi(page);
  await openMaintenancePage(page, '/#/game-settings');
  await waitForGame(page);
  const maximum = page.getByRole('spinbutton', { name: '最大等级', exact: true });
  await expect(maximum).toHaveValue('18');
  await maximum.fill('20');
  await handleLeave(page, false, () => page.getByRole('button', { name: '切换到计算模拟', exact: true }).click());
  await expect(page).toHaveURL(/#\/game-settings$/);
  await expectMode(page, 'management');
  await expect(maximum).toHaveValue('20');
  await handleLeave(page, true, () => page.getByRole('button', { name: '切换到计算模拟', exact: true }).click());
  await expect(page).toHaveURL(/#\/simulation\/basic-attack$/);
  await expectMode(page, 'simulation');
  await expect(maximum).toHaveCount(0);
  await page.getByRole('button', { name: '切换到数据管理', exact: true }).click();
  await page.getByRole('link', { name: '游戏配置', exact: false }).click();
  await expect(maximum).toHaveValue('18');
  diagnostics.assertClean();
});

test('真实属性弹窗草稿拒绝直接模拟地址与未知地址后保留，确认可离开', async ({ page }) => {
  const diagnostics = await installApi(page);
  await openMaintenancePage(page, '/#/attributes');
  await waitForGame(page);
  await page.getByRole('button', { name: '新增属性', exact: true }).click();
  const modal = page.getByRole('dialog').filter({ hasText: '新增属性' });
  await modal.getByLabel('稳定标识', { exact: true }).fill('unsaved_mode_attribute');
  await modal.getByLabel('属性名称', { exact: true }).fill('未保存模式属性');
  for (const hash of ['#/simulation/basic-attack', '#/simulation/combat-analysis', '#/simulation/unknown']) {
    await handleLeave(page, false, () => page.evaluate(value => { window.location.hash = value; }, hash));
    await expectAttributeDraft(page, modal);
  }
  await handleLeave(page, true, () => page.evaluate(() => { window.location.hash = '#/simulation/basic-attack'; }));
  await expect(page).toHaveURL(/#\/simulation\/basic-attack$/);
  await expectMode(page, 'simulation');
  await expect(modal).toHaveCount(0);
  diagnostics.assertClean();
});

test('原页只保留普攻与固定计划，自动入口进入独立页面且页面状态不互相继承', async ({ page }) => {
  const diagnostics = await installApi(page);
  await openMaintenancePage(page, '/#/simulation/basic-attack');
  await waitForGame(page);
  await expect(page.getByRole('checkbox', { name: '指定技能行动计划', exact: true }).locator('xpath=ancestor::label')).toBeVisible();
  await expect(page.getByRole('button', { name: '添加自动技能', exact: true })).toHaveCount(0);
  const automatic = page.getByRole('link', { name: '进入混合战斗分析（自动循环）', exact: true });
  await expect(automatic).toHaveAttribute('href', '#/simulation/combat-analysis');
  await automatic.click();
  await expect(page).toHaveURL(/#\/simulation\/combat-analysis$/);
  await expectMode(page, 'simulation');
  await expect(page.getByRole('checkbox', { name: '指定技能行动计划', exact: true })).toHaveCount(0);
  await expect(page.getByRole('form', { name: '混合战斗场景选择', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '添加自动技能', exact: true })).toHaveCount(0);
  await expect(page.locator('.simulation-entity-select[aria-label="普攻技能"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '准备计算', exact: true })).toBeDisabled();
  await page.getByRole('link', { name: '普攻模拟', exact: false }).click();
  await expect(page).toHaveURL(/#\/simulation\/basic-attack$/);
  await expect(page.getByRole('checkbox', { name: '指定技能行动计划', exact: true })).not.toBeChecked();
  await expect(page.getByRole('region', { name: '自动技能结果', exact: true })).toHaveCount(0);
  diagnostics.assertClean();
});

test('真实草稿反复取消历史后退与前进后仍能确认离开', async ({ page }) => {
  const diagnostics = await installApi(page);
  await openMaintenancePage(page, '/#/simulation/basic-attack');
  await waitForGame(page);
  await page.evaluate(() => { window.location.hash = '#/game-settings'; });
  const maximum = page.getByRole('spinbutton', { name: '最大等级', exact: true });
  await expect(maximum).toHaveValue('18');
  await page.evaluate(() => {
    window.history.replaceState({ ...window.history.state, fixtureMarker: 'preserve' }, '', window.location.href);
  });
  await maximum.fill('20');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await handleLeave(page, false, () => page.goBack());
    await expect(page).toHaveURL(/#\/game-settings$/);
    await expectMode(page, 'management');
    await expect(maximum).toHaveValue('20');
    expect(await page.evaluate(() => window.history.state.fixtureMarker)).toBe('preserve');
  }
  const confirmation = page.waitForEvent('dialog', { timeout: 3_000 }).then(async dialog => {
    expect(dialog.message()).toContain('当前修改尚未保存');
    await dialog.accept();
  });
  await page.goBack();
  await confirmation;
  await expect(page).toHaveURL(/#\/simulation\/basic-attack$/);
  await expectMode(page, 'simulation');
  await page.goForward();
  await expect(page).toHaveURL(/#\/game-settings$/);
  await expectMode(page, 'management');
  await expect(maximum).toHaveValue('18');
  await page.getByRole('button', { name: '切换到计算模拟', exact: true }).click();
  await expect(page).toHaveURL(/#\/simulation\/basic-attack$/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/game-settings$/);
  await expect(maximum).toHaveValue('18');
  await maximum.fill('20');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await handleLeave(page, false, () => page.goForward());
    await expect(page).toHaveURL(/#\/game-settings$/);
    await expectMode(page, 'management');
    await expect(maximum).toHaveValue('20');
  }
  await handleLeave(page, true, () => page.goForward());
  await expect(page).toHaveURL(/#\/simulation\/basic-attack$/);
  await expectMode(page, 'simulation');
  await page.goBack();
  await expect(page).toHaveURL(/#\/game-settings$/);
  await expect(maximum).toHaveValue('18');
  diagnostics.assertClean();
});

test('窄屏导航关闭时总切换常驻，切模式后只展开对应菜单', async ({ page }) => {
  const diagnostics = await installApi(page);
  await page.setViewportSize({ width: 820, height: 900 });
  await openMaintenancePage(page, '/#/attributes');
  await waitForGame(page);
  const navigation = page.getByRole('region', { name: '主导航', exact: true });
  const menu = page.getByRole('button', { name: '主导航', exact: true });
  await expect(navigation).toBeHidden();
  await expect(page.getByRole('button', { name: '切换到数据管理', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '切换到计算模拟', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '切换到计算模拟', exact: true }).click();
  await expectMode(page, 'simulation');
  await expect(navigation).toBeHidden();
  await menu.click();
  await expect(navigation).toBeVisible();
  await page.getByRole('link', { name: '普攻模拟', exact: false }).click();
  await expect(navigation).toBeHidden();
  await menu.click();
  await page.getByRole('button', { name: '切换到数据管理', exact: true }).click();
  await expectMode(page, 'management');
  await expect(navigation).toBeHidden();
  diagnostics.assertClean();
});

test('场景读取中拒绝离开保留输入，确认离开后迟到错误不会回流', async ({ page }) => {
  const diagnostics = await installApi(page);
  await installSimulationSelectionApi(page, API, GAME_ID);
  let allowResponse!: () => void;
  let responseFinished!: () => void;
  const responseGate = new Promise<void>(resolve => { allowResponse = resolve; });
  const settledResponse = new Promise<void>(resolve => { responseFinished = resolve; });
  let reads = 0;
  await page.route('**/simulation-snapshot', async route => {
    if (await fulfillAuthSession(route, false)) return;
    reads += 1;
    await responseGate;
    try {
      await route.fulfill({ status: 500, json: { error: { code: 'LATE_READ', message: '旧场景迟到读取错误' } } });
    } catch { /* 浏览器已经取消这次读取。 */ }
    finally { responseFinished(); }
  });
  await openMaintenancePage(page, '/#/simulation/basic-attack');
  await waitForGame(page);
  await fillSimulationSelection(page);
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  await expect.poll(() => reads).toBe(1);
  await expect(page.getByText('正在读取场景快照', { exact: true })).toBeVisible();
  const rejected = page.waitForEvent('dialog').then(async dialog => {
    expect(dialog.message()).toContain('当前计算尚未完成');
    expect(dialog.message()).toContain('终止本次计算');
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: '切换到数据管理', exact: true }).click();
  await rejected;
  await expectMode(page, 'simulation');
  await expect(page).toHaveURL(/#\/simulation\/basic-attack$/);
  await expect(page.locator('.simulation-entity-select[aria-label="攻击方角色"]')).toContainText('攻击方角色');
  await expect(page.locator('.simulation-entity-select[aria-label="攻击方角色"] input')).toBeDisabled();
  const accepted = page.waitForEvent('dialog').then(dialog => dialog.accept());
  await page.getByRole('button', { name: '切换到数据管理', exact: true }).click();
  await accepted;
  await expect(page).toHaveURL(/#\/attributes$/);
  await expectMode(page, 'management');
  allowResponse();
  await settledResponse;
  await expect(page.getByText(/旧场景迟到读取错误/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新增属性', exact: true })).toBeVisible();
  diagnostics.assertClean();
});

test('取消读取后可重新请求，旧请求结束不会清除新请求忙碌状态', async ({ page }) => {
  const diagnostics = await installApi(page);
  await installSimulationSelectionApi(page, API, GAME_ID);
  const gates: Array<() => void> = [];
  const settled: Array<Promise<void>> = [];
  await page.route('**/simulation-snapshot', async route => {
    if (await fulfillAuthSession(route, false)) return;
    const index = gates.length;
    let finish!: () => void;
    settled.push(new Promise<void>(resolve => { finish = resolve; }));
    const responseGate = new Promise<void>(resolve => { gates.push(resolve); });
    await responseGate;
    try {
      await route.fulfill({ status: 500, json: { error: {
        code: index === 0 ? 'OLD_READ' : 'CURRENT_READ',
        message: index === 0 ? '已经取消的旧读取错误' : '当前场景读取失败'
      } } });
    } catch { /* 被取消的请求可能已经断开。 */ }
    finally { finish(); }
  });
  await openMaintenancePage(page, '/#/simulation/basic-attack');
  await waitForGame(page);
  await fillSimulationSelection(page);
  const read = page.getByRole('button', { name: '读取场景快照', exact: true });
  await read.click();
  await expect.poll(() => gates.length).toBe(1);
  await page.getByRole('button', { name: '取消当前请求', exact: true }).click();
  await expect(page.getByText('当前场景读取已取消，保留已有输入。', { exact: true })).toBeVisible();
  await expect(read).toBeEnabled();
  await read.click();
  await expect.poll(() => gates.length).toBe(2);
  gates[0]!();
  await settled[0];
  await expect(read).toBeDisabled();
  await expect(page.getByText('正在读取场景快照', { exact: true })).toBeVisible();
  await expect(page.getByText(/已经取消的旧读取错误/)).toHaveCount(0);
  gates[1]!();
  await settled[1];
  await expect(page.getByText(/当前场景读取失败/)).toBeVisible();
  await expect(read).toBeEnabled();
  await expect(page.locator('.simulation-entity-select[aria-label="攻击方角色"]')).toContainText('攻击方角色');
  await expect(page.getByText(/仅编译验证通过/)).toHaveCount(0);
  diagnostics.assertClean();
});

test('初始当前生命保持未填写与0区别，明确点击才使用快照生命上限', async ({ page }) => {
  const diagnostics = await installApi(page);
  const snapshot = simulationSample();
  await page.addInitScript(() => {
    const scope = window as typeof window & { healthPreflightMessages: Array<{ type: string; rulesHash: string | null }> };
    scope.healthPreflightMessages = [];
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, ...options) {
      if (message && typeof message === 'object' && ['compile', 'run', 'release'].includes(message.type)) {
        scope.healthPreflightMessages.push({ type: message.type, rulesHash: message.request?.rulesHash ?? message.expectedRulesHash ?? null });
      }
      return Reflect.apply(original, this, [message, ...options]);
    };
  });
  await installSimulationSelectionApi(page, API, snapshot.gameId);
  await page.route(`**/api/games`, route => respond(route, [
    { gameId: snapshot.gameId, gameName: '明确生命输入测试', representativeImageKey: null }
  ]));
  await page.route('**/simulation-snapshot', route => {
    expect(route.request().method()).toBe('POST');
    return respond(route, simulationSnapshotWithSelection(snapshot, route.request().postDataJSON()));
  });
  await openMaintenancePage(page, '/#/simulation/basic-attack');
  await waitForGame(page, snapshot.gameId);
  await chooseSimulationEntity(page, '攻击方角色', snapshot.selection.sourceCharacterKey);
  await chooseSimulationLevel(page, '攻击方等级', snapshot.selection.sourceLevel);
  await chooseSimulationEntity(page, '目标角色', snapshot.selection.targetCharacterKey);
  await chooseSimulationLevel(page, '目标等级', snapshot.selection.targetLevel);
  await chooseSimulationEntity(page, '普攻技能', snapshot.selection.basicAttackSkillKey!);
  await chooseSimulationLevel(page, '普攻技能等级', snapshot.selection.basicAttackLevel!);
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  const sourceHealth = page.getByRole('spinbutton', { name: '攻击方初始当前生命', exact: true });
  await expectSimulationConfigurationReady(page);
  const targetHealth = page.getByRole('spinbutton', { name: '目标初始当前生命', exact: true });
  const compile = page.getByRole('button', { name: '编译验证', exact: true });
  await expect(sourceHealth).toHaveValue('');
  await expect(targetHealth).toHaveValue('');
  await page.getByRole('button', { name: '将缺失属性填写为0', exact: true }).click();
  await expect(sourceHealth).toHaveValue('');
  await expect(targetHealth).toHaveValue('');
  await expect(compile).toBeDisabled();
  await sourceHealth.fill('0');
  await targetHealth.fill('0');
  await expect(sourceHealth).toHaveValue('0');
  await expect(targetHealth).toHaveValue('0');
  await expect(compile).toBeEnabled();
  await page.getByRole('button', { name: '双方以满生命开始', exact: true }).click();
  await expect(sourceHealth).toHaveValue(String(snapshot.source.selectedLevelValues.hp));
  await expect(targetHealth).toHaveValue(String(snapshot.target.selectedLevelValues.hp));
  await sourceHealth.fill('');
  await expect(compile).toBeDisabled();
  await expect(page.getByLabel('攻击方补充属性 hp', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('目标补充属性 hp', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as typeof window & {
    healthPreflightMessages: Array<{ type: string; rulesHash: string | null }>
  }).healthPreflightMessages), '仅共同公式预检，不提交最终场景编译或运行').toEqual([
    { type: 'compile', rulesHash: 'skill-formula-preflight' }, { type: 'release', rulesHash: 'skill-formula-preflight' }
  ]);
  diagnostics.assertClean(true);
});

type RuntimeObservation = {
  sent: Array<{ worker: number; type: string; sessionId: string | null; rulesHash: string | null }>;
  released: Array<{ worker: number; sessionId: string; ok: boolean; released: boolean }>;
  terminated: number[];
};

test('混合战斗完整页面：普攻与主动共用时钟，真实编译运行后正常释放', async ({ page }, testInfo) => {
  // 固定机制已有独立手算：两次100真伤和六次10普攻，总额260，目标余血9740。
  const definition = loadMechanismCases().find(row => row.caseKey === 'schedule_basic_attack_reduces_cooldown')!;
  const snapshot = definition.buildSnapshot();
  const wasm = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  expect(createHash('sha256').update(wasm).digest('hex')).toBe(WASM_IDENTITY.sha256);
  expect(wasm.length).toBe(WASM_IDENTITY.bytes);
  const diagnostics = await installApi(page);
  await page.addInitScript(() => {
    const scope = window as typeof window & { combatRuntimeObservation: RuntimeObservation };
    const state: RuntimeObservation = { sent: [], released: [], terminated: [] };
    scope.combatRuntimeObservation = state;
    const workers = new WeakMap<Worker, number>();
    let nextWorker = 0;
    const postMessage = Worker.prototype.postMessage;
    const terminate = Worker.prototype.terminate;
    // 透明记录真实消息与释放帧，所有请求继续由原生线程处理。
    Worker.prototype.postMessage = function(message, ...options) {
      if (!workers.has(this)) {
        const worker = nextWorker++;
        workers.set(this, worker);
        this.addEventListener('message', event => {
          if (event.data.type !== 'releaseResult') return;
          for (const frame of event.data.frames as Array<{ kind: number; payload: ArrayBuffer }>) {
            if (frame.kind === 214) state.released.push({ worker,
              ...JSON.parse(new TextDecoder().decode(frame.payload)) as { sessionId: string; ok: boolean; released: boolean } });
          }
        });
      }
      state.sent.push({ worker: workers.get(this)!, type: message.type,
        sessionId: message.sessionId ?? message.request?.sessionId ?? null,
        rulesHash: message.request?.rulesHash ?? message.expectedRulesHash ?? null });
      return Reflect.apply(postMessage, this, [message, ...options]);
    };
    Worker.prototype.terminate = function() {
      state.terminated.push(workers.get(this)!);
      return Reflect.apply(terminate, this, []);
    };
  });
  await installSimulationSelectionApi(page, API, snapshot.gameId, snapshot);
  await page.route(`**/api/games`, route => respond(route, [
    { gameId: snapshot.gameId, gameName: '合成混合战斗验收', representativeImageKey: null }
  ]));
  await page.route(`**/api/admin/games/${snapshot.gameId}/simulation-availability?**`, route =>
    respond(route, simulationAvailabilitySample(snapshot)));
  await page.route(`**/api/admin/games/${snapshot.gameId}/character-skill-relations?**`, route => {
    const characterKey = new URL(route.request().url()).searchParams.get('characterKey');
    const actor = [snapshot.source, snapshot.target].find(row => row.character.characterKey === characterKey)!;
    return respond(route, { items: actor.attachedSkills, total: actor.attachedSkills.length });
  });
  await page.route(`**/api/admin/games/${snapshot.gameId}/skills/*/configuration`, route => {
    const skillKey = new URL(route.request().url()).pathname.split('/').at(-2);
    return respond(route, snapshot.skillConfigurations.find(row => row.skill.skillKey === skillKey)!);
  });
  await page.route('**/simulation-snapshot', route => {
    expect(route.request().method()).toBe('POST');
    return respond(route, simulationSnapshotWithSelection(snapshot, route.request().postDataJSON()));
  });

  await openMaintenancePage(page, '/#/simulation/combat-analysis');
  await waitForGame(page, snapshot.gameId);
  await chooseSimulationEntity(page, '攻击方角色', snapshot.selection.sourceCharacterKey);
  await chooseSimulationLevel(page, '攻击方等级', snapshot.selection.sourceLevel);
  await chooseSimulationEntity(page, '目标角色', snapshot.selection.targetCharacterKey);
  await chooseSimulationLevel(page, '目标等级', snapshot.selection.targetLevel);
  await expect(page.getByRole('group', { name: '攻击方技能 lab_true_strike', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '准备计算', exact: true }).click();
  await expectSimulationConfigurationReady(page);
  await page.getByRole('spinbutton', { name: '攻击方初始当前生命', exact: true }).fill('1000');
  await page.getByRole('spinbutton', { name: '目标初始当前生命', exact: true }).fill('10000');
  await page.getByRole('spinbutton', { name: '观察时长（毫秒）', exact: true }).fill('5500');
  await page.getByRole('spinbutton', { name: '攻速输入上界', exact: true }).fill('10');
  await page.getByText('调试详情：编译请求、原始结果与引用覆盖', { exact: true }).click();
  await page.getByRole('button', { name: '编译验证', exact: true }).click();
  await expect(page.getByText('仅编译验证通过，不代表单次/连续计算通过。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '开始计算', exact: true }).click();
  await expect(page.getByText('自动循环观察完成，会话已释放；完整累计、最后等待与资格账本已核对。', { exact: true })).toBeVisible();
  const result = page.getByRole('region', { name: '自动技能结果', exact: true });
  await expect(result).toContainText('观察完整核对；会话已释放');
  await expect(result).toContainText('背景普攻实际开始6，命中6，完整6');

  const download = page.waitForEvent('download');
  await result.getByRole('button', { name: '下载自动冻结档案', exact: true }).click();
  const archive = JSON.parse(readFileSync((await (await download).path())!, 'utf8')) as AutomaticSkillArchive;
  expect(archive).toMatchObject({ taskKind: 'automatic_skill', outcome: 'passed', cleanup: 'released', assessment: { complete: true } });
  expect(archive.releaseResult).toMatchObject({ ok: true, released: true, sessionId: archive.runRequest!.sessionId });
  const projection = projectMechanismResult(archive.operationOrigins, archive.compileRequest, archive.runRequest!, archive.runResult!);
  expect(compareMechanismExpectation(projection, definition.expected), '下载的真实逐笔结果与手算机制期望一致').toEqual([]);
  const observation = await page.evaluate(() => (window as typeof window & { combatRuntimeObservation: RuntimeObservation }).combatRuntimeObservation);
  const run = observation.sent.filter(row => row.type === 'run');
  expect(run).toHaveLength(1);
  expect(observation.sent).toContainEqual({ worker: run[0]!.worker, type: 'release', sessionId: archive.runRequest!.sessionId,
    rulesHash: archive.compileRequest.rulesHash });
  expect(observation.released).toContainEqual({ worker: run[0]!.worker, sessionId: archive.runRequest!.sessionId, ok: true, released: true });
  await page.getByRole('link', { name: '普攻模拟', exact: false }).click();
  await expect(page).toHaveURL(/#\/simulation\/basic-attack$/);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { combatRuntimeObservation: RuntimeObservation }).combatRuntimeObservation.terminated))
    .toContain(run[0]!.worker);
  const afterLeave = await page.evaluate(() => (window as typeof window & { combatRuntimeObservation: RuntimeObservation }).combatRuntimeObservation);
  expect(afterLeave.terminated).toContain(run[0]!.worker);
  await testInfo.attach('混合页面真实运行及会话清理', { body: JSON.stringify({ archive, observation: afterLeave }), contentType: 'application/json' });
  diagnostics.assertClean('runtime');
});
