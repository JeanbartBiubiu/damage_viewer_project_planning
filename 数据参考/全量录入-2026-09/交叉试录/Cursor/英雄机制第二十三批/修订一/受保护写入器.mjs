import fs from 'node:fs';
import path from 'node:path';
import {
  revisionDir,
  expected,
  kinds,
  apiRoot,
  loadFrozen,
  validateFrozen,
  createRequester,
  checkProtected,
  checkPlannedTargets,
  detailRoute,
  businessDiff,
  writeAtomic,
  appendDurable,
} from './第二十三批录入共用.mjs';

const args = new Set(process.argv.slice(2));
const isApply = args.has('--apply');
const unknownArgs = [...args].filter(value => value !== '--apply' && value !== '--preflight');
if (unknownArgs.length) throw new Error('未知命令参数：' + unknownArgs.join(','));

/*
 * 本入口默认只读。解除写入保护需要同时得到一次任务级确认和一次
 * 运行级开关；未满足时 --apply 在发出任何读取请求前直接拒绝。
 * 当前任务不设置这两个环境值，因此本次只能执行 --preflight。
 */
const applyConfirmation = 'CONFIRM_HERO23_REVISION_ONE_POSTS';
const allowApply = isApply &&
  process.env.HERO23_APPLY_CONFIRM === applyConfirmation &&
  process.env.HERO23_WRITE_ENABLE === '1';
const stamp = new Date().toISOString().replaceAll(':', '-');
const reportPath = path.join(revisionDir, '受保护写入器-' + (isApply ? '实际写入' : '只读预检') + '-' + stamp + '.json');
const lockPath = path.join(revisionDir, '写入锁.json');
const logPath = path.join(revisionDir, '写入流水-' + stamp + '.jsonl');

function saveReport(report) {
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  return reportPath;
}

function intentState(plannedIntent, state, extra = {}) {
  return {
    skillKey: plannedIntent.skillKey,
    kind: plannedIntent.kind,
    stableKey: plannedIntent.stableKey,
    route: plannedIntent.route,
    state,
    ...extra,
  };
}

async function main() {
  const frozen = loadFrozen();
  const staticChecks = validateFrozen(frozen);
  const { request, events } = createRequester({ allowPost: allowApply, journalPath: allowApply ? logPath : null });
  const report = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    mode: isApply ? 'apply' : 'readonly',
    apiRoot,
    apiWrites: 0,
    candidateSha256: frozen.hashes.candidate,
    planSha256: frozen.hashes.plan,
    sourceManifestSha256: frozen.hashes.sourceManifest,
    protectedStateSha256: frozen.hashes.protectedState,
    protectionSnapshotSha256: frozen.hashes.protectionSnapshot,
    sourceBindingSha256: frozen.hashes.sourceBinding,
    staticChecks,
    protected: null,
    plannedTargets: null,
    safeToApply: false,
    lockPath,
    lockCreated: false,
    eventLogPath: allowApply ? logPath : null,
    events,
    error: null,
  };

  try {
    report.protected = await checkProtected(frozen.protection, request);
    report.plannedTargets = await checkPlannedTargets(frozen.plan, request);
    report.safeToApply =
      report.protected.conflicts === 0 &&
      report.protected.errors === 0 &&
      report.plannedTargets.conflicts === 0 &&
      report.plannedTargets.errors === 0;
  } catch (error) {
    report.error = error.name + ': ' + error.message;
  }

  if (!isApply) {
    report.finishedAt = new Date().toISOString();
    report.requestSummary = {
      GET: events.filter(value => value.method === 'GET').length,
      POST: events.filter(value => value.method === 'POST').length,
      total: events.length,
    };
    saveReport(report);
    console.log(JSON.stringify({
      mode: report.mode,
      apiWrites: 0,
      reportPath,
      candidateSha256: report.candidateSha256,
      planSha256: report.planSha256,
      sourceManifestSha256: report.sourceManifestSha256,
      protectedGETs: report.protected?.actual ?? 0,
      protectedMatched: report.protected?.matched ?? 0,
      targetReads: report.plannedTargets?.planned ?? 0,
      targetMissing: report.plannedTargets?.missing ?? 0,
      targetSame: report.plannedTargets?.same ?? 0,
      targetConflicts: report.plannedTargets?.conflicts ?? 0,
      targetErrors: report.plannedTargets?.errors ?? 0,
      safeToApply: report.safeToApply,
      error: report.error,
    }, null, 2));
    if (report.error || report.protected?.errors || report.plannedTargets?.errors) process.exitCode = 1;
    return;
  }

  if (!allowApply) throw new Error('当前只读；--apply 需要 HERO23_APPLY_CONFIRM 与 HERO23_WRITE_ENABLE');
  if (report.error) throw new Error(report.error);
  if (!report.safeToApply) throw new Error('写前保护或新增目标预检未通过，停止且不创建写入锁');
  if (fs.existsSync(lockPath)) throw new Error('发现既有写入锁，禁止重放或覆盖：' + lockPath);

  const lock = {
    schemaVersion: 1,
    state: 'STARTED',
    startedAt: new Date().toISOString(),
    candidateSha256: frozen.hashes.candidate,
    planSha256: frozen.hashes.plan,
    sourceManifestSha256: frozen.hashes.sourceManifest,
    apiWrites: 0,
    nextIndex: 0,
    writes: frozen.plan.intents.map(plannedIntent => intentState(plannedIntent, 'PENDING')),
  };
  writeAtomic(lockPath, lock);
  report.lockCreated = true;
  let lockOpen = true;
  const updateLock = () => writeAtomic(lockPath, lock);
  const abortLock = error => {
    lock.state = 'ABORTED';
    lock.finishedAt = new Date().toISOString();
    lock.error = error.name + ': ' + error.message;
    lock.apiWrites = report.apiWrites;
    updateLock();
  };

  try {
    for (let index = 0; index < frozen.plan.intents.length; index += 1) {
      const plannedIntent = frozen.plan.intents[index];
      const item = kinds.find(value => value.kind === plannedIntent.kind);
      if (!item) throw new Error('请求类型不在冻结范围：' + plannedIntent.kind);
      const readRoute = detailRoute(plannedIntent.skillKey, plannedIntent.kind, plannedIntent.stableKey);
      lock.nextIndex = index;
      const before = await request(readRoute, { method: 'GET', phase: '写前目标复查' });
      if (before.status === 200) {
        const mismatch = businessDiff(plannedIntent.body, before.data);
        if (mismatch !== null) {
          lock.writes[index] = intentState(plannedIntent, 'CONFLICT_BEFORE_POST', { diff: mismatch });
          updateLock();
          throw new Error('写前目标已有异值，停止：' + readRoute);
        }
        lock.writes[index] = intentState(plannedIntent, 'ALREADY_PRESENT', { status: before.status });
        lock.nextIndex = index + 1;
        updateLock();
        continue;
      }
      if (before.status !== 404) {
        lock.writes[index] = intentState(plannedIntent, 'UNKNOWN_BEFORE_POST', { status: before.status, error: before.error });
        updateLock();
        throw new Error('写前目标不是404，停止：' + readRoute);
      }

      lock.writes[index] = intentState(plannedIntent, 'POST_PENDING', { readRoute });
      updateLock();
      appendDurable(logPath, {
        at: new Date().toISOString(),
        phase: '持久锁确认后准备POST',
        index,
        skillKey: plannedIntent.skillKey,
        kind: plannedIntent.kind,
        stableKey: plannedIntent.stableKey,
        route: plannedIntent.route,
      });
      const posted = await request(plannedIntent.route, {
        method: 'POST',
        body: plannedIntent.body,
        phase: '新增组成POST',
      });
      const after = await request(readRoute, { method: 'GET', phase: 'POST后目标回读' });
      const mismatch = after.status === 200 ? businessDiff(plannedIntent.body, after.data) : { status: after.status, error: after.error };
      const postAccepted = posted.status === 200 || posted.status === 201;
      const landed = after.status === 200 && mismatch === null;
      lock.writes[index] = intentState(plannedIntent,
        postAccepted && landed ? 'CREATED_AND_VERIFIED' : 'STOP_AFTER_POST',
        {
          postStatus: posted.status,
          postError: posted.error,
          readbackStatus: after.status,
          diff: mismatch,
        });
      if (postAccepted && landed) {
        report.apiWrites += 1;
        lock.apiWrites = report.apiWrites;
        lock.nextIndex = index + 1;
        updateLock();
        continue;
      }
      updateLock();
      throw new Error('POST响应或写后回读异常，已先回读并停止：' + readRoute);
    }
    lock.state = 'COMPLETED';
    lock.finishedAt = new Date().toISOString();
    lock.nextIndex = frozen.plan.intents.length;
    lock.apiWrites = report.apiWrites;
    updateLock();
    lockOpen = false;
    report.finishedAt = new Date().toISOString();
    report.requestSummary = {
      GET: events.filter(value => value.method === 'GET').length,
      POST: events.filter(value => value.method === 'POST').length,
      total: events.length,
    };
    report.writes = lock.writes;
    saveReport(report);
    console.log(JSON.stringify({
      mode: report.mode,
      apiWrites: report.apiWrites,
      reportPath,
      lockPath,
      state: lock.state,
      GETs: report.requestSummary.GET,
      POSTs: report.requestSummary.POST,
    }, null, 2));
  } catch (error) {
    if (lockOpen) abortLock(error);
    report.finishedAt = new Date().toISOString();
    report.error = error.name + ': ' + error.message;
    report.writes = lock.writes;
    report.requestSummary = {
      GET: events.filter(value => value.method === 'GET').length,
      POST: events.filter(value => value.method === 'POST').length,
      total: events.length,
    };
    saveReport(report);
    console.error(JSON.stringify({
      mode: report.mode,
      apiWrites: report.apiWrites,
      reportPath,
      lockPath,
      state: lock.state,
      error: report.error,
    }, null, 2));
    process.exitCode = 1;
  }
}

if (isApply && !allowApply) {
  console.error('当前只读：拒绝 --apply，未发出任何业务请求。');
  process.exitCode = 2;
} else {
  await main();
}

