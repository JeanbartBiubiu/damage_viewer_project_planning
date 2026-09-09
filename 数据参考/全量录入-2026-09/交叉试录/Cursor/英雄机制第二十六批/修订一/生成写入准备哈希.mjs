import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const latestDir = root => fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort().at(-1);
const candidateFile = path.join(here, '完整候选.json');
const planFile = path.join(here, '写前请求计划.json');
const sourceValuesFile = path.join(here, '源值解析.json');
const sourceManifestFile = path.join(here, '来源哈希汇总.json');
const strictMathFile = path.join(here, '严格数学.json');
const freezeFile = path.join(here, '冻结候选锁.json');
const writerFile = path.join(here, '受保护写入器.mjs');
const readerFile = path.join(here, '独立全量回读.mjs');
const inputVersionFile = path.join(here, '输入包', '输入版本.json');
const bindingFile = path.join(here, '输入包', '来源绑定与当前文本.json');
const snapshotFile = path.join(here, '输入包', '参考资料', '当前10槽保护快照.json');
const reuseFile = path.join(here, '输入包', '参考资料', '公共参数复用清单.json');
const preflightRoot = path.join(here, '只读预检');
const readerRoot = path.join(here, '独立回读');
const mathRoot = path.join(here, '实际GET数学');
const lockFile = path.join(here, '实际录入锁.json');
const preflightRun = path.join(preflightRoot, latestDir(preflightRoot));
const readerRun = path.join(readerRoot, latestDir(readerRoot));
const mathRun = path.join(mathRoot, latestDir(mathRoot));
const preflight = readJson(path.join(preflightRun, '执行结果.json'));
const reader = readJson(path.join(readerRun, '执行结果.json'));
const math = readJson(path.join(mathRun, '实际GET数学.json'));
const lock = fs.existsSync(lockFile) ? readJson(lockFile) : null;
const applyReport = lock?.reportPath && fs.existsSync(lock.reportPath) ? readJson(lock.reportPath) : null;
const candidate = readJson(candidateFile);
const plan = readJson(planFile);
const freeze = readJson(freezeFile);
const output = {
  generatedAt: new Date().toISOString(),
  status: lock?.status === 'COMPLETED' && applyReport?.success === true && math?.passed === true
    ? '第26批修订一实际录入与独立回读核验已完成'
    : '第26批修订一可交接写入准备已完成，尚未完成实际录入核验',
  scope: '仅阿利斯塔、布里茨10个技能槽的新增组件；不更新既有公共参数，不写主体、六类分类、角色关系或图片',
  sourceVersion: candidate.meta?.sourceVersion ?? null,
  counts: {
    parameters: candidate.counts?.parameters ?? null,
    formulas: candidate.counts?.formulas ?? null,
    effects: candidate.counts?.effects ?? null,
    processes: candidate.counts?.processes ?? null,
    internalStates: candidate.counts?.internalStates ?? null,
    triggerRules: candidate.counts?.triggerRules ?? null,
    requestCount: plan.requests?.length ?? null,
    reusedPublicParameters: candidate.reusedPublicParameters?.length ?? null,
  },
  frozen: {
    candidateSha256: sha256(candidateFile),
    planSha256: sha256(planFile),
    sourceValuesSha256: sha256(sourceValuesFile),
    sourceManifestSha256: sha256(sourceManifestFile),
    strictMathSha256: sha256(strictMathFile),
    freezeSha256: sha256(freezeFile),
    inputVersionSha256: sha256(inputVersionFile),
    bindingSha256: sha256(bindingFile),
    snapshotSha256: sha256(snapshotFile),
    reuseSha256: sha256(reuseFile),
    freezeCandidateSha256: freeze.candidateSha256,
    freezePlanSha256: freeze.planSha256,
  },
  scripts: {
    writer: { path: writerFile, sha256: sha256(writerFile), command: 'node ".agents/artifacts/hero26-luna-recovery/修订一/受保护写入器.mjs"' },
    reader: { path: readerFile, sha256: sha256(readerFile), command: 'node ".agents/artifacts/hero26-luna-recovery/修订一/独立全量回读.mjs --expect-present"' },
    actualMath: { path: path.join(here, '实际GET读后数学.mjs'), sha256: sha256(path.join(here, '实际GET读后数学.mjs')), command: 'node ".agents/artifacts/hero26-luna-recovery/修订一/实际GET读后数学.mjs"' },
  },
  readonlyPreflight: {
    runId: preflight.runId,
    outputDir: preflightRun,
    mode: preflight.mode,
    apiBase: preflight.apiBase,
    apiWrites: preflight.apiWrites,
    noBusinessWrites: preflight.noBusinessWrites,
    calls: preflight.calls,
    staticChecksFailed: (preflight.staticChecks ?? []).filter(check => !check.passed).length,
    protection: { checked: preflight.preflight?.protection?.checked ?? null, passed: preflight.preflight?.protection?.passed ?? null, failures: preflight.preflight?.protection?.failures?.length ?? null },
    candidateDetails: { checked: preflight.preflight?.details?.checked ?? null, passed: preflight.preflight?.details?.passed ?? null, failures: preflight.preflight?.details?.failures?.length ?? null },
  },
  independentFreshReadback: {
    runId: reader.runId,
    outputDir: readerRun,
    mode: reader.mode,
    expectation: reader.expectation,
    apiBase: reader.apiBase,
    apiWrites: reader.apiWrites,
    noBusinessWrites: reader.noBusinessWrites,
    counts: reader.counts,
    baseline: reader.baseline,
    candidates: reader.candidates,
    passed: reader.passed,
  },
  actualApply: {
    lockPath: lockFile,
    lockSha256: fs.existsSync(lockFile) ? sha256(lockFile) : null,
    status: lock?.status ?? null,
    runId: lock?.runId ?? null,
    reportPath: lock?.reportPath ?? null,
    reportSha256: lock?.reportPath && fs.existsSync(lock.reportPath) ? sha256(lock.reportPath) : null,
    success: applyReport?.success ?? null,
    apiWrites: applyReport?.apiWrites ?? null,
    postAttempts: applyReport?.postAttempts ?? null,
    successfulPosts: applyReport?.successfulPosts ?? null,
    confirmed: applyReport?.confirmed ?? null,
    noBusinessWrites: applyReport?.noBusinessWrites ?? null,
    calls: applyReport?.calls ?? null,
  },
  actualGetMath: {
    runId: math.runId,
    outputDir: mathRun,
    mode: math.mode,
    freshGET: math.freshGET,
    counts: math.counts,
    structural: math.structural,
    apiWrites: math.apiWrites,
    noBusinessWrites: math.noBusinessWrites,
    passed: math.passed,
  },
  handoff: {
    applyOwner: '根负责人',
    applyRequiredEnvironment: 'HERO26_APPLY_CONFIRM=CONFIRM_HERO26_COMPONENT_POSTS',
    applyCommand: "$env:HERO26_APPLY_CONFIRM='CONFIRM_HERO26_COMPONENT_POSTS'; & node \".agents/artifacts/hero26-luna-recovery/修订一/受保护写入器.mjs\" --apply",
    postCount: 78,
    writePolicy: '逐项写前GET必须404，POST必须201，POST后逐项GET核对；任一异常先GET后停写；不更新、不删除、不重放既有对象',
  },
};
const outputFile = path.join(here, '写入准备哈希.json');
fs.writeFileSync(outputFile, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ outputFile, writerSha256: output.scripts.writer.sha256, readerSha256: output.scripts.reader.sha256, preflight: output.readonlyPreflight, reader: output.independentFreshReadback }, null, 2));
