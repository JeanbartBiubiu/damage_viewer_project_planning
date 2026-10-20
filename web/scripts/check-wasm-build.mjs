/** 正式参数重建当前源码，仅在忽略目录写产物，绝不覆盖分发文件。 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertWasmBuildMatches } from './lib/wasmBuild.mjs';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = resolve(WEB, '../wasm/tinygo_engine_v2');

export function checkWasmBuild() {
  const output = resolve(WEB, 'output');
  mkdirSync(output, { recursive: true });
  const directory = mkdtempSync(resolve(output, 'wasm-source-check-'));
  const rebuiltPath = resolve(directory, 'tinygo_engine_v2.wasm');
  const out = relative(ENGINE, rebuiltPath);
  const windows = process.platform === 'win32';
  const command = windows ? 'powershell.exe' : 'bash';
  const args = windows
    ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve(ENGINE, 'scripts/build-wasm.ps1'), '-Out', out]
    : [resolve(ENGINE, 'scripts/build-wasm.sh')];
  if (windows && process.env.TINYGO) args.push('-TinyGo', process.env.TINYGO);
  const build = spawnSync(command, args, { cwd: ENGINE, stdio: 'inherit',
    env: { ...process.env, OUT: out, ENTRY: './cmd/engine_wasm' } });
  if (build.error || build.status !== 0) throw new Error(`当前源码正式构建失败，拒绝继续回归；产物目录 ${relative(WEB, directory)}：${build.error?.message ?? `退出码 ${build.status}`}`);
  const match = /bytes:\s*(\d+),\s*sha256:\s*'([0-9a-f]{64})'/.exec(readFileSync(resolve(WEB, 'src/engine/wasmIdentity.ts'), 'utf8'));
  const receipt = assertWasmBuildMatches(rebuiltPath, resolve(WEB, 'src/engine/wasm/tinygo_engine_v2.wasm'),
    match && { bytes: Number(match[1]), sha256: match[2] });
  // 仅删除本次成功检查生成的单个文件和空目录；失败产物留在忽略目录排查。
  rmSync(rebuiltPath);
  rmdirSync(directory);
  console.log(`当前源码正式构建与分发Wasm逐字节一致：${receipt.bytes} 字节，${receipt.sha256}`);
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { checkWasmBuild(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
