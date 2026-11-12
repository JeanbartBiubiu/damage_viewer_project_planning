import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// 本文件只验证替身 Worker 的传输与生命周期；启用验签的授权由独立用例和真实产物覆盖。
vi.mock('./wasmIdentity', () => ({ WASM_IDENTITY: { authorizationRequired: false } }));
import type { CompileRequest, DoneResult, RunRequest } from '../types/genericEngine';
import {
  OUTBOX_GENERIC_COMPILE_RESULT,
  OUTBOX_GENERIC_DONE,
  OUTBOX_GENERIC_ERROR,
  OUTBOX_GENERIC_RELEASE_RESULT,
  type TinyGoV2Frame
} from './tinygoV2Bridge';
import {
  GenericEngineClient,
  GenericEngineClientError,
  RUN_TIMEOUT_MS,
  parseCompileResult,
  parseDoneResult,
  parseReleaseResult
} from './genericEngineClient';

function frame(kind: number, payload: unknown): TinyGoV2Frame {
  return {
    schemaVersion: 1,
    kind,
    flags: 0,
    payload: new TextEncoder().encode(JSON.stringify(payload))
  };
}

describe('genericEngineClient frame parsing', () => {
  it('returns collect-all compile errors when ok=false', () => {
    const result = parseCompileResult([
      frame(OUTBOX_GENERIC_COMPILE_RESULT, {
        ok: false,
        errors: [
          { ok: false, phase: 'compile', code: 'E1', message: 'one', severity: 'error', recoverable: true },
          { ok: false, phase: 'compile', code: 'E2', message: 'two', severity: 'error', recoverable: true }
        ]
      })
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  it('parses done and release frames by exact kind', () => {
    const done = parseDoneResult([
      frame(OUTBOX_GENERIC_DONE, {
        ok: true,
        summary: {
          durationMs: 100,
          stopReason: 'duration_reached',
          sourceFinalHp: 1,
          targetFinalHp: 2,
          sourceDamageDealt: 0,
          sourceDamageTaken: 0,
          targetDamageDealt: 0,
          targetDamageTaken: 0,
          abilityAttemptCount: 0,
          abilityCastCount: 0,
          attemptSkippedCount: 0,
          warningCount: 0,
          evidenceTruncated: false,
          seriesDownsampled: false,
          abilityStats: []
        },
        finalSnapshot: {},
        series: [],
        warnings: [],
        evidence: { items: [], truncated: false, truncatedEvidenceCount: 0, countsByKind: {} },
        seriesSamplingEvidence: { requestedSampleEveryMs: 100, effectiveSampleEveryMs: 100, requestedPointCount: 0, finalPointCount: 0, maxSeriesPoints: 5000, downsampled: false, method: 'uniform_time' }
      })
    ]);
    expect(done.ok).toBe(true);

    const released = parseReleaseResult([
      frame(OUTBOX_GENERIC_RELEASE_RESULT, { ok: true, sessionId: 's1', released: true })
    ]);
    expect(released.released).toBe(true);

    expect(() =>
      parseReleaseResult([frame(OUTBOX_GENERIC_DONE, { ok: true, sessionId: 's1', released: true })])
    ).toThrow(/release_result 帧（214）/);
  });

  it('rejects fatal generic_error frames', () => {
    expect(() =>
      parseCompileResult([
        frame(OUTBOX_GENERIC_ERROR, {
          ok: false,
          phase: 'abi',
          code: 'fatal',
          message: 'boom',
          severity: 'fatal',
          recoverable: false
        })
      ])
    ).toThrow(GenericEngineClientError);
  });

});

type PostedMessage = { type: string; id?: string; [key: string]: unknown };

class FakeWorker {
  static automaticReady = true;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly messages: PostedMessage[] = [];
  terminated = false;

  postMessage(message: PostedMessage) {
    this.messages.push(message);
    if (message.type === 'init' && FakeWorker.automaticReady) {
      queueMicrotask(() => this.emit({ type: 'ready', id: message.id }));
    }
  }

  emit(message: Record<string, unknown>) {
    this.onmessage?.({ data: message } as MessageEvent);
  }

  respond(type: 'compile' | 'run' | 'release', kind: number, payload: unknown,
    id = this.messages.filter((message) => message.type === type).at(-1)?.id) {
    const responseFrame = frame(kind, payload);
    this.emit(structuredClone({
      type: `${type}Result`,
      id,
      frames: [{ ...responseFrame, payload: responseFrame.payload.buffer }]
    }, { transfer: [responseFrame.payload.buffer] }));
  }

  terminate() {
    this.terminated = true;
  }
}

const compileRequest: CompileRequest = {
  schemaVersion: 'generic-p0',
  schemaHash: 's',
  rulesHash: 'r',
  typeCatalog: { types: [], relations: [] },
  combatants: [],
  rules: {}
};

const runRequest: RunRequest = {
  sessionId: 'session-1',
  expectedRulesHash: 'r',
  schemaVersion: 'generic-p0',
  schemaHash: 's',
  rulesHash: 'r',
  initialSnapshot: { schemaHash: 's', rulesHash: 'r', timeMs: 0, combatants: [] },
  driverPlan: { conditionRecheckIntervalMs: 100, entries: [] },
  stopPolicy: { durationMs: 1000, stopOnTargetDeath: true, stopWhenNoEvents: true },
  sampling: { sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 5000 }
};

const doneResult: DoneResult = {
  ok: true,
  summary: {
    durationMs: 1000,
    stopReason: 'duration_reached',
    sourceFinalHp: 1,
    targetFinalHp: 2,
    sourceDamageDealt: 0,
    sourceDamageTaken: 0,
    targetDamageDealt: 0,
    targetDamageTaken: 0,
    abilityAttemptCount: 0,
    abilityCastCount: 0,
    attemptSkippedCount: 0,
    warningCount: 0,
    evidenceTruncated: false,
    seriesDownsampled: false,
    abilityStats: []
  },
  finalSnapshot: runRequest.initialSnapshot,
  series: [],
  warnings: [],
  evidence: { items: [], truncated: false, truncatedEvidenceCount: 0, countsByKind: {} },
  seriesSamplingEvidence: { requestedSampleEveryMs: 100, effectiveSampleEveryMs: 100, requestedPointCount: 0, finalPointCount: 0, maxSeriesPoints: 5000, downsampled: false, method: 'uniform_time' }
};

describe('genericEngineClient worker lifecycle', () => {
  let client: GenericEngineClient;
  let workers: FakeWorker[];

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWorker.automaticReady = true;
    workers = [];
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          const worker = new FakeWorker();
          workers.push(worker);
          return worker;
        }
      }
    );
    client = new GenericEngineClient({ wasmUrl: 'https://example.test/engine.wasm' });
  });

  afterEach(() => {
    client.terminate();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function compileSession(): Promise<FakeWorker> {
    const compiled = client.compile(compileRequest);
    await vi.advanceTimersByTimeAsync(0);
    const worker = workers.at(-1)!;
    worker.respond('compile', OUTBOX_GENERIC_COMPILE_RESULT, { ok: true, sessionId: 'session-1' });
    await expect(compiled).resolves.toEqual({ ok: true, sessionId: 'session-1' });
    return worker;
  }

  async function skipDestroyedSessionRelease() {
    const release = vi.spyOn(client, 'release');
    if (client.hasLiveWorker) {
      await client.release('session-1', 'r');
    }
    expect(release).not.toHaveBeenCalled();
    expect(workers).toHaveLength(1);
    expect(workers[0].messages.some((message) => message.type === 'release')).toBe(false);
  }

  it('queries existing initialization, run and release without creating another worker', async () => {
    expect(client.hasLiveWorker).toBe(false);
    expect(workers).toHaveLength(0);

    const compiled = client.compile(compileRequest);
    expect(client.hasLiveWorker).toBe(true);
    expect(workers[0].messages.map((message) => message.type)).toEqual(['init']);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(0);
    workers[0].respond('compile', OUTBOX_GENERIC_COMPILE_RESULT, { ok: true, sessionId: 'session-1' });
    await expect(compiled).resolves.toEqual({ ok: true, sessionId: 'session-1' });
    expect(vi.getTimerCount()).toBe(0);

    const run = client.run(runRequest);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.hasLiveWorker).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    workers[0].respond('run', OUTBOX_GENERIC_DONE, doneResult);
    await expect(run).resolves.toEqual(doneResult);
    await vi.advanceTimersByTimeAsync(RUN_TIMEOUT_MS);
    expect(client.hasLiveWorker).toBe(true);
    expect(workers[0].terminated).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    const release = client.release('session-1', 'r');
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(workers[0].messages.at(-1)).toMatchObject({
      type: 'release', sessionId: 'session-1', expectedRulesHash: 'r'
    });
    workers[0].respond('release', OUTBOX_GENERIC_RELEASE_RESULT, {
      ok: true, sessionId: 'session-1', released: true
    });
    await expect(release).resolves.toEqual({ ok: true, sessionId: 'session-1', released: true });
    expect(client.hasLiveWorker).toBe(true);
    expect(workers).toHaveLength(1);

    client.terminate();
    expect(client.hasLiveWorker).toBe(false);
    expect(workers[0].terminated).toBe(true);
  });

  it('explicit termination rejects a pending run and skips the destroyed session release', async () => {
    const worker = await compileSession();
    const run = client.run(runRequest);
    const expectation = expect(run).rejects.toThrow('工作线程已终止');
    await vi.advanceTimersByTimeAsync(0);
    client.terminate();
    await expectation;
    expect(client.hasLiveWorker).toBe(false);
    expect(worker.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await skipDestroyedSessionRelease();
  });

  it('run timeout destroys the worker without rebuilding it to release the old session', async () => {
    const worker = await compileSession();
    const run = client.run(runRequest);
    const expectation = expect(run).rejects.toThrow(/运行超时（30 秒）/);
    await vi.advanceTimersByTimeAsync(RUN_TIMEOUT_MS - 1);
    expect(client.hasLiveWorker).toBe(true);
    expect(worker.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expectation;
    expect(client.hasLiveWorker).toBe(false);
    expect(worker.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await skipDestroyedSessionRelease();
  });

  it('worker crashes reject the run and leave no live worker for releasing the old session', async () => {
    const worker = await compileSession();
    const run = client.run(runRequest);
    const expectation = expect(run).rejects.toThrow('工作线程崩溃');
    await vi.advanceTimersByTimeAsync(0);
    worker.onerror?.({ message: '' } as ErrorEvent);
    await expectation;
    expect(client.hasLiveWorker).toBe(false);
    expect(worker.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await skipDestroyedSessionRelease();
  });

  it('worker errors with recreate destroy the worker and skip old session release', async () => {
    const worker = await compileSession();
    const run = client.run(runRequest);
    const expectation = expect(run).rejects.toThrow('不可恢复的运行错误');
    await vi.advanceTimersByTimeAsync(0);
    worker.emit({
      type: 'error',
      id: worker.messages.find((message) => message.type === 'run')?.id,
      message: '不可恢复的运行错误',
      recreate: true
    });
    await expectation;
    expect(client.hasLiveWorker).toBe(false);
    expect(worker.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await skipDestroyedSessionRelease();
  });

  it('ordinary run errors keep the same worker available for normal session release', async () => {
    const worker = await compileSession();
    const run = client.run(runRequest);
    const expectation = expect(run).rejects.toThrow('可恢复的运行错误');
    await vi.advanceTimersByTimeAsync(0);
    worker.emit({
      type: 'error',
      id: worker.messages.find((message) => message.type === 'run')?.id,
      message: '可恢复的运行错误'
    });
    await expectation;
    expect(client.hasLiveWorker).toBe(true);
    expect(worker.terminated).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    const release = client.release('session-1', 'r');
    await vi.advanceTimersByTimeAsync(0);
    worker.respond('release', OUTBOX_GENERIC_RELEASE_RESULT, {
      ok: true, sessionId: 'session-1', released: true
    });
    await expect(release).resolves.toMatchObject({ released: true });
    expect(workers).toHaveLength(1);
    expect(client.hasLiveWorker).toBe(true);
  });

  it('decodes transferred fatal-error frames as views and retains all frames and bytes', async () => {
    const worker = await compileSession();
    const run = client.run(runRequest);
    const rejected = run.catch((error: GenericEngineClientError) => error);
    await vi.advanceTimersByTimeAsync(0);
    const frames = [frame(200, { note: '中文\u0000🙂' }), frame(OUTBOX_GENERIC_ERROR, {
      ok: false, phase: 'run', code: 'TEST', message: '错误🙂', severity: 'fatal', recoverable: false
    })];
    const expected = frames.map((item) => [...item.payload]);
    const message = structuredClone({
      type: 'runResult', id: worker.messages.find((item) => item.type === 'run')?.id,
      frames: frames.map((item) => ({ ...item, payload: item.payload.buffer }))
    }, { transfer: frames.map((item) => item.payload.buffer) });
    expect(frames.map((item) => item.payload.byteLength)).toEqual([0, 0]);
    worker.emit(message);

    const error = await rejected;
    expect(error).toBeInstanceOf(GenericEngineClientError);
    const failure = error as GenericEngineClientError;
    expect(failure.engineError).toMatchObject({ code: 'TEST', message: '错误🙂' });
    expect(failure.frames?.map((item) => [...item.payload])).toEqual(expected);
    expect(failure.frames?.[0].payload.buffer).toBe(message.frames[0].payload);
    expect(failure.frames?.[1].payload.buffer).toBe(message.frames[1].payload);
    expect(client.hasLiveWorker).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recompiles and releases every session while retaining the same worker', async () => {
    const worker = await compileSession();
    const firstRelease = client.release('session-1', 'r');
    await vi.advanceTimersByTimeAsync(0);
    worker.respond('release', OUTBOX_GENERIC_RELEASE_RESULT, { ok: true, sessionId: 'session-1', released: true });
    await firstRelease;

    const secondCompile = client.compile(compileRequest);
    await vi.advanceTimersByTimeAsync(0);
    worker.respond('compile', OUTBOX_GENERIC_COMPILE_RESULT, { ok: true, sessionId: 'session-2' });
    await expect(secondCompile).resolves.toEqual({ ok: true, sessionId: 'session-2' });
    const secondRelease = client.release('session-2', 'r');
    await vi.advanceTimersByTimeAsync(0);
    worker.respond('release', OUTBOX_GENERIC_RELEASE_RESULT, { ok: true, sessionId: 'session-2', released: true });
    await secondRelease;

    expect(workers).toHaveLength(1);
    expect(worker.messages.map((item) => item.type)).toEqual(['init', 'compile', 'release', 'compile', 'release']);
    expect(worker.terminated).toBe(false);
    expect(client.hasLiveWorker).toBe(true);
  });

  it('waits for the same initialization before dispatching concurrent requests', async () => {
    FakeWorker.automaticReady = false;
    const first = client.compile(compileRequest);
    const second = client.compile(compileRequest);
    await vi.advanceTimersByTimeAsync(0);
    expect(workers).toHaveLength(1);
    const worker = workers[0];
    expect(worker.messages.map((item) => item.type)).toEqual(['init']);

    worker.emit({ type: 'ready', id: worker.messages[0].id });
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.messages.map((item) => item.type)).toEqual(['init', 'compile', 'compile']);
    const requests = worker.messages.filter((item) => item.type === 'compile');
    worker.respond('compile', OUTBOX_GENERIC_COMPILE_RESULT, { ok: true, sessionId: 'first' }, requests[0].id);
    worker.respond('compile', OUTBOX_GENERIC_COMPILE_RESULT, { ok: true, sessionId: 'second' }, requests[1].id);
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true, sessionId: 'first' }, { ok: true, sessionId: 'second' }
    ]);
  });

  it('does not dispatch or resurrect a request cancelled during initialization', async () => {
    FakeWorker.automaticReady = false;
    const compile = client.compile(compileRequest);
    const rejected = expect(compile).rejects.toThrow('工作线程已终止');
    const old = workers[0];
    const lateReady = old.onmessage!;
    client.terminate();
    lateReady({ data: { type: 'ready', id: old.messages[0].id } } as MessageEvent);
    await rejected;
    expect(old.messages.some((item) => item.type === 'compile')).toBe(false);
    expect(client.hasLiveWorker).toBe(false);

    FakeWorker.automaticReady = true;
    await compileSession();
    expect(workers).toHaveLength(2);
    expect(workers[1].terminated).toBe(false);
  });

  it('ignores old worker responses and error callbacks after a new worker starts', async () => {
    const old = await compileSession();
    const staleMessage = old.onmessage!;
    const staleError = old.onerror!;
    client.terminate();
    const compile = client.compile(compileRequest);
    const resolved = vi.fn();
    void compile.then(resolved);
    await vi.advanceTimersByTimeAsync(0);
    const current = workers[1];
    const id = current.messages.filter((item) => item.type === 'compile').at(-1)!.id;
    const fake = frame(OUTBOX_GENERIC_COMPILE_RESULT, { ok: true, sessionId: 'stale' });
    staleMessage({ data: { type: 'compileResult', id, frames: [{ ...fake, payload: fake.payload.buffer }] } } as MessageEvent);
    staleError({ message: 'old crash' } as ErrorEvent);
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).not.toHaveBeenCalled();
    expect(client.hasLiveWorker).toBe(true);
    expect(current.terminated).toBe(false);
    current.respond('compile', OUTBOX_GENERIC_COMPILE_RESULT, { ok: true, sessionId: 'fresh' });
    await expect(compile).resolves.toEqual({ ok: true, sessionId: 'fresh' });
  });

  it('a run timeout rejects every pending request before rebuilding', async () => {
    const worker = await compileSession();
    const run = client.run(runRequest);
    const compile = client.compile(compileRequest);
    const runRejected = expect(run).rejects.toThrow('运行超时（30 秒）');
    const compileRejected = expect(compile).rejects.toThrow('运行超时（30 秒）');
    await vi.advanceTimersByTimeAsync(RUN_TIMEOUT_MS);
    await Promise.all([runRejected, compileRejected]);
    expect(worker.terminated).toBe(true);
    expect(client.hasLiveWorker).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await compileSession();
    expect(workers).toHaveLength(2);
  });

  it('instance-invalid errors reject every pending request', async () => {
    const worker = await compileSession();
    const run = client.run(runRequest);
    const compile = client.compile(compileRequest);
    const runRejected = expect(run).rejects.toThrow('Wasm trap');
    const compileRejected = expect(compile).rejects.toThrow('Wasm trap');
    await vi.advanceTimersByTimeAsync(0);
    worker.emit({ type: 'error', id: worker.messages.find((item) => item.type === 'run')?.id,
      message: 'Wasm trap', recreate: true });
    await Promise.all([runRejected, compileRejected]);
    expect(worker.terminated).toBe(true);
    expect(client.hasLiveWorker).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a release failure invalidates the worker and rejects other pending requests', async () => {
    const worker = await compileSession();
    const release = client.release('session-1', 'r');
    const run = client.run(runRequest);
    const releaseRejected = expect(release).rejects.toThrow('释放返回 ok=false');
    const runRejected = expect(run).rejects.toThrow('释放返回 ok=false');
    await vi.advanceTimersByTimeAsync(0);
    worker.respond('release', OUTBOX_GENERIC_RELEASE_RESULT, { ok: false, sessionId: 'session-1', released: false });
    await Promise.all([releaseRejected, runRejected]);
    expect(worker.terminated).toBe(true);
    expect(client.hasLiveWorker).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await compileSession();
    expect(workers).toHaveLength(2);
  });

  it('rejects a mismatched release identity and invalidates that worker', async () => {
    const worker = await compileSession();
    const release = client.release('session-1', 'r');
    const rejected = expect(release).rejects.toThrow('释放响应不属于请求会话。');
    await vi.advanceTimersByTimeAsync(0);
    worker.respond('release', OUTBOX_GENERIC_RELEASE_RESULT, { ok: true, sessionId: 'different-session', released: true });
    await rejected;
    expect(worker.terminated).toBe(true);
    expect(client.hasLiveWorker).toBe(false);
    await compileSession();
    expect(workers).toHaveLength(2);
  });

  it('malformed worker replies reject the matching and all other pending requests', async () => {
    const worker = await compileSession();
    const run = client.run(runRequest);
    const compile = client.compile(compileRequest);
    const runRejected = expect(run).rejects.toBeInstanceOf(Error);
    const compileRejected = expect(compile).rejects.toBeInstanceOf(Error);
    await vi.advanceTimersByTimeAsync(0);
    worker.emit({ type: 'runResult', id: worker.messages.find((item) => item.type === 'run')?.id, frames: null });
    await Promise.all([runRejected, compileRejected]);
    expect(worker.terminated).toBe(true);
    expect(client.hasLiveWorker).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
