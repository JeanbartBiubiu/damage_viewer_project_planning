import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { compileCanonicalSession, instantiateGenericHost, releaseCanonicalSession, runCanonicalSession } from './generic-abi-host.mjs';
import { createPageMeasurementInputs, measurementSlotKeys } from './page-measurement-inputs.mjs';
import { measurementSourceDigest } from './prepare-page-measurement.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((entries, value, index, all) => {
  if (index % 2 === 0) {
    assert(value.startsWith('--') && all[index + 1] !== undefined, '参数需为 --名称 值');
    assert(!entries.some(([key]) => key === value.slice(2)), `重复参数${value}`);
    entries.push([value.slice(2), all[index + 1]]);
  }
  return entries;
}, []));
assert(args.formal && args.output, '需要 --formal <正式Wasm> --output <报告.json>；可另加 --measured <页数副本> --timing <仅计时副本> --formal-source <冻结源码文件摘要.json>');
for (const key of Object.keys(args)) assert(['formal', 'formal-source', 'measured', 'timing', 'output', 'iterations', 'warmup', 'rounds'].includes(key), `未知参数${key}`);
const iterations = Number(args.iterations ?? 200), warmup = Number(args.warmup ?? 20), rounds = Number(args.rounds ?? 3);
assert(Number.isSafeInteger(iterations) && iterations > 0 && Number.isSafeInteger(warmup) && warmup >= 0 && Number.isSafeInteger(rounds) && rounds > 0);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const outputPath = resolve(args.output), inputsDirectory = `${outputPath}.inputs`;
assert(!existsSync(outputPath) && !existsSync(inputsDirectory), '报告或冻结输入目录已存在，拒绝覆盖已有证据');
const distribution = values => {
  const sorted = [...values].sort((left, right) => left - right);
  assert(sorted.length > 0);
  const percentile = p => sorted[Math.ceil(sorted.length * p) - 1];
  return { count: sorted.length, min: sorted[0], p50: percentile(.5), p95: percentile(.95), max: sorted.at(-1) };
};
const u64 = value => {
  const number = Number(value);
  assert(Number.isSafeInteger(number) && number >= 0, '计数超出安全整数范围');
  return number;
};
const bits = (value, offset) => {
  const out = [];
  let word = BigInt(value);
  for (let bit = 0; bit < 64; bit++) if ((word & (1n << BigInt(bit))) !== 0n) out.push(offset + bit);
  return out;
};
const keyHash = key => {
  let value = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(key)) value = BigInt.asUintN(64, (value ^ BigInt(byte)) * 1099511628211n);
  return String(value);
};

function loadProbeIdentity(wasm, expectedMode) {
  let directory = dirname(wasm), file;
  for (let depth = 0; depth < 4; depth++) {
    const candidate = resolve(directory, 'measurement-manifest.json');
    if (existsSync(candidate)) { file = candidate; break; }
    directory = dirname(directory);
  }
  assert(file, '诊断产物缺少对应测量副本摘要，不能混用来源不明的Wasm');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(manifest.mode, expectedMode, '诊断副本模式不一致');
  assert.equal(manifest.sourceDigest, digest(JSON.stringify(manifest.files)), '原始来源摘要损坏');
  const files = new Map(manifest.files.map(row => [row.path, row.sha256]));
  for (const changed of manifest.modifiedFiles) files.set(changed.path, changed.sha256);
  for (const [path, sha256] of files) assert.equal(digest(readFileSync(resolve(dirname(file), path))), sha256, `测量副本在准备后被修改：${path}`);
  return { path: wasm, sha256: digest(readFileSync(wasm)), manifest: file, manifestSha256: digest(readFileSync(file)), sourceDigest: manifest.sourceDigest, instrumentation: manifest.instrumentation };
}

const formalPath = resolve(args.formal);
const formal = await instantiateGenericHost(formalPath);
const measuredPath = args.measured ? resolve(args.measured) : null;
const timingPath = args.timing ? resolve(args.timing) : null;
const measuredIdentity = measuredPath ? loadProbeIdentity(measuredPath, 'pages') : null;
const timingIdentity = timingPath ? loadProbeIdentity(timingPath, 'timing') : null;
const sourcePath = args['formal-source'] ? resolve(args['formal-source']) : null;
let formalSource = null;
if (sourcePath) {
  const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
  const files = Array.isArray(source) ? source : source.files;
  assert(Array.isArray(files) && files.length > 0, '冻结来源需要生产/构建文件摘要列表');
  const production = measurementSourceDigest(files);
  formalSource = { path: sourcePath, sha256: digest(readFileSync(sourcePath)), frozenFileCount: files.length, productionFileCount: production.files.length, sourceDigest: production.sourceDigest };
}
for (const probe of [measuredIdentity, timingIdentity].filter(Boolean)) {
  if (formalSource) assert.equal(probe.sourceDigest, formalSource.sourceDigest, '诊断副本与正式冻结源码不一致');
}
if (measuredIdentity && timingIdentity) assert.equal(measuredIdentity.sourceDigest, timingIdentity.sourceDigest, '页计数与仅计时副本来源不一致');
const measured = measuredPath ? await instantiateGenericHost(measuredPath) : null;
const timing = timingPath ? await instantiateGenericHost(timingPath) : null;
if (measured) {
  assert.equal(typeof measured.exports.engine_page_measure, 'function', '页数副本必须提供实际页计数导出');
  assert.equal(typeof measured.exports.engine_page_layout_key, 'function', '页数副本必须提供实际槽身份');
  assert.equal(typeof measured.exports.engine_profile_memory, 'function', '页数副本必须提供独立阶段统计');
}
if (timing) {
  assert.equal(typeof timing.exports.engine_profile_memory, 'function', '计时副本必须提供核心窗口统计');
  assert.equal(typeof timing.exports.engine_page_measure, 'undefined', '仅计时产物不得包含逐帧分页探针');
}

function measureRound(host, compiled, input, golden, withCore) {
  const durations = [], core = [];
  for (let iteration = 0; iteration < warmup + iterations; iteration++) {
    const start = performance.now();
    const done = runCanonicalSession(host.exports, input, compiled.sessionId, compiled.rulesHash);
    const elapsed = performance.now() - start;
    assertFinalAttributeValues(done, input);
    const json = JSON.stringify(done);
    if (golden === undefined) golden = json;
    else assert.equal(json, golden, `${input.name}/${input.runRequest.outputMode}同会话或跨产物输出漂移`);
    if (iteration >= warmup) {
      durations.push(elapsed);
      if (withCore) core.push(Array.from({ length: 7 }, (_, index) => u64(host.exports.engine_profile_memory(index))));
    }
  }
  return { golden, durations, core };
}
function assertFinalAttributeValues(done, input) {
  for (const [owner, values] of Object.entries(input.expectedFinalAttributeValues)) {
    const actor = done.finalSnapshot.combatants.find(row => row.key === owner);
    assert(actor, `缺少测量角色${owner}`);
    for (const [key, value] of Object.entries(values)) {
      assert.equal(actor.attributes[key]?.base, value, `${input.name}/${owner}/${key}基础值与手算不符`);
      assert.equal(actor.attributes[key]?.resolved, value, `${input.name}/${owner}/${key}最终值与手算不符`);
    }
  }
}
function summarizeCore(samples) {
  return Object.fromEntries(['mallocs', 'allocatedBytes', 'heapBefore', 'heapAfter', 'freesDuringCore', 'heapSys', 'durationNs'].map((key, index) => [key, distribution(samples.map(row => row[index]))]));
}
function readPageMeasurement(exports, input) {
  const maxFrame = u64(exports.engine_page_measure(0, 29));
  const overflow = u64(exports.engine_page_measure(0, 30));
  assert.equal(overflow, 0, '帧或属性槽超出冻结测量预算，不能截断计数');
  const candidates = measurementSlotKeys(input);
  const knownKeys = new Map(candidates.map(key => [keyHash(key), key]));
  assert.equal(knownKeys.size, candidates.length, '测量属性摘要发生冲突');
  const layouts = ['unattributed', 'source', 'target'].map((owner, participant) => {
    const count = u64(exports.engine_page_layout_key(participant, 0));
    assert(count <= 256, '实际目录超过冻结槽预算');
    return { owner, keys: Array.from({ length: count }, (_, index) => knownKeys.get(String(BigInt.asUintN(64, exports.engine_page_layout_key(participant, index + 1)))) ?? null) };
  });
  const frames = [];
  for (let frame = 0; frame <= maxFrame; frame++) {
    const participants = layouts.map(({ owner, keys }, participant) => {
      const readSlots = [], writtenSlots = [];
      for (let word = 0; word < 4; word++) {
        readSlots.push(...bits(exports.engine_page_measure(frame, 5 + participant * 4 + word), word * 64));
        writtenSlots.push(...bits(exports.engine_page_measure(frame, 17 + participant * 4 + word), word * 64));
      }
      for (const slot of [...readSlots, ...writtenSlots]) assert(keys[slot], `无法还原实际槽身份：${owner}/${slot}`);
      return { owner, readSlots, writtenSlots, readKeys: readSlots.map(slot => keys[slot]), writtenKeys: writtenSlots.map(slot => keys[slot]), writtenPages: [...new Set(writtenSlots.map(slot => Math.floor(slot / 8)))] };
    }).filter(participant => participant.readSlots.length || participant.writtenSlots.length);
    const counters = Array.from({ length: 5 }, (_, index) => u64(exports.engine_page_measure(frame, index)));
    if (frame !== 0 && !participants.length && !counters.some(Boolean)) continue;
    frames.push({ frame, directoriesCreated: counters[0], directoryEntriesCopied: counters[1], pagesCreated: counters[2], pagesCopied: counters[3], repeatedEditorPageReuses: counters[4], participants, distinctWrittenPages: participants.reduce((count, participant) => count + participant.writtenPages.length, 0) });
  }
  const core = Array.from({ length: 7 }, (_, index) => u64(exports.engine_profile_memory(index)));
  return {
    overflow, layouts, frames,
    totals: Object.fromEntries(['directoriesCreated', 'directoryEntriesCopied', 'pagesCreated', 'pagesCopied', 'repeatedEditorPageReuses'].map(key => [key, frames.reduce((sum, frame) => sum + frame[key], 0)])),
    diagnosticCore: Object.fromEntries(['mallocs', 'allocatedBytes', 'heapBefore', 'heapAfter', 'freesDuringCore', 'heapSys', 'durationNs'].map((key, index) => [key, core[index]])),
  };
}

const rows = [], frozenInputs = [];
for (const fixed of createPageMeasurementInputs()) {
  for (const mode of ['summary', 'detailed']) {
    const input = structuredClone(fixed);
    input.runRequest.outputMode = mode;
    if (mode === 'summary') input.runRequest.sampling = { ...input.runRequest.sampling, disabled: true };
    const compiled = compileCanonicalSession(formal.exports, input);
    const timedCompiled = timing ? compileCanonicalSession(timing.exports, input) : null;
    const durations = [], core = [], repetitions = [];
    let golden;
    for (let round = 0; round < rounds; round++) {
      const actual = measureRound(formal, compiled, input, golden, false);
      golden = actual.golden;
      durations.push(...actual.durations);
      const repetition = { round: round + 1, formalRunRoundTripMs: distribution(actual.durations), samples: { formalRunRoundTripMs: actual.durations } };
      if (timing) {
        const timed = measureRound(timing, timedCompiled, input, golden, true);
        core.push(...timed.core);
        repetition.coreRunOnly = summarizeCore(timed.core);
        repetition.timingProbeRoundTripMs = distribution(timed.durations);
        repetition.samples.core = timed.core;
      }
      repetitions.push(repetition);
    }
    releaseCanonicalSession(formal.exports, compiled.sessionId, compiled.rulesHash);
    if (timing) releaseCanonicalSession(timing.exports, timedCompiled.sessionId, timedCompiled.rulesHash);
    const inputPath = resolve(inputsDirectory, `${fixed.name}-${mode}.json`);
    const inputBytes = JSON.stringify(input, null, 2) + '\n';
    frozenInputs.push({ path: inputPath, bytes: inputBytes });
    const row = { key: fixed.name, mode, sampling: mode === 'summary' ? 'disabled' : 'fixed-input', inputSha256: digest(JSON.stringify(input)), inputArtifact: { path: inputPath, sha256: digest(inputBytes) }, resultSha256: digest(golden), runRoundTripMs: distribution(durations), rounds: repetitions };
    if (timing) row.coreRunOnly = summarizeCore(core);
    if (measured) {
      const withCounters = compileCanonicalSession(measured.exports, input);
      for (let iteration = 0; iteration <= warmup; iteration++) {
        const done = runCanonicalSession(measured.exports, input, withCounters.sessionId, withCounters.rulesHash);
        assertFinalAttributeValues(done, input);
        assert.equal(JSON.stringify(done), golden, '页数插桩改变正式运行输出，拒绝测量');
      }
      row.measurement = readPageMeasurement(measured.exports, input);
      releaseCanonicalSession(measured.exports, withCounters.sessionId, withCounters.rulesHash);
    }
    rows.push(row);
  }
}
const report = {
  kind: 'fixed-page-measurement', node: process.version, iterations, warmup, rounds, pageSize: 8,
  tools: { runnerSha256: digest(readFileSync(fileURLToPath(import.meta.url))), inputConstructorSha256: digest(readFileSync(new URL('./page-measurement-inputs.mjs', import.meta.url))) },
  thresholds: { repeatedRounds: 3, formalMedianImprovementPercent: 5, allocationReductionPercent: 10, maximumOtherScenarioRegressionPercent: 5 },
  formal: { path: formalPath, sha256: digest(readFileSync(formalPath)), source: formalSource }, measured: measuredIdentity, timing: timingIdentity,
  timingScope: {
    formal: '正式产物的Node ABI往返，包含编解码、出口清理与结果读取；不能当作纯计算或浏览器延迟',
    coreRunOnly: '相同正式构建参数的独立仅计时副本，窗口仅覆盖真实RunGeneric：summary关闭明细和采样；detailed包含记录和采样。不含JSON编解码、宿主往返；边界时钟读取仍可能影响微小时差',
    pageCounters: '独立页计数副本只证明实际页与槽，diagnosticCore包含逐帧探针，不用于收益判断',
    source: formalSource && (measured || timing) ? '诊断副本原始生产/构建文件摘要已与正式冻结清单逐字节对应' : formalSource ? '已记录正式冻结清单；本次尚未加载诊断副本' : '未提供正式源码清单：只证明固定输入输出一致，不能宣称源码与正式产物一致',
  },
  rows,
};
mkdirSync(dirname(outputPath), { recursive: true });
mkdirSync(inputsDirectory);
for (const input of frozenInputs) writeFileSync(input.path, input.bytes, { flag: 'wx' });
writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output: outputPath, scenarios: rows.length, rounds, formalSha256: report.formal.sha256, measured: Boolean(measured), timing: Boolean(timing), sourceMatched: Boolean(formalSource && (measured || timing)) }));
