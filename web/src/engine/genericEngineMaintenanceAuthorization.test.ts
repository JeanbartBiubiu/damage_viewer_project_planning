import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GenericEngineClient } from './genericEngineClient';
import { getMaintenanceSession, setMaintenanceSession } from '../services/maintenanceState';
import type { CompileRequest } from '../types/genericEngine';

const issuance = vi.hoisted(() => ({ grant: vi.fn<() => Promise<{ grant: string; expiresAt: string }>>(), player: vi.fn() }));
vi.mock('../config/deployment', () => ({ DEPLOYMENT_MODE: 'maintenance' }));
vi.mock('./wasmIdentity', () => ({ WASM_IDENTITY: { authorizationRequired: true } }));
vi.mock('../services/maintenanceClient', () => ({ getMaintenanceWasmGrant: issuance.grant }));
vi.mock('../services/authClient', () => ({ getWasmGrant: issuance.player, onAuthSessionChanged: vi.fn() }));

const principal = 'e3e2a480-9bf4-49bb-a036-fef46b341da4';
const request: CompileRequest = { schemaVersion: 'generic-p0', schemaHash: 's', rulesHash: 'r', typeCatalog: { types: [], relations: [] }, combatants: [], rules: {} };
class MaintenanceWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  postMessage(message: { type: string; id: string }) {
    queueMicrotask(() => {
      if (message.type === 'init') this.onmessage?.({ data: { type: 'ready', id: message.id } } as MessageEvent);
      if (message.type === 'compile') this.onmessage?.({ data: { type: 'compileResult', id: message.id,
        frames: [{ schemaVersion: 1, kind: 210, flags: 0, payload: new TextEncoder().encode(JSON.stringify({ ok: true, sessionId: 'session' })).buffer }] } } as MessageEvent);
    });
  }
  terminate() { this.terminated = true; }
}
function ticket() {
  const session = getMaintenanceSession(); if (!session) throw new Error('缺少测试维护会话');
  const second = Math.floor(Date.now() / 1000);
  const exp = Math.min(second + 300, Math.floor(Date.parse(session.expiresAt) / 1000));
  const claims = { sub: session.principalId, subjectType: 'MAINTENANCE', authorizationVersion: 2, iat: second, nbf: second, exp };
  return { grant: `header.${btoa(JSON.stringify(claims))}.signature`, expiresAt: new Date(exp * 1000).toISOString() };
}

describe('私有计算客户端维护身份生命周期', () => {
  let client: GenericEngineClient;
  let workers: MaintenanceWorker[];
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-13T00:00:00Z')); workers = [];
    setMaintenanceSession({ principalId: principal, displayName: '维护', expiresAt: new Date(Date.now() + 600_000).toISOString() });
    issuance.grant.mockReset().mockImplementation(async () => ticket()); issuance.player.mockReset();
    vi.stubGlobal('Worker', class { constructor() { const worker = new MaintenanceWorker(); workers.push(worker); return worker; } });
    client = new GenericEngineClient({ apiBaseUrl: 'https://private.example' });
  });
  afterEach(() => { client.terminate(); setMaintenanceSession(null); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('维护版只取维护票据，正常复用、临期续取，不借用玩家授权', async () => {
    await client.compile(request); await client.compile(request);
    expect(issuance.grant).toHaveBeenCalledTimes(1); expect(issuance.player).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(295_000); await client.compile(request);
    expect(issuance.grant).toHaveBeenCalledTimes(2); expect(issuance.player).not.toHaveBeenCalled();
  });
  it('维护主体切换或退出销毁旧线程和票据，迟到取票不能复活旧计算', async () => {
    await client.compile(request); const old = workers[0];
    setMaintenanceSession({ principalId: '530a455c-4241-45b9-a2e5-90023c80c737', displayName: '另一维护者', expiresAt: new Date(Date.now() + 600_000).toISOString() });
    expect(old.terminated).toBe(true); await client.compile(request); expect(issuance.grant).toHaveBeenCalledTimes(2);
    const late = ticket(); let finish!: (value: typeof late) => void;
    issuance.grant.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await vi.advanceTimersByTimeAsync(295_000);
    const pending = client.compile(request); const rejected = expect(pending).rejects.toThrow('账号状态已变化');
    setMaintenanceSession(null); finish(late); await rejected;
    expect(client.hasLiveWorker).toBe(false);
  });
});
