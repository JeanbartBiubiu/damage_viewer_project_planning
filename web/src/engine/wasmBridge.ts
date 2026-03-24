import type { GameDataBundle } from '../types/api';
import type { EngineError, EngineMeta, EngineRunInput, EngineRunOutput } from './types';

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

type EngineInitPayload = {
  meta: EngineMeta;
  bundle: GameDataBundle;
  engineConfig?: {
    hpAttrKey?: string;
  };
};

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

  static async create(meta: EngineMeta, bundle: GameDataBundle, config: RuntimeConfig): Promise<KatarinaWasmBridge> {
    const bridge = new KatarinaWasmBridge(await loadWasmExports());
    bridge.init(meta, bundle, config);
    return bridge;
  }

  run(input: EngineRunInput): EngineRunOutput {
    return this.invoke<EngineRunOutput>('engine_run', input);
  }

  private init(meta: EngineMeta, bundle: GameDataBundle, config: RuntimeConfig) {
    const payload: EngineInitPayload = {
      meta,
      bundle,
      engineConfig: {
        hpAttrKey: config.hpAttrKey
      }
    };
    this.invoke<{ initialized: true }>('engine_init', payload);
  }

  private invoke<T>(fnName: 'engine_init' | 'engine_run', payload: unknown): T {
    const rawPayload = textEncoder.encode(JSON.stringify(payload));
    const ptr = this.exports.alloc(rawPayload.length);

    try {
      new Uint8Array(this.exports.memory.buffer, ptr, rawPayload.length).set(rawPayload);
      this.exports[fnName](ptr, rawPayload.length);
      const response = this.readResponse<T>();
      if (!response.ok) {
        throw toRuntimeError(response.error);
      }
      return response.value;
    } finally {
      this.exports.dealloc(ptr, rawPayload.length);
    }
  }

  private readResponse<T>(): HostResponse<T> {
    const ptr = this.exports.engine_response_ptr();
    const len = this.exports.engine_response_len();
    if (!ptr || len <= 0) {
      throw new Error('Wasm engine returned an empty response.');
    }

    const bytes = new Uint8Array(this.exports.memory.buffer, ptr, len);
    const copy = new Uint8Array(bytes);
    return JSON.parse(textDecoder.decode(copy)) as HostResponse<T>;
  }
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
