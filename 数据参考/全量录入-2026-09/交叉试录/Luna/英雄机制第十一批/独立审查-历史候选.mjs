import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';

const artifactDir = dirname(fileURLToPath(import.meta.url));
const webRoot = 'C:/project/damage_web_dev';
const planningRoot = 'C:/project/damage_viewer_project_planning';
const candidateDir = join(webRoot, '数据参考', '全量录入-2026-09', '交叉试录', 'Luna', '英雄机制第十一批');
const sourceRoot = join(planningRoot, '数据参考', '全量录入-2026-09', '技能公共参数实录');
// 主负责人已把修正前候选保存到主审前目录；独立审查固定读取该历史输入，避免后续修正改变审查对象。
const candidatePath = join(candidateDir, '主审前', '完整候选.json');
const evidencePath = join(candidateDir, '根绑定与数值证据.json');
const textEvidencePath = join(candidateDir, '补充文本证据.json');
const currentPath = join(candidateDir, '当前20技能组成核对.json');
const stringTablePath = join(planningRoot, '数据参考', '全量录入-2026-09', '装备效果补证', '客户端原始资料', 'lol-16.17-zh_CN.stringtable.json.gz');

const keys = [
  'irelia_p', 'irelia_q', 'irelia_w', 'irelia_e', 'irelia_r',
  'fiora_p', 'fiora_q', 'fiora_w', 'fiora_e', 'fiora_r',
  'camille_p', 'camille_q', 'camille_w', 'camille_e', 'camille_r',
  'gwen_p', 'gwen_q', 'gwen_w', 'gwen_e', 'gwen_r',
];
const expectedCandidateSha256 = '36bf395af31e0365b3f69d9eaf31600e58ae6ab7d9aa8b0713a55456693c5aa2';
const expectedPlanSha256 = 'a27874110805d7caccab4b34cc00965d1ed54cafe0ef0e58b4d7476663b75107';
const expectedCurrentSnapshotSha256 = 'f83c40fcc83982720d3cecf173378eaf1a955a41f790076943470df47fede7bc';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const clean = value => Math.round(value * 1e6) / 1e6;
const near = (a, b, tolerance = 1e-5) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tolerance;
const json = value => JSON.stringify(value);
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const pathKey = (owner, key, kind) => `${owner}.${key}.${kind}`;

const candidateBytes = await readFile(candidatePath);
const plan = JSON.parse(candidateBytes);
const evidence = await readJson(evidencePath);
const textEvidence = await readJson(textEvidencePath);
const current = await readJson(currentPath);
const checks = [];
const issues = [];
const notes = [];
const sourceSnapshots = {};
const examples = [];

function check(name, ok, detail, severity = '一般') {
  const item = { name, ok: Boolean(ok), severity, detail };
  checks.push(item);
  if (!ok) issues.push(item);
  return Boolean(ok);
}

function note(name, detail) {
  notes.push({ name, detail });
}

function sourceSpell(skillKey) {
  for (const hero of evidence.heroes) {
    const spell = hero.spells.find(item => item.skillKey === skillKey);
    if (spell) return { hero, spell };
  }
  throw new Error(`缺少来源技能 ${skillKey}`);
}

function parameter(skill, parameterKey) {
  return skill.write.parameters.find(item => item.parameterKey === parameterKey);
}

function parameterValue(skill, parameterKey, rank = 1, level = 1, runtime = {}) {
  const p = parameter(skill, parameterKey);
  if (!p) throw new Error(`候选缺少参数 ${skill.skillKey}/${parameterKey}`);
  if (p.valueMode === 'FIXED') return p.fixedValue;
  if (p.valueMode === 'RUNTIME_INPUT') {
    if (!Number.isFinite(runtime[parameterKey])) throw new Error(`缺少运行输入 ${skill.skillKey}/${parameterKey}`);
    return runtime[parameterKey];
  }
  const index = p.valueMode === 'CHARACTER_LEVEL' ? level : rank;
  const value = p.levelValues?.[String(index)];
  if (!Number.isFinite(value)) throw new Error(`缺少等级值 ${skill.skillKey}/${parameterKey}/${index}`);
  return value;
}

function walkExpression(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  if (node.nodeType === 'OPERATION') for (const child of node.operands ?? []) walkExpression(child, visit);
}

function expressionAttributes(expression) {
  const values = [];
  walkExpression(expression, node => {
    if (node.nodeType === 'ATTRIBUTE') values.push(pathKey(node.attributeOwner, node.attributeKey, node.attributeValueKind));
  });
  return values;
}

function expressionParameters(expression) {
  const values = [];
  walkExpression(expression, node => {
    if (node.nodeType === 'PARAMETER') values.push(node.parameterKey);
  });
  return values;
}

function evaluate(node, skill, context) {
  if (node.nodeType === 'PARAMETER') return parameterValue(skill, node.parameterKey, context.rank, context.level, context.runtime);
  if (node.nodeType === 'ATTRIBUTE') {
    const value = context.attributes[pathKey(node.attributeOwner, node.attributeKey, node.attributeValueKind)];
    if (!Number.isFinite(value)) throw new Error(`缺少属性输入 ${skill.skillKey}/${pathKey(node.attributeOwner, node.attributeKey, node.attributeValueKind)}`);
    return value;
  }
  if (node.nodeType === 'OPERATION') {
    const [left, right] = node.operands.map(child => evaluate(child, skill, context));
    if (node.operation === 'ADD') return left + right;
    if (node.operation === 'SUBTRACT') return left - right;
    if (node.operation === 'MULTIPLY') return left * right;
    if (node.operation === 'DIVIDE') return left / right;
    if (node.operation === 'MIN') return Math.min(left, right);
    if (node.operation === 'MAX') return Math.max(left, right);
  }
  throw new Error(`不支持的表达式节点 ${JSON.stringify(node)}`);
}

function runtimeValues(skill) {
  const runtime = {};
  for (const p of skill.write.parameters.filter(item => item.valueMode === 'RUNTIME_INPUT')) {
    if (p.parameterKey === 'on_hit_level_component') runtime[p.parameterKey] = 3;
    else if (p.parameterKey === 'shield_stat_value') runtime[p.parameterKey] = 1800;
    else if (p.parameterKey === 'current_damage_conversion_ratio') runtime[p.parameterKey] = 0.6;
    else if (p.parameterKey === 'actual_outer_damage') runtime[p.parameterKey] = 100;
    else if (p.parameterKey === 'actual_passive_hero_damage') runtime[p.parameterKey] = 100;
    else runtime[p.parameterKey] = 1;
  }
  return runtime;
}

const attributes = {
  'SOURCE.attack_damage.BONUS': 120,
  'SOURCE.attack_damage.TOTAL': 300,
  'SOURCE.ability_power.TOTAL': 100,
  'TARGET.hp.TOTAL': 1800,
  'TARGET.hp.CURRENT': 1200,
};

function formula(skillKey, formulaKey) {
  const item = plan.skills[skillKey].write.formulas.find(value => value.formulaKey === formulaKey);
  if (!item) throw new Error(`候选缺少公式 ${skillKey}/${formulaKey}`);
  return item;
}

function runExample(skillKey, formulaKey, rank, level, expected, label, runtimeOverride = {}) {
  const skill = plan.skills[skillKey];
  try {
    const value = clean(evaluate(formula(skillKey, formulaKey).expression, skill, {
      rank,
      level,
      runtime: { ...runtimeValues(skill), ...runtimeOverride },
      attributes,
    }));
    const ok = near(value, expected);
    examples.push({ label, skillKey, formulaKey, rank, level, expected, value, ok });
    check(`算例 ${label}`, ok, { expected, value });
  } catch (error) {
    examples.push({ label, skillKey, formulaKey, rank, level, expected, error: String(error), ok: false });
    check(`算例 ${label}`, false, String(error));
  }
}

// 一、候选、计划、来源文件和只读现值快照的固定散列。
check('候选文件字节散列', sha256(candidateBytes) === expectedCandidateSha256, {
  expected: expectedCandidateSha256,
  actual: sha256(candidateBytes),
}, '阻塞');
check('解析计划散列', sha256(Buffer.from(JSON.stringify(plan))) === expectedPlanSha256, {
  expected: expectedPlanSha256,
  actual: sha256(Buffer.from(JSON.stringify(plan))),
}, '阻塞');
check('当前只读快照散列', current.snapshotSha256 === expectedCurrentSnapshotSha256, {
  expected: expectedCurrentSnapshotSha256,
  actual: current.snapshotSha256,
});
check('当前只读GET状态', current.statusCounts?.['200'] === 173 && current.summary?.errorCount === 0, current.summary);
check('候选声明未写业务接口', plan.meta?.apiWrites === 0, plan.meta?.apiWrites, '阻塞');

const textCompressed = await readFile(stringTablePath);
const textRaw = gunzipSync(textCompressed);
check('当前中文字符串表散列', sha256(textRaw) === textEvidence.sha256, {
  expected: textEvidence.sha256,
  actual: sha256(textRaw),
});

for (const hero of evidence.heroes) {
  const compressedPath = join(sourceRoot, hero.client.path);
  const compressed = await readFile(compressedPath);
  const raw = gunzipSync(compressed);
  const rawSha = sha256(raw);
  const compressedSha = sha256(compressed);
  check(`客户端解压原文散列 ${hero.id}`, rawSha === hero.client.sha256, { expected: hero.client.sha256, actual: rawSha });
  check(`客户端压缩原文散列 ${hero.id}`, compressedSha === hero.client.compressedSha256, { expected: hero.client.compressedSha256, actual: compressedSha });
  const object = JSON.parse(raw);
  sourceSnapshots[hero.id] = { object, rawSha, compressedSha };
  check(`角色根绑定存在 ${hero.id}`, Boolean(object[hero.rootPath]), hero.rootPath);
  const officialPath = resolve(sourceRoot, hero.official.path);
  const officialBytes = await readFile(officialPath);
  const officialSha = sha256(officialBytes);
  check(`官方原文散列 ${hero.id}`, officialSha === hero.official.sha256, { expected: hero.official.sha256, actual: officialSha });
}

// 二、20 个槽位、组成总数、稳定键和结果边界。
check('技能槽精确20个且顺序固定', isDeepStrictEqual(Object.keys(plan.skills ?? {}), keys), Object.keys(plan.skills ?? {}), '阻塞');
const totals = { parameters: 0, formulas: 0, effects: 0, processes: 0, internalStates: 0, triggerRules: 0 };
for (const key of keys) {
  const skill = plan.skills[key];
  for (const kind of Object.keys(totals)) totals[kind] += skill.write[kind]?.length ?? 0;
  for (const [kind, items] of Object.entries(skill.write)) {
    const idField = {
      parameters: 'parameterKey', formulas: 'formulaKey', effects: 'effectKey', processes: 'processKey',
      internalStates: 'stateKey', triggerRules: 'ruleKey',
    }[kind];
    const ids = items.map(item => item[idField]);
    check(`稳定键唯一 ${key}/${kind}`, ids.length === new Set(ids).size && ids.every(Boolean), ids);
  }
  for (const p of skill.write.parameters) {
    check(`参数模式合法 ${key}/${p.parameterKey}`, ['FIXED', 'SKILL_LEVEL', 'CHARACTER_LEVEL', 'RUNTIME_INPUT'].includes(p.valueMode), p.valueMode);
    if (p.valueMode === 'FIXED') check(`固定参数有固定值 ${key}/${p.parameterKey}`, Number.isFinite(p.fixedValue) && p.levelValues === null, p);
    if (p.valueMode === 'RUNTIME_INPUT') check(`运行输入不填默认值 ${key}/${p.parameterKey}`, p.fixedValue === null && p.levelValues === null, p);
    if (p.valueMode === 'SKILL_LEVEL') {
      const actual = Object.keys(p.levelValues ?? {}).map(Number).sort((a, b) => a - b);
      const expected = Array.from({ length: skill.maxLevel }, (_, index) => index + 1);
      check(`技能等级数组从1开始 ${key}/${p.parameterKey}`, isDeepStrictEqual(actual, expected), { actual, expected });
    }
    if (p.valueMode === 'CHARACTER_LEVEL') {
      const actual = Object.keys(p.levelValues ?? {}).map(Number).sort((a, b) => a - b);
      const expected = Array.from({ length: 18 }, (_, index) => index + 1);
      check(`角色等级数组从1开始 ${key}/${p.parameterKey}`, isDeepStrictEqual(actual, expected), { actual, expected });
    }
  }
  for (const f of skill.write.formulas) {
    walkExpression(f.expression, node => {
      if (node.nodeType === 'PARAMETER') check(`公式引用已有参数 ${key}/${f.formulaKey}/${node.parameterKey}`, Boolean(parameter(skill, node.parameterKey)), node);
      if (node.nodeType === 'ATTRIBUTE') check(`公式属性字段受限 ${key}/${f.formulaKey}`, ['SOURCE', 'TARGET'].includes(node.attributeOwner) && ['attack_damage', 'ability_power', 'hp'].includes(node.attributeKey) && ['TOTAL', 'BONUS', 'CURRENT'].includes(node.attributeValueKind), node);
      if (node.nodeType === 'OPERATION') check(`公式为二元运算 ${key}/${f.formulaKey}`, Array.isArray(node.operands) && node.operands.length === 2 && ['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX'].includes(node.operation), node);
    });
  }
  const resultList = skill.write.effects.flatMap(effect => effect.results ?? []);
  check(`未生成默认伤害结果 ${key}`, resultList.every(result => result.resultType !== 'DAMAGE'), resultList);
  check(`未生成默认瞬时治疗结果 ${key}`, resultList.every(result => result.resultType !== 'DIRECT_HEAL'), resultList);
}
check('组成总数为172/43/16/0/0/0', isDeepStrictEqual(totals, { parameters: 172, formulas: 43, effects: 16, processes: 0, internalStates: 0, triggerRules: 0 }), totals, '阻塞');
check('没有过程、状态和触发占位', totals.processes === 0 && totals.internalStates === 0 && totals.triggerRules === 0, totals);
const resultCounts = { damage: 0, heal: 0, resource: 0 };
for (const key of keys) for (const effect of plan.skills[key].write.effects) for (const result of effect.results ?? []) {
  if (result.resultType === 'DAMAGE') resultCounts.damage++;
  if (result.resultType === 'DIRECT_HEAL') resultCounts.heal++;
  if (result.resultType === 'RESOURCE_CHANGE') resultCounts.resource++;
}
check('效果边界为16个资源变化', isDeepStrictEqual(resultCounts, { damage: 0, heal: 0, resource: 16 }), resultCounts);

// 三、候选当前绑定、客户端根对象和中文技能名逐项一致。
for (const key of keys) {
  const skill = plan.skills[key];
  const { hero, spell } = sourceSpell(key);
  const rawObject = sourceSnapshots[hero.id].object;
  const rawSpellObject = rawObject[spell.binding];
  check(`来源英雄一致 ${key}`, skill.source.hero === hero.id, { candidate: skill.source.hero, evidence: hero.id });
  check(`来源根路径一致 ${key}`, skill.source.rootPath === hero.rootPath && skill.source.spellPath === spell.binding, { candidate: skill.source, evidence: { rootPath: hero.rootPath, binding: spell.binding } });
  check(`客户端和官方散列引用一致 ${key}`, skill.source.clientSha256 === hero.client.sha256 && skill.source.officialSha256 === hero.official.sha256, skill.source);
  check(`当前技能根存在 ${key}`, Boolean(rawSpellObject?.mSpell), spell.binding);
  check(`当前中文绑定文本一致 ${key}`, isDeepStrictEqual(skill.source.currentBoundText, textEvidence.skills?.[key]), skill.source.currentBoundText);
  check(`技能中文名一致 ${key}`, skill.name === spell.official.name && skill.source.currentBoundText?.keys?.keyName?.text === spell.official.name, { candidate: skill.name, evidence: spell.official.name });
  check(`技能等级上限一致 ${key}`, skill.maxLevel === (spell.official.maxrank ?? 1), { candidate: skill.maxLevel, evidence: spell.official.maxrank ?? 1 });
}

// 四、所有数据字段按当前根的索引1和原始单位独立重算；缺值保持缺值。
for (const key of keys) {
  const skill = plan.skills[key];
  const { hero, spell } = sourceSpell(key);
  const sourceDataValues = sourceSnapshots[hero.id].object[spell.binding]?.mSpell?.DataValues ?? [];
  for (const proof of skill.proofs.filter(item => String(item.source ?? '').startsWith('DataValues.'))) {
    const sourceName = String(proof.source).slice('DataValues.'.length);
    const data = sourceDataValues.find(item => (item.name ?? item.mName) === sourceName);
    check(`来源数据字段存在 ${key}/${sourceName}`, Boolean(data), data);
    const actualRaw = data?.values ?? data?.mValues;
    const proofRaw = Array.isArray(proof.raw) ? proof.raw : proof.raw?.values ?? proof.raw?.mValues;
    if (!proofRaw) {
      check(`来源缺值仍为缺值 ${key}/${sourceName}`, actualRaw === undefined, { proof: proof.raw, actual: actualRaw });
      check(`来源缺值没有候选参数 ${key}/${sourceName}`, !proof.parameterKey && !skill.write.parameters.some(item => item.parameterKey === proof.parameterKey), proof);
      continue;
    }
    check(`来源原数组一致 ${key}/${sourceName}`, isDeepStrictEqual(proofRaw, actualRaw), { proof: proofRaw, actual: actualRaw });
    if (proof.parameterKey) {
      const offset = proof.offset ?? 1;
      const scale = proof.scale ?? 1;
      const expected = actualRaw.slice(offset, offset + skill.maxLevel).map(value => clean(value * scale));
      const actualProof = proof.values ?? [];
      check(`来源索引和单位换算一致 ${key}/${proof.parameterKey}`, expected.length === actualProof.length && expected.every((value, index) => near(value, actualProof[index])), { expected, actual: actualProof, offset, scale });
      const p = parameter(skill, proof.parameterKey);
      const actualParameter = p?.valueMode === 'FIXED' ? [p.fixedValue] : Object.keys(p?.levelValues ?? {}).sort((a, b) => Number(a) - Number(b)).map(index => p.levelValues[index]);
      check(`参数实际值一致 ${key}/${proof.parameterKey}`, actualParameter.length === 1 ? expected.every(value => near(value, actualParameter[0])) : expected.length === actualParameter.length && expected.every((value, index) => near(value, actualParameter[index])), { expected, actual: actualParameter });
    }
  }
}

const fioraRaw = sourceSnapshots.Fiora.object['Characters/Fiora/Spells/FioraRAbility/FioraR'];
const fioraBotEffects = fioraRaw?.BotData?.['{ec17e271}'] ?? [];
const healBotEffects = fioraBotEffects.filter(effect => [32, 64].includes(effect.EffectTag));
check('菲奥娜R客户端含两个相同治疗效果绑定', healBotEffects.length === 2 && healBotEffects.every(effect => effect.EffectCalculation?.mFormulaParts?.[0]?.mSpellCalculationKey === 'HealPerSecondCalc'), healBotEffects);

// 五、紧凑语义核对：属性、百分数点、运行输入和关键时序均按候选表达式确认。
const expectedAttributes = {
  'irelia_p/on_hit_bonus_magic_damage': 'SOURCE.attack_damage.BONUS',
  'irelia_q/champion_damage': 'SOURCE.attack_damage.TOTAL',
  'irelia_q/heal_amount': 'SOURCE.attack_damage.TOTAL',
  'irelia_w/min_damage': 'SOURCE.attack_damage.TOTAL',
  'irelia_w/max_damage': 'SOURCE.attack_damage.TOTAL',
  'irelia_e/total_damage': 'SOURCE.ability_power.TOTAL',
  'irelia_r/missile_damage': 'SOURCE.ability_power.TOTAL',
  'irelia_r/zone_damage': 'SOURCE.ability_power.TOTAL',
  'fiora_p/passive_damage_ratio': 'SOURCE.attack_damage.BONUS',
  'fiora_p/passive_vital_true_damage': 'SOURCE.attack_damage.BONUS',
  'fiora_p/r_vital_true_damage': 'SOURCE.attack_damage.BONUS',
  'fiora_q/total_damage': 'SOURCE.attack_damage.BONUS',
  'fiora_w/stab_damage': 'SOURCE.ability_power.TOTAL',
  'fiora_e/first_attack_damage': 'SOURCE.attack_damage.TOTAL',
  'fiora_e/second_attack_damage': 'SOURCE.attack_damage.TOTAL',
  'fiora_r/r_vital_true_damage': 'TARGET.hp.TOTAL',
  'camille_q/bonus_damage': 'SOURCE.attack_damage.TOTAL',
  'camille_q/empowered_bonus_damage': 'SOURCE.attack_damage.TOTAL',
  'camille_q/empowered_true_damage_portion': 'SOURCE.attack_damage.TOTAL',
  'camille_w/outer_damage_ratio': 'SOURCE.attack_damage.BONUS',
  'camille_w/base_damage_total': 'SOURCE.attack_damage.BONUS',
  'camille_w/outer_damage': 'SOURCE.attack_damage.BONUS',
  'camille_e/total_damage': 'SOURCE.attack_damage.BONUS',
  'camille_r/on_hit_magic_damage': 'TARGET.hp.CURRENT',
  'gwen_p/passive_damage_percent': 'SOURCE.ability_power.TOTAL',
  'gwen_p/passive_damage_ratio': 'SOURCE.ability_power.TOTAL',
  'gwen_p/passive_magic_damage': 'SOURCE.ability_power.TOTAL',
  'gwen_p/heal_cap': 'SOURCE.ability_power.TOTAL',
  'gwen_q/final_swipe_damage': 'SOURCE.ability_power.TOTAL',
  'gwen_q/mini_swipe_damage': 'SOURCE.ability_power.TOTAL',
  'gwen_q/max_damage': 'SOURCE.ability_power.TOTAL',
  'gwen_w/total_resists': 'SOURCE.ability_power.TOTAL',
  'gwen_e/on_hit_damage': 'SOURCE.ability_power.TOTAL',
  'gwen_r/total_damage': 'SOURCE.ability_power.TOTAL',
  'gwen_r/total_damage_3': 'SOURCE.ability_power.TOTAL',
  'gwen_r/total_damage_5': 'SOURCE.ability_power.TOTAL',
  'gwen_r/max_damage': 'SOURCE.ability_power.TOTAL',
};
for (const [identifier, expected] of Object.entries(expectedAttributes)) {
  const [skillKey, formulaKey] = identifier.split('/');
  const actual = expressionAttributes(formula(skillKey, formulaKey).expression);
  check(`属性映射 ${identifier}`, actual.includes(expected), { expected, actual });
}
check('卡蜜尔P的12号属性保持运行输入', parameter(plan.skills.camille_p, 'shield_stat_value')?.valueMode === 'RUNTIME_INPUT' && expressionAttributes(formula('camille_p', 'shield_amount').expression).length === 0, {
  parameter: parameter(plan.skills.camille_p, 'shield_stat_value'),
  attributes: expressionAttributes(formula('camille_p', 'shield_amount').expression),
});
check('未把卡蜜尔P的12号节点扩成生命属性', !Object.values(plan.skills.camille_p.write.formulas).some(item => expressionAttributes(item.expression).some(value => value.includes('.hp.'))), plan.skills.camille_p.write.formulas);
check('卡蜜尔Q17级缺增量且不猜曲线', plan.skills.camille_q.proofs.some(item => item.source.includes('DamageConversionPercentage') && item.raw?.mBreakpoints?.some(point => point.mLevel === 17 && point.mAdditionalBonusAtThisLevel == null && point.mBonusPerLevelAtAndAfter == null)) && parameter(plan.skills.camille_q, 'current_damage_conversion_ratio')?.valueMode === 'RUNTIME_INPUT', plan.skills.camille_q.proofs.filter(item => item.source.includes('DamageConversionPercentage')));
check('卡蜜尔R百分数点转比例和当前生命', parameterValue(plan.skills.camille_r, 'percent_to_ratio') === 0.01 && isDeepStrictEqual(plan.skills.camille_r.write.formulas[0].expression.operands[0].operands.map(item => item.nodeType === 'PARAMETER' ? item.parameterKey : null), ['percent_to_ratio', 'current_hp_damage_percent']) && expressionAttributes(formula('camille_r', 'on_hit_magic_damage').expression).includes('TARGET.hp.CURRENT'), plan.skills.camille_r.write.formulas[0]);
check('格温P百分数点转比例', parameterValue(plan.skills.gwen_p, 'passive_base_damage_percent') === 1 && parameterValue(plan.skills.gwen_p, 'passive_ap_damage_percent_per_ap') === 0.006 && parameterValue(plan.skills.gwen_p, 'percent_to_ratio') === 0.01, {
  base: parameterValue(plan.skills.gwen_p, 'passive_base_damage_percent'),
  ap: parameterValue(plan.skills.gwen_p, 'passive_ap_damage_percent_per_ap'),
  conversion: parameterValue(plan.skills.gwen_p, 'percent_to_ratio'),
});
check('格温P实际伤害进入自我治疗', expressionParameters(formula('gwen_p', 'passive_heal_amount').expression).includes('actual_passive_hero_damage') && parameter(plan.skills.gwen_p, 'actual_passive_hero_damage')?.valueMode === 'RUNTIME_INPUT', formula('gwen_p', 'passive_heal_amount'));
check('卡蜜尔W实际外沿伤害进入自我治疗', expressionParameters(formula('camille_w', 'outer_heal_amount').expression).includes('actual_outer_damage') && parameter(plan.skills.camille_w, 'actual_outer_damage')?.valueMode === 'RUNTIME_INPUT', formula('camille_w', 'outer_heal_amount'));
check('格温Q最大伤害不等于默认满层过程', parameterValue(plan.skills.gwen_q, 'max_mini_swipe_count') === 5 && plan.skills.gwen_q.write.processes.length === 0 && plan.skills.gwen_q.write.internalStates.length === 0 && plan.skills.gwen_q.write.triggerRules.length === 0 && plan.skills.gwen_q.pending.some(item => item.component.includes('充能层数')), plan.skills.gwen_q);
check('格温R三段和最大针数保持上限关系', parameterValue(plan.skills.gwen_r, 'three_needles') === 3 && parameterValue(plan.skills.gwen_r, 'five_needles') === 5 && parameterValue(plan.skills.gwen_r, 'nine_needles') === 9 && plan.skills.gwen_r.write.processes.length === 0 && plan.skills.gwen_r.write.internalStates.length === 0, plan.skills.gwen_r.write.parameters.filter(item => item.parameterKey.includes('needles')));
check('卡蜜尔Q两段时点参数齐全', parameterValue(plan.skills.camille_q, 'q_ramp_up_time_ms') === 1500 && parameterValue(plan.skills.camille_q, 'second_attack_window_ms') === 2000 && parameterValue(plan.skills.camille_q, 'recast_window_ms') === 3500 && plan.skills.camille_q.pending.some(item => item.component.includes('普攻间隔')), plan.skills.camille_q.write.parameters.filter(item => item.parameterKey.includes('window') || item.parameterKey.includes('ramp')));
check('菲奥娜破绽和R共享明确', parameterValue(plan.skills.fiora_p, 'r_vital_count') === 4 && parameterValue(plan.skills.fiora_r, 'r_vital_count') === 4 && expressionParameters(formula('fiora_r', 'r_vital_true_damage').expression).includes('passive_vital_damage_ratio') && parameter(plan.skills.fiora_p, 'passive_heal_amount')?.valueMode === 'CHARACTER_LEVEL', { p: plan.skills.fiora_p.write.parameters, r: plan.skills.fiora_r.write.parameters });

// 六、法力资源效果逐项核对；技能P没有法力效果，16 个有非零成本的槽位各一项。
for (const key of keys) {
  const skill = plan.skills[key];
  const { spell } = sourceSpell(key);
  const costs = spell.official.cost;
  const expectedMana = Array.isArray(costs) && costs.some(value => Number(value) > 0);
  const effects = skill.write.effects.filter(effect => effect.effectKey === 'mana_cost');
  check(`法力效果存在性 ${key}`, effects.length === (expectedMana ? 1 : 0), { expectedMana, effects: effects.length, costs });
  if (!expectedMana) continue;
  const p = parameter(skill, 'mana_cost');
  const values = p.valueMode === 'FIXED' ? Array(costs.length).fill(p.fixedValue) : Object.keys(p.levelValues ?? {}).sort((a, b) => Number(a) - Number(b)).map(index => p.levelValues[index]);
  check(`法力参数逐级一致 ${key}`, values.length === costs.length && values.every((value, index) => near(value, costs[index])), { values, costs });
  const effect = effects[0];
  const result = effect.results?.[0];
  check(`法力结果结构 ${key}`, effect.results?.length === 1 && result?.resultType === 'RESOURCE_CHANGE' && result.target === 'SOURCE' && result.detail?.attributeKey === 'mana' && result.detail?.operation === 'CONSUME' && result.valueRule?.value?.kind === 'PARAMETER' && result.valueRule.value.parameterKey === 'mana_cost' && result.valueRule.fixedMultiplier === 1 && result.valueRule.fixedMinValue === 0, result);
}

// 七、独立算例；只覆盖关键公式，不重复已有的全量算例套件。
runExample('irelia_q', 'champion_damage', 3, 9, 285, '艾瑞莉娅Q英雄伤害');
runExample('irelia_q', 'heal_amount', 3, 9, 33, '艾瑞莉娅Q自身治疗');
runExample('irelia_e', 'total_damage', 5, 9, 330, '艾瑞莉娅E伤害');
runExample('irelia_r', 'zone_damage', 3, 9, 375, '艾瑞莉娅R刃墙伤害');
runExample('fiora_p', 'passive_vital_true_damage', 1, 1, 140.4, '菲奥娜P破绽真实伤害');
runExample('fiora_p', 'r_vital_true_damage', 1, 1, 561.6, '菲奥娜P四处破绽上限');
runExample('fiora_q', 'total_damage', 5, 9, 242, '菲奥娜Q伤害');
runExample('fiora_w', 'stab_damage', 3, 9, 290, '菲奥娜W刺击伤害');
runExample('fiora_e', 'second_attack_damage', 5, 9, 600, '菲奥娜E第二次攻击倍率');
runExample('fiora_r', 'r_vital_true_damage', 3, 9, 561.6, '菲奥娜R共享破绽上限', { passive_vital_damage_ratio: 0.078 });
runExample('camille_p', 'shield_amount', 1, 18, 360, '卡蜜尔P护盾运行输入');
runExample('camille_q', 'empowered_bonus_damage', 5, 9, 240, '卡蜜尔Q第二段额外伤害');
runExample('camille_q', 'empowered_true_damage_portion', 5, 9, 144, '卡蜜尔Q第二段真实转换部分');
runExample('camille_w', 'outer_damage', 5, 9, 216, '卡蜜尔W外沿额外伤害');
runExample('camille_w', 'outer_heal_amount', 5, 9, 100, '卡蜜尔W实际伤害治疗');
runExample('camille_r', 'on_hit_magic_damage', 3, 9, 96, '卡蜜尔R当前生命附伤');
runExample('gwen_p', 'passive_magic_damage', 1, 9, 28.8, '格温P目标最大生命伤害');
runExample('gwen_p', 'passive_heal_amount', 1, 9, 67, '格温P实际伤害治疗');
runExample('gwen_q', 'max_damage', 5, 9, 350, '格温Q最大剪切');
runExample('gwen_w', 'total_resists', 5, 9, 37, '格温W双抗');
runExample('gwen_e', 'on_hit_damage', 5, 9, 35, '格温E攻击附伤');
runExample('gwen_r', 'total_damage_3', 3, 9, 240, '格温R三针');
runExample('gwen_r', 'total_damage_5', 3, 9, 400, '格温R五针');
runExample('gwen_r', 'max_damage', 3, 9, 720, '格温R九针上限');

// 八、阻塞项：菲奥娜R的共同治疗对象不是纯第三者，候选整体排除会丢掉本人治疗。
const fioraEnglishPath = join(planningRoot, '数据参考', '全量录入-2026-09', '英雄', '原始资料', 'en_US', 'champion', 'Fiora.json');
const fioraEnglish = await readJson(fioraEnglishPath);
const fioraRText = fioraEnglish.data.Fiora.spells.find(spell => spell.id === 'FioraR');
const fioraHealSource = {
  englishDescription: fioraRText?.description,
  englishTooltip: fioraRText?.tooltip,
  chineseTooltip: textEvidence.skills?.fiora_r?.keys?.keyTooltip?.text,
  clientCalculation: fioraRaw?.mSpell?.mSpellCalculations?.HealPerSecondCalc,
  clientEffectTags: healBotEffects.map(effect => effect.EffectTag),
  excludedProofs: plan.skills.fiora_r.proofs.filter(item => item.source?.includes('HealDuration') || item.source?.includes('HealPerSecond') || item.source?.includes('HealRingRadius') || item.source?.includes('HealDurationExtension') || item.source?.includes('mSpellCalculations.HealPerSecondCalc')),
};
const englishIncludesSelf = /Fiora and her allies/i.test(fioraRText?.description ?? '') && /Fiora restores/i.test(fioraRText?.tooltip ?? '');
const fioraHealRetained = plan.skills.fiora_r.write.parameters.some(item => ['heal_duration_ms', 'heal_per_second', 'heal_duration_extension', 'heal_ratio'].includes(item.parameterKey)) || plan.skills.fiora_r.write.formulas.some(item => item.formulaKey.includes('heal'));
check('菲奥娜R本人治疗链未被第三者整体删除', englishIncludesSelf && fioraHealRetained, {
  englishIncludesSelf,
  candidateParameters: plan.skills.fiora_r.write.parameters.map(item => item.parameterKey),
  candidateFormulas: plan.skills.fiora_r.write.formulas.map(item => item.formulaKey),
  source: fioraHealSource,
}, '阻塞');
if (!fioraHealRetained) note('最小纠错', '保留菲奥娜R的本人治疗数值链：HealPerSecond=50/75/100/125/150/175/200，HealDuration=5秒，HealDurationExtension=1秒，HealPerSecondCalc=HealPerSecond+0.6×SOURCE.attack_damage.BONUS；周围第三者的目标筛选、范围和逐秒过程仍待系统接线，MinHealDuration缺值不补。');

const report = {
  generatedAt: new Date().toISOString(),
  scope: '英雄11四名英雄20个技能槽的独立静态来源、结构、表达式语义和关键算例核对；不代表业务接口、战斗运行或页面验收。',
  input: {
    candidatePath,
    candidateSha256: sha256(candidateBytes),
    expectedCandidateSha256,
    planSha256: sha256(Buffer.from(JSON.stringify(plan))),
    expectedPlanSha256,
    evidenceSha256: sha256(Buffer.from(JSON.stringify(evidence))),
    textEvidenceSha256: sha256(Buffer.from(JSON.stringify(textEvidence))),
    currentSnapshotSha256: current.snapshotSha256,
  },
  counts: {
    skillCount: keys.length,
    composition: totals,
    checkCount: checks.length,
    issueCount: issues.length,
    blockingIssueCount: issues.filter(item => item.severity === '阻塞').length,
    exampleCount: examples.length,
  },
  sourceHashes: evidence.heroes.map(hero => ({ id: hero.id, clientSha256: hero.client.sha256, clientCompressedSha256: hero.client.compressedSha256, officialSha256: hero.official.sha256 })),
  currentRead: { status: current.statusCounts?.['200'] === 173 && current.summary?.errorCount === 0 ? 'success' : 'check_failed', snapshotSha256: current.snapshotSha256, summary: current.summary },
  semanticFocus: {
    skillLevelIndexStartsAtOne: true,
    characterLevelIndexStartsAtOne: true,
    noDefaultFullStacksOrContinuousProcess: true,
    camilleQTimingKeptAsParameters: true,
    camillePStat12RemainsRuntimeInput: true,
    gwenPercentPointConversionChecked: true,
    actualDamageFeedsSelfHealChecked: true,
    fioraVitalAndRSharedChecked: true,
  },
  fioraRHealingEvidence: fioraHealSource,
  examples,
  notes,
  issues,
  checks,
  pass: issues.length === 0,
};
await writeFile(join(artifactDir, '独立审查.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ pass: report.pass, checkCount: checks.length, issueCount: issues.length, blockingIssueCount: report.counts.blockingIssueCount, exampleCount: examples.length, output: join(artifactDir, '独立审查.json') }));
