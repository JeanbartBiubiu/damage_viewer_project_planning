import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadGoRuntime, moduleRoot } from './generic-abi-host.mjs';

const artifact = resolve(moduleRoot, process.argv[2] ?? 'target/formula-phase2/formula_probe.wasm');
loadGoRuntime();
const go = new globalThis.Go();
const bytes = readFileSync(artifact);
const result = await WebAssembly.instantiate(bytes, go.importObject);
const instance = result.instance ?? result;
await Promise.race([go.run(instance), Promise.resolve()]);
assert.equal(typeof instance.exports.formula_probe_check, 'function');
const cases = ['两结果倍率', '六结果倍率', '展示顺序与名称', '缺输入', '非有限输入', '惰性分支与合法零', '动态除零', '负中点舍入', '4096目录边界', '65536程序边界', '同一纯程序20次变化输入'];
for (const [index, name] of cases.entries()) {
  assert.equal(instance.exports.formula_probe_check(index), 0, name);
}
for (let iteration = 0; iteration < 20; iteration++) {
  assert.equal(instance.exports.formula_probe_check(iteration % 3), 0, `重复纯公式执行${iteration}`);
}
assert.equal(instance.exports.memory.buffer.byteLength, 256 * 1024 * 1024);
console.log(JSON.stringify({ artifact, sizeBytes: bytes.byteLength, memoryBytes: instance.exports.memory.buffer.byteLength, cases: cases.length, sameProgramEvaluations: 20, repeatedEvaluations: 20, result: 'pass', boundary: '独立纯公式验证，不是正式战斗ABI或浏览器工作线程' }));
