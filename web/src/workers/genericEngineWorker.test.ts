import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TinyGoV2Frame } from '../engine/tinygoV2Bridge';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  compile: vi.fn(),
  run: vi.fn(),
  releaseSession: vi.fn()
}));

vi.mock('../engine/tinygoV2Bridge', () => ({
  TinyGoV2Bridge: { create: mocks.create }
}));

type Response = {
  type: string;
  id?: string;
  message?: string;
  recreate?: boolean;
  frames?: { schemaVersion: number; kind: number; flags: number; payload: ArrayBuffer }[];
};

function frame(kind: number, payload: unknown, flags = 0): TinyGoV2Frame {
  return { schemaVersion: 1, kind, flags, payload: new TextEncoder().encode(JSON.stringify(payload)) };
}

describe('genericEngineWorker buffer transfer', () => {
  let received: Response[];
  let transferLists: ArrayBuffer[][];
  let worker: {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage: (message: Response, options?: { transfer?: ArrayBuffer[] }) => void;
    close: () => void;
  };

  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    received = [];
    transferLists = [];
    worker = {
      onmessage: null,
      postMessage(message, options) {
        const transfer = options?.transfer ?? [];
        transferLists.push(transfer);
        // Use the real transfer operation, so duplicate buffers and detached storage fail here.
        received.push(structuredClone(message, { transfer }));
      },
      close: vi.fn()
    };
    vi.stubGlobal('self', worker);
    mocks.create.mockResolvedValue({
      compile: mocks.compile,
      run: mocks.run,
      releaseSession: mocks.releaseSession
    });
    await import('./genericEngineWorker');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function dispatch(message: Record<string, unknown>) {
    const previous = received.length;
    worker.onmessage?.({ data: message } as MessageEvent);
    await vi.waitFor(() => expect(received).toHaveLength(previous + 1));
    return received.at(-1)!;
  }

  async function initialize() {
    await expect(dispatch({ type: 'init', id: 'init', wasmUrl: '/engine.wasm' })).resolves.toEqual({
      type: 'ready', id: 'init'
    });
  }

  function method(type: 'compile' | 'run' | 'release') {
    return type === 'release' ? mocks.releaseSession : mocks[type];
  }

  it.each(['compile', 'run', 'release'] as const)('transfers all %s frames without changing bytes or order', async (type) => {
    await initialize();
    const frames = [frame(200, { note: '中文\u0000🙂' }, 7), frame(211, { ok: true }), frame(213, { retained: [1, 2] })];
    const bytes = frames.map((item) => [...item.payload]);
    method(type).mockReturnValue(frames);
    const response = await dispatch({ type, id: 'request', request: {}, sessionId: 'session', expectedRulesHash: 'rules' });

    expect(response.type).toBe(`${type}Result`);
    expect(response.id).toBe('request');
    expect(response.frames?.map(({ schemaVersion, kind, flags }) => ({ schemaVersion, kind, flags })))
      .toEqual(frames.map(({ schemaVersion, kind, flags }) => ({ schemaVersion, kind, flags })));
    expect(response.frames?.map((item) => [...new Uint8Array(item.payload)])).toEqual(bytes);
    expect(transferLists.at(-1)).toHaveLength(3);
    expect(frames.map((item) => item.payload.byteLength)).toEqual([0, 0, 0]);
    expect(response.frames?.every((item) => item.payload instanceof ArrayBuffer)).toBe(true);
  });

  it.each(['compile', 'run', 'release'] as const)('transfers all invocation-error %s frames in their original order', async (type) => {
    await initialize();
    const frames = [frame(200, { partial: '完整正文' }), frame(212, { ok: false, code: 'fatal', message: '失败🙂' })];
    const bytes = frames.map((item) => [...item.payload]);
    method(type).mockImplementation(() => { throw { frames, message: 'invocation failed' }; });
    const response = await dispatch({ type, id: 'failed', request: {}, sessionId: 'session' });

    expect(response.type).toBe(`${type}Result`);
    expect(response.frames?.map((item) => item.kind)).toEqual([200, 212]);
    expect(response.frames?.map((item) => [...new Uint8Array(item.payload)])).toEqual(bytes);
    expect(frames.map((item) => item.payload.byteLength)).toEqual([0, 0]);
  });

  it('transfers a shared buffer once even if two frames reference it', async () => {
    await initialize();
    const first = frame(200, { shared: '正文' });
    mocks.run.mockReturnValue([first, { ...first, kind: 211 }]);
    const response = await dispatch({ type: 'run', id: 'shared', request: {} });
    expect(transferLists.at(-1)).toHaveLength(1);
    expect(first.payload.byteLength).toBe(0);
    expect(response.frames?.[0].payload).toBe(response.frames?.[1].payload);
    expect(JSON.parse(new TextDecoder().decode(response.frames?.[1].payload))).toEqual({ shared: '正文' });
  });

  it('retains ordinary error messages and allows the next invocation', async () => {
    await initialize();
    mocks.run.mockImplementationOnce(() => { throw new Error('ordinary failure'); });
    const failed = await dispatch({ type: 'run', id: 'failed', request: {} });
    expect(failed).toEqual({ type: 'error', id: 'failed', message: 'ordinary failure', recreate: false });
    expect(transferLists.at(-1)).toEqual([]);

    mocks.run.mockReturnValue([frame(211, { ok: true })]);
    const recovered = await dispatch({ type: 'run', id: 'recovered', request: {} });
    expect(recovered.type).toBe('runResult');
    expect(JSON.parse(new TextDecoder().decode(recovered.frames?.[0].payload))).toEqual({ ok: true });
  });
});
