import { expect, type Page, type Route } from '@playwright/test';
import { FIXTURE_MAINTENANCE_PRINCIPAL, fulfillComputeAuthorization } from './computeAuthorization';

export async function fulfillVisitReport(route: Route): Promise<boolean> {
  if (new URL(route.request().url()).pathname !== '/api/visits' || route.request().method() !== 'POST') return false;
  await route.fulfill({ status: 204 });
  return true;
}

// 玩家替身只拥有查看及计算资格；私有入口另有固定维护主体。
export async function fulfillAuthSession(route: Route, signedIn = true): Promise<boolean> {
  if (await fulfillVisitReport(route)) return true;
  if (await fulfillComputeAuthorization(route)) return true;
  if (new URL(route.request().url()).pathname !== '/api/auth/me') return false;
  await route.fulfill({ status: signedIn ? 200 : 401, json: signedIn ? {
    accountId: 'fixture-player-account', username: 'fixture_player', canLogin: 1,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString()
  } : { error: { code: 'AUTH.SESSION_INVALID', message: '访客' } } });
  return true;
}

const maintenanceInstalled = new WeakSet<Page>();
const FIXTURE_BATCH = '682ae67a-1be7-4dcf-8ebe-b414b9e949df';

/** 浏览器接口替身只证明接线；正式批次与写事务由后端独立验证。 */
export async function openMaintenancePage(page: Page, url: string, options?: Parameters<Page['goto']>[1]) {
  if (!maintenanceInstalled.has(page)) {
    await page.route('**/internal/maintenance/wasm-grant', route => fulfillComputeAuthorization(route).then(() => undefined));
    await page.route('**/internal/maintenance/me', route => route.fulfill({ json: {
      principalId: FIXTURE_MAINTENANCE_PRINCIPAL, displayName: '隔离测试维护者'
    } }));
    maintenanceInstalled.add(page);
  }
  const result = await page.goto(url, options);
  await expect(page.getByRole('button', { name: '选择批次', exact: true })).toBeEnabled();
  await page.getByLabel('已验证维护批次', { exact: true }).fill(FIXTURE_BATCH);
  await page.getByRole('button', { name: '选择批次', exact: true }).click();
  await expect(page.getByText(`当前批次：${FIXTURE_BATCH}。保存请求必须与后端已验证批次完全一致。`, { exact: true })).toBeVisible();
  return result;
}
