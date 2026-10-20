/**
 * 引擎或适配器变化后刷新正式准入证明的引擎身份，替代逐对象全量重跑。
 *
 *   node scripts/refresh-verification-identity.mjs [--game lol]          只检查，不写文件
 *   node scripts/refresh-verification-identity.mjs [--game lol] --write  全部条件满足后改写证明
 *
 * --check-coverage 只检查声明，不运行回归或生成证明。
 * 条件：Wasm 身份常量与产物一致；前端执行链、共享契约和引擎源码没有未提交改动（源码身份即提交号）；
 * 每个 PASSED 准入对象在 tests/mechanisms/admitted-coverage.json 声明的依赖机制都有用例；机制回归全部通过。
 * 只改写证明根上的 wasmSha256、adapterVersion 和 mechanismRegression，不改各对象的内容摘要。
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coverageGaps } from './lib/verificationRegression.mjs';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(WEB, '..');
const MECHANISMS = resolve(WEB, 'tests/mechanisms');
const args = process.argv.slice(2);
const game = args.includes('--game') ? args[args.indexOf('--game') + 1] : 'lol';
const write = args.includes('--write');
const coverageOnly = args.includes('--check-coverage');
const allowed = new Set(['--write', '--game', '--check-coverage']);
for (let index = 0; index < args.length; index++) {
  if (!allowed.has(args[index])) fail(`未知参数：${args[index]}`);
  if (args[index] === '--game') index++;
}
if (write && coverageOnly) fail('--check-coverage 不生成证明，不能与 --write 同用');

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function fail(message) {
  console.error(message);
  process.exit(1);
}
function git(...gitArgs) {
  const result = spawnSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) fail(`git ${gitArgs.join(' ')} 失败：${result.stderr}`);
  return result.stdout.trim();
}

if (!/^[a-z][a-z0-9_]{0,63}$/.test(game ?? '')) fail('--game 需要合法游戏标识');
const wasm = readFileSync(resolve(WEB, 'src/engine/wasm/tinygo_engine_v2.wasm'));
const declared = /bytes:\s*(\d+),\s*sha256:\s*'([0-9a-f]{64})'/.exec(readFileSync(resolve(WEB, 'src/engine/wasmIdentity.ts'), 'utf8'));
if (!declared || Number(declared[1]) !== wasm.length || declared[2] !== sha256(wasm)) {
  fail('src/engine/wasmIdentity.ts 的 WASM_IDENTITY 与实际 Wasm 产物不一致，先同步身份常量');
}
const adapterVersion = /SIMULATION_ADAPTER_VERSION = '([^']+)'/.exec(readFileSync(resolve(WEB, 'src/engine/simulationAdapter.ts'), 'utf8'))?.[1];
if (!adapterVersion) fail('src/engine/simulationAdapter.ts 中找不到 SIMULATION_ADAPTER_VERSION');

const sourceCommit = git('rev-parse', 'HEAD');
function checkSourceIdentity() {
  const dirty = git('status', '--porcelain', '--untracked-files=all', '--', 'web', 'wasm/tinygo_engine_v2', 'contracts', '.gitattributes');
  if (dirty) fail(`源码身份以提交号为准，以下执行链路径需先提交：\n${dirty}`);
  if (git('rev-parse', 'HEAD') !== sourceCommit) fail('回归运行期间提交发生变化，请重新验证');
}
if (!coverageOnly) checkSourceIdentity();

const fileDigests = [];
const covered = new Set();
for (const directory of ['catalogs', 'cases']) {
  for (const name of readdirSync(resolve(MECHANISMS, directory)).filter(file => file.endsWith('.json')).sort()) {
    const bytes = readFileSync(resolve(MECHANISMS, directory, name));
    fileDigests.push(`${directory}/${name}:${sha256(bytes)}`);
    if (directory === 'cases') for (const tag of JSON.parse(bytes.toString('utf8')).mechanisms) covered.add(tag);
  }
}
const caseCount = fileDigests.filter(row => row.startsWith('cases/')).length;

const proofPath = resolve(ROOT, `server/data_manage/src/main/resources/simulation-verification/${game}/combat-analysis.json`);
const proofBytes = readFileSync(proofPath, 'utf8');
const proof = JSON.parse(proofBytes);
const coverage = JSON.parse(readFileSync(resolve(MECHANISMS, 'admitted-coverage.json'), 'utf8'));
const gaps = coverageGaps(proof, coverage, game, covered);
if (gaps.length) {
  fail(`以下准入对象依赖的机制未被机制回归覆盖，不能只凭机制回归刷新证明（${gaps.length} 项）：\n${gaps.join('\n')}`);
}
if (coverageOnly) {
  console.log(`依赖检查通过：${proof.entries.filter(row => row.outcome === 'PASSED').length} 个对象，${covered.size} 类机制，${caseCount} 个用例；未运行回归、未生成证明`);
  process.exit(0);
}

const vitest = spawnSync(process.execPath, [resolve(WEB, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.config.ts', 'tests/mechanisms'],
  { cwd: WEB, stdio: 'inherit' });
if (vitest.status !== 0) fail('机制回归未通过，不刷新证明');
checkSourceIdentity();
if (readFileSync(proofPath, 'utf8') !== proofBytes) fail('回归运行期间正式证明发生变化，拒绝覆盖');

const { entries, mechanismRegression: _previous, ...head } = proof;
const next = {
  ...head,
  wasmSha256: sha256(wasm),
  adapterVersion,
  mechanismRegression: { sourceCommit, caseCount, casesDigest: sha256(fileDigests.join('\n')),
    coverageDigest: sha256(readFileSync(resolve(MECHANISMS, 'admitted-coverage.json'))) },
  entries
};
const summary = `wasm ${next.wasmSha256}，适配器 ${adapterVersion}，提交 ${sourceCommit}，用例 ${caseCount} 个`;
if (!write) {
  console.log(`检查通过（未写入）：${summary}。加 --write 改写 ${proofPath}`);
} else {
  writeFileSync(proofPath, JSON.stringify(next, null, 2) + '\n');
  console.log(`已刷新证明：${summary}`);
}
