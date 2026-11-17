import { execFileSync } from 'node:child_process';
import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync,
  renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (value, key) => Object.hasOwn(value, key);

function requireIdentifier(value, label) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(value)) {
    throw new Error(`${label}必须是有效编号，不能包含空白或路径分隔符。`);
  }
}

function requireScope(value, label) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)) {
    throw new Error(`${label}只允许小写字母、数字、下划线和短横线，并以小写字母或数字开头。`);
  }
}

function requireGeneration(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('预期代次必须是非负安全整数；首次登记使用 0。');
  }
}

function validateRegistry(value) {
  const invalid = () => { throw new Error('本机会话登记结构无效，已保留原文件。'); };
  if (!isRecord(value) || value.formatVersion !== 1 || !isRecord(value.environments)
      || Object.keys(value).length !== 2) invalid();
  for (const [environmentId, sessions] of Object.entries(value.environments)) {
    requireScope(environmentId, '登记环境');
    if (!isRecord(sessions)) invalid();
    for (const [roleId, session] of Object.entries(sessions)) {
      requireScope(roleId, '登记角色');
      if (!isRecord(session) || Object.keys(session).length !== 4
          || !hasOwn(session, 'threadId') || !hasOwn(session, 'hostId')
          || !hasOwn(session, 'generation') || !hasOwn(session, 'registeredAt')) invalid();
      requireIdentifier(session.threadId, '登记会话');
      requireIdentifier(session.hostId, '登记宿主');
      if (!Number.isSafeInteger(session.generation) || session.generation < 1
          || typeof session.registeredAt !== 'string'
          || !Number.isFinite(Date.parse(session.registeredAt))) invalid();
    }
  }
  return value;
}

function localPaths(repositoryRoot) {
  const listing = execFileSync('git', [
    '-c', `safe.directory=${repositoryRoot}`, 'worktree', 'list', '--porcelain', '-z',
  ], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const firstWorktree = listing.split('\0\0')[0].split('\0');
  if (!firstWorktree[0].startsWith('worktree ') || firstWorktree.includes('bare')) {
    throw new Error('无法定位主检出，不能另建一份本机会话登记。');
  }
  const mainRoot = resolve(firstWorktree[0].slice('worktree '.length));
  if (!existsSync(mainRoot) || !statSync(mainRoot).isDirectory()) {
    throw new Error('主检出不可用，不能在其他工作树另建登记。');
  }
  const localDirectory = join(mainRoot, 'agents', '.local');
  return { localDirectory, registryPath: join(localDirectory, 'sessions.json') };
}

function readRegistry(registryPath) {
  let content;
  try {
    content = readFileSync(registryPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  let value;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error('本机会话登记不是有效 JSON，已保留原文件，不能重新初始化覆盖。');
  }
  return validateRegistry(value);
}

function writeRegistry(registryPath, registry) {
  const temporaryPath = `${registryPath}.${randomUUID()}.tmp`;
  const descriptor = openSync(temporaryPath, 'wx');
  try {
    writeFileSync(descriptor, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    renameSync(temporaryPath, registryPath);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

// 只管理登记事实，不创建会话、发送任务或撤销旧会话的真实权限。
export function sessionRegistry(request, repositoryRoot = sourceRoot) {
  const { command, roleId, environmentId, threadId, hostId, expectedGeneration } = request;
  if (!['init', 'resolve', 'bind'].includes(command)) {
    throw new Error('命令必须是 init、resolve 或 bind。');
  }
  if (command !== 'init') {
    requireScope(roleId, '角色');
    requireScope(environmentId, '环境');
    const definitionPath = join(repositoryRoot, 'agents', 'roles', `${roleId}.md`);
    if (!existsSync(definitionPath) || !statSync(definitionPath).isFile()) {
      throw new Error('角色定义不存在，请先核对 agents/roles/。');
    }
  }
  if (command === 'bind') {
    requireIdentifier(threadId, '会话');
    requireIdentifier(hostId, '宿主');
    requireGeneration(expectedGeneration);
  }

  const { localDirectory, registryPath } = localPaths(repositoryRoot);
  mkdirSync(localDirectory, { recursive: true });
  const lockPath = `${registryPath}.lock`;
  let lockDescriptor;
  try {
    lockDescriptor = openSync(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`会话登记正被占用，请核对持有进程后重试：${lockPath}`);
    throw error;
  }
  try {
    writeFileSync(lockDescriptor, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const existing = readRegistry(registryPath);
    const registry = existing ?? { formatVersion: 1, environments: {} };
    let changed = !existing;
    let result = { status: existing ? 'existing' : 'initialized', registryPath };
    if (command !== 'init') {
      const sessions = hasOwn(registry.environments, environmentId) ? registry.environments[environmentId] : {};
      const current = hasOwn(sessions, roleId) ? sessions[roleId] : null;
      let active = current;
      if (command === 'bind') {
        const generation = current?.generation ?? 0;
        if (generation !== expectedGeneration) {
          throw new Error(`会话登记已变化：预期代次 ${expectedGeneration}，当前代次 ${generation}；请重新 resolve。`);
        }
        if (current?.threadId !== threadId || current?.hostId !== hostId) {
          if (generation === Number.MAX_SAFE_INTEGER) throw new Error('登记代次已达上限，不能继续绑定。');
          active = { threadId, hostId, generation: generation + 1, registeredAt: new Date().toISOString() };
          sessions[roleId] = active;
          registry.environments[environmentId] = sessions;
          changed = true;
        }
      }
      result = {
        status: active ? 'ready' : 'needs_session', registryPath, environmentId, roleId,
        definitionPath: join(repositoryRoot, 'agents', 'roles', `${roleId}.md`),
        memoryPath: join(localDirectory, 'memory', environmentId, `${roleId}.md`),
        generation: active?.generation ?? 0, session: active,
      };
    }
    if (changed) writeRegistry(registryPath, registry);
    return result;
  } finally {
    closeSync(lockDescriptor);
    unlinkSync(lockPath);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        environment: { type: 'string' }, 'thread-id': { type: 'string' },
        'host-id': { type: 'string' }, 'expected-generation': { type: 'string' },
      },
    });
    const [command, roleId] = positionals;
    if (positionals.length !== (command === 'init' ? 1 : 2)
        || (command !== 'bind' && ['thread-id', 'host-id', 'expected-generation'].some(key => hasOwn(values, key)))
        || (command === 'init' && hasOwn(values, 'environment'))) {
      throw new Error('参数不符合命令用途，请查看 agents/README.md。');
    }
    const rawGeneration = values['expected-generation'];
    if (command === 'bind' && !/^(0|[1-9][0-9]*)$/.test(rawGeneration ?? '')) {
      throw new Error('bind 必须提供 --expected-generation 非负整数。');
    }
    const result = sessionRegistry({
      command, roleId, environmentId: values.environment, threadId: values['thread-id'],
      hostId: values['host-id'], expectedGeneration: rawGeneration === undefined ? undefined : Number(rawGeneration),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`会话登记失败：${error.message}\n`);
    process.exitCode = 1;
  }
}
