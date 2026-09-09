import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const web = 'C:/project/damage_web_dev';
const base = 'C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09';
const old = path.join(web, '数据参考/全量录入-2026-09/交叉试录/通用公式来源补证');
const gear = path.join(base, '装备技能实录/第十七批防御与状态装备');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fileHash = p => hash(fs.readFileSync(p));
const read = p => JSON.parse(fs.readFileSync(p));
const record = (name, data) => fs.writeFileSync(path.join(here, name), JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
const checks = [];
function equal(name, actual, expected) { assert.deepEqual(actual, expected, name); checks.push({ name, passed: true }); }
const sources = [];
function load(relativePath) { const p = path.join(base, relativePath), packed = fs.readFileSync(p), raw = zlib.gunzipSync(packed); sources.push({ path: p, compressedSha256: hash(packed), rawSha256: hash(raw) }); return JSON.parse(raw); }
const items = load('装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz');
const text = load('装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz').entries;
const perks = load('API实录/符文客户端数值补证/perks-16.17.cdtb.bin.json.gz');
equal('装备压缩SHA', sources[0].compressedSha256, '3df60e1c7aceddf7b32bf918a94a4470332364b9a7549e8f61bad5bfe8c692a7');
equal('中文压缩SHA', sources[1].compressedSha256, 'dbb43f1174c48cecb8e014972c198ad6a80d515903aa52da8fe6b6d54bc7af5e');
equal('符文原始SHA', sources[2].rawSha256, '1427c70c4d1172198a1a9787362224c871a90cc4f66f3f769ef5830cbcd401b1');
const defaults = read(path.join(old, '同构建类型与默认.json')), meta = read(path.join(old, 'meta-dump-16.17.8104348.json'));
equal('构造来源版本', defaults.version, '16.17.8104348');
equal('原始meta内嵌补丁版本', meta.version, '16.17');
const typeEvidence = [];
for (const name of ['StatByNamedDataValueCalculationPart', 'StatByCoefficientCalculationPart', 'StatBySubPartCalculationPart']) {
  const c = defaults.classes[name], raw = meta.classes[c.hash];
  equal(`${name}原始类完整同值`, c.raw, raw);
  equal(`${name}继承类`, raw.base, '0xb5f69929');
  for (const [key, expected] of [['0x7d3150ec', 0], ['0xabc2d461', false], ['0x94fb4b0c', 0], ['0x8a544bcf', 13], ['0xa8cb9c14', false]]) equal(`${name}构造默认${key}`, raw.defaults[key], expected);
  typeEvidence.push({ name, classHash: c.hash, constructor: raw.fn.constructor, base: raw.base, defaults: raw.defaults });
}
function fnv(name) { let h = 2166136261n; for (const b of Buffer.from(name.toLowerCase(), 'utf8')) h = ((h ^ BigInt(b)) * 16777619n) & 0xffffffffn; return `{${h.toString(16).padStart(8, '0')}}`; }
function dataOf(item, ref) { const matches = item.mDataValues.filter(v => v.mName.toLowerCase() === ref.toLowerCase() || fnv(v.mName) === ref.toLowerCase()); equal(`命名引用唯一 ${ref}`, matches.length, 1); return matches[0]; }
function narrow(node) {
  return node.__type === 'StatByNamedDataValueCalculationPart' && node.mStat === 12 && (node.mStatFormula ?? 0) === 0 &&
    (node.UseNewStats ?? false) === false && (node.OutputType ?? 0) === 0 && (node.statType ?? 13) === 13 && (node['{a8cb9c14}'] ?? false) === false;
}
function selectedItem(id, calcName, nodeIndex) {
  const item = items[`Items/${id}`], calculation = item.mItemCalculations[calcName], node = calculation.mFormulaParts[nodeIndex];
  const bindings = Object.fromEntries(Object.entries(item.mItemDataClient.mTooltipData.mLocKeys).map(([key, sourceKey]) => [key, { sourceKey, text: text[sourceKey.toLowerCase()] ?? null }]));
  return { id, path: `Items/${id}`, rootSha256: hash(Buffer.from(JSON.stringify(item))), item, calcName, calculation, nodePath: `/mItemCalculations/${calcName}/mFormulaParts/${nodeIndex}`, node, namedValue: dataOf(item, node.mDataValue), bindings };
}
const biscuit = selectedItem(2010, 'TotalHealCalcTOOLTIP', 0);
const heartsteel = selectedItem(3084, 'DamageCalc', 0);
const atma = selectedItem(773005, 'BonusAD', 0);
const targetCounter = selectedItem(773109, 'OnHitDamageCalc', 0);
const hull = selectedItem(3181, 'MaxStackDamage', 1);
equal('新增主证具名比例', heartsteel.namedValue.mName, 'MaxHPRatio');
equal('当前正文同时绑定基数和比例并明确你的最大生命', heartsteel.bindings.keyTooltip.text.includes('@BaseDamage@外加@MaxHPRatio*100@%</physicalDamage>你的最大生命值'), true);
equal('当前同根计算基数绑定', heartsteel.calculation.mFormulaParts[1].mDataValue, 'BaseDamage');
equal('模式交叉具名比例散列', fnv('HPToADPercentage'), '{ba352cb1}');
equal('模式交叉文本明确最大生命转攻击力', atma.bindings.keyTooltip.text.includes('@HPToADPercentage*100@%</physicalDamage><scaleHealth>最大生命值</scaleHealth>'), true);
equal('所有者反例真实开关', targetCounter.node['{a8cb9c14}'], true);
equal('所有者反例正文明确目标其最大生命', targetCounter.bindings.keyTooltip.text.includes('目标造成其<healing>@MaxHealthDamage*100@%最大生命值'), true);
for (const e of [biscuit, heartsteel, atma, hull]) equal(`严格窄条件 ${e.id}`, narrow(e.node), true);
equal('目标所有者反例必须排除', narrow(targetCounter.node), false);
equal('显式0与构造0同窄条件', narrow({ ...hull.node, mStatFormula: 0 }), true);
for (const [name, node] of [['12/2额外生命', { ...hull.node, mStatFormula: 2 }], ['新属性链', { ...hull.node, UseNewStats: true }], ['其他输出类型', { ...hull.node, OutputType: 1 }], ['其他旧statType', { ...hull.node, statType: 12 }], ['固定系数未独立扩展', { ...hull.node, __type: 'StatByCoefficientCalculationPart' }]]) equal(`反例拒绝 ${name}`, narrow(node), false);
const aftershockPair = Object.entries(perks).find(([, value]) => value?.mPerkId === 8439);
const aftershock = aftershockPair[1];
const aftershockText = Object.fromEntries(['mLongDescLocalizationKey', 'mTooltipNameLocalizationKey'].map(k => [k, { key: aftershock[k], text: text[aftershock[k].toLowerCase()] }]));
function nodes(value, at = '', found = []) { if (value && typeof value === 'object') { if (value.mStat === 12) found.push({ path: at, node: value }); for (const [k, v] of Object.entries(value)) if (v && typeof v === 'object') nodes(v, `${at}/${k}`, found); } return found; }
const bonusNodes = nodes(aftershock.mScript.mSpellScriptData.mCalculations).filter(v => v.node.mStatFormula === 2);
assert.ok(bonusNodes.length); checks.push({ name: '12/2当前额外生命反例存在', passed: true });
equal('余震当前正文明确额外生命', Object.values(aftershockText).some(v => v.text.includes('额外生命')), true);
const bonusCounter = { path: aftershockPair[0], rootSha256: hash(Buffer.from(JSON.stringify(aftershock))), object: aftershock, bindings: aftershockText, nodes: bonusNodes };
for (const b of bonusNodes) equal('现存12/2不能落入总生命窄映射', narrow(b.node), false);
record('原始绑定与窄条件.json', { at: new Date().toISOString(), sources, sourceUrls: ['https://raw.communitydragon.org/16.17/game/items.cdtb.bin.json', 'https://raw.communitydragon.org/16.17/game/zh_cn/data/menu/en_us/lol.stringtable.json', 'https://raw.communitydragon.org/16.17/game/perks.cdtb.bin.json'], constructorEvidence: { localFiles: ['同构建类型与默认.json', 'meta-dump-16.17.8104348.json', 'meta-crates_dumper_src_meta_dump.rs', 'meta-crates_dumper_src_meta.rs', '基础攻击力具名补证.json'].map(file => ({ file, sha256: fileHash(path.join(old, file)) })), version: defaults.version, sourceCommit: defaults.commit, codeReferences: defaults.evidence, classes: typeEvidence }, primary: [biscuit, heartsteel], extraModeWitness: atma, ownerCounter: targetCounter, bonusCounter, targetHull: hull, checks, boundary: '仅具名数据值旧属性节点。构造默认已证；SOURCE.hp.TOTAL是本版具名树与当前正文的窄静态推断，非客户端求值函数逆向。不可忽略匿名布尔字段，也不扩mStat29、CURRENT、Coef/SubPart整体映射。模式装备只旁证不录入。' });

const auth = process.env.HP12_API_TOKEN; assert.ok(auth, '缺只读认证环境变量');
const rows = [];
async function get(route) {
  const response = await fetch(`http://127.0.0.1:8080/api/admin/games/lol${route}`, { headers: { Authorization: `Bearer ${auth}` }, signal: AbortSignal.timeout(30000) });
  const actual = await response.json(); rows.push({ at: new Date().toISOString(), method: 'GET', route, status: response.status, actual });
  fs.writeFileSync(path.join(here, '3181实际GET.json'), JSON.stringify({ reads: rows, getCount: rows.length, businessWrites: 0 }, null, 2) + '\n');
  equal(`实际GET200 ${route}`, response.status, 200); return actual;
}
const skillKey = 'item_3181_passive';
const skill = await get(`/skills/${skillKey}`);
const collections = {};
for (const kind of ['parameters', 'formulas', 'effects', 'processes', 'internal-states', 'trigger-rules']) {
  const list = await get(`/skills/${skillKey}/${kind}`); assert.ok(Array.isArray(list)); collections[kind] = list;
}
const actualP = [], actualF = [];
for (const p of collections.parameters) actualP.push(await get(`/skills/${skillKey}/parameters/${p.parameterKey}`));
for (const f of collections.formulas) actualF.push(await get(`/skills/${skillKey}/formulas/${f.formulaKey}`));
const hpDictionary = await get('/attributes/hp');
const image = await get(`/skills/${skillKey}/representative-image`);
const relations = await get(`/equipment-skill-relations?equipmentKey=item_3181&skillKey=${skillKey}`);
equal('当前参数数', actualP.length, 5); equal('当前公式数', actualF.length, 2);
for (const kind of ['effects', 'processes', 'internal-states', 'trigger-rules']) equal(`当前${kind}为空`, collections[kind].length, 0);
const candidate = read(path.join(gear, '完整候选.json'));
const frozen = candidate.objects.find(v => v.equipmentKey === 'item_3181').apiPayload;
const match = (a, b) => b === null || typeof b !== 'object' ? Object.is(a, b) : Array.isArray(b) ? Array.isArray(a) && a.length === b.length && b.every((v, i) => match(a[i], v)) : a && Object.entries(b).every(([k, v]) => match(a[k], v));
equal('当前主体仍原批同值', match(skill, frozen.skill), true);
for (const p of actualP) equal(`当前参数仍原批同值 ${p.parameterKey}`, match(p, frozen.parameters.find(v => v.parameterKey === p.parameterKey)), true);
for (const f of actualF) equal(`当前公式仍原批同值 ${f.formulaKey}`, match(f, frozen.formulas.find(v => v.formulaKey === f.formulaKey)), true);
const oldInput = actualP.find(v => v.parameterKey === 'actual_mstat12_formula0');
equal('当前临时输入无默认', [oldInput.valueMode, oldInput.fixedValue, oldInput.levelValues], ['RUNTIME_INPUT', null, null]);
function replace(value) {
  if (value && typeof value === 'object') {
    if (value.nodeType === 'PARAMETER' && value.parameterKey === oldInput.parameterKey) return { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'hp', attributeValueKind: 'TOTAL' };
    return Array.isArray(value) ? value.map(replace) : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replace(v)]));
  } return value;
}
const proposedFormulas = frozen.formulas.map(f => ({ ...f, expression: replace(f.expression), description: f.formulaKey === 'melee_bonus_damage' ? '1.2×自身基础攻击力+0.05×自身最大生命；沿16.17同类具名计算补证，当前近战分支。攻击计数与伤害资格仍未接线。' : '完整近战表达式×0.7；生命读取自身最大生命，保留原远程作用顺序。' }));
const replacementCount = actualF.map(f => ({ formulaKey: f.formulaKey, referencePaths: [] }));
function refs(v, p, result) { if (v && typeof v === 'object') { if (v.nodeType === 'PARAMETER' && v.parameterKey === oldInput.parameterKey) result.push(p); for (const [k, x] of Object.entries(v)) if (x && typeof x === 'object') refs(x, `${p}/${k}`, result); } }
for (let i = 0; i < actualF.length; i++) refs(actualF[i], '', replacementCount[i].referencePaths);
equal('两条公式各一处临时引用', replacementCount.map(v => v.referencePaths.length), [1, 1]);
const ratio = frozen.parameters.find(v => v.parameterKey === 'mstat12_formula0_ratio');
const newRatio = { ...ratio, name: '船长自身最大生命系数', description: '当前MaxStackDamageHPRatio=0.05；同版旧具名节点12/默认0且旧属性及所有者字段保持默认，读取自身最大生命。稳定参数键保留。' };
const newSkill = { ...frozen.skill, description: '保留对当前英雄每第五次攻击附伤的独立公式：1.2自身基础攻击力+0.05自身最大生命，远程对整项乘0.7。属性口径沿同版具名窄补证；攻击计数、命中资格及伤害事件仍未接线。' };
const without = (o, key) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));
const requests = [
  ...proposedFormulas.map(body => ({ method: 'PUT', route: `/skills/${skillKey}/formulas/${body.formulaKey}`, body: without(body, 'formulaKey'), before: actualF.find(v => v.formulaKey === body.formulaKey), after: body })),
  { method: 'PUT', route: `/skills/${skillKey}/parameters/${ratio.parameterKey}`, body: without(newRatio, 'parameterKey'), before: actualP.find(v => v.parameterKey === ratio.parameterKey), after: newRatio },
  { method: 'PUT', route: `/skills/${skillKey}`, body: without(newSkill, 'skillKey'), before: skill, after: newSkill },
  { method: 'DELETE', route: `/skills/${skillKey}/parameters/${oldInput.parameterKey}`, before: oldInput, precondition: '前4项成功后重新GET六类组成及全部详情，确认无任何引用，再删此精确临时键；异常先GET，禁止重放。' }
];
function evaluate(n, supplied, attrs) {
  if (n.nodeType === 'PARAMETER') { const p = actualP.find(p => p.parameterKey === n.parameterKey); if (p.valueMode === 'FIXED') return p.fixedValue; if (!Object.hasOwn(supplied, p.parameterKey)) throw Error('缺临时输入'); return supplied[p.parameterKey]; }
  if (n.nodeType === 'ATTRIBUTE') { const k = `${n.attributeOwner}/${n.attributeKey}/${n.attributeValueKind}`; if (!Object.hasOwn(attrs, k)) throw Error(`缺属性 ${k}`); return attrs[k]; }
  assert.equal(n.nodeType, 'OPERATION'); const vs = n.operands.map(x => evaluate(x, supplied, attrs));
  if (n.operation === 'ADD') return vs.reduce((a, b) => a + b, 0); if (n.operation === 'MULTIPLY') return vs.reduce((a, b) => a * b, 1); throw Error('非法运算');
}
const math = [];
for (const sample of [{ baseAD: 100, hp: 2000, bonusHP: 800, currentHP: 500, targetHP: 3000, melee: 220, ranged: 154 }, { baseAD: 80, hp: 1234.5, bonusHP: 334.5, currentHP: 200, targetHP: 2500, melee: 157.725, ranged: 110.4075 }]) {
  for (const f of proposedFormulas) {
    const actual = actualF.find(v => v.formulaKey === f.formulaKey);
    const attrs = { 'SOURCE/attack_damage/BASE': sample.baseAD, 'SOURCE/hp/TOTAL': sample.hp, 'SOURCE/hp/BONUS': sample.bonusHP, 'SOURCE/hp/CURRENT': sample.currentHP, 'TARGET/hp/TOTAL': sample.targetHP };
    const expected = f.formulaKey.startsWith('melee') ? sample.melee : sample.ranged;
    const beforeValue = evaluate(actual.expression, { actual_mstat12_formula0: sample.hp }, attrs), afterValue = evaluate(f.expression, {}, attrs);
    assert.ok(Math.abs(beforeValue - expected) < 1e-9 && Math.abs(afterValue - expected) < 1e-9);
    math.push({ sample, formulaKey: f.formulaKey, beforeValue, afterValue, expected, hypotheticalWrongBonus: evaluate(actual.expression, { actual_mstat12_formula0: sample.bonusHP }, attrs), hypotheticalWrongCurrent: evaluate(actual.expression, { actual_mstat12_formula0: sample.currentHP }, attrs), hypotheticalWrongTarget: evaluate(actual.expression, { actual_mstat12_formula0: sample.targetHP }, attrs), passed: true });
  }
}
let currentOnlyError; try { evaluate(proposedFormulas[0].expression, {}, { 'SOURCE/attack_damage/BASE': 100, 'SOURCE/hp/CURRENT': 500 }); } catch (e) { currentOnlyError = e.message; }
equal('只有当前生命必须缺最大生命报错', currentOnlyError, '缺属性 SOURCE/hp/TOTAL');
const minimumPlan = { at: new Date().toISOString(), status: 'REVIEWABLE_NOT_EXECUTED', skillKey, sourceProofSha256: fileHash(path.join(here, '原始绑定与窄条件.json')), gear17FrozenCandidateSha256: fileHash(path.join(gear, '完整候选.json')), actualGetSnapshotSha256: fileHash(path.join(here, '3181实际GET.json')), requests, replacements: replacementCount, before: { skill, parameters: actualP, formulas: actualF, collections, representativeImage: image, equipmentRelation: relations, hpDictionary }, math, currentOnlyError, businessWrites: 0, assumptions: ['只替换当前两个确定的旧具名12/默认0节点；保持基础攻击力BASE、原系数、远程整项乘法及资格边界。', '删输入前必须重新确认所有引用消失；本轮没有效果或自动规则，不新增默认执行。', 'PUT不携带skillKey/parameterKey/formulaKey稳定键，before/after证据保留完整稳定键。'] };
record('3181最小可审查方案.json', minimumPlan);
record('结论.json', { at: new Date().toISOString(), status: 'NARROW_READY', allowedType: 'StatByNamedDataValueCalculationPart', predicates: { mStat: 12, mStatFormula: '显式0或省略且构造默认0', UseNewStats: false, OutputType: 0, statType: 13, '{a8cb9c14}': false }, mapping: { attributeOwner: 'SOURCE', attributeKey: 'hp', attributeValueKind: 'TOTAL' }, otherBoundary: '不得套用于外围明确更换属性所有者的计算；不得对CURRENT、BONUS、mStat29、资源类或其他节点类型进行批量映射。Coef/SubPart只确认构造字段相同，本轮未独立证明其最大生命属性语义。', evidenceLevel: '同版原始当前具名树/正文及构造默认的静态交叉推断；未运行客户端二进制或取得属性分派函数。', sourceFiles: sources, proofSha256: fileHash(path.join(here, '原始绑定与窄条件.json')), planSha256: fileHash(path.join(here, '3181最小可审查方案.json')), getCount: rows.length, businessWrites: 0, checks, math });
console.log(JSON.stringify({ status: 'NARROW_READY', getCount: rows.length, businessWrites: 0, plannedRequests: requests.length, checks: checks.length, conclusionSha256: fileHash(path.join(here, '结论.json')), planSha256: fileHash(path.join(here, '3181最小可审查方案.json')) }));
