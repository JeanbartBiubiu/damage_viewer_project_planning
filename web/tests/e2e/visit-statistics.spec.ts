import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';
import { installSimulationSelectionApi } from '../fixtures/simulationSelection';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const days = (todayPv = 7) => Array.from({ length: 30 }, (_, index) => ({
  date: new Date(Date.UTC(2026, 9, 7 + index)).toISOString().slice(0, 10), pv: index === 29 ? todayPv : 0, uv: index === 29 ? 3 : 0
}));

class VisitApi {
  signedIn = false;
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
      accountId: 'fixture-player', username: 'fixture_player', canLogin: 1,
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
  await installSimulationSelectionApi(page, 'http://127.0.0.1:4186', 'demo');
  await page.unroute('**/api/auth/me');
  await page.goto('/#/simulation/basic-attack');
  await expect(page.getByRole('heading', { name: '普攻模拟', exact: true })).toBeVisible();
  await expect.poll(() => api.reports.length).toBeGreaterThan(0);
  expect(api.unexpected).toEqual([]);
}

test('整页加载只上报一次，Hash切页不增加，刷新复用访客编号且省略凭据', async ({ page, context }) => {
  const api = new VisitApi(context); await api.install();
  await context.addCookies([{ name: 'fixture-session-marker', value: 'fixture', url: 'http://127.0.0.1:4186' }]);
  await open(page, api); expect(api.reports).toHaveLength(1);
  const visitorId = api.reports[0];
  await page.getByRole('link', { name: '混合战斗分析', exact: true }).click();
  await expect(page.getByRole('heading', { name: '混合战斗分析', exact: true })).toBeVisible();
  expect(api.reports).toHaveLength(1);
  await page.reload(); await expect.poll(() => api.reports.length).toBe(2);
  expect(api.reports).toEqual([visitorId, visitorId]); expect(api.reportCredentialLeaks).toEqual([]);
  expect(api.unexpected).toEqual([]);
});

test('访客和已开通玩家均没有统计入口，上报失败不阻塞页面或显示登录提示', async ({ page, context }) => {
  const api = new VisitApi(context); api.failReport = true; await api.install();
  await open(page, api); await expect(page.getByRole('button', { name: '访问统计', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0); expect(api.reports).toHaveLength(1);
  api.signedIn = true;
  await page.reload(); await expect(page.getByRole('button', { name: '已开通', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '访问统计', exact: true })).toHaveCount(0);
  expect(api.statisticsReads).toBe(0); await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('旧统计网址不提供玩家统计明细，所有玩家仍只使用计算入口', async ({ page, context }) => {
  const api = new VisitApi(context); api.signedIn = true; await api.install(); await open(page, api);
  await page.goto('/#/visits');
  await expect(page).toHaveURL(/#\/simulation\/combat-analysis$/);
  await expect(page.getByRole('button', { name: '访问统计', exact: true })).toHaveCount(0);
  expect(api.statisticsReads).toBe(0);
});
