import { execFileSync } from 'node:child_process';
import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync,
  renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function requireScope(value, label) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)) {
    throw new Error(`${label}只允许小写字母、数字、下划线和短横线，并以小写字母或数字开头。`);
  }
}

export function localPaths(repositoryRoot = sourceRoot) {
  const listing = execFileSync('git', [
    '-c', `safe.directory=${repositoryRoot}`, 'worktree', 'list', '--porcelain', '-z',
  ], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const firstWorktree = listing.split('\0\0')[0].split('\0');
  if (!firstWorktree[0].startsWith('worktree ') || firstWorktree.includes('bare')) {
    throw new Error('无法定位主检出，不能另建一份本机登记。');
  }
  const mainRoot = resolve(firstWorktree[0].slice('worktree '.length));
  if (!existsSync(mainRoot) || !statSync(mainRoot).isDirectory()) {
    throw new Error('主检出不可用，不能在其他工作树另建登记。');
  }
  const localDirectory = join(mainRoot, 'agents', '.local');
  return { mainRoot, localDirectory, registryPath: join(localDirectory, 'sessions.json') };
}

function writeJson(path, value) {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    const descriptor = openSync(temporaryPath, 'wx');
    try {
      writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

// 回调同步执行；跨文件更新统一按 sessions → 状态/运行登记的顺序拿锁。
export function withLocalJson(repositoryRoot, fileName, callback) {
  if (!/^[a-z][a-z0-9-]*\.json$/.test(fileName)) throw new Error('本地登记文件名无效。');
  const { localDirectory } = localPaths(repositoryRoot);
  mkdirSync(localDirectory, { recursive: true });
  const path = join(localDirectory, fileName);
  const lockPath = `${path}.lock`;
  let descriptor;
  try {
    descriptor = openSync(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`本地登记正被占用，请核对持有进程后重试：${lockPath}`);
    throw error;
  }
  try {
    writeFileSync(descriptor, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    let content;
    try {
      content = readFileSync(path, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    let value = null;
    if (content !== undefined) {
      try { value = JSON.parse(content); }
      catch { throw new Error(`本地登记 ${fileName} 不是有效 JSON，已保留原文件，不能重新初始化覆盖。`); }
      if (value === null) throw new Error(`本地登记 ${fileName} 结构无效，已保留原文件。`);
    }
    const change = callback(value);
    if (!isRecord(change) || typeof change.then === 'function') throw new Error('本地登记回调必须同步返回明确结果。');
    if (Object.hasOwn(change, 'value')) writeJson(path, change.value);
    return change.result;
  } finally {
    closeSync(descriptor);
    unlinkSync(lockPath);
  }
}
