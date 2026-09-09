import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const originalDir = path.resolve(here, '..');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const original = readJson(path.join(originalDir, '完整候选.json'));
const revision = readJson(path.join(here, '完整候选.json'));
const originalPlan = readJson(path.join(originalDir, '写前请求计划.json'));
const revisionPlan = readJson(path.join(here, '写前请求计划.json'));
const originalW = original.skills.blitzcrank_w.write;
const revisionW = revision.skills.blitzcrank_w.write;
const originalE = original.skills.blitzcrank_e.write;
const revisionE = revision.skills.blitzcrank_e.write;
const find = (items, key) => items.find(item => item.parameterKey === key || item.effectKey === key);
const originalMove = find(originalW.parameters, 'move_speed_ratio');
const revisionMove = find(revisionW.parameters, 'move_speed_ratio');
const originalAttack = find(originalW.parameters, 'attack_speed_ratio');
const revisionAttack = find(revisionW.parameters, 'attack_speed_ratio');
const originalCooldown = find(originalE.parameters, 'cooldown_ms');
const revisionCooldown = find(revisionE.parameters, 'cooldown_ms');
const originalEffectKeys = originalW.effects.map(effect => effect.effectKey);
const revisionEffectKeys = revisionW.effects.map(effect => effect.effectKey);
const report = {
  generatedAt: new Date().toISOString(),
  status: '修订一与初稿差异已固定，初稿原件保留，未调用业务接口',
  original: {
    revision: original.revision,
    candidateSha256: sha256(path.join(originalDir, '完整候选.json')),
    requestPlanSha256: sha256(path.join(originalDir, '写前请求计划.json')),
    strictMathSha256: sha256(path.join(originalDir, '严格数学.json')),
    counts: original.counts,
    requestCount: originalPlan.requestCount,
  },
  revision: {
    revision: revision.revision,
    candidateSha256: sha256(path.join(here, '完整候选.json')),
    requestPlanSha256: sha256(path.join(here, '写前请求计划.json')),
    strictMathSha256: sha256(path.join(here, '严格数学.json')),
    counts: revision.counts,
    requestCount: revisionPlan.requestCount,
  },
  exactDifferences: [
    {
      path: 'skills.blitzcrank_w.write.effects',
      before: originalEffectKeys,
      after: revisionEffectKeys,
      removed: ['move_speed_boost'],
      reason: '正文和来源明确移动速度从起始比例衰减至最低比例，不能把起始值建成固定5000毫秒属性效果；保留衰减端点和时间窗口，等待过程事件。',
    },
    {
      path: 'skills.blitzcrank_w.write.parameters.move_speed_ratio',
      before: { name: originalMove.name, description: originalMove.description, values: originalMove.levelValues },
      after: { name: revisionMove.name, description: revisionMove.description, values: revisionMove.levelValues },
      reason: '明确为移动速度起始比例，只作衰减端点输入。',
    },
    {
      path: 'skills.blitzcrank_w.write.effects.attack_speed_boost / post_overdrive_slow',
      before: {
        attackSpeedDescription: find(originalW.effects, 'attack_speed_boost').description,
        slowDescription: find(originalW.effects, 'post_overdrive_slow').description,
      },
      after: {
        attackSpeedDescription: find(revisionW.effects, 'attack_speed_boost').description,
        slowDescription: find(revisionW.effects, 'post_overdrive_slow').description,
      },
      reason: '写明攻击速度独立持续5000毫秒，结束减速仅在主窗口结束后开始并持续1500毫秒；两者均不自动触发。',
    },
    {
      path: 'skills.blitzcrank_e.write.parameters.cooldown_ms',
      before: { values: originalCooldown.levelValues, description: originalCooldown.description },
      after: { values: revisionCooldown.levelValues, description: revisionCooldown.description },
      source: {
        clientRaw: [7, 7, 6.5, 6, 5.5, 5, 5],
        clientSkillRankIndices: { start: 1, end: 5, values: [7, 6.5, 6, 5.5, 5] },
        official16_17_1: [7, 6.5, 6, 5.5, 5],
      },
      reason: '按客户端技能等级索引1至5及官方16.17.1数组独立核对；不再采用初稿由首项重复导致的7000/7000/6500/6000/5500。',
    },
  ],
  unchanged: {
    parameters: revision.counts.parameters,
    formulas: revision.counts.formulas,
    protectedSubjects: 10,
    protectedCompositionLists: 60,
    reusedPublicParameters: 13,
    publicParametersUpdated: 0,
    blitzcrankWCooldown: [15000, 15000, 15000, 15000, 15000],
    blitzcrankRCooldown: [60000, 40000, 20000],
  },
  originalPreserved: true,
  noApiCalls: true,
};
fs.writeFileSync(path.join(here, '修订差异.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  original: report.original,
  revision: report.revision,
  removedEffects: report.exactDifferences[0].removed,
  eCooldown: report.exactDifferences[3].after.values,
  noApiCalls: true,
  output: path.join(here, '修订差异.json'),
}, null, 2));
