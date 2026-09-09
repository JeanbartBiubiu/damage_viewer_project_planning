import fs from 'node:fs';
import { createHash } from 'node:crypto';

const here = new URL('./', import.meta.url);
const readJson = name => JSON.parse(fs.readFileSync(new URL(name, here), 'utf8'));
const originalBytes = fs.readFileSync(new URL('完整候选.json', here));
const original = JSON.parse(originalBytes);
const candidate = structuredClone(original);
const baseSha256 = createHash('sha256').update(originalBytes).digest('hex');

function proofFor(skill, key) {
  return skill.proofs.find(value => value.parameterKey === key);
}

function excludeParameter(skill, key, reason, component = key) {
  skill.write.parameters = skill.write.parameters.filter(value => value.parameterKey !== key);
  const proof = proofFor(skill, key);
  if (proof) {
    delete proof.parameterKey;
    proof.excluded = true;
    proof.semantic = reason;
  }
  skill.excluded.push({ component, source: proof?.source ?? `候选参数:${key}`, reason });
}

function excludeFormula(skill, key, reason, source) {
  skill.write.formulas = skill.write.formulas.filter(value => value.formulaKey !== key);
  const proof = skill.proofs.find(value => value.source === source);
  if (proof) {
    proof.excluded = true;
    proof.semantic = reason;
  }
  skill.excluded.push({ component: `公式:${key}`, source: source ?? `候选公式:${key}`, reason });
}

function replaceParameterKey(skill, oldKey, newKey) {
  for (const row of skill.write.parameters) {
    if (row.parameterKey === oldKey) row.parameterKey = newKey;
  }
  for (const proof of skill.proofs) {
    if (proof.parameterKey === oldKey) proof.parameterKey = newKey;
  }
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (value.parameterKey === oldKey) value.parameterKey = newKey;
    for (const child of Object.values(value)) walk(child);
  }
  walk(skill.write);
}

function resetDisposition(skill) {
  skill.disposition = {
    范围外: skill.excluded,
    来源待核: skill.pending.filter(value => value.kind === '来源'),
    系统缺口: skill.pending.filter(value => value.kind === '系统'),
    尚未接线: skill.pending.filter(value => !['来源', '系统'].includes(value.kind))
  };
  skill.status = '修订版组成候选；未保存、未接线和范围外分支不表示完整战斗机制';
}

// 修订范围：独立召唤物的实体、攻击、生命周期和专用数量/伤害值不进入本批；主体施法/法力仍保留。
{
  const skill = candidate.skills.malzahar_w;
  const reasons = {
    stack_cap: '跨技能叠层只服务独立虚灵数量；正文虽明确其他技能施放会叠层至StackCap，但本批不保存其独立召唤物数量消费。',
    voidling_duration_ms: '独立虚灵生命周期属于本批范围外；仅保留原始DataValues证据。',
    voidling_base_damage: '独立虚灵每次攻击伤害属于本批范围外；仅保留原始DataValues和原树证据。',
    lane_minion_ratio: '仅对线小兵限定，且本批明确排除小兵目标分支；不作为英雄技能组成。',
    epic_monster_ratio: '仅史诗野怪限定，且本批明确排除非英雄目标分支；不作为英雄技能组成。',
    bonus_ad_ratio: '独立虚灵攻击公式专用额外攻击力项；独立虚灵伤害分支范围外。',
    ap_ratio: '独立虚灵攻击公式专用法强项；独立虚灵伤害分支范围外。',
    voidling_level_scaling: '独立虚灵攻击等级成长项；独立召唤物分支范围外，未知等级算法也不展开。',
    actual_stack_count: '独立虚灵数量的实际层数输入；本批不保存独立召唤物数量消费。',
    zero: '仅为独立虚灵数量封顶公式的下限常量；对应公式范围外。',
    one: '仅为独立虚灵召唤数量公式的基础常量；对应公式范围外。'
  };
  for (const key of Object.keys(reasons)) excludeParameter(skill, key, reasons[key]);
  excludeFormula(skill, 'voidling_hit_damage', '独立虚灵每次攻击公式及其等级/属性项属于范围外；原树和具名属性节点仅留证据。', 'mSpellCalculations.VoidlingBonusDamageTooltip');
  excludeFormula(skill, 'capped_stack_count', '独立虚灵数量封顶公式属于范围外；StackCap跨技能来源只保留排除证据。');
  excludeFormula(skill, 'summon_count', '独立虚灵数量公式属于范围外；正文“召唤1只、每层增加1只”只留排除证据。');
  for (const proof of skill.proofs) {
    if (proof.source === 'mSpellCalculations.VoidlingBonusDamageTooltip.mFormulaParts[2]') {
      proof.excluded = true;
      proof.semantic = 'mStat=2、mStatFormula=2的额外攻击力节点只属于独立虚灵攻击公式；该公式范围外。';
    }
    if (proof.source === 'mSpellCalculations.VoidlingBonusDamageTooltip.mFormulaParts[3]') {
      proof.excluded = true;
      proof.semantic = '省略统计选择器的法强节点只属于独立虚灵攻击公式；该公式范围外。';
    }
  }
  skill.excluded = skill.excluded.filter(value => value.component !== '独立虚灵实体、攻击过程和召唤物生命周期');
  skill.excluded.push({
    component: '跨技能叠层来源（仅独立虚灵数量消费）',
    source: '当前中文绑定 Spell_MalzaharW_Tooltip；DataValues.StackCap',
    reason: '正文明确玛尔扎哈其它技能施放提供层数且最多StackCap层；因层数只消费到独立虚灵数量，本批保留来源证据但不保存跨技能状态或数量公式。'
  });
  skill.pending = [];
  resetDisposition(skill);
}

// 小兵专用处决阈值移出玛尔扎哈E，感染总量关系仍保留。
{
  const skill = candidate.skills.malzahar_e;
  excludeParameter(skill, 'minion_execute_threshold', '只对小兵的处决阈值属于本批排除的小兵目标分支；仅保留原始等级断点证据。');
  const proof = skill.proofs.find(value => value.source === 'mSpellCalculations.MinionExecuteThreshold');
  if (proof) {
    proof.excluded = true;
    proof.semantic = '小兵处决阈值属于范围外目标分支；完整原树仅留证据。';
  }
  skill.pending = skill.pending.filter(value => value.component !== '等级节点求值：minion_execute_threshold').map(value => value.component === '感染传播、刷新和击杀回蓝'
    ? { ...value, reason: 'Q/R刷新、目标死亡传播和击杀回蓝属于事件待接；小兵处决阈值已移到范围外，不作为英雄目标机制。' }
    : value);
  resetDisposition(skill);
}

// 丽桑卓P的独立冰奴专用数值全部留在范围外证据；该技能位不新增组成。
{
  const skill = candidate.skills.lissandra_p;
  const keys = ['ice_servant_slow_ratio', 'ice_servant_explosion_delay_ms', 'ice_servant_base_damage', 'ap_ratio_constant'];
  const reasons = {
    ice_servant_slow_ratio: '独立冰奴减速专用值属于范围外；仅留原始DataValues证据。',
    ice_servant_explosion_delay_ms: '独立冰奴爆炸等待专用值属于范围外；仅留原始DataValues证据。',
    ice_servant_base_damage: '独立冰奴爆炸基础伤害和等级曲线属于范围外；未知等级算法不展开。',
    ap_ratio_constant: '独立冰奴爆炸法强项属于范围外；仅留原树系数证据。'
  };
  for (const key of keys) excludeParameter(skill, key, reasons[key]);
  excludeFormula(skill, 'ice_servant_damage', '独立冰奴爆炸伤害公式属于范围外；原始计算树仅留证据。', 'mSpellCalculations.TotalDamage');
  skill.excluded = skill.excluded.filter(value => value.component !== '独立冰封奴仆实体、死亡触发和范围搜索');
  skill.excluded.push({
    component: '独立冰奴实体、死亡触发、范围和爆炸',
    source: '当前中文绑定 Spell_LissandraPassive_Tooltip；DataValues.MoveSpeedMod/ExplosionDelay/Range/Radius；mSpellCalculations.TotalDamage',
    reason: '本批按逐支路范围排除独立冰奴；没有把独立冰奴的专用减速、等待、伤害或等级曲线并入丽桑卓P主体。'
  });
  skill.pending = [];
  resetDisposition(skill);
}

// 卡尔萨斯Q只保留实际目标数量输入和“==1”说明，不造无消费者的MAX下限公式。
{
  const skill = candidate.skills.karthus_q;
  excludeParameter(skill, 'one', '单一目标资格不是目标数量下限；本批只保留实际目标数量输入并由事件判断是否 == 1。');
  excludeFormula(skill, 'single_target_eligibility_lower_bound', 'MAX(targetCount,1)会把0或负值改成1，既非唯一目标资格判断且没有业务消费者；删除该公式。');
  skill.pending = skill.pending.map(value => value.component === '实际输入：actual_target_count'
    ? { ...value, reason: '必须由当前命中事件提供；只有实际目标数量 == 1 才能选择双倍分支，不默认单一目标。' }
    : value);
  resetDisposition(skill);
}

// 卡尔萨斯E保留0.5秒的施放冷却语义；不再把它命名为伤害/资源周期。
{
  const skill = candidate.skills.karthus_e;
  const tick = skill.write.parameters.find(value => value.parameterKey === 'damage_tick_interval_ms');
  if (!tick) throw Error('卡尔萨斯E缺少历史0.5秒字段');
  tick.parameterKey = 'cooldown_ms';
  tick.name = '基础冷却时间（毫秒）';
  tick.sortOrder = 5;
  tick.description = '官方cooldown与当前根cooldownTime[0]均为0.5秒；秒转换为毫秒。仅表示基础施放冷却，不表示伤害或资源结算周期。';
  const proof = skill.proofs.find(value => value.parameterKey === 'damage_tick_interval_ms');
  if (!proof) throw Error('卡尔萨斯E缺少历史0.5秒来源证明');
  proof.parameterKey = 'cooldown_ms';
  proof.source = 'official.cooldown + mSpell.cooldownTime[0]';
  proof.semantic = '0.5秒是施放冷却字段；当前正文只给每秒伤害/法力，不以此证明每半秒结算。';
  skill.pending = skill.pending.map(value => value.component === '污染光环周期与击杀回蓝事件'
    ? { ...value, reason: '官方/根cooldown为500毫秒，仅保留施放冷却语义；光环实际结算周期、离开区域、击杀单位和资源恢复资格待运行时接线，不声明每半秒结算。' }
    : value);
  resetDisposition(skill);
}

// 负值字段按正文中的 *-100 转为正的显示百分数点，避免“负减速”歧义。
for (const skillKey of ['lissandra_q', 'lissandra_r']) {
  const skill = candidate.skills[skillKey];
  const parameter = skill.write.parameters.find(value => value.parameterKey === 'slow_ratio');
  const proof = skill.proofs.find(value => value.parameterKey === 'slow_ratio');
  if (!parameter || !proof) throw Error(`缺少${skillKey}减速字段`);
  parameter.parameterKey = 'slow_percent';
  parameter.name = skillKey === 'lissandra_q' ? '减速百分数点' : '区域减速百分数点';
  parameter.description = skillKey === 'lissandra_q'
    ? '客户端当前根绑定 DataValues.slowPercentage；原始值为负移速修正，当前正文占位为 @slowPercentage*-100@%，转为正的20至36百分数点。'
    : '客户端当前根绑定 DataValues.SlowAmount；原始值为负移速修正，当前正文占位为 @SlowAmount*-100@%，转为正的45至75百分数点。';
  parameter.levelValues = Object.fromEntries(Object.entries(parameter.levelValues).map(([level, value]) => [level, Math.round(-Number(value) * 100)]));
  proof.parameterKey = 'slow_percent';
  proof.values = proof.values.map(value => Math.round(-Number(value) * 100));
  proof.scale = -100;
  proof.semantic = '原始值是负移速修正，正文显式乘-100后显示为正减速百分数点；不再以slow_ratio保留含混负值。';
  resetDisposition(skill);
}

// 丽桑卓R：省略mStat/mStatFormula的PercentMissingHPRatio按既有mStat0窄证绑定来源总法强。
{
  const skill = candidate.skills.lissandra_r;
  const parameter = skill.write.parameters.find(value => value.parameterKey === 'missing_hp_ratio');
  const proof = skill.proofs.find(value => value.parameterKey === 'missing_hp_ratio');
  if (!parameter || !proof) throw Error('丽桑卓R缺少PercentMissingHPRatio参数');
  parameter.parameterKey = 'heal_ap_ratio';
  parameter.name = '基础治疗法强倍率';
  parameter.description = '客户端当前根绑定 DataValues.PercentMissingHPRatio；HealAmount节点省略mStat/mStatFormula，与同版本mStat0默认法强窄证一致，作为基础治疗的来源总法强倍率0.55；不按字段名绑定缺失生命或hp。';
  proof.parameterKey = 'heal_ap_ratio';
  proof.semantic = 'HealAmount具名节点省略mStat/mStatFormula；按同版本mStat0=法强窄证绑定SOURCE/TOTAL ability_power，不把PercentMissingHPRatio字段名当作缺失生命输入。';
  const formula = skill.write.formulas.find(value => value.formulaKey === 'self_heal');
  if (!formula) throw Error('丽桑卓R缺少self_heal公式');
  formula.expression = {
    nodeType: 'OPERATION',
    operation: 'ADD',
    operands: [
      { nodeType: 'PARAMETER', parameterKey: 'self_heal_flat' },
      {
        nodeType: 'OPERATION',
        operation: 'MULTIPLY',
        operands: [
          { nodeType: 'PARAMETER', parameterKey: 'heal_ap_ratio' },
          { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'ability_power', attributeValueKind: 'TOTAL' }
        ]
      }
    ]
  };
  formula.description = 'HealAmount基础项 = SelfCastFlatHeal + PercentMissingHPRatio×来源总法强；同版本省略mStat/mStatFormula的默认法强窄证仅支持这一基础项。已损生命提升另由正文两个数据值描述，未猜分段、取整或封顶。';
  skill.write.parameters = skill.write.parameters.filter(value => value.parameterKey !== 'actual_missing_health');
  skill.pending = skill.pending.filter(value => value.component !== '实际输入：actual_missing_health');
  skill.pending.push({
    kind: '来源',
    component: '自身治疗的已损生命分段提升',
    reason: '正文明确每 SelfCastMissingHPPerAbove% 已损生命使回复提升 SelfCastMissingHPRatio%；两个数据值和分母已保留。实际已损生命分段输入、取整/封顶/归属及时点未在当前原树给出，不把提升猜接入基础公式。'
  });
  const healProof = skill.proofs.find(value => value.source === 'mSpellCalculations.HealAmount');
  if (healProof) healProof.semantic = '保留R治疗树；第二节点按同版本默认mStat0法强窄证进入基础治疗，正文已损生命分段提升另行待核。';
  skill.excluded = skill.excluded.filter(value => value.component !== '独立冰奴实体、死亡触发、范围和爆炸');
  resetDisposition(skill);
}

// 卡尔萨斯死亡状态只排除状态事件；P的7秒窗口与Q/W/E/R主体的法力、伤害和资源参数均保留。
{
  const skill = candidate.skills.karthus_p;
  skill.excluded = [{
    component: '死亡状态变形、触发和免费施法覆盖',
    source: '当前中文绑定 Spell_KarthusDeathDefied_Tooltip；PassiveDuration',
    reason: '本批范围排除独立死亡状态触发、状态替换和免费施法覆盖；P保留正文7秒窗口，Q/W/E/R仍保留各自正常伤害、法力和资源组成，死亡状态对法力消耗的覆盖待运行时接线。'
  }];
  skill.pending = [{
    kind: '系统',
    component: '死亡状态下Q/W/E/R可施放与无消耗覆盖',
    reason: '正文只证明阵亡后持续7秒可无消耗使用技能；Q/W/E/R正常技能主体和资源限制已分别保留，死亡状态触发、可施放资格、无消耗覆盖和窗口结束待运行时接线，不把P扩展成四个技能的完整替换形态。'
  }];
  resetDisposition(skill);
}

candidate.meta.generatedAt = new Date().toISOString();
candidate.meta.apiWrites = 0;
candidate.meta.executor = '第十六批修订版由Codex执行代理准备；仅修订候选与来源边界，未业务写入';
candidate.meta.scope = '修订版：玛尔扎哈、艾尼维亚、丽桑卓、卡尔萨斯各P/Q/W/E/R共20个技能位。保留本技能可独立核验数值、混合技能自身收益、单一敌人==1分支、非英雄前置进度和资源依赖；独立虚灵/冰奴/纯冰墙/完整蛋形态/死亡状态事件按逐支路排除。独立召唤物专用伤害、数量和生命周期不进入写入候选；卡尔萨斯P只排除死亡状态覆盖，Q/W/E/R主体仍保留。';
candidate.meta.unitPolicy += ' 负值SlowAmount/slowPercentage因正文显式乘-100，修订版转为正减速百分数点；不保留含混负slow_ratio。';
candidate.meta.attributeBoundary = '法强和攻击力仅按当前同版本计算树的窄口径留候选；省略统计选择器的具名节点只有在同版本mStat0默认法强或2/2额外攻击力证据支持时才使用。丽桑卓R HealAmount的PercentMissingHPRatio按mStat0默认法强窄证进入基础治疗；SelfCastMissingHPRatio与SelfCastMissingHPPerAbove只记录正文提升参数，不绑定缺失生命输入、分段算法或hp。';
candidate.meta.revision = {
  baseCandidate: '完整候选.json',
  baseCandidateSha256: baseSha256,
  changes: [
    '玛尔扎哈W移除独立虚灵专用伤害、数量、生命周期及小兵/野怪比例；只保留W主体公共参数与排除证据。',
    '玛尔扎哈E移除小兵处决阈值。',
    '丽桑卓P移除全部独立冰奴专用组成。',
    '卡尔萨斯Q移除无消费者的MAX目标数量下限公式，保留actual_target_count说明==1。',
    '卡尔萨斯E将0.5秒字段改为基础施放冷却，不解释为伤害/资源周期。',
    '丽桑卓Q/R将正文*-100的负移速字段转为正减速百分数点。',
    '丽桑卓R HealAmount改为SelfCastFlatHeal+0.55×来源总法强，保留PerAbove和提升百分比参数并待核分段算法。',
    '卡尔萨斯P仅排除死亡状态覆盖，明确Q/W/E/R主体与资源限制仍保留。'
  ],
  historicalCandidatePreserved: true,
  historicalLock: '冻结候选锁.json'
};

const bytes = Buffer.from(JSON.stringify(candidate, null, 2) + '\n');
fs.writeFileSync(new URL('完整候选-修订版.json', here), bytes);
const counts = Object.fromEntries(Object.keys(candidate.skills[Object.keys(candidate.skills)[0]].write).map(kind => [kind, Object.values(candidate.skills).reduce((sum, skill) => sum + skill.write[kind].length, 0)]));
const reused = Object.values(candidate.skills).flatMap(skill => skill.reusedParameters ?? []);
const report = {
  generatedAt: candidate.meta.generatedAt,
  fileSha256: createHash('sha256').update(bytes).digest('hex'),
  planSha256: createHash('sha256').update(JSON.stringify(candidate)).digest('hex'),
  baseCandidateSha256: baseSha256,
  skills: Object.keys(candidate.skills).length,
  order: Object.keys(candidate.skills),
  reusedParameters: reused.length,
  counts,
  apiWrites: 0,
  historicalCandidatePreserved: true,
  source: 'client16.17/official16.17.1'
};
fs.writeFileSync(new URL('候选版本-修订版.json', here), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
