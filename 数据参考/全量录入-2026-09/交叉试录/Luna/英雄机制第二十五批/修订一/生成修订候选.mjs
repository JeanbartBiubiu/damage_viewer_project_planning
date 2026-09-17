import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const originalDir = path.resolve(here, '..');
const originalCandidateFile = path.join(originalDir, '完整候选.json');
const originalPlanFile = path.join(originalDir, '写前请求计划.json');
const originalSourceValuesFile = path.join(originalDir, '独立源值与算例.json');
const originalManifestFile = path.join(originalDir, '来源哈希汇总.json');
const inputDir = path.join(originalDir, '输入包');
const targetDir = path.resolve(here, '..', '..', '..', '..', '数据参考', '全量录入-2026-09', '交叉试录', 'Luna', '英雄机制第二十五批', '修订一');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parameter(skill, key) {
  const value = skill.write.parameters.find(item => item.parameterKey === key);
  if (!value) throw new Error(`缺少参数 ${skill.skillKey}/${key}`);
  return value;
}

function removeParameter(skill, key) {
  const index = skill.write.parameters.findIndex(item => item.parameterKey === key);
  if (index < 0) throw new Error(`待移除参数不存在 ${skill.skillKey}/${key}`);
  return skill.write.parameters.splice(index, 1)[0];
}

function formula(skill, key) {
  const value = skill.write.formulas.find(item => item.formulaKey === key);
  if (!value) throw new Error(`缺少公式 ${skill.skillKey}/${key}`);
  return value;
}

function removeFormula(skill, key) {
  const index = skill.write.formulas.findIndex(item => item.formulaKey === key);
  if (index < 0) throw new Error(`待移除公式不存在 ${skill.skillKey}/${key}`);
  return skill.write.formulas.splice(index, 1)[0];
}

function levels(values) {
  return Object.fromEntries(values.map((value, index) => [String(index + 1), value]));
}

function param(parameterKey) {
  return { nodeType: 'PARAMETER', parameterKey };
}

function attr(attributeOwner, attributeKey, attributeValueKind) {
  return { nodeType: 'ATTRIBUTE', attributeOwner, attributeKey, attributeValueKind };
}

function op(operation, left, right) {
  return { nodeType: 'OPERATION', operation, operands: [left, right] };
}

const add = (left, right) => op('ADD', left, right);
const multiply = (left, right) => op('MULTIPLY', left, right);
const min = (left, right) => op('MIN', left, right);

function nearbyMultiplierExpression() {
  return add(
    param('unity'),
    multiply(
      param('bonus_per_nearby_champion_ratio'),
      min(param('nearby_enemy_champion_count'), param('unity')),
    ),
  );
}

const originalCandidateSha256 = sha256File(originalCandidateFile);
const originalPlanSha256 = sha256File(originalPlanFile);
const originalSourceValuesSha256 = sha256File(originalSourceValuesFile);
const originalManifestSha256 = sha256File(originalManifestFile);
const expectedOriginalCandidateSha256 = '138db432d3e380d7b46222916f84d3ee6101a3fd79dde77704d82675a52a1228';
if (originalCandidateSha256 !== expectedOriginalCandidateSha256) {
  throw new Error(`原25候选字节已变化，停止修订: ${originalCandidateSha256}`);
}

const originalCandidate = readJson(originalCandidateFile);
const originalPlan = readJson(originalPlanFile);
const originalSourceValues = readJson(originalSourceValuesFile);
const originalManifest = readJson(originalManifestFile);
const candidate = clone(originalCandidate);
const generatedAt = new Date().toISOString();
const changeLog = [];

const e = candidate.skills.drmundo_e;
const removedEThreshold = removeParameter(e, 'max_missing_health_threshold_ratio');
const oldEndpoint = removeFormula(e, 'maximum_damage_amplification_bonus_ratio');
const endpointExpression = multiply(
  add(
    param('base_damage'),
    multiply(param('bonus_health_ratio'), attr('SOURCE', 'hp', 'BONUS')),
  ),
  param('max_damage_amp'),
);
e.write.formulas.push({
  formulaKey: 'maximum_additional_damage_endpoint',
  name: '大力行医完整额外伤害最高端点',
  expression: endpointExpression,
  description: '当前MaxDamageAmpTooltip只证最高端点；本式明确为完整AdditionalDamage×1.4，即（BaseDamage+0.05×来源额外生命）×MaxDamageAmp。只记录端点，不生成已损失生命到端点的中间曲线。',
  sortOrder: oldEndpoint.sortOrder,
});
e.pending = [
  {
    item: '已损失生命到最高伤害端点的中间曲线',
    reason: '扩展正文给出70%已损失生命字面值，但该段与主正文的被动/主动指代存在冲突；MaxMissingHealthThreshold只留来源待核，不录成确定参数。MaxDamageAmp=1.4只建立完整额外伤害最高端点，不猜中间曲线。',
  },
  {
    item: '强化攻击事件',
    reason: '基础额外物理伤害、完整额外伤害最高端点和4000毫秒攻击窗口已保留；禁止创建DAMAGE结果或自动触发。',
  },
];
e.proofs[0].sourceFacts.revisionNotes = {
  removedCandidateParameters: [
    {
      parameterKey: removedEThreshold.parameterKey,
      value: removedEThreshold.fixedValue,
      source: 'DataValues.MaxMissingHealthThreshold=0.7；扩展正文@MaxMissingHealthThreshold*100@%。',
      reason: '与主正文/计算树的被动最大生命转攻击力指代冲突，且没有可消费的中间曲线。',
    },
  ],
  endpoint: {
    source: 'mSpellCalculations.MaxDamageAmpTooltip=MaxDamageAmp+Number(-1)，DataValues.MaxDamageAmp=1.4。',
    candidate: '完整额外伤害×1.4；额外伤害树在端点式内完整展开。',
    intermediateCurve: '未知，未录入。',
  },
};
changeLog.push({
  scope: 'drmundo_e',
  removedParameters: ['max_missing_health_threshold_ratio'],
  replacedFormulas: [{ from: oldEndpoint.formulaKey, to: 'maximum_additional_damage_endpoint' }],
  reason: '70%缺血字面值与主正文语义冲突；1.4只作为完整额外伤害最高端点。',
});

const r = candidate.skills.drmundo_r;
const oldMissingRatio = parameter(r, 'missing_health_heal_ratio');
oldMissingRatio.parameterKey = 'missing_health_max_health_gain_ratio';
oldMissingRatio.name = '按已损失生命获得最大生命比例';
oldMissingRatio.description = '客户端当前根绑定DataValues.MissingHealthHeal；正文以*100显示。该比例描述获得最大生命的量，不命名为普通直接治疗；正确应用阶段的实际已损失生命基准由无默认运行输入提供。';
const oldHotRatio = parameter(r, 'max_health_hot_ratio');
oldHotRatio.parameterKey = 'max_health_regeneration_ratio';
oldHotRatio.name = '持续恢复最大生命比例';
oldHotRatio.description = '客户端当前根绑定DataValues.MaxHealthHoT；正文以*100显示。该比例描述持续恢复总量的最大生命基准，正确应用阶段的实际最大生命基准由无默认运行输入提供。';
const bonus = parameter(r, 'bonus_per_nearby_champion_ratio');
bonus.valueMode = 'SKILL_LEVEL';
bonus.fixedValue = null;
bonus.levelValues = { '1': 0, '2': 0, '3': 0.05 };
bonus.name = '按等级生效的附近敌方英雄效果增幅比例';
bonus.description = '原始DataValues.BonusPerNearbyChampion=0.05；当前正文只在R等级3说明附近每个敌方英雄额外提升两项效果，因此按等级归一为[0,0,0.05]，正文比例*100显示。';
const nearby = parameter(r, 'nearby_enemy_champion_count');
nearby.name = '合资格附近敌方英雄实际数量';
nearby.description = '三级正文的附近敌方英雄实际数量由运行时外供且无默认值；本轮1v1公式用MIN(实际数量,1)封顶，等级1/2通过增幅参数的0值自然不增加，不把输入伪设为0。';
removeParameter(r, 'takedown_duration_extension_ms');
const unity = parameter(r, 'unity');
unity.sortOrder = 100;
const basisMissing = {
  parameterKey: 'missing_health_gain_basis',
  name: '最大生命增益实际已损失生命基准',
  valueType: 'DECIMAL',
  valueMode: 'RUNTIME_INPUT',
  fixedValue: null,
  levelValues: null,
  description: '获得最大生命比例的正确应用阶段实际已损失生命值由运行时外供；应用阶段未知，不设默认值，不由新增最大生命反推。',
  sortOrder: 80,
};
const basisMax = {
  parameterKey: 'max_health_regeneration_basis',
  name: '持续恢复实际最大生命基准',
  valueType: 'DECIMAL',
  valueMode: 'RUNTIME_INPUT',
  fixedValue: null,
  levelValues: null,
  description: '持续恢复比例的正确应用阶段实际最大生命值由运行时外供；应用阶段未知，不设默认值，不由本次最大生命增益反馈。',
  sortOrder: 90,
};
r.write.parameters.splice(r.write.parameters.length - 1, 0, basisMissing, basisMax);

const oldMultiplier = removeFormula(r, 'nearby_champion_heal_multiplier');
const oldMissingFormula = removeFormula(r, 'missing_health_heal_amount');
const oldMaxFormula = removeFormula(r, 'max_health_hot_total_amount');
r.write.formulas.push({
  formulaKey: 'nearby_champion_effect_multiplier',
  name: '三级附近英雄效果倍率',
  expression: nearbyMultiplierExpression(),
  description: '只在R等级3时由bonus_per_nearby_champion_ratio提供增幅；附近数量是无默认实际输入，并在1v1内用MIN(数量,1)封顶。等级1/2的增幅参数为0，不另造输入0。',
  sortOrder: oldMultiplier.sortOrder,
}, {
  formulaKey: 'missing_health_max_health_gain_amount',
  name: '极限剂量按已损失生命获得最大生命量',
  expression: multiply(
    multiply(param('missing_health_max_health_gain_ratio'), param('missing_health_gain_basis')),
    nearbyMultiplierExpression(),
  ),
  description: '最大生命获得量=已损失生命比例×正确应用阶段的实际已损失生命基准×附近效果倍率；基准无默认，新增最大生命不反馈到本次基准，也不创建HP结果。',
  sortOrder: oldMissingFormula.sortOrder,
}, {
  formulaKey: 'max_health_regeneration_amount',
  name: '极限剂量持续恢复最大生命量',
  expression: multiply(
    multiply(param('max_health_regeneration_ratio'), param('max_health_regeneration_basis')),
    nearbyMultiplierExpression(),
  ),
  description: '持续恢复总量=最大生命恢复比例×正确应用阶段的实际最大生命基准×附近效果倍率；基准无默认，应用阶段未知，不创建周期或HP反馈。',
  sortOrder: oldMaxFormula.sortOrder,
});
r.pending = [
  {
    item: '最大生命增益的属性结果与应用阶段',
    reason: '正文明确获得相当于已损失生命的最大生命，但当前没有max_hp属性结果和应用阶段；实际已损失生命基准、实际最大生命基准分别由两个无默认运行输入提供，阶段保持待核，不制造HP反馈。',
  },
  {
    item: '两项量的直接结果与周期过程',
    reason: '两项数值量已保留；禁止DIRECT_HEAL、MOMENT和周期过程，等待事件接线。',
  },
  {
    item: '三级附近敌方英雄资格',
    reason: '数量输入无默认，1v1公式只保留0/1有效上限；资格事件尚未接线。',
  },
  {
    item: 'TakedownDurationExtension消费者',
    reason: '客户端DataValues保留2秒来源，但当前正文和计算树没有消费者，本修订不写参数。',
  },
];
r.proofs[0].sourceFacts.revisionNotes = {
  removedCandidateParameters: [{
    parameterKey: 'takedown_duration_extension_ms',
    sourceValue: 2,
    source: 'DataValues.TakedownDurationExtension=2秒。',
    reason: '当前正文/计算树没有消费者，仅留来源。',
  }],
  nearbyAmplification: {
    rawDataValue: [0.05],
    candidateBySkillLevel: [0, 0, 0.05],
    reason: '当前正文明确只有三级附近敌方英雄增幅；1v1数量由无默认输入提供并在公式中MIN(...,1)。',
  },
  basisInputs: [
    { parameterKey: basisMissing.parameterKey, phase: '未知，运行时提供正确应用阶段实际已损失生命基准', defaultValue: null },
    { parameterKey: basisMax.parameterKey, phase: '未知，运行时提供正确应用阶段实际最大生命基准', defaultValue: null },
  ],
};
changeLog.push({
  scope: 'drmundo_r',
  removedParameters: ['takedown_duration_extension_ms'],
  renamedParameters: [
    { from: 'missing_health_heal_ratio', to: 'missing_health_max_health_gain_ratio' },
    { from: 'max_health_hot_ratio', to: 'max_health_regeneration_ratio' },
  ],
  addedParameters: ['missing_health_gain_basis', 'max_health_regeneration_basis'],
  replacedFormulas: [
    { from: 'nearby_champion_heal_multiplier', to: 'nearby_champion_effect_multiplier' },
    { from: 'missing_health_heal_amount', to: 'missing_health_max_health_gain_amount' },
    { from: 'max_health_hot_total_amount', to: 'max_health_regeneration_amount' },
  ],
  reason: '最大生命获得与持续恢复分别使用正确阶段的无默认外供基准；只在三级启用附近增幅并在1v1封顶。',
});

const counts = { parameters: 0, formulas: 0, effects: 0, processes: 0, internalStates: 0, triggerRules: 0 };
for (const skillKey of candidate.order) {
  const write = candidate.skills[skillKey].write;
  counts.parameters += write.parameters.length;
  counts.formulas += write.formulas.length;
  counts.effects += write.effects.length;
  counts.processes += write.processes.length;
  counts.internalStates += write.internalStates.length;
  counts.triggerRules += write.triggerRules.length;
}
if (counts.parameters !== 76 || counts.formulas !== 23 || counts.effects !== 10) throw new Error(`修订后计数异常 ${JSON.stringify(counts)}`);

const snapshot = readJson(path.join(inputDir, '参考资料', '当前10槽保护快照.json'));
const reuseList = readJson(path.join(inputDir, '参考资料', '公共参数复用清单.json'));
const snapshotSha256 = sha256File(path.join(inputDir, '参考资料', '当前10槽保护快照.json'));
const candidateParameterCountAfterReuse = counts.parameters + reuseList.length;

candidate.meta = {
  ...candidate.meta,
  generatedAt,
  status: '修订一候选待主负责人审查，未调用业务接口',
  scope: '蒙多医生、泰达米尔10个技能槽；本修订只更正第25批候选的来源语义、无默认阶段基准、三级增幅和完整伤害端点；不写主体、分类、关系、图片、公共参数，不建DAMAGE/DIRECT_HEAL/MOMENT结果。',
  businessWrites: 0,
  apiCalls: 0,
  candidateSha256: null,
};
candidate.revision = 'hero25-source-v1-candidate-revision-1';
candidate.revisionDetails = {
  originalCandidateSha256,
  originalPlanSha256,
  originalSourceValuesSha256,
  originalManifestSha256,
  sourceVersion: { clientVersion: '16.17', officialVersion: '16.17.1' },
  changes: changeLog,
  counts: {
    candidateNewParameters: counts.parameters,
    currentParametersAfterSevenPublicReuse: candidateParameterCountAfterReuse,
    formulas: counts.formulas,
    effects: counts.effects,
  },
  noApiCalls: true,
};
candidate.counts = counts;
candidate.apiWrites = 0;
candidate.reusedPublicParameters = reuseList.map(item => ({ ...item, source: '输入包/参考资料/公共参数复用清单.json', post: false }));
candidate.reusedExistingParameters = reuseList.map(item => ({ ...item, post: false }));
candidate.protectedObjects = {
  ...candidate.protectedObjects,
  subjects: candidate.order.map(skillKey => ({ skillKey, source: '输入包/参考资料/当前10槽保护快照.json' })),
  currentCompositionLists: candidate.order.flatMap(skillKey => ['parameters', 'formulas', 'effects', 'processes', 'internal-states', 'trigger-rules'].map(kind => ({ skillKey, kind }))),
  reusedPublicParameters: reuseList,
};

const candidateFile = path.join(here, '完整候选.json');
writeJson(candidateFile, candidate);
const candidateSha256 = sha256File(candidateFile);

const sourceValues = clone(originalSourceValues);
sourceValues.generatedAt = generatedAt;
sourceValues.status = '修订一独立源值摘要，未调用业务接口';
sourceValues.candidateSha256 = candidateSha256;
sourceValues.originalSourceValuesSha256 = originalSourceValuesSha256;
sourceValues.revision = 'hero25-source-v1-candidate-revision-1';
sourceValues.noWrites = true;
sourceValues.revisionEvidence = {
  removedSourceOnly: [
    {
      skillKey: 'drmundo_e',
      sourceName: 'MaxMissingHealthThreshold',
      rawValues: sourceValues.skills.drmundo_e.dataValues.MaxMissingHealthThreshold,
      candidateParameterKey: null,
      reason: '扩展正文70%与主正文/树语义冲突，且没有中间曲线消费者。',
    },
    {
      skillKey: 'drmundo_r',
      sourceName: 'TakedownDurationExtension',
      rawValues: sourceValues.skills.drmundo_r.dataValues.TakedownDurationExtension,
      candidateParameterKey: null,
      reason: '当前正文和计算树没有消费者。',
    },
  ],
  nearbyAmplification: {
    rawSourceSeries: sourceValues.skills.drmundo_r.dataValues.BonusPerNearbyChampion,
    candidateBySkillLevel: [0, 0, 0.05],
    capExpression: 'MIN(nearby_enemy_champion_count, unity)，unity=1',
    levelOneAndTwo: '正文未声明附近增幅，参数值为0；不把运行输入伪设为0。',
  },
  mundoRAmountSemantics: {
    missingHealth: '获得最大生命的比例，不是普通直接治疗；实际已损失生命基准由missing_health_gain_basis外供。',
    maxHealthRegeneration: '持续恢复最大生命比例；实际最大生命基准由max_health_regeneration_basis外供。',
    phase: '两项应用阶段均未知，不默认施放前，不制造HP反馈。',
  },
  mundoEEndpoint: {
    maxDamageAmp: sourceValues.skills.drmundo_e.dataValues.MaxDamageAmp,
    expression: '(BaseDamage + BonusHealthRatio×SOURCE.hp.BONUS)×MaxDamageAmp',
    endpointOnly: true,
    intermediateCurve: '未知，不录入。',
  },
  moveSpeedReferenceCheck: {
    inputPath: '输入包/参考资料/当前10槽保护快照.json',
    attribute: 'move_speed_percent',
    unitEvidence: '当前属性说明明确1表示100%，0.04表示4%；Tryndamere W slow_ratio保留0.3至0.5比例。',
    modifierZoneEvidence: 'Tryndamere W两个效果继续使用attribute_flat_add；当前参考未给出需要改动的证据。',
    changed: false,
  },
};
sourceValues.skills.drmundo_e.pending = candidate.skills.drmundo_e.pending;
sourceValues.skills.drmundo_e.excluded = candidate.skills.drmundo_e.excluded;
sourceValues.skills.drmundo_e.candidateParameterKeys = candidate.skills.drmundo_e.write.parameters.map(item => item.parameterKey);
sourceValues.skills.drmundo_e.candidateFormulaKeys = candidate.skills.drmundo_e.write.formulas.map(item => item.formulaKey);
sourceValues.skills.drmundo_r.pending = candidate.skills.drmundo_r.pending;
sourceValues.skills.drmundo_r.excluded = candidate.skills.drmundo_r.excluded;
sourceValues.skills.drmundo_r.candidateParameterKeys = candidate.skills.drmundo_r.write.parameters.map(item => item.parameterKey);
sourceValues.skills.drmundo_r.candidateFormulaKeys = candidate.skills.drmundo_r.write.formulas.map(item => item.formulaKey);
sourceValues.parameterSeriesBindings = [
  ['drmundo_p', 'CurrentHealthLoss', 'current_health_loss_ratio'],
  ['drmundo_p', 'MaxHealthGain', 'max_health_gain_ratio'],
  ['drmundo_q', 'SlowAmount', 'slow_ratio'],
  ['drmundo_q', 'CurrentHealthDamage', 'current_health_damage_ratio'],
  ['drmundo_q', 'MinimumDamage', 'minimum_damage'],
  ['drmundo_q', 'HealthCost', 'health_cost'],
  ['drmundo_q', 'HealthRefundOnHitChampionMonsterPercent', 'health_refund_on_champion_monster_ratio'],
  ['drmundo_w', 'CurrentHealthCost', 'current_health_cost_ratio'],
  ['drmundo_w', 'GrayHealthStorage', 'gray_health_storage_ratio'],
  ['drmundo_w', 'GrayHealthInitialDuration', 'gray_health_initial_duration_ms', 'seconds_to_ms'],
  ['drmundo_w', 'GrayHealthBigMod', 'gray_health_hero_restore_ratio'],
  ['drmundo_w', 'GrayHealthSmallMod', 'gray_health_nonhero_restore_ratio'],
  ['drmundo_w', 'DamagePerTick', 'damage_per_tick'],
  ['drmundo_w', 'RecastBaseDamage', 'recast_base_damage'],
  ['drmundo_e', 'FlatHealthCost', 'flat_health_cost'],
  ['drmundo_e', 'BaseDamage', 'base_damage'],
  ['drmundo_e', 'BonusHealthRatio', 'bonus_health_ratio'],
  ['drmundo_e', 'MaxDamageAmp', 'max_damage_amp'],
  ['drmundo_e', 'HealthToADRatio', 'health_to_ad_ratio'],
  ['drmundo_r', 'SpeedBoostAmount', 'speed_boost_ratio'],
  ['drmundo_r', 'MissingHealthHeal', 'missing_health_max_health_gain_ratio'],
  ['drmundo_r', 'MaxHealthHoT', 'max_health_regeneration_ratio'],
  ['drmundo_r', 'BonusPerNearbyChampion', 'bonus_per_nearby_champion_ratio', 'level_gate_r3'],
  ['tryndamere_q', 'BaseHealing', 'base_healing'],
  ['tryndamere_q', 'BonusHealPerFury', 'bonus_heal_per_fury'],
  ['tryndamere_q', 'APRatio', 'ap_ratio'],
  ['tryndamere_q', 'APRatioPerFury', 'ap_ratio_per_fury'],
  ['tryndamere_q', 'MaximumBonusAD', 'maximum_bonus_attack_damage'],
  ['tryndamere_q', 'RemainingHealthThreshold', 'remaining_health_threshold_ratio'],
  ['tryndamere_w', 'ADReduction', 'attack_damage_reduction', 'negate'],
  ['tryndamere_w', 'SlowPotency', 'slow_ratio', 'negate'],
  ['tryndamere_e', 'Damage', 'damage_base'],
  ['tryndamere_e', 'ADRatio', 'ad_ratio'],
  ['tryndamere_e', 'APRatio', 'ap_ratio'],
  ['tryndamere_e', 'ChampCDRefund', 'champion_crit_cooldown_refund_ms', 'seconds_to_ms'],
  ['tryndamere_e', 'ChampFuryGain', 'champion_fury_gain'],
  ['tryndamere_r', 'TryndRMinHealth', 'minimum_health'],
  ['tryndamere_r', 'TryndRFuryGain', 'fury_gain'],
].map(([skillKey, sourceName, parameterKey, transform = null]) => ({ skillKey, sourceName, parameterKey, transform }));
sourceValues.candidateSeries = {};
for (const binding of sourceValues.parameterSeriesBindings) {
  const p = candidate.skills[binding.skillKey].write.parameters.find(item => item.parameterKey === binding.parameterKey);
  if (!p) throw new Error(`修订源映射缺少参数 ${binding.skillKey}/${binding.parameterKey}`);
  sourceValues.candidateSeries[`${binding.skillKey}/${binding.sourceName}`] = p.valueMode === 'SKILL_LEVEL'
    ? Object.keys(p.levelValues).sort((a, b) => Number(a) - Number(b)).map(key => p.levelValues[key])
    : [p.fixedValue];
}
sourceValues.sourceTransformations = {
  ...sourceValues.sourceTransformations,
  'drmundo_r/BonusPerNearbyChampion': {
    raw: sourceValues.skills.drmundo_r.dataValues.BonusPerNearbyChampion.slice(1),
    candidate: [0, 0, 0.05],
    transform: '原始DataValue未按等级分列；依据当前正文只在R等级3消费，等级1/2归一为0，等级3保留0.05。',
  },
};
const sourceValuesFile = path.join(here, '独立源值与算例.json');
writeJson(sourceValuesFile, sourceValues);
const sourceValuesSha256 = sha256File(sourceValuesFile);

const endpointByKind = {
  parameters: 'parameters',
  formulas: 'formulas',
  effects: 'effects',
  processes: 'processes',
  internalStates: 'internal-states',
  triggerRules: 'trigger-rules',
};
const fieldByKind = {
  parameters: 'parameterKey',
  formulas: 'formulaKey',
  effects: 'effectKey',
  processes: 'processKey',
  internalStates: 'stateKey',
  triggerRules: 'ruleKey',
};
const requests = [];
for (const skillKey of candidate.order) {
  const write = candidate.skills[skillKey].write;
  for (const kind of ['parameters', 'formulas', 'effects']) {
    for (const body of write[kind]) {
      const id = body[fieldByKind[kind]];
      requests.push({
        sequence: requests.length + 1,
        method: 'POST',
        route: `/skills/${skillKey}/${endpointByKind[kind]}`,
        detailRoute: `/skills/${skillKey}/${endpointByKind[kind]}/${encodeURIComponent(id)}`,
        skillKey,
        kind,
        stableKey: id,
        status: '仅意图，未调用',
        body,
      });
    }
  }
}
const requestCounts = { parameters: 0, formulas: 0, effects: 0, processes: 0, internalStates: 0, triggerRules: 0 };
for (const request of requests) requestCounts[request.kind] += 1;
if (requests.length !== 109 || requestCounts.parameters !== 76 || requestCounts.formulas !== 23 || requestCounts.effects !== 10) throw new Error(`请求计数异常 ${requests.length}/${JSON.stringify(requestCounts)}`);

const plan = {
  generatedAt,
  status: '修订一仅写入意图，未调用业务接口',
  batch: '英雄机制第二十五批',
  revision: 'hero25-source-v1-candidate-revision-1',
  apiBase: candidate.meta.apiBase,
  businessWrites: 0,
  candidateSha256,
  currentSnapshotSha256: snapshotSha256,
  originalCandidateSha256,
  originalPlanSha256,
  requestCount: requests.length,
  requestCounts,
  candidateNewParameterCount: counts.parameters,
  currentParameterCountAfterSevenPublicReuse: candidateParameterCountAfterReuse,
  reusedPublicParameters: reuseList,
  protectedSkills: candidate.order,
  protectedCoverage: { subjects: 10, componentLists: 60, publicParameters: 7, currentSnapshotFiles: 1 },
  requests,
  noApiCalls: true,
};
const planFile = path.join(here, '写前请求计划.json');
writeJson(planFile, plan);
const planSha256 = sha256File(planFile);

const manifest = {
  ...clone(originalManifest),
  generatedAt,
  status: '修订一来源文件散列汇总，未调用业务接口',
  revision: 'hero25-source-v1-candidate-revision-1',
  originalManifestSha256,
  originalCandidateSha256,
  originalPlanSha256,
  sourcePackageRoot: '原25候选/输入包（只读引用，未复制或改写）',
  sourceOnlyFacts: [
    'drmundo_e/DataValues.MaxMissingHealthThreshold=0.7：扩展正文冲突，未进入候选参数。',
    'drmundo_r/DataValues.TakedownDurationExtension=2：当前正文/计算树无消费者，未进入候选参数。',
  ],
  candidateRevision: '修订一只在新目录生成，不覆盖原25文件。',
};
const manifestFile = path.join(here, '来源哈希汇总.json');
writeJson(manifestFile, manifest);
const sourceManifestSha256 = sha256File(manifestFile);

const version = {
  generatedAt,
  status: '修订一候选待审，未调用业务接口',
  batch: '英雄机制第二十五批',
  revision: 'hero25-source-v1-candidate-revision-1',
  sourceRevision: 'hero25-source-v1-candidate-revision-1',
  candidateSha256,
  requestPlanSha256: planSha256,
  sourceValuesSha256,
  sourceManifestSha256,
  currentSnapshotSha256: snapshotSha256,
  originalCandidateSha256,
  originalPlanSha256,
  originalSourceValuesSha256,
  originalManifestSha256,
  counts,
  candidateNewParameterCount: counts.parameters,
  currentParameterCountAfterSevenPublicReuse: candidateParameterCountAfterReuse,
  requestCount: requests.length,
  businessWrites: 0,
  strictMathSha256: null,
  noApiCalls: true,
};
writeJson(path.join(here, '候选版本.json'), version);

const lock = {
  generatedAt,
  status: '修订一候选来源与计划已锁定，等待主负责人审查；未调用业务接口',
  batch: '英雄机制第二十五批',
  revision: 'hero25-source-v1-candidate-revision-1',
  candidateSha256,
  requestPlanSha256: planSha256,
  sourceValuesSha256,
  sourceManifestSha256,
  currentSnapshotSha256: snapshotSha256,
  originalCandidateSha256,
  originalPlanSha256,
  originalSourceValuesSha256,
  originalManifestSha256,
  strictMathSha256: null,
  counts,
  candidateNewParameterCount: counts.parameters,
  currentParameterCountAfterSevenPublicReuse: candidateParameterCountAfterReuse,
  requestCount: requests.length,
  businessWrites: 0,
  apiCalls: 0,
  protectedCoverage: { subjects: 10, componentLists: 60, publicParameters: 7, currentSnapshotFiles: 1 },
  reusedPublicParameters: reuseList,
  sourceFilesCopied: false,
  sourceFilesReadOnlyReference: true,
  noApiCalls: true,
};
writeJson(path.join(here, '冻结候选锁.json'), lock);

const diff = {
  generatedAt,
  status: '修订一与原25候选的精确语义差异，未调用业务接口',
  revision: 'hero25-source-v1-candidate-revision-1',
  original: {
    candidateSha256: originalCandidateSha256,
    planSha256: originalPlanSha256,
    sourceValuesSha256: originalSourceValuesSha256,
    manifestSha256: originalManifestSha256,
  },
  revised: { candidateSha256, planSha256, sourceValuesSha256, sourceManifestSha256 },
  counts: {
    original: originalCandidate.counts,
    revised: counts,
    candidateNewParameters: counts.parameters,
    currentParametersAfterSevenPublicReuse: candidateParameterCountAfterReuse,
    requestCount: requests.length,
  },
  changes: changeLog,
  unchangedProtection: {
    skills: candidate.order,
    subjects: 10,
    componentLists: 60,
    publicParameterReuse: 7,
    originalFilesPreserved: true,
  },
  noApiCalls: true,
};
writeJson(path.join(here, '修订差异.json'), diff);

const readme = `# 第二十五批候选修订一\n\n本目录是原25候选的独立修订目录，原候选和输入包保持原字节，未调用业务接口。来源仍固定为客户端16.17、官方资料16.17.1，沿当前角色根绑定正文和计算树。\n\n本修订保留76个新增参数、23个新增公式和10个新增效果，共109项新增意图。已有7个公共冷却参数只作复用，因此当前参数口径是76个新增、复用后83个现有参数；请求体只含76个新增参数。主体10个、组成列表60组和公共参数7项均只读保护。\n\n修订内容包括：蒙多医生E移出与主正文冲突的70%已损失生命阈值，补上完整额外伤害乘1.4的最高端点；蒙多医生R把已损失生命量改为最大生命获得量，把持续治疗改为持续恢复最大生命量，分别接收无默认的正确阶段实际基准；附近英雄增幅按等级归一为[0,0,0.05]，附近人数使用无默认整数输入并在1v1中用MIN(数量,1)封顶；击杀延长2秒只留来源。\n\n移动速度参考核对结论保持不变：属性说明明确1表示100%、0.04表示4%，Tryndamere W的0.3至0.5保留比例，效果继续使用attribute_flat_add。未知应用阶段、中间曲线、事件、直接治疗、周期过程和HP反馈均留在待核说明中。\n\n文件用途：完整候选.json、写前请求计划.json、独立源值与算例.json、严格数学.json分别保存候选、109项仅意图、来源和独立数学；修订差异.json保存与原候选的精确差异；版本、锁和来源散列保存冻结关系。\n`;
fs.writeFileSync(path.join(here, 'README.md'), readme, 'utf8');

const experience = `# 第二十五批修订一体验记录\n\n本轮只对蒙多医生、泰达米尔10个技能槽做来源语义和公式候选修订，没有业务写入。原25候选的76个新增参数、23个公式、10个效果计数保持不变；7个公共冷却参数继续复用，复用后当前参数口径为83。\n\n蒙多医生R的两个量不再命名为普通治疗：已损失生命比例表示获得最大生命的量，持续恢复比例表示最大生命基准上的恢复总量。两项各自使用无默认阶段基准，运行时必须提供正确应用阶段的实际值，当前不推断施放前、不产生HP反馈。三级附近增幅写入等级值0、0、0.05，附近人数不默认归零，公式在1v1用MIN封顶1。\n\n蒙多医生E只记录完整额外伤害乘1.4的最高端点，70%阈值保留在来源冲突证据中，不记录中间曲线。Tryndamere W的move_speed_percent单位和attribute_flat_add载荷有现有参考证据，未作改动。\n\n详细双场景、缺值拒绝、边界和结构结果见严格数学.json。\n`;
fs.writeFileSync(path.join(here, '体验报告.md'), experience, 'utf8');

// 仅将修订输出复制到修订一的持久目录；原25目录完全不触碰。
fs.mkdirSync(targetDir, { recursive: true });
for (const file of ['完整候选.json', '写前请求计划.json', '独立源值与算例.json', '来源哈希汇总.json', '候选版本.json', '冻结候选锁.json', '修订差异.json', 'README.md', '体验报告.md']) {
  fs.copyFileSync(path.join(here, file), path.join(targetDir, file));
}

console.log(JSON.stringify({
  revision: 'hero25-source-v1-candidate-revision-1',
  originalCandidateSha256,
  originalPlanSha256,
  candidateSha256,
  planSha256,
  sourceValuesSha256,
  sourceManifestSha256,
  counts,
  candidateNewParameterCount: counts.parameters,
  currentParameterCountAfterSevenPublicReuse: candidateParameterCountAfterReuse,
  requestCount: requests.length,
  targetDir,
  noApiCalls: true,
}, null, 2));
