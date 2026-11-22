import { expect, test, type Page } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { preview } from 'vite';
import { FIXTURE_MAINTENANCE_PRINCIPAL, fulfillComputeAuthorization } from '../fixtures/computeAuthorization';
import { chooseSimulationEntity, chooseSimulationLevel, installSimulationSelectionApi } from '../fixtures/simulationSelection';
import { simulationSample } from '../fixtures/simulationSnapshot';
import { expectSimulationConfigurationReady, simulationSnapshotWithSelection } from '../fixtures/simulationSnapshotRequests';
import { webRoot } from '../playwright/paths';

async function installNavigationApi(page: Page, baseURL: string) {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/visits') return route.fulfill({ status: 204 });
    if (path === '/api/games') return route.fulfill({ json: [{ gameId: 'demo', gameName: '隔离测试游戏', representativeImageKey: null }] });
    return route.fulfill({ json: { items: [], total: 0 } });
  });
  await page.route('**/internal/maintenance/me', route => route.fulfill({ json: {
    principalId: FIXTURE_MAINTENANCE_PRINCIPAL, displayName: '隔离维护者'
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

const attributePath = '/api/admin/games/demo/attributes';
const imagePath = '/api/games/demo/images';
const representativePath = `${attributePath}/candidate_damage/representative-image`;

async function previewMaintenanceWithApi() {
  const writes: Array<{ path: string; body: string | null; batch: string | undefined }> = [];
  const requests: Array<{ method: string; path: string; cookie: boolean; csrf: boolean; origin?: string; fetchSite?: string; client?: string }> = [];
  let saved: Record<string, unknown> | undefined;
  let readback = 0;
  const server = await preview({
    configFile: false, root: webRoot, appType: 'mpa', logLevel: 'silent', build: { outDir: 'dist-maintenance' },
    preview: { host: '127.0.0.1', port: 0, strictPort: true },
    plugins: [{ name: 'maintenance-browser-fixture', configurePreviewServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const path = request.url?.split('?', 1)[0] ?? '';
        if (!/^\/(api|internal)\//.test(path)) return next();
        const method = request.method ?? '';
        const header = (name: string) => request.headers[name]?.toString();
        requests.push({ path, method, cookie: Boolean(header('cookie')), csrf: Boolean(header('x-csrf-token')),
          origin: header('origin'), fetchSite: header('sec-fetch-site'), client: header('x-damage-client') });
        const reply = (status: number, body: unknown) => response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
        if (method === 'GET' && path === '/internal/maintenance/me') return reply(200, { principalId: FIXTURE_MAINTENANCE_PRINCIPAL, displayName: '隔离维护者' });
        if (method === 'GET' && path === '/api/games') return reply(200, [{ gameId: 'demo', gameName: '隔离测试游戏', representativeImageKey: null }]);
        if (method === 'GET' && path === imagePath) return reply(200, { gameId: 'demo', images: [] });
        if (method === 'GET' && path === representativePath) return reply(200, { image: null });
        if (method === 'GET' && path === attributePath) {
          if (saved) readback++;
          return reply(200, { items: saved ? [saved] : [], total: saved ? 1 : 0 });
        }
        if (method === 'POST' && path === attributePath) {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(chunk);
          const body = Buffer.concat(chunks).toString('utf8');
          writes.push({ path, body, batch: header('x-damage-maintenance-batch') });
          if (writes.length === 1) return reply(409, { error: { code: 'MAINTENANCE.BATCH_MISMATCH', message: '请求未通过批次验证' } });
          saved = { ...JSON.parse(body), gameId: 'demo', createdAt: '2026-11-22T00:00:00Z', updatedAt: '2026-11-22T00:00:00Z' };
          return reply(201, saved);
        }
        return reply(404, { error: { message: '隔离接口未登记' } });
      });
    } }]
  });
  const origin = new URL(server.resolvedUrls!.local[0]!).origin;
  return { origin, requests, writes, close: () => server.close(), get readback() { return readback; } };
}

test('部署产物只提供对应入口，维护候选、冻结批次和回读走同源请求', async ({ page, request, baseURL }, info) => {
  if (info.project.name === 'viewer') {
    await page.route('**/api/games', route => route.fulfill({ json: [{ gameId: 'demo', gameName: '隔离测试游戏', representativeImageKey: null }] }));
    await page.route('**/api/visits', route => route.fulfill({ status: 204 }));
    const internalCalls: string[] = [];
    await page.route('**/internal/**', route => { internalCalls.push(route.request().url()); return route.abort(); });
    const privateAssets = await readdir(new URL('../../dist-maintenance/assets/', import.meta.url));
    const privateEntry = privateAssets.find(file => /^maintenance-.*\.js$/.test(file));
    const privateEditor = privateAssets.find(file => /^AttributeManagementPage-.*\.js$/.test(file));
    expect(privateEntry).toBeDefined();
    expect(privateEditor).toBeDefined();
    for (const path of ['/maintenance.html', `/assets/${privateEntry}`, `/assets/${privateEditor}`, `/assets/${privateEditor}.map`, '/.vite/site-graph.json']) {
      expect((await request.get(path)).status(), path).toBe(404);
    }
    await installSimulationSelectionApi(page, baseURL!, 'demo');
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
    expect(internalCalls).toEqual([]);
    return;
  }
  const backend = await previewMaintenanceWithApi();
  try {
    const { origin, requests, writes } = backend;
    await page.context().addCookies([{ url: origin, name: 'ambient-test', value: 'unused', sameSite: 'Strict' }]);
    await page.goto(`${origin}/#/attributes`);
    await expect(page.getByRole('button', { name: '选择批次', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '登录', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '退出维护', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '新增属性', exact: true }).click();
    const editor = page.getByRole('dialog').filter({ hasText: '新增属性' });
    await editor.getByLabel('稳定标识', { exact: true }).fill('candidate_damage');
    await editor.getByLabel('属性名称', { exact: true }).fill('候选伤害');
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editor).toContainText('候选请求已记录');
    expect(writes).toEqual([]);
    await expect(editor.getByLabel('属性名称', { exact: true })).toHaveValue('候选伤害');
    page.once('dialog', prompt => { void prompt.accept(); });
    await editor.getByRole('button', { name: '取消', exact: true }).click();
    await expect(editor).toBeHidden();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载候选请求', exact: true }).click();
    const candidate = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
    expect(candidate.format).toBe('damage-maintenance-request-v1');
    expect(candidate.operations).toEqual([{ method: 'POST', path: attributePath, body: expect.any(String) }]);
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
    const grantedWrite = { path: attributePath, body: candidate.operations[0].body, batch: '682ae67a-1be7-4dcf-8ebe-b414b9e949df' };
    expect(writes).toEqual([grantedWrite]);
    await expect(editor.getByLabel('属性名称', { exact: true })).toHaveValue('候选伤害');
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'candidate_damage', exact: true }) })).toContainText('候选伤害');
    expect(writes).toEqual([grantedWrite, grantedWrite]);
    expect(backend.readback).toBeGreaterThan(0);
    expect(requests.some(call => call.path === '/internal/maintenance/me')).toBe(true);
    for (const call of requests) {
      expect([attributePath, imagePath, representativePath, '/api/games', '/internal/maintenance/me']).toContain(call.path);
      expect(call).toMatchObject({ cookie: false, csrf: false, fetchSite: 'same-origin' });
      if (call.method === 'POST') expect(call).toMatchObject({ origin, client: 'web' });
    }
  } finally {
    await backend.close();
  }
});

test('两站实际发布目录用各自的第 2 版票据运行与释放 Wasm 会话', async ({ page, baseURL }, info) => {
  const maintenance = info.project.name === 'maintenance';
  const snapshot = simulationSample();
  await installSimulationSelectionApi(page, baseURL!, snapshot.gameId, snapshot);
  await page.route('**/api/games', route => route.fulfill({ json: [{ gameId: 'demo', gameName: '隔离计算游戏', representativeImageKey: null }] }));
  await page.route('**/api/visits', route => route.fulfill({ status: 204 }));
  await page.route('**/api/games/*/images?**', route => route.fulfill({ json: { gameId: 'demo', images: [] } }));
  await page.route('**/internal/maintenance/me', route => route.fulfill({ json: { principalId: FIXTURE_MAINTENANCE_PRINCIPAL, displayName: '隔离维护者' } }));
  await page.route('**/simulation-snapshot', route => route.fulfill({ json: simulationSnapshotWithSelection(snapshot, route.request().postDataJSON()) }));
  const grants: string[] = [];
  const wasmRequests: string[] = [];
  page.on('request', request => { if (request.url().endsWith('.wasm')) wasmRequests.push(new URL(request.url()).pathname); });
  for (const path of ['/internal/maintenance/wasm-grant', '/api/auth/wasm-grant']) {
    await page.route(`**${path}`, async route => {
      grants.push(path);
      expect(route.request().headers()['x-damage-client']).toBe('web');
      expect(await fulfillComputeAuthorization(route)).toBe(true);
    });
  }
  await page.goto('/#/simulation/basic-attack');
  await chooseSimulationEntity(page, '攻击方角色', snapshot.selection.sourceCharacterKey);
  await chooseSimulationLevel(page, '攻击方等级', snapshot.selection.sourceLevel);
  await chooseSimulationEntity(page, '目标角色', snapshot.selection.targetCharacterKey);
  await chooseSimulationLevel(page, '目标等级', snapshot.selection.targetLevel);
  await chooseSimulationEntity(page, '普攻技能', snapshot.selection.basicAttackSkillKey!);
  await chooseSimulationLevel(page, '普攻技能等级', snapshot.selection.basicAttackLevel!);
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  await expectSimulationConfigurationReady(page);
  await page.getByRole('button', { name: '将缺失属性填写为0', exact: true }).click();
  await page.getByRole('button', { name: '双方以满生命开始', exact: true }).click();
  await page.getByRole('button', { name: '执行一次普攻', exact: true }).click();
  await expect(page.getByText('单次普攻运行通过，不代表连续攻击通过。', { exact: true })).toBeVisible();
  await expect(page.getByText('清理状态：会话已正常释放，线程已结束。', { exact: true })).toBeVisible();
  expect(wasmRequests.length).toBeGreaterThan(0);
  expect(wasmRequests.every(path => /^\/assets\/tinygo_engine_v2-.+\.wasm$/.test(path))).toBe(true);
  expect([...new Set(grants)]).toEqual([maintenance ? '/internal/maintenance/wasm-grant' : '/api/auth/wasm-grant']);
});
