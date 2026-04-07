import type { EngineBundle, EngineError, EngineMeta, EngineRunInput, EngineRunOutput } from './types';

type RuntimeConfig = {
  hpAttrKey: string;
};

type WasmExports = WebAssembly.Exports & {
  memory: WebAssembly.Memory;
  alloc: (len: number) => number;
  dealloc: (ptr: number, len: number) => void;
  engine_init: (ptr: number, len: number) => number;
  engine_run: (ptr: number, len: number) => number;
  engine_response_ptr: () => number;
  engine_response_len: () => number;
};

type HostSuccess<T> = {
  ok: true;
  value: T;
};

type HostFailure = {
  ok: false;
  error: EngineError;
};

type HostResponse<T> = HostSuccess<T> | HostFailure;

type DecodedHostResponse<T> = {
  raw: string;
  parsed: HostResponse<T>;
};

type EngineInitPayload = {
  meta: EngineMeta;
  bundle: EngineBundle;
  engineConfig?: {
    hpAttrKey?: string;
  };
};

type WasmInvokeName = 'engine_init' | 'engine_run';

const WASM_URL = new URL('./wasm/katarina_mvp_engine.wasm', import.meta.url);
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const REQUIRED_EXPORT_NAMES = [
  'memory',
  'alloc',
  'dealloc',
  'engine_init',
  'engine_run',
  'engine_response_ptr',
  'engine_response_len'
] as const;
const LEGACY_EXPORT_NAMES = ['run_basic_attack', 'run_death_lotus', 'samples_ptr', 'result_ptr'] as const;

let exportsPromise: Promise<WasmExports> | null = null;

export class KatarinaWasmBridge {
  private readonly exports: WasmExports;

  private constructor(exports: WasmExports) {
    this.exports = exports;
  }

  static async create(meta: EngineMeta, bundle: EngineBundle, config: RuntimeConfig): Promise<KatarinaWasmBridge> {
    const bridge = new KatarinaWasmBridge(await loadWasmExports());
    bridge.init(meta, bundle, config);
    return bridge;
  }

  run(input: EngineRunInput): EngineRunOutput {
    return this.invoke<EngineRunOutput>('engine_run', input);
  }

  private init(meta: EngineMeta, bundle: EngineBundle, config: RuntimeConfig) {
    const payload: EngineInitPayload = {
      meta,
      bundle,
      engineConfig: {
        hpAttrKey: config.hpAttrKey
      }
    };
    this.invoke<{ initialized: true }>('engine_init', payload);
  }

  private invoke<T>(fnName: WasmInvokeName, payload: unknown): T {
    const requestJson = JSON.stringify(payload);
    const rawPayload = textEncoder.encode(requestJson);
    const ptr = this.exports.alloc(rawPayload.length);
    const startedAt = performance.now();
    let didLogExchange = false;

    try {
      new Uint8Array(this.exports.memory.buffer, ptr, rawPayload.length).set(rawPayload);
      this.exports[fnName](ptr, rawPayload.length);
      const response = this.readResponse<T>();
      logWasmExchange(fnName, {
        durationMs: performance.now() - startedAt,
        request: payload,
        requestJson,
        response: response.parsed,
        responseJson: response.raw
      });
      didLogExchange = true;
      if (!response.parsed.ok) {
        throw toRuntimeError(response.parsed.error);
      }
      return response.parsed.value;
    } catch (error) {
      if (!didLogExchange) {
        logWasmExchange(fnName, {
          durationMs: performance.now() - startedAt,
          request: payload,
          requestJson,
          error: normalizeLogError(error)
        });
      }
      throw error;
    } finally {
      this.exports.dealloc(ptr, rawPayload.length);
    }
  }

  private readResponse<T>(): DecodedHostResponse<T> {
    const ptr = this.exports.engine_response_ptr();
    const len = this.exports.engine_response_len();
    if (!ptr || len <= 0) {
      throw new Error('Wasm engine returned an empty response.');
    }

    const bytes = new Uint8Array(this.exports.memory.buffer, ptr, len);
    const copy = new Uint8Array(bytes);
    const raw = textDecoder.decode(copy);
    return {
      raw,
      parsed: JSON.parse(raw) as HostResponse<T>
    };
  }
}

function logWasmExchange(
  fnName: WasmInvokeName,
  payload: {
    durationMs: number;
    request: unknown;
    requestJson: string;
    response?: HostResponse<unknown>;
    responseJson?: string;
    error?: unknown;
  }
) {
  const status = payload.error ? 'failed' : payload.response?.ok === false ? 'error' : 'ok';
  const title = `[wasm] ${fnName} ${status} ${payload.durationMs.toFixed(1)}ms`;

  if (typeof console.groupCollapsed === 'function') {
    console.groupCollapsed(title);
    console.info('[wasm] request', payload.request);
    console.info('[wasm] requestJson', payload.requestJson);
    if (payload.response) {
      console.info('[wasm] response', payload.response);
    }
    if (payload.responseJson !== undefined) {
      console.info('[wasm] responseJson', payload.responseJson);
    }
    if (payload.error !== undefined) {
      console.error('[wasm] error', payload.error);
    }
    console.groupEnd();
    return;
  }
  console.info(title, {
    request: payload.request,
    requestJson: payload.requestJson,
    response: payload.response,
    responseJson: payload.responseJson,
    error: payload.error
  });
}

async function loadWasmExports(): Promise<WasmExports> {
  if (!exportsPromise) {
    exportsPromise = instantiateWasmModule().catch((error) => {
      exportsPromise = null;
      throw error;
    });
  }
  return exportsPromise;
}

async function instantiateWasmModule(): Promise<WasmExports> {
  const response = await fetch(WASM_URL);
  if (!response.ok) {
    throw new Error(`Failed to load Wasm module: ${response.status} ${response.statusText}`);
  }

  if (typeof WebAssembly.instantiateStreaming === 'function') {
    try {
      const { instance } = await WebAssembly.instantiateStreaming(response.clone(), {});
      assertWasmAbi(instance.exports);
      return instance.exports;
    } catch {
      // Fall back to instantiate(ArrayBuffer) when the dev server serves an unexpected MIME type.
    }
  }

  const bytes = await response.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, {});
  assertWasmAbi(instance.exports);
  return instance.exports;
}

function toRuntimeError(error: EngineError): Error {
  const runtimeError = new Error(error.message);
  runtimeError.name = error.code;
  return runtimeError;
}

function normalizeLogError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }
  return error;
}

function assertWasmAbi(exports: WebAssembly.Exports): asserts exports is WasmExports {
  const record = exports as Record<string, unknown>;
  const missingExports = REQUIRED_EXPORT_NAMES.filter((name) => record[name] === undefined);
  const invalidExports = REQUIRED_EXPORT_NAMES.filter((name) => {
    if (name === 'memory') {
      return !(record[name] instanceof WebAssembly.Memory);
    }
    return typeof record[name] !== 'function';
  });

  if (missingExports.length === 0 && invalidExports.length === 0) {
    return;
  }

  const availableExports = Object.keys(record).sort();
  const looksLegacyArtifact = LEGACY_EXPORT_NAMES.some((name) => typeof record[name] === 'function');
  const legacyHint = looksLegacyArtifact ? ' Loaded legacy raw-ABI Wasm artifact.' : '';
  throw new Error(
    `Wasm ABI mismatch.${legacyHint} Missing exports: ${missingExports.join(', ') || 'none'}. `
      + `Invalid exports: ${invalidExports.join(', ') || 'none'}. `
      + `Available exports: ${availableExports.join(', ') || '(none)'}. `
      + 'Rebuild web/src/engine/wasm/katarina_mvp_engine.wasm from wasm/katarina_mvp_engine before starting the web app.'
  );
}
