export type SessionView = {
  accountId: string;
  username: string;
  canLogin: 1;
  canEdit: boolean;
  expiresAt: string;
};

export type LoginPromptKind = 'operation' | 'compute';

let session: SessionView | null = null;
let revision = 0;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
const stateListeners = new Set<() => void>();
const sessionListeners = new Set<() => void>();
const promptListeners = new Set<(kind: LoginPromptKind) => void>();
export const AUTH_CHANGE_STORAGE_KEY = 'damage-viewer.web.auth-change';

export function getAuthSession(): SessionView | null { return session; }
export function getAuthRevision(): number { return revision; }
export function subscribeAuthState(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => { stateListeners.delete(listener); };
}
export function onAuthSessionChanged(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => { sessionListeners.delete(listener); };
}
export function onLoginRequired(listener: (kind: LoginPromptKind) => void): () => void {
  promptListeners.add(listener);
  return () => { promptListeners.delete(listener); };
}
export function showLoginRequired(kind: LoginPromptKind = 'operation'): void {
  promptListeners.forEach(listener => listener(kind));
}

export function setAuthSession(next: SessionView | null, broadcast = false): void {
  if (next && (!Number.isFinite(Date.parse(next.expiresAt)) || Date.parse(next.expiresAt) <= Date.now())) next = null;
  const changed = JSON.stringify(session) !== JSON.stringify(next);
  session = next;
  if (changed) revision += 1;
  if (expiryTimer !== undefined) clearTimeout(expiryTimer);
  expiryTimer = undefined;
  if (next) {
    const remaining = Date.parse(next.expiresAt) - Date.now();
    expiryTimer = setTimeout(() => setAuthSession(null, true), Math.min(remaining, 2_147_483_647));
    // Node 验证不因浏览器会话计时器持续等待。
    if (typeof expiryTimer === 'object' && 'unref' in expiryTimer) expiryTimer.unref();
  }
  if (changed) {
    stateListeners.forEach(listener => listener());
    sessionListeners.forEach(listener => listener());
  }
  if (broadcast && typeof window !== 'undefined') {
    try { window.localStorage.setItem(AUTH_CHANGE_STORAGE_KEY, crypto.randomUUID()); } catch { /* 不依赖本地存储维持登录。 */ }
  }
}
