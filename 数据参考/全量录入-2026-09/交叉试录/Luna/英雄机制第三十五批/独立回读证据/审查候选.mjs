import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = 'C:/project/damage_web_dev';
const candidatePath = path.join(root, '.agents', 'artifacts', 'hero35-luna-candidate', '完整候选.json');
const planPath = path.join(root, '.agents', 'artifacts', 'hero35-luna-candidate', '写前请求计划.json');
const sourcePath = path.join(root, '.agents', 'artifacts', 'hero35-root-entry-20260910', '来源绑定与当前文本.json');
const sourceNotePath = path.join(root, '.agents', 'artifacts', 'hero35-root-entry-20260910', '主负责人源值核对说明.md');
const outputPath = path.join(root, '.agents', 'artifacts', 'hero35-independent-review', '候选审查.json');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const candidate = readJson(candidatePath);
const plan = readJson(planPath);
const source = readJson(sourcePath);
const sourceSkills = new Map(source.heroes.flatMap((hero) => hero.skills).map((skill) => [skill.skillKey, skill]));
const skill = (key) => candidate.skills[key];
const write = (key) => skill(key).write;
const parameter = (key, parameterKey) => write(key).parameters.find((item) => item.parameterKey === parameterKey);
const formula = (key, formulaKey) => write(key).formulas.find((item) => item.formulaKey === formulaKey);
const rawSkill = (key) => sourceSkills.get(key).object.mSpell;
const rawData = (key, name) => rawSkill(key).DataValues?.find((item) => item.name === name)?.values;
const rawCalculation = (key, name) => rawSkill(key).mSpellCalculations?.[name];
const same = (a, b, tolerance = 1e-5) => typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= tolerance : a === b;
const candidateValues = (item) => item.valueMode === 'FIXED' ? [item.fixedValue] : Object.keys(item.levelValues ?? {}).sort((a, b) => Number(a) - Number(b)).map((key) => item.levelValues[key]);
const sourceRanks = (key, name, count, scale = 1, start = 1) => (rawData(key, name) ?? []).slice(start, start + count).map((value) => value * scale);

const results = [];
const check = (id, pass, expected, actual, evidence) => {
  results.push({ id, pass, expected, actual, evidence });
  return pass;
};

function walk(node, callback, pointer = '$') {
  if (!node || typeof node !== 'object') return;
  callback(node, pointer);
  for (const [key, value] of Object.entries(node)) {
    if (value && typeof value === 'object') walk(value, callback, `${pointer}.${key}`);
  }
}

function parameterRefs(node) {
  const refs = [];
  walk(node, (value) => {
    if (value.nodeType === 'PARAMETER') refs.push(value.parameterKey);
  });
  return refs;
}

function attributeNodes(node) {
  const attrs = [];
  walk(node, (value) => {
    if (value.nodeType === 'ATTRIBUTE') attrs.push(value);
  });
  return attrs;
}

function formulaIsBinary(node) {
  let pass = true;
  walk(node, (value) => {
    if (value.nodeType === 'OPERATION' && (!Array.isArray(value.operands) || value.operands.length !== 2)) pass = false;
  });
  return pass;
}

check('candidate_sha256', sha256(candidatePath) === '9e9d4c15a0e9419e303f6d1c029256fab2102c814ef602bd99831f5d44f54632', '9e9d4c15a0e9419e303f6d1c029256fab2102c814ef602bd99831f5d44f54632', sha256(candidatePath), '候选实际文件字节');
check('plan_sha256', sha256(planPath) === 'f9df7485f64d76a8b98b31495f3729fa70390070462f2e550a74410f71771502', 'f9df7485f64d76a8b98b31495f3729fa70390070462f2e550a74410f71771502', sha256(planPath), '写前请求计划实际文件字节');
check('source_index_sha256', candidate.meta.sourceIndexSha256 === '2fbc14396fcc4e75b8755bb51da5a039ed8bd5ed7780e6140d3ac35ecdb5fba8' && source.sourceIndexSha256 === candidate.meta.sourceIndexSha256, candidate.meta.sourceIndexSha256, source.sourceIndexSha256, '候选绑定的来源索引与来源绑定文件记录');
check('counts', JSON.stringify(candidate.counts) === JSON.stringify({ newParameters: 136, newFormulas: 32, newEffects: 2, newProcesses: 0, newInternalStates: 0, newTriggerRules: 0, newTotal: 170, reusedPublicParameters: 28, plannedTotalIncludingReused: 198, protectedCurrentCompositionLists: 120 }), { parameters: 136, formulas: 32, effects: 2, total: 170, reused: 28, planned: 198 }, candidate.counts, '候选计数');
check('plan_count', plan.requestCount === 170 && JSON.stringify(plan.requestCounts) === JSON.stringify({ parameters: 136, formulas: 32, effects: 2, processes: 0, internalStates: 0, triggerRules: 0 }), { total: 170, parameters: 136, formulas: 32, effects: 2 }, { total: plan.requestCount, counts: plan.requestCounts }, '请求计划计数');
check('no_business_write_claim', candidate.meta.businessWrites === 0 && candidate.meta.apiCalls === 0 && candidate.meta.tokenStored === false && (candidate.apiWrites === false || candidate.apiWrites === 0), true, { businessWrites: candidate.meta.businessWrites, apiCalls: candidate.meta.apiCalls, tokenStored: candidate.meta.tokenStored, apiWrites: candidate.apiWrites }, '候选元数据仅静态生成');

let binaryPass = true;
let missingRefPass = true;
let millisecondsPass = true;
let effectNullablePass = true;
for (const [skillKey, value] of Object.entries(candidate.skills)) {
  const params = new Map((value.write.parameters ?? []).map((item) => [item.parameterKey, item]));
  for (const item of value.write.parameters ?? []) {
    if (item.parameterKey.endsWith('_ms')) {
      const values = candidateValues(item);
      if (item.valueType !== 'INTEGER' || values.some((number) => !Number.isInteger(number) || number < 0)) millisecondsPass = false;
    }
  }
  for (const item of value.write.formulas ?? []) {
    binaryPass &&= formulaIsBinary(item.expression);
    for (const ref of parameterRefs(item.expression)) if (!params.has(ref)) missingRefPass = false;
  }
  for (const item of value.write.effects ?? []) {
    const checkValue = (node) => {
      if (node?.kind === 'PARAMETER' && !params.has(node.parameterKey)) missingRefPass = false;
      if (node?.kind === 'FORMULA' && !(value.write.formulas ?? []).some((formulaItem) => formulaItem.formulaKey === node.formulaKey)) missingRefPass = false;
    };
    checkValue(item.lifecycle?.durationValue);
    checkValue(item.lifecycle?.maxStacksValue);
    checkValue(item.lifecycle?.applicationStacksValue);
    checkValue(item.lifecycle?.periodicIntervalValue);
    for (const result of item.results ?? []) {
      if (!Object.hasOwn(result, 'spellShieldBlockScope')) effectNullablePass = false;
      checkValue(result.valueRule?.value);
    }
  }
}
check('all_formula_operations_binary', binaryPass, true, binaryPass, '32条公式全部递归检查OPERATION的两个操作数');
check('formula_and_effect_refs', missingRefPass, true, missingRefPass, '公式和效果引用均在同一技能写入集合内');
check('milliseconds_are_integer', millisecondsPass, true, millisecondsPass, '所有参数键后缀为_ms的字段均为非负整数');
check('effect_nullable_fields', effectNullablePass, true, effectNullablePass, '两项效果的每个结果均显式保留spellShieldBlockScope:null');

const braumWArmor = rawCalculation('braum_w', 'GrantedBraumArmor')?.mFormulaParts?.[1];
const braumWMR = rawCalculation('braum_w', 'GrantedBraumMR')?.mFormulaParts?.[1];
const braumQMaxHp = rawCalculation('braum_q', 'TotalDamage')?.mFormulaParts?.[1];
const braumWArmorFormula = formula('braum_w', 'self_armor_bonus');
const braumWMRFormula = formula('braum_w', 'self_magic_resistance_bonus');
const braumQFormula = formula('braum_q', 'magic_damage');
check('braum_w_ratio', same(parameter('braum_w', 'self_resistance_ratio').fixedValue, rawData('braum_w', 'BraumArmorPercent')?.[1]), 0.36000001430511475, parameter('braum_w', 'self_resistance_ratio').fixedValue, 'BraumArmorPercent原始值与候选0.36');
check('braum_w_base_resists', JSON.stringify(candidateValues(parameter('braum_w', 'base_resistance'))) === JSON.stringify(sourceRanks('braum_w', 'BaseResists', 5)), sourceRanks('braum_w', 'BaseResists', 5), candidateValues(parameter('braum_w', 'base_resistance')), 'BaseResists技能等级索引1至5');
check('braum_w_tree_selectors', braumWArmor?.mStat === 1 && braumWArmor?.mStatFormula === 2 && braumWMR?.mStat === 6 && braumWMR?.mStatFormula === 2, { armor: { mStat: 1, mStatFormula: 2 }, mr: { mStat: 6, mStatFormula: 2 } }, { armor: braumWArmor, mr: braumWMR }, '当前GrantedBraumArmor/GrantedBraumMR原树');
const braumWArmorAttr = attributeNodes(braumWArmorFormula.expression)[0];
const braumWMRAttr = attributeNodes(braumWMRFormula.expression)[0];
const braumQAttr = attributeNodes(braumQFormula.expression)[0];
check('braum_q_max_hp_source_mapping', braumQMaxHp?.mStat === 12 && braumQAttr?.attributeOwner === 'SOURCE' && braumQAttr?.attributeKey === 'hp' && braumQAttr?.attributeValueKind === 'TOTAL', 'mStat12 -> SOURCE.hp.TOTAL', { sourceTree: braumQMaxHp, candidate: braumQAttr }, '布隆Q当前TotalDamage的最大生命项来自施法者最大生命；目标最大生命只用于命中目标类公式');
check('braum_w_mr_bonus_mapping', braumWMRAttr?.attributeKey === 'magic_resistance' && braumWMRAttr?.attributeValueKind === 'BONUS', 'SOURCE.magic_resistance.BONUS', braumWMRAttr, 'mStat6/mStatFormula2沿根说明可引用已有魔抗窄证');

check('braum_e_first_vs_later', parameter('braum_e', 'first_projectile_damage_ratio')?.fixedValue === 0 && JSON.stringify(candidateValues(parameter('braum_e', 'subsequent_damage_reduction_percent_points'))) === JSON.stringify(sourceRanks('braum_e', 'ShieldFacingDRAmount', 5)), { first: 0, later: [35, 40, 45, 50, 55] }, { first: parameter('braum_e', 'first_projectile_damage_ratio')?.fixedValue, later: candidateValues(parameter('braum_e', 'subsequent_damage_reduction_percent_points')) }, '首个弹体零伤害与后续百分数点减伤分别保存');
check('rell_w_single_slot_and_explicit_expiry', candidate.order.filter((key) => key === 'rell_w').length === 1 && write('rell_w').effects[0]?.lifecycle?.durationValue === null && write('rell_w').effects[0]?.lifecycle?.expiryMode === 'EXPLICIT_ONLY', true, { slots: candidate.order.filter((key) => key === 'rell_w').length, durationValue: write('rell_w').effects[0]?.lifecycle?.durationValue, expiryMode: write('rell_w').effects[0]?.lifecycle?.expiryMode }, 'RellW骑乘/披甲同槽，护盾只到再次上马');
check('rell_r_duration_total', parameter('rell_r', 'duration_seconds')?.fixedValue === rawData('rell_r', 'Duration')?.[1] && formula('rell_r', 'total_magic_damage')?.expression?.operation === 'MULTIPLY' && formula('rell_r', 'total_magic_damage')?.expression?.operands?.[1]?.parameterKey === 'duration_seconds', { seconds: 2, total: '每秒式×2' }, { seconds: parameter('rell_r', 'duration_seconds')?.fixedValue, expression: formula('rell_r', 'total_magic_damage')?.expression }, 'RellR总量按2秒乘每秒式，不拆每跳');

const reuseTaricQ = candidate.reusedPublicParameters.find((item) => item.skillKey === 'taric_q' && item.parameterKey === 'cast_interval_ms');
check('taric_q_cast_interval_reuse', reuseTaricQ?.post === false && parameter('taric_q', 'charge_interval_ms')?.fixedValue === 15000, true, { reused: reuseTaricQ, chargeInterval: parameter('taric_q', 'charge_interval_ms')?.fixedValue }, '已有cast_interval_ms=3000复用；15秒充能另存');
check('taric_q_one_percent_max_hp', same(parameter('taric_q', 'healing_hp_ratio')?.fixedValue, rawData('taric_q', 'HealingHPRatio')?.[1]) && parameterRefs(formula('taric_q', 'healing_per_charge').expression).includes('healing_hp_ratio'), true, { source: rawData('taric_q', 'HealingHPRatio')?.[1], candidate: parameter('taric_q', 'healing_hp_ratio')?.fixedValue }, '每层HealingHPRatio=0.01×来源最大生命');
const taricPCdr = formula('taric_p', 'basic_ability_cooldown_refund_seconds')?.expression;
check('taric_p_cdr_formula', taricPCdr?.operation === 'SUBTRACT' && taricPCdr.operands?.[0]?.parameterKey === 'cooldown_refund_base_seconds' && taricPCdr.operands?.[1]?.parameterKey === 'actual_cooldown_multiplier' && parameter('taric_p', 'cooldown_refund_base_seconds')?.fixedValue === 2 && parameter('taric_p', 'actual_cooldown_multiplier')?.valueMode === 'RUNTIME_INPUT', true, { expression: taricPCdr, base: parameter('taric_p', 'cooldown_refund_base_seconds'), actual: parameter('taric_p', 'actual_cooldown_multiplier') }, 'CDR保留2-实际冷却倍率');
check('taric_w_e_armor_stage_is_runtime', parameter('taric_w', 'actual_armor_stage')?.valueMode === 'RUNTIME_INPUT' && parameter('taric_e', 'actual_armor_stage')?.valueMode === 'RUNTIME_INPUT' && parameterRefs(formula('taric_w', 'self_armor_bonus').expression).includes('actual_armor_stage') && parameterRefs(formula('taric_e', 'magic_damage').expression).includes('actual_armor_stage'), true, { taricW: parameter('taric_w', 'actual_armor_stage'), taricE: parameter('taric_e', 'actual_armor_stage') }, 'mStat1/mStatFormula2阶段均无默认输入');

const tahmPData = rawData('tahmkench_p', 'APRatioPer100BonusHP');
const tahmPAttrs = [...parameterRefs(formula('tahmkench_p', 'ap_bonus_hp_magic_damage').expression), ...attributeNodes(formula('tahmkench_p', 'ap_bonus_hp_magic_damage').expression).map((item) => `${item.attributeKey}:${item.attributeValueKind}`)];
check('tahm_p_double_ratio', same(parameter('tahmkench_p', 'ap_ratio_per_100_bonus_hp')?.fixedValue, tahmPData?.[1]) && parameter('tahmkench_p', 'percent_to_ratio')?.fixedValue === 0.01 && tahmPAttrs.includes('hp:BONUS'), { coefficient: tahmPData?.[1], percentToRatio: 0.01, attribute: 'hp:BONUS' }, { coefficient: parameter('tahmkench_p', 'ap_ratio_per_100_bonus_hp')?.fixedValue, percentToRatio: parameter('tahmkench_p', 'percent_to_ratio')?.fixedValue, refs: tahmPAttrs }, '法强×额外生命×0.0125×0.01完整保留');
const tahmEMax = rawCalculation('tahmkench_e', 'GreyHealthMaximum');
check('tahm_e_three_times_max_hp', tahmEMax?.mFormulaParts?.[0]?.mCoefficient === 3 && parameter('tahmkench_e', 'grey_health_max_hp_ratio')?.fixedValue === 3 && attributeNodes(formula('tahmkench_e', 'grey_health_maximum').expression)[0]?.attributeValueKind === 'TOTAL', true, { sourceCoefficient: 3, attribute: 'SOURCE.hp.TOTAL' }, { sourceCoefficient: tahmEMax?.mFormulaParts?.[0]?.mCoefficient, candidateRatio: parameter('tahmkench_e', 'grey_health_max_hp_ratio')?.fixedValue, expression: formula('tahmkench_e', 'grey_health_maximum')?.expression }, '灰血上限为3×来源最大生命');
const tahmRDataCooldown = sourceRanks('tahmkench_r', 'DataCooldown', 3, 1000, 1);
const tahmRTargetTree = rawCalculation('tahmkench_r', 'PercentHPDamage');
check('tahm_r_current_cooldown_and_damage', JSON.stringify(candidateValues(parameter('tahmkench_r', 'cooldown_ms'))) === JSON.stringify(tahmRDataCooldown) && same(parameter('tahmkench_r', 'target_max_hp_base_ratio')?.fixedValue, rawData('tahmkench_r', 'BasePercentHPDamage')?.[1]) && same(parameter('tahmkench_r', 'target_max_hp_ability_power_ratio')?.fixedValue, tahmRTargetTree?.mFormulaParts?.[1]?.mCoefficient), { cooldown: [120000, 100000, 80000], hpRatio: 0.15, apRatio: 0.0007 }, { cooldown: candidateValues(parameter('tahmkench_r', 'cooldown_ms')), hpRatio: parameter('tahmkench_r', 'target_max_hp_base_ratio')?.fixedValue, apRatio: parameter('tahmkench_r', 'target_max_hp_ability_power_ratio')?.fixedValue, tree: tahmRTargetTree }, 'R新增当前消费DataCooldown和0.15+0.0007×法强目标最大生命比例');

const blockingFindings = [
  {
    severity: 'BLOCKING',
    id: 'braum_w_armor_attribute_kind_unproven',
    candidatePointers: ['skills.braum_w.write.formulas[self_armor_bonus].expression.operands[1]', 'skills.braum_w.write.formulas[self_armor_bonus].description'],
    evidence: { sourcePointer: 'BraumW.mSpell.mSpellCalculations.GrantedBraumArmor.mFormulaParts[1]', source: braumWArmor, text: sourceSkills.get('braum_w').currentTexts.keyTooltip.text, candidate: braumWArmorAttr },
    reason: '正文只写护甲，原树只有mStat=1/mStatFormula=2；根说明明确1/2护甲阶段未有同版窄证。候选直接写SOURCE.armor.BONUS并在描述中称额外护甲，属于未证属性映射。',
    minimalFix: '增加DECIMAL/RUNTIME_INPUT的实际mStat1/mStatFormula2属性阶段，并让self_armor_bonus公式引用该参数；若主负责人取得独立窄证，再单独记录证据后保留枚举。'
  },
  {
    severity: 'BLOCKING',
    id: 'braum_q_max_hp_source_target_mismatch',
    candidatePointers: ['skills.braum_q.write.formulas[magic_damage].expression.operands[1].operands[1]', 'skills.braum_q.write.formulas[magic_damage].description'],
    evidence: { sourcePointer: 'BraumQ.mSpell.mSpellCalculations.TotalDamage.mFormulaParts[1]', source: braumQMaxHp, candidate: braumQAttr, sourceNote: 'Q条目明确写为来源最大生命值×0.025' },
    reason: '原树TotalDamage的mStat=12按当前根来源说明绑定施法者最大生命；候选却使用TARGET.hp.TOTAL，会在来源与目标最大生命不同的场景产生错误伤害。',
    minimalFix: '将该属性叶节点改为SOURCE.hp.TOTAL，并把描述改为来源最大生命；独立算例必须使用与目标最大生命不同的两组输入验证。'
  },
  {
    severity: 'BLOCKING',
    id: 'taric_p_armor_stage_description_overstates_kind',
    candidatePointers: ['skills.taric_p.write.parameters[actual_armor_stage].description', 'skills.taric_p.write.formulas[empowered_attack_extra_magic_damage].description'],
    evidence: { sourcePointer: 'TaricPassive.mSpell.mSpellCalculations.TotalDamage.mFormulaParts[1]', source: rawCalculation('taric_p', 'TotalDamage')?.mFormulaParts?.[1], candidate: parameter('taric_p', 'actual_armor_stage') },
    reason: '原树只给mStat=1/mStatFormula=2，根说明把该阶段列为未证；候选文字直接限定为来源额外护甲和施放前额外护甲。',
    minimalFix: '描述改为“mStat=1/mStatFormula=2实际属性阶段，运行输入提供；不映射为总/额外护甲，不递归读取强化后属性”。'
  },
  {
    severity: 'BLOCKING',
    id: 'taric_w_armor_stage_description_overstates_timing',
    candidatePointers: ['skills.taric_w.write.formulas[self_armor_bonus].description'],
    evidence: { sourcePointer: 'TaricW.mSpell.mSpellCalculations.BonusArmor.mFormulaParts[0]', source: rawCalculation('taric_w', 'BonusArmor')?.mFormulaParts?.[0], candidate: formula('taric_w', 'self_armor_bonus')?.description },
    reason: '运行输入本身是正确的保留方式，但公式说明把未证的属性阶段固定描述为施加前快照；当前源树只证明mStat=1/mStatFormula=2。',
    minimalFix: '改成“mStat=1/mStatFormula=2实际属性阶段由运行输入提供；禁止递归使用结果值”，把施加时点留为待接。'
  },
  {
    severity: 'BLOCKING',
    id: 'taric_e_armor_stage_description_overstates_kind',
    candidatePointers: ['skills.taric_e.write.parameters[actual_armor_stage].description', 'skills.taric_e.write.formulas[magic_damage].description'],
    evidence: { sourcePointer: 'TaricE.mSpell.mSpellCalculations.TotalDamage.mFormulaParts[2]', source: rawCalculation('taric_e', 'TotalDamage')?.mFormulaParts?.[2], candidate: parameter('taric_e', 'actual_armor_stage') },
    reason: '原树只给mStat=1/mStatFormula=2；候选描述称来源额外护甲阶段，缺少属性枚举证据。',
    minimalFix: '描述改为未解码的mStat1/mStatFormula2实际属性阶段运行输入，不声明额外护甲。'
  }
];

const nonBlockingNotes = [
  '布隆E首个定向弹体零伤害与后续弹体35/40/45/50/55百分数点减伤已分开保存。',
  '芮尔W只占一个技能槽，护盾生命周期为EXPLICIT_ONLY且无固定durationValue；芮尔R总量为2秒×每秒式。',
  '塔里克Q的既有cast_interval_ms按复用清单保护，15秒充能与每层1%最大生命另存；P冷却缩短为2-实际冷却倍率。',
  '塔姆P额外生命与法强双比例、E的3×最大生命灰血上限、R的120/100/80秒冷却与0.15+0.0007×法强目标最大生命比例均与当前树一致。',
  '结构检查未发现非二元运算、悬空公式或效果引用，两个效果结果均显式保留spellShieldBlockScope:null。'
];

const report = {
  generatedAt: new Date().toISOString(),
  status: 'REVISE_REQUIRED',
  canSave: false,
  scope: '第35批候选保存前独立静态审查；不调用业务接口、不修改候选和计划。',
  files: {
    candidate: candidatePath,
    candidateSha256: sha256(candidatePath),
    plan: planPath,
    planSha256: sha256(planPath),
    sourceBinding: sourcePath,
    sourceBindingSha256: sha256(sourcePath),
    sourceNote: sourceNotePath
  },
  counts: { candidate: candidate.counts, plan: { requestCount: plan.requestCount, requestCounts: plan.requestCounts }, reusedPublicParameters: candidate.reusedPublicParameters.length },
  checks: results,
  blockingFindings,
  nonBlockingNotes,
  apiWrites: 0,
  apiCalls: 0,
  runtimeValidation: '未执行'
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'w' });
console.log(JSON.stringify({ status: report.status, canSave: report.canSave, checks: results.length, passedChecks: results.filter((item) => item.pass).length, blockingFindings: blockingFindings.length, candidateSha256: report.files.candidateSha256, planSha256: report.files.planSha256, outputPath }));
