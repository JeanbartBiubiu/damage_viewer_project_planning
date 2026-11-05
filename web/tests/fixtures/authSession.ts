import type { Route } from '@playwright/test';

export async function fulfillVisitReport(route: Route): Promise<boolean> {
  if (new URL(route.request().url()).pathname !== '/api/visits' || route.request().method() !== 'POST') return false;
  await route.fulfill({ status: 204 });
  return true;
}

// 管理页固定替身使用已登录编辑者，访客用例显式传 false；不支持旧管理令牌。
export async function fulfillAuthSession(route: Route, signedIn = true): Promise<boolean> {
  if (await fulfillVisitReport(route)) return true;
  if (new URL(route.request().url()).pathname !== '/api/auth/me') return false;
  await route.fulfill({ status: signedIn ? 200 : 401, json: signedIn ? {
    accountId: 'fixture-editor-account', username: 'fixture_editor', canLogin: 1, canEdit: true,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString()
  } : { error: { code: 'AUTH.SESSION_INVALID', message: '访客' } } });
  return true;
}
