type TinyGoGlobal = typeof globalThis & {
  Go?: new () => {
    importObject: WebAssembly.Imports;
    run(instance: WebAssembly.Instance): Promise<void>;
  };
};

type TinyGoV2Exports = WebAssembly.Exports & {
  memory: WebAssembly.Memory;
  _start?: () => void;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  engine_init(ptr: number, len: number): number;
  engine_begin_run(ptr: number, len: number): number;
  engine_snapshot_initial(ptr: number, len: number): number;
  engine_snapshot_actions_initial(ptr: number, len: number): number;
  engine_step(maxEvents: number): number;
  engine_abort_run(): number;
  engine_outbox_ptr(): number;
  engine_outbox_len(): number;
  engine_outbox_clear(): void;
};

export type TinyGoV2Frame = {
  schemaVersion: number;
  kind: number;
  flags: number;
  payload: Uint8Array;
};

export type TinyGoV2BridgeOptions = {
  wasmUrl: URL | string;
  wasmExecUrl?: URL | string;
};

export class TinyGoV2InvocationError extends Error {
  constructor(
    readonly fnName: string,
    readonly code: number,
    readonly frames: TinyGoV2Frame[]
  ) {
    super(`${fnName} failed with code ${code}${formatInvocationErrorFrames(frames)}`);
    this.name = 'TinyGoV2InvocationError';
  }
}

const MAGIC = 0x32475644;
const SCHEMA_VERSION = 1;
const HEADER_LEN = 16;
const FRAME_INIT = 1;
const FRAME_RUN = 2;

const textEncoder = new TextEncoder();
const requiredExports = [
  'memory',
  'alloc',
  'dealloc',
  'engine_init',
  'engine_begin_run',
  'engine_snapshot_initial',
  'engine_snapshot_actions_initial',
  'engine_step',
  'engine_abort_run',
  'engine_outbox_ptr',
  'engine_outbox_len',
  'engine_outbox_clear'
] as const;

export class TinyGoV2Bridge {
  private constructor(private readonly exports: TinyGoV2Exports) {}

  static async create(options: TinyGoV2BridgeOptions): Promise<TinyGoV2Bridge> {
    const exports = options.wasmExecUrl
      ? await instantiateWithWasmExec(options.wasmUrl, options.wasmExecUrl)
      : await instantiateWithDirectImports(options.wasmUrl);
    assertTinyGoV2Exports(exports);
    return new TinyGoV2Bridge(exports);
  }

  init(bundle: unknown): TinyGoV2Frame[] {
    return this.invoke('engine_init', FRAME_INIT, bundle);
  }

  beginRun(input: unknown): TinyGoV2Frame[] {
    return this.invoke('engine_begin_run', FRAME_RUN, input);
  }

  snapshotInitial(input: unknown): TinyGoV2Frame[] {
    return this.invoke('engine_snapshot_initial', FRAME_RUN, input);
  }

  snapshotActionsInitial(input: unknown): TinyGoV2Frame[] {
    return this.invoke('engine_snapshot_actions_initial', FRAME_RUN, input);
  }

  step(maxEvents = 64): { status: number; frames: TinyGoV2Frame[] } {
    const status = this.exports.engine_step(maxEvents);
    return { status, frames: this.readOutbox() };
  }

  abortRun(): TinyGoV2Frame[] {
    this.exports.engine_abort_run();
    return this.readOutbox();
  }

  private invoke(
    fnName: 'engine_init' | 'engine_begin_run' | 'engine_snapshot_initial' | 'engine_snapshot_actions_initial',
    kind: number,
    payload: unknown
  ): TinyGoV2Frame[] {
    const payloadBytes = textEncoder.encode(JSON.stringify(payload));
    const frame = encodeFrame(kind, payloadBytes);
    const ptr = this.exports.alloc(frame.length);
    let code = -1;
    try {
      new Uint8Array(this.exports.memory.buffer, ptr, frame.length).set(frame);
      code = this.exports[fnName](ptr, frame.length);
    } finally {
      this.exports.dealloc(ptr, frame.length);
    }
    const frames = this.readOutbox();
    if (code !== 0) {
      throw new TinyGoV2InvocationError(fnName, code, frames);
    }
    return frames;
  }

  private readOutbox(): TinyGoV2Frame[] {
    const ptr = this.exports.engine_outbox_ptr();
    const len = this.exports.engine_outbox_len();
    if (!ptr || len <= 0) {
      return [];
    }
    const copy = new Uint8Array(new Uint8Array(this.exports.memory.buffer, ptr, len));
    this.exports.engine_outbox_clear();
    return decodeFrames(copy);
  }
}

export function decodeFramePayload<T>(frame: TinyGoV2Frame): T {
  return JSON.parse(new TextDecoder().decode(frame.payload)) as T;
}

function encodeFrame(kind: number, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(HEADER_LEN + payload.length);
  const view = new DataView(frame.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint16(4, SCHEMA_VERSION, true);
  view.setUint16(6, kind, true);
  view.setUint32(8, 0, true);
  view.setUint32(12, payload.length, true);
  frame.set(payload, HEADER_LEN);
  return frame;
}

function decodeFrames(bytes: Uint8Array): TinyGoV2Frame[] {
  const frames: TinyGoV2Frame[] = [];
  let offset = 0;
  while (offset + HEADER_LEN <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, HEADER_LEN);
    if (view.getUint32(0, true) !== MAGIC) {
      throw new Error('TinyGo V2 outbox frame has invalid magic.');
    }
    const payloadLen = view.getUint32(12, true);
    const end = offset + HEADER_LEN + payloadLen;
    if (end > bytes.length) {
      throw new Error('TinyGo V2 outbox frame is truncated.');
    }
    frames.push({
      schemaVersion: view.getUint16(4, true),
      kind: view.getUint16(6, true),
      flags: view.getUint32(8, true),
      payload: bytes.slice(offset + HEADER_LEN, end)
    });
    offset = end;
  }
  return frames;
}

function formatInvocationErrorFrames(frames: TinyGoV2Frame[]): string {
  if (frames.length === 0) {
    return '';
  }
  const textDecoder = new TextDecoder();
  const payloads = frames.map((frame) => {
    try {
      return textDecoder.decode(frame.payload);
    } catch {
      return `kind_${frame.kind}`;
    }
  });
  return `: ${payloads.join(' | ')}`;
}

async function instantiateWithWasmExec(wasmUrl: URL | string, wasmExecUrl: URL | string): Promise<WebAssembly.Exports> {
  await ensureTinyGoRuntime(wasmExecUrl);
  const go = new (globalThis as TinyGoGlobal).Go!();
  const { instance } = await instantiateWasm(wasmUrl, go.importObject);
  void go.run(instance);
  return instance.exports;
}

async function instantiateWithDirectImports(wasmUrl: URL | string): Promise<WebAssembly.Exports> {
  const state: TinyGoDirectImportState = { instance: null };
  const { instance } = await instantiateWasm(wasmUrl, createTinyGoDirectImports(state));
  state.instance = instance;
  startTinyGoDirectRuntime(instance);
  return instance.exports;
}

async function instantiateWasm(
  wasmUrl: URL | string,
  importObject: WebAssembly.Imports
): Promise<WebAssembly.WebAssemblyInstantiatedSource> {
  const response = await fetch(wasmUrl);
  if (!response.ok) {
    throw new Error(`Failed to load TinyGo V2 wasm: ${response.status} ${response.statusText}`);
  }
  return WebAssembly.instantiate(await response.arrayBuffer(), importObject);
}

async function ensureTinyGoRuntime(wasmExecUrl: URL | string) {
  if ((globalThis as TinyGoGlobal).Go) {
    return;
  }
  await import(/* @vite-ignore */ wasmExecUrl.toString());
  if (!(globalThis as TinyGoGlobal).Go) {
    throw new Error('TinyGo wasm_exec.js did not install globalThis.Go.');
  }
}

function assertTinyGoV2Exports(exports: WebAssembly.Exports): asserts exports is TinyGoV2Exports {
  const record = exports as Record<string, unknown>;
  const missing = requiredExports.filter((name) => record[name] === undefined);
  const invalid = requiredExports.filter((name) => {
    if (name === 'memory') {
      return !(record[name] instanceof WebAssembly.Memory);
    }
    return typeof record[name] !== 'function';
  });
  if (missing.length || invalid.length) {
    throw new Error(
      `TinyGo V2 ABI mismatch. Missing: ${missing.join(', ') || 'none'}. `
        + `Invalid: ${invalid.join(', ') || 'none'}.`
    );
  }
}

type TinyGoDirectImportState = {
  instance: WebAssembly.Instance | null;
};

class TinyGoProcExit extends Error {
  constructor(readonly code: number) {
    super(`TinyGo proc_exit(${code})`);
  }
}

function createTinyGoDirectImports(state: TinyGoDirectImportState): WebAssembly.Imports {
  return {
    wasi_snapshot_preview1: {
      proc_exit(code: number) {
        throw new TinyGoProcExit(code);
      },
      fd_write(_fd: number, iovs: number, iovsLen: number, nwritten: number) {
        const memory = getDirectMemory(state);
        if (!memory) {
          return 0;
        }
        const view = new DataView(memory.buffer);
        let written = 0;
        for (let index = 0; index < iovsLen; index += 1) {
          written += view.getUint32(iovs + index * 8 + 4, true);
        }
        if (nwritten) {
          view.setUint32(nwritten, written, true);
        }
        return 0;
      },
      random_get(ptr: number, len: number) {
        const memory = getDirectMemory(state);
        if (!memory || !globalThis.crypto?.getRandomValues) {
          return 0;
        }
        const target = new Uint8Array(memory.buffer, ptr, len);
        for (let offset = 0; offset < target.length; offset += 65536) {
          globalThis.crypto.getRandomValues(target.subarray(offset, Math.min(offset + 65536, target.length)));
        }
        return 0;
      }
    },
    gojs: {
      'runtime.ticks'() {
        return BigInt(Date.now()) * 1_000_000n;
      },
      'syscall/js.valueGet'() {
        return 0n;
      },
      'syscall/js.valuePrepareString'() {
        return 0n;
      },
      'syscall/js.valueLoadString'() {
        return 0n;
      },
      'syscall/js.finalizeRef'() {
        return 0n;
      },
      'syscall/js.valueSetIndex'() {
        return 0n;
      },
      'syscall/js.stringVal'() {
        return 0n;
      },
      'syscall/js.valueSet'() {
        return 0n;
      },
      'syscall/js.valueNew'() {
        return 0n;
      },
      'syscall/js.valueCall'() {
        return 0n;
      }
    }
  };
}

function getDirectMemory(state: TinyGoDirectImportState): WebAssembly.Memory | null {
  const memory = state.instance?.exports.memory;
  return memory instanceof WebAssembly.Memory ? memory : null;
}

function startTinyGoDirectRuntime(instance: WebAssembly.Instance) {
  const start = instance.exports._start;
  if (typeof start !== 'function') {
    return;
  }
  try {
    start();
  } catch (error) {
    if (error instanceof TinyGoProcExit && error.code === 0) {
      return;
    }
    throw error;
  }
}
