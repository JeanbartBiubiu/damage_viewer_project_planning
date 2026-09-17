import fs from 'node:fs';
import { createHash } from 'node:crypto';

const here = new URL('./', import.meta.url);
const rootPath = new URL('根绑定与数值证据.json', here);
const candidatePath = new URL('完整候选-修订版2.json', here);
const textPath = new URL('补充文本证据.json', here);
const narrowPath = new URL('../../通用公式来源补证/结论与边界.json', here);
const defaultsPath = new URL('../../通用公式来源补证/同构建类型与默认.json', here);
const read = url => fs.readFileSync(url, 'utf8');
const readJson = url => JSON.parse(read(url));
const sha = url => createHash('sha256').update(read(url)).digest('hex');
const roots = readJson(rootPath);
const candidate = readJson(candidatePath);
const text = readJson(textPath);
const narrow = readJson(narrowPath);
const defaults = readJson(defaultsPath);

const sourceBySkill = new Map();
for (const hero of roots.heroes) {
  for (const spell of hero.spells ?? []) sourceBySkill.set(spell.skillKey, { hero, spell });
}
const included = {};
for (const [skillKey, skill] of Object.entries(candidate.skills)) {
  const source = sourceBySkill.get(skillKey);
  included[skillKey] = {
    name: skill.name,
    source: {
      hero: source?.hero.id,
      rootPath: source?.hero.rootPath,
      spellPath: source?.spell.binding,
      clientSha256: skill.source.clientSha256,
      officialSha256: skill.source.officialSha256,
      boundText: skill.source.currentBoundText
    },
    write: {
      parameters: skill.write.parameters.map(value => value.parameterKey),
      formulas: skill.write.formulas.map(value => value.formulaKey),
      effects: skill.write.effects.map(value => value.effectKey),
      processes: skill.write.processes.map(value => value.processKey),
      internalStates: skill.write.internalStates.map(value => value.stateKey),
      triggerRules: skill.write.triggerRules.map(value => value.ruleKey)
    },
    reusedParameters: skill.reusedParameters ?? [],
    excluded: skill.excluded,
    pending: skill.pending
  };
}

const lissandraR = sourceBySkill.get('lissandra_r').spell;
const healPart = lissandraR.object.mSpell.mSpellCalculations.HealAmount.mFormulaParts[1];
const calculatedPart = lissandraR.object.mSpell.mSpellCalculations.CalculatedDamage.mFormulaParts[1];
const karthusDeath = sourceBySkill.get('karthus_p')?.spell;
const malzaharW = sourceBySkill.get('malzahar_w')?.spell;

const report = {
  generatedAt: new Date().toISOString(),
  candidateFile: '完整候选-修订版2.json',
  candidateSha256: sha(candidatePath),
  sources: {
    rootEvidenceFile: '根绑定与数值证据.json',
    rootEvidenceSha256: sha(rootPath),
    textEvidenceFile: '补充文本证据.json',
    textEvidenceSha256: sha(textPath),
    narrowMappingFile: 'C:/project/damage_web_dev/数据参考/全量录入-2026-09/交叉试录/通用公式来源补证/结论与边界.json',
    narrowMappingSha256: sha(narrowPath),
    constructorDefaultsFile: 'C:/project/damage_web_dev/数据参考/全量录入-2026-09/交叉试录/通用公式来源补证/同构建类型与默认.json',
    constructorDefaultsSha256: sha(defaultsPath)
  },
  included,
  revisedBoundaries: [
    {
      skillKey: 'malzahar_w',
      retained: ['cooldown_ms', 'mana_cost', 'cast_time_ms', 'mana_cost效果'],
      excluded: ['StackCap跨技能层数及其独立虚灵数量消费', 'VoidlingDuration', 'VoidlingBaseDamage', 'ADRatio', 'APRatio', '角色等级虚灵成长', 'actual_stack_count', '召唤数量常量与封顶公式', 'LaneMinionMod', 'EpicMonsterMod'],
      evidence: {
        tooltip: malzaharW?.officialTooltip,
        dataValues: (malzaharW?.object.mSpell.DataValues ?? []).filter(value => ['StackCap', 'VoidlingDuration', 'VoidlingBaseDamage', 'ADRatio', 'APRatio', 'LaneMinionMod', 'EpicMonsterMod'].includes(value.name)),
        calculationKeys: Object.keys(malzaharW?.object.mSpell.mSpellCalculations ?? {})
      },
      decision: '独立虚灵实体、攻击、生命周期和小兵/史诗野怪专用分支不进入本批；正文证明的跨技能叠层只保留排除来源。'
    },
    {
      skillKey: 'malzahar_e',
      retained: ['cooldown_ms', 'mana_cost', 'cast_time_ms', 'base_damage', 'duration_ms', 'ap_ratio_constant', 'damage公式', 'mana_cost效果'],
      excluded: ['MinionExecuteThreshold小兵处决阈值'],
      decision: '小兵限定处决阈值移到范围外证据；E总伤害关系、持续、法力和非小兵主体保留。'
    },
    {
      skillKey: 'anivia_p',
      retained: [],
      excluded: ['Cooldown复活冷却', 'BonusResists等级曲线', 'BonusResistsTooltip反号显示常量与公式', '6秒复活等待', '完整蛋形态触发与受击过程'],
      decision: '完整蛋形态及其专用参数、反号显示和受击复活过程按本批范围外处理；角色名称、根绑定和来源元信息仍保留。'
    },
    {
      skillKey: 'lissandra_p',
      retained: [],
      excluded: ['MoveSpeedMod', 'ExplosionDelay', 'Range', 'Radius', 'TotalDamage及其等级曲线/法强项', '独立冰奴实体与死亡触发'],
      decision: 'P全部是独立冰奴专用支路，本批不把其专用组成并入技能位；原始字段与计算树保留在候选排除证据。'
    },
    {
      skillKey: 'karthus_q',
      retained: ['mana_cost', 'base_damage', 'ap_ratio', 'single_target_multiplier', 'actual_target_count', 'damage公式', 'single_target_damage公式', 'mana_cost效果'],
      excluded: ['无消费者的single_target_eligibility_lower_bound公式', 'one常量'],
      decision: '实际目标数量只作为运行输入说明；只有实际数量 == 1 时选择双倍分支，不以MAX把0/负值改成1。'
    },
    {
      skillKey: 'karthus_e',
      retained: ['cooldown_ms=500', 'mana_cost', 'damage_per_second_base', 'ap_ratio_per_second', 'mana_restore_on_kill', 'quarter_multiplier', 'damage_per_second公式', 'quarter_damage_per_second公式', 'mana_cost效果', 'mana_restore_on_kill效果'],
      excluded: ['以0.5秒作为damage_tick_interval_ms的错误命名'],
      decision: '0.5秒只按官方/root cooldownTime冷却保留；没有周期绑定，不声明每半秒伤害或资源结算。'
    },
    {
      skillKey: 'lissandra_q',
      retained: ['slow_percent正显示百分数点', 'base_damage', 'slow_duration_ms', 'damage公式', 'mana_cost效果'],
      excluded: ['slow_ratio负值命名'],
      decision: '原始slowPercentage负移速修正按正文*-100转为正20/24/28/32/36减速百分数点。'
    },
    {
      skillKey: 'lissandra_r',
      retained: ['slow_percent正显示百分数点', 'self_heal_missing_hp_percent', 'self_heal_missing_hp_per_above_percent', 'heal_ap_ratio', 'self_heal基础公式', 'damage公式'],
      excluded: ['slow_ratio负值命名', 'actual_missing_health直连HealAmount'],
      decision: 'HealAmount基础项按SelfCastFlatHeal + 0.55×来源总法强；已损生命提升的两个正文参数另行保留，分段输入/取整/封顶/归属及时点未知，不猜接线。'
    },
    {
      skillKey: 'karthus_p',
      retained: ['death_recast_window_ms=7000'],
      excluded: [],
      decision: '死亡后继续施法、7秒窗口和无消耗说明属于本批范围内系统待接；Q/W/E/R的正常技能主体与法力/资源限制继续保留。',
      deathText: text.skills?.karthus_p?.keys?.keyTooltip?.text ?? karthusDeath?.officialTooltip
    }
  ],
  lissandraRHealGuard: {
    rootBinding: lissandraR?.binding,
    healAmountPart: healPart,
    calculatedDamagePart: calculatedPart,
    omittedFieldGuard: 'HealAmount第二节点与CalculatedDamage第二节点同为StatByNamedDataValueCalculationPart且均省略mStat/mStatFormula；不因数据字段名PercentMissingHPRatio绑定hp或实际缺失生命。',
    narrowMapping: {
      confirmedKey: 'legacy-stat-constructor',
      boundedInferenceKey: 'mStat0-AP',
      conclusion: narrow.boundedInferences.find(value => value.key === 'mStat0-AP'),
      constructorDefaults: defaults.classes?.StatByNamedDataValueCalculationPart?.raw?.defaults
    },
    chosenBaseFormula: 'SelfCastFlatHeal + PercentMissingHPRatio×SOURCE/TOTAL ability_power',
    missingHealthText: text.skills?.lissandra_r?.keys?.keyTooltip?.text ?? '当前绑定文本在候选source中保留；请以补充文本证据.json核对',
    preservedEnhancementParameters: ['SelfCastMissingHPRatio', 'SelfCastMissingHPPerAbove'],
    notInferred: ['actual_missing_health输入', 'hp属性', '已损生命分段取整', '封顶', '所有者', '治疗时点']
  },
  deathStateGuard: {
    sourceText: text.skills?.karthus_p?.keys?.keyTooltip?.text ?? karthusDeath?.officialTooltip,
    normalSkillSlotsRetained: ['karthus_q', 'karthus_w', 'karthus_e', 'karthus_r'],
    normalResourceComponentsRetained: {
      karthus_q: ['mana_cost'],
      karthus_w: ['mana_cost'],
      karthus_e: ['mana_cost', 'mana_restore_on_kill'],
      karthus_r: ['mana_cost']
    },
    stateOverridePending: '死亡状态触发、窗口结束、Q/W/E/R可施放资格和无消耗覆盖属于本批范围内系统待接；不新增假过程，也不把死亡状态扩展为技能主体替换。'
  },
  businessWrites: 0
};
fs.writeFileSync(new URL('修订组件来源摘要-修订版2.json', here), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ candidateSha256: report.candidateSha256, skills: Object.keys(included).length, businessWrites: 0 }, null, 2));
