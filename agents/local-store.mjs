import { execFileSync } from 'node:child_process';
import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function requireScope(value, label) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)) {
    throw new Error(`${label}只允许小写字母、数字、下划线和短横线，并以小写字母或数字开头。`);
  }
}

export function gitSafeDirectory(directoryPath) {
  return resolve(directoryPath).replaceAll(sep, '/');
}

// 同机所有工作树共用主检出中的一份本地数据。
export function localPaths(repositoryRoot = sourceRoot) {
  const listing = execFileSync('git', [
    '-c', `safe.directory=${gitSafeDirectory(repositoryRoot)}`, 'worktree', 'list', '--porcelain', '-z',
  ], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const mainRoot = resolve(listing.split('\0')[0].slice('worktree '.length));
  return { mainRoot, localDirectory: join(mainRoot, 'agents', '.local') };
}

export function rolePaths(repositoryRoot, roleId) {
  const definitionPath = join(repositoryRoot, 'agents', 'roles', roleId, 'README.md');
  if (!existsSync(definitionPath)) throw new Error(`角色 ${roleId} 缺少定义 agents/roles/${roleId}/README.md。`);
  const localRoleDirectory = join(localPaths(repositoryRoot).mainRoot, 'agents', 'roles', roleId, '.local');
  return {
    definitionPath, todoPath: join(localRoleDirectory, 'todo.json'), memoryPath: join(localRoleDirectory, 'memory.md'),
  };
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

// 回调收到已解析内容（文件不存在为 null），返回 { result, value? }；带 value 时原子替换文件。
function withJsonFile(path, callback) {
  mkdirSync(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  let descriptor;
  try {
    descriptor = openSync(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`本地文件正被占用，核对持有进程后再删除锁：${lockPath}`);
    throw error;
  }
  try {
    writeFileSync(descriptor, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    let value = null;
    if (existsSync(path)) {
      try { value = JSON.parse(readFileSync(path, 'utf8')); }
      catch { throw new Error(`本地文件 ${basename(path)} 不是有效 JSON，已保留原文件。`); }
    }
    const change = callback(value);
    if (Object.hasOwn(change, 'value')) writeJson(path, change.value);
    return change.result;
  } finally {
    closeSync(descriptor);
    unlinkSync(lockPath);
  }
}

export function withLocalJson(repositoryRoot, fileName, callback) {
  return withJsonFile(join(localPaths(repositoryRoot).localDirectory, fileName), callback);
}

export function withRoleJson(repositoryRoot, roleId, fileName, callback) {
  return withJsonFile(join(dirname(rolePaths(repositoryRoot, roleId).todoPath), fileName), callback);
}
