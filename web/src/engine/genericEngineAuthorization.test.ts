import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../services/apiClient';
import type { CompileRequest, RunRequest } from '../types/genericEngine';
import { GenericEngineClient } from './genericEngineClient';

const authorization = vi.hoisted(() => ({
  identity: { authorizationRequired: true },
  grant: vi.fn<(api: string) => Promise<{ grant: string; expiresAt: string }>>(),
  listeners: new Set<() => void>()
}));

vi.mock('./wasmIdentity', () => ({ WASM_IDENTITY: authorization.identity }));
vi.mock('../services/authClient', () => ({
  getWasmGrant: authorization.grant,
  onAuthSessionChanged: (listener: () => void) => {
    authorization.listeners.add(listener);
    return () => { authorization.listeners.delete(listener); };
  }
}));

type Message = { type: string; id: string; request?: CompileRequest | RunRequest };

class AuthorizationWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  messages: Message[] = [];
  terminated = false;

  postMessage(message: Message) {
    this.messages.push(message);
    if (message.type === 'init') queueMicrotask(() => this.emit({ type: 'ready', id: message.id }));
  }
  emit(value: unknown) { this.onmessage?.({ data: value } as MessageEvent); }
  respond(type: 'compile' | 'release', payload: unknown, id?: string) {
    this.emit({ type: `${type}Result`, id: id ?? this.messages.filter(message => message.type === type).at(-1)?.id,
      frames: [{ schemaVersion: 1, kind: type === 'compile' ? 210 : 214, flags: 0,
        payload: new TextEncoder().encode(JSON.stringify(payload)).buffer }] });
  }
  terminate() { this.terminated = true; }
}

const compileRequest: CompileRequest = {
  schemaVersion: 'generic-p0', schemaHash: 's', rulesHash: 'r', typeCatalog: { types: [], relations: [] }, combatants: [], rules: {}
};
const runRequest: RunRequest = {
  sessionId: 'session-1', expectedRulesHash: 'r', schemaVersion: 'generic-p0', schemaHash: 's', rulesHash: 'r',
  initialSnapshot: { schemaHash: 's', rulesHash: 'r', timeMs: 0, combatants: [] },
  driverPlan: { conditionRecheckIntervalMs: 100, entries: [] },
  stopPolicy: { durationMs: 1000, stopOnTargetDeath: true, stopWhenNoEvents: true },
  sampling: { sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 5000 }
};

describe('计算授权与账号生命周期', () => {
  let client: GenericEngineClient;
  let workers: AuthorizationWorker[];
  const ticket = (value = 'signed-fixture-ticket', lifetime = 300_000) => ({ grant: value, expiresAt: new Date(Date.now() + lifetime).toISOString() });
  const accountChanged = () => { for (const listener of [...authorization.listeners]) listener(); };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T00:00:00Z'));
    authorization.identity.authorizationRequired = true;
    authorization.grant.mockReset().mockImplementation(async () => ticket());
    workers = [];
    vi.stubGlobal('Worker', class { constructor() { const worker = new AuthorizationWorker(); workers.push(worker); return worker; } });
    client = new GenericEngineClient({ apiBaseUrl: 'https://api.example.test', wasmUrl: 'https://assets.example.test/engine.wasm' });
  });
  afterEach(() => {
    client.terminate();
    expect(authorization.listeners.size).toBe(0);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function compile() {
    const pending = client.compile(compileRequest);
    await vi.advanceTimersByTimeAsync(0);
    const worker = workers.at(-1)!;
    worker.respond('compile', { ok: true, sessionId: 'session-1' });
    await pending;
    return worker;
  }

  it('关闭版匿名调用不申请授权，也不改原输入', async () => {
    authorization.identity.authorizationRequired = false;
    const pending = client.compile(compileRequest);
    expect(client.hasLiveWorker).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(authorization.grant).not.toHaveBeenCalled();
    expect(workers[0].messages.find(message => message.type === 'compile')?.request).toBe(compileRequest);
    workers[0].respond('compile', { ok: true, sessionId: 'session-1' });
    await pending;
    expect(compileRequest.authorization).toBeUndefined();
  });

  it('启用版传入原始票据，编译与运行复用未过期授权', async () => {
    const worker = await compile();
    expect(authorization.grant).toHaveBeenCalledWith('https://api.example.test');
    expect(worker.messages.find(message => message.type === 'compile')?.request?.authorization).toBe('signed-fixture-ticket');
    expect(compileRequest.authorization).toBeUndefined();
    const running = client.run(runRequest);
    const rejected = expect(running).rejects.toThrow('fixture-finished');
    await vi.advanceTimersByTimeAsync(0);
    const sent = worker.messages.find(message => message.type === 'run')!;
    expect(sent.request?.authorization).toBe('signed-fixture-ticket');
    expect(runRequest.authorization).toBeUndefined();
    worker.emit({ type: 'error', id: sent.id, message: 'fixture-finished' });
    await rejected;
    expect(authorization.grant).toHaveBeenCalledTimes(1);
  });

  it('并发编译只发起一次授权请求', async () => {
    const first = client.compile(compileRequest), second = client.compile(compileRequest);
    await vi.advanceTimersByTimeAsync(0);
    expect(authorization.grant).toHaveBeenCalledTimes(1);
    expect(workers).toHaveLength(1);
    const messages = workers[0].messages.filter(message => message.type === 'compile');
    expect(messages).toHaveLength(2);
    for (const [index, message] of messages.entries()) workers[0].respond('compile', { ok: true, sessionId: `s${index}` }, message.id);
    await Promise.all([first, second]);
  });

  it('授权接近到期时续取，释放过期会话不取票据', async () => {
    authorization.grant.mockResolvedValueOnce(ticket('first-ticket', 30_000));
    const worker = await compile();
    await vi.advanceTimersByTimeAsync(26_000);
    authorization.grant.mockResolvedValueOnce(ticket('renewed-ticket'));
    const running = client.run(runRequest);
    const rejected = expect(running).rejects.toThrow('fixture-finished');
    await vi.advanceTimersByTimeAsync(0);
    const sent = worker.messages.find(message => message.type === 'run')!;
    expect(sent.request?.authorization).toBe('renewed-ticket');
    worker.emit({ type: 'error', id: sent.id, message: 'fixture-finished' });
    await rejected;
    await vi.advanceTimersByTimeAsync(300_000);
    const released = client.release('session-1', 'r');
    await vi.advanceTimersByTimeAsync(0);
    worker.respond('release', { ok: true, sessionId: 'session-1', released: true });
    await released;
    expect(authorization.grant).toHaveBeenCalledTimes(2);
  });

  it('需要登录时不创建工作线程、不自动重试', async () => {
    authorization.grant.mockRejectedValueOnce(new ApiRequestError('需要登录', 401, 'AUTH.UNAUTHORIZED'));
    await expect(client.compile(compileRequest)).rejects.toMatchObject({ status: 401 });
    expect(workers).toHaveLength(0);
    expect(authorization.grant).toHaveBeenCalledTimes(1);
  });

  it('账号变化拒绝正在运行的旧工作线程结果', async () => {
    const worker = await compile();
    const running = client.run(runRequest);
    const rejected = expect(running).rejects.toThrow('账号状态已变化');
    await vi.advanceTimersByTimeAsync(0);
    accountChanged();
    await rejected;
    expect(worker.terminated).toBe(true);
    expect(client.hasLiveWorker).toBe(false);
    expect(worker.messages.filter(message => message.type === 'run')).toHaveLength(1);
  });

  it('退出期间迟到的授权响应不能复活计算', async () => {
    let resolveGrant!: (value: { grant: string; expiresAt: string }) => void;
    authorization.grant.mockImplementationOnce(() => new Promise(resolve => { resolveGrant = resolve; }));
    const compiling = client.compile(compileRequest);
    const rejected = expect(compiling).rejects.toThrow('账号状态已变化');
    accountChanged();
    resolveGrant(ticket());
    await rejected;
    expect(workers).toHaveLength(0);
    await compile();
    expect(authorization.grant).toHaveBeenCalledTimes(2);
  });

  it('失效的授权响应不进入工作线程', async () => {
    authorization.grant.mockResolvedValueOnce(ticket('expired-ticket', -1));
    await expect(client.compile(compileRequest)).rejects.toMatchObject({ code: 'AUTH.INVALID_WASM_GRANT' });
    expect(workers).toHaveLength(0);
  });

  it('服务时钟略快时等待票据生效，再提交一次编译', async () => {
    authorization.grant.mockResolvedValueOnce(ticket('future-ticket', 301_000));
    const compiling = client.compile(compileRequest);
    await vi.advanceTimersByTimeAsync(999);
    expect(workers).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(workers).toHaveLength(1);
    const sent = workers[0].messages.filter(message => message.type === 'compile');
    expect(sent).toHaveLength(1);
    expect(sent[0].request?.authorization).toBe('future-ticket');
    workers[0].respond('compile', { ok: true, sessionId: 'session-1' });
    await compiling;
    expect(authorization.grant).toHaveBeenCalledTimes(1);
  });

  it('时钟提前超过五秒时拒绝计算并提示同步时间', async () => {
    authorization.grant.mockResolvedValueOnce(ticket('far-future-ticket', 305_001));
    await expect(client.compile(compileRequest)).rejects.toMatchObject({ code: 'AUTH.CLOCK_SKEW' });
    expect(workers).toHaveLength(0);
  });

  it('等待票据生效期间退出，旧票据不能创建工作线程', async () => {
    authorization.grant.mockResolvedValueOnce(ticket('future-ticket', 301_000));
    const compiling = client.compile(compileRequest);
    const rejected = expect(compiling).rejects.toThrow('账号状态已变化');
    await vi.advanceTimersByTimeAsync(0);
    accountChanged();
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(workers).toHaveLength(0);
    await compile();
    expect(authorization.grant).toHaveBeenCalledTimes(2);
  });
});
