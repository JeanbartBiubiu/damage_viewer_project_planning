export type MaintenanceSession = { principalId: string; displayName: string; expiresAt: string };
export type MaintenanceCandidateRequest = { method: string; path: string; body: string | null };

let session: MaintenanceSession | null = null;
let revision = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let batchId: string | null = null;
let captureOnly = false;
let candidate: MaintenanceCandidateRequest | null = null;
const listeners = new Set<() => void>();
const identityListeners = new Set<() => void>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAINTENANCE_CHANGE_STORAGE_KEY = 'damage-viewer.web.maintenance-change';

export function getMaintenanceSession(): MaintenanceSession | null { return session; }
export function getMaintenanceRevision(): number { return revision; }
export function getMaintenanceBatch(): string | null { return batchId; }
export function getMaintenanceCandidate(): MaintenanceCandidateRequest | null { return candidate; }
export function maintenanceCapturesOnly(): boolean { return captureOnly; }
export function subscribeMaintenanceState(listener: () => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
export function onMaintenanceSessionChanged(listener: () => void): () => void {
  identityListeners.add(listener); return () => { identityListeners.delete(listener); };
}
function notify(): void { listeners.forEach(listener => listener()); }

export function setMaintenanceSession(next: MaintenanceSession | null, broadcast = false): void {
  if (next && (!UUID.test(next.principalId) || !next.displayName || !Number.isFinite(Date.parse(next.expiresAt)) || Date.parse(next.expiresAt) <= Date.now())) next = null;
  const changed = JSON.stringify(next) !== JSON.stringify(session);
  session = next;
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  if (next) {
    const current = next;
    timer = setTimeout(() => { if (session === current) setMaintenanceSession(null); }, Math.max(0, Date.parse(next.expiresAt) - Date.now()));
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
  }
  if (changed) {
    revision += 1; batchId = null; candidate = null; captureOnly = true;
    identityListeners.forEach(listener => listener());
    notify();
  }
  if (broadcast && typeof window !== 'undefined') {
    try { window.localStorage.setItem(MAINTENANCE_CHANGE_STORAGE_KEY, crypto.randomUUID()); } catch { /* 仅广播失效，不依赖本地存储保留会话。 */ }
  }
}

export function setMaintenanceBatch(value: string): void {
  const normalized = value.trim();
  if (normalized && !UUID.test(normalized)) throw new Error('维护批次必须是完整的批次编号。');
  batchId = normalized || null;
  captureOnly = !batchId;
  notify();
}
export function setMaintenanceCaptureOnly(value: boolean): void { captureOnly = value; notify(); }
export function captureMaintenanceRequest(value: MaintenanceCandidateRequest): void {
  candidate = value; notify();
}
