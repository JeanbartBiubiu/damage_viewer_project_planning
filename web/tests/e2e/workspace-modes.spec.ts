import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { simulationSample } from '../fixtures/simulationSnapshot';
import { chooseSimulationEntity, installSimulationSelectionApi } from '../fixtures/simulationSelection';

// 操作真实管理组件，只替换 HTTP；本专项不作为实库或计算运行证据。
const API = 'http://127.0.0.1:19096';
const GAME_ID = 'workspace_demo';
const TOKEN = 'workspace-mode-fixture';
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
  const authenticatedReads: boolean[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('worker', worker => workers.push(worker.url()));
  page.on('request', request => {
    if (new URL(request.url()).pathname.endsWith('.wasm')) wasmRequests.push(request.url());
  });
  await page.addInitScript(({ api, token }) => {
    localStorage.setItem('damage-viewer.web.api-base-url', api);
    localStorage.setItem('damage-viewer.web.admin-token', token);
  }, { api: API, token: TOKEN });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const { pathname, origin } = new URL(request.url());
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: {
        'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
      } });
      return;
    }
    if (origin !== API || request.method() !== 'GET') {
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
      authenticatedReads.push(request.headers().authorization === `Bearer ${TOKEN}`);
      const [, gameId, resource] = match;
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
    assertClean() {
      expect(pageErrors, '页面异常').toEqual([]);
      expect(unexpected, '未定义接口请求').toEqual([]);
      expect(writes, '切模式不得写管理数据').toEqual([]);
      expect(workers, '切模式不得建立计算线程').toEqual([]);
      expect(wasmRequests, '切模式不得加载计算产物').toEqual([]);
      expect(authenticatedReads.every(Boolean), '管理只读接口保持鉴权').toBe(true);
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
    : ['#/simulation/basic-attack']);
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
  await page.getByRole('spinbutton', { name: '攻击方等级', exact: true }).fill('1');
  await chooseSimulationEntity(page, '目标角色', 'target_sample');
  await page.getByRole('spinbutton', { name: '目标等级', exact: true }).fill('1');
  await chooseSimulationEntity(page, '普攻技能', 'shared_basic_attack');
  await page.getByRole('spinbutton', { name: '普攻技能等级', exact: true }).fill('1');
}

test('根地址与未知完整路径回到管理，模拟直达和刷新保持完整路径与菜单', async ({ page }) => {
  const diagnostics = await installApi(page);
  for (const hash of ['', '#/', '#/simulation', '#/simulation/unknown', '#/characters/unexpected']) {
    await page.goto(`/${hash}`);
    await waitForGame(page);
    await expect(page).toHaveURL(/#\/attributes$/);
    await expectMode(page, 'management');
    await expect(page.getByRole('button', { name: '新增属性', exact: true })).toBeVisible();
  }
  await page.goto('/#/simulation/basic-attack');
  await waitForGame(page);
  await expectMode(page, 'simulation');
  await expect(page.getByRole('heading', { name: '普攻模拟', exact: true })).toBeVisible();
  await page.reload();
  await waitForGame(page);
  await expect(page).toHaveURL(/#\/simulation\/basic-attack$/);
  await expectMode(page, 'simulation');
  diagnostics.assertClean();
});

test('两模式共享连接、所选游戏与本地令牌，切换不启动计算或写管理数据', async ({ page }) => {
  const diagnostics = await installApi(page);
  await page.goto('/#/attributes');
  await waitForGame(page);
  await page.locator('.app-toolbar-field--game .arco-select').click();
  await page.locator('.arco-select-option:visible').filter({ hasText: 'other_workspace /' }).click();
  await waitForGame(page, 'other_workspace');
  await page.getByRole('button', { name: '切换到计算模拟', exact: true }).click();
  await expect(page).toHaveURL(/#\/simulation\/basic-attack$/);
  await expectMode(page, 'simulation');
  await expect(page.getByText('当前游戏：other_workspace', { exact: true })).toBeVisible();
  await expect(page.locator('.app-toolbar-field--api input')).toHaveValue(API);
  await expect(page.locator('.app-toolbar-field--token input')).toHaveValue(TOKEN);
  await page.getByRole('button', { name: '切换到数据管理', exact: true }).click();
  await expect(page).toHaveURL(/#\/attributes$/);
  await expectMode(page, 'management');
  await waitForGame(page, 'other_workspace');
  diagnostics.assertClean();
});

test('直接改地址、浏览器后退与前进按路由同步两种模式', async ({ page }) => {
  const diagnostics = await installApi(page);
  await page.goto('/#/characters');
  await waitForGame(page);
  await expectMode(page, 'management');
  await page.getByRole('button', { name: '切换到计算模拟', exact: true }).click();
  await expect(page).toHaveURL(/#\/simulation\/basic-attack$/);
  await expectMode(page, 'simulation');
  await page.goBack();
  await expect(page).toHaveURL(/#\/characters$/);
  await expectMode(page, 'management');
  await page.goForward();
  await expect(page).toHaveURL(/#\/simulation\/basic-attack$/);
  await expectMode(page, 'simulation');
  await page.evaluate(() => { window.location.hash = '#/game-settings'; });
  await expect(page).toHaveURL(/#\/game-settings$/);
  await expectMode(page, 'management');
  diagnostics.assertClean();
});

test('真实游戏配置草稿拒绝切模式保留地址菜单与数值，确认后才切换', async ({ page }) => {
  const diagnostics = await installApi(page);
  await page.goto('/#/game-settings');
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
  await page.goto('/#/attributes');
  await waitForGame(page);
  await page.getByRole('button', { name: '新增属性', exact: true }).click();
  const modal = page.getByRole('dialog').filter({ hasText: '新增属性' });
  await modal.getByLabel('稳定标识', { exact: true }).fill('unsaved_mode_attribute');
  await modal.getByLabel('属性名称', { exact: true }).fill('未保存模式属性');
  for (const hash of ['#/simulation/basic-attack', '#/simulation/unknown']) {
    await handleLeave(page, false, () => page.evaluate(value => { window.location.hash = value; }, hash));
    await expectAttributeDraft(page, modal);
  }
  await handleLeave(page, true, () => page.evaluate(() => { window.location.hash = '#/simulation/basic-attack'; }));
  await expect(page).toHaveURL(/#\/simulation\/basic-attack$/);
  await expectMode(page, 'simulation');
  await expect(modal).toHaveCount(0);
  diagnostics.assertClean();
});

test('真实草稿反复取消历史后退与前进后仍能确认离开', async ({ page }) => {
  const diagnostics = await installApi(page);
  await page.goto('/#/simulation/basic-attack');
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
  await page.goto('/#/attributes');
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
  await page.route('**/simulation-snapshot?**', async route => {
    reads += 1;
    await responseGate;
    try {
      await route.fulfill({ status: 500, json: { error: { code: 'LATE_READ', message: '旧场景迟到读取错误' } } });
    } catch { /* 浏览器已经取消这次读取。 */ }
    finally { responseFinished(); }
  });
  await page.goto('/#/simulation/basic-attack');
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
  await page.route('**/simulation-snapshot?**', async route => {
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
  await page.goto('/#/simulation/basic-attack');
  await waitForGame(page);
  await fillSimulationSelection(page);
  const read = page.getByRole('button', { name: '读取场景快照', exact: true });
  await read.click();
  await expect.poll(() => gates.length).toBe(1);
  await page.getByRole('button', { name: '取消当前请求', exact: true }).click();
  await expect(page.getByText('当前任务已取消，未完成编译验证。', { exact: true })).toBeVisible();
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
  await installSimulationSelectionApi(page, API, snapshot.gameId);
  await page.route(`${API}/api/games`, route => respond(route, [
    { gameId: snapshot.gameId, gameName: '明确生命输入测试', representativeImageKey: null }
  ]));
  await page.route('**/simulation-snapshot?**', route => respond(route, snapshot));
  await page.goto('/#/simulation/basic-attack');
  await waitForGame(page, snapshot.gameId);
  await chooseSimulationEntity(page, '攻击方角色', snapshot.selection.sourceCharacterKey);
  await page.getByRole('spinbutton', { name: '攻击方等级', exact: true }).fill(String(snapshot.selection.sourceLevel));
  await chooseSimulationEntity(page, '目标角色', snapshot.selection.targetCharacterKey);
  await page.getByRole('spinbutton', { name: '目标等级', exact: true }).fill(String(snapshot.selection.targetLevel));
  await chooseSimulationEntity(page, '普攻技能', snapshot.selection.basicAttackSkillKey);
  await page.getByRole('spinbutton', { name: '普攻技能等级', exact: true }).fill(String(snapshot.selection.basicAttackLevel));
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  const sourceHealth = page.getByRole('spinbutton', { name: '攻击方初始当前生命', exact: true });
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
  diagnostics.assertClean();
});
