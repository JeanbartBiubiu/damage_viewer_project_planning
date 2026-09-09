import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '../../..');
const planning = path.resolve(webRoot, '..', 'damage_viewer_project_planning');
const batch = path.join(webRoot, '数据参考', '全量录入-2026-09', '交叉试录', 'Luna', '英雄机制第十一批');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const candidateFile = path.join(batch, '完整候选.json');
const candidateBytes = fs.readFileSync(candidateFile);
const candidate = JSON.parse(candidateBytes);
const source = read(path.join(batch, '来源冻结', '主技能数值展开.json'));
const interpolationDocs = read(path.join(webRoot, '数据参考', '全量录入-2026-09', '交叉试录', '通用公式来源补证', '插值及等级公式默认补充.json'));
const breakpointDocs = read(path.join(webRoot, '数据参考', '全量录入-2026-09', '交叉试录', '通用公式来源补证', 'class-ByCharLevelBreakpointsCalculationPart.json'));
const breakpointFieldDocs = read(path.join(webRoot, '数据参考', '全量录入-2026-09', '交叉试录', '通用公式来源补证', 'class-Breakpoint.json'));
const checks = [];
const issues = [];
const check = (name, pass, detail = null) => {
  checks.push({ name, pass, detail });
  if (!pass) issues.push({ name, detail });
};
const skills = candidate.skills;
const sourceHero = hero => source.heroes.find(item => item.id === hero);
const binding = (hero, skillKey) => sourceHero(hero)?.bindings.find(item => item.skillKey === skillKey);
const parameter = (skillKey, parameterKey) => skills[skillKey]?.write.parameters.find(item => item.parameterKey === parameterKey);
const formula = (skillKey, formulaKey) => skills[skillKey]?.write.formulas.find(item => item.formulaKey === formulaKey);

const expectedCandidateSha = '98eb0627937a403ddcecd5b597469271ef5b9e074113083bac38d3572e1f2a83';
check('最终候选散列未漂移', sha(candidateBytes) === expectedCandidateSha, { actual: sha(candidateBytes), expected: expectedCandidateSha });
check('来源展开包含五个待核根绑定', ['irelia_p', 'irelia_w', 'fiora_p', 'gwen_p', 'camille_p'].every(key => {
  const hero = key.split('_')[0];
  return Boolean(binding(hero[0].toUpperCase() + hero.slice(1), key));
}), null);

const interpolationTargets = [
  ['irelia_p', 'Irelia', 'single_stack_attack_speed_percent', 'SingleStackAS', 10, 25],
  ['irelia_w', 'Irelia', 'final_physical_reduction_percent', 'FinalPhysicalDR', 40, 70],
  ['fiora_p', 'Fiora', 'passive_heal_amount', 'PassiveHealAmount', 35, 100],
  ['gwen_p', 'Gwen', 'heal_cap_level', 'HealCap', 12, 40],
];
for (const [skillKey, hero, parameterKey, calculationKey, start, end] of interpolationTargets) {
  const calc = binding(hero, skillKey).calculations[calculationKey];
  const part = calc.mFormulaParts[0];
  const p = parameter(skillKey, parameterKey);
  const linear = Object.fromEntries(Array.from({ length: 18 }, (_, index) => [String(index + 1), Number((start + (end - start) * index / 17).toFixed(6))]));
  check(`${skillKey}/${parameterKey}原始节点为端点插值结构`, part.__type === 'ByCharLevelInterpolationCalculationPart' && part.mStartValue === start && part.mEndValue === end, { part });
  check(`${skillKey}/${parameterKey}候选确实展开18级`, p?.valueMode === 'CHARACTER_LEVEL' && isDeepStrictEqual(p.levelValues, linear), { mode: p?.valueMode, levelValues: p?.levelValues, expectedLinear: linear });
}
const interpolationLimit = interpolationDocs.classes.find(item => item.name === 'ByCharLevelInterpolationCalculationPart')?.limit ?? '';
check('插值通用补证明确保留算法缺口', /起止等级.*特殊插值.*取整.*表索引均未证/.test(interpolationLimit), interpolationLimit);

const breakpointTargets = [
  ['passive_cooldown_seconds', 14, [{ mLevel: 7, mAdditionalBonusAtThisLevel: -3 }, { mLevel: 13, mAdditionalBonusAtThisLevel: -3 }], [14, 14, 14, 14, 14, 14, 11, 11, 11, 11, 11, 11, 8, 8, 8, 8, 8, 8]],
  ['shield_level_ratio', 0.1, [{ mLevel: 7, mAdditionalBonusAtThisLevel: 0.05 }, { mLevel: 13, mAdditionalBonusAtThisLevel: 0.05 }, { mLevel: 19, mAdditionalBonusAtThisLevel: 0.05 }], [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2]],
];
const camille = binding('Camille', 'camille_p');
for (const [parameterKey, initial, expectedBreakpoints, expanded] of breakpointTargets) {
  const calcKey = parameterKey === 'passive_cooldown_seconds' ? 'PassiveCooldown' : 'ShieldAmount';
  const part = calcKey === 'ShieldAmount' ? camille.calculations[calcKey].mFormulaParts[0].mSubpart : camille.calculations[calcKey].mFormulaParts[0];
  const p = parameter('camille_p', parameterKey);
  const actualBreakpoints = part.mBreakpoints.map(({ mLevel, mAdditionalBonusAtThisLevel }) => ({ mLevel, mAdditionalBonusAtThisLevel }));
  const breakpointsMatch = actualBreakpoints.length === expectedBreakpoints.length && actualBreakpoints.every((item, index) => item.mLevel === expectedBreakpoints[index].mLevel && Math.abs(item.mAdditionalBonusAtThisLevel - expectedBreakpoints[index].mAdditionalBonusAtThisLevel) < 1e-6);
  check(`camille_p/${parameterKey}断点原始值完整`, Math.abs(part.mLevel1Value - initial) < 1e-6 && breakpointsMatch, { part });
  check(`camille_p/${parameterKey}候选采用断点展开`, p?.valueMode === 'CHARACTER_LEVEL' && isDeepStrictEqual(Object.keys(p.levelValues ?? {}).sort((a, b) => Number(a) - Number(b)).map(level => p.levelValues[level]), expanded), { mode: p?.valueMode, levelValues: p?.levelValues, expectedExpanded: expanded });
}
check('断点类型资料没有声明求值顺序', !('evaluation' in breakpointDocs) && !('algorithm' in breakpointDocs) && !('semantics' in breakpointFieldDocs), { breakpointDocs, breakpointFieldDocs });

const gwenText = skills.gwen_p.source.currentBoundText.keys.keyTooltip.text;
const gwenCap = formula('gwen_p', 'heal_cap');
const gwenHeal = formula('gwen_p', 'passive_heal_amount');
check('格温当前绑定明确把HealCap作为自身治疗上限', /自身获得治疗效果/.test(gwenText) && /至多至.*healcap/.test(gwenText), { text: gwenText });
check('格温候选已把治疗比例与实际英雄伤害相乘', JSON.stringify(gwenHeal?.expression).includes('healing_ratio') && JSON.stringify(gwenHeal?.expression).includes('actual_passive_hero_damage'), gwenHeal?.expression);
check('格温候选治疗公式仍缺上限裁剪', gwenHeal?.expression?.operation === 'MIN' && JSON.stringify(gwenHeal.expression).includes('heal_cap'), { expression: gwenHeal?.expression, healCapFormula: gwenCap?.expression });

const output = {
  generatedAt: new Date().toISOString(),
  pass: issues.length === 0,
  candidateSha256: sha(candidateBytes),
  checks,
  issues,
  conclusions: {
    interpolation: '四个端点插值节点只有起止值；通用类补证明确未证特殊插值、取整、表索引和默认等级范围，不能把端点直接展开成18级线性表。',
    breakpoints: '卡蜜尔P两个断点节点保留了原始字段，但现有类资料没有证明断点当级和额外值是累加还是替换；当前14/11/8与0.1/0.15/0.2展开不能作为已证等级数组。',
    gwenHealing: '格温同一根绑定文本明确“至多至healcap”，治疗公式必须把0.67×实际对英雄伤害与heal_cap取较小值；当前候选未做裁剪。',
  },
  recommendedChanges: [
    'irelia_p/single_stack_attack_speed_percent、irelia_w/final_physical_reduction_percent、fiora_p/passive_heal_amount、gwen_p/heal_cap_level 改为 RUNTIME_INPUT，fixedValue 与 levelValues 均为 null，保留来源端点proof及原参数键。',
    'camille_p/passive_cooldown_seconds、camille_p/shield_level_ratio 同样改为 RUNTIME_INPUT，保留断点对象和原字段证据。',
    'gwen_p/passive_heal_amount 改为 MIN(healing_ratio×actual_passive_hero_damage, heal_cap)，并补未超上限与超过上限两个算例；不把0.67倍未裁剪值称最终治疗。',
  ],
  evidence: {
    candidate: candidateFile,
    sourceExpansion: path.join(batch, '来源冻结', '主技能数值展开.json'),
    interpolationSupplement: path.join(webRoot, '数据参考', '全量录入-2026-09', '交叉试录', '通用公式来源补证', '插值及等级公式默认补充.json'),
    breakpointClasses: [path.join(webRoot, '数据参考', '全量录入-2026-09', '交叉试录', '通用公式来源补证', 'class-ByCharLevelBreakpointsCalculationPart.json'), path.join(webRoot, '数据参考', '全量录入-2026-09', '交叉试录', '通用公式来源补证', 'class-Breakpoint.json')],
  },
  boundary: '本报告只读本地候选和冻结来源；未改候选、未调用业务写入、未运行战斗。',
};
fs.writeFileSync(path.join(here, '等级曲线与治疗绑定核对.json'), JSON.stringify(output, null, 2) + '\n');
const report = [
  '# 英雄11等级曲线与治疗绑定核对',
  '',
  `候选散列：\`${output.candidateSha256}\`；报告结论：${output.pass ? '通过' : '发现阻塞'}。`,
  '',
  '原始计算树只给出四个 `ByCharLevelInterpolationCalculationPart` 的起止值。通用补证文件明确写出特殊插值、取整、表索引和默认等级范围尚未证实，因此现有四个18级线性数组是把端点当算法的展开，不能作为已证逐级值。建议将四项改为运行时输入，保留端点来源证据。',
  '',
  '卡蜜尔P的 `ByCharLevelBreakpointsCalculationPart` 原始断点分别是冷却14并在7、13级各有-3，护盾比例0.1并在7、13、19级各有0.05。类资料只列字段，没有证明断点当级、额外值累加或替换的求值顺序；现有14/11/8和0.1/0.15/0.2数组同样应改为运行时输入。',
  '',
  '格温当前绑定文本把 `healcap` 放在“自身治疗至多至”之后，明确是该治疗的上限。当前 `passive_heal_amount` 只计算0.67乘实际对英雄伤害，缺少与 `heal_cap` 的最小值裁剪；应补为 `MIN(healing_ratio×actual_passive_hero_damage, heal_cap)`，并用超限和未超限算例验证。',
  '',
  '本报告仅核对本地冻结证据和候选，未写候选或业务接口，也没有运行战斗。',
  '',
  '## 检查结果',
  '',
  ...checks.map(item => `- ${item.pass ? '通过' : '阻塞'}：${item.name}`),
  '',
  `结构化证据：\`${path.join(here, '等级曲线与治疗绑定核对.json')}\`。`,
  '',
].join('\n');
fs.writeFileSync(path.join(here, '等级曲线与治疗绑定核对报告.md'), report);
console.log(JSON.stringify({ pass: output.pass, candidateSha256: output.candidateSha256, checks: checks.length, issues: issues.length }));
