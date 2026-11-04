import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, getErrorMessage, readAuthCsrf, requestJson } from './apiClient';
import {
  clearAuthFlowBinding, completePasswordFlow, confirmRecoveryCodes, finishLogin, getFlowStatus, getRecoveryCodes, getWasmGrant,
  logout, recoverPassword, recoverTotp, registerAccount, restoreSession, setupTotp, startLogin, startSecurityFlow,
  synchronizeAuthSession, verifyTotp
} from './authClient';
import { AUTH_CHANGE_STORAGE_KEY, getAuthSession, onAuthSessionChanged, onLoginRequired, setAuthSession, type SessionView } from './authState';

const api = 'https://damage.example';
const session = (): SessionView => ({ accountId: 'test-account', username: 'player', canLogin: 1, canEdit: false, expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
const json = (status: number, body?: unknown, csrf = readAuthCsrf('flow') ?? 'flow-csrf') => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'X-Damage-Flow-CSRF': csrf } });

beforeEach(() => { vi.stubGlobal('document', { cookie: '__Host-dv_flow_csrf=flow-csrf' }); });
afterEach(() => { setAuthSession(null); clearAuthFlowBinding(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('账号请求凭据边界', () => {
  it('公开GET与只读POST快照均忽略Cookie和CSRF，即使存在残留凭据', async () => {
    vi.stubGlobal('document', { cookie: '__Host-dv_csrf=test-session-csrf; __Host-dv_flow_csrf=test-flow-csrf' });
    const fetchMock = vi.fn(async (_url, init: RequestInit) => {
      expect(init.credentials).toBe('omit');
      const headers = new Headers(init.headers);
      expect(headers.get('Authorization')).toBeNull(); expect(headers.get('X-CSRF-Token')).toBeNull(); expect(headers.get('X-Damage-Client')).toBeNull();
      return json(200, {});
    });
    vi.stubGlobal('fetch', fetchMock);
    await requestJson(api, '/api/admin/games/demo/skills', { headers: { Authorization: 'discard-test-value', 'X-CSRF-Token': 'discard-test-value' } });
    await requestJson(api, '/api/admin/games/demo/simulation-snapshot', { method: 'POST', body: '{}' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('管理写入只附带正式会话CSRF，流程操作只附带流程CSRF，初始化不使用残留CSRF', async () => {
    vi.stubGlobal('document', { cookie: '__Host-dv_csrf=session-csrf; __Host-dv_flow_csrf=flow-csrf' });
    const calls: { path: string; csrf: string | null; body: unknown }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init: RequestInit) => {
      const headers = new Headers(init.headers);
      expect(init.credentials).toBe('include'); expect(headers.get('Authorization')).toBeNull();
      expect(headers.get('Content-Type')).toBe('application/json'); expect(headers.get('X-Damage-Client')).toBe('web');
      calls.push({ path: new URL(String(url)).pathname, csrf: headers.get('X-CSRF-Token'), body: JSON.parse(String(init.body)) });
      return json(200, {});
    }));
    await requestJson(api, '/api/admin/games/demo/attributes', { method: 'POST', body: '{}' });
    await startLogin(api, 'player', 'test-password'); await registerAccount(api, 'player', 'test-password');
    await recoverPassword(api, 'player', '001234', 'test-recovery'); await recoverTotp(api, 'player', 'test-password', 'test-recovery');
    await setupTotp(api); await verifyTotp(api, '000123');
    await startSecurityFlow(api, 'password', { currentPassword: 'test-password', totpCode: '001234' });
    expect(calls.map(call => call.csrf)).toEqual(['session-csrf', null, null, null, null, 'flow-csrf', 'flow-csrf', 'session-csrf']);
    expect(calls[3].body).toEqual({ username: 'player', totpCode: '001234', recoveryCode: 'test-recovery' });
    expect(calls[6].body).toEqual({ totpCode: '000123' });
    expect(calls[7].body).toEqual({ currentPassword: 'test-password', totpCode: '001234' });
  });
  it('受限读取不携带正式会话CSRF，完成态不要求仍有效的正式会话', async () => {
    vi.stubGlobal('document', { cookie: '__Host-dv_flow_csrf=flow-csrf' });
    const paths: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init: RequestInit) => {
      const path = new URL(String(url)).pathname; paths.push(path);
      expect(init.credentials).toBe('include');
      expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('flow-csrf');
      return json(200, { phase: 'completed' });
    }));
    await getFlowStatus(api); await getRecoveryCodes(api); await confirmRecoveryCodes(api); await completePasswordFlow(api, 'new-test-password');
    expect(paths).toEqual(['/api/auth/flow/status', '/api/auth/flow/recovery-codes', '/api/auth/flow/recovery-codes/confirm', '/api/auth/flow/complete']);
  });
  it('另一标签替换流程Cookie后不能确认未展示的新恢复码，明确回查后才接管新流程', async () => {
    const doc = { cookie: '__Host-dv_flow_csrf=first-flow-csrf' }; vi.stubGlobal('document', doc);
    const fetchMock = vi.fn(async (_url, init: RequestInit) => json(200, { phase: 'started', csrfHeader: new Headers(init.headers).get('X-CSRF-Token') }));
    vi.stubGlobal('fetch', fetchMock);
    await startLogin(api, 'player', 'test-password'); doc.cookie = '__Host-dv_flow_csrf=second-flow-csrf';
    await expect(confirmRecoveryCodes(api)).rejects.toMatchObject({ status: 409, code: 'AUTH.FLOW_CONFLICT' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await getFlowStatus(api); await verifyTotp(api, '001234');
    expect(new Headers(fetchMock.mock.calls[2][1].headers).get('X-CSRF-Token')).toBe('second-flow-csrf');
  });
  it('创建响应后Cookie被其他标签覆盖，也只能绑定该响应携带的原流程值', async () => {
    const doc = { cookie: '__Host-dv_flow_csrf=first-flow-csrf' }; vi.stubGlobal('document', doc);
    const fetchMock = vi.fn(async () => {
      const response = json(200, { accountId: 'first-account', purpose: 'register', phase: 'started' }, 'first-flow-csrf');
      doc.cookie = '__Host-dv_flow_csrf=second-flow-csrf'; return response;
    });
    vi.stubGlobal('fetch', fetchMock); await registerAccount(api, 'player', 'test-password');
    await expect(setupTotp(api)).rejects.toMatchObject({ code: 'AUTH.FLOW_CONFLICT' }); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('恢复材料响应头与绑定流程不同则拒绝向页面交付材料', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(200, { phase: 'started' })).mockResolvedValueOnce(json(200, { codes: ['other-flow-fixture'] }, 'other-flow-csrf')));
    await getFlowStatus(api); await expect(getRecoveryCodes(api)).rejects.toMatchObject({ code: 'AUTH.FLOW_CONFLICT' });
  });
  it('流程响应缺少绑定头时不能用当前Cookie补齐', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })));
    await expect(startLogin(api, 'player', 'test-password')).rejects.toMatchObject({ status: 502, code: 'AUTH.RESPONSE_INVALID' });
  });
});

describe('会话与登录提示', () => {
  it('初始化me401安静保持访客，密码错误也不显示全局提示', async () => {
    const prompt = vi.fn(), changed = vi.fn();
    const offPrompt = onLoginRequired(prompt), offChanged = onAuthSessionChanged(changed);
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: { code: 'AUTH.INVALID_CREDENTIALS', message: '凭据无效' } })));
    expect(await restoreSession(api)).toBeNull();
    await expect(startLogin(api, 'player', 'wrong')).rejects.toMatchObject({ status: 401 });
    expect(prompt).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
    offPrompt(); offChanged();
  });
  it('只有TOTP最后一步成功才发布已开通会话与账号变化', async () => {
    const changed = vi.fn(), next = session();
    const off = onAuthSessionChanged(changed);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(200, { accountId: 'test-account', purpose: 'login', phase: 'started' })).mockResolvedValueOnce(json(200, next)));
    await startLogin(api, 'player', 'test-password'); expect(getAuthSession()).toBeNull();
    await finishLogin(api, '001234'); expect(getAuthSession()).toEqual(next); expect(changed).toHaveBeenCalledTimes(1);
    off();
  });
  it('拒绝将canLogin为0的响应当作正式会话', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { ...session(), canLogin: 0 })));
    await getFlowStatus(api);
    await expect(finishLogin(api, '001234')).rejects.toMatchObject({ code: 'AUTH.LOGIN_NOT_ENABLED' });
    expect(getAuthSession()).toBeNull();
  });
  it('受保护401只提示一次且不自动重试，清除旧会话并通知Worker订阅方', async () => {
    setAuthSession(session());
    const prompt = vi.fn(), changed = vi.fn(), offPrompt = onLoginRequired(prompt), offChanged = onAuthSessionChanged(changed);
    const fetchMock = vi.fn(async () => json(401, { error: { code: 'AUTH.SESSION_INVALID', message: '会话失效' } })); vi.stubGlobal('fetch', fetchMock);
    const error = await getWasmGrant(api).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiRequestError); expect(getErrorMessage(error)).toBe('');
    expect(prompt).toHaveBeenCalledTimes(1); expect(prompt).toHaveBeenCalledWith('compute'); expect(changed).toHaveBeenCalledTimes(1);
    expect(getAuthSession()).toBeNull(); expect(fetchMock).toHaveBeenCalledTimes(1);
    offPrompt(); offChanged();
  });
  it.each(['AUTH.LOGIN_NOT_ENABLED', 'AUTH.ACCOUNT_DISABLED', 'AUTH.EDIT_REQUIRED'])('403按原因展示且不误报需要登录：%s', async code => {
    const prompt = vi.fn(), off = onLoginRequired(prompt);
    vi.stubGlobal('fetch', vi.fn(async () => json(403, { error: { code, message: '拒绝' } })));
    const cause = await getWasmGrant(api).catch((error: unknown) => error);
    expect(getErrorMessage(cause)).toMatch(/开通|禁用|编辑资格/); expect(prompt).not.toHaveBeenCalled(); off();
  });
  it('会话到期主动失效，不弹登录提示，也不等待下次取数', () => {
    vi.useFakeTimers(); const prompt = vi.fn(), changed = vi.fn();
    const offPrompt = onLoginRequired(prompt), offChanged = onAuthSessionChanged(changed);
    setAuthSession({ ...session(), expiresAt: new Date(Date.now() + 1000).toISOString() }); changed.mockClear();
    vi.advanceTimersByTime(1000); expect(getAuthSession()).toBeNull(); expect(changed).toHaveBeenCalledTimes(1); expect(prompt).not.toHaveBeenCalled();
    offPrompt(); offChanged();
  });
  it('退出与全部退出使用正式会话CSRF且撤销本地身份', async () => {
    const paths: string[] = [];
    vi.stubGlobal('document', { cookie: '__Host-dv_csrf=session-csrf' });
    vi.stubGlobal('fetch', vi.fn(async (url, init: RequestInit) => {
      paths.push(new URL(String(url)).pathname); expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('session-csrf'); return json(204);
    }));
    setAuthSession(session()); await logout(api); expect(getAuthSession()).toBeNull();
    setAuthSession(session()); await logout(api, true); expect(getAuthSession()).toBeNull();
    expect(paths).toEqual(['/api/auth/logout', '/api/auth/logout-all']);
  });
  it('旧me请求迟到的401不能清除刚登录的新身份', async () => {
    let rejectMe!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { rejectMe = resolve; })));
    const pending = restoreSession(api); const next = session(); setAuthSession(next);
    rejectMe(json(401, { error: { code: 'AUTH.SESSION_INVALID' } })); await pending;
    expect(getAuthSession()).toEqual(next);
  });
  it('安全证明错误不撤销有效会话，不显示登录提示或重放操作', async () => {
    const next = session(); setAuthSession(next);
    const prompt = vi.fn(), off = onLoginRequired(prompt);
    const fetchMock = vi.fn().mockResolvedValueOnce(json(401, { error: { code: 'AUTH.INVALID_CREDENTIALS', message: '证明错误' } })).mockResolvedValueOnce(json(200, next));
    vi.stubGlobal('fetch', fetchMock);
    await expect(startSecurityFlow(api, 'password', { currentPassword: 'wrong', totpCode: '001234' })).rejects.toMatchObject({ message: '证明错误' });
    expect(getAuthSession()).toEqual(next); expect(prompt).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.map(call => new URL(call[0]).pathname)).toEqual(['/api/auth/security/password', '/api/auth/me']); off();
  });
  it('安全操作回查确认会话失效后只显示登录提示', async () => {
    setAuthSession(session()); const prompt = vi.fn(), off = onLoginRequired(prompt);
    const fetchMock = vi.fn(async () => json(401, { error: { code: 'AUTH.INVALID_CREDENTIALS', message: '凭据无效' } })); vi.stubGlobal('fetch', fetchMock);
    const error = await startSecurityFlow(api, 'totp', { currentPassword: 'test-password', totpCode: '001234' }).catch((cause: unknown) => cause);
    expect(getAuthSession()).toBeNull(); expect(getErrorMessage(error)).toBe(''); expect(prompt).toHaveBeenCalledTimes(1); expect(fetchMock).toHaveBeenCalledTimes(2); off();
  });
  it('安全操作回查得到禁用原因时保留403说明，不误报需要登录', async () => {
    setAuthSession(session()); const prompt = vi.fn(), off = onLoginRequired(prompt);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(401, { error: { code: 'AUTH.INVALID_CREDENTIALS' } })).mockResolvedValueOnce(json(403, { error: { code: 'AUTH.ACCOUNT_DISABLED' } })));
    const error = await startSecurityFlow(api, 'totp', { currentPassword: 'test-password', totpCode: '001234' }).catch((cause: unknown) => cause);
    expect(getErrorMessage(error)).toContain('禁用'); expect(prompt).not.toHaveBeenCalled(); off();
  });
  it('双标签页变更先使旧身份失效，再静默回查；广播不包含账号材料', async () => {
    const target = new EventTarget(), doc = Object.assign(new EventTarget(), { visibilityState: 'visible', cookie: '' });
    const setItem = vi.fn();
    vi.stubGlobal('window', Object.assign(target, { localStorage: { setItem } })); vi.stubGlobal('document', doc);
    const next = session(); vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(200, next)).mockResolvedValueOnce(json(401, { error: { code: 'AUTH.SESSION_INVALID' } })));
    const stop = synchronizeAuthSession(api); await vi.waitFor(() => expect(getAuthSession()).toEqual(next));
    setAuthSession(next, true); expect(setItem.mock.calls[0][0]).toBe(AUTH_CHANGE_STORAGE_KEY);
    expect(String(setItem.mock.calls[0][1])).not.toContain(next.username);
    target.dispatchEvent(Object.assign(new Event('storage'), { key: AUTH_CHANGE_STORAGE_KEY }));
    expect(getAuthSession()).toBeNull(); stop();
  });
});
