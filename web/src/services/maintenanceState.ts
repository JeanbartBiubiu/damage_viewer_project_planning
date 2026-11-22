export type MaintenancePrincipal = { principalId: string; displayName: string };
export type MaintenanceCandidateRequest = { method: string; path: string; body: string | null };

let principal: MaintenancePrincipal | null = null;
let revision = 0;
let batchId: string | null = null;
let candidate: MaintenanceCandidateRequest | null = null;
const listeners = new Set<() => void>();
const identityListeners = new Set<() => void>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function getMaintenancePrincipal(): MaintenancePrincipal | null { return principal; }
export function getMaintenanceRevision(): number { return revision; }
export function getMaintenanceBatch(): string | null { return batchId; }
export function getMaintenanceCandidate(): MaintenanceCandidateRequest | null { return candidate; }
export function subscribeMaintenanceState(listener: () => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
export function onMaintenancePrincipalChanged(listener: () => void): () => void {
  identityListeners.add(listener); return () => { identityListeners.delete(listener); };
}
function notify(): void { listeners.forEach(listener => listener()); }

export function setMaintenancePrincipal(next: MaintenancePrincipal | null): void {
  const previous = principal;
  if (previous?.principalId === next?.principalId && previous?.displayName === next?.displayName) return;
  principal = next;
  // 第一次确认身份时，还没有任何票据或批次可以失效。
  if (previous && previous.principalId !== next?.principalId) {
    revision += 1;
    batchId = null;
    candidate = null;
    identityListeners.forEach(listener => listener());
  }
  notify();
}

export function setMaintenanceBatch(value: string): void {
  const normalized = value.trim();
  if (normalized && !UUID.test(normalized)) throw new Error('维护批次必须是完整的批次编号。');
  if (normalized && !principal) throw new Error('请先确认维护身份。');
  batchId = normalized || null;
  notify();
}
export function captureMaintenanceRequest(value: MaintenanceCandidateRequest): void {
  candidate = value; notify();
}
