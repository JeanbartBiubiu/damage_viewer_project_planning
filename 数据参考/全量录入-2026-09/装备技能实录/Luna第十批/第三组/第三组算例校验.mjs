import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const here = new URL('./', import.meta.url);
const sourceUrl = new URL('第三组录入候选.json', here);
const sourceBytes = await readFile(sourceUrl);
const source = JSON.parse(sourceBytes.toString('utf8'));
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
const objects = [];
function param(object, key) {
  const value = object.candidate.parameters.find(item => item.parameterKey === key);
  if (!value) throw new Error(object.equipmentKey + '缺少参数 ' + key);
  return value.fixedValue;
}
function check(list, sample, calculation, actual, expected, unit, boundary) {
  list.push({ sample, calculation, actual, expected, unit, passed: Object.is(actual, expected), boundary });
}
for (const object of source.objects) {
  const checks = [];
  if (object.equipmentKey === 'item_3053') {
    const ratio = param(object, 'bonus_ad_from_base_attack_ratio');
    const threshold = param(object, 'lifeline_health_threshold');
    const duration = param(object, 'lifeline_shield_duration_ms');
    const shieldRatio = param(object, 'lifeline_shield_bonus_health_ratio');
    const cooldown = param(object, 'lifeline_cooldown_ms');
    check(checks, '基础攻击力100的抓人双爪候选贡献', '100 × ratio', 100 * ratio, 50, '额外攻击力', '参数算例，不生成公式或应用事件');
    check(checks, '救主灵刃阈值', 'threshold', threshold, 0.3, '小数比例', '只核对30%小数比例');
    check(checks, '额外生命值1000的护盾基数候选', '1000 × shieldRatio', 1000 * shieldRatio, 600, '护盾值', '护盾取值时点和衰减待核');
    check(checks, '护盾时长换算', 'duration ÷ 1000', duration / 1000, 4.5, '秒', '不生成衰减首段或周期');
    check(checks, '冷却换算', 'cooldown ÷ 1000', cooldown / 1000, 90, '秒', '不生成冷却触发规则');
  } else if (object.equipmentKey === 'item_3068') {
    const baseDamage = param(object, 'immolate_base_damage_per_tick');
    const ratio = param(object, 'immolate_bonus_health_ratio_per_tick');
    const rate = param(object, 'immolate_ticks_per_second');
    const duration = param(object, 'immolate_duration_ms');
    const oneTick = baseDamage + 1000 * ratio;
    check(checks, '额外生命值1000时每次献祭候选伤害', 'baseDamage + 1000 × ratio', oneTick, 35, '魔法伤害/次', '仅参数算例，不生成周期效果');
    check(checks, '同一输入下DPS显示速率', 'oneTick × rate', oneTick * rate, 35, '魔法伤害/秒速率', '1次/秒不等于1000毫秒首跳');
    check(checks, '献祭持续时间换算', 'duration ÷ 1000', duration / 1000, 3, '秒', '刷新、结束和首跳待核');
    check(checks, '百分比归一化', '1.5 ÷ 100', ratio, 0.015, '小数比例', '1.5%不是1.5个百分点');
  }
  objects.push({ equipmentKey: object.equipmentKey, checks, formulaCount: object.candidate.formulas.length, effectCount: object.candidate.effects.length, triggerRuleCount: object.candidate.triggerRules.length });
}
const report = { generatedAt: new Date().toISOString(), mode: '独立重算参数算例；无API公式/效果/规则', sourceCandidateSha256: sourceSha256, objects, totalChecks: objects.reduce((sum, item) => sum + item.checks.length, 0), passedChecks: objects.reduce((sum, item) => sum + item.checks.filter(check => check.passed).length, 0) };
report.passed = report.totalChecks === report.passedChecks && objects.every(item => item.formulaCount === 0 && item.effectCount === 0 && item.triggerRuleCount === 0);
const out = new URL('第三组算例校验.json', here);
await writeFile(out, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ file: out.pathname, sourceCandidateSha256: sourceSha256, totalChecks: report.totalChecks, passedChecks: report.passedChecks, passed: report.passed }, null, 2));
if (!report.passed) process.exitCode = 1;
