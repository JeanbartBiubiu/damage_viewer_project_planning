import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';

// 全部凭据和恢复材料都是隔离替身；此处验证浏览器接线，不替代真实后端安全验证。
const PASSWORD = 'fixture-password-123';
const ACCOUNT_ID = 'fixture-account-id';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const expiry = () => new Date(Date.now() + 600_000).toISOString();
type Purpose = 'register' | 'login' | 'reset_password' | 'replace_totp' | 'change_password' | 'change_totp' | 'regenerate_recovery_codes';

class AccountApi {
  signedIn = false;
  pending = false;
  purpose: Purpose = 'login';
  phase = 'started';
  confirmResponseLost = false;
  writeCode = 'AUTH.SESSION_INVALID';
  securityProofFails = false;
  sessionExpiresAt = expiry();
  attributeRows: Array<Record<string, unknown>> = [];
  calls: { path: string; method: string; body: Record<string, string> | null; csrf: string | undefined }[] = [];
  unexpected: string[] = [];
  publicCredentialLeaks: string[] = [];
  constructor(private context: BrowserContext) {}
  session() { return { accountId: ACCOUNT_ID, username: 'fixture_player', canLogin: 1, canEdit: true, expiresAt: this.sessionExpiresAt }; }
  flow() { return { accountId: ACCOUNT_ID, purpose: this.purpose, phase: this.phase, expiresAt: expiry() }; }
  async install() { await this.context.route('**/api/**', route => this.handle(route)); }
  private async cookies(url: string, flow: boolean) {
    const domain = new URL(url).hostname;
    await this.context.addCookies([
      { domain, path: '/', name: flow ? '__Host-dv_flow_csrf' : '__Host-dv_csrf', value: flow ? 'fixture-flow-csrf' : 'fixture-session-csrf', secure: true, sameSite: 'Strict' },
      { domain, path: '/', name: flow ? '__Host-dv_flow' : '__Host-dv_session', value: 'fixture-opaque-value', secure: true, httpOnly: true, sameSite: 'Strict' }
    ]);
  }
  private async handle(route: Route) {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    const body = request.postData() ? request.postDataJSON() as Record<string, string> : null;
    this.calls.push({ path, method, body, csrf: request.headers()['x-csrf-token'] });
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: data, headers: {
      'Cache-Control': 'no-store',
      ...(path.startsWith('/api/auth/') && path !== '/api/auth/me' && !path.includes('/logout') ? { 'X-Damage-Flow-CSRF': 'fixture-flow-csrf' } : {})
    } });
    const error = (code: string, status = 401) => json({ error: { code, message: '测试凭据无效或会话已结束。' } }, status);
    if ((path.startsWith('/api/auth/flow/') || path === '/api/auth/login/totp') && request.headers()['x-csrf-token'] !== 'fixture-flow-csrf') return error('AUTH.CSRF_REJECTED', 403);
    if (!path.startsWith('/api/auth/') && method === 'GET') {
      if (request.headers().cookie || request.headers()['x-csrf-token'] || request.headers().authorization) this.publicCredentialLeaks.push(path);
      if (path === '/api/games') return json([{ gameId: 'demo', gameName: '测试游戏', representativeImageKey: null }]);
      if (path.endsWith('/attributes')) return json({ items: this.attributeRows, total: this.attributeRows.length });
      if (path.endsWith('/images')) return json({ gameId: 'demo', images: [] });
      if (path.endsWith('/representative-image')) return json({ image: null });
    }
    if (path === '/api/admin/games/demo/attributes' && method === 'POST') return error(this.writeCode, this.writeCode === 'AUTH.SESSION_INVALID' ? 401 : 403);
    if (path === '/api/admin/games/demo/images' && method === 'POST') return error('AUTH.SESSION_INVALID');
    if (path === '/api/auth/me') {
      if (this.signedIn) { await this.cookies(request.url(), false); return json(this.session()); }
      return error('AUTH.SESSION_INVALID');
    }
    if (path === '/api/auth/register') { this.purpose = 'register'; this.phase = 'started'; await this.cookies(request.url(), true); return json(this.flow()); }
    if (path === '/api/auth/login') {
      if (body?.username === 'bad') return error('AUTH.INVALID_CREDENTIALS');
      this.purpose = this.pending ? 'register' : 'login'; this.phase = 'started'; await this.cookies(request.url(), true); return json(this.flow());
    }
    if (path === '/api/auth/login/totp') {
      this.signedIn = true;
      await this.cookies(request.url(), false);
      return json(this.session());
    }
    if (path === '/api/auth/recovery/password') { this.purpose = 'reset_password'; this.phase = 'started'; await this.cookies(request.url(), true); return json(this.flow()); }
    if (path === '/api/auth/recovery/totp') { this.purpose = 'replace_totp'; this.phase = 'started'; await this.cookies(request.url(), true); return json(this.flow()); }
    if (path.startsWith('/api/auth/security/')) {
      if (this.securityProofFails) return error('AUTH.INVALID_CREDENTIALS');
      this.purpose = path.endsWith('/password') ? 'change_password' : path.endsWith('/totp') ? 'change_totp' : 'regenerate_recovery_codes';
      this.phase = this.purpose === 'regenerate_recovery_codes' ? 'recovery_codes_ready' : 'started'; await this.cookies(request.url(), true); return json(this.flow());
    }
    if (path === '/api/auth/flow/totp/setup') return json({ otpauthUri: 'otpauth://totp/test-only', qrCodeDataUrl: PNG });
    if (path === '/api/auth/flow/totp/verify') { this.phase = 'recovery_codes_ready'; return json(this.flow()); }
    if (path === '/api/auth/flow/recovery-codes') return json({ codes: ['fixture-recovery-01', 'fixture-recovery-02'], expiresAt: expiry() });
    if (path === '/api/auth/flow/status') return json(this.phase === 'completed' ? { phase: 'completed' } : this.flow());
    if (path === '/api/auth/flow/recovery-codes/confirm' || path === '/api/auth/flow/complete') {
      this.phase = 'completed'; this.signedIn = false;
      if (this.confirmResponseLost) { this.confirmResponseLost = false; return route.abort('failed'); }
      return json({ phase: 'completed' });
    }
    if (path === '/api/auth/logout' || path === '/api/auth/logout-all') { this.signedIn = false; await this.context.clearCookies(); return route.fulfill({ status: 204 }); }
    this.unexpected.push(`${method} ${path}`); return error('404.FIXTURE_MISSING', 404);
  }
}

const dialog = (page: Page) => page.locator('.account-dialog');
async function open(page: Page, api: AccountApi) { await page.goto('/#/attributes'); await expect(page.getByRole('heading', { name: '属性管理', exact: true })).toBeVisible(); expect(api.unexpected).toEqual([]); }
async function credentials(page: Page, username = 'fixture_player') {
  await dialog(page).getByLabel('用户名', { exact: true }).fill(username);
  await dialog(page).getByLabel('密码', { exact: true }).fill(PASSWORD);
}
async function otp(page: Page, code = '001234') {
  await dialog(page).getByLabel('验证器动态码', { exact: true }).fill(code);
  await dialog(page).getByRole('button', { name: '验证动态码', exact: true }).click();
}
async function saveCodes(page: Page) {
  await expect(dialog(page).getByLabel('恢复码', { exact: true })).toBeVisible();
  await dialog(page).getByText('我已离线保存全部恢复码', { exact: true }).click();
  await dialog(page).getByRole('button', { name: '确认已保存，完成操作', exact: true }).click();
}

test('访客读取安静，受保护保存仅显示需要登录且保留草稿，不重放', async ({ page, context }) => {
  const api = new AccountApi(context); await api.install(); await open(page, api);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '新增属性', exact: true }).click();
  const editor = page.getByRole('dialog').filter({ hasText: '新增属性' });
  await editor.getByLabel('稳定标识', { exact: true }).fill('keep_draft'); await editor.getByLabel('属性名称', { exact: true }).fill('保留草稿');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  const prompt = page.getByRole('dialog').filter({ hasText: '需要登录' });
  await expect(prompt).toContainText('请先通过右上角入口登录，再进行此操作。');
  await expect(prompt.getByRole('button', { name: '知道了', exact: true })).toBeVisible();
  await expect(dialog(page)).toHaveCount(0); await prompt.getByRole('button', { name: '知道了', exact: true }).click();
  await expect(editor.getByLabel('稳定标识', { exact: true })).toHaveValue('keep_draft');
  await expect(editor.getByLabel('属性名称', { exact: true })).toHaveValue('保留草稿');
  expect(api.calls.filter(call => call.method === 'POST' && call.path.endsWith('/attributes'))).toHaveLength(1);
  expect(api.publicCredentialLeaks).toEqual([]);
});

test('右上角手动两步登录，表单错误局部展示，刷新恢复身份且筛选输入保留', async ({ page, context }) => {
  const api = new AccountApi(context); await api.install(); await open(page, api);
  await page.getByLabel('关键词', { exact: true }).fill('保留筛选');
  await page.getByRole('button', { name: '登录', exact: true }).click(); await credentials(page, 'bad');
  await dialog(page).getByRole('button', { name: '下一步', exact: true }).click();
  await expect(dialog(page).getByText('AUTH.INVALID_CREDENTIALS: 测试凭据无效或会话已结束。', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').filter({ hasText: '需要登录' })).toHaveCount(0);
  await credentials(page); await dialog(page).getByRole('button', { name: '下一步', exact: true }).click();
  await expect(page.getByRole('button', { name: 'fixture_player · 已开通', exact: true })).toHaveCount(0);
  await otp(page); await expect(page.getByRole('button', { name: 'fixture_player · 已开通', exact: true })).toBeVisible();
  await expect(page.getByLabel('关键词', { exact: true })).toHaveValue('保留筛选');
  expect(api.calls.find(call => call.path.endsWith('/login/totp'))?.body).toEqual({ totpCode: '001234' });
  expect(api.calls.find(call => call.path.endsWith('/login/totp'))?.csrf).toBe('fixture-flow-csrf');
  expect(api.calls.filter(call => call.path === '/api/auth/login').every(call => call.csrf === undefined)).toBe(true);
  await page.reload(); await expect(page.getByRole('button', { name: 'fixture_player · 已开通', exact: true })).toBeVisible();
  expect(api.publicCredentialLeaks).toEqual([]);
});

test('注册绑定、保存恢复码后等待开通；完成响应丢失可回查且不重放确认', async ({ page, context }) => {
  const api = new AccountApi(context); api.confirmResponseLost = true; await api.install(); await open(page, api);
  await page.getByRole('button', { name: '注册', exact: true }).click(); await credentials(page);
  await dialog(page).getByLabel('再次输入密码', { exact: true }).fill(PASSWORD);
  await dialog(page).getByRole('button', { name: '创建账号并绑定验证器', exact: true }).click();
  await expect(dialog(page).getByAltText('验证器绑定二维码', { exact: true })).toBeVisible(); await otp(page); await saveCodes(page);
  await expect(dialog(page).getByText('网络请求失败，请检查网络连接和 API 地址。', { exact: true })).toBeVisible();
  await dialog(page).getByRole('button', { name: '查询当前进度', exact: true }).click();
  await expect(dialog(page)).toContainText('账号等待开通'); await expect(dialog(page)).toContainText(ACCOUNT_ID);
  await expect(page.getByRole('button', { name: 'fixture_player · 已开通', exact: true })).toHaveCount(0);
  expect(api.calls.filter(call => call.path.endsWith('/recovery-codes/confirm'))).toHaveLength(1);
  expect(await page.evaluate(() => Object.values(localStorage).join('|'))).not.toMatch(/fixture-recovery|otpauth|fixture-password|fixture-session/);
  await dialog(page).getByRole('button', { name: '返回登录', exact: true }).click(); await expect(dialog(page).getByLabel('用户名', { exact: true })).toBeVisible();
});

test('未完成注册由原用户名密码登录续办，不重复注册账号', async ({ page, context }) => {
  const api = new AccountApi(context); api.pending = true; await api.install(); await open(page, api);
  await page.getByRole('button', { name: '登录', exact: true }).click(); await credentials(page);
  await dialog(page).getByRole('button', { name: '下一步', exact: true }).click();
  await expect(dialog(page).getByAltText('验证器绑定二维码', { exact: true })).toBeVisible(); await otp(page); await saveCodes(page);
  await expect(dialog(page)).toContainText('账号等待开通'); expect(api.calls.filter(call => call.path.endsWith('/register'))).toHaveLength(0);
});

test('忘记密码使用动态码与恢复码，验证器丢失使用密码与恢复码', async ({ page, context }) => {
  const api = new AccountApi(context); await api.install(); await open(page, api);
  await page.getByRole('button', { name: '登录', exact: true }).click(); await dialog(page).getByRole('button', { name: '忘记密码', exact: true }).click();
  await dialog(page).getByLabel('用户名', { exact: true }).fill('fixture_player'); await dialog(page).getByLabel('验证器动态码', { exact: true }).fill('000123');
  await dialog(page).getByLabel('未使用的恢复码', { exact: true }).fill('fixture-recovery-01'); await dialog(page).getByRole('button', { name: '验证并继续', exact: true }).click();
  await dialog(page).getByLabel('新密码', { exact: true }).fill('new-fixture-password'); await dialog(page).getByLabel('再次输入新密码', { exact: true }).fill('new-fixture-password');
  await dialog(page).getByRole('button', { name: '保存新密码', exact: true }).click(); await expect(dialog(page)).toContainText('操作已完成');
  expect(api.calls.find(call => call.path.endsWith('/recovery/password'))?.body).toEqual({ username: 'fixture_player', totpCode: '000123', recoveryCode: 'fixture-recovery-01' });
  await dialog(page).getByRole('button', { name: '返回登录', exact: true }).click(); await dialog(page).getByRole('button', { name: '验证器丢失', exact: true }).click();
  await credentials(page); await dialog(page).getByLabel('未使用的恢复码', { exact: true }).fill('fixture-recovery-02');
  await dialog(page).getByRole('button', { name: '验证并继续', exact: true }).click(); await otp(page); await saveCodes(page);
  await expect(dialog(page)).toContainText('操作已完成'); expect(api.calls.find(call => call.path.endsWith('/recovery/totp'))?.body).toEqual({ username: 'fixture_player', password: PASSWORD, recoveryCode: 'fixture-recovery-02' });
});

for (const kind of ['password', 'totp', 'recovery-codes'] as const) test(`正常账号安全操作：${kind}`, async ({ page, context }) => {
  const api = new AccountApi(context); api.signedIn = true; await api.install(); await open(page, api);
  await page.getByRole('button', { name: 'fixture_player · 已开通', exact: true }).click(); await page.getByText('账号安全', { exact: true }).click();
  if (kind !== 'password') { await dialog(page).getByLabel('安全操作', { exact: true }).click(); await page.getByRole('option', { name: kind === 'totp' ? '更换验证器' : '重新生成恢复码', exact: true }).click(); }
  await dialog(page).getByLabel('当前密码', { exact: true }).fill(PASSWORD); await dialog(page).getByLabel('验证器动态码', { exact: true }).fill('001234');
  await dialog(page).getByRole('button', { name: '验证并继续', exact: true }).click();
  if (kind === 'password') {
    await dialog(page).getByLabel('新密码', { exact: true }).fill('new-fixture-password'); await dialog(page).getByLabel('再次输入新密码', { exact: true }).fill('new-fixture-password');
    await dialog(page).getByRole('button', { name: '保存新密码', exact: true }).click();
  } else { if (kind === 'totp') await otp(page); await saveCodes(page); }
  await expect(dialog(page)).toContainText('操作已完成'); await expect(page.getByRole('button', { name: 'fixture_player · 已开通', exact: true })).toHaveCount(0);
  expect(api.calls.find(call => call.path.endsWith(`/security/${kind}`))?.body).toEqual({ currentPassword: PASSWORD, totpCode: '001234' });
  expect(api.calls.find(call => call.path.endsWith(`/security/${kind}`))?.csrf).toBe('fixture-session-csrf');
});

test('全部退出跨标签页失效，保留两个页面的当前输入', async ({ page, context }) => {
  const api = new AccountApi(context); api.signedIn = true; await api.install(); await open(page, api);
  const second = await context.newPage(); await open(second, api);
  await page.getByLabel('关键词', { exact: true }).fill('页面甲草稿'); await second.getByLabel('关键词', { exact: true }).fill('页面乙草稿');
  await page.getByRole('button', { name: 'fixture_player · 已开通', exact: true }).click(); await page.getByText('退出全部设备', { exact: true }).click();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible(); await expect(second.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  await expect(page.getByLabel('关键词', { exact: true })).toHaveValue('页面甲草稿'); await expect(second.getByLabel('关键词', { exact: true })).toHaveValue('页面乙草稿');
  await expect(second.getByRole('dialog')).toHaveCount(0);
});

test('无编辑资格的403保留编辑草稿并展示资格提示', async ({ page, context }) => {
  const api = new AccountApi(context); api.signedIn = true; api.writeCode = 'AUTH.EDIT_REQUIRED'; await api.install(); await open(page, api);
  await page.getByRole('button', { name: '新增属性', exact: true }).click(); const editor = page.getByRole('dialog').filter({ hasText: '新增属性' });
  await editor.getByLabel('稳定标识', { exact: true }).fill('keep_draft'); await editor.getByLabel('属性名称', { exact: true }).fill('保留草稿');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toContainText('当前账号没有编辑资格，可以继续浏览游戏资料。'); await expect(page.getByRole('dialog').filter({ hasText: '需要登录' })).toHaveCount(0);
  await expect(editor.getByLabel('属性名称', { exact: true })).toHaveValue('保留草稿');
});

test('安全证明错误仅在表单内提示，会话失效才出现需要登录且不重放原操作', async ({ page, context }) => {
  const api = new AccountApi(context); api.signedIn = true; api.securityProofFails = true; await api.install(); await open(page, api);
  await page.getByRole('button', { name: 'fixture_player · 已开通', exact: true }).click(); await page.getByText('账号安全', { exact: true }).click();
  await dialog(page).getByLabel('当前密码', { exact: true }).fill('wrong-fixture-password'); await dialog(page).getByLabel('验证器动态码', { exact: true }).fill('001234');
  await dialog(page).getByRole('button', { name: '验证并继续', exact: true }).click();
  await expect(dialog(page)).toContainText('AUTH.INVALID_CREDENTIALS: 测试凭据无效或会话已结束。');
  await expect(page.getByRole('button', { name: 'fixture_player · 已开通', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').filter({ hasText: '需要登录' })).toHaveCount(0);
  api.signedIn = false;
  await dialog(page).getByRole('button', { name: '验证并继续', exact: true }).click();
  const prompt = page.getByRole('dialog').filter({ hasText: '需要登录' }); await expect(prompt).toBeVisible();
  expect(api.calls.filter(call => call.path === '/api/auth/security/password')).toHaveLength(2);
  await prompt.getByRole('button', { name: '知道了', exact: true }).click();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
});

test('会话固定期限到达后静默恢复访客并保留当前筛选输入', async ({ page, context }) => {
  const api = new AccountApi(context); api.signedIn = true; api.sessionExpiresAt = new Date(Date.now() + 2500).toISOString(); await api.install(); await open(page, api);
  await expect(page.getByRole('button', { name: 'fixture_player · 已开通', exact: true })).toBeVisible();
  await page.getByLabel('关键词', { exact: true }).fill('过期后仍保留');
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  await expect(page.getByLabel('关键词', { exact: true })).toHaveValue('过期后仍保留');
  await expect(page.getByRole('dialog')).toHaveCount(0); expect(api.calls.every(call => call.method === 'GET')).toBe(true);
});

test('图片上传401仅显示登录提示并保留文件，不拼接失败说明或自动重放', async ({ page, context }) => {
  const api = new AccountApi(context);
  api.attributeRows = [{ gameId: 'demo', attributeKey: 'attack', name: '测试属性', valueType: 'DECIMAL', minValue: 0, maxValue: null,
    description: null, status: 'ENABLED', sortOrder: 0, createdAt: expiry(), updatedAt: expiry() }];
  await api.install(); await open(page, api);
  await page.getByRole('row').filter({ has: page.getByText('测试属性', { exact: true }) }).getByRole('button', { name: '代表图片', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '测试属性 · 代表图片', exact: true });
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 4;
    canvas.getContext('2d')!.fillRect(0, 0, 4, 4); return canvas.toDataURL('image/png');
  });
  await editor.getByLabel('选择图片文件', { exact: true }).setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64') });
  await expect(editor.getByRole('button', { name: '上传并使用', exact: true })).toBeEnabled();
  await editor.getByRole('button', { name: '上传并使用', exact: true }).click();
  const prompt = page.getByRole('dialog').filter({ hasText: '需要登录' }); await expect(prompt).toBeVisible();
  await expect(editor.locator('.arco-alert-error')).toHaveCount(0);
  await prompt.getByRole('button', { name: '知道了', exact: true }).click();
  await expect(editor).toContainText('fixture.png'); await expect(editor.getByRole('button', { name: '上传并使用', exact: true })).toBeEnabled();
  expect(api.calls.filter(call => call.method === 'POST' && call.path.endsWith('/images'))).toHaveLength(1);
  expect(api.calls.filter(call => call.method === 'PUT' && call.path.endsWith('/representative-image'))).toHaveLength(0);
});
