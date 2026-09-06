// 有界资料检查：不连接业务服务，不写其他目录。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const dir = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(dir, '盖伦技能录入候选.json'), 'utf8'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
for (const item of data.sourceFiles) {
  const bytes = fs.readFileSync(path.resolve(dir, item.path));
  assert.equal(bytes.length, item.bytes);
  assert.equal(hash(bytes), item.sha256);
}
assert.deepEqual(data.skills.map(s => s.slot), ['P', 'Q', 'W', 'E', 'R']);
const knownAttrs = new Set(['hp', 'hp_regen', 'attack_damage', 'armor', 'magic_resistance', 'move_speed_percent', 'tenacity_percent', 'critical_strike_damage_bonus_percent']);
for (const s of data.skills) {
  const ps = new Set(s.parameters.map(p => p.parameterKey));
  const fs = new Set(s.formulas.map(f => f.formulaKey));
  const es = new Set(s.effects.map(e => e.effectKey));
  assert.equal(ps.size, s.parameters.length);
  assert.equal(fs.size, s.formulas.length);
  assert.equal(es.size, s.effects.length);
  const visit = obj => {
    if (!obj || typeof obj !== 'object') return;
    if (obj.kind === 'PARAMETER' || obj.nodeType === 'PARAMETER') assert(ps.has(obj.parameterKey), `${s.slot} 未知参数 ${obj.parameterKey}`);
    if (obj.kind === 'FORMULA') assert(fs.has(obj.formulaKey), `${s.slot} 未知公式 ${obj.formulaKey}`);
    if (obj.nodeType === 'ATTRIBUTE') assert(knownAttrs.has(obj.attributeKey), `${s.slot} 未核属性 ${obj.attributeKey}`);
    if (obj.nodeType === 'OPERATION') { assert.equal(obj.operands.length, 2); assert(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX'].includes(obj.operation)); }
    for (const v of Object.values(obj)) if (typeof v === 'object') visit(v);
  };
  visit(s);
  for (const p of s.parameters) if (p.valueMode === 'SKILL_LEVEL') assert.deepEqual(Object.keys(p.levelValues), Array.from({ length: s.skill.maxLevel }, (_, i) => String(i + 1)));
  for (const p of s.processes) {
    assert(p.effectBindings.length + p.stateOperations.length > 0, '不允许制造空过程');
    for (const b of p.effectBindings) assert(es.has(b.effectKey));
  }
  for (const r of s.triggerRules) for (const a of r.actions) if (a.actionType === 'EXECUTE_EFFECT') assert(es.has(a.detail.effectKey));
}
const evaluate = (slot, key, rank, level, attrs) => {
  const s = data.skills.find(s => s.slot === slot);
  const expr = s.formulas.find(f => f.formulaKey === key).expression;
  const ev = n => {
    if (n.nodeType === 'PARAMETER') {
      const p = s.parameters.find(p => p.parameterKey === n.parameterKey);
      return p.valueMode === 'FIXED' ? p.fixedValue : p.levelValues[String(p.valueMode === 'CHARACTER_LEVEL' ? level : rank)];
    }
    if (n.nodeType === 'ATTRIBUTE') return attrs[`${n.attributeOwner}.${n.attributeKey}.${n.attributeValueKind}`];
    const [a, b] = n.operands.map(ev);
    return { ADD: () => a + b, SUBTRACT: () => a - b, MULTIPLY: () => a * b, DIVIDE: () => a / b, MIN: () => Math.min(a, b), MAX: () => Math.max(a, b) }[n.operation]();
  };
  return ev(expr);
};
const examples = [
  { slot: 'P', key: 'regen_per_5s', rank: 1, level: 13, attrs: { 'SOURCE.hp.TOTAL': 1000 }, expected: 81 },
  { slot: 'Q', key: 'bonus_damage', rank: 1, level: 1, attrs: { 'SOURCE.attack_damage.TOTAL': 100 }, expected: 80 },
  { slot: 'W', key: 'shield', rank: 1, level: 1, attrs: { 'SOURCE.hp.BONUS': 400 }, expected: 137 },
  { slot: 'E', key: 'damage_per_spin', rank: 5, level: 18, attrs: { 'SOURCE.attack_damage.TOTAL': 100 }, expected: 68 },
  { slot: 'E', key: 'nearest_damage_per_spin', rank: 5, level: 18, attrs: { 'SOURCE.attack_damage.TOTAL': 100 }, expected: 85 },
  { slot: 'E', key: 'critical_multiplier', rank: 5, level: 18, attrs: { 'SOURCE.critical_strike_damage_bonus_percent.TOTAL': 0.3 }, expected: 1.39 },
  { slot: 'R', key: 'damage', rank: 3, level: 18, attrs: { 'TARGET.hp.MISSING': 1000 }, expected: 625 }
];
for (const x of examples) { x.actual = evaluate(x.slot, x.key, x.rank, x.level, x.attrs); assert(Math.abs(x.actual - x.expected) < 1e-8); }

// 只读使用前端已有 TypeScript 编译器，对虚拟源文件进行类型核对，不落地构建产物。
const web = process.env.DAMAGE_WEB_ROOT || 'C:/project/damage_web_dev/web';
const require = createRequire(path.join(web, 'package.json'));
const ts = require('typescript');
const fields = { skill: ['skill', 'CreateSkillRequest'], parameters: ['skillParameter', 'CreateSkillParameterRequest'], formulas: ['skillFormula', 'CreateSkillFormulaRequest'], effects: ['skillEffect', 'CreateSkillEffectRequest'], internalStates: ['skillInternalState', 'CreateSkillInternalStateRequest'], processes: ['skillProcess', 'CreateSkillProcessRequest'], triggerRules: ['skillTriggerRule', 'CreateSkillTriggerRuleRequest'] };
let source = Object.values(fields).map(([file, type]) => `import type { ${type} } from ${JSON.stringify(path.join(web, 'src/types', `${file}.ts`).replaceAll('\\', '/'))};`).join('\n');
for (let i = 0; i < data.skills.length; i++) for (const [field, [, type]] of Object.entries(fields)) source += `\nconst c_${i}_${field}: ${type}${field === 'skill' ? '' : '[]'} = ${JSON.stringify(data.skills[i][field])};`;
const virtualPath = path.join(dir, '__virtual_candidate_type_check__.ts');
const options = { noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, types: [] };
const host = ts.createCompilerHost(options);
const original = host.getSourceFile;
host.getSourceFile = (file, language, onError, createNew) => path.resolve(file) === path.resolve(virtualPath) ? ts.createSourceFile(file, source, language, true) : original(file, language, onError, createNew);
const program = ts.createProgram([virtualPath], options, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => dir, getCanonicalFileName: f => f, getNewLine: () => '\n' }));
const record = { checkedAt: new Date().toISOString(), result: '通过', candidateSha256: hash(fs.readFileSync(path.join(dir, '盖伦技能录入候选.json'))), sourceFilesVerified: data.sourceFiles.length, skills: data.skills.length, typeCheck: { frontendRoot: web, typescriptVersion: ts.version, result: '当前前端请求类型通过；目录引用与游戏机制语义仍须页面/运行验证' }, mathematicalExamples: examples, unverified: ['未写业务接口或数据库', '未通过页面录入', '未执行游戏技能运行验证', '未把占位目录键或缺口标记为完成'] };
fs.writeFileSync(path.join(dir, '静态核对记录.json'), JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({ result: record.result, skills: data.skills.length, sources: data.sourceFiles.length, formulaExamples: examples.length, typeCheck: '通过' }));
