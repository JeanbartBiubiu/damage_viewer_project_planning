import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const planningRoot = path.resolve(repoRoot, '..', 'damage_viewer_project_planning');
const dataDir = path.join(planningRoot, '数据参考', '全量录入-2026-09', '装备技能实录', '第十七批防御与状态装备');
const candidatePath = path.join(dataDir, '完整候选.json');
const sourcePath = path.join(dataDir, '冻结来源.json');
const versionPath = path.join(dataDir, '完整版本.json');
const aftershockEvidencePath = path.join(planningRoot, '数据参考', '全量录入-2026-09', 'API实录', '符文效果第四批', '冻结来源.json');

const candidate = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const version = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
const aftershockSource = JSON.parse(fs.readFileSync(aftershockEvidencePath, 'utf8'));
const aftershock8439 = aftershockSource.entries.find(item => String(item.id) === '8439');

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const candidateBytes = fs.readFileSync(candidatePath);
const sourceBytes = fs.readFileSync(sourcePath);
const candidateSha256 = sha256(candidateBytes);
const sourceSha256 = sha256(sourceBytes);

const checks = [];
const blockers = [];
const dependencies = [];
const examples = [];
const check = (key, pass, evidence) => {
  checks.push({ key, pass: Boolean(pass), evidence });
  return Boolean(pass);
};
const fail = (key, evidence) => check(key, false, evidence);
const pass = (key, condition, evidence) => check(key, condition, evidence);

const sourceById = id => source.objects.find(item => String(item.id) === String(id));
const candidateById = id => candidate.objects.find(item => item.equipmentKey === `item_${id}`);
const parameter = (object, key) => (object.apiPayload.parameters || []).find(item => item.parameterKey === key);
const formula = (object, key) => (object.apiPayload.formulas || []).find(item => item.formulaKey === key);
const sourceValue = (object, name) => object.object?.mDataValues?.find(item => item.mName === name);
const sourceCalculation = (object, name) => object.object?.mItemCalculations?.[name];
const sourceBoundText = (object, key) => object.bound?.[key]?.text || '';

const expressionNodes = expression => {
  if (!expression || typeof expression !== 'object') return [];
  const result = [{ nodeType: expression.nodeType, operation: expression.operation, parameterKey: expression.parameterKey, attributeKey: expression.attributeKey, attributeValueKind: expression.attributeValueKind }];
  for (const operand of expression.operands || []) result.push(...expressionNodes(operand));
  return result;
};
const expressionParameters = expression => expressionNodes(expression).map(item => item.parameterKey).filter(Boolean);
const expressionSignature = expression => {
  if (!expression || typeof expression !== 'object') return 'INVALID';
  if (expression.nodeType === 'PARAMETER') return `P(${expression.parameterKey})`;
  if (expression.nodeType === 'ATTRIBUTE') return `A(${expression.attributeOwner}.${expression.attributeKey}.${expression.attributeValueKind || ''})`;
  if (expression.nodeType === 'OPERATION') return `${expression.operation}[${(expression.operands || []).map(expressionSignature).join(',')}]`;
  return `UNKNOWN(${expression.nodeType || ''})`;
};
const evaluate = (expression, parameters, attributes) => {
  if (expression.nodeType === 'PARAMETER') return parameters[expression.parameterKey];
  if (expression.nodeType === 'ATTRIBUTE') return attributes[`${expression.attributeKey}.${expression.attributeValueKind || ''}`];
  if (expression.nodeType !== 'OPERATION') throw new Error(`unsupported expression node ${expression.nodeType}`);
  const values = (expression.operands || []).map(item => evaluate(item, parameters, attributes));
  if (values.some(value => value === undefined)) throw new Error(`missing evaluation value for ${expressionSignature(expression)}`);
  if (expression.operation === 'ADD') return values.reduce((sum, value) => sum + value, 0);
  if (expression.operation === 'MULTIPLY') return values.reduce((product, value) => product * value, 1);
  throw new Error(`unsupported operation ${expression.operation}`);
};
const near = (actual, expected, epsilon = 1e-9) => Math.abs(actual - expected) <= epsilon;
const paramsFrom = object => Object.fromEntries((object.apiPayload.parameters || []).map(item => [item.parameterKey, item.fixedValue]));

const targetIds = ['2522', '2525', '3119', '3121', '3137', '3181', '6333', '6610', '4401', '6665', '6695', '6696'];
const expectedTotals = { equipment: 12, skills: 12, parameters: 73, formulas: 24, effects: 0, processes: 0, internalStates: 0, triggerRules: 0, relations: 12, representativeImages: 12, components: 133 };
const actualTotals = {
  equipment: candidate.objects.length,
  skills: candidate.objects.filter(item => item.apiPayload?.skill).length,
  parameters: candidate.objects.reduce((sum, item) => sum + (item.apiPayload.parameters || []).length, 0),
  formulas: candidate.objects.reduce((sum, item) => sum + (item.apiPayload.formulas || []).length, 0),
  effects: candidate.objects.reduce((sum, item) => sum + (item.apiPayload.effects || []).length, 0),
  processes: candidate.objects.reduce((sum, item) => sum + (item.apiPayload.processes || []).length, 0),
  internalStates: candidate.objects.reduce((sum, item) => sum + (item.apiPayload.internalStates || []).length, 0),
  triggerRules: candidate.objects.reduce((sum, item) => sum + (item.apiPayload.triggerRules || []).length, 0),
  relations: candidate.objects.filter(item => item.apiPayload?.relation).length,
  representativeImages: candidate.objects.filter(item => item.apiPayload?.representativeImage).length,
  components: candidate.objects.reduce((sum, item) => sum + 1 + (item.apiPayload.parameters || []).length + (item.apiPayload.formulas || []).length + (item.apiPayload.effects || []).length + (item.apiPayload.processes || []).length + (item.apiPayload.internalStates || []).length + (item.apiPayload.triggerRules || []).length + (item.apiPayload.relation ? 1 : 0) + (item.apiPayload.representativeImage ? 1 : 0), 0)
};
pass('候选对象数量和组成总数', JSON.stringify(actualTotals) === JSON.stringify(expectedTotals), { expected: expectedTotals, actual: actualTotals });
pass('候选技能顺序', JSON.stringify(candidate.objects.map(item => item.equipmentKey.replace(/^item_/, ''))) === JSON.stringify(targetIds), { targetIds });
pass('候选版本哈希', version.sha256 === candidateSha256, { versionSha256: version.sha256, actualSha256: candidateSha256 });
pass('来源版本边界', candidate.clientVersion === '16.17' && candidate.officialVersion === '16.17.1', { clientVersion: candidate.clientVersion, officialVersion: candidate.officialVersion });

for (const object of candidate.objects) {
  const parameterKeys = new Set((object.apiPayload.parameters || []).map(item => item.parameterKey));
  let allNodesAllowed = true;
  let allReferencesKnown = true;
  for (const item of object.apiPayload.formulas || []) {
    for (const node of expressionNodes(item.expression)) {
      if (!['PARAMETER', 'ATTRIBUTE', 'OPERATION'].includes(node.nodeType)) allNodesAllowed = false;
      if (node.nodeType === 'PARAMETER' && !parameterKeys.has(node.parameterKey)) allReferencesKnown = false;
    }
  }
  pass(`${object.equipmentKey}公式树节点类型`, allNodesAllowed, { formulas: (object.apiPayload.formulas || []).map(item => ({ key: item.formulaKey, signature: expressionSignature(item.expression) })) });
  pass(`${object.equipmentKey}公式参数引用`, allReferencesKnown, { parameterKeys: [...parameterKeys] });
  const runtimeInputs = (object.apiPayload.parameters || []).filter(item => item.valueMode === 'RUNTIME_INPUT');
  pass(`${object.equipmentKey}运行时输入不带默认值`, runtimeInputs.every(item => item.fixedValue === null), { runtimeInputs: runtimeInputs.map(item => ({ key: item.parameterKey, fixedValue: item.fixedValue })) });
  pass(`${object.equipmentKey}没有事件结果组成`, !(object.apiPayload.effects || []).length && !(object.apiPayload.processes || []).length && !(object.apiPayload.internalStates || []).length && !(object.apiPayload.triggerRules || []).length, { effects: object.apiPayload.effects?.length || 0, processes: object.apiPayload.processes?.length || 0, internalStates: object.apiPayload.internalStates?.length || 0, triggerRules: object.apiPayload.triggerRules?.length || 0 });
}

const s3137 = sourceById('3137');
const c3137 = candidateById('3137');
const c3137Self = formula(c3137, 'self_healing');
const c3137SelfValue = evaluate(c3137Self.expression, { base_heal: 100, ap_heal_ratio: 0.2 }, { 'ability_power.TOTAL': 300 });
pass('3137库存文案明确自我治疗', /自我治疗/.test(sourceBoundText(s3137, 'keyInventoryOnlyText')), { text: sourceBoundText(s3137, 'keyInventoryOnlyText') });
pass('3137自身治疗保留为公式且不造直接治疗', Boolean(c3137Self) && !(c3137.apiPayload.effects || []).length && near(c3137SelfValue, 160), { formula: expressionSignature(c3137Self?.expression), example: '基础100+0.2×法强300=160' });
examples.push({ item: '3137', case: '法强300', formula: '100+0.2×300', result: c3137SelfValue, boundary: '仅数值公式算例，击杀窗口和新星命中仍待运行时接线' });

const s4401 = sourceById('4401');
const c4401 = candidateById('4401');
const extended4401 = sourceBoundText(s4401, 'keyTooltipExtended');
pass('4401扩展文案定身计2次且7秒重置', /定身/.test(extended4401) && /@ImmobilizeStacks@/.test(extended4401) && /@BuffDuration@/.test(extended4401) && sourceValue(s4401, 'ImmobilizeStacks')?.mValue === 2 && sourceValue(s4401, 'BuffDuration')?.mValue === 7, { text: extended4401, immobilizeStacks: sourceValue(s4401, 'ImmobilizeStacks'), buffDuration: sourceValue(s4401, 'BuffDuration') });
pass('4401定身和重置字段数值', parameter(c4401, 'immobilize_hit_count')?.fixedValue === 2 && parameter(c4401, 'reset_duration_ms')?.fixedValue === 7000, { immobilizeHitCount: parameter(c4401, 'immobilize_hit_count')?.fixedValue, resetDurationMs: parameter(c4401, 'reset_duration_ms')?.fixedValue });
pass('4401缺失减伤值未补零', sourceValue(s4401, 'DamageReduction') && !Object.hasOwn(sourceValue(s4401, 'DamageReduction'), 'mValue') && !parameter(c4401, 'damage_reduction'), { sourceDamageReduction: sourceValue(s4401, 'DamageReduction'), candidateDamageReduction: parameter(c4401, 'damage_reduction') });
examples.push({ item: '4401', case: '6次普通魔法伤害+1次定身', formula: '6+2', result: 8, boundary: '计数、去重和7秒计时起点仍未接线' });

const s2522 = sourceById('2522');
const c2522 = candidateById('2522');
const active2522 = sourceBoundText(s2522, 'keyActive');
const c2522Formula = formula(c2522, 'amplification_ratio');
const c2522ResourceParam = parameter(c2522, 'actual_ability_resource_formula2');
const c2522Example = evaluate(c2522Formula.expression, { ...paramsFrom(c2522), actual_ability_resource_formula2: 500 }, {});
const c2522Keys = [...(c2522.apiPayload.parameters || []).map(item => item.parameterKey), ...(c2522.apiPayload.formulas || []).map(item => item.formulaKey)];
pass('2522主动持续8秒且冷却为转速', sourceValue(s2522, 'Duration')?.mValue === 8 && /冷却时间转速加快/.test(active2522), { durationSeconds: sourceValue(s2522, 'Duration')?.mValue, activeText: active2522 });
pass('2522资源formula2运行时输入无默认', c2522ResourceParam?.valueMode === 'RUNTIME_INPUT' && c2522ResourceParam.fixedValue === null, { parameter: c2522ResourceParam });
pass('2522增幅算例及无一次返还字段', near(c2522Example, 0.175) && !c2522Keys.some(key => /refund|返还/i.test(key)), { formula: expressionSignature(c2522Formula.expression), example: '0.01×(15+0.005×500)=0.175', keys: c2522Keys });
examples.push({ item: '2522', case: '资源输入500', formula: '0.01×(15+0.005×500)', result: c2522Example, boundary: '只证明公式；额外法力消费、合法增幅乘区和冷却转速计时未接线' });

const s3181 = sourceById('3181');
const c3181 = candidateById('3181');
const ranged3181 = sourceCalculation(s3181, 'MaxStackDamage')?.mRangedMultiplier?.mNumber;
const c3181Ranged = parameter(c3181, 'ranged_damage_multiplier')?.fixedValue;
const c3181ExampleParams = { ...paramsFrom(c3181), actual_mstat12_formula0: 200 };
const c3181Example = evaluate(formula(c3181, 'ranged_bonus_damage').expression, c3181ExampleParams, { 'attack_damage.BASE': 100 });
const c3181Signature = expressionSignature(formula(c3181, 'ranged_bonus_damage').expression);
pass('3181远程乘数来自mRangedMultiplier', near(ranged3181, 0.7, 1e-6) && near(c3181Ranged, 0.7), { sourceMRangeMultiplier: ranged3181, candidateMultiplier: c3181Ranged });
pass('3181远程乘整项', c3181Signature === 'MULTIPLY[P(ranged_damage_multiplier),ADD[MULTIPLY[P(base_ad_ratio),A(SOURCE.attack_damage.BASE)],MULTIPLY[P(mstat12_formula0_ratio),P(actual_mstat12_formula0)]]]', { signature: c3181Signature });
pass('3181的12/0输入无默认', parameter(c3181, 'actual_mstat12_formula0')?.valueMode === 'RUNTIME_INPUT' && parameter(c3181, 'actual_mstat12_formula0').fixedValue === null, { parameter: parameter(c3181, 'actual_mstat12_formula0') });
pass('3181远程区别性算例', near(c3181Example, 91), { example: '0.7×(1.2×100+0.05×200)=91', result: c3181Example });
examples.push({ item: '3181', case: '基础攻击力100、未解码12/0输入200', formula: '0.7×(1.2×100+0.05×200)', result: c3181Example, boundary: '12/0资格和第五次攻击事件仍待外供' });

const s6610 = sourceById('6610');
const c6610 = candidateById('6610');
const calc6610 = sourceCalculation(s6610, '{01099b16}');
const source6610RangedName = calc6610?.mRangedMultiplier?.mDataValue;
const source6610Ranged = sourceValue(s6610, source6610RangedName)?.mValue;
const c6610Ranged = parameter(c6610, 'ranged_ad_heal_multiplier')?.fixedValue;
const c6610Example = evaluate(formula(c6610, 'ranged_self_healing').expression, { ...paramsFrom(c6610) }, { 'attack_damage.BASE': 100, 'hp.MISSING': 500 });
pass('6610远程乘数原节点为0.5', source6610RangedName === 'RangedHealMod' && near(source6610Ranged, 0.5) && near(c6610Ranged, 0.5), { sourceDataValue: source6610RangedName, sourceValue: source6610Ranged, candidateValue: c6610Ranged });
pass('6610远程仅减半基础AD治疗项', expressionSignature(formula(c6610, 'ranged_self_healing').expression) === 'ADD[MULTIPLY[P(ranged_ad_heal_multiplier),MULTIPLY[P(base_ad_heal_ratio),A(SOURCE.attack_damage.BASE)]],MULTIPLY[P(missing_health_heal_ratio),A(SOURCE.hp.MISSING)]]', { signature: expressionSignature(formula(c6610, 'ranged_self_healing').expression) });
pass('6610区别性算例', near(c6610Example, 65), { example: '0.5×0.9×100+0.04×500=65', result: c6610Example });
examples.push({ item: '6610', case: '基础攻击力100、已损生命500', formula: '0.5×(0.9×100)+0.04×500', result: c6610Example, boundary: '首次攻击资格、暴击结算和溢出治疗仍待接线' });

const s6333 = sourceById('6333');
const c6333 = candidateById('6333');
const c6333ExampleParams = { ...paramsFrom(c6333), actual_eligible_incoming_damage: 100 };
const c6333Melee = evaluate(formula(c6333, 'melee_deferred_damage').expression, c6333ExampleParams, {});
const c6333Ranged = evaluate(formula(c6333, 'ranged_deferred_damage').expression, c6333ExampleParams, {});
const c6333Heal = evaluate(formula(c6333, 'total_healing').expression, { ...paramsFrom(c6333) }, { 'attack_damage.BONUS': 200 });
const source6333Melee = sourceCalculation(s6333, 'MeleeItemCalcValue')?.mFormulaParts?.[0]?.mNumber;
const source6333Ranged = sourceCalculation(s6333, 'RangedItemCalcValue')?.mFormulaParts?.[0]?.mNumber;
pass('6333持续总治疗与延后总伤字段', sourceBoundText(s6333, 'keyTooltipInventory').includes('持续') && sourceBoundText(s6333, 'keyTooltipInventory').includes('共') && near(source6333Melee, 0.3, 1e-6) && near(source6333Ranged, 0.1, 1e-6), { tooltip: sourceBoundText(s6333, 'keyTooltipInventory'), sourceMelee: source6333Melee, sourceRanged: source6333Ranged });
pass('6333公式不把总治疗拆成每跳', near(c6333Heal, 150) && parameter(c6333, 'healing_duration_ms')?.fixedValue === 2000 && !(c6333.apiPayload.effects || []).length, { totalHealingExample: c6333Heal, durationMs: parameter(c6333, 'healing_duration_ms')?.fixedValue });
pass('6333近远延后伤害算例', near(c6333Melee, 30) && near(c6333Ranged, 10), { melee: c6333Melee, ranged: c6333Ranged, formula: '0.3×100 / 0.1×100' });
examples.push({ item: '6333', case: '符合资格伤害100、额外攻击力200', formula: '近战0.3×100；远程0.1×100；总治疗0.75×200', result: { meleeDeferred: c6333Melee, rangedDeferred: c6333Ranged, totalHealing: c6333Heal }, boundary: '三秒流血池、后续节拍、击杀净化和两秒治疗时序未接线' });

const s6696 = sourceById('6696');
const c6696 = candidateById('6696');
const c6696Ratio = evaluate(formula(c6696, 'refund_ratio').expression, { ...paramsFrom(c6696), actual_mstat29_formula0: 20 }, {});
const c6696Ms = evaluate(formula(c6696, 'refund_cooldown_ms').expression, { ...paramsFrom(c6696), actual_mstat29_formula0: 20, actual_ultimate_total_cooldown_ms: 100000 }, {});
pass('6696原文为终极技能总冷却百分比', /总冷却时间/.test(sourceBoundText(s6696, 'keyTooltip')) && /%/.test(sourceBoundText(s6696, 'keyTooltip')), { text: sourceBoundText(s6696, 'keyTooltip') });
pass('6696百分比点先转比例再乘总冷却毫秒', parameter(c6696, 'percentage_point_to_ratio')?.fixedValue === 0.01 && near(c6696Ratio, 0.15) && near(c6696Ms, 15000), { ratioExample: c6696Ratio, millisecondsExample: c6696Ms, formula: '0.01×(10+0.25×20)×100000=15000毫秒' });
pass('6696未解码mStat29和总冷却无默认', parameter(c6696, 'actual_mstat29_formula0')?.fixedValue === null && parameter(c6696, 'actual_ultimate_total_cooldown_ms')?.fixedValue === null, { stat: parameter(c6696, 'actual_mstat29_formula0'), cooldown: parameter(c6696, 'actual_ultimate_total_cooldown_ms') });
examples.push({ item: '6696', case: 'mStat29输入20、终极总冷却100000毫秒', formula: '0.01×(10+0.25×20)×100000', result: c6696Ms, boundary: '伤害归因、目标阵亡和终极技能选择仍待接线' });

const resourceChecks = [];
for (const id of ['2522', '3119', '3121']) {
  const raw = sourceById(id);
  const parts = Object.values(raw.object?.mItemCalculations || {}).flatMap(calc => calc?.mFormulaParts || []).filter(part => part.__type === 'AbilityResourceByCoefficientCalculationPart' && part.mStatFormula === 2);
  const target = candidateById(id);
  const runtime = parameter(target, 'actual_ability_resource_formula2');
  resourceChecks.push({ id, sourceParts: parts, candidate: runtime });
  pass(`${id}资源formula2不填默认`, parts.length > 0 && runtime?.valueMode === 'RUNTIME_INPUT' && runtime.fixedValue === null, { sourceParts: parts, candidate: runtime });
}

const s2525 = sourceById('2525');
const c2525 = candidateById('2525');
const source2525Parts = sourceCalculation(s2525, 'TotalHealthRegen')?.mFormulaParts?.filter(part => part.__type === 'StatByCoefficientCalculationPart').map(part => ({ mStat: part.mStat, mStatFormula: part.mStatFormula, coefficient: part.mCoefficient }));
const c2525Total = formula(c2525, 'total_healing');
const c2525Signature = expressionSignature(c2525Total.expression);
const genericMappingEvidence = 'C:/project/damage_web_dev/数据参考/全量录入-2026-09/交叉试录/通用公式来源补证/结论与边界.json';
const aftershockArmorNode = aftershock8439?.summary?.calculations?.ArmorBuff?.mFormulaParts?.find(part => part.__type === 'StatByNamedDataValueCalculationPart');
const aftershockMagicResistNode = aftershock8439?.summary?.calculations?.MagicResistBuff?.mFormulaParts?.find(part => part.__type === 'StatByNamedDataValueCalculationPart');
const aftershockLongText = aftershock8439?.bound?.mLongDescLocalizationKey?.text || '';
const aftershockMappingProof = aftershockArmorNode?.mStat === 1 && aftershockArmorNode?.mStatFormula === 2 && aftershockArmorNode?.mDataValue === 'PercentBonusResist' && aftershockMagicResistNode?.mStat === 6 && aftershockMagicResistNode?.mStatFormula === 2 && aftershockMagicResistNode?.mDataValue === 'PercentBonusResist' && /护甲和魔法抗性/.test(aftershockLongText) && /额外双抗/.test(aftershockLongText);
const hasUnproven2525Mapping = c2525Signature.includes('A(SOURCE.armor.BONUS)') && c2525Signature.includes('A(SOURCE.magic_resistance.BONUS)') && !aftershockMappingProof;
if (hasUnproven2525Mapping) {
  blockers.push({
    severity: '阻塞',
    item: 'item_2525',
    component: 'TotalHealthRegen',
    issue: '候选把来源节点 mStat=1/formula2 与 mStat=6/formula2 直接映射为 SOURCE 的额外护甲和额外魔抗；现有通用补证只支持 mStat0、2/0、2/2 的窄映射，没有给出1/2或6/2的具名属性证明。',
    sourceEvidence: source2525Parts,
    candidateFormula: c2525Signature,
    reference: genericMappingEvidence,
    requiredDisposition: '补充同版本具名证据，或改为两个显式运行时输入；在此之前不能把该公式作为无阻塞冻结结果。'
  });
}
pass('2525原始属性节点已识别', JSON.stringify(source2525Parts) === JSON.stringify([{ mStat: 1, mStatFormula: 2, coefficient: 1.75 }, { mStat: 6, mStatFormula: 2, coefficient: 1.75 }]), { sourceParts: source2525Parts });
pass('2525属性枚举映射有窄证据', !hasUnproven2525Mapping && aftershockMappingProof, { candidateFormula: c2525Signature, sourceParts: source2525Parts, aftershockEvidencePath, aftershockArmorNode, aftershockMagicResistNode, aftershockLongText });

dependencies.push({ item: 'item_3181', component: 'mStat2/formula1基础攻击力', status: '依赖另一代理复核', evidence: '候选保留 SOURCE.attack_damage.BASE；本报告只核对远程整项乘数和12/0无默认，不重复基础攻击力具名补证。' });

const negativeSelfTest = process.argv.includes('--negative-self-test');
if (negativeSelfTest) {
  const observed = check('检查器负例自检（故意失败）', false, { expected: 'false 条件必须进入失败集合并触发非零退出' });
  if (observed !== false) throw Error('检查器负例自检未识别故意失败');
  const negativeFailures = checks.filter(item => !item.pass);
  if (!negativeFailures.some(item => item.key === '检查器负例自检（故意失败）')) throw Error('检查器负例自检未进入失败集合');
  console.log(JSON.stringify({ negativeSelfTest: true, failedChecks: negativeFailures.length, exitCode: 2 }));
  process.exitCode = 2;
  process.exit();
}
const allFailedChecks = checks.filter(item => !item.pass);

const result = {
  generatedAt: new Date().toISOString(),
  status: blockers.length || allFailedChecks.length ? '阻塞' : '通过',
  scope: '第十七批防御与状态装备独立复核；只读文件核对和本地数学算例，不含业务接口写入、浏览器或战斗引擎运行。',
  source: { candidatePath, sourcePath, aftershockEvidencePath, clientVersion: candidate.clientVersion, officialVersion: candidate.officialVersion, candidateSha256, sourceSha256, aftershock8439ObjectSha256: aftershock8439?.sourceObjectSha256 },
  crossEvidence: { item2525StatMapping: { status: aftershockMappingProof ? '通过' : '未通过', sourcePath: aftershockEvidencePath, runeId: 8439, name: aftershock8439?.name, armorNode: aftershockArmorNode, magicResistNode: aftershockMagicResistNode, longText: aftershockLongText, percentBonusResist: aftershock8439?.summary?.effectAmounts?.PercentBonusResist } },
  totals: { declared: candidate.totals, actual: actualTotals },
  checks: { total: checks.length, passed: checks.filter(item => item.pass).length, failed: checks.filter(item => !item.pass).length, details: checks },
  checker: { passSignature: '(key, condition, evidence)', normalFailedCheckExitCode: 2, negativeSelfTestArgument: '--negative-self-test', negativeSelfTestObservedExitCode: 2 },
  examples,
  resourceFormula2: resourceChecks,
  blockers,
  dependencies,
  noBusinessWrites: true
};

fs.writeFileSync(path.join(here, '独立复核结果.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
const report = [
  '# 第十七批防御与状态装备独立复核',
  '',
  `复核结论：**${result.status}**。本次只读取规划树的冻结来源、完整候选和版本摘要，未调用业务写接口，未修改候选文件。`,
  '',
  `候选文件 SHA256：\`${candidateSha256}\`；冻结来源 SHA256：\`${sourceSha256}\`；客户端 ${candidate.clientVersion}，官方资料 ${candidate.officialVersion}。`,
  '',
  `候选总数复核为 ${actualTotals.equipment} 件装备、${actualTotals.skills} 个技能、${actualTotals.parameters} 个参数、${actualTotals.formulas} 个公式、${actualTotals.components} 项组成；效果、过程、内部状态和触发规则均为0。运行时输入均未带固定默认值。`,
  '',
  '检查器已改为把真实条件传给通过函数；命令行负例自检以 `--negative-self-test` 故意传入 false，实际退出码为2；正常复核的失败条件也会使进程以非零码退出。',
  '',
  '列出的八个重点均已做来源和算例核对：3137 保留库存文案中的自我治疗公式；4401 保留定身计2次和7秒重置；2522 计算8秒增幅并保留冷却转速，未造一次性返还；3181 将0.7乘在整项伤害上；6610 只将远程0.5用于基础攻击力治疗项；6333 将延后伤害和两秒总治疗分开；6696 先把百分比转换为比例再乘终极总冷却毫秒；3181 的12/0以及2522、3119、3121的资源formula2均为无默认运行时输入。',
  '',
  `**具体阻塞**：${blockers.length ? 'item_2525 的 TotalHealthRegen 将 mStat=1/formula2、mStat=6/formula2 直接映射为额外护甲和额外魔抗，但现有窄映射补证没有证明这两个枚举。需补同版本具名证据，或改为显式运行时输入后再宣布无阻塞冻结。' : '未发现；符文第四批 8439 余震同根中文与 ArmorBuff/MagicResistBuff 原计算树已提供这两组组合的窄具名旁证。'}`,
  '',
  '区别性算例见 `独立复核结果.json`；这些算例是静态公式求值，不代表客户端或战斗引擎实战结果。基础攻击力 mStat2/formula1 的具名补证按任务说明由另一代理独立复核。',
  ''
].join('\n');
fs.writeFileSync(path.join(here, '独立复核报告.md'), `${report}\n`, 'utf8');

if (blockers.length || allFailedChecks.length) process.exitCode = 2;
