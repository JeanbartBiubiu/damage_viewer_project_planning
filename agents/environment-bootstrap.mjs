import { createHash, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { basename } from 'node:path';
import { isRecord, localPaths, requireScope, sourceRoot, withLocalJson } from './local-store.mjs';
import { readCoordinationConfig } from './coordination-state.mjs';

const states = ['missing', 'creating', 'uncertain', 'ACTIVE', 'PAUSED'];
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(value);

function bindings(repositoryRoot, callback) {
  return withLocalJson(repositoryRoot, 'automation.json', value => {
    const store = value ?? { formatVersion: 2, environments: {} };
    if (!isRecord(store) || store.formatVersion !== 2 || !isRecord(store.environments)
        || Object.keys(store).length !== 2) throw new Error('本机自动化登记结构无效，保留原文件，不能覆盖或猜测新建。');
    for (const [environmentId, entry] of Object.entries(store.environments)) {
      requireScope(environmentId, '自动化环境');
      if (!isRecord(entry) || !states.includes(entry.status) || !['ACTIVE', 'PAUSED'].includes(entry.desiredStatus)
          || !Number.isSafeInteger(entry.revision) || entry.revision < 0
          || !(entry.automationId === null || validId(entry.automationId))
          || !(entry.targetThreadId === null || validId(entry.targetThreadId))
          || !(entry.attemptId === null || validId(entry.attemptId))
          || !Number.isSafeInteger(entry.wakeEveryMinutes) || entry.wakeEveryMinutes < 1
          || typeof entry.environmentKey !== 'string' || entry.workflow !== 'agents/heartbeat.md') {
        throw new Error('本机自动化条目无效，保留原文件。');
      }
      if (['creating', 'uncertain'].includes(entry.status) && !entry.attemptId) throw new Error('自动化创建中的操作编号缺失。');
      if (['ACTIVE', 'PAUSED'].includes(entry.status) && (!entry.automationId || !entry.targetThreadId)) {
        throw new Error('自动化已绑定状态缺少实际任务或聊天编号。');
      }
    }
    return callback(store);
  });
}

export function environmentBootstrap(request, repositoryRoot = sourceRoot) {
  requireScope(request.environmentId, '环境');
  if (!['check', 'begin-create', 'bind', 'creation-result'].includes(request.command)) throw new Error('未知环境初始化命令。');
  const config = readCoordinationConfig(repositoryRoot);
  const { mainRoot } = localPaths(repositoryRoot);
  let canonicalRoot = realpathSync(mainRoot);
  if (process.platform === 'win32') canonicalRoot = canonicalRoot.toLowerCase();
  const environmentKey = createHash('sha256').update(`${canonicalRoot}\0${request.environmentId}`).digest('hex').slice(0, 24);
  const marker = `damage-role-polling:${environmentKey}`;
  const schedule = `FREQ=MINUTELY;INTERVAL=${config.policy.wakeEveryMinutes}`;
  return bindings(repositoryRoot, store => {
    const entry = Object.hasOwn(store.environments, request.environmentId) ? store.environments[request.environmentId] : {
      environmentKey, automationId: null, targetThreadId: null, status: 'missing', desiredStatus: 'ACTIVE',
      attemptId: null, wakeEveryMinutes: config.policy.wakeEveryMinutes, workflow: 'agents/heartbeat.md',
      verifiedAt: null, receipt: null, revision: 0,
    };
    if (entry.environmentKey !== environmentKey) throw new Error('自动化登记属于其他检出，不能复用另一环境的任务编号。');
    if (request.command !== 'check' && (!Number.isSafeInteger(request.expectedRevision)
        || request.expectedRevision < 0 || request.expectedRevision !== entry.revision)) {
      throw new Error('自动化登记修订号已变化或缺失，重新核对原生状态后再操作，不能覆盖较新的暂停记录。');
    }
    let changed = !Object.hasOwn(store.environments, request.environmentId);
    if (request.command === 'begin-create') {
      if (request.nativeAbsenceConfirmed !== true) throw new Error('先通过原生工具或本机任务记录确认没有匹配自动化，再申请创建。');
      if (entry.automationId !== (request.expectedAutomationId ?? null)) throw new Error('自动化登记已变化，请重新检查。');
      if (['creating', 'uncertain'].includes(entry.status)) throw new Error('自动化创建结果待核对，不能盲目重复创建。');
      entry.status = 'creating'; entry.attemptId = randomUUID(); changed = true;
    } else if (request.command === 'bind') {
      if (!validId(request.automationId) || !validId(request.targetThreadId)
          || !['ACTIVE', 'PAUSED'].includes(request.status)) throw new Error('绑定必须提供原生工具实际返回的编号、聊天与状态。');
      if (entry.automationId !== (request.expectedAutomationId ?? null)) throw new Error('自动化登记已变化，不能覆盖。');
      if (['creating', 'uncertain'].includes(entry.status) && entry.attemptId !== request.attemptId) {
        throw new Error('自动化创建操作编号不符，先核对实际结果。');
      }
      if ((['creating', 'uncertain'].includes(entry.status)
          || (entry.automationId !== null && entry.automationId !== request.automationId))
          && entry.desiredStatus === 'PAUSED' && request.status !== 'PAUSED') {
        throw new Error('替代任务必须保留用户暂停意图，先将实际原生任务设为暂停再绑定。');
      }
      entry.automationId = request.automationId; entry.targetThreadId = request.targetThreadId;
      entry.status = request.status; entry.desiredStatus = request.status; entry.attemptId = null;
      entry.wakeEveryMinutes = config.policy.wakeEveryMinutes;
      entry.verifiedAt = new Date().toISOString(); entry.receipt = '已核对原生自动化记录'; changed = true;
    } else if (request.command === 'creation-result') {
      if (!entry.attemptId || entry.attemptId !== request.attemptId || !['creating', 'uncertain'].includes(entry.status)) {
        throw new Error('未找到待结算的自动化创建操作。');
      }
      if (!['not_created', 'uncertain'].includes(request.outcome)
          || typeof request.receipt !== 'string' || !request.receipt.trim() || request.receipt.length > 512) {
        throw new Error('创建结果必须给出已知未创建或结果不明及实际核对依据。');
      }
      entry.status = request.outcome === 'not_created' ? 'missing' : 'uncertain';
      if (request.outcome === 'not_created') entry.attemptId = null;
      entry.receipt = request.receipt; changed = true;
    }
    if (changed && request.command !== 'check') {
      if (!Number.isSafeInteger(entry.revision + 1)) throw new Error('自动化登记修订号超出安全整数范围。');
      entry.revision += 1;
    }
    store.environments[request.environmentId] = entry;
    const action = ['creating', 'uncertain'].includes(entry.status) ? 'reconcile_creation'
      : entry.automationId ? 'verify_existing' : 'discover_native';
    const result = {
      environmentId: request.environmentId, environmentKey, marker,
      project: basename(mainRoot), mainRoot, action, ...entry,
      desiredWakeEveryMinutes: config.policy.wakeEveryMinutes,
      schedule, name: `Damage 角色低频轮询 · ${request.environmentId}`,
    };
    return changed ? { value: store, result } : { result };
  });
}
