import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const artifact = 'C:/project/damage_web_dev/.agents/artifacts/hero22-candidate';
const planning = 'C:/project/damage_web_dev/数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第二十二批';
const baseFile = path.join(artifact, '修订一-完整候选.json');
const sourceFile = path.join(artifact, '候选源值核对.json');
const snapshotFile = path.join(artifact, '当前现值保护快照.json');
const manifestFile = path.join(artifact, '修订一-来源哈希汇总.json');
const baseBytes = fs.readFileSync(baseFile);
const base = JSON.parse(baseBytes);
const now = new Date().toISOString();
const sha256 = value => createHash('sha256').update(value).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function writeOnce(file, value) {
  const bytes = Buffer.isBuffer(value) ? value : jsonBytes(value);
  if (fs.existsSync(file)) {
    const old = fs.readFileSync(file);
    if (!old.equals(bytes)) throw new Error('目标文件已存在且字节不同，拒绝覆盖：' + file);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes, { flag: 'wx' });
}
function findParameter(skillKey, parameterKey) {
  const row = candidate.skills?.[skillKey]?.write?.parameters?.find(item => item.parameterKey === parameterKey);
  if (!row) throw new Error(`缺少待修订参数：${skillKey}/${parameterKey}`);
  return row;
}

const candidate = structuredClone(base);
candidate.meta.generatedAt = now;
candidate.meta.executor = '本地候选最终脚本';
candidate.meta.scope = '第二十二批前两英雄修订二：承接修订一的Leona、Nautilus参数、公式和效果；将Leona Q与Nautilus R冲突的施法时间改为无默认运行输入，并按实际绑定树校正Leona W来源说明；Nautilus W护盾说明与自身NORMAL_SHIELD效果一致；不创建即时伤害、直接治疗或自动事件。';
candidate.meta.businessWrites = 0;
candidate.meta.apiCalls = 0;
candidate.revision = {
  baseCandidateSha256: sha256(baseBytes),
  baseCandidateFile: baseFile,
  changes: [
    'Leona Q的spellCastTime=0.5217499732971191秒与mCastTime=0.25秒冲突；cast_time_ms改为无默认RUNTIME_INPUT，说明同时保留两个根字段。',
    'Nautilus R的spellCastTime=0.25秒与mCastTime=0.46000000834465027秒冲突；cast_time_ms改为无默认RUNTIME_INPUT，说明同时保留两个根字段。',
    'Leona W BonusMRTooltip当前绑定计算树的mDataValue实际为ArmorBaseBonus；修订来源说明，数值数组不变。',
    'Nautilus W shield_value供新增自身NORMAL_SHIELD效果引用；修订说明，不改变公式或数值。'
  ]
};

const leonaQCast = findParameter('leona_q', 'cast_time_ms');
leonaQCast.valueType = 'INTEGER';
leonaQCast.valueMode = 'RUNTIME_INPUT';
leonaQCast.fixedValue = null;
leonaQCast.levelValues = null;
leonaQCast.description = '当前根同时存在spellCastTime=0.5217499732971191秒与mCastTime=0.25秒，字段冲突；保留为无默认运行时输入，不能选定施法时长，也不表示命中或位移发生在施法结束。';

const nautilusRCast = findParameter('nautilus_r', 'cast_time_ms');
nautilusRCast.valueType = 'INTEGER';
nautilusRCast.valueMode = 'RUNTIME_INPUT';
nautilusRCast.fixedValue = null;
nautilusRCast.levelValues = null;
nautilusRCast.description = '当前根同时存在spellCastTime=0.25秒与mCastTime=0.46000000834465027秒，字段冲突；保留为无默认运行时输入，不能选定施法时长，也不表示命中或控制发生在施法结束。';

const leonaW = candidate.skills.leona_w;
const mrBase = leonaW.write.parameters.find(item => item.parameterKey === 'magic_resistance_base_bonus');
if (!mrBase) throw new Error('缺少Leona W魔抗基础参数');
mrBase.description = '当前BonusMRTooltip绑定计算树的mDataValue实际为ArmorBaseBonus，取该DataValue索引1至5；DataValues.MRBaseBonus数组在本版数值相同，仅作为交叉核对，不改写树的真实引用。';
const mrFormula = leonaW.write.formulas.find(item => item.formulaKey === 'bonus_magic_resistance');
if (!mrFormula) throw new Error('缺少Leona W魔抗公式');
mrFormula.description = 'BonusMRTooltip实际树=ArmorBaseBonus+0.2×来源额外魔法抗性；mStat6/formula2按同版窄证绑定为额外魔抗。';

const nautilusW = candidate.skills.nautilus_w;
const shieldFormula = nautilusW.write.formulas.find(item => item.formulaKey === 'shield_value');
if (!shieldFormula) throw new Error('缺少Nautilus W护盾公式');
shieldFormula.description = 'ShieldCalc=ShieldBase+ShieldHealthRatio×来源生命值总值；供自身NORMAL_SHIELD效果引用，施放事件另行接线。';

const kinds = ['parameters', 'formulas', 'effects', 'processes', 'internalStates', 'triggerRules'];
candidate.counts = Object.fromEntries(kinds.map(kind => [kind, candidate.order.reduce((sum, key) => sum + candidate.skills[key].write[kind].length, 0)]));
candidate.apiWrites = 0;
candidate.reusedPublicParameters = candidate.order.flatMap(skillKey => candidate.skills[skillKey].reusedParameters
  .filter(key => ['cooldown_ms', 'mana_cost'].includes(key))
  .map(parameterKey => ({ skillKey, parameterKey })));
candidate.reusedExistingParameters = candidate.order.flatMap(skillKey => candidate.skills[skillKey].reusedParameters.map(parameterKey => ({ skillKey, parameterKey })));
const candidateBytes = jsonBytes(candidate);
const names = {
  candidate: '最终候选.json',
  plan: '最终请求计划.json',
  manifest: '最终来源哈希汇总.json',
  lock: '最终冻结候选锁.json',
  version: '最终候选版本.json',
  difference: '最终差异.json',
  conflict: '最终来源冲突记录.json'
};
writeOnce(path.join(artifact, names.candidate), candidateBytes);
writeOnce(path.join(planning, names.candidate), candidateBytes);

const routeFor = { internalStates: 'internal-states', triggerRules: 'trigger-rules' };
const intents = [];
for (const skillKey of candidate.order) {
  const skill = candidate.skills[skillKey];
  for (const kind of kinds) {
    for (const body of skill.write[kind]) {
      const stableKey = body.parameterKey ?? body.formulaKey ?? body.effectKey ?? body.processKey ?? body.stateKey ?? body.internalStateKey ?? body.ruleKey ?? body.triggerRuleKey;
      if (!stableKey) throw new Error('组成缺少稳定键：' + skillKey + '/' + kind);
      intents.push({ method: 'POST', route: `/skills/${skillKey}/${routeFor[kind] ?? kind}`, skillKey, kind, stableKey, status: '仅意图，未调用', body });
    }
  }
}
const plan = {
  generatedAt: now,
  status: '仅生成最终精确POST意图，未执行业务写入',
  apiBase: 'http://127.0.0.1:8080/api/admin/games/lol',
  businessWrites: 0,
  baseCandidateSha256: candidate.revision.baseCandidateSha256,
  candidateSha256: sha256(candidateBytes),
  requestCount: intents.length,
  requestCounts: Object.fromEntries(kinds.map(kind => [kind, intents.filter(item => item.kind === kind).length])),
  protectedSkills: candidate.order.filter(key => candidate.skills[key].protectedExisting),
  reusedPublicParameters: candidate.reusedPublicParameters.length,
  observedExistingParameters: candidate.reusedExistingParameters.length,
  requests: intents
};
const planBytes = jsonBytes(plan);
writeOnce(path.join(artifact, names.plan), planBytes);
writeOnce(path.join(planning, names.plan), planBytes);

const manifestBytes = fs.readFileSync(manifestFile);
writeOnce(path.join(artifact, names.manifest), manifestBytes);
writeOnce(path.join(planning, names.manifest), manifestBytes);

const lock = {
  generatedAt: now,
  status: '最终候选已生成，等待根负责人审查；未授权业务写入',
  batch: '英雄机制第二十二批',
  previousRevisionCandidateSha256: sha256(baseBytes),
  baseCandidateSha256: candidate.revision.baseCandidateSha256,
  candidateSha256: sha256(candidateBytes),
  requestPlanSha256: sha256(planBytes),
  sourceManifestSha256: sha256(manifestBytes),
  snapshotSha256: sha256(fs.readFileSync(snapshotFile)),
  sourceValuesSha256: sha256(fs.readFileSync(sourceFile)),
  counts: candidate.counts,
  requestCount: intents.length,
  businessWrites: 0,
  protectedSkills: plan.protectedSkills,
  protectedCoverage: { subjects: 20, componentLists: 120, componentDetails: 29, characters: 4, relations: 4, images: 20, catalogs: 4 },
  previousRevisionPreserved: true,
  previousRevisionFile: baseFile
};
writeOnce(path.join(artifact, names.lock), lock);
writeOnce(path.join(planning, names.lock), lock);
const version = {
  generatedAt: now,
  status: '最终候选待审',
  batch: lock.batch,
  previousRevisionCandidateSha256: lock.previousRevisionCandidateSha256,
  baseCandidateSha256: lock.baseCandidateSha256,
  candidateSha256: lock.candidateSha256,
  requestPlanSha256: lock.requestPlanSha256,
  sourceManifestSha256: lock.sourceManifestSha256,
  snapshotSha256: lock.snapshotSha256,
  counts: lock.counts,
  requestCount: lock.requestCount,
  businessWrites: 0
};
writeOnce(path.join(artifact, names.version), version);
writeOnce(path.join(planning, names.version), version);

const previous = JSON.parse(baseBytes);
const changed = [];
function recordChange(pathName, before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) changed.push({ path: pathName, before, after });
}
recordChange('skills.leona_q.write.parameters[cast_time_ms]', previous.skills.leona_q.write.parameters.find(item => item.parameterKey === 'cast_time_ms'), leonaQCast);
recordChange('skills.nautilus_r.write.parameters[cast_time_ms]', previous.skills.nautilus_r.write.parameters.find(item => item.parameterKey === 'cast_time_ms'), nautilusRCast);
recordChange('skills.leona_w.write.parameters[magic_resistance_base_bonus].description', previous.skills.leona_w.write.parameters.find(item => item.parameterKey === 'magic_resistance_base_bonus')?.description, mrBase.description);
recordChange('skills.leona_w.write.formulas[bonus_magic_resistance].description', previous.skills.leona_w.write.formulas.find(item => item.formulaKey === 'bonus_magic_resistance')?.description, mrFormula.description);
recordChange('skills.nautilus_w.write.formulas[shield_value].description', previous.skills.nautilus_w.write.formulas.find(item => item.formulaKey === 'shield_value')?.description, shieldFormula.description);
const difference = {
  generatedAt: now,
  previousRevisionCandidateSha256: sha256(baseBytes),
  revisedCandidateSha256: lock.candidateSha256,
  exactChanges: candidate.revision.changes,
  changedFields: changed,
  countsBefore: previous.counts,
  countsAfter: candidate.counts,
  requestCountBefore: previous.counts.parameters + previous.counts.formulas + previous.counts.effects + previous.counts.processes + previous.counts.internalStates + previous.counts.triggerRules,
  requestCountAfter: intents.length,
  businessWrites: 0,
  previousRevisionPreserved: true
};
writeOnce(path.join(artifact, names.difference), difference);
writeOnce(path.join(planning, names.difference), difference);

const conflictEvidence = {
  generatedAt: now,
  status: '仅记录根绑定字段冲突与树来源修正，未执行API写入',
  sourceVersion: candidate.meta.sourceVersion,
  previousRevisionCandidateSha256: sha256(baseBytes),
  fields: {
    leona_q_cast_time_ms: { spellCastTimeSeconds: 0.5217499732971191, mCastTimeSeconds: 0.25, disposition: 'RUNTIME_INPUT无默认，暂不选择字段' },
    nautilus_r_cast_time_ms: { spellCastTimeSeconds: 0.25, mCastTimeSeconds: 0.46000000834465027, disposition: 'RUNTIME_INPUT无默认，暂不选择字段' }
  },
  sourceTreeCorrection: { skillKey: 'leona_w', calculationKey: 'BonusMRTooltip', actualDataValue: 'ArmorBaseBonus', parameterDataValueCrossCheck: 'MRBaseBonus数组本版数值相同但不作为树引用' },
  businessWrites: 0
};
writeOnce(path.join(artifact, names.conflict), conflictEvidence);
writeOnce(path.join(planning, names.conflict), conflictEvidence);

console.log(JSON.stringify({ previousRevisionCandidateSha256: lock.previousRevisionCandidateSha256, candidateSha256: lock.candidateSha256, requestPlanSha256: lock.requestPlanSha256, sourceManifestSha256: lock.sourceManifestSha256, snapshotSha256: lock.snapshotSha256, counts: candidate.counts, requestCount: intents.length, reusedPublicParameters: candidate.reusedPublicParameters.length, changedFields: changed.map(item => item.path), businessWrites: 0 }, null, 2));
