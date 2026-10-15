// 独立分配诊断；ReadMemStats扫描回收元数据，本脚本不输出耗时或存活性结论。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileCanonicalSession, instantiateGenericHost, releaseCanonicalSession, runCanonicalSession } from './generic-abi-host.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function counter(value, name) {
  if (typeof value === 'bigint') {
    assert(value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER), `${name}超出可精确报告的安全整数范围`);
    return Number(value);
  }
  assert(Number.isSafeInteger(value) && value >= 0, `${name}需要非负安全整数`);
  return value;
}

function readMemory(exports) {
  // index=0刷新同一份累计统计；之后1～4读取该快照，不再重新扫描。
  return {
    totalAlloc: counter(exports.engine_memory_read(0), 'TotalAlloc'),
    mallocs: counter(exports.engine_memory_read(1), 'Mallocs'),
    heapAlloc: counter(exports.engine_memory_read(2), 'HeapAlloc'),
    heapSys: counter(exports.engine_memory_read(3), 'HeapSys'),
    frees: counter(exports.engine_memory_read(4), 'Frees'),
  };
}

function readCore(exports) {
  const values = Array.from({ length: 6 }, (_, index) => counter(exports.engine_profile_memory(index), `core[${index}]`));
  return { mallocs: values[0], allocatedBytes: values[1], heapBefore: values[2], heapAfter: values[3],
    freesDuringCore: values[4], heapSys: values[5] };
}

/** 传给现有通用宿主的JS代理；不改Wasm导出，也不包住输入alloc或出箱清理。 */
export function createAllocationObserver(exports) {
  for (const name of ['engine_run', 'engine_memory_read', 'engine_profile_memory']) {
    assert.equal(typeof exports[name], 'function', `需要分配诊断产物，缺少${name}导出`);
  }
  assert(exports.memory?.buffer, '诊断产物缺少memory');
  const run = exports.engine_run;
  let last = null, calls = 0;
  return {
    exports: { ...exports, engine_run(...args) {
      last = null;
      const before = readMemory(exports);
      const capacityBefore = exports.memory.buffer.byteLength;
      // 真正的engine_run返回后立即取累计统计；此时宿主尚未dealloc或readOutbox。
      // 若异常陷阱直接抛出，不再次进入可能已损坏的实例，避免掩盖首次错误。
      const returnCode = run(...args);
      const after = readMemory(exports);
      for (const name of ['totalAlloc', 'mallocs', 'frees']) assert(after[name] >= before[name], `${name}计数回退或溢出，不能报告差值`);
      last = {
        call: ++calls, returnCode,
        engineRun: { mallocs: after.mallocs - before.mallocs, allocatedBytes: after.totalAlloc - before.totalAlloc,
          freesDuringRun: after.frees - before.frees, heapBefore: before.heapAlloc, heapAfter: after.heapAlloc,
          heapSysBefore: before.heapSys, heapSysAfter: after.heapSys,
          linearMemoryBefore: capacityBefore, linearMemoryAfter: exports.memory.buffer.byteLength },
        core: returnCode === 0 ? readCore(exports) : null,
        cumulativeBefore: before, cumulativeAfter: after,
      };
      return returnCode;
    } },
    lastCall: () => last,
    afterClear: () => {
      const current = readMemory(exports);
      return { heapAlloc: current.heapAlloc, heapSys: current.heapSys, linearMemoryCapacity: exports.memory.buffer.byteLength,
        cumulativeMallocs: current.mallocs, cumulativeAllocatedBytes: current.totalAlloc, cumulativeFrees: current.frees };
    },
  };
}

function options(argv) {
  const result = { wasm: null, input: null, mode: 'summary', warmup: 3, iterations: 10, output: null, help: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') { result.help = true; continue; }
    const key = arg.startsWith('--') ? arg.slice(2) : '';
    assert(['wasm', 'input', 'mode', 'warmup', 'iterations', 'output'].includes(key), `未知参数：${arg}`);
    const value = argv[++index];
    assert(value !== undefined && !value.startsWith('--'), `缺少参数值：${arg}`);
    result[key] = ['warmup', 'iterations'].includes(key) ? Number(value) : value;
  }
  assert(['summary', 'detailed'].includes(result.mode), '--mode需要summary或detailed');
  assert(Number.isSafeInteger(result.warmup) && result.warmup >= 0, '--warmup需要非负整数');
  assert(Number.isSafeInteger(result.iterations) && result.iterations > 0, '--iterations需要正整数');
  for (const key of ['wasm', 'input', 'output']) if (result[key]) result[key] = resolve(result[key]);
  if (result.output) assert(![result.wasm, result.input].includes(result.output), '--output不能覆盖输入或产物');
  return result;
}

function stats(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return { count: values.length, mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    min: sorted[0], max: sorted.at(-1) };
}

async function main() {
  const args = options(process.argv.slice(2));
  if (args.help) {
    console.log(`用法：node scripts/allocation-run-node.mjs --wasm <分配诊断.wasm> --input <冻结.json> [--mode summary|detailed] [--warmup 3] [--iterations 10] [--output <报告.json>]
需要现有engine_memory_read及engine_profile_memory诊断导出；正式构建不增加导出。
engineRun窗口是实际engine_run调用前后的Mallocs和TotalAlloc差，排除输入alloc、宿主复制和outbox_clear。
core窗口沿用产物内部RunGeneric插桩。另返回出箱清理后的HeapAlloc及线性内存容量。
summary关闭采样点；detailed保留冻结输入的采样配置。每轮输出与第一轮比较。
ReadMemStats插桩不能用于计时、峰值存活对象数或内存泄漏结论。`);
    return;
  }
  assert(args.wasm && args.input, '必须显式提供--wasm分配诊断产物及--input冻结请求');
  const inputBytes = readFileSync(args.input), fixture = JSON.parse(inputBytes);
  assert(fixture?.compileRequest && fixture?.runRequest, '冻结输入必须包含compileRequest和runRequest');
  const input = { ...fixture, runRequest: { ...fixture.runRequest, outputMode: args.mode } };
  if (args.mode === 'summary') input.runRequest.sampling = { ...fixture.runRequest.sampling, disabled: true };
  const host = await instantiateGenericHost(args.wasm);
  const observer = createAllocationObserver(host.exports);
  const compiled = compileCanonicalSession(observer.exports, input);
  let golden, resultSha256, resultBytes, succeeded = false;
  const samples = [];
  try {
    for (let index = 0; index < args.warmup + args.iterations; index++) {
      const done = runCanonicalSession(observer.exports, input, compiled.sessionId, compiled.rulesHash);
      const sample = observer.lastCall();
      assert(sample && sample.returnCode === 0 && sample.core, '缺少本次成功engine_run的诊断，不能复用旧值');
      const afterClear = observer.afterClear();
      const json = JSON.stringify(done);
      if (golden === undefined) { golden = json; resultSha256 = sha256(json); resultBytes = Buffer.byteLength(json); }
      else assert.equal(json, golden, `第${index + 1}次输出不同`);
      if (index >= args.warmup) samples.push({ iteration: index - args.warmup + 1, ...sample, afterClear });
    }
    succeeded = true;
  } finally {
    if (succeeded) releaseCanonicalSession(observer.exports, compiled.sessionId, compiled.rulesHash);
  }
  const report = {
    kind: 'wasm-allocation-diagnostic', node: process.version,
    wasm: { path: args.wasm, bytes: host.sizeBytes, sha256: sha256(host.bytes), diagnostic: true },
    input: { path: args.input, bytes: inputBytes.length, sha256: sha256(inputBytes) },
    mode: args.mode, sampling: args.mode === 'summary' ? 'disabled' : 'input', warmup: args.warmup, iterations: args.iterations,
    windows: {
      engineRun: '在官方宿主已分配并写好输入后，实际engine_run前/后读取累计Mallocs及TotalAlloc作差；包含运行期请求解码、RunGeneric及结果编码；排除输入alloc、宿主dealloc、出箱复制、outbox_clear及出口GC。',
      core: '沿用诊断产物engine_profile_memory：0=Mallocs差、1=TotalAlloc差、2=开始HeapAlloc、3=结束HeapAlloc、4=Frees差、5=结束HeapSys。窗口由该诊断构建内的RunGeneric插桩决定。',
      afterClear: '官方runCanonicalSession完成出箱清理和结果解码后读取HeapAlloc、HeapSys及memory.buffer容量；不计入engineRun分配差。',
    },
    limitations: ['ReadMemStats扫描元数据并改变诊断执行，本脚本不测量耗时。',
      'Mallocs是分配调用数，不能解释为峰值存活对象数；Frees及清理后的HeapAlloc不能单独证明没有GC、没有泄漏或峰值内存下降。',
      '成功结果首轮一致性不代替与正式构建的逐字节输出对照；分配统计只对应报告中的诊断产物。'],
    summary: Object.fromEntries(['engineRun', 'core'].map((window) => [window,
      Object.fromEntries(['mallocs', 'allocatedBytes'].map((field) => [field, stats(samples.map((row) => row[window][field]))]))])),
    afterClear: Object.fromEntries(['heapAlloc', 'heapSys', 'linearMemoryCapacity'].map((field) => [field, stats(samples.map((row) => row.afterClear[field]))])),
    resultSha256, resultBytes, repeatedEquivalent: true, released: true, samples,
  };
  const output = JSON.stringify(report, null, 2);
  if (args.output) {
    mkdirSync(dirname(args.output), { recursive: true }); writeFileSync(args.output, output + '\n');
    console.log(JSON.stringify({ output: args.output, wasmSha256: report.wasm.sha256, resultSha256, summary: report.summary }));
  } else console.log(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
