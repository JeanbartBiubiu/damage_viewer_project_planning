import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 这个检查器只读取冻结副本、只读 GET 记录和 Cursor 运行记录，输出仅写本目录。
const root = dirname(fileURLToPath(import.meta.url));
const isolated = join(root, '隔离审查副本');
const references = join(isolated, '参考资料');
const runDir = join(isolated, '.agents', 'artifacts', 'run');
const planningRoot = resolve(root, '..', '..', '..', '..', 'damage_viewer_project_planning');
const batchRoot = join(planningRoot, '数据参考', '全量录入-2026-09', '装备技能实录', '第十九批自身与范围主动');
const outputJsonPath = join(root, 'Gear19-Cursor独立审查结果.json');
const outputMdPath = join(root, 'Gear19-Cursor独立审查报告.md');

const expected = {
  candidateSha256: '79e35c56d222d1248433f310276a8e3a91784d884ff0075dc4d1837f0d623f71',
  sourceFreezeSha256: '1ce775810bd1a252438386f6959dd8adf7a1de51224e3e055e3ffe8826ad7a79',
  currentGETSha256: 'ebe75831b1a118ff1abe34683fa9d30f588eacc6c8edbd0348787d73a1462773',
  independentResultSha256: '4d3e88eaefd5b4da851f6d34fe193c237f64c77d5a7f93d0f82dc821a3753673',
  cursorRunId: 'run-5e78767c-a8e2-4a1e-a724-9fcd87b227da',
  cursorRequestId: '99347ebe-28a7-4d26-a8c5-5f30bb496c03',
  cursorAgentId: 'agent-ed400dd5-7ff0-4bc4-99e3-2ee2326f6e95',
};

const candidatePath = join(references, '完整候选.json');
const sourcePath = join(references, '冻结来源.json');
const currentGetPath = join(references, '当前198装备与挂载独立GET.json');
const independentResultPath = join(references, '独立核算结果.json');
const frozenHashPath = join(references, '冻结哈希.json');
const summaryPath = join(runDir, 'summary.json');

const candidate = JSON.parse(await readFile(candidatePath, 'utf8'));
const source = JSON.parse(await readFile(sourcePath, 'utf8'));
const currentGet = JSON.parse(await readFile(currentGetPath, 'utf8'));
const independentResult = JSON.parse(await readFile(independentResultPath, 'utf8'));
const frozenHash = JSON.parse(await readFile(frozenHashPath, 'utf8'));
const cursorSummary = JSON.parse(await readFile(summaryPath, 'utf8'));
const cursorResultText = cursorSummary.result?.result ?? '';

const checks = [];
const arithmeticCases = [];
const negativeCases = [];
const blockers = [];
const advisories = [];
const failures = [];

async function sha256(filePath) {
  const bytes = await readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

function assertion(name, callback, evidence = {}) {
  try {
    callback();
    checks.push({ name, passed: true, evidence });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({ name, passed: false, evidence, error: message });
    failures.push({ name, error: message });
  }
}

function near(actual, expectedValue, tolerance = 1e-9) {
  return Number.isFinite(actual) && Math.abs(actual - expectedValue) <= tolerance;
}

function objectFor(skillKey) {
  const object = candidate.objects.find((entry) => entry.skillKey === skillKey);
  assert.ok(object, `候选缺少技能 ${skillKey}`);
  return object;
}

function parameterFor(skillKey, parameterKey) {
  const parameter = objectFor(skillKey).apiPayload.parameters.find((entry) => entry.parameterKey === parameterKey);
  assert.ok(parameter, `${skillKey} 缺少参数 ${parameterKey}`);
  return parameter;
}

function formulaFor(skillKey, formulaKey) {
  const formula = objectFor(skillKey).apiPayload.formulas.find((entry) => entry.formulaKey === formulaKey);
  assert.ok(formula, `${skillKey} 缺少公式 ${formulaKey}`);
  return formula;
}

function sourceObject(equipmentKey) {
  const object = source.selectedRawObjects?.[equipmentKey];
  assert.ok(object, `冻结来源缺少 ${equipmentKey}`);
  return object;
}

function rawSpell(equipmentKey, spellPath) {
  const object = sourceObject(equipmentKey).rawSpellObjects?.[spellPath];
  assert.ok(object, `冻结来源缺少 ${spellPath}`);
  return object.mSpell ?? object.mBuff ?? object;
}

function sourceValue(equipmentKey, key) {
  return sourceObject(equipmentKey).dataValues?.[key];
}

function candidateValue(skillKey, parameterKey) {
  const parameter = parameterFor(skillKey, parameterKey);
  return parameter.fixedValue;
}

function evaluate(expression, runtime = {}, attributes = {}, fixedParameters = {}) {
  assert.ok(expression && typeof expression === 'object', '公式节点不是对象');
  if (expression.nodeType === 'PARAMETER') {
    if (Object.prototype.hasOwnProperty.call(runtime, expression.parameterKey)) return runtime[expression.parameterKey];
    assert.ok(Object.prototype.hasOwnProperty.call(fixedParameters, expression.parameterKey), `缺少运行时输入 ${expression.parameterKey}`);
    return fixedParameters[expression.parameterKey];
  }
  if (expression.nodeType === 'ATTRIBUTE') {
    const key = `${expression.attributeOwner}.${expression.attributeKey}.${expression.attributeValueKind}`;
    assert.ok(Object.prototype.hasOwnProperty.call(attributes, key), `缺少属性输入 ${key}`);
    return attributes[key];
  }
  assert.equal(expression.nodeType, 'OPERATION', `未知公式节点 ${expression.nodeType}`);
  assert.ok(Array.isArray(expression.operands) && expression.operands.length >= 2, '运算节点缺少操作数');
  const values = expression.operands.map((operand) => evaluate(operand, runtime, attributes, fixedParameters));
  if (expression.operation === 'MULTIPLY') return values.reduce((left, right) => left * right, 1);
  if (expression.operation === 'ADD') return values.reduce((left, right) => left + right, 0);
  throw new Error(`未知运算 ${expression.operation}`);
}

function evaluateFormula(skillKey, formulaKey, runtime = {}, attributes = {}) {
  const fixedParameters = Object.fromEntries(objectFor(skillKey).apiPayload.parameters
    .filter((parameter) => parameter.valueMode === 'FIXED' && parameter.fixedValue !== null)
    .map((parameter) => [parameter.parameterKey, parameter.fixedValue]));
  return evaluate(formulaFor(skillKey, formulaKey).expression, runtime, attributes, fixedParameters);
}

function arithmetic(name, actual, expectedValue, evidence = {}) {
  const passed = near(actual, expectedValue);
  arithmeticCases.push({ name, actual, expected: expectedValue, passed, evidence });
  assertion(`算例：${name}`, () => assert.ok(passed, `实际值 ${actual} 不等于 ${expectedValue}`), evidence);
}

function negative(name, actual, expectedValue, evidence = {}) {
  const passed = Object.is(actual, expectedValue);
  negativeCases.push({ name, actual, expected: expectedValue, passed, evidence });
  assertion(`负例：${name}`, () => assert.equal(actual, expectedValue), evidence);
}

const candidateHash = await sha256(candidatePath);
const sourceHash = await sha256(sourcePath);
const currentGetHash = await sha256(currentGetPath);
const independentResultHash = await sha256(independentResultPath);
const runSummaryHash = await sha256(summaryPath);
const runEventsHash = await sha256(join(runDir, 'events.jsonl'));
const runDiffHash = await sha256(join(runDir, 'diff.patch'));
const runDiffSize = (await stat(join(runDir, 'diff.patch'))).size;
const originalCandidateHash = await sha256(join(batchRoot, '完整候选.json'));
const originalSourceHash = await sha256(join(batchRoot, '冻结来源.json'));
const beforePathSignatures = JSON.parse(await readFile(join(runDir, 'path-signatures-before.json'), 'utf8'));
const afterPathSignatures = JSON.parse(await readFile(join(runDir, 'path-signatures-after.json'), 'utf8'));
const beforeGit = await readFile(join(runDir, 'git-status-before.txt'), 'utf8');
const afterGit = await readFile(join(runDir, 'git-status-after.txt'), 'utf8');
const beforeWorktreeGit = await readFile(join(runDir, 'git-status-worktree-before.txt'), 'utf8');
const afterWorktreeGit = await readFile(join(runDir, 'git-status-worktree-after.txt'), 'utf8');

assertion('候选副本 SHA256 与冻结值一致', () => assert.equal(candidateHash, expected.candidateSha256), { actual: candidateHash, expected: expected.candidateSha256 });
assertion('来源副本 SHA256 与冻结值一致', () => assert.equal(sourceHash, expected.sourceFreezeSha256), { actual: sourceHash, expected: expected.sourceFreezeSha256 });
assertion('只读 GET 副本 SHA256 与冻结值一致', () => assert.equal(currentGetHash, expected.currentGETSha256), { actual: currentGetHash, expected: expected.currentGETSha256 });
assertion('既有独立核算副本 SHA256 与冻结值一致', () => assert.equal(independentResultHash, expected.independentResultSha256), { actual: independentResultHash, expected: expected.independentResultSha256 });
assertion('冻结哈希记录与四个输入文件一致', () => {
  assert.equal(frozenHash.candidateSha256, candidateHash);
  assert.equal(frozenHash.sourceFreezeSha256, sourceHash);
  assert.equal(frozenHash.currentGETSha256, currentGetHash);
  assert.equal(frozenHash.independentResultSha256, independentResultHash);
}, { frozenHash });

const expectedEquipmentKeys = ['item_3074', 'item_3748', 'item_6698', 'item_3107', 'item_3190', 'item_6664', 'item_8020'];
const expectedSkillKeys = ['item_3074_active', 'item_3748_passive', 'item_3748_active', 'item_6698_active', 'item_3107_active', 'item_3190_active', 'item_6664_passive', 'item_8020_passive'];
const selectedEquipmentSet = new Set(candidate.objects.map((entry) => entry.equipmentKey));
const selectedSkillSet = new Set(candidate.objects.map((entry) => entry.skillKey));
assertion('候选七件装备与八个技能槽完整且无重复', () => {
  assert.deepEqual([...selectedEquipmentSet].sort(), [...expectedEquipmentKeys].sort());
  assert.deepEqual([...selectedSkillSet].sort(), [...expectedSkillKeys].sort());
  assert.equal(candidate.objects.length, 8);
}, { equipmentKeys: [...selectedEquipmentSet], skillKeys: [...selectedSkillSet] });
assertion('候选总数与冻结总数一致', () => assert.deepEqual(candidate.totals, {
  equipment: 7,
  skills: 8,
  parameters: 40,
  formulas: 11,
  effects: 0,
  processes: 0,
  internalStates: 0,
  triggerRules: 0,
  relations: 8,
  representativeImages: 8,
  components: 82,
}), { totals: candidate.totals });
assertion('每个技能载荷都有对应关系和代表图键', () => {
  for (const object of candidate.objects) {
    assert.equal(object.apiPayload.relation.equipmentKey, object.equipmentKey);
    assert.equal(object.apiPayload.relation.skillKey, object.skillKey);
    assert.equal(object.apiPayload.representativeImage.imageKey, object.equipmentKey);
  }
}, { relationCount: candidate.objects.length, imageCount: candidate.objects.length });
assertion('效果、过程、内部状态和触发规则均为空', () => {
  for (const object of candidate.objects) {
    assert.deepEqual(object.apiPayload.effects, []);
    assert.deepEqual(object.apiPayload.processes, []);
    assert.deepEqual(object.apiPayload.internalStates, []);
    assert.deepEqual(object.apiPayload.triggerRules, []);
  }
}, { effects: 0, processes: 0, internalStates: 0, triggerRules: 0 });

// 逐对象检查原始绑定与关键数值，避免只按参数名或说明文字通过。
for (const equipmentKey of expectedEquipmentKeys.concat(['item_3222', 'item_3085', 'item_3504'])) {
  assertion(`${equipmentKey} 冻结原对象存在`, () => assert.ok(sourceObject(equipmentKey)), { equipmentKey });
}
assertion('3074 来源绑定与主动字段一致', () => {
  const raw = sourceObject('item_3074');
  assert.ok(raw.bindings.some((entry) => entry.sourceKey === 'Item_3074_Active' && entry.text.includes('血斩')));
  assert.equal(sourceValue('item_3074', 'Radius'), 450);
  assert.ok(near(sourceValue('item_3074', 'ActiveADRatio'), 0.8, 1e-7));
  assert.equal(sourceValue('item_3074', 'Cooldown'), 10);
  assert.equal(sourceValue('item_3074', 'VampAmp'), 1);
  const spell = rawSpell('item_3074', 'Items/3074/Spells/3074Active');
  assert.equal(spell.mTargetingTypeData.__type, 'Self');
}, { source: '/mDataValues/ActiveADRatio,Radius,Cooldown,VampAmp; /Spells/3074Active/mSpell/mTargetingTypeData' });
assertion('3748 主目标节点与主目标绑定一致', () => {
  const raw = sourceObject('item_3748');
  assert.ok(raw.bindings.some((entry) => entry.sourceKey === 'Item_3748_Brief' && entry.text.includes('目标身后的敌人们')));
  assert.ok(near(sourceValue('item_3748', 'PrimaryTargetHPRatio'), 0.01, 1e-7));
  assert.ok(near(sourceValue('item_3748', 'ActivePrimaryTargetHPRatio'), 0.04, 1e-7));
  assert.equal(sourceValue('item_3748', 'RangedEffectiveness'), 0.5);
  const calculations = raw.rawObject.mItemCalculations;
  assert.equal(calculations.CalcValue.mFormulaParts[0].mStat, 12);
  assert.equal(calculations.CalcValueC.mFormulaParts[0].mStat, 12);
  assert.equal(calculations.OnHitDamageCalc.mFormulaParts[0].mStat, 12);
  assert.equal(calculations.OnHitDamageCalc.mFormulaParts[0].mCoefficient, 0.009999999776482582);
}, { mStat: 12, primaryRatio: sourceValue('item_3748', 'PrimaryTargetHPRatio'), activeRatio: sourceValue('item_3748', 'ActivePrimaryTargetHPRatio') });
assertion('6698 来源主伤害与 Self 主动绑定一致', () => {
  const raw = sourceObject('item_6698');
  assert.ok(raw.bindings.some((entry) => entry.sourceKey === 'Item_6698_Active' && entry.text.includes('附近的敌人们')));
  assert.equal(sourceValue('item_6698', 'ActiveRadius'), 450);
  assert.equal(sourceValue('item_6698', 'Cooldown'), 10);
  assert.ok(near(raw.rawObject.mItemCalculations.SlashDamageBase.mFormulaParts[0].mCoefficient, 0.8, 1e-7));
  assert.equal(raw.rawObject.mItemCalculations.SlashDamageBase.mFormulaParts[0].mStat, 2);
  assert.equal(rawSpell('item_6698', 'Items/6698/Spells/6698Active').mTargetingTypeData.__type, 'Self');
}, { source: '/mDataValues/ActiveRadius,Cooldown; /mItemCalculations/SlashDamageBase; /Spells/6698Active/mSpell/mTargetingTypeData' });
assertion('3107 敌方伤害绑定、范围、延迟与冷却值一致', () => {
  const raw = sourceObject('item_3107');
  assert.ok(raw.official.description.includes('友方单位们回复'));
  assert.ok(raw.official.description.includes('敌方英雄们造成'));
  assert.ok(raw.official.description.includes('2.5秒后'));
  assert.ok(near(sourceValue('item_3107', 'DamageToChampions'), 0.1, 1e-7));
  assert.equal(sourceValue('item_3107', 'AOESize'), 550);
  assert.equal(sourceValue('item_3107', 'CastRange'), 5500);
  assert.equal(sourceValue('item_3107', 'Cooldown'), 90);
  assert.match(JSON.stringify(raw.rawObject.mItemCalculations.HealAmount), /ByCharLevelInterpolation|mLevel1Value|mBreakpoints/);
}, { friendBranch: '150-350', enemyRatio: sourceValue('item_3107', 'DamageToChampions'), delaySeconds: 2.5 });
assertion('3190 目标类型、旗标与端点来源一致但未伪造中间曲线', () => {
  const raw = sourceObject('item_3190');
  const spell = rawSpell('item_3190', 'Items/3190/Spells/3190Active');
  assert.equal(spell.mTargetingTypeData.__type, 'SelfAoe');
  assert.equal(spell.mAffectsTypeFlags, 8193);
  assert.equal(sourceValue('item_3190', 'ShieldRange'), 850);
  assert.equal(sourceValue('item_3190', 'ShieldMinTOOLTIP'), 290);
  assert.equal(sourceValue('item_3190', 'ShieldMaxTOOLTIP'), 360);
  assert.equal(sourceValue('item_3190', 'ShieldDuration'), 2.5);
  assert.match(JSON.stringify(raw.rawObject.mItemCalculations.ShieldAmount), /ByCharLevelBreakpoints/);
}, { targetType: 'SelfAoe', affectsFlags: 8193, endpoint: [290, 360], durationSeconds: 2.5 });
assertion('6664 献祭计算树与触发支路值一致', () => {
  const raw = sourceObject('item_6664');
  assert.ok(raw.bindings.some((entry) => entry.sourceKey === 'Item_6664_Tooltip' && entry.text.includes('每秒对附近敌人')));
  assert.equal(sourceValue('item_6664', 'Range'), 325);
  assert.equal(sourceValue('item_6664', 'AuraDuration'), 3);
  assert.equal(sourceValue('item_6664', 'TicksPerSecond'), 1);
  assert.equal(sourceValue('item_6664', 'ProcAoE'), 350);
  assert.equal(sourceValue('item_6664', 'ChampProcAoE'), 500);
  assert.equal(sourceValue('item_6664', 'ChampProcDPSMultiplier'), 4);
  const tick = raw.rawObject.mItemCalculations.DamagePerTick.mFormulaParts;
  assert.equal(tick[0].mNumber, 15);
  assert.equal(tick[1].mStat, 12);
  assert.equal(tick[1].mStatFormula, 2);
  assert.ok(near(tick[1].mCoefficient, 0.01, 1e-7));
}, { range: 325, procAoE: 350, championProcAoE: 500, ticksPerSecond: 1 });
assertion('8020 附近敌方英雄增幅绑定一致', () => {
  const raw = sourceObject('item_8020');
  assert.ok(raw.official.description.includes('附近的敌方英雄承受12%额外'));
  assert.equal(sourceValue('item_8020', 'Radius'), 700);
  assert.ok(near(sourceValue('item_8020', 'DamageAmp'), 0.12, 1e-7));
}, { radius: 700, damageAmp: sourceValue('item_8020', 'DamageAmp') });

// 独立从候选表达式求值 21 个区别性例子，不读取既有 arithmeticCases 的 actual/expected。
arithmetic('3074 总攻击力 300', evaluateFormula('item_3074_active', 'active_physical_damage', {}, { 'SOURCE.attack_damage.TOTAL': 300 }), 240, { ratio: 0.8, totalAD: 300 });
arithmetic('3074 总攻击力 475', evaluateFormula('item_3074_active', 'active_physical_damage', {}, { 'SOURCE.attack_damage.TOTAL': 475 }), 380, { ratio: 0.8, totalAD: 475 });
arithmetic('3074 冷却 10 秒转毫秒', candidateValue('item_3074_active', 'active_cooldown_ms'), 10000, { sourceSeconds: 10 });
arithmetic('3748 被动主目标近战 mStat12=1000', evaluateFormula('item_3748_passive', 'primary_on_hit_damage_melee', { primary_target_hp_ratio: 0.01, source_mstat12_value: 1000 }), 10, { ratio: 0.01, mStat12: 1000 });
arithmetic('3748 被动主目标远程 mStat12=1000', evaluateFormula('item_3748_passive', 'primary_on_hit_damage_ranged', { primary_target_hp_ratio: 0.01, source_mstat12_value: 1000, ranged_effectiveness: 0.5 }), 5, { ratio: 0.01, ranged: 0.5, mStat12: 1000 });
arithmetic('3748 刚斩主目标近战 mStat12=1250', evaluateFormula('item_3748_active', 'active_primary_damage_melee', { active_primary_target_hp_ratio: 0.04, active_source_mstat12_value: 1250 }), 50, { ratio: 0.04, mStat12: 1250 });
arithmetic('3748 刚斩主目标远程 mStat12=1250', evaluateFormula('item_3748_active', 'active_primary_damage_ranged', { active_primary_target_hp_ratio: 0.04, active_source_mstat12_value: 1250, ranged_effectiveness: 0.5 }), 25, { ratio: 0.04, ranged: 0.5, mStat12: 1250 });
arithmetic('6698 总攻击力 315', evaluateFormula('item_6698_active', 'active_physical_damage', {}, { 'SOURCE.attack_damage.TOTAL': 315 }), 252, { ratio: 0.8, totalAD: 315 });
arithmetic('3107 目标最大生命 2000', evaluateFormula('item_3107_active', 'enemy_true_damage', { enemy_true_damage_ratio: 0.1, actual_target_max_health: 2000 }), 200, { ratio: 0.1, targetMaxHealth: 2000 });
arithmetic('3107 目标最大生命 4175', evaluateFormula('item_3107_active', 'enemy_true_damage', { enemy_true_damage_ratio: 0.1, actual_target_max_health: 4175 }), 417.5, { ratio: 0.1, targetMaxHealth: 4175 });
arithmetic('3107 延迟 2.5 秒转毫秒', candidateValue('item_3107_active', 'impact_delay_ms'), 2500, { sourceSeconds: 2.5 });
arithmetic('6664 每次伤害 mStat12=1000', evaluateFormula('item_6664_passive', 'damage_per_tick', { damage_flat_per_tick: 15, damage_scaling_ratio: 0.01, source_mstat12_formula2_value: 1000 }), 25, { flat: 15, ratio: 0.01, mStat12Formula2: 1000 });
arithmetic('6664 每秒伤害 mStat12=1000', evaluateFormula('item_6664_passive', 'damage_per_second', { ticks_per_second: 1, damage_flat_per_tick: 15, damage_scaling_ratio: 0.01, source_mstat12_formula2_value: 1000 }), 25, { ticksPerSecond: 1, mStat12Formula2: 1000 });
arithmetic('6664 英雄触发每次伤害 mStat12=1000', evaluateFormula('item_6664_passive', 'champion_proc_damage_per_tick', { champion_proc_multiplier: 4, damage_flat_per_tick: 15, damage_scaling_ratio: 0.01, source_mstat12_formula2_value: 1000 }), 100, { championMultiplier: 4, mStat12Formula2: 1000 });
arithmetic('6664 每次伤害 mStat12=2000', evaluateFormula('item_6664_passive', 'damage_per_tick', { damage_flat_per_tick: 15, damage_scaling_ratio: 0.01, source_mstat12_formula2_value: 2000 }), 35, { flat: 15, ratio: 0.01, mStat12Formula2: 2000 });
arithmetic('6664 英雄触发每次伤害 mStat12=2000', evaluateFormula('item_6664_passive', 'champion_proc_damage_per_tick', { champion_proc_multiplier: 4, damage_flat_per_tick: 15, damage_scaling_ratio: 0.01, source_mstat12_formula2_value: 2000 }), 140, { championMultiplier: 4, mStat12Formula2: 2000 });
arithmetic('6664 持续 3 秒转毫秒', candidateValue('item_6664_passive', 'aura_duration_ms'), 3000, { sourceSeconds: 3 });
arithmetic('6664 来源节拍', candidateValue('item_6664_passive', 'ticks_per_second'), 1, { sourceTicksPerSecond: 1 });
arithmetic('6664 英雄触发倍率', candidateValue('item_6664_passive', 'champion_proc_multiplier'), 4, { sourceMultiplier: 4 });
arithmetic('8020 合资格魔法伤害 1000', evaluateFormula('item_8020_passive', 'additional_magic_damage', { damage_amp_ratio: 0.12, actual_qualified_magic_damage: 1000 }), 120, { ratio: 0.12, qualifiedDamage: 1000 });
arithmetic('8020 合资格魔法伤害 333', evaluateFormula('item_8020_passive', 'additional_magic_damage', { damage_amp_ratio: 0.12, actual_qualified_magic_damage: 333 }), 39.96, { ratio: 0.12, qualifiedDamage: 333 });

negative('3074 距离 451 超出 450 不满足范围', 451 <= sourceValue('item_3074', 'Radius'), false, { radius: 450, distance: 451 });
negative('8020 距离 701 超出 700 不满足增幅范围', 701 <= sourceValue('item_8020', 'Radius'), false, { radius: 700, distance: 701 });
negative('6664 距离 326 超出献祭光环 325', 326 <= sourceValue('item_6664', 'Range'), false, { auraRange: 325, distance: 326 });
negative('6664 触发脉冲半径 350 不能冒充光环 325', sourceValue('item_6664', 'ProcAoE') === sourceValue('item_6664', 'Range'), false, { procAoE: 350, auraRange: 325 });
negative('3748 缺 mStat12 时不自动填零', (() => { try { evaluateFormula('item_3748_passive', 'primary_on_hit_damage_melee', { primary_target_hp_ratio: 0.01 }); return true; } catch { return false; } })(), false, { requiredRuntimeInput: 'source_mstat12_value' });
negative('3107 缺目标最大生命时不自动填零', (() => { try { evaluateFormula('item_3107_active', 'enemy_true_damage', { enemy_true_damage_ratio: 0.1 }); return true; } catch { return false; } })(), false, { requiredRuntimeInput: 'actual_target_max_health' });
negative('3222 缺 SelfAoe 不能推出第三方专属', (() => {
  const spell = rawSpell('item_3222', 'Items/3222/Spells/3222Active');
  const hasSelfAoe = spell.mTargetingTypeData?.__type === 'SelfAoe';
  const friendOnlyProof = false;
  return !hasSelfAoe && friendOnlyProof;
})(), false, { flags: 1, sourceText: '一名友方英雄', conclusion: '目标归属未证，不能判定范围外' });

const source6664 = sourceObject('item_6664');
const candidate6664 = objectFor('item_6664_passive');
const candidate6664ParamKeys = new Set(candidate6664.apiPayload.parameters.map((parameter) => parameter.parameterKey));
const missingAuraRange = !candidate6664ParamKeys.has('aura_range');
blockers.push({
  id: 'item_6664_passive.aura_range',
  severity: '实质修订',
  current: { parameterKeys: [...candidate6664ParamKeys], procAoE: candidateValue('item_6664_passive', 'proc_aoe_radius'), championProcAoE: candidateValue('item_6664_passive', 'champion_proc_aoe_radius') },
  source: { pointer: '/selectedRawObjects/item_6664/dataValues/Range', value: source6664.dataValues.Range, related: { AuraDuration: source6664.dataValues.AuraDuration, TicksPerSecond: source6664.dataValues.TicksPerSecond } },
  minimumCorrection: '新增 aura_range，FIXED INTEGER 325，说明为献祭光环半径；保留350/500为触发脉冲半径。',
});
assertion('已检测到 6664 缺少献祭光环半径参数', () => assert.equal(missingAuraRange, true), { missingAuraRange, sourceRange: source6664.dataValues.Range });

const entryBoundary3222 = candidate.entryBoundary?.unselectedMechanismBearing?.find((entry) => entry.equipmentKey === 'item_3222');
const object3107 = objectFor('item_3107_active');
const current3107HealExclusion = object3107.disposition?.['范围外']?.find((entry) => entry.component === '友方单位治疗');
const source3222 = sourceObject('item_3222');
const source3222Text = source3222.bindings.find((entry) => entry.sourceKey === 'Item_3222_Active')?.text ?? '';
const source3107Text = sourceObject('item_3107').official.description;
const source3190Spell = rawSpell('item_3190', 'Items/3190/Spells/3190Active');
const candidate3190 = objectFor('item_3190_active');
const selfClaim = candidate3190.apiPayload.skill.description.includes('支持自身在范围内');
const candidate3190ShieldValue = parameterFor('item_3190_active', 'actual_self_shield_value');

blockers.push({
  id: 'item_3222.scope-classification',
  severity: '范围边界修订',
  current: { boundaryEntry: entryBoundary3222, sourceText: source3222Text, flags: source3222.rawSpellObjects['Items/3222/Spells/3222Active'].mSpell.mAffectsTypeFlags },
  evidence: '来源只证明一名友方英雄与旗标1；没有同版 SelfAoe 或明确第三方专属枚举。缺少自身证据不能等同范围外。',
  minimumCorrection: '将 3222 从已排除改为目标归属待补证，保留来源治疗/净化字段，不凭缺证补建当前技能。',
});
assertion('已检测到 3222 当前把目标归属缺证写成范围外', () => assert.ok(entryBoundary3222 && /故不把.*纳入/.test(entryBoundary3222.reason)), { entryBoundary3222 });

blockers.push({
  id: 'item_3107.friend-heal-scope',
  severity: '范围边界修订',
  current: { exclusion: current3107HealExclusion, sourceText: source3107Text },
  evidence: '来源明确友方单位治疗150-350且含等级插值，但没有同版目标枚举证明施法者不在友方单位中。',
  minimumCorrection: '将友方治疗从范围外改为目标资格待补证；保留150/350端点和未证插值，不创建默认 DIRECT_HEAL。',
});
assertion('已检测到 3107 当前把友方治疗目标资格缺证写成范围外', () => assert.ok(current3107HealExclusion), { current3107HealExclusion });

blockers.push({
  id: 'item_3190.self-target-proof',
  severity: '语义说明修订',
  current: { selfClaim, targetType: source3190Spell.mTargetingTypeData.__type, affectsTypeFlags: source3190Spell.mAffectsTypeFlags, description: candidate3190.apiPayload.skill.description },
  evidence: 'SelfAoe 可证明施法原点/几何模型；8193 的位义未在本批冻结资料中给出同版枚举证明，因此不能据此断言自身必受护盾。',
  minimumCorrection: '保留850范围、290/360端点和运行时护盾输入；把“支持自身在范围内”改成“自身目标资格待补证”。',
});
assertion('已检测到 3190 当前说明过度断言自身受益', () => assert.equal(selfClaim, true), { selfClaim });

blockers.push({
  id: 'item_3190.actual_self_shield_value',
  severity: '类型与语义修订',
  current: { parameterKey: candidate3190ShieldValue.parameterKey, name: candidate3190ShieldValue.name, valueType: candidate3190ShieldValue.valueType, valueMode: candidate3190ShieldValue.valueMode, fixedValue: candidate3190ShieldValue.fixedValue },
  evidence: '来源只有 ByCharLevelBreakpointsCalculationPart 和290/360端点，没有证明中间等级或衰减求值一定为整数；当前护盾值运行输入用 INTEGER 会在小数结果时丢值，字段说明又预先绑定施法者。',
  minimumCorrection: '保留稳定键 actual_self_shield_value，改 DECIMAL/RUNTIME_INPUT；名称和说明改为“当前合资格英雄基础护盾值”，不宣称 SelfAoe 已证明自身受益。',
});
assertion('已检测到 3190 护盾运行输入使用过窄整数类型', () => assert.equal(candidate3190ShieldValue.valueType, 'INTEGER'), { valueType: candidate3190ShieldValue.valueType, expectedSaferType: 'DECIMAL' });

const hp12ProofPath = join(root, '..', 'hp12-default-proof', 'README.md');
let hp12Proof = { available: false };
try {
  const hp12Text = await readFile(hp12ProofPath, 'utf8');
  hp12Proof = {
    available: true,
    sha256: createHash('sha256').update(hp12Text).digest('hex'),
    hasNarrowTotalHpRule: hp12Text.includes('SOURCE.hp.TOTAL') && hp12Text.includes('StatByNamedDataValueCalculationPart'),
  };
} catch {
  // 证据文件不属于本批必需输入，缺失时只记录咨询项。
}
const hpNodes = ['CalcValue', 'CalcValueC'].map((key) => sourceObject('item_3748').rawObject.mItemCalculations[key].mFormulaParts[0]);
const hp12NarrowShape = hpNodes.every((node) => node.mStat === 12 && node.mStatFormula === undefined && node.__type === 'StatByNamedDataValueCalculationPart');
advisories.push({
  id: 'item_3748.mStat12',
  finding: '本批仍保留 RUNTIME_INPUT 是安全的；外部窄补证显示该两个具名旧节点形状可进一步审查为 SOURCE.hp.TOTAL。',
  evidence: { hp12NarrowShape, hp12Proof, nodes: hpNodes },
  boundary: '只适用于具名旧节点、mStat=12、公式默认0且无所有者切换；不扩到 StatByCoefficient、SubPart、mStat29 或 CURRENT/BONUS。',
});
assertion('3748 两个具名主目标节点满足 HP12 窄审查形状', () => assert.equal(hp12NarrowShape, true), { nodes: hpNodes });

const currentRelationItems = currentGet.equipmentRelationsGET.flatMap((entry) => entry.relationGET?.items ?? []);
const relationPairs = currentRelationItems.map((entry) => `${entry.equipmentKey}:${entry.skillKey}`);
const targetEquipmentKeys = expectedEquipmentKeys.concat(['item_3222', 'item_3085', 'item_3504']);
assertion('只读 GET 的198件目录、挂载数量和去重关系一致', () => {
  assert.equal(currentGet.apiWrites, 0);
  assert.equal(currentGet.noBusinessWrites, true);
  assert.equal(currentGet.summary.equipmentCount, 198);
  assert.equal(currentGet.summary.mountedEquipmentCount, 108);
  assert.equal(currentGet.summary.unmountedEquipmentCount, 90);
  assert.equal(currentGet.summary.relationCount, 110);
  assert.equal(currentGet.summary.uniqueMountedSkillCount, 110);
  assert.equal(currentGet.summary.mountedSkillDetailsCount, 110);
  assert.equal(currentGet.summary.getRequests, 329);
  assert.equal(currentRelationItems.length, 110);
  assert.equal(new Set(relationPairs).size, relationPairs.length);
}, { summary: currentGet.summary, relationPairs: relationPairs.length, uniqueRelationPairs: new Set(relationPairs).size });
assertion('十件目标装备关系真实为0且技能 GET 均为404', () => {
  for (const equipmentKey of targetEquipmentKeys) {
    const target = currentGet.targetChecks.find((entry) => entry.equipmentKey === equipmentKey);
    assert.ok(target, `缺少目标 GET ${equipmentKey}`);
    assert.equal(target.relationGET.status, 200);
    assert.equal(target.relationGET.total, 0);
    for (const subject of target.subjectGET) assert.equal(subject.status, 404);
  }
}, { targetEquipmentKeys, targetCount: targetEquipmentKeys.length });
const directGetRecorded = currentGet.equipmentGET.items.some((item) => Object.prototype.hasOwnProperty.call(item, 'directAttributes'));
const representativeGetRecorded = currentGet.equipmentGET.items.some((item) => Object.prototype.hasOwnProperty.call(item, 'representativeImage'));
advisories.push({
  id: 'write-before-protection',
  finding: '当前198装备 GET 只有主体基础字段，未单独提供直接属性或代表图 GET；候选 safeguards 中的保护声明不能当作已记录的 GET 证据。',
  evidence: { directGetRecorded, representativeGetRecorded, equipmentItemKeys: Object.keys(currentGet.equipmentGET.items[0] ?? {}) },
  requiredBeforeBusinessWrite: '主负责人应在写前另取直接属性、原图和既有挂载/关系快照，不能只引用 safeguards 声明。',
});

assertion('既有独立核算的公式/算例计数与本次独立算例一致', () => {
  assert.equal(independentResult.formulaCount, 11);
  assert.equal(independentResult.arithmeticCaseCount, 21);
  assert.equal(independentResult.arithmeticCases.filter((entry) => entry.passed).length, 21);
  assert.equal(arithmeticCases.length, 21);
}, { prior: { formulaCount: independentResult.formulaCount, arithmeticCaseCount: independentResult.arithmeticCaseCount }, independent: arithmeticCases.length });

assertion('Cursor 实际运行完成且仅使用受限只读工具', () => {
  assert.equal(cursorSummary.resultStatus, 'finished');
  assert.equal(cursorSummary.runId, expected.cursorRunId);
  assert.equal(cursorSummary.requestId, expected.cursorRequestId);
  assert.equal(cursorSummary.agentId, expected.cursorAgentId);
  assert.equal(cursorSummary.runtimeUsed, 'sdk');
  assert.equal(cursorSummary.requestedModel.id, 'grok-4.6');
  assert.deepEqual(cursorSummary.requestedModel.params, [{ id: 'effort', value: 'high' }, { id: 'fast', value: 'false' }]);
  assert.deepEqual(cursorSummary.settingSources, ['project']);
  assert.equal(cursorSummary.promptMode, 'DESIGN_REVIEW_ONLY');
  assert.equal(cursorSummary.eventCountByType.tool_call, 140);
  assert.equal(cursorSummary.toolCalls.filter((entry) => entry.status === 'completed').length, 70);
  assert.equal(cursorSummary.toolCalls.filter((entry) => entry.status === 'failed').length, 0);
  assert.deepEqual([...new Set(cursorSummary.toolCalls.map((entry) => entry.name))].sort(), ['glob', 'grep', 'read', 'shell']);
  assert.equal(cursorSummary.writeAllowlistAudit.auditAvailable, true);
  assert.equal(cursorSummary.writeAllowlistAudit.outsideScopeCount, 0);
  assert.equal(cursorSummary.writeAllowlistAudit.runDeltaCount, 0);
  assert.equal(cursorSummary.writeAllowlistAudit.failClosed, false);
  assert.equal(cursorSummary.git.allowedPathsDirtyBefore, false);
  assert.equal(cursorSummary.git.allowedPathsDirtyAfter, false);
  assert.deepEqual(cursorSummary.git.runDelta, []);
  assert.equal(Object.keys(beforePathSignatures).length, 0);
  assert.equal(Object.keys(afterPathSignatures).length, 0);
  assert.equal(beforeGit, '');
  assert.equal(afterGit, '');
  assert.equal(beforeWorktreeGit, '');
  assert.equal(afterWorktreeGit, '');
}, { runId: cursorSummary.runId, toolCallEvents: cursorSummary.eventCountByType.tool_call, completedTools: cursorSummary.toolCalls.filter((entry) => entry.status === 'completed').length, toolNames: [...new Set(cursorSummary.toolCalls.map((entry) => entry.name))] });
assertion('Cursor 结论和运行差异与原始记录一致', () => {
  assert.match(cursorResultText, /VERDICT: REVISE/);
  assert.match(cursorResultText, /item_6664_passive/);
  assert.match(cursorResultText, /Range=325/);
  assert.match(cursorResultText, /未调用业务写接口/);
  assert.equal(runDiffSize, 0);
}, { resultStatus: cursorSummary.resultStatus, summarySha256: runSummaryHash, eventsSha256: runEventsHash, diffSha256: runDiffHash, diffBytes: runDiffSize });

// 原始冻结对象仍来自规划目录，最后核对当前工作树中的候选和来源没有被本次审查改写。
assertion('规划目录中的候选与来源仍为冻结 SHA', () => {
  assert.equal(originalCandidateHash, expected.candidateSha256);
  assert.equal(originalSourceHash, expected.sourceFreezeSha256);
}, { candidatePath: join(batchRoot, '完整候选.json'), sourcePath: join(batchRoot, '冻结来源.json'), candidateHash: originalCandidateHash, sourceHash: originalSourceHash });

const report = {
  generatedAt: new Date().toISOString(),
  stage: '第十九批装备技能独立语义、数值和 Cursor 审查',
  verdict: 'REVISE',
  candidateSha256: candidateHash,
  sourceFreezeSha256: sourceHash,
  currentGETSha256: currentGetHash,
  independentResultSha256: independentResultHash,
  scope: {
    equipmentCount: selectedEquipmentSet.size,
    skillCount: selectedSkillSet.size,
    parameterCount: candidate.totals.parameters,
    formulaCount: candidate.totals.formulas,
    excludedMechanismBearing: ['item_3222', 'item_3085', 'item_3504'],
  },
  cursor: {
    runtime: cursorSummary.runtimeUsed,
    model: cursorSummary.requestedModel,
    runId: cursorSummary.runId,
    requestId: cursorSummary.requestId,
    agentId: cursorSummary.agentId,
    resultStatus: cursorSummary.resultStatus,
    durationMs: cursorSummary.durationMs,
    toolCallEvents: cursorSummary.eventCountByType.tool_call,
    completedTools: cursorSummary.toolCalls.filter((entry) => entry.status === 'completed').length,
    failedTools: cursorSummary.toolCalls.filter((entry) => entry.status === 'failed').length,
    tools: [...new Set(cursorSummary.toolCalls.map((entry) => entry.name))].sort(),
    settingSources: cursorSummary.settingSources,
    allowedPathSpecs: cursorSummary.allowedPathSpecs,
    writeAllowlistAudit: cursorSummary.writeAllowlistAudit,
    git: cursorSummary.git,
    rawFiles: {
      summary: { path: summaryPath, sha256: runSummaryHash },
      events: { path: join(runDir, 'events.jsonl'), sha256: runEventsHash },
      diff: { path: join(runDir, 'diff.patch'), sha256: runDiffHash, bytes: runDiffSize },
    },
  },
  blockers,
  advisories,
  arithmeticCases,
  negativeCases,
  checks,
  checkerFailures: failures,
  noBusinessWrites: true,
  caveat: '这是冻结资料、只读 GET 和 Cursor 静态审查；没有业务写入、浏览器验收或战斗运行证据。',
};

function markdown(data) {
  const blockerLines = data.blockers.map((item) => `- **${item.id}（${item.severity}）**：${item.minimumCorrection ?? item.evidence}`);
  const advisoryLines = data.advisories.map((item) => `- **${item.id}**：${item.finding}`);
  const arithmeticPassed = data.arithmeticCases.filter((item) => item.passed).length;
  const negativePassed = data.negativeCases.filter((item) => item.passed).length;
  const failedChecks = data.checks.filter((item) => !item.passed);
  return `# 第十九批装备技能独立审查

结论：**REVISE**。候选与来源冻结哈希一致，Cursor 已在隔离副本完成真实只读审查；业务写入前需要处理下列范围边界和参数问题。

候选 SHA256：\`${data.candidateSha256}\` ；来源 SHA256：\`${data.sourceFreezeSha256}\` ；只读 GET SHA256：\`${data.currentGETSha256}\`。

## Cursor 运行证据

- runId：\`${data.cursor.runId}\`；requestId：\`${data.cursor.requestId}\`；agentId：\`${data.cursor.agentId}\`。
- SDK、模型与参数：\`${data.cursor.runtime}\`、\`${data.cursor.model.id}\`、effort=high、fast=false；实际工具事件 ${data.cursor.toolCallEvents}，已完成工具 ${data.cursor.completedTools}，失败 ${data.cursor.failedTools}。
- 工具：${data.cursor.tools.join('、')}；设置来源为 project；允许读取副本中的“参考资料”。
- 审计：范围外写入 0，运行差异 0，隔离副本 Git 前后干净，diff.patch 为 0 字节。审计是受记录的写入范围核对，不等同操作系统隔离。
- 原始证据：\`${data.cursor.rawFiles.summary.path}\`、\`${data.cursor.rawFiles.events.path}\`、\`${data.cursor.rawFiles.diff.path}\`。

## 必须修订

${blockerLines.join('\n')}

其中 6664 的来源同时给出 \`Range=325\`、\`AuraDuration=3\`、\`TicksPerSecond=1\`，候选只录了触发脉冲半径 350/500；350/500 不能代替“附近敌人”的光环资格半径。11 条公式的计算树保持正确，最小修订是补参数，不要改公式或凭它新增周期过程。

3222 和 3107 的共同边界问题是：来源证明了友方目标文字，却没有证明施法者必不在目标集合中。缺少 SelfAoe 或目标枚举证据不能直接写成范围外；应改为目标归属待补证，保留数值来源但不默认创建治疗效果。3190 的 SelfAoe 说明几何原点，8193 位义没有同版枚举旁证；保留护盾端点和运行时护盾值，同时收窄说明，并把未知求值的护盾输入改为 DECIMAL。

## 数值与负例

- 独立按候选表达式重新求值 ${arithmeticPassed}/${data.arithmeticCases.length} 个算例：包括 3074、3748 两种攻击距离、6698、3107 真实伤害、6664 每次/每秒/英雄触发三棵树和 8020 增幅。
- 负例 ${negativePassed}/${data.negativeCases.length} 个通过：范围外不满足、6664 脉冲半径不冒充光环、缺运行时输入不补零、3222 无 SelfAoe 不推出第三方专属。
- 3748 的两个 mStat=12 具名旧节点满足外部最大生命窄补证的形状；当前 RUNTIME_INPUT 是安全保守值，可由主负责人另行决定是否按该窄条件回补。该证据不扩展到匿名节点、mStat29、CURRENT/BONUS 或其他节点类。

## 写前保护与边界

- 只读 GET 记录 198 件装备、108 件已挂载、110 条去重关系、329 次 GET、业务写入 0；十件目标装备关系为 0，目标技能 GET 为 404。
- 该 GET 文件的装备主体只有基础字段，没有直接属性或代表图数组；候选 safeguards 中的保护声明不能替代单独 GET。主负责人写入前应另留直接属性、原图和现有挂载快照。
- 3222、3085、3504 的来源均已核对。3085 的“2个额外敌人”和 3504 的“两名友方”有明确第三方/多目标边界；3222 目前只能判定目标归属未证，不能与它们同类排除。

## 限制

${data.caveat}
${failedChecks.length ? `\n检查器自身失败：${failedChecks.map((item) => item.name).join('、')}。` : ''}
`;
}

await writeFile(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await writeFile(outputMdPath, markdown(report), 'utf8');

console.log(JSON.stringify({
  verdict: report.verdict,
  candidateSha256: report.candidateSha256,
  sourceFreezeSha256: report.sourceFreezeSha256,
  blockers: report.blockers.map((item) => item.id),
  arithmetic: `${arithmeticPassed(report.arithmeticCases)}/${report.arithmeticCases.length}`,
  negatives: `${report.negativeCases.filter((item) => item.passed).length}/${report.negativeCases.length}`,
  checkerFailures: report.checkerFailures,
  outputJsonPath,
  outputMdPath,
}, null, 2));

function arithmeticPassed(cases) {
  return cases.filter((item) => item.passed).length;
}

if (failures.length > 0) process.exitCode = 1;
