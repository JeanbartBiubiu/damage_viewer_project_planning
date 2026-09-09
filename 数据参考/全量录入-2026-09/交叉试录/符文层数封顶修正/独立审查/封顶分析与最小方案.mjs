import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = name => JSON.parse(fs.readFileSync(path.join(here, name)));
const write = (name, data) => fs.writeFileSync(path.join(here, name), JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
const actual = read('实际五项回读.json'), source = read('来源与静态筛选.json');
assert.equal(actual.summary.actualGET, 81); assert.equal(actual.summary.allStatus200, true);
const rows = new Map(actual.skills.map(s => [s.id, s]));
const sourceById = new Map(source.selected.map(s => [s.id, s]));
const checks = [];
function equal(name, a, b) { assert.deepEqual(a, b, name); checks.push({ name, passed: true }); }
const field = (id, key) => rows.get(id).details.parameters.find(p => p.parameterKey === key);
const rawValues = id => sourceById.get(id).raw.mScript.mSpellScriptData.mEffectAmount;
equal('血统明确上限15', rawValues(9103).MaxLegendStacks, field(9103, 'maximum_legend_stacks').fixedValue);
equal('欢欣明确上限10', rawValues(9104).MaxLegendStacks, field(9104, 'maximum_legend_stacks').fixedValue);
equal('征服者明确上限12', rawValues(8010).MaxStacks, field(8010, 'max_stacks').fixedValue);
equal('致命节奏明确上限6', rawValues(8008).MaxStacks, field(8008, 'max_stacks').fixedValue);
equal('法力流真实上限250', rawValues(8226).MaxManaIncrease, field(8226, 'maximum_bonus_mana').fixedValue);
equal('法力流合法提升次数10由明确值相除', rawValues(8226).MaxManaIncrease / rawValues(8226).ManaIncrease, field(8226, 'maximum_stacks').fixedValue);
const createDTO = 'C:/project/damage_backend_dev/server/data_manage/src/main/java/xyz/game/datamanage/model/skillparameter/SkillParameterCreateRequest.java';
const updateDTO = createDTO.replace('CreateRequest', 'UpdateRequest');
const dtoEvidence = [createDTO, updateDTO].map(file => ({ file, sha256: hash(fs.readFileSync(file)), source: fs.readFileSync(file, 'utf8') }));
for (const d of dtoEvidence) equal('当前参数DTO无输入上下界字段 ' + path.basename(d.file), /\b(minValue|maxValue|minimum|maximum|constraints|allowedValues)\b/.test(d.source.split('public record')[1]), false);
for (const id of [8010, 8008]) {
  const p = field(id, 'actual_stacks');
  equal(`${id}实际层数无默认`, [p.valueMode, p.valueType, p.fixedValue, p.levelValues], ['RUNTIME_INPUT', 'INTEGER', null, null]);
  equal(`${id}实际参数无结构化范围字段`, Object.keys(p).some(k => /^(minValue|maxValue|minimum|maximum|constraints|allowedValues)$/.test(k)), false);
}
equal('血统无已消费层数公式', rows.get(9103).details.formulas, []);
equal('血统满层生命尚无效果', rows.get(9103).details.effects, []);
equal('血统无规则', rows.get(9103).details['trigger-rules'], []);
const alacrity = rows.get(9104), ae = alacrity.details.effects[0], ar = alacrity.details['trigger-rules'][0];
equal('欢欣只有基础3%效果', alacrity.details.effects.length, 1);
equal('欢欣只读基础比例', ae.results[0].valueRule.value, { kind: 'PARAMETER', parameterKey: 'base_attack_speed_ratio' });
equal('欢欣基础值明确3%', field(9104, 'base_attack_speed_ratio').fixedValue, .03);
equal('欢欣初始化只执行基础效果', ar.actions.map(a => a.detail.effectKey), ['base_attack_speed']);
equal('欢欣没有层数公式', alacrity.details.formulas, []);
const tempo = rows.get(8008), te = tempo.details.effects[0];
equal('致命节奏只应用一份已算总值', [te.lifecycle.applicationStacksValue, te.lifecycle.maxStacksValue], [{ kind: 'FIXED', value: 1 }, { kind: 'FIXED', value: 1 }]);
equal('致命节奏总值共享并替换', [te.results[0].lifecycleBehavior.stackValueMode, te.results[0].lifecycleBehavior.reapplicationValueMode], ['SHARED', 'REPLACE']);
equal('致命节奏固定乘数只有1', te.results[0].valueRule.fixedMultiplier, 1);
equal('致命节奏没有自动触发', tempo.details['trigger-rules'], []);
equal('征服者没有满层治疗效果或自动事件', [rows.get(8010).details.effects, rows.get(8010).details.processes, rows.get(8010).details['trigger-rules']], [[], [], []]);
equal('法力流没有周期或自动事件', [rows.get(8226).details.processes, rows.get(8226).details['trigger-rules']], [[], []]);
equal('法力流恢复效果非周期', rows.get(8226).details.effects[0].lifecycle, null);
function occurrences(node, key, found = []) {
  if (node && typeof node === 'object') { if (node.nodeType === 'PARAMETER' && node.parameterKey === key) found.push(node); for (const v of Object.values(node)) if (v && typeof v === 'object') occurrences(v, key, found); } return found;
}
function cap(node) {
  if (node?.nodeType === 'PARAMETER' && node.parameterKey === 'actual_stacks') return { nodeType: 'OPERATION', operation: 'MIN', operands: [{ nodeType: 'PARAMETER', parameterKey: 'actual_stacks' }, { nodeType: 'PARAMETER', parameterKey: 'max_stacks' }] };
  return node && typeof node === 'object' ? Array.isArray(node) ? node.map(cap) : Object.fromEntries(Object.entries(node).map(([k, v]) => [k, cap(v)])) : node;
}
const targets = [[8010, 'adaptive_force_amount'], [8008, 'melee_attack_speed_amount'], [8008, 'ranged_attack_speed_amount']];
const changes = [];
for (const [id, formulaKey] of targets) {
  const before = rows.get(id).details.formulas.find(f => f.formulaKey === formulaKey);
  equal(`${id}/${formulaKey}恰好一处层数乘法`, occurrences(before.expression, 'actual_stacks').length, 1);
  equal(`${id}/${formulaKey}当前没有使用上限`, occurrences(before.expression, 'max_stacks').length, 0);
  const body = { name: before.name, description: before.description + ' 实际层数通过MIN与max_stacks比较，明确上限进入最终数值；缺层数或其他必要输入仍不得默认。', expression: cap(before.expression), sortOrder: before.sortOrder };
  equal(`${id}/${formulaKey}修改后只引入一次上限`, occurrences(body.expression, 'max_stacks').length, 1);
  changes.push({ id, skillKey: rows.get(id).key, formulaKey, method: 'PUT', route: `/skills/${rows.get(id).key}/formulas/${formulaKey}`, body, before, after: { formulaKey, ...body }, automaticDependents: id === 8008 && formulaKey === 'melee_attack_speed_amount' ? [{ effectKey: 'melee_current_attack_speed', resultKey: 'attribute_bonus', rules: [], qualification: '独立快照属性效果，无自动入口；公式上限会保护其实际总值' }] : [] });
}
function evaluate(id, node, supplied = {}, attributes = {}) {
  if (node.nodeType === 'PARAMETER') {
    const p = field(id, node.parameterKey); if (!p) throw new Error('未知参数 ' + node.parameterKey);
    if (p.valueMode === 'FIXED') return p.fixedValue;
    if (!Object.hasOwn(supplied, p.parameterKey) || !Number.isFinite(supplied[p.parameterKey])) throw new Error('缺输入 ' + p.parameterKey);
    if (p.valueType === 'INTEGER' && !Number.isInteger(supplied[p.parameterKey])) throw new Error('违反整数输入域 ' + p.parameterKey);
    if (p.parameterKey === 'actual_stacks' && supplied[p.parameterKey] < 0) throw new Error('违反非负输入域 actual_stacks');
    return supplied[p.parameterKey];
  }
  if (node.nodeType === 'ATTRIBUTE') { const key = `${node.attributeOwner}/${node.attributeKey}/${node.attributeValueKind}`; if (!Object.hasOwn(attributes, key)) throw new Error('缺属性 ' + key); return attributes[key]; }
  if (node.nodeType !== 'OPERATION') throw new Error('非法节点');
  const vs = node.operands.map(v => evaluate(id, v, supplied, attributes));
  if (node.operation === 'MULTIPLY') return vs.reduce((a, b) => a * b, 1);
  if (node.operation === 'ADD') return vs.reduce((a, b) => a + b, 0);
  if (node.operation === 'MIN') return Math.min(...vs);
  throw new Error('非法运算');
}
const math = [];
function example(c, supplied, expectedBefore, expectedAfter, label) {
  const values = [];
  for (const tree of [c.before.expression, c.body.expression]) { try { values.push(evaluate(c.id, tree, supplied)); } catch (e) { values.push(e.message); } }
  const match = (a, b) => typeof b === 'number' ? typeof a === 'number' && Math.abs(a - b) < 1e-9 : typeof a === 'string' && a.startsWith(b);
  equal(`${c.id}/${c.formulaKey} ${label}`, match(values[0], expectedBefore) && match(values[1], expectedAfter), true);
  math.push({ id: c.id, formulaKey: c.formulaKey, label, supplied, before: values[0], after: values[1], expectedBefore, expectedAfter, passed: true });
}
const conqueror = changes[0], melee = changes[1], ranged = changes[2];
for (const [stacks, before, after] of [[0, 0, 0], [6, 18, 18], [12, 36, 36], [13, 39, 36], [100, 300, 36]]) example(conqueror, { confirmed_adaptive_per_stack: 3, actual_stacks: stacks }, before, after, '每层3仅作已确认外供测试值，不推等级曲线');
example(conqueror, { confirmed_adaptive_per_stack: 3 }, '缺输入 actual_stacks', '缺输入 actual_stacks', '缺层数');
example(conqueror, { actual_stacks: 12 }, '缺输入 confirmed_adaptive_per_stack', '缺输入 confirmed_adaptive_per_stack', '缺每层来源值');
for (const [stacks, before, after] of [[0, 0, 0], [3, .18, .18], [6, .36, .36], [7, .42, .36], [20, 1.2, .36]]) example(melee, { actual_stacks: stacks }, before, after, '近战每层0.06');
example(melee, {}, '缺输入 actual_stacks', '缺输入 actual_stacks', '缺层数');
for (const [stacks, before, after] of [[3, .15, .15], [6, .3, .3], [7, .35, .3]]) example(ranged, { confirmed_ranged_as_per_stack: .05, actual_stacks: stacks }, before, after, '测试注入0.05只验上限，不判定本版远程冲突值');
example(ranged, { actual_stacks: 6 }, '缺输入 confirmed_ranged_as_per_stack', '缺输入 confirmed_ranged_as_per_stack', '远程冲突未解决不能补值');
example(melee, { actual_stacks: -1 }, '违反非负输入域', '违反非负输入域', '负数不靠封顶修正');
example(conqueror, { confirmed_adaptive_per_stack: 3, actual_stacks: 1.5 }, '违反整数输入域', '违反整数输入域', '小数层数不能通过资格');

const branchChecks = [];
function fullStackBranch(id, formulaKey, stacks, supplied, expected) {
  let actual;
  try {
    if (!Number.isInteger(stacks)) throw new Error('缺真实整数层数');
    const cap = field(id, 'max_stacks').fixedValue;
    if (stacks < cap) throw new Error('未满层不得进入此分支');
    actual = evaluate(id, rows.get(id).details.formulas.find(f => f.formulaKey === formulaKey).expression, supplied);
  } catch (e) { actual = e.message; }
  equal(`独立资格边界 ${id}/${formulaKey}/${stacks}`, actual, expected);
  branchChecks.push({ id, formulaKey, suppliedRealStacks: stacks ?? null, supplied, actual, expected, boundary: '此条件是审查器按来源检验所需资格，不是当前已保存公式内有此判断；当前没有相应自动入口。', passed: true });
}
fullStackBranch(8010, 'melee_self_heal', 11, { actual_damage_dealt_to_champion: 100 }, '未满层不得进入此分支');
fullStackBranch(8010, 'melee_self_heal', 12, { actual_damage_dealt_to_champion: 100 }, 8);
fullStackBranch(8010, 'ranged_self_heal', 12, { actual_damage_dealt_to_champion: 100 }, 5);
fullStackBranch(8010, 'melee_self_heal', undefined, { actual_damage_dealt_to_champion: 100 }, '缺真实整数层数');
fullStackBranch(8008, 'melee_full_stack_damage', 5, { confirmed_melee_level_damage: 20, confirmed_bonus_attack_speed_ratio: .5 }, '未满层不得进入此分支');
fullStackBranch(8008, 'melee_full_stack_damage', 6, { confirmed_melee_level_damage: 20, confirmed_bonus_attack_speed_ratio: .5 }, 30);
equal('法力流独立回复只按已损法力，不重复乘层', evaluate(8226, rows.get(8226).details.formulas[0].expression, {}, { 'SOURCE/mana/MISSING': 600 }), 6);
const plan = { at: new Date().toISOString(), status: 'REVIEWABLE_NOT_EXECUTED', actualGET: 81, businessWrites: 0, sourceManifestSha256: hash(fs.readFileSync(path.join(here, '来源与静态筛选.json'))), actualSnapshotSha256: hash(fs.readFileSync(path.join(here, '实际五项回读.json'))), changes, count: 3, protected: actual.skills.map(s => ({ id: s.id, body: s.body, details: s.details })), constraints: ['仅3公式PUT；PUT不携formulaKey，稳定键留在URL与before/after。', '执行前重读同值；保护所有参数、技能、效果、规则、图片和挂载。本次未读取图片/关联，不声称已经冻结它们。', '8008近战已有独立APPLICATION_SNAPSHOT效果，公式只增加MIN；不改变duration/SHARED/REPLACE，不创建获得层数事件。', '满层奖励是有资格前提的独立数值分支；当前无自动执行，不能通过乘层比例生成未满层治疗。', '所有未知层数和远程/等级值继续无默认；不把击杀统计进度直接当层数。'], math, branchChecks };
write('三公式最小可审查方案.json', plan);
write('封顶审计结论.json', { at: new Date().toISOString(), status: 'REVISE_3_FORMULAS', actualGET: 81, businessWrites: 0, formulaPatches: 3, affectedSkillIds: [8010, 8008], checkedSkillIds: actual.selected, findings: [
  { id: 9103, verdict: 'NO_CAP_CONSUMER', reason: '15上限、0.45%每层、85满层生命只存参数，未建公式/效果/自动规则；不是漏封顶或无条件85生命。' },
  { id: 9104, verdict: 'BASE_BRANCH_CORRECT', reason: '只有明确无条件3%基础攻速SOURCE_INITIALIZED；1.5%每层与10上限尚未消费，不对基础3%添加虚构层数。' },
  { id: 8010, verdict: 'ADD_CAP_TO_FORMULA', formulas: ['adaptive_force_amount'], reason: 'description约定0..12，但参数DTO与公式没有结构化范围校验；在预期域内算值正确，超域供值会得13层结果。按用户要求让上限进入表达式，其他满层治疗分支未自动接线。' },
  { id: 8008, verdict: 'ADD_CAP_TO_FORMULA', formulas: ['melee_attack_speed_amount', 'ranged_attack_speed_amount'], reason: 'description约定0..6，实际公式仅乘层数；独立近战效果的fixedMaxValue也为空。没有重复乘层，增加MIN保护总值。远程来源冲突保持输入边界。' },
  { id: 8226, verdict: 'NO_STACK_TOTAL_CONSUMER', reason: '10提升次数和250最大额外法力仅参数；没有按层累积公式或周期自动入口。独立满层回复公式未内置资格，不当作已自动无条件恢复。' }
], staticOnly: { id: 9923, reason: '本地候选有额外重置次数上限2，但当前候选没有消费该次数的公式/效果。未请求第六项实际GET，后续接计数时需核上限，不能把2当总攻击次数。' }, inputDomain: { intent: '0..max的已确认整数', currentEvidence: '实际valueType=INTEGER、valueMode=RUNTIME_INPUT、fixedValue/levelValues=null；上限仅在description，没有参数DTO范围字段；未找到本批真实生产者或绑定做校验。', implication: '不能声称已经实现机器校验，也不能把正常域内正确公式说成已发生战斗数值错误。此次修订属于明确上限的公式保障。' }, dtoEvidence, checks, math, branchChecks, planSha256: hash(fs.readFileSync(path.join(here, '三公式最小可审查方案.json'))) });
console.log(JSON.stringify({ status: 'REVISE_3_FORMULAS', getCount: 81, checks: checks.length, examples: math.length, branchChecks: branchChecks.length, businessWrites: 0, planSha256: hash(fs.readFileSync(path.join(here, '三公式最小可审查方案.json'))), reportSha256: hash(fs.readFileSync(path.join(here, '封顶审计结论.json'))) }));
