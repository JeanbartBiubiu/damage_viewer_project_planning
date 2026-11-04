import { ApiRequestError, readAuthCsrf, requestJson } from './apiClient';
import { AUTH_CHANGE_STORAGE_KEY, getAuthRevision, getAuthSession, setAuthSession, showLoginRequired } from './authState';
import type { SessionView } from './authState';
export { onAuthSessionChanged } from './authState';
export type { SessionView } from './authState';

export type FlowPurpose = 'register' | 'login' | 'reset_password' | 'replace_totp' | 'change_password' | 'change_totp' | 'regenerate_recovery_codes';
export type FlowView = { accountId: string; purpose: FlowPurpose; phase: 'started' | 'totp_verified' | 'recovery_codes_ready'; expiresAt: string };
export type CompletedFlow = { phase: 'completed' };
export type FlowStatus = FlowView | CompletedFlow;
export type TotpSetup = { otpauthUri: string; qrCodeDataUrl: string };
export type RecoveryCodes = { codes: string[]; expiresAt: string };
type Proof = { currentPassword: string; totpCode: string };
let flowCsrf: string | null | undefined;
export function clearAuthFlowBinding(): void { flowCsrf = undefined; }

async function authRequest<T>(api: string, path: string, authentication: 'bootstrap' | 'session' | 'flow', body?: unknown): Promise<T> {
  let expectedCsrf: string | null | undefined;
  if (authentication === 'flow') {
    expectedCsrf = path === 'flow/status' ? readAuthCsrf('flow') : flowCsrf;
    if (!expectedCsrf) throw new ApiRequestError('请先查询当前操作进度后继续。', 409, 'AUTH.FLOW_CONFLICT');
    if (expectedCsrf !== readAuthCsrf('flow')) throw new ApiRequestError('当前操作流程已被其他标签页更换，请查询当前进度后继续。', 409, 'AUTH.FLOW_CONFLICT');
  }
  const response = await requestJson<T>(api, `/api/auth/${path}`, {
    authentication, authFailure: 'silent', cache: 'no-store',
    ...(authentication === 'flow' ? { csrfToken: expectedCsrf } : {}),
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })
  });
  if (authentication === 'bootstrap' || authentication === 'flow') {
    const issuedCsrf = requireFlowCsrf(response.flowCsrf);
    if (authentication === 'flow' && issuedCsrf !== expectedCsrf) throw new ApiRequestError('操作流程已改变，请查询当前进度后继续。', 409, 'AUTH.FLOW_CONFLICT');
    if (authentication === 'bootstrap' || path === 'flow/status') flowCsrf = issuedCsrf;
  }
  return response.data;
}

function requireFlowCsrf(value: string | undefined): string {
  if (!value) throw new ApiRequestError('账号响应缺少流程防伪信息，请查询当前进度后重试。', 502, 'AUTH.RESPONSE_INVALID');
  return value;
}

export const registerAccount = (api: string, username: string, password: string): Promise<FlowView> => authRequest(api, 'register', 'bootstrap', { username, password });
export const startLogin = (api: string, username: string, password: string): Promise<FlowView> => authRequest(api, 'login', 'bootstrap', { username, password });
export async function finishLogin(api: string, totpCode: string): Promise<SessionView> {
  const next = await authRequest<SessionView>(api, 'login/totp', 'flow', { totpCode });
  if (next.canLogin !== 1) throw new ApiRequestError('账号尚未开通。', 403, 'AUTH.LOGIN_NOT_ENABLED');
  setAuthSession(next, true);
  return next;
}
export const getFlowStatus = (api: string): Promise<FlowStatus> => authRequest(api, 'flow/status', 'flow');
export const setupTotp = (api: string): Promise<TotpSetup> => authRequest(api, 'flow/totp/setup', 'flow', {});
export const verifyTotp = (api: string, totpCode: string): Promise<FlowView> => authRequest(api, 'flow/totp/verify', 'flow', { totpCode });
export const getRecoveryCodes = (api: string): Promise<RecoveryCodes> => authRequest(api, 'flow/recovery-codes', 'flow');
export async function confirmRecoveryCodes(api: string): Promise<CompletedFlow> {
  const completed = await authRequest<CompletedFlow>(api, 'flow/recovery-codes/confirm', 'flow', {});
  setAuthSession(null, true);
  return completed;
}
export async function completePasswordFlow(api: string, newPassword: string): Promise<CompletedFlow> {
  const completed = await authRequest<CompletedFlow>(api, 'flow/complete', 'flow', { newPassword });
  setAuthSession(null, true);
  return completed;
}
export const recoverPassword = (api: string, username: string, totpCode: string, recoveryCode: string): Promise<FlowView> => authRequest(api, 'recovery/password', 'bootstrap', { username, totpCode, recoveryCode });
export const recoverTotp = (api: string, username: string, password: string, recoveryCode: string): Promise<FlowView> => authRequest(api, 'recovery/totp', 'bootstrap', { username, password, recoveryCode });
export async function startSecurityFlow(api: string, kind: 'password' | 'totp' | 'recovery-codes', proof: Proof): Promise<FlowView> {
  const revision = getAuthRevision();
  try {
    const response = await requestJson<FlowView>(api, `/api/auth/security/${kind}`, {
      method: 'POST', body: JSON.stringify(proof), authentication: 'session', authFailure: 'silent', preserveSessionOn401: true, cache: 'no-store'
    });
    flowCsrf = requireFlowCsrf(response.flowCsrf);
    return response.data;
  } catch (error) {
    // 安全证明错误也返回 401，需用只读会话查询区分，不能重放原操作。
    if (error instanceof ApiRequestError && error.status === 401 && revision === getAuthRevision()) {
      const current = await restoreSession(api);
      if (!current) {
        setAuthSession(null, true);
        error.handledByLoginPrompt = true;
        showLoginRequired();
      }
    }
    throw error;
  }
}

export async function restoreSession(api: string): Promise<SessionView | null> {
  const revision = getAuthRevision();
  try {
    const next = await authRequest<SessionView>(api, 'me', 'session');
    if (revision !== getAuthRevision()) return getAuthSession();
    if (next.canLogin !== 1) { setAuthSession(null); return null; }
    setAuthSession(next);
    return getAuthSession();
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) return null;
    throw error;
  }
}
export async function logout(api: string, all = false): Promise<void> {
  await authRequest<null>(api, all ? 'logout-all' : 'logout', 'session', {});
  setAuthSession(null, true);
}
export async function getWasmGrant(apiBaseUrl: string): Promise<{ grant: string; expiresAt: string }> {
  const { data } = await requestJson<{ grant: string; expiresAt: string }>(apiBaseUrl, '/api/auth/wasm-grant', {
    method: 'POST', body: '{}', authentication: 'session', loginPrompt: 'compute', cache: 'no-store'
  });
  return data;
}

export function synchronizeAuthSession(api: string): () => void {
  const refresh = () => { void restoreSession(api).catch(() => undefined); };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== AUTH_CHANGE_STORAGE_KEY) return;
    setAuthSession(null);
    refresh();
  };
  const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
  window.addEventListener('storage', onStorage);
  document.addEventListener('visibilitychange', onVisibility);
  refresh();
  return () => {
    window.removeEventListener('storage', onStorage);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
