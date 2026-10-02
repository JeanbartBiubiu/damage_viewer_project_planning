import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
        seriesSamplingEvidence: {}
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
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly messages: PostedMessage[] = [];
  terminated = false;

  postMessage(message: PostedMessage) {
    this.messages.push(message);
    if (message.type === 'init') {
      queueMicrotask(() => this.emit({ type: 'ready', id: message.id }));
    }
  }

  emit(message: Record<string, unknown>) {
    this.onmessage?.({ data: message } as MessageEvent);
  }

  respond(type: 'compile' | 'run' | 'release', kind: number, payload: unknown) {
    const responseFrame = frame(kind, payload);
    this.emit({
      type: `${type}Result`,
      id: this.messages.find((message) => message.type === type)?.id,
      frames: [{ ...responseFrame, payload: Array.from(responseFrame.payload) }]
    });
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
  seriesSamplingEvidence: {}
};

describe('genericEngineClient worker lifecycle', () => {
  let client: GenericEngineClient;
  let workers: FakeWorker[];

  beforeEach(() => {
    vi.useFakeTimers();
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
    const worker = workers[0];
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
});
