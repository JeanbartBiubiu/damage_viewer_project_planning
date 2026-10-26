// 正式Wasm的Node采样入口；往返耗时包含宿主编解码及出口GC，不等于纯RunGeneric耗时。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import {
  compileCanonicalSession, instantiateGenericHost, moduleRoot, releaseCanonicalSession, runCanonicalSession,
} from './generic-abi-host.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function help() {
  console.log(`正式Wasm运行采样：
  node --cpu-prof --cpu-prof-interval=100 --cpu-prof-dir=<目录> scripts/profile-run-node.mjs --wasm <正式.wasm> --input <冻结.json> [--mode summary|detailed] [--sampling input|disabled] [--warmup 10] [--iterations 200] [--output <报告.json>]
采样结果归因：
  node scripts/profile-run-node.mjs --profile <文件.cpuprofile> [--output <报告.json>]

summary默认关闭采样点，detailed默认保留冻结输入的采样设置，可用--sampling明确覆盖。
每轮往返使用已有通用宿主；编译一次，每轮从冻结初态运行，最后释放会话。
CPU采样由Node提供，正式产物不增加诊断导出。归因仅保留Go调用栈中有scheduler.Loop.Run主循环的样本；
表格累计实际采样叶节点为Go函数的自身时间。叶节点为JS或系统函数时单列，不算成父Go函数自身。
若优化内联或符号消失导致没有主循环节点，明确返回0命中，不用RunGeneric替代。`);
}

function options(argv) {
  const result = { wasm: resolve(moduleRoot, 'dist/tinygo_engine_v2.wasm'), input: null, profile: null,
    output: null, mode: 'summary', sampling: null, warmup: 10, iterations: 200, help: false };
  const strings = new Set(['wasm', 'input', 'profile', 'output', 'mode', 'sampling']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { result.help = true; continue; }
    const key = arg.startsWith('--') ? arg.slice(2) : '';
    assert(strings.has(key) || ['warmup', 'iterations'].includes(key), `未知参数：${arg}`);
    const value = argv[++i];
    assert(value !== undefined && !value.startsWith('--'), `缺少参数值：${arg}`);
    result[key] = strings.has(key) ? value : Number(value);
  }
  assert(['summary', 'detailed'].includes(result.mode), '--mode需要summary或detailed');
  assert(result.sampling === null || ['input', 'disabled'].includes(result.sampling), '--sampling需要input或disabled');
  assert(Number.isSafeInteger(result.warmup) && result.warmup >= 0, '--warmup需要非负整数');
  assert(Number.isSafeInteger(result.iterations) && result.iterations > 0, '--iterations需要正整数');
  assert(!(result.profile && result.input), '--profile与--input分别用于归因和实际运行，不能混用');
  for (const key of ['wasm', 'input', 'profile', 'output']) if (result[key]) result[key] = resolve(result[key]);
  if (result.output) assert(![result.wasm, result.input, result.profile].includes(result.output), '--output不能覆盖输入或产物');
  return result;
}

function distribution(values) {
  if (!values.length) return { count: 0, min: null, mean: null, p50: null, p95: null, p99: null, max: null };
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (ratio) => sorted[Math.ceil(sorted.length * ratio) - 1];
  return { count: values.length, min: sorted[0], mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: sorted.at(-1) };
}

function isGoFrame(frame) {
  const name = frame.functionName ?? '';
  const url = frame.url ?? '';
  if (/^wasm:/.test(url) || /^wasm-function\[\d+\]/.test(name)) return true;
  if (url) return false;
  return name.includes('tinygo_engine_v2/') || /^(?:\(\*?)?(?:runtime|reflect|encoding\/|internal\/|math|strconv|strings|bytes|sort)[./]/.test(name);
}

function isLoopFrame(frame) {
  const name = (frame.functionName ?? '').replace(/[()*]/g, '');
  return isGoFrame(frame) && /(?:^|\s)tinygo_engine_v2\/internal\/scheduler\.Loop\.Run(?:$|[.$])/.test(name);
}

/** 只读取V8 CPUProfile，不运行或重编译Wasm。timeDeltas单位为微秒。 */
export function summarizeCpuProfile(profile) {
  assert(Array.isArray(profile.nodes) && Array.isArray(profile.samples) && Array.isArray(profile.timeDeltas), '缺少CPUProfile节点、样本或timeDeltas');
  assert(profile.samples.length === profile.timeDeltas.length, '样本数与timeDeltas数不同，不能推测采样时间');
  assert(Number.isFinite(profile.startTime) && Number.isFinite(profile.endTime) && profile.endTime >= profile.startTime, 'CPUProfile起止时刻无效');
  const nodes = new Map();
  const parents = new Map();
  for (const node of profile.nodes) {
    assert(Number.isSafeInteger(node.id) && !nodes.has(node.id) && node.callFrame, 'CPUProfile节点缺失或重复');
    nodes.set(node.id, node);
    for (const child of node.children ?? []) {
      assert(!parents.has(child), 'CPUProfile节点有多个父节点');
      parents.set(child, node.id);
    }
  }
  const loopNodes = profile.nodes.filter((node) => isLoopFrame(node.callFrame));
  const loopFlags = new Map();
  function withinLoop(id) {
    const chain = [];
    const visited = new Set();
    let current = id;
    while (current !== undefined && !loopFlags.has(current)) {
      assert(!visited.has(current), 'CPUProfile调用栈成环');
      assert(nodes.has(current), `CPUProfile缺少节点：${current}`);
      visited.add(current); chain.push(current); current = parents.get(current);
    }
    let matched = current !== undefined && loopFlags.get(current);
    for (let index = chain.length - 1; index >= 0; index--) {
      const frame = nodes.get(chain[index]).callFrame;
      matched ||= isLoopFrame(frame);
      loopFlags.set(chain[index], matched);
    }
    return loopFlags.get(id);
  }
  const go = new Map();
  const other = new Map();
  let totalTimeUs = 0, matchedSamples = 0, matchedTimeUs = 0, goSamples = 0, goTimeUs = 0;
  function add(table, frame, duration) {
    const functionName = frame.functionName || '(未命名)';
    const url = frame.url ?? '';
    const key = JSON.stringify([functionName, url]);
    const row = table.get(key) ?? { functionName, url, samples: 0, selfTimeUs: 0 };
    row.samples++; row.selfTimeUs += duration; table.set(key, row);
  }
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i], duration = profile.timeDeltas[i];
    assert(nodes.has(id), `CPUProfile样本引用未知节点：${id}`);
    assert(Number.isFinite(duration) && duration >= 0, 'timeDeltas需要非负微秒值');
    totalTimeUs += duration;
    if (!withinLoop(id)) continue;
    matchedSamples++; matchedTimeUs += duration;
    const frame = nodes.get(id).callFrame;
    if (isGoFrame(frame)) { goSamples++; goTimeUs += duration; add(go, frame, duration); }
    else add(other, frame, duration);
  }
  const rows = (table) => [...table.values()].sort((left, right) => right.selfTimeUs - left.selfTimeUs || left.functionName.localeCompare(right.functionName))
    .map((row) => ({ ...row, selfTimeMs: row.selfTimeUs / 1000,
      percentOfRunLoopSampleTime: matchedTimeUs ? row.selfTimeUs / matchedTimeUs * 100 : 0 }));
  return {
    kind: 'runLoop-cpu-profile', unit: 'microseconds',
    meaning: 'CPU样本的timeDeltas归到被采样叶节点；仅Go栈含scheduler.Loop.Run主循环时入选，不累计父函数包含子调用的时间。JS及系统叶节点单列。',
    interval: { startTimeUs: profile.startTime, endTimeUs: profile.endTime, profileDurationUs: profile.endTime - profile.startTime,
      sampledTimeUs: totalTimeUs, observedSamplingIntervalUs: distribution(profile.timeDeltas),
      requestedIntervalUs: null, note: '原始CPUProfile没有可靠的请求采样间隔；此处报告实际timeDeltas分布。请求值见运行报告的nodeExecArgv。' },
    samples: { total: profile.samples.length, runLoopStack: matchedSamples, goLeafSelf: goSamples,
      nonGoLeafWithinRunLoop: matchedSamples - goSamples },
    timeUs: { runLoopStack: matchedTimeUs, goLeafSelf: goTimeUs, nonGoLeafWithinRunLoop: matchedTimeUs - goTimeUs },
    runLoopNodes: loopNodes.map((node) => ({ id: node.id, ...node.callFrame })),
    functions: rows(go), nonGoLeaves: rows(other),
    warnings: matchedSamples ? [] : ['没有命中含scheduler.Loop.Run主循环的Go栈，无法归因；可能未采样到该路径，或正式优化产物已将该函数内联、消名。不能用RunGeneric或全部Wasm样本替代。'],
  };
}

async function profileRun(args) {
  assert(args.input, '实际运行必须提供--input冻结请求');
  const inputBytes = readFileSync(args.input);
  const input = JSON.parse(inputBytes);
  assert(input?.compileRequest && input?.runRequest, '冻结输入必须包含compileRequest和runRequest');
  const sampling = args.sampling ?? (args.mode === 'summary' ? 'disabled' : 'input');
  const fixture = { ...input, runRequest: { ...input.runRequest, outputMode: args.mode } };
  if (sampling === 'disabled') fixture.runRequest.sampling = { ...input.runRequest.sampling, disabled: true };
  const host = await instantiateGenericHost(args.wasm);
  const compiled = compileCanonicalSession(host.exports, fixture);
  const durations = [];
  let golden, resultSha256, resultBytes, lastSummary;
  let succeeded = false;
  try {
    for (let iteration = 0; iteration < args.warmup + args.iterations; iteration++) {
      const start = performance.now();
      const done = runCanonicalSession(host.exports, fixture, compiled.sessionId, compiled.rulesHash);
      const elapsed = performance.now() - start;
      if (iteration >= args.warmup) durations.push(elapsed);
      const json = JSON.stringify(done);
      if (golden === undefined) { golden = json; resultSha256 = sha256(json); resultBytes = Buffer.byteLength(json); }
      else assert.equal(json, golden, `第${iteration + 1}次输出不同`);
      lastSummary = done.summary;
    }
    succeeded = true;
  } finally {
    // 失败时保持首次错误，避免再次调用可能已失效的实例掩盖异常陷阱。
    if (succeeded) releaseCanonicalSession(host.exports, compiled.sessionId, compiled.rulesHash);
  }
  return { kind: 'formal-wasm-node-run', node: process.version, nodeExecArgv: process.execArgv,
    wasm: { path: args.wasm, bytes: host.sizeBytes, sha256: sha256(host.bytes) },
    input: { path: args.input, bytes: inputBytes.length, sha256: sha256(inputBytes) },
    mode: args.mode, sampling, warmup: args.warmup, iterations: args.iterations,
    timingScope: '编译与释放不计入；每轮runCanonicalSession包含请求JSON/UTF8、alloc、engine_run、dealloc、复制出箱、出口清理GC、结果解码及摘要校验。不是纯RunGeneric耗时。结果一致性JSON比较在计时外。',
    cpuScope: 'Node --cpu-prof采集整个进程，包含初始化、编译、预热、检查和释放；应另用--profile筛选含scheduler.Loop.Run主循环的Go栈。没有增加Wasm诊断导出。',
    runRoundTripMs: distribution(durations), resultSha256, resultBytes, repeatedEquivalent: true, released: true, lastSummary };
}

async function main() {
  const args = options(process.argv.slice(2));
  if (args.help) { help(); return; }
  let report;
  if (args.profile) {
    const bytes = readFileSync(args.profile);
    report = { ...summarizeCpuProfile(JSON.parse(bytes)), profile: { path: args.profile, bytes: bytes.length, sha256: sha256(bytes) } };
  } else report = await profileRun(args);
  const output = JSON.stringify(report, null, 2);
  if (args.output) {
    mkdirSync(dirname(args.output), { recursive: true });
    writeFileSync(args.output, output + '\n');
    console.log(JSON.stringify({ output: args.output, kind: report.kind, samples: report.samples, warnings: report.warnings,
      runRoundTripMs: report.runRoundTripMs, resultSha256: report.resultSha256 }));
  } else console.log(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
