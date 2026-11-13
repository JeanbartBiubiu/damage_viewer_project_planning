import { expect, test, type Page } from '@playwright/test';
import { installSimulationSelectionApi } from '../fixtures/simulationSelection';

async function installNavigationApi(page: Page, baseURL: string) {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/visits') return route.fulfill({ status: 204 });
    if (path === '/api/games') return route.fulfill({ json: [{ gameId: 'demo', gameName: '隔离测试游戏', representativeImageKey: null }] });
    return route.fulfill({ json: { items: [], total: 0 } });
  });
  await page.route('**/internal/maintenance/me', route => route.fulfill({ status: 401, json: {
    error: { code: 'MAINTENANCE.SESSION_REQUIRED', message: '需要维护会话' }
  } }));
  await installSimulationSelectionApi(page, baseURL, 'demo');
}

test('键盘可跳过导航，游戏选择器与当前页面具有可访问名称', async ({ page, baseURL }, info) => {
  if (!baseURL) throw new Error('部署模式验收需要预览地址');
  await installNavigationApi(page, baseURL);
  const viewer = info.project.name === 'viewer';
  const firstTitle = viewer ? '混合战斗分析' : '属性管理';
  const firstHash = viewer ? '#/simulation/combat-analysis' : '#/attributes';
  await page.goto(`/${firstHash}`);
  await expect(page.getByRole('main').getByRole('heading', { name: firstTitle, exact: true })).toBeVisible();
  await expect(page).toHaveTitle(new RegExp(`^${firstTitle} \\| Damage Viewer`));
  await expect(page.getByRole('combobox', { name: '游戏', exact: true })).toBeVisible();
  const firstLink = page.getByRole('link', { name: new RegExp(`^${firstTitle}`) });
  await expect(firstLink).toHaveAttribute('aria-current', 'page');

  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: '跳到主要内容', exact: true });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main').getByRole('heading', { name: firstTitle, exact: true })).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`${firstHash}$`));

  const nextTitle = viewer ? '普攻模拟' : '角色管理';
  await page.getByRole('link', { name: new RegExp(`^${nextTitle}`) }).click();
  await expect(page.getByRole('main').getByRole('heading', { name: nextTitle, exact: true })).toBeVisible();
  await expect(page).toHaveTitle(new RegExp(`^${nextTitle} \\| Damage Viewer`));
  await expect(firstLink).not.toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: new RegExp(`^${nextTitle}`) })).toHaveAttribute('aria-current', 'page');
});

test('页面分块加载中保留导航，失败可切页并通过刷新恢复', async ({ page, baseURL }, info) => {
  if (!baseURL) throw new Error('部署模式验收需要预览地址');
  await installNavigationApi(page, baseURL);
  const viewer = info.project.name === 'viewer';
  const firstTitle = viewer ? '混合战斗分析' : '属性管理';
  const nextTitle = viewer ? '普攻模拟' : '角色管理';
  await page.goto(viewer ? '/#/simulation/combat-analysis' : '/#/attributes');
  await expect(page.getByRole('main').getByRole('heading', { name: firstTitle, exact: true })).toBeVisible();

  let releaseChunk = () => {};
  const blocked = new Promise<void>(resolve => { releaseChunk = resolve; });
  await page.route('**/assets/**', async route => {
    if (route.request().resourceType() !== 'script') return route.continue();
    await blocked;
    return route.abort('failed');
  });
  try {
    await page.getByRole('link', { name: new RegExp(`^${nextTitle}`) }).click();
    await expect(page.getByRole('progressbar', { name: '正在加载页面' })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(`^${firstTitle}`) })).toBeVisible();
    releaseChunk();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('页面加载失败');
  } finally {
    releaseChunk();
    await page.unroute('**/assets/**');
  }

  await page.getByRole('link', { name: new RegExp(`^${firstTitle}`) }).click();
  await expect(page.getByRole('main').getByRole('heading', { name: firstTitle, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '刷新页面', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: new RegExp(`^${nextTitle}`) }).click();
  await page.getByRole('button', { name: '刷新页面', exact: true }).click();
  await expect(page.getByRole('main').getByRole('heading', { name: nextTitle, exact: true })).toBeVisible();
});

test('部署产物只提供对应入口，维护草稿需要独立验证批次', async ({ page }, info) => {
  const writes: Array<{ path: string; batch: string | undefined; csrf: string | undefined }> = [];
  await page.route('**/api/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path === '/api/visits') return route.fulfill({ status: 204 });
    if (path === '/api/auth/me') return route.fulfill({ status: 401, json: { error: { code: 'AUTH.SESSION_INVALID', message: '访客' } } });
    if (path === '/api/games') return route.fulfill({ json: [{ gameId: 'demo', gameName: '隔离测试游戏', representativeImageKey: null }] });
    if (request.method() !== 'GET') {
      writes.push({ path, batch: request.headers()['x-damage-maintenance-batch'], csrf: request.headers()['x-csrf-token'] });
      return route.fulfill({ status: 409, json: { error: { code: 'MAINTENANCE.BATCH_MISMATCH', message: '请求未通过批次验证' } } });
    }
    return route.fulfill({ json: { items: [], total: 0 } });
  });
  if (info.project.name === 'viewer') {
    await installSimulationSelectionApi(page, 'http://127.0.0.1:4197', 'demo');
    await page.goto('/#/skills');
    await expect(page).toHaveURL(/#\/simulation\/combat-analysis$/);
    await expect(page.getByRole('heading', { name: '混合战斗分析', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '新增技能', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '选择批次', exact: true })).toHaveCount(0);
    await page.goto('/#/simulation/basic-attack');
    await expect(page.getByLabel('指定技能行动计划', { exact: true })).toBeEnabled();
    await page.getByLabel('指定技能行动计划', { exact: true }).check();
    await expect(page.getByLabel('指定技能行动计划', { exact: true })).toBeChecked();
    await page.getByRole('button', { name: '报告问题', exact: true }).click();
    await page.getByLabel('问题说明', { exact: true }).fill('期望技能等级切换后结果对应变化。');
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: '下载复现材料', exact: true }).click();
    expect((await download).suggestedFilename()).toBe('damage-problem-report.json');
    expect(writes).toEqual([]);
    return;
  }
  await page.route('**/internal/maintenance/me', route => route.fulfill({ json: {
    principalId: 'e3e2a480-9bf4-49bb-a036-fef46b341da4', displayName: '隔离维护者', expiresAt: new Date(Date.now() + 600_000).toISOString()
  } }));
  await page.context().addCookies([{ domain: '127.0.0.1', path: '/', name: '__Host-damage-maint-csrf', value: 'fixture-private-csrf', secure: true, sameSite: 'Strict' }]);
  await page.goto('/#/attributes');
  await expect(page.getByRole('button', { name: '选择批次', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '新增属性', exact: true }).click();
  const editor = page.getByRole('dialog').filter({ hasText: '新增属性' });
  await editor.getByLabel('稳定标识', { exact: true }).fill('candidate_damage');
  await editor.getByLabel('属性名称', { exact: true }).fill('候选伤害');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toContainText('候选请求已记录');
  expect(writes).toEqual([]);
  await expect(page.getByRole('button', { name: '下载候选请求', exact: true })).toBeEnabled();
  await expect(editor.getByLabel('属性名称', { exact: true })).toHaveValue('候选伤害');
  page.once('dialog', prompt => { void prompt.accept(); });
  await page.reload();
  await expect(page.getByRole('button', { name: '选择批次', exact: true })).toBeEnabled();
  await page.getByLabel('已验证维护批次', { exact: true }).fill('682ae67a-1be7-4dcf-8ebe-b414b9e949df');
  await page.getByRole('button', { name: '选择批次', exact: true }).click();
  await page.getByRole('button', { name: '新增属性', exact: true }).click();
  await editor.getByLabel('稳定标识', { exact: true }).fill('candidate_damage');
  await editor.getByLabel('属性名称', { exact: true }).fill('候选伤害');
  await expect(editor.getByLabel('稳定标识', { exact: true })).toHaveValue('candidate_damage');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toContainText('请求未通过批次验证');
  expect(writes).toEqual([{ path: '/api/admin/games/demo/attributes', batch: '682ae67a-1be7-4dcf-8ebe-b414b9e949df', csrf: 'fixture-private-csrf' }]);
});
