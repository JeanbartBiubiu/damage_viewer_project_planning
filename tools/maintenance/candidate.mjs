import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePlan, sameConfiguration, businessConfiguration } from '../../.agents/skills/damage-api-authoring/scripts/apply-skill-plan.mjs';
import { calculatePlan } from '../../.agents/skills/skill-damage-verification/scripts/verify-damage.mjs';
import { exactKeys, requireValue, isUuid, isDigest, digestJson, sha256, containedFile, readJson, writeNew, options } from './artifacts.mjs';
import { snapshotExecutionSkillKeys } from '../../contracts/simulation/snapshotExecution.mjs';

const fields = ['version', 'batchId', 'principalId', 'gameId', 'reference', 'sourceRevision', 'baselineDigest', 'skillPlan', 'scenes', 'expectedPlan'];
function dependencyShape(value, field = '') {
  if (['name', 'description', 'createdAt', 'updatedAt', 'baseDigest'].includes(field)) return ['metadata'];
  if (Array.isArray(value)) return ['array', value.map(row => dependencyShape(row))];
  if (value && typeof value === 'object') return ['object', Object.keys(value).sort().map(key => [key, dependencyShape(value[key], key)])];
  return [value === null ? 'null' : typeof value, value];
}
export function stableCandidateDependencies(before, after) {
  return before.skill.maxLevel === after.skill.maxLevel
    && digestJson(dependencyShape(businessConfiguration(before))) === digestJson(dependencyShape(businessConfiguration(after)));
}
export function operationRequests(candidate) {
  return candidate.skillPlan.items.map(item => {
    const body = JSON.stringify(item.request);
    return { method: 'PATCH', path: `/api/admin/games/${candidate.gameId}/skills/${item.skillKey}/configuration`, body,
      bodySha256: sha256(body) };
  });
}
export const operationsForBatch = candidate => operationRequests(candidate).map(({ method, path, bodySha256 }) => ({ method, path, bodySha256 }));
export const isDevelopmentCandidate = candidate => candidate.version === 'maintenance-development-candidate-v1';
export function previewUpdates(candidate, scene) {
  const snapshot = scene.previewSnapshot;
  for (const graph of scene.snapshot === null ? [snapshot] : [scene.snapshot, snapshot]) {
    requireValue(Array.isArray(graph?.references), '开发场景缺少实际执行引用。');
    for (const reference of graph.references) requireValue(reference && typeof reference.sourceSkillKey === 'string'
      && typeof reference.targetSkillKey === 'string', '开发场景执行引用不合法。');
  }
  const included = new Set(snapshot.skillConfigurations.map(row => row.skill.skillKey));
  const consumed = new Set(snapshot.references.flatMap(reference => {
    return [reference.sourceSkillKey, reference.targetSkillKey].filter(key => key.length > 0);
  }));
  return candidate.skillPlan.items.filter(item => included.has(item.skillKey) && consumed.has(item.skillKey))
    .map(item => ({ skillKey: item.skillKey, request: item.request }));
}

/** 只支持能由现行统一技能协议完整证明的候选；其余维护需求明确交回开发。 */
export function validateCandidate(input) {
  exactKeys(input, fields, ['candidateDigest']);
  requireValue(['maintenance-candidate-v1', 'maintenance-development-candidate-v1'].includes(input.version)
    && isUuid(input.batchId) && isUuid(input.principalId), '候选版本或身份错误。');
  const development = isDevelopmentCandidate(input);
  requireValue(typeof input.gameId === 'string' && /^[a-z0-9_-]{1,64}$/.test(input.gameId), '游戏标识错误。');
  for (const key of ['reference', 'sourceRevision']) requireValue(typeof input[key] === 'string' && input[key].trim().length > 0 && input[key].length <= 256, '问题或证据修订不能为空且不能超过256字符。');
  requireValue(isDigest(input.baselineDigest), '缺少真实游戏基线摘要。');
  validatePlan(input.skillPlan);
  requireValue(input.skillPlan.gameId === input.gameId && input.skillPlan.items.length <= 100, '技能计划不属于该游戏或过大。');
  if (!development) for (const item of input.skillPlan.items) requireValue(stableCandidateDependencies(item.before, item.expected),
    '当前自动候选仅支持保持所有数值、来源、引用、排序和结构不变的元信息修正；数值和组成变化须转入开发预检。');
  requireValue(Array.isArray(input.scenes) && input.scenes.length > 0 && input.scenes.length <= 100, '候选需要有界非空场景。');
  const expectations = calculatePlan(input.expectedPlan);
  const ids = new Set(), covered = new Set();
  for (const scene of input.scenes) {
    exactKeys(scene, development ? ['id', 'snapshot', 'scenario', 'previewSnapshot'] : ['id', 'snapshot', 'scenario']);
    requireValue(typeof scene.id === 'string' && /^[a-z][a-z0-9_-]{0,95}$/.test(scene.id) && !ids.has(scene.id), '场景标识错误或重复。');
    ids.add(scene.id);
    const missingOriginal = development && scene.snapshot === null;
    requireValue(missingOriginal || scene.snapshot?.gameId === input.gameId && Array.isArray(scene.snapshot.skillConfigurations), '场景缺少同游戏完整快照。');
    requireValue(scene.scenario?.mode === 'fixed' || scene.scenario?.mode === 'continuous', '场景模式不支持。');
    if (development) {
      requireValue(scene.previewSnapshot?.gameId === input.gameId && Array.isArray(scene.previewSnapshot.skillConfigurations)
        && scene.previewSnapshot.selection && typeof scene.previewSnapshot.selection === 'object'
        && !Array.isArray(scene.previewSnapshot.selection)
        && (missingOriginal || digestJson(scene.previewSnapshot.selection) === digestJson(scene.snapshot.selection)), '开发候选缺少同一选择的后端预检快照。');
    }
    if (!missingOriginal) snapshotExecutionSkillKeys(scene.snapshot);
    const executionSkills = new Set(snapshotExecutionSkillKeys(development ? scene.previewSnapshot : scene.snapshot));
    const updatedSkills = development ? new Set(previewUpdates(input, scene).map(item => item.skillKey)) : null;
    if (development) {
      requireValue(updatedSkills.size > 0, '开发场景没有对应的配置变更。');
    }
    for (const item of input.skillPlan.items) {
      const before = missingOriginal ? null : scene.snapshot.skillConfigurations.find(row => row.skill?.skillKey === item.skillKey);
      if (before) requireValue(sameConfiguration(before, item.before), '场景技能与冻结基线不符。');
      if (development) {
        const projected = scene.previewSnapshot.skillConfigurations.find(row => row.skill?.skillKey === item.skillKey);
        const updated = updatedSkills.has(item.skillKey);
        if (projected) requireValue(sameConfiguration(projected, updated ? item.expected : item.before), updated
          ? '后端预检配置不等于冻结请求的完整预期。' : '未参与本场投影的技能必须保持完整基线。');
        if (projected && updated && executionSkills.has(item.skillKey)) covered.add(item.skillKey);
      } else if (before && executionSkills.has(item.skillKey)) {
        covered.add(item.skillKey);
      }
    }
  }
  requireValue(input.skillPlan.items.every(item => covered.has(item.skillKey)), '有变更技能未被任何候选场景覆盖。');
  requireValue(expectations.cases.length === ids.size && expectations.cases.every(item => ids.has(item.id)), '预期与运行场景不一一对应。');
  const content = Object.fromEntries(fields.map(key => [key, input[key]]));
  const candidateDigest = digestJson(content);
  if (Object.hasOwn(input, 'candidateDigest')) requireValue(input.candidateDigest === candidateDigest, '冻结候选摘要已变化。');
  return { ...structuredClone(content), candidateDigest };
}

export function candidateSnapshot(candidate, scene) {
  if (isDevelopmentCandidate(candidate)) return structuredClone(scene.previewSnapshot);
  const snapshot = structuredClone(scene.snapshot);
  for (const item of candidate.skillPlan.items) {
    const index = snapshot.skillConfigurations.findIndex(row => row.skill.skillKey === item.skillKey);
    if (index < 0) continue;
    const replacement = structuredClone(item.expected);
    replacement.baseDigest = digestJson(businessConfiguration(replacement));
    snapshot.skillConfigurations[index] = replacement;
  }
  // 标识本地候选内容，原服务快照与原 readAt 始终保存在冻结档案中。
  snapshot.snapshotDigest = digestJson({ candidate: candidate.candidateDigest, scene: scene.id, snapshot });
  return snapshot;
}

export function verifySourceEvidence(candidate, directory) {
  for (const item of candidate.skillPlan.items) for (const evidence of item.sourceEvidence) {
    const path = containedFile(directory, evidence.path);
    requireValue(sha256(readFileSync(path)) === evidence.sha256.toLowerCase(), '资料证据文件与冻结摘要不符。');
  }
}

function main(args) {
  if (!args.length || args[0] === '--help') {
    console.log('冻结同游戏技能候选；不写业务数据。\nnode tools/maintenance/candidate.mjs --input <计划.json> --output <新候选.json> [--mode automatic|development]');
    return;
  }
  const opts = options(args, ['--input', '--output', '--mode'], ['--input', '--output']);
  requireValue(opts['--mode'] === undefined || ['automatic', 'development'].includes(opts['--mode']), '候选模式错误。');
  requireValue(dirname(resolve(opts['--input'])) === dirname(resolve(opts['--output'])), '冻结文件须与输入计划同目录，保持资料引用的解析基准。');
  const input = readJson(opts['--input']);
  requireValue(!Object.hasOwn(input, 'version') && !Object.hasOwn(input, 'batchId'), '输入不能覆盖冻结模式或批次身份。');
  const candidate = validateCandidate({ ...input, version: opts['--mode'] === 'development'
    ? 'maintenance-development-candidate-v1' : 'maintenance-candidate-v1', batchId: randomUUID() });
  verifySourceEvidence(candidate, dirname(resolve(opts['--input'])));
  writeNew(opts['--output'], candidate);
  console.log(JSON.stringify({ candidateDigest: candidate.candidateDigest, scenes: candidate.scenes.length, operations: operationsForBatch(candidate).length }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch { console.error('候选冻结失败，请核对字段、资料摘要、场景与预期。'); process.exitCode = 1; }
}
