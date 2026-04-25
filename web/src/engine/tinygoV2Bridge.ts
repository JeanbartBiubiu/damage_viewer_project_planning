type TinyGoGlobal = typeof globalThis & {
  Go?: new () => {
    importObject: WebAssembly.Imports;
    run(instance: WebAssembly.Instance): Promise<void>;
  };
};

type TinyGoV2Exports = WebAssembly.Exports & {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  engine_init(ptr: number, len: number): number;
  engine_begin_run(ptr: number, len: number): number;
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
  wasmExecUrl: URL | string;
};

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
  'engine_step',
  'engine_abort_run',
  'engine_outbox_ptr',
  'engine_outbox_len',
  'engine_outbox_clear'
] as const;

export class TinyGoV2Bridge {
  private constructor(private readonly exports: TinyGoV2Exports) {}

  static async create(options: TinyGoV2BridgeOptions): Promise<TinyGoV2Bridge> {
    await ensureTinyGoRuntime(options.wasmExecUrl);
    const go = new (globalThis as TinyGoGlobal).Go!();
    const response = await fetch(options.wasmUrl);
    if (!response.ok) {
      throw new Error(`Failed to load TinyGo V2 wasm: ${response.status} ${response.statusText}`);
    }

    const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), go.importObject);
    const exports = instance.exports;
    assertTinyGoV2Exports(exports);
    void go.run(instance);
    return new TinyGoV2Bridge(exports);
  }

  init(bundle: unknown): TinyGoV2Frame[] {
    this.invoke('engine_init', FRAME_INIT, bundle);
    return this.readOutbox();
  }

  beginRun(input: unknown): TinyGoV2Frame[] {
    this.invoke('engine_begin_run', FRAME_RUN, input);
    return this.readOutbox();
  }

  step(maxEvents = 64): { status: number; frames: TinyGoV2Frame[] } {
    const status = this.exports.engine_step(maxEvents);
    return { status, frames: this.readOutbox() };
  }

  abortRun(): TinyGoV2Frame[] {
    this.exports.engine_abort_run();
    return this.readOutbox();
  }

  private invoke(fnName: 'engine_init' | 'engine_begin_run', kind: number, payload: unknown) {
    const payloadBytes = textEncoder.encode(JSON.stringify(payload));
    const frame = encodeFrame(kind, payloadBytes);
    const ptr = this.exports.alloc(frame.length);
    try {
      new Uint8Array(this.exports.memory.buffer, ptr, frame.length).set(frame);
      const code = this.exports[fnName](ptr, frame.length);
      if (code !== 0) {
        throw new Error(`${fnName} failed with code ${code}`);
      }
    } finally {
      this.exports.dealloc(ptr, frame.length);
    }
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
