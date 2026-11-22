import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { calculatePlan, compareResults } from '../../.agents/skills/skill-damage-verification/scripts/verify-damage.mjs';
import { validateCandidate, verifySourceEvidence, operationsForBatch, isDevelopmentCandidate, previewUpdates } from './candidate.mjs';
import { readJson, writeNew, requireValue, sha256, digestJson, options, containedFile } from './artifacts.mjs';
import { makeClient } from './client.mjs';
import { sameConfiguration } from '../../.agents/skills/damage-api-authoring/scripts/apply-skill-plan.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export function candidateExpectation(candidate) {
  return { ...calculatePlan(candidate.expectedPlan),
    planSha256: digestJson(candidate.expectedPlan),
    calculatorSha256: sha256(readFileSync(resolve(root, '.agents/skills/skill-damage-verification/scripts/verify-damage.mjs'))) };
}
export async function verifyDatabaseInputs(candidate, client) {
  const path = `/internal/maintenance/games/${candidate.gameId}/baseline`;
  requireValue((await client.request('GET', path)).data.baselineDigest === candidate.baselineDigest, '真实游戏基线已变化。');
  const originalConfigurations = [];
  if (candidate.scenes.some(scene => scene.snapshot === null)) {
    requireValue(isDevelopmentCandidate(candidate), '只有开发候选可明确声明修前普通快照不可生成。');
    for (const item of candidate.skillPlan.items) {
      const actual = (await client.request('GET', `/api/admin/games/${candidate.gameId}/skills/${item.skillKey}/configuration`)).data;
      requireValue(actual.baseDigest === item.before.baseDigest && sameConfiguration(actual, item.before), '真实技能完整基线或摘要与冻结before不符。');
      originalConfigurations.push({ skillKey: item.skillKey, actual });
    }
  }
  const scenes = [];
  const snapshots = new Map();
  const readSnapshot = async (path, body) => {
    const key = digestJson({ path, body });
    if (!snapshots.has(key)) snapshots.set(key, (await client.request('POST', path, JSON.stringify(body))).data);
    return snapshots.get(key);
  };
  for (const scene of candidate.scenes) {
    const stable = snapshot => ({ ...snapshot, readAt: null });
    const selection = scene.snapshot === null ? scene.previewSnapshot.selection : scene.snapshot.selection;
    const evidence = { id: scene.id };
    if (scene.snapshot === null) evidence.originalSnapshotUnavailable = true;
    else {
      const actual = await readSnapshot(`/api/admin/games/${candidate.gameId}/simulation-snapshot`, selection);
      requireValue(digestJson(stable(actual)) === digestJson(stable(scene.snapshot)), '候选快照并非当前真实场景；不能改抗性或目录后自报基线。');
      evidence.originalSnapshotDigest = actual.snapshotDigest;
    }
    if (isDevelopmentCandidate(candidate)) {
      const preview = await readSnapshot(`/internal/maintenance/games/${candidate.gameId}/simulation-preview`,
        { selection, updates: previewUpdates(candidate, scene) });
      requireValue(digestJson(stable(preview)) === digestJson(stable(scene.previewSnapshot)), '开发候选预检快照并非当前后端重建的完整场景。');
      evidence.previewSnapshotDigest = preview.snapshotDigest;
    }
    scenes.push(evidence);
  }
  requireValue((await client.request('GET', path)).data.baselineDigest === candidate.baselineDigest, '读取场景期间游戏基线已变化。');
  return { baselineDigest: candidate.baselineDigest, scenes, ...(originalConfigurations.length ? { originalConfigurations } : {}) };
}
export function validationPayload(candidate, summary, report, evidenceDigest, now = Math.floor(Date.now() / 1000)) {
  requireValue(summary.complete && summary.requested === candidate.scenes.length && summary.completed === candidate.scenes.length
    && summary.candidateDigest === candidate.candidateDigest && summary.authorizationRequired === true && summary.authorizationVersion === 2,
  '缺少启用验签的完整第2版真实计算证据。');
  requireValue(report.pass === true && report.cases.length === candidate.scenes.length, '独立预期对照未全部通过。');
  return { version: 'maintenance-validation-v1', batchId: candidate.batchId, principalId: candidate.principalId,
    gameId: candidate.gameId, reference: candidate.reference, sourceRevision: candidate.sourceRevision,
    baselineDigest: candidate.baselineDigest, candidateDigest: candidate.candidateDigest,
    operationsDigest: digestJson(operationsForBatch(candidate)), evidenceDigest, engineDigest: summary.engineDigest,
    adapterVersion: summary.adapterVersion, issuedAt: now, expiresAt: now + 3600, outcome: 'PASSED' };
}
export function signReceipt(payload, pem) {
  const key = createPrivateKey(pem);
  requireValue(key.asymmetricKeyType === 'ed25519', '验证签发只接受 Ed25519 密钥。');
  const bytes = Buffer.from(JSON.stringify(payload));
  return { payload: bytes.toString('base64url'), signature: sign(null, bytes, key).toString('base64url') };
}
async function main(args) {
  if (!args.length || args[0] === '--help') {
    console.log('独立验证执行者：先固定预期，再运行最终Wasm并签发回执。\nnode tools/maintenance/verify-candidate.mjs --candidate <候选.json> --output <新目录> [--grant-file <维护计算票据文件>] [--read-config <私密读取配置>] [--private-key <隔离签发私钥文件>]');
    return;
  }
  const opts = options(args, ['--candidate', '--output', '--grant-file', '--private-key', '--read-config'], ['--candidate', '--output']);
  requireValue(process.versions.node === readFileSync(resolve(root, 'web/.node-version'), 'utf8').trim(),
    '真实Wasm验证须使用项目Node工具链：从仓库根目录通过tools/web.ps1 node调用本脚本，文件参数使用绝对路径。');
  const path = resolve(opts['--candidate']), candidate = validateCandidate(readJson(path));
  verifySourceEvidence(candidate, dirname(path));
  requireValue(!opts['--private-key'] || opts['--read-config'], '正式签发必须独立读取真实基线及场景。');
  let client;
  let databaseInputs;
  if (opts['--read-config']) {
    const configPath = resolve(opts['--read-config']);
    client = makeClient(readJson(configPath), dirname(configPath));
    requireValue((await client.principal()).principalId === candidate.principalId, '私有入口登记的维护主体与候选不符。');
    databaseInputs = await verifyDatabaseInputs(candidate, client);
  }
  const expected = candidateExpectation(candidate);
  const output = resolve(opts['--output']);
  mkdirSync(output);
  writeNew(resolve(output, 'expected.json'), expected);
  if (databaseInputs) writeNew(resolve(output, 'database-inputs-before.json'), databaseInputs);
  const command = [resolve(root, 'web/node_modules/vite-node/dist/cli.mjs'), resolve(root, 'tools/maintenance/run-candidate.ts'),
    '--candidate', path, '--output', output];
  if (opts['--grant-file']) command.push('--grant-file', resolve(opts['--grant-file']));
  const result = spawnSync(process.execPath, command, { cwd: resolve(root, 'web'), stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 300_000, maxBuffer: 1024 * 1024, windowsHide: true });
  requireValue(!result.error && result.status === 0, '真实候选执行失败，保留输出目录；不签发回执。');
  const summary = readJson(resolve(output, 'summary.json'));
  requireValue(summary.complete && summary.candidateDigest === candidate.candidateDigest, '真实运行未完成或身份不匹配。');
  const actual = summary.files.map(item => {
    const file = containedFile(output, item.file), bytes = readFileSync(file);
    requireValue(sha256(bytes) === item.sha256, '运行档案摘要不符。');
    return { id: item.id, result: JSON.parse(bytes.toString('utf8')) };
  });
  const report = compareResults(expected, actual);
  writeNew(resolve(output, 'comparison.json'), report);
  requireValue(report.pass, '候选与独立预期不一致；不签发回执。');
  if (opts['--private-key']) {
    requireValue((await client.principal()).principalId === candidate.principalId, '独立验证期间维护主体发生变化。');
    writeNew(resolve(output, 'database-inputs-after.json'), await verifyDatabaseInputs(candidate, client));
    const evidenceDigest = digestJson({ summary, expected, report });
    const payload = validationPayload(candidate, summary, report, evidenceDigest);
    const receipt = signReceipt(payload, readFileSync(opts['--private-key']));
    writeNew(resolve(output, 'receipt.json'), receipt);
    writeNew(resolve(output, 'batch.json'), { batchId: candidate.batchId, gameId: candidate.gameId, reference: candidate.reference,
      sourceRevision: candidate.sourceRevision, baselineDigest: candidate.baselineDigest, candidateDigest: candidate.candidateDigest,
      operations: operationsForBatch(candidate), receipt });
  }
  console.log(JSON.stringify({ pass: true, scenes: candidate.scenes.length, receipt: Boolean(opts['--private-key']), candidateDigest: candidate.candidateDigest }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error && !/key|PEM|ASN1/i.test(error.message) ? error.message : '候选验证或私密签发失败。'); process.exitCode = 1;
  });
}
