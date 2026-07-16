import {
  OUTBOX_GENERIC_COMPILE_RESULT,
  OUTBOX_GENERIC_DONE,
  OUTBOX_GENERIC_ERROR,
  OUTBOX_GENERIC_RELEASE_RESULT,
  decodeFramePayload,
  type TinyGoV2Frame
} from './tinygoV2Bridge';
import type {
  CompileRequest,
  CompileResult,
  DoneResult,
  EngineError,
  GenericReleaseDonePayload,
  RunRequest
} from '../types/genericEngine';

const DEFAULT_WASM_URL = new URL('./wasm/tinygo_engine_v2.wasm', import.meta.url);
const RUN_TIMEOUT_MS = 30_000;

type SerializedFrame = {
  schemaVersion: number;
  kind: number;
  flags: number;
  payload: number[];
};

type WorkerInboundMessage =
  | { type: 'ready'; id: string }
  | { type: 'compileResult'; id: string; frames: SerializedFrame[] }
  | { type: 'runResult'; id: string; frames: SerializedFrame[] }
  | { type: 'releaseResult'; id: string; frames: SerializedFrame[] }
  | { type: 'error'; id?: string; message: string; recreate?: boolean; frames?: SerializedFrame[] };

export class GenericEngineClientError extends Error {
  constructor(
    message: string,
    readonly engineError?: EngineError,
    readonly frames?: TinyGoV2Frame[]
  ) {
    super(message);
    this.name = 'GenericEngineClientError';
  }
}

export type GenericEngineClientOptions = {
  wasmUrl?: URL | string;
};

type PendingRequest = {
  resolve: (frames: TinyGoV2Frame[]) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
};

function deserializeFrames(frames: SerializedFrame[]): TinyGoV2Frame[] {
  return frames.map((frame) => ({
    schemaVersion: frame.schemaVersion,
    kind: frame.kind,
    flags: frame.flags,
    payload: new Uint8Array(frame.payload)
  }));
}

function findFrame(frames: TinyGoV2Frame[], kind: number): TinyGoV2Frame | undefined {
  return frames.find((frame) => frame.kind === kind);
}

export function parseEngineError(frames: TinyGoV2Frame[]): EngineError | undefined {
  const errorFrame = findFrame(frames, OUTBOX_GENERIC_ERROR);
  if (!errorFrame) {
    return undefined;
  }
  return decodeFramePayload<EngineError>(errorFrame);
}

function assertNoFatalError(frames: TinyGoV2Frame[], action: string): void {
  const engineError = parseEngineError(frames);
  if (engineError) {
    throw new GenericEngineClientError(`${action}失败：${engineError.code} ${engineError.message}`, engineError, frames);
  }
}

/**
 * Compile ok=false is a normal collect-all CompileResult (not a thrown fatal).
 * Only kind 212 rejects.
 */
export function parseCompileResult(frames: TinyGoV2Frame[]): CompileResult {
  assertNoFatalError(frames, '编译');
  const resultFrame = findFrame(frames, OUTBOX_GENERIC_COMPILE_RESULT);
  if (!resultFrame) {
    throw new GenericEngineClientError('编译响应缺少 compile_result 帧', undefined, frames);
  }
  return decodeFramePayload<CompileResult>(resultFrame);
}

export function parseDoneResult(frames: TinyGoV2Frame[]): DoneResult {
  assertNoFatalError(frames, '运行');
  const doneFrame = findFrame(frames, OUTBOX_GENERIC_DONE);
  if (!doneFrame) {
    throw new GenericEngineClientError('运行响应缺少 done 帧', undefined, frames);
  }
  const result = decodeFramePayload<DoneResult>(doneFrame);
  if (!result.ok) {
    throw new GenericEngineClientError('运行返回 ok=false', undefined, frames);
  }
  return result;
}

export function parseReleaseResult(frames: TinyGoV2Frame[]): GenericReleaseDonePayload {
  assertNoFatalError(frames, '释放');
  const releaseFrame = findFrame(frames, OUTBOX_GENERIC_RELEASE_RESULT);
  if (!releaseFrame) {
    throw new GenericEngineClientError('释放响应缺少 release_result 帧（214）', undefined, frames);
  }
  const result = decodeFramePayload<GenericReleaseDonePayload>(releaseFrame);
  if (!result.ok || !result.released) {
    throw new GenericEngineClientError('释放返回 ok=false', undefined, frames);
  }
  return result;
}

export class GenericEngineClient {
  private worker: Worker | null = null;
  private nextRequestId = 0;
  private initPromise: Promise<void> | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly wasmUrl: URL | string;

  constructor(options: GenericEngineClientOptions = {}) {
    this.wasmUrl = options.wasmUrl ?? DEFAULT_WASM_URL;
  }

  async compile(request: CompileRequest): Promise<CompileResult> {
    const frames = await this.send('compile', { request }, false);
    return parseCompileResult(frames);
  }

  async run(request: RunRequest): Promise<DoneResult> {
    const frames = await this.send('run', { request }, true);
    return parseDoneResult(frames);
  }

  async release(sessionId: string, expectedRulesHash?: string): Promise<GenericReleaseDonePayload> {
    const frames = await this.send('release', { sessionId, expectedRulesHash }, false);
    return parseReleaseResult(frames);
  }

  terminate(): void {
    for (const pending of this.pending.values()) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pending.reject(new GenericEngineClientError('工作线程已终止'));
    }
    this.pending.clear();
    if (this.worker) {
      this.worker.postMessage({ type: 'terminate' });
      this.worker.terminate();
      this.worker = null;
    }
    this.initPromise = null;
  }

  private async ensureWorker(): Promise<Worker> {
    if (this.worker) {
      return this.worker;
    }
    const worker = new Worker(new URL('../workers/genericEngineWorker.ts', import.meta.url), {
      type: 'module'
    });
    worker.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
      this.handleWorkerMessage(event.data);
    };
    worker.onerror = (event) => {
      this.failAllPending(new GenericEngineClientError(event.message || '工作线程崩溃', undefined));
      this.recreateWorker();
    };
    this.worker = worker;
    this.initPromise = this.initializeWorker(worker);
    await this.initPromise;
    return worker;
  }

  private async initializeWorker(worker: Worker): Promise<void> {
    await this.postAndWait(
      worker,
      {
        type: 'init',
        id: this.createRequestId(),
        wasmUrl: this.wasmUrl.toString()
      },
      false
    );
  }

  private recreateWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.initPromise = null;
  }

  private createRequestId(): string {
    this.nextRequestId += 1;
    return `req-${this.nextRequestId}`;
  }

  private async send(
    type: 'compile' | 'run' | 'release',
    payload: { request?: RunRequest | CompileRequest; sessionId?: string; expectedRulesHash?: string },
    withRunTimeout: boolean
  ): Promise<TinyGoV2Frame[]> {
    const worker = await this.ensureWorker();
    const id = this.createRequestId();
    const message =
      type === 'compile'
        ? { type: 'compile' as const, id, request: payload.request }
        : type === 'run'
          ? { type: 'run' as const, id, request: payload.request }
          : {
              type: 'release' as const,
              id,
              sessionId: payload.sessionId ?? '',
              expectedRulesHash: payload.expectedRulesHash
            };
    return this.postAndWait(worker, message, withRunTimeout);
  }

  private postAndWait(worker: Worker, message: Record<string, unknown>, withRunTimeout: boolean): Promise<TinyGoV2Frame[]> {
    const id = String(message.id);
    return new Promise<TinyGoV2Frame[]>((resolve, reject) => {
      const pending: PendingRequest = { resolve, reject };
      if (withRunTimeout) {
        pending.timer = setTimeout(() => {
          this.pending.delete(id);
          this.recreateWorker();
          reject(new GenericEngineClientError('运行超时（30 秒）'));
        }, RUN_TIMEOUT_MS);
      }
      this.pending.set(id, pending);
      worker.postMessage(message);
    });
  }

  private handleWorkerMessage(message: WorkerInboundMessage) {
    if (message.type === 'error') {
      const pending = message.id ? this.pending.get(message.id) : undefined;
      const frames = message.frames ? deserializeFrames(message.frames) : undefined;
      const error = new GenericEngineClientError(message.message, parseEngineError(frames ?? []), frames);
      if (pending) {
        if (pending.timer) {
          clearTimeout(pending.timer);
        }
        this.pending.delete(message.id!);
        pending.reject(error);
      }
      if (message.recreate) {
        this.recreateWorker();
      }
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    this.pending.delete(message.id);

    if (message.type === 'ready') {
      pending.resolve([]);
      return;
    }

    pending.resolve(deserializeFrames(message.frames));
  }

  private failAllPending(error: Error) {
    for (const pending of this.pending.values()) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pending.reject(error);
    }
    this.pending.clear();
  }
}

let defaultClient: GenericEngineClient | null = null;

export function getGenericEngineClient(): GenericEngineClient {
  if (!defaultClient) {
    defaultClient = new GenericEngineClient();
  }
  return defaultClient;
}

export { RUN_TIMEOUT_MS };
