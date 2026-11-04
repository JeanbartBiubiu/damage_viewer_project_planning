import { registerFormulaForApprovedReads } from './approvedFormulaValues';
import { assertResourceChangeOutputShape, assertResourceRecordBudget } from './resourceChangeContract';
import { assertAttributeSnapshotOutputShape } from './attributeSnapshotContract';
import { assertTargetMarkOutputShape } from './targetMarkContract';
import { WASM_IDENTITY } from './wasmIdentity';
import { ApiRequestError, resolveApiBaseUrl } from '../services/apiClient';
import { getWasmGrant, onAuthSessionChanged } from '../services/authClient';
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
const AUTHORIZATION_LIFETIME_MS = 300_000;
const MAX_AUTHORIZATION_CLOCK_WAIT_MS = 5000;

type SerializedFrame = {
  schemaVersion: number;
  kind: number;
  flags: number;
  payload: ArrayBuffer;
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
  apiBaseUrl?: string;
};

type CachedAuthorization = { grant: string; expiresAt: number };

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
  assertResourceChangeOutputShape(result);
  assertAttributeSnapshotOutputShape(result);
  assertTargetMarkOutputShape(result);
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
  private readonly apiBaseUrl: string;
  private authorizationEpoch = 0;
  private cachedAuthorization: CachedAuthorization | null = null;
  private pendingAuthorization: Promise<CachedAuthorization> | null = null;
  private unsubscribeAuth: (() => void) | null = null;

  constructor(options: GenericEngineClientOptions = {}) {
    this.wasmUrl = options.wasmUrl ?? DEFAULT_WASM_URL;
    this.apiBaseUrl = resolveApiBaseUrl(options.apiBaseUrl);
    this.observeAccount();
  }

  /** 只查询当前线程引用，销毁后的旧会话应跳过释放。 */
  get hasLiveWorker(): boolean {
    return this.worker !== null;
  }

  async compile(request: CompileRequest): Promise<CompileResult> {
    const epoch = this.authorizationEpoch;
    const authorized = WASM_IDENTITY.authorizationRequired ? await this.authorize(request) : request;
    this.assertAccountUnchanged(epoch);
    const frames = await this.send('compile', { request: authorized }, false);
    const result = parseCompileResult(frames);
    if (result.ok) for (const formula of request.formulas ?? []) registerFormulaForApprovedReads(formula);
    return result;
  }

  async run(request: RunRequest): Promise<DoneResult> {
    assertResourceRecordBudget(request);
    const epoch = this.authorizationEpoch;
    const authorized = WASM_IDENTITY.authorizationRequired ? await this.authorize(request) : request;
    this.assertAccountUnchanged(epoch);
    const frames = await this.send('run', { request: authorized }, true);
    return parseDoneResult(frames);
  }

  async release(sessionId: string, expectedRulesHash?: string): Promise<GenericReleaseDonePayload> {
    const worker = await this.ensureWorker();
    try {
      const frames = await this.send('release', { sessionId, expectedRulesHash }, false, worker);
      const result = parseReleaseResult(frames);
      if (result.sessionId !== sessionId) throw new GenericEngineClientError('释放响应不属于请求会话。', undefined, frames);
      return result;
    } catch (error) {
      this.discardWorker(error instanceof Error ? error : new GenericEngineClientError('会话释放失败'), worker);
      throw error;
    }
  }

  terminate(): void {
    this.invalidateAuthorization();
    this.unsubscribeAuth?.();
    this.unsubscribeAuth = null;
    this.discardWorker(new GenericEngineClientError('工作线程已终止'));
  }

  private observeAccount(): void {
    if (this.unsubscribeAuth) return;
    this.unsubscribeAuth = onAuthSessionChanged(() => {
      this.invalidateAuthorization();
      this.discardWorker(new GenericEngineClientError('账号状态已变化，请重新发起计算。'));
    });
  }

  private invalidateAuthorization(): void {
    this.authorizationEpoch += 1;
    this.cachedAuthorization = null;
    this.pendingAuthorization = null;
  }

  private assertAccountUnchanged(epoch: number): void {
    if (epoch !== this.authorizationEpoch) throw new GenericEngineClientError('账号状态已变化，请重新发起计算。');
  }

  private async authorize<T extends CompileRequest | RunRequest>(request: T): Promise<T> {
    this.observeAccount();
    const epoch = this.authorizationEpoch;
    let authorization = this.cachedAuthorization;
    if (!authorization || authorization.expiresAt <= Date.now() + 5000) {
      let pending = this.pendingAuthorization;
      if (!pending) {
        pending = getWasmGrant(this.apiBaseUrl).then(async response => {
          this.assertAccountUnchanged(epoch);
          const expiresAt = Date.parse(response.expiresAt);
          if (typeof response.grant !== 'string' || !response.grant || response.grant.length > 4096
            || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
            throw new ApiRequestError('计算授权响应不完整或已过期，请重试。', 502, 'AUTH.INVALID_WASM_GRANT');
          }
          // 票据固定 nbf=iat、exp=iat+300；只等待可用时点，Wasm 仍独立验证全部签名与期限。
          const notBefore = expiresAt - AUTHORIZATION_LIFETIME_MS;
          const waitMs = notBefore - Date.now();
          if (waitMs > MAX_AUTHORIZATION_CLOCK_WAIT_MS) {
            throw new ApiRequestError('设备时间与服务时间相差过大，请同步设备时间后重试。', 502, 'AUTH.CLOCK_SKEW');
          }
          if (waitMs > 0) await new Promise<void>(resolve => setTimeout(resolve, waitMs));
          this.assertAccountUnchanged(epoch);
          if (Date.now() < notBefore) {
            throw new ApiRequestError('设备时间已变化，请同步设备时间后重试。', 502, 'AUTH.CLOCK_SKEW');
          }
          this.cachedAuthorization = { grant: response.grant, expiresAt };
          return this.cachedAuthorization;
        });
        this.pendingAuthorization = pending;
      }
      try {
        authorization = await pending;
      } finally {
        if (this.pendingAuthorization === pending) this.pendingAuthorization = null;
      }
    }
    this.assertAccountUnchanged(epoch);
    return { ...request, authorization: authorization.grant };
  }

  private async ensureWorker(): Promise<Worker> {
    this.observeAccount();
    let worker = this.worker;
    if (!worker) {
      worker = new Worker(new URL('../workers/genericEngineWorker.ts', import.meta.url), {
        type: 'module'
      });
      const ownedWorker = worker;
      worker.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
        if (this.worker !== ownedWorker) return;
        try {
          this.handleWorkerMessage(event.data);
        } catch (error) {
          this.discardWorker(error instanceof Error ? error : new GenericEngineClientError('工作线程响应无效'), ownedWorker);
        }
      };
      worker.onerror = (event) => {
        this.discardWorker(new GenericEngineClientError(event.message || '工作线程崩溃'), ownedWorker);
      };
      this.worker = worker;
      this.initPromise = this.initializeWorker(worker).catch((error) => {
        this.discardWorker(error instanceof Error ? error : new GenericEngineClientError('工作线程初始化失败'), ownedWorker);
        throw error;
      });
    }
    await this.initPromise;
    if (this.worker !== worker) throw new GenericEngineClientError('工作线程已终止');
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

  private discardWorker(error: Error, expectedWorker?: Worker): void {
    if (expectedWorker && this.worker !== expectedWorker) return;
    const worker = this.worker;
    this.worker = null;
    this.initPromise = null;
    this.failAllPending(error);
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    try { worker.postMessage({ type: 'terminate' }); } catch { /* Broken workers can reject a final message. */ }
    worker.terminate();
  }

  private createRequestId(): string {
    this.nextRequestId += 1;
    return `req-${this.nextRequestId}`;
  }

  private async send(
    type: 'compile' | 'run' | 'release',
    payload: { request?: RunRequest | CompileRequest; sessionId?: string; expectedRulesHash?: string },
    withRunTimeout: boolean,
    readyWorker?: Worker
  ): Promise<TinyGoV2Frame[]> {
    const worker = readyWorker ?? await this.ensureWorker();
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
    if (this.worker !== worker) return Promise.reject(new GenericEngineClientError('工作线程已终止'));
    const id = String(message.id);
    return new Promise<TinyGoV2Frame[]>((resolve, reject) => {
      const pending: PendingRequest = { resolve, reject };
      if (withRunTimeout) {
        pending.timer = setTimeout(() => {
          this.discardWorker(new GenericEngineClientError('运行超时（30 秒）'), worker);
        }, RUN_TIMEOUT_MS);
      }
      this.pending.set(id, pending);
      try {
        worker.postMessage(message);
      } catch (error) {
        this.discardWorker(error instanceof Error ? error : new GenericEngineClientError('工作线程发送失败'), worker);
      }
    });
  }

  private handleWorkerMessage(message: WorkerInboundMessage) {
    if (message.type === 'error') {
      const pending = message.id ? this.pending.get(message.id) : undefined;
      const frames = message.frames ? deserializeFrames(message.frames) : undefined;
      const error = new GenericEngineClientError(message.message, parseEngineError(frames ?? []), frames);
      if (message.recreate) {
        this.discardWorker(error);
        return;
      }
      if (pending) {
        if (pending.timer) {
          clearTimeout(pending.timer);
        }
        this.pending.delete(message.id!);
        pending.reject(error);
      }
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    const frames = message.type === 'ready' ? [] : deserializeFrames(message.frames);
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    this.pending.delete(message.id);

    pending.resolve(frames);
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
