import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';
import { fulfillVisitReport } from '../fixtures/authSession';
import { installSimulationSelectionApi } from '../fixtures/simulationSelection';

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
  session() { return { accountId: ACCOUNT_ID, username: 'fixture_player', canLogin: 1, expiresAt: this.sessionExpiresAt }; }
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
    if (await fulfillVisitReport(route)) return;
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
async function open(page: Page, api: AccountApi) {
  await installSimulationSelectionApi(page, 'http://127.0.0.1:4185', 'demo');
  await page.unroute('**/api/auth/me');
  await page.goto('/#/simulation/basic-attack');
  await expect(page.getByRole('heading', { name: '普攻模拟', exact: true })).toBeVisible();
  expect(api.unexpected).toEqual([]);
}
async function keepSceneInput(page: Page, value: string) {
  await page.getByRole('button', { name: '报告问题', exact: true }).click();
  await page.getByLabel('问题说明', { exact: true }).fill(value);
  await page.getByRole('dialog').filter({ hasText: '报告计算或资料问题' }).getByRole('button', { name: '关闭', exact: true }).click();
}
async function expectSceneInput(page: Page, value: string) {
  await page.getByRole('button', { name: '报告问题', exact: true }).click();
  await expect(page.getByLabel('问题说明', { exact: true })).toHaveValue(value);
  await page.getByRole('dialog').filter({ hasText: '报告计算或资料问题' }).getByRole('button', { name: '关闭', exact: true }).click();
}
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

test('访客可读取与设置场景，公共端不提供配置写入或维护入口', async ({ page, context }) => {
  const api = new AccountApi(context); await api.install(); await open(page, api);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新增属性', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '刷新维护会话', exact: true })).toHaveCount(0);
  await page.goto('/#/attributes');
  await expect(page).toHaveURL(/#\/simulation\/combat-analysis$/);
  await expect(page.getByRole('button', { name: '新增属性', exact: true })).toHaveCount(0);
  expect(api.calls.filter(call => call.method !== 'GET' && !call.path.startsWith('/api/auth/'))).toHaveLength(0);
  expect(api.publicCredentialLeaks).toEqual([]);
});

test('右上角手动两步登录，表单错误局部展示，刷新恢复身份且场景输入保留', async ({ page, context }) => {
  const api = new AccountApi(context); await api.install(); await open(page, api);
  await keepSceneInput(page, '保留筛选');
  await page.getByRole('button', { name: '登录', exact: true }).click(); await credentials(page, 'bad');
  await dialog(page).getByRole('button', { name: '下一步', exact: true }).click();
  await expect(dialog(page).getByText('AUTH.INVALID_CREDENTIALS: 测试凭据无效或会话已结束。', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').filter({ hasText: '需要登录' })).toHaveCount(0);
  await credentials(page); await dialog(page).getByRole('button', { name: '下一步', exact: true }).click();
  await expect(page.getByRole('button', { name: '已开通', exact: true })).toHaveCount(0);
  await otp(page); await expect(page.getByRole('button', { name: '已开通', exact: true })).toBeVisible();
  await expectSceneInput(page, '保留筛选');
  expect(api.calls.find(call => call.path.endsWith('/login/totp'))?.body).toEqual({ totpCode: '001234' });
  expect(api.calls.find(call => call.path.endsWith('/login/totp'))?.csrf).toBe('fixture-flow-csrf');
  expect(api.calls.filter(call => call.path === '/api/auth/login').every(call => call.csrf === undefined)).toBe(true);
  await page.reload(); await expect(page.getByRole('button', { name: '已开通', exact: true })).toBeVisible();
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
  await expect(page.getByRole('button', { name: '已开通', exact: true })).toHaveCount(0);
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

test('注册拒绝第73字节并原样提交合法的72字节中文密码', async ({ page, context }) => {
  const api = new AccountApi(context); await api.install(); await open(page, api);
  await page.getByRole('button', { name: '注册', exact: true }).click(); await credentials(page);
  const tooLong = 'aB9!'.repeat(18) + 'Z';
  await dialog(page).getByLabel('密码', { exact: true }).fill(tooLong);
  await dialog(page).getByLabel('再次输入密码', { exact: true }).fill(tooLong);
  await expect(dialog(page).getByLabel('密码', { exact: true })).toHaveValue(tooLong);
  await dialog(page).getByRole('button', { name: '创建账号并绑定验证器', exact: true }).click();
  await expect(dialog(page)).toContainText('密码超过72字节');
  expect(api.calls.filter(call => call.path === '/api/auth/register')).toHaveLength(0);
  const accepted = '安全密码中文四字'.repeat(3);
  await dialog(page).getByLabel('密码', { exact: true }).fill(accepted);
  await dialog(page).getByLabel('再次输入密码', { exact: true }).fill(accepted);
  await expect(dialog(page)).toContainText('当前已用 72/72 字节');
  await dialog(page).getByRole('button', { name: '创建账号并绑定验证器', exact: true }).click();
  await expect(dialog(page).getByAltText('验证器绑定二维码', { exact: true })).toBeVisible();
  expect(api.calls.find(call => call.path === '/api/auth/register')?.body?.password).toBe(accepted);
});

test('重设密码共用字节边界并保留首尾空白', async ({ page, context }) => {
  const api = new AccountApi(context); await api.install(); await open(page, api);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await dialog(page).getByRole('button', { name: '忘记密码', exact: true }).click();
  await dialog(page).getByLabel('用户名', { exact: true }).fill('fixture_player');
  await dialog(page).getByLabel('验证器动态码', { exact: true }).fill('001234');
  await dialog(page).getByLabel('未使用的恢复码', { exact: true }).fill('fixture-recovery-1');
  await dialog(page).getByRole('button', { name: '验证并继续', exact: true }).click();
  await expect(dialog(page).getByLabel('新密码', { exact: true })).toBeVisible();
  const tooLong = 'aB9!'.repeat(18) + 'Z';
  await dialog(page).getByLabel('新密码', { exact: true }).fill(tooLong);
  await dialog(page).getByLabel('再次输入新密码', { exact: true }).fill(tooLong);
  await dialog(page).getByRole('button', { name: '保存新密码', exact: true }).click();
  await expect(dialog(page)).toContainText('密码超过72字节');
  expect(api.calls.filter(call => call.path === '/api/auth/flow/complete')).toHaveLength(0);
  const accepted = '  fixture password  ';
  await dialog(page).getByLabel('新密码', { exact: true }).fill(accepted);
  await dialog(page).getByLabel('再次输入新密码', { exact: true }).fill(accepted);
  await dialog(page).getByRole('button', { name: '保存新密码', exact: true }).click();
  await expect(dialog(page)).toContainText('操作已完成');
  expect(api.calls.find(call => call.path === '/api/auth/flow/complete')?.body?.newPassword).toBe(accepted);
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
  await page.getByRole('button', { name: '已开通', exact: true }).click(); await page.getByText('账号安全', { exact: true }).click();
  if (kind !== 'password') { await dialog(page).getByLabel('安全操作', { exact: true }).click(); await page.getByRole('option', { name: kind === 'totp' ? '更换验证器' : '重新生成恢复码', exact: true }).click(); }
  await dialog(page).getByLabel('当前密码', { exact: true }).fill(PASSWORD); await dialog(page).getByLabel('验证器动态码', { exact: true }).fill('001234');
  await dialog(page).getByRole('button', { name: '验证并继续', exact: true }).click();
  if (kind === 'password') {
    await dialog(page).getByLabel('新密码', { exact: true }).fill('new-fixture-password'); await dialog(page).getByLabel('再次输入新密码', { exact: true }).fill('new-fixture-password');
    await dialog(page).getByRole('button', { name: '保存新密码', exact: true }).click();
  } else { if (kind === 'totp') await otp(page); await saveCodes(page); }
  await expect(dialog(page)).toContainText('操作已完成'); await expect(page.getByRole('button', { name: '已开通', exact: true })).toHaveCount(0);
  expect(api.calls.find(call => call.path.endsWith(`/security/${kind}`))?.body).toEqual({ currentPassword: PASSWORD, totpCode: '001234' });
  expect(api.calls.find(call => call.path.endsWith(`/security/${kind}`))?.csrf).toBe('fixture-session-csrf');
});

test('全部退出跨标签页失效，保留两个页面的当前输入', async ({ page, context }) => {
  const api = new AccountApi(context); api.signedIn = true; await api.install(); await open(page, api);
  const second = await context.newPage(); await open(second, api);
  await keepSceneInput(page, '页面甲草稿'); await keepSceneInput(second, '页面乙草稿');
  await page.getByRole('button', { name: '已开通', exact: true }).click(); await page.getByText('退出全部设备', { exact: true }).click();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible(); await expect(second.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  await expectSceneInput(page, '页面甲草稿'); await expectSceneInput(second, '页面乙草稿');
  await expect(second.getByRole('dialog')).toHaveCount(0);
});

test('已开通玩家同样只有查看与计算入口，不能通过旧编辑网址取得配置维护', async ({ page, context }) => {
  const api = new AccountApi(context); api.signedIn = true; await api.install(); await open(page, api);
  await expect(page.getByRole('button', { name: '已开通', exact: true })).toBeVisible();
  await page.goto('/#/skills');
  await expect(page).toHaveURL(/#\/simulation\/combat-analysis$/);
  await expect(page.getByRole('button', { name: '新增技能', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('已验证维护批次')).toHaveCount(0);
  expect(api.calls.filter(call => call.path.startsWith('/internal/'))).toHaveLength(0);
});

test('安全证明错误仅在表单内提示，会话失效才出现需要登录且不重放原操作', async ({ page, context }) => {
  const api = new AccountApi(context); api.signedIn = true; api.securityProofFails = true; await api.install(); await open(page, api);
  await page.getByRole('button', { name: '已开通', exact: true }).click(); await page.getByText('账号安全', { exact: true }).click();
  await dialog(page).getByLabel('当前密码', { exact: true }).fill('wrong-fixture-password'); await dialog(page).getByLabel('验证器动态码', { exact: true }).fill('001234');
  await dialog(page).getByRole('button', { name: '验证并继续', exact: true }).click();
  await expect(dialog(page)).toContainText('AUTH.INVALID_CREDENTIALS: 测试凭据无效或会话已结束。');
  await expect(page.getByRole('button', { name: '已开通', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').filter({ hasText: '需要登录' })).toHaveCount(0);
  api.signedIn = false;
  await dialog(page).getByRole('button', { name: '验证并继续', exact: true }).click();
  const prompt = page.getByRole('dialog').filter({ hasText: '需要登录' }); await expect(prompt).toBeVisible();
  expect(api.calls.filter(call => call.path === '/api/auth/security/password')).toHaveLength(2);
  await prompt.getByRole('button', { name: '知道了', exact: true }).click();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
});

test('会话固定期限到达后静默恢复访客并保留当前场景输入', async ({ page, context }) => {
  const api = new AccountApi(context); api.signedIn = true; api.sessionExpiresAt = new Date(Date.now() + 2500).toISOString(); await api.install(); await open(page, api);
  await expect(page.getByRole('button', { name: '已开通', exact: true })).toBeVisible();
  await keepSceneInput(page, '过期后仍保留');
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  await expectSceneInput(page, '过期后仍保留');
  await expect(page.getByRole('dialog')).toHaveCount(0); expect(api.calls.every(call => call.method === 'GET')).toBe(true);
});

test('问题报告可下载场景复现材料，不附带玩家会话和恢复凭据', async ({ page, context }) => {
  const api = new AccountApi(context); api.signedIn = true; await api.install(); await open(page, api);
  await page.getByRole('button', { name: '报告问题', exact: true }).click();
  await page.getByLabel('问题说明', { exact: true }).fill('相同装备下伤害与预期不符');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载复现材料', exact: true }).click();
  const result = await download;
  expect(result.suggestedFilename()).toBe('damage-problem-report.json');
  const stream = await result.createReadStream();
  const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const content = Buffer.concat(chunks).toString('utf8');
  expect(content).toContain('相同装备下伤害与预期不符');
  expect(content).not.toMatch(/fixture-session|fixture-opaque|fixture-password|fixture-recovery|__Host-dv/);
  expect(JSON.parse(content).format).toBe('damage-problem-report-v1');
});
