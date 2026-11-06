import { afterEach, describe, expect, it, vi } from 'vitest';
import { TinyGoV2Bridge, TinyGoV2InvocationError, type TinyGoV2Frame } from './tinygoV2Bridge';

type EngineExportName = 'engine_compile' | 'engine_run' | 'engine_release_session';
type ResponseBytes = { bytes: Uint8Array; code?: number };
type Invocation = {
  name: string;
  exportName: EngineExportName;
  inputKind: number;
  outputKind: number;
  request: unknown;
  invoke(bridge: TinyGoV2Bridge): TinyGoV2Frame[];
};

const originalWebAssembly = globalThis.WebAssembly;
const inputPointer = 64;
const outboxPointer = 4096;
const invocations: Invocation[] = [
  { name: 'compile', exportName: 'engine_compile', inputKind: 200, outputKind: 210,
    request: { probe: 'compile' }, invoke: bridge => bridge.compile({ probe: 'compile' }) },
  { name: 'run', exportName: 'engine_run', inputKind: 201, outputKind: 211,
    request: { probe: 'run' }, invoke: bridge => bridge.run({ probe: 'run' }) },
  { name: 'release', exportName: 'engine_release_session', inputKind: 202, outputKind: 214,
    request: { sessionId: 'session-1', expectedRulesHash: 'rules-1' },
    invoke: bridge => bridge.releaseSession('session-1', 'rules-1') }
];

// 直接按16字节小端协议构造，载荷为{}；不借用桥接层的编码或解码实现。
function completeResponse(kind: number): Uint8Array {
  return Uint8Array.of(0x44, 0x56, 0x47, 0x32, 1, 0, kind, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0x7b, 0x7d);
}

function joinBytes(...parts: Uint8Array[]): Uint8Array {
  return Uint8Array.from(parts.flatMap(part => Array.from(part)));
}

async function controlledBridge(responses: ResponseBytes[]) {
  const memory = new originalWebAssembly.Memory({ initial: 1 });
  const pending = responses.slice();
  const events: string[] = [];
  const requests: { exportName: EngineExportName; bytes: Uint8Array }[] = [];
  let outboxLength = 0;
  const respond = (exportName: EngineExportName, ptr: number, len: number): number => {
    events.push(exportName);
    requests.push({ exportName, bytes: new Uint8Array(new Uint8Array(memory.buffer, ptr, len)) });
    const response = pending.shift();
    if (!response) throw new Error('Missing controlled outbox response');
    new Uint8Array(memory.buffer, outboxPointer, response.bytes.length).set(response.bytes);
    outboxLength = response.bytes.length;
    return response.code ?? 0;
  };
  const exports = {
    memory,
    alloc: vi.fn((_len: number) => { events.push('alloc'); return inputPointer; }),
    dealloc: vi.fn((ptr: number, len: number) => {
      events.push('dealloc');
      new Uint8Array(memory.buffer, ptr, len).fill(0);
    }),
    engine_compile: vi.fn((ptr: number, len: number) => respond('engine_compile', ptr, len)),
    engine_run: vi.fn((ptr: number, len: number) => respond('engine_run', ptr, len)),
    engine_release_session: vi.fn((ptr: number, len: number) => respond('engine_release_session', ptr, len)),
    engine_outbox_ptr: () => outboxPointer,
    engine_outbox_len: () => outboxLength,
    engine_outbox_clear: vi.fn(() => {
      events.push('clear');
      new Uint8Array(memory.buffer, outboxPointer, outboxLength).fill(0);
      outboxLength = 0;
    })
  };
  const moduleBytes = Uint8Array.of(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0);
  const module = new originalWebAssembly.Module(moduleBytes);
  const instantiate = vi.fn(async (): Promise<WebAssembly.WebAssemblyInstantiatedSource> => ({ module, instance: { exports } }));
  const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(moduleBytes));
  vi.stubGlobal('WebAssembly', { Memory: originalWebAssembly.Memory, instantiate });
  vi.stubGlobal('fetch', fetchMock);
  const bridge = await TinyGoV2Bridge.create({ wasmUrl: 'https://engine.example.test/controlled.wasm' });
  expect(fetchMock).toHaveBeenCalledWith('https://engine.example.test/controlled.wasm');
  expect(instantiate).toHaveBeenCalledTimes(1);
  return { bridge, memory, exports, events, requests };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const malformedResponses = [
  { name: '1字节帧头', make: (valid: Uint8Array) => valid.slice(0, 1), error: /trailing fragment of 1 byte\(s\)/ },
  { name: '15字节帧头', make: (valid: Uint8Array) => valid.slice(0, 15), error: /trailing fragment of 15 byte\(s\)/ },
  { name: '成功帧后的残片', make: (valid: Uint8Array) => joinBytes(valid, Uint8Array.of(0xaa)), error: /trailing fragment of 1 byte\(s\)/ },
  { name: '成功帧后的版本99', make: (valid: Uint8Array) => {
    const invalid = valid.slice(); invalid[4] = 99;
    return joinBytes(valid, invalid);
  }, error: /unsupported schema version: 99/ },
  { name: '成功帧后的错误魔数', make: (valid: Uint8Array) => {
    const invalid = valid.slice(); invalid[0] = 0;
    return joinBytes(valid, invalid);
  }, error: /invalid magic/ },
  { name: '成功帧后的截断载荷', make: (valid: Uint8Array) => joinBytes(valid, valid.slice(0, -1)), error: /frame is truncated/ }
];

describe.each(invocations)('TinyGoV2Bridge $name公开入口', invocation => {
  it.each(malformedResponses)('拒绝$name，不返回成功前缀；清理后下一次调用恢复', async malformed => {
    const valid = completeResponse(invocation.outputKind);
    const host = await controlledBridge([{ bytes: malformed.make(valid) }, { bytes: valid }]);

    expect(() => invocation.invoke(host.bridge)).toThrow(malformed.error);
    expect(host.exports.engine_outbox_clear).toHaveBeenCalledTimes(1);
    expect(host.exports.dealloc).toHaveBeenCalledTimes(1);
    expect(host.requests).toHaveLength(1);
    expect(host.exports.dealloc).toHaveBeenNthCalledWith(1, inputPointer, host.requests[0].bytes.length);
    expect(host.events).toEqual(['alloc', invocation.exportName, 'dealloc', 'clear']);

    expect(invocation.invoke(host.bridge)).toEqual([
      { schemaVersion: 1, kind: invocation.outputKind, flags: 0, payload: Uint8Array.of(0x7b, 0x7d) }
    ]);
    expect(host.exports.engine_outbox_clear).toHaveBeenCalledTimes(2);
    expect(host.exports.dealloc).toHaveBeenCalledTimes(2);
    expect(host.requests).toHaveLength(2);
    expect(host.exports.dealloc).toHaveBeenNthCalledWith(2, inputPointer, host.requests[1].bytes.length);
    expect(host.events).toEqual([
      'alloc', invocation.exportName, 'dealloc', 'clear', 'alloc', invocation.exportName, 'dealloc', 'clear'
    ]);
  });

  it('复制完整多帧后清箱，保留种类、非零标记及二进制和空载荷', async () => {
    const bytes = Uint8Array.of(
      0x44, 0x56, 0x47, 0x32, 1, 0, 0xd3, 0, 0xef, 0xcd, 0xab, 0x89, 4, 0, 0, 0, 0, 0xff, 0x80, 0x42,
      0x44, 0x56, 0x47, 0x32, 1, 0, 0xd5, 0, 0x78, 0x56, 0x34, 0x12, 0, 0, 0, 0
    );
    const host = await controlledBridge([{ bytes }]);

    expect(invocation.invoke(host.bridge)).toEqual([
      { schemaVersion: 1, kind: 211, flags: 0x89abcdef, payload: Uint8Array.of(0, 0xff, 0x80, 0x42) },
      { schemaVersion: 1, kind: 213, flags: 0x12345678, payload: new Uint8Array() }
    ]);
    expect(host.exports.engine_outbox_clear).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(host.memory.buffer, outboxPointer, bytes.length)).toEqual(new Uint8Array(bytes.length));
    expect(host.requests).toHaveLength(1);
    const input = host.requests[0];
    const header = new DataView(input.bytes.buffer, input.bytes.byteOffset, 16);
    expect(input.exportName).toBe(invocation.exportName);
    expect(header.getUint32(0, true)).toBe(0x32475644);
    expect(header.getUint16(4, true)).toBe(1);
    expect(header.getUint16(6, true)).toBe(invocation.inputKind);
    expect(header.getUint32(8, true)).toBe(0);
    expect(header.getUint32(12, true)).toBe(input.bytes.length - 16);
    expect(JSON.parse(new TextDecoder().decode(input.bytes.slice(16)))).toEqual(invocation.request);
    expect(host.exports.dealloc).toHaveBeenCalledTimes(1);
    expect(host.exports.dealloc).toHaveBeenCalledWith(inputPointer, input.bytes.length);
  });
});

describe('TinyGoV2Bridge调用与清理边界', () => {
  it('非零返回码仍携带已复制的错误帧，清箱和输入释放各一次', async () => {
    const host = await controlledBridge([{ bytes: completeResponse(212), code: -1 }]);
    let failure: unknown;
    try { host.bridge.run({ probe: 'error' }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(TinyGoV2InvocationError);
    if (!(failure instanceof TinyGoV2InvocationError)) throw new Error('Expected invocation error');
    expect(failure.fnName).toBe('engine_run');
    expect(failure.code).toBe(-1);
    expect(failure.frames).toEqual([{ schemaVersion: 1, kind: 212, flags: 0, payload: Uint8Array.of(0x7b, 0x7d) }]);
    expect(host.exports.engine_outbox_clear).toHaveBeenCalledTimes(1);
    expect(host.exports.dealloc).toHaveBeenCalledTimes(1);
    expect(host.events).toEqual(['alloc', 'engine_run', 'dealloc', 'clear']);
  });

  it('导出抛错时finally仍释放输入，同一桥接对象下一次调用可恢复', async () => {
    const host = await controlledBridge([{ bytes: completeResponse(211) }]);
    const failure = new Error('controlled export failure');
    host.exports.engine_run.mockImplementationOnce(() => { throw failure; });
    expect(() => host.bridge.run({ probe: 'throw' })).toThrow(failure);
    expect(host.exports.dealloc).toHaveBeenCalledTimes(1);
    expect(host.exports.engine_outbox_clear).not.toHaveBeenCalled();
    expect(host.bridge.run({ probe: 'recover' })).toEqual([
      { schemaVersion: 1, kind: 211, flags: 0, payload: Uint8Array.of(0x7b, 0x7d) }
    ]);
    expect(host.exports.dealloc).toHaveBeenCalledTimes(2);
    expect(host.exports.engine_outbox_clear).toHaveBeenCalledTimes(1);
  });

  it('空出箱保持空结果，不制造帧或额外清理', async () => {
    const host = await controlledBridge([{ bytes: new Uint8Array() }]);
    expect(host.bridge.compile({ probe: 'empty' })).toEqual([]);
    expect(host.exports.dealloc).toHaveBeenCalledTimes(1);
    expect(host.exports.engine_outbox_clear).not.toHaveBeenCalled();
  });
});
