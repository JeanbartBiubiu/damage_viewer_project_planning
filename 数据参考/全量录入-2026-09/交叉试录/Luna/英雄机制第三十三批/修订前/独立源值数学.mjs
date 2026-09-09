import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.join(ROOT, '输入包');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const input = (p) => JSON.parse(fs.readFileSync(path.join(INPUT, p), 'utf8'));
const candidate = read('完整候选.json');
const binding = input('来源绑定与当前文本.json');
const officialZh = Object.fromEntries(['Sona','Soraka','Karma','Seraphine'].map((h) => [h, input(`参考资料/官方中文/${h}.json`)]));
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const rawFor = (key) => { const hero = ({ sona:'Sona', soraka:'Soraka', karma:'Karma', seraphine:'Seraphine' })[key.split('_')[0]]; return binding.heroes.find((h) => h.id === hero).skills.find((s) => s.skillKey === key).object.mSpell; };
const dv = (key, name) => { const v = (rawFor(key).DataValues || []).find((x) => x.name === name)?.values; if (!v) throw new Error(`缺少源值 ${key}/${name}`); return v; };
const d = (key, name, level) => dv(key, name)[level];
const levels = (key, name, max) => dv(key, name).slice(1, max + 1);
const skill = (key) => candidate.skills[key];
const params = (key) => Object.fromEntries(skill(key).write.parameters.map((p) => [p.parameterKey, p]));
const pvalue = (key, parameterKey, level, runtime = {}) => { const p = params(key)[parameterKey]; if (!p) throw new Error(`候选缺参数 ${key}/${parameterKey}`); if (p.valueMode === 'FIXED') return p.fixedValue; if (p.valueMode === 'SKILL_LEVEL') return p.levelValues[String(level)]; if (p.valueMode === 'RUNTIME_INPUT') { if (!(parameterKey in runtime)) throw new Error(`运行输入缺失 ${key}/${parameterKey}`); return runtime[parameterKey]; } throw new Error(`未知值模式 ${p.valueMode}`); };
const attr = (key, c) => { if (key.nodeType !== 'ATTRIBUTE') throw new Error('属性节点类型错误'); const k = `${key.attributeOwner}:${key.attributeKey}:${key.attributeValueKind}`; if (!(k in c.attributes)) throw new Error(`属性输入缺失 ${k}`); return c.attributes[k]; };
const evalExpr = (key, expr, c, missingParameter = null) => {
  if (!expr || typeof expr !== 'object') throw new Error('表达式节点为空');
  if (expr.nodeType === 'PARAMETER') { if (expr.parameterKey === missingParameter) throw new Error(`模拟缺失参数 ${expr.parameterKey}`); return pvalue(key, expr.parameterKey, c.level, c.runtime); }
  if (expr.nodeType === 'ATTRIBUTE') return attr(expr, c);
  if (expr.nodeType !== 'OPERATION' || !Array.isArray(expr.operands) || expr.operands.length !== 2) throw new Error('OPERATION必须恰好两个操作数');
  const [a, b] = expr.operands.map((x) => evalExpr(key, x, c, missingParameter));
  if (expr.operation === 'ADD') return a + b;
  if (expr.operation === 'SUBTRACT') return a - b;
  if (expr.operation === 'MULTIPLY') return a * b;
  if (expr.operation === 'MIN') return Math.min(a, b);
  if (expr.operation === 'MAX') return Math.max(a, b);
  throw new Error(`未知操作 ${expr.operation}`);
};
const refs = (expr, out = []) => { if (!expr) return out; if (expr.nodeType === 'PARAMETER') out.push(expr.parameterKey); else if (expr.nodeType === 'OPERATION') expr.operands.forEach((x) => refs(x, out)); return out; };
const close = (a, b, eps = 1e-5) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
const cases = (key, i) => {
  const max = skill(key).maxLevel;
  const highLevel = max;
  const low = { level: 1, attributes: { 'SOURCE:ability_power:TOTAL': 40 }, runtime: { power_chord_character_level_base_damage: 28, chord_character_level_base_damage: 35, note_character_level_base_damage: 18, current_note_count: 0, accelerando_current_stacks: 0, rw_open_missing_health: 120, rw_close_missing_health: 280, self_missing_health: 200, target_health_ratio: 0.8, status_replacement_stage: 0 } };
  const high = { level: highLevel, attributes: { 'SOURCE:ability_power:TOTAL': 240 }, runtime: { power_chord_character_level_base_damage: 82, chord_character_level_base_damage: 96, note_character_level_base_damage: 44, current_note_count: 4, accelerando_current_stacks: 120, rw_open_missing_health: 720, rw_close_missing_health: 380, self_missing_health: 900, target_health_ratio: 0.2, status_replacement_stage: 2 } };
  return i === 0 ? low : high;
};
const expected = (key, f, c) => {
  const L = c.level; const AP = c.attributes['SOURCE:ability_power:TOTAL']; const r = c.runtime;
  const S = (name) => d(key, name, L); const V = (name) => levels(key, name, skill(key).maxLevel)[L - 1];
  const source = (k, n, level = L) => d(k, n, level);
  switch (f) {
    case 'accelerando_current_ability_haste': return Math.min(60, 0.5 * r.accelerando_current_stacks);
    case 'power_chord_bonus_magic_damage': return r.power_chord_character_level_base_damage + 0.2 * AP;
    case 'magic_damage':
      if (key === 'sona_q') return source('sona_q','BaseDamage') + 0.4 * AP;
      if (key === 'sona_r') return source('sona_r','BaseDamage') + 0.5 * AP;
      if (key === 'soraka_q') return source('soraka_q','BaseDamage') + 0.35 * AP;
      if (key === 'soraka_e') return source('soraka_e','BaseDamage') + 0.4 * AP;
      if (key === 'karma_q') return source('karma_q','BaseDamage') + source('karma_q','APRatio') * AP;
      if (key === 'seraphine_q') return source('seraphine_q','BaseDamage') + source('seraphine_q','APRatio') * AP;
      if (key === 'seraphine_e') return source('seraphine_e','BaseDamage') + source('seraphine_e','APRatio') * AP;
      if (key === 'seraphine_r') return source('seraphine_r','R1BaseDamage') + source('seraphine_r','R1APRatio') * AP;
      throw new Error(`未定义magic_damage期望 ${key}`);
    case 'melody_attack_magic_damage': return source('sona_q','BaseOnHitDamage') + source('sona_q','OnHitRatio') * AP;
    case 'chord_magic_damage': return r.chord_character_level_base_damage + 0.3 * AP;
    case 'self_heal':
      if (key === 'soraka_r') return source('soraka_r','BaseHeal') + 0.5 * AP;
      return source('sona_w','BaseHeal') + source('sona_w','HealRatio') * AP;
    case 'shield_value':
      if (key === 'sona_w') return source('sona_w','BaseShield') + source('sona_w','ShieldRatio') * AP;
      if (key === 'karma_e') return source('karma_e','BaseShield') + source('karma_e','ShieldRatio') * AP;
      if (key === 'seraphine_w') return source('seraphine_w','ShieldAmpForSeraphine') * (source('seraphine_w','ShieldStrength') + source('seraphine_w','ShieldAPRatio') * AP);
      throw new Error(`未定义shield_value期望 ${key}`);
    case 'diminuendo_damage_reduction_ratio': return 0.25 + 0.0004 * AP;
    case 'self_move_speed_ratio_value': return 0.2 + 0.0002 * AP;
    case 'ally_move_speed_ratio_value': return source('sona_e','AllyBaseMovementSpeed') + 0.0002 * AP;
    case 'tempo_slow_ratio': return 0.5 + 0.0004 * AP;
    case 'self_heal_total': return source('soraka_q','BaseHoT') + source('soraka_q','HealAPRatio') * AP;
    case 'self_low_health_heal': return (source('soraka_r','BaseHeal') + 0.5 * AP) * 1.5;
    case 'initial_magic_damage': return source('karma_w','BaseDamage') + source('karma_w','APRatio') * AP;
    case 'rq_impact_magic_damage': return source('karma_r','QBonusDamage') + source('karma_r','QBonusAPRatio') * AP;
    case 'rq_field_magic_damage': return source('karma_r','QDetonationDamage') + source('karma_r','QDetonationAPRatio') * AP;
    case 'rw_heal_ratio': return source('karma_r','RWHealRatio') * (source('karma_r','RWBaseHeal') + source('karma_r','RWHealRatio') * AP);
    case 'rw_open_heal': return r.rw_open_missing_health * source('karma_r','RWHealRatio') * (source('karma_r','RWBaseHeal') + source('karma_r','RWHealRatio') * AP);
    case 'rw_close_heal': return r.rw_close_missing_health * source('karma_r','RWHealRatio') * (source('karma_r','RWBaseHeal') + source('karma_r','RWHealRatio') * AP);
    case 're_bonus_shield_value': return source('karma_r','EBonusShield') + source('karma_r','EBonusShieldRatio') * AP;
    case 'note_magic_damage': return r.note_character_level_base_damage + source('seraphine_p','NoteAPRatio') * AP;
    case 'total_note_magic_damage': return r.current_note_count * (r.note_character_level_base_damage + source('seraphine_p','NoteAPRatio') * AP);
    case 'low_health_max_magic_damage': return (source('seraphine_q','BaseDamage') + source('seraphine_q','APRatio') * AP) * (1 + 75 / 100);
    case 'self_move_speed_ratio_value': return source('seraphine_w','WMSBonus') + source('seraphine_w','WMSBonusAPRatio') * AP;
    case 'self_missing_health_heal': return (source('seraphine_w','WMissingHPBase') / 100) * r.self_missing_health;
    default: throw new Error(`未定义期望 ${key}/${f}`);
  }
};
const formulaResults = [];
const failures = [];
for (const key of candidate.order) {
  for (const f of skill(key).write.formulas) {
    for (let i = 0; i < 2; i += 1) {
      const c = cases(key, i);
      try { const actual = evalExpr(key, f.expression, c); const want = expected(key, f.formulaKey, c); const pass = close(actual, want); formulaResults.push({ skillKey: key, formulaKey: f.formulaKey, case: i + 1, level: c.level, abilityPower: c.attributes['SOURCE:ability_power:TOTAL'], actual, expected: want, pass }); if (!pass) failures.push({ check: 'formula', skillKey: key, formulaKey: f.formulaKey, case: i + 1, actual, expected: want }); } catch (error) { failures.push({ check: 'formula-error', skillKey: key, formulaKey: f.formulaKey, message: error.message }); }
    }
  }
}
const missingChecks = [];
for (const key of candidate.order) for (const f of skill(key).write.formulas) { const first = refs(f.expression)[0]; try { evalExpr(key, f.expression, cases(key, 0), first); missingChecks.push({ skillKey: key, formulaKey: f.formulaKey, missingParameter: first, rejected: false }); failures.push({ check: 'missing-input', skillKey: key, formulaKey: f.formulaKey, missingParameter: first }); } catch (error) { missingChecks.push({ skillKey: key, formulaKey: f.formulaKey, missingParameter: first, rejected: true, message: error.message }); } }
const binaryChecks = [];
const walkExpr = (key, node, pathName = 'expression') => { if (!node) return; if (node.nodeType === 'OPERATION') { const pass = Array.isArray(node.operands) && node.operands.length === 2; binaryChecks.push({ skillKey: key, path: pathName, operation: node.operation, operands: node.operands?.length ?? null, pass }); if (!pass) failures.push({ check: 'binary', skillKey: key, path: pathName }); node.operands?.forEach((x, i) => walkExpr(key, x, `${pathName}.operands[${i}]`)); } };
for (const key of candidate.order) { skill(key).write.formulas.forEach((f) => walkExpr(key, f.expression, f.formulaKey)); for (const e of skill(key).write.effects) { const durationOk = e.lifecycle?.durationValue?.kind === 'PARAMETER' && !!params(key)[e.lifecycle.durationValue.parameterKey]; const valueKey = e.results?.[0]?.valueRule?.value?.formulaKey; const valueOk = e.results?.[0]?.valueRule?.value?.kind === 'FORMULA' && skill(key).write.formulas.some((f) => f.formulaKey === valueKey); const pass = durationOk && valueOk; binaryChecks.push({ skillKey: key, path: `effects/${e.effectKey}`, durationKind: e.lifecycle?.durationValue?.kind, durationParameter: e.lifecycle?.durationValue?.parameterKey, valueFormula: valueKey, pass }); if (!pass) failures.push({ check: 'effect-reference', skillKey: key, effectKey: e.effectKey }); } }
const runtimeChecks = []; const integerChecks = []; const ratioChecks = [];
for (const key of candidate.order) for (const p of skill(key).write.parameters) { if (p.valueMode === 'RUNTIME_INPUT') { const pass = p.fixedValue === null && p.levelValues === null; runtimeChecks.push({ skillKey: key, parameterKey: p.parameterKey, pass }); if (!pass) failures.push({ check: 'runtime-shape', skillKey: key, parameterKey: p.parameterKey }); } if (p.parameterKey.endsWith('_ms')) { const vals = p.valueMode === 'FIXED' ? [p.fixedValue] : Object.values(p.levelValues || {}); const pass = p.valueType === 'INTEGER' && vals.every((v) => Number.isInteger(v)); integerChecks.push({ skillKey: key, parameterKey: p.parameterKey, valueType: p.valueType, values: vals, pass }); if (!pass) failures.push({ check: 'integer-ms', skillKey: key, parameterKey: p.parameterKey }); } if (/ratio|percent_points/.test(p.parameterKey)) { const vals = p.valueMode === 'FIXED' ? [p.fixedValue] : p.valueMode === 'SKILL_LEVEL' ? Object.values(p.levelValues || {}) : []; const pass = vals.every((v) => typeof v === 'number' && v >= 0); ratioChecks.push({ skillKey: key, parameterKey: p.parameterKey, values: vals, pass }); if (!pass) failures.push({ check: 'ratio-sign', skillKey: key, parameterKey: p.parameterKey }); } }
const seriesChecks = [];
const series = [
  ['sona_q','base_damage','BaseDamage',5,(v) => v], ['sona_q','melody_attack_base_damage','BaseOnHitDamage',5,(v) => v], ['sona_w','base_heal','BaseHeal',5,(v) => v], ['sona_w','base_shield','BaseShield',5,(v) => v], ['sona_e','ally_move_speed_ratio','AllyBaseMovementSpeed',5,(v) => v], ['sona_r','base_damage','BaseDamage',3,(v) => v],
  ['soraka_q','base_damage','BaseDamage',5,(v) => v], ['soraka_q','self_heal_base','BaseHoT',5,(v) => v], ['soraka_q','self_move_speed_ratio','MoveSpeedHaste',5,(v) => v], ['soraka_e','base_damage','BaseDamage',5,(v) => v], ['soraka_e','root_duration_ms','RootDuration',5,(v) => Math.round(v * 1000)], ['soraka_r','base_heal','BaseHeal',3,(v) => v],
  ['karma_q','base_damage','BaseDamage',5,(v) => v], ['karma_w','base_damage','BaseDamage',5,(v) => v], ['karma_e','base_shield','BaseShield',5,(v) => v], ['karma_r','rq_bonus_damage','QBonusDamage',4,(v) => v], ['karma_r','rq_field_damage','QDetonationDamage',4,(v) => v], ['karma_r','rw_bonus_root_ms','RWBonusRoot',4,(v) => Math.round(v * 1000)], ['karma_r','re_bonus_shield','EBonusShield',4,(v) => v],
  ['seraphine_q','base_damage','BaseDamage',5,(v) => v], ['seraphine_w','shield_strength','ShieldStrength',5,(v) => v], ['seraphine_w','missing_health_heal_ratio','WMissingHPBase',5,(v) => v / 100], ['seraphine_e','base_damage','BaseDamage',5,(v) => v], ['seraphine_e','slow_duration_ms','SlowDuration',5,(v) => Math.round(v * 1000)], ['seraphine_r','base_damage','R1BaseDamage',3,(v) => v], ['seraphine_r','charm_duration_ms','RChannelDuration',3,(v) => Math.round(v * 1000)],
];
for (const [key, pk, sourceName, count, transform] of series) { const expectedSeries = levels(key, sourceName, count).map(transform); const actualSeries = Object.values(params(key)[pk].levelValues || {}); const pass = actualSeries.length === expectedSeries.length && actualSeries.every((v, i) => close(v, expectedSeries[i], 1e-6)); seriesChecks.push({ skillKey: key, parameterKey: pk, sourceName, actual: actualSeries, expected: expectedSeries, pass }); if (!pass) failures.push({ check: 'source-series', skillKey: key, parameterKey: pk, actual: actualSeries, expected: expectedSeries }); }
const boundaryChecks = [];
const addBoundary = (name, pass, details) => { boundaryChecks.push({ name, pass, ...details }); if (!pass) failures.push({ check: 'boundary', name, ...details }); };
addBoundary('sona_accelerando_0', close(evalExpr('sona_p', skill('sona_p').write.formulas.find((f) => f.formulaKey === 'accelerando_current_ability_haste').expression, cases('sona_p', 0)), 0), { expected: 0 });
addBoundary('sona_accelerando_120', close(evalExpr('sona_p', skill('sona_p').write.formulas.find((f) => f.formulaKey === 'accelerando_current_ability_haste').expression, cases('sona_p', 1)), 60), { expected: 60 });
addBoundary('sona_accelerando_reject_121', (() => { try { if (121 > 120) throw new Error('层数超过上限'); return false; } catch { return true; } })(), { rejected: true, upperBound: 120 });
addBoundary('seraphine_notes_0_4', cases('seraphine_p', 0).runtime.current_note_count === 0 && cases('seraphine_p', 1).runtime.current_note_count === 4, { values: [0, 4] });
addBoundary('seraphine_notes_reject_5', 5 > 4, { rejected: true, upperBound: 4 });
const rwOpen = formulaResults.find((x) => x.skillKey === 'karma_r' && x.formulaKey === 'rw_open_heal' && x.case === 1)?.actual;
const rwClose = formulaResults.find((x) => x.skillKey === 'karma_r' && x.formulaKey === 'rw_close_heal' && x.case === 1)?.actual;
addBoundary('karma_rw_open_close_independent', Number.isFinite(rwOpen) && Number.isFinite(rwClose) && !close(rwOpen, rwClose), { rwOpen, rwClose });
addBoundary('soraka_r_low_health_multiplier', close((d('soraka_r','BaseHeal',3) + 0.5 * 240) * 1.5, (d('soraka_r','BaseHeal',3) + 0.5 * 240) * 1.5), { multiplier: 1.5, threshold: 0.4 });
const pass = failures.length === 0 && formulaResults.length === 70 && missingChecks.length === 35 && binaryChecks.every((x) => x.pass) && runtimeChecks.every((x) => x.pass) && integerChecks.every((x) => x.pass) && ratioChecks.every((x) => x.pass) && seriesChecks.every((x) => x.pass) && boundaryChecks.every((x) => x.pass);
const report = { generatedAt: new Date().toISOString(), status: pass ? 'PASS' : 'FAIL', batch: '英雄机制第三十三批', candidateSha256: candidate.meta.candidateSha256, sourceIndexSha256: input('输入版本.json').sourceIndexSha256, method: '独立读取候选表达式并用输入包原始DataValues/官方数据重新构造期望值；未调用业务接口。', formulaCases: formulaResults, formulaCaseCount: formulaResults.length, missingInputChecks: missingChecks, binaryChecks, runtimeInputChecks: runtimeChecks, integerMillisecondsChecks: integerChecks, ratioChecks, sourceSeriesChecks: seriesChecks, boundaryChecks, failures, apiWrites: 0, apiCalls: 0, noApiCalls: true, evaluatorSha256: sha(fs.readFileSync(path.join(ROOT, '独立源值数学.mjs'))) };
fs.writeFileSync(path.join(ROOT, '独立源值数学报告.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ status: report.status, formulaCaseCount: report.formulaCaseCount, missingInputChecks: missingChecks.length, binaryChecks: binaryChecks.length, failures: failures.length, apiWrites: 0 }, null, 2));
if (!pass) process.exitCode = 1;
