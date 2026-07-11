import { describe, expect, it, vi } from 'vitest';
import {
  OUTBOX_GENERIC_COMPILE_RESULT,
  OUTBOX_GENERIC_DONE,
  OUTBOX_GENERIC_ERROR,
  OUTBOX_GENERIC_RELEASE_RESULT,
  type TinyGoV2Frame
} from './tinygoV2Bridge';
import {
  GenericEngineClientError,
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

  it('run timeout recreates worker and rejects pending run', async () => {
    vi.useFakeTimers();

    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      terminated = false;
      postMessage(message: { type: string; id: string }) {
        if (message.type === 'init') {
          queueMicrotask(() => {
            this.onmessage?.({ data: { type: 'ready', id: message.id } } as MessageEvent);
          });
        }
        // run never responds — timeout path
      }
      terminate() {
        this.terminated = true;
      }
    }

    const workers: FakeWorker[] = [];
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

    const { GenericEngineClient } = await import('./genericEngineClient');
    const client = new GenericEngineClient({ wasmUrl: 'https://example.test/engine.wasm' });

    const runPromise = client.run({
      sessionId: 's',
      expectedRulesHash: 'r',
      schemaVersion: 'generic-p0',
      schemaHash: 's',
      rulesHash: 'r',
      initialSnapshot: {
        schemaHash: 's',
        rulesHash: 'r',
        timeMs: 0,
        combatants: []
      },
      driverPlan: { conditionRecheckIntervalMs: 100, entries: [] },
      stopPolicy: { durationMs: 1000, stopOnTargetDeath: true, stopWhenNoEvents: true },
      sampling: { sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 5000 }
    });
    const expectation = expect(runPromise).rejects.toThrow(/运行超时（30 秒）/);
    await vi.advanceTimersByTimeAsync(30_000);
    await expectation;
    expect(workers[0]?.terminated).toBe(true);

    client.terminate();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
