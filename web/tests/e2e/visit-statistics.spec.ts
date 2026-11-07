import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const days = (todayPv = 7) => Array.from({ length: 30 }, (_, index) => ({
  date: new Date(Date.UTC(2026, 9, 7 + index)).toISOString().slice(0, 10), pv: index === 29 ? todayPv : 0, uv: index === 29 ? 3 : 0
}));

class VisitApi {
  signedIn = false;
  canEdit = true;
  failReport = false;
  delayStatistics = false;
  pendingStatistics: Route[] = [];
  reports: string[] = [];
  statisticsReads = 0;
  unexpected: string[] = [];
  reportCredentialLeaks: string[] = [];
  constructor(private context: BrowserContext) {}
  async install() { await this.context.route('**/api/**', route => this.handle(route)); }
  private async handle(route: Route) {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    if (method === 'POST' && path === '/api/visits') {
      const body = request.postDataJSON() as { visitorId: string };
      expect(body.visitorId).toMatch(UUID); expect(request.headers()['x-damage-client']).toBe('web');
      if (request.headers().cookie || request.headers()['x-csrf-token'] || request.headers().authorization) this.reportCredentialLeaks.push(path);
      this.reports.push(body.visitorId);
      return this.failReport ? route.abort('failed') : route.fulfill({ status: 204 });
    }
    if (method === 'GET' && path === '/api/auth/me') return route.fulfill({ status: this.signedIn ? 200 : 401, json: this.signedIn ? {
      accountId: 'fixture-editor', username: 'fixture_editor', canLogin: 1, canEdit: this.canEdit,
      expiresAt: new Date(Date.now() + 600_000).toISOString()
    } : { error: { code: 'AUTH.SESSION_INVALID', message: '访客' } } });
    if (method === 'POST' && path === '/api/auth/logout') { this.signedIn = false; return route.fulfill({ status: 204 }); }
    if (method === 'GET' && path === '/api/admin/visits/last30days') {
      this.statisticsReads += 1;
      expect(request.headers()['x-damage-client']).toBe('web');
      if (this.delayStatistics) { this.pendingStatistics.push(route); return; }
      return route.fulfill({ json: days() });
    }
    if (method === 'GET' && path === '/api/games') return route.fulfill({ json: [{ gameId: 'demo', gameName: '测试游戏', representativeImageKey: null }] });
    if (method === 'GET' && path === '/api/admin/games/demo/images') return route.fulfill({ json: { gameId: 'demo', images: [] } });
    if (method === 'GET' && path.endsWith('/representative-image')) return route.fulfill({ json: { image: null } });
    if (method === 'GET' && /^\/api\/admin\/games\/demo\/(attributes|characters)$/.test(path)) return route.fulfill({ json: { items: [], total: 0 } });
    this.unexpected.push(`${method} ${path}`);
    return route.fulfill({ status: 404, json: { error: { message: '未定义的测试请求' } } });
  }
  async releasePending() {
    await Promise.all(this.pendingStatistics.splice(0).map(route => route.fulfill({ json: days(999) }).catch(() => undefined)));
  }
}

async function open(page: Page, api: VisitApi) {
  await page.goto('/#/attributes');
  await expect(page.getByRole('heading', { name: '属性管理', exact: true })).toBeVisible();
  await expect.poll(() => api.reports.length).toBeGreaterThan(0);
  expect(api.unexpected).toEqual([]);
}
const statisticsDialog = (page: Page) => page.getByRole('dialog').filter({ hasText: '访问统计' });

test('整页加载只上报一次，Hash切页不增加，刷新复用访客编号且省略凭据', async ({ page, context }) => {
  const api = new VisitApi(context); await api.install();
  await context.addCookies([{ name: 'fixture-session-marker', value: 'fixture', url: 'http://127.0.0.1:4186' }]);
  await open(page, api); expect(api.reports).toHaveLength(1);
  const visitorId = api.reports[0];
  await page.locator('a.nav-item[href="#/characters"]').click();
  await expect(page.getByRole('heading', { name: '角色管理', exact: true })).toBeVisible();
  expect(api.reports).toHaveLength(1);
  await page.reload(); await expect.poll(() => api.reports.length).toBe(2);
  expect(api.reports).toEqual([visitorId, visitorId]); expect(api.reportCredentialLeaks).toEqual([]);
  expect(api.unexpected).toEqual([]);
});

test('访客和无编辑资格账号没有统计入口，上报失败不阻塞页面或显示登录提示', async ({ page, context }) => {
  const api = new VisitApi(context); api.failReport = true; await api.install();
  await open(page, api); await expect(page.getByRole('button', { name: '访问统计', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0); expect(api.reports).toHaveLength(1);
  api.signedIn = true; api.canEdit = false;
  await page.reload(); await expect(page.getByRole('button', { name: '已开通', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '访问统计', exact: true })).toHaveCount(0);
  expect(api.statisticsReads).toBe(0); await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('编辑账号查看今日数字及近30天倒序日期，关闭后重新读取', async ({ page, context }) => {
  const api = new VisitApi(context); api.signedIn = true; await api.install(); await open(page, api);
  const button = page.getByRole('button', { name: '访问统计', exact: true }); await button.click();
  const modal = statisticsDialog(page);
  await expect(modal.getByText('今日 PV（访问量）', { exact: true })).toBeVisible();
  await expect(modal.getByText('今日 UV（独立访客）', { exact: true })).toBeVisible();
  await expect(modal.getByRole('row')).toHaveCount(31);
  await expect(modal.locator('.arco-statistic').filter({ hasText: '今日 PV（访问量）' })).toContainText('7');
  await expect(modal.locator('.arco-statistic').filter({ hasText: '今日 UV（独立访客）' })).toContainText('3');
  const dateCells = modal.getByRole('row').filter({ has: page.getByRole('cell') }).getByRole('cell').nth(0);
  await expect(dateCells).toHaveText('2026-11-05');
  const rows = modal.getByRole('row').filter({ has: page.getByRole('cell') });
  expect(await rows.evaluateAll(elements => elements.map(row => row.querySelector('td')?.textContent?.trim())))
    .toEqual(Array.from({ length: 30 }, (_, index) => new Date(Date.UTC(2026, 10, 5 - index)).toISOString().slice(0, 10)));
  expect(api.statisticsReads).toBe(1);
  await modal.getByRole('button', { name: '关闭', exact: true }).click(); await expect(modal).toHaveCount(0);
  await button.click(); await expect.poll(() => api.statisticsReads).toBe(2); await expect(modal.getByRole('row')).toHaveCount(31);
  expect(api.reports).toHaveLength(1); expect(api.unexpected).toEqual([]);
});

test('关闭统计后丢弃延迟响应，重新打开不恢复旧数据', async ({ page, context }) => {
  const api = new VisitApi(context); api.signedIn = true; api.delayStatistics = true; await api.install(); await open(page, api);
  const button = page.getByRole('button', { name: '访问统计', exact: true }); await button.click();
  await expect.poll(() => api.pendingStatistics.length).toBe(1);
  await statisticsDialog(page).getByRole('button', { name: '关闭', exact: true }).click();
  await api.releasePending(); await expect(statisticsDialog(page)).toHaveCount(0);
  api.delayStatistics = false; await button.click();
  await expect(statisticsDialog(page).getByRole('row')).toHaveCount(31);
  await expect(statisticsDialog(page)).not.toContainText('999');
});

test('其他标签页退出会关闭统计并丢弃未完成查询', async ({ page, context }) => {
  const api = new VisitApi(context); api.signedIn = true; api.delayStatistics = true; await api.install(); await open(page, api);
  await page.getByRole('button', { name: '访问统计', exact: true }).click();
  await expect.poll(() => api.pendingStatistics.length).toBe(1);
  const other = await context.newPage(); await other.goto('/#/attributes');
  await other.getByRole('button', { name: '已开通', exact: true }).click();
  await other.getByRole('menuitem', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '访问统计', exact: true })).toHaveCount(0);
  await api.releasePending(); await expect(statisticsDialog(page)).toHaveCount(0);
  expect(api.unexpected).toEqual([]);
});
