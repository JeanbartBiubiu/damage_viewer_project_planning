import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 仅本地独立读取：不导入主负责人求值器，不提供 HTTP 或业务写入入口。
const out = path.dirname(fileURLToPath(import.meta.url));
const base = 'C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09';
const batch = path.join(base, 'API实录/符文效果第六批');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const json = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const hashFile = p => hash(fs.readFileSync(p));
const canonical = x => JSON.stringify(x && typeof x === 'object' ? Array.isArray(x) ? x.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(x).sort().map(k => [k, JSON.parse(canonical(x[k]))])) : x);
const same = (a, b) => canonical(a) === canonical(b);
const checks = [];
function check(name, condition, detail = undefined) { checks.push({ name, pass: Boolean(condition), ...(detail === undefined ? {} : { detail }) }); }
function equal(name, actual, expected) { check(name, same(actual, expected), { actual, expected }); }
function near(name, actual, expected, tolerance = 1e-9) { check(name, Math.abs(actual - expected) <= tolerance, { actual, expected, tolerance }); }
function loadGzip(relativePath) { const compressed = fs.readFileSync(path.join(base, relativePath)), raw = zlib.gunzipSync(compressed); return { relativePath, compressedSha256: hash(compressed), rawSha256: hash(raw), object: JSON.parse(raw) }; }
const items = loadGzip('装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz');
const texts = loadGzip('装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz');
const perks = loadGzip('API实录/符文客户端数值补证/perks-16.17.cdtb.bin.json.gz');
const itemManifest = json(path.join(base, '装备效果补证/来源与覆盖.json'))['原始资料'];
const perkManifest = json(path.join(base, 'API实录/符文客户端数值补证/来源记录.json'));
for (const loaded of [items, texts]) {
  const m = itemManifest.find(v => loaded.relativePath.endsWith(v['文件']));
  equal(`来源清单压缩散列 ${loaded.relativePath}`, loaded.compressedSha256, m['压缩SHA256']);
  equal(`来源清单原始散列 ${loaded.relativePath}`, loaded.rawSha256, m['原始SHA256']);
  equal(`固定版本 ${loaded.relativePath}`, m['目录或公告版本'], '16.17');
}
equal('符文压缩散列', perks.compressedSha256, perkManifest.gzipSha256);
equal('符文原始散列', perks.rawSha256, perkManifest.rawSha256);
equal('符文固定版本', perkManifest.version, '16.17');

const beforePath = path.join(batch, '可审查候选.json'), finalPath = path.join(batch, '最终候选.json'), requestsPath = path.join(batch, '最终请求.json');
const before = json(beforePath), final = json(finalPath), requests = json(requestsPath);
const beforeSha = hashFile(beforePath), candidateSha256 = hashFile(finalPath), planSha256 = hashFile(requestsPath);
equal('原候选未覆盖', beforeSha, '163ff77ed3b383e54428cedf49497f3b0f6ff8d6b205d614f4e5fd6c1b6ca609');
equal('最终候选锁', candidateSha256, 'c4da75bce82f5312a7ba62e94f669daaa9212f649a0758683f3352ac6bfac259');
equal('最终请求锁', planSha256, '424ae390c61108adc692de63e95926c847e72e855607176bc8703621491eda02');
equal('请求引用最终候选', requests.candidateSha256, candidateSha256);

// 与主负责人 Math.imul 实现独立：使用大整数逐字节乘法及 32 位掩码。
function fnvAscii(name) {
  if (!/^[\x00-\x7f]+$/.test(name)) throw new Error('本次仅核 ASCII 字段名');
  let h = 2166136261n;
  for (const byte of Buffer.from(name.toLowerCase(), 'ascii')) h = ((h ^ BigInt(byte)) * 16777619n) & 0xffffffffn;
  return `{${h.toString(16).padStart(8, '0')}}`;
}
function exactTexts(key) {
  const found = [];
  function walk(v, trail) {
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (k.toLowerCase() === key.toLowerCase() && typeof x === 'string') found.push({ path: `${trail}/${k}`, text: x });
      else if (x && typeof x === 'object') walk(x, `${trail}/${k}`);
    }
  }
  walk(texts.object, '');
  return found;
}
const item = items.object['Items/2010'];
equal('当前物品编号', item.itemID, 2010);
equal('当前物品脚本绑定', item.spellName, 'Item2010');
const spell = items.object['Items/Spells/Item2010'];
equal('技能原对象根绑定', spell.mScriptName, item.spellName);
const data = Object.fromEntries(item.mDataValues.map(v => [v.mName, v.mValue]));
const calc = item.mItemCalculations.TotalHealCalcTOOLTIP;
equal('具名总恢复计算类型', calc.__type, 'GameCalculation');
equal('具名计算加数数量', calc.mFormulaParts.length, 2);
equal('最大生命比例字段散列', fnvAscii('MaxHPMultiplierTOOLTIP'), '{d3850e11}');
equal('固定恢复字段散列', fnvAscii('FlatHealTOOLTIP'), '{4fe025a7}');
const bindings = calc.mFormulaParts.map(node => ({ node, matchingValues: item.mDataValues.filter(v => fnvAscii(v.mName) === node.mDataValue) }));
for (let i = 0; i < bindings.length; i++) equal(`第${i + 1}个字段唯一解析`, bindings[i].matchingValues.length, 1);
equal('最大生命字段具名引用', bindings[0].matchingValues[0].mName, 'MaxHPMultiplierTOOLTIP');
equal('固定恢复字段具名引用', bindings[1].matchingValues[0].mName, 'FlatHealTOOLTIP');
equal('本物品生命属性原节点', calc.mFormulaParts[0].mStat, 12);
check('本物品原节点未声明mStatFormula', !Object.hasOwn(calc.mFormulaParts[0], 'mStatFormula'));
equal('固定恢复值', data.FlatHealTOOLTIP, 20);
equal('持续秒数', data.PotionDurationTOOLTIP, 5);
equal('消费或出售永久生命', data.BonusMaxHealthTOOLTIP, 30);
near('最大恢复生命阈值', data.MinHPThresholdTOOLTIP, .3, 2e-8);
const biscuit = perks.object['Perks/Styles/Inspiration/BiscuitDelivery'];
const bd = biscuit.mScript.mSpellScriptData.mEffectAmount;
equal('符文身份', biscuit.mPerkId, 8345);
equal('独立包比例原值一致', bd.HealthHealPercent, data.MaxHPMultiplierTOOLTIP);
equal('独立包持续秒数一致', bd.DurationOfEffect, data.PotionDurationTOOLTIP);
equal('独立包固定恢复一致', bd.FlatHeal, data.FlatHealTOOLTIP);
equal('独立包永久生命一致', bd.PermanentHP, data.BonusMaxHealthTOOLTIP);
const locKeys = item.mItemDataClient.mTooltipData.mLocKeys;
const loc = {};
for (const k of ['keyActive', 'keyActiveExtended']) {
  const matches = exactTexts(locKeys[k]);
  equal(`${k}准确正文唯一`, matches.length, 1);
  loc[k] = { key: locKeys[k], ...matches[0] };
  check(`${k}食用治疗与持续绑定`, /食用饼干.*@PotionDurationTOOLTIP@秒里持续回复共.*@TotalHealCalcTOOLTIP@/.test(matches[0].text));
  check(`${k}消费出售仅共同永久生命句`, /消耗或出售一块饼干，都会永久提供.*@BonusMaxHealthTOOLTIP@最大生命值/.test(matches[0].text));
}
check('最大治疗阈值准确绑定', loc.keyActiveExtended.text.includes('最大治疗效果会在@MinHPThresholdTOOLTIP*100@%生命值时达成'));
const official = json(path.join(base, '装备符文/官方原始资料/runesReforged-16.17.1-zh_CN.json')).flatMap(p => p.slots.flatMap(s => s.runes)).find(r => r.id === 8345);
check('官方2%差异实际存在', official.longDesc.includes('2%'));

const diff = [];
function compare(a, b, p = '') {
  if (same(a, b)) return;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) { diff.push({ path: p, before: a ?? null, after: b ?? null }); return; }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) compare(a[k], b[k], `${p}/${k}`);
}
// 业务数组以稳定键比较，避免删除一项后产生无意义的位移差异。
const counts = { skill: 0, parameter: 0, formula: 0, relation: 0, image: 0 };
const baseline = json(path.join(batch, '保护基线.json'));
const expectedRequests = [];
for (const p of final.proposals) {
  const old = before.proposals.find(v => v.id === p.id);
  compare(old.skillBody, p.skillBody, `${p.id}/skillBody`);
  for (const [group, key] of [['parameters', 'parameterKey'], ['formulas', 'formulaKey']]) {
    const oldMap = Object.fromEntries(old[group].map(v => [v[key], v])), newMap = Object.fromEntries(p[group].map(v => [v[key], v]));
    compare(oldMap, newMap, `${p.id}/${group}`);
  }
  for (const group of ['effects', 'processes', 'internalStates', 'triggerRules']) equal(`${p.id}/${group} 无执行动作`, p[group], []);
  const source = perks.object[p.sourcePath];
  equal(`${p.id} 当前来源身份绑定`, source.mPerkId, p.id);
  equal(`${p.id} 来源对象散列`, hash(Buffer.from(JSON.stringify(source))), p.sourceObjectSha256);
  const owner = baseline.owners.find(v => v.runeKey === p.runeKey);
  expectedRequests.push({ id: p.id, skillKey: p.skillKey, kind: 'skill', method: 'POST', route: '/skills', readRoute: `/skills/${p.skillKey}`, body: p.skillBody });
  for (const [group, kind, key] of [['parameters', 'parameter', 'parameterKey'], ['formulas', 'formula', 'formulaKey']])
    for (const body of p[group]) expectedRequests.push({ id: p.id, skillKey: p.skillKey, kind, method: 'POST', route: `/skills/${p.skillKey}/${group}`, readRoute: `/skills/${p.skillKey}/${group}/${body[key]}`, body });
  expectedRequests.push({ id: p.id, skillKey: p.skillKey, kind: 'relation', method: 'POST', route: '/rune-skill-relations', readRoute: `/rune-skill-relations?runeKey=${p.runeKey}&skillKey=${p.skillKey}`, body: p.relationBody });
  expectedRequests.push({ id: p.id, skillKey: p.skillKey, kind: 'image', method: 'PUT', route: `/skills/${p.skillKey}/representative-image`, readRoute: `/skills/${p.skillKey}/representative-image`, body: { imageKey: owner.imageKey } });
  for (const v of p.parameters) if (v.valueMode === 'RUNTIME_INPUT') check(`${p.id}/${v.parameterKey} 未设默认`, v.fixedValue === null && v.levelValues === null);
}
equal('全部66实际请求与最终组成及原图保护逐字段同值', requests.requests, expectedRequests);
for (const r of requests.requests) counts[r.kind]++;
equal('请求分类计数', counts, { skill: 7, parameter: 40, formula: 5, relation: 7, image: 7 });
check('业务变化仅指定符文', diff.every(v => ['5001', '5008', '8275', '8345', '9105'].includes(v.path.split('/')[0])));

function value(id, parameterKey, supplied = {}) {
  const p = final.proposals.find(v => v.id === id).parameters.find(v => v.parameterKey === parameterKey);
  if (!p) throw new Error(`未知参数 ${parameterKey}`);
  if (p.valueMode === 'FIXED') return p.fixedValue;
  if (!Object.hasOwn(supplied, parameterKey) || !Number.isFinite(supplied[parameterKey])) throw new Error(`缺运行输入 ${parameterKey}`);
  return supplied[parameterKey];
}
function calculate(id, formulaKey, supplied = {}, attributes = {}) {
  const formula = final.proposals.find(v => v.id === id).formulas.find(v => v.formulaKey === formulaKey);
  function evaluate(n) {
    if (n.nodeType === 'PARAMETER') return value(id, n.parameterKey, supplied);
    if (n.nodeType === 'ATTRIBUTE') {
      const key = [n.attributeOwner, n.attributeKey, n.attributeValueKind].join('/');
      if (!Object.hasOwn(attributes, key)) throw new Error(`缺属性 ${key}`);
      return attributes[key];
    }
    if (n.nodeType !== 'OPERATION') throw new Error(`非法节点 ${n.nodeType}`);
    const args = n.operands.map(evaluate);
    if (n.operation === 'MULTIPLY') return args.reduce((a, b) => a * b, 1);
    if (n.operation === 'ADD') return args.reduce((a, b) => a + b, 0);
    if (n.operation === 'MIN') return Math.min(...args);
    throw new Error(`未支持运算 ${n.operation}`);
  }
  return evaluate(formula.expression);
}
const math = [];
function sample(id, formulaKey, supplied, attributes, expected, reason) {
  let actual; try { actual = calculate(id, formulaKey, supplied, attributes); } catch (e) { actual = e.message; }
  const pass = typeof expected === 'number' ? typeof actual === 'number' && Math.abs(actual - expected) < 1e-9 : typeof actual === 'string' && actual.startsWith(expected);
  math.push({ id, formulaKey, supplied, attributes, expected, actual, reason, pass });
  check(`独立算例 ${id}/${formulaKey} ${reason}`, pass);
}
for (const n of [0, 5, 10, 13]) sample(8316, 'skill_haste_from_distinct_attributes', { actual_distinct_equipment_attribute_count: n }, {}, n, '已核不同属性种类数，非装备件数');
sample(8316, 'skill_haste_from_distinct_attributes', {}, {}, '缺运行输入', '缺计数必须拒绝');
for (const [hp, expected] of [[2000, 50], [3000, 65], [1234.5, 38.5175], [2030, 50.45]]) sample(8345, 'base_biscuit_recovery', {}, { 'SOURCE/hp/TOTAL': hp }, expected, '以明确最大生命输入核基础总量，不推定+30发生先后');
sample(8345, 'base_biscuit_recovery', {}, { 'SOURCE/hp/CURRENT': 600 }, '缺属性', '当前生命不能替代最大生命');
for (const n of [0, 1, 3]) sample(8345, 'permanent_health_gain', { actual_consumed_or_sold_count: n }, {}, n * 30, '实际已消费或出售数量');
sample(8345, 'permanent_health_gain', {}, {}, '缺运行输入', '取得数量不可默认消费数量');
for (const [heal, expected] of [[10, 7], [35, 24.5], [50, 35], [35.5, 24.85]]) sample(8463, 'ranged_heal_amount', { actual_base_heal: heal }, {}, expected, '远程乘70%，近战直接引用同一基础参数');
sample(8463, 'ranged_heal_amount', {}, {}, '缺运行输入', '未知等级基础治疗不默认为零');
equal('近战基础35不乘远程系数', value(8463, 'actual_base_heal', { actual_base_heal: 35 }), 35);
for (const [n, expected] of [[0, 0], [7, 10.5], [10, 15], [11, 15], [100, 15]]) sample(9105, 'base_skill_haste_from_legend', { actual_legend_stacks: n }, {}, expected, '真实非负整数层数，超过10应用上限');
sample(9105, 'base_skill_haste_from_legend', {}, {}, '缺运行输入', '缺层数不默认为0或10');
equal('五公式覆盖', [...new Set(math.map(v => `${v.id}/${v.formulaKey}`))].length, 5);
check('撤除三个纯参数中转公式', [5001, 5008, 8275].every(id => final.proposals.find(v => v.id === id).formulas.length === 0));
check('人选比例输入已删', !final.proposals.find(v => v.id === 8345).parameters.some(v => /selected/.test(v.parameterKey)));
equal('候选基础恢复固定系数', value(8345, 'client_health_recovery_ratio'), .015);
equal('候选持续单位毫秒', value(8345, 'recovery_effect_duration_ms'), data.PotionDurationTOOLTIP * 1000);
equal('阈值仅参数', value(8345, 'health_ratio_at_maximum_recovery'), .3);

const sourceProof = {
  sources: [items, texts, perks].map(({ object, ...rest }) => rest),
  sourceUrls: [itemManifest[0]['地址'], itemManifest[1]['地址'], perkManifest.url],
  versionBoundary: '已独立核对三包均来自固定16.17目录和冻结SHA；对象中没有精确构建号字段，16.17.8104348不能由这三对象本身重新证明。官方显示来自16.17.1。',
  itemPath: 'Items/2010', item, spellPath: 'Items/Spells/Item2010', spell, bindings, loc, runePath: 'Perks/Styles/Inspiration/BiscuitDelivery', rune: biscuit, official,
  conclusion: '本物品具名计算、当前长文及符文原值足够采用20+0.015×自身最大生命基础恢复量，并确认食用后5秒持续恢复。消费或出售只共同证明永久+30最大生命；不依据旧短文认定出售治疗。不将本例推广成所有mStat12/0的通用映射。'
};
fs.writeFileSync(path.join(out, '独立来源绑定.json'), JSON.stringify(sourceProof, null, 2) + '\n', { flag: 'wx' });
const report = {
  at: new Date().toISOString(), status: checks.every(v => v.pass) ? 'READY' : 'REVISE', candidateSha256, planSha256, originalCandidateSha256: beforeSha,
  actualAPIGetCount: 0, businessWrites: 0, method: '本次从原压缩资料和最终候选独立读取并求值；不将主负责人GET流水算作本次GET，不调用主负责人公式求值器。',
  counts, sourceProofSha256: hashFile(path.join(out, '独立来源绑定.json')), checks, businessDiff: diff, math,
  nonblockingBoundaries: [
    '只验证静态参数及独立基础公式，无治疗效果、触发、周期或战斗运行证明。',
    '饼干基础恢复采用外部明确的自身最大生命；消费永久+30与治疗取样先后、缺血增幅中间曲线和首跳仍未证，未默认。',
    '未知运行输入必须继续拒绝缺值；层数应由调用方提供非负整数。本次没有把非法负层输入裁成0。',
    '原sourceOnly保留0.3未命名字段待核，新增阈值由物品具名字段单独证明，不反向宣称已还原符文匿名字段。',
    '候选历史资格描述还包含消费或出售；最终技能主体明确出售不据短文假定治疗，当前没有执行动作，后续挂接时必须按治疗/永久生命分别检查资格。'
  ]
};
fs.writeFileSync(path.join(out, '最终独立审查结论.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: report.status, candidateSha256, planSha256, checks: checks.length, failed: checks.filter(v => !v.pass), math: math.length, businessChanges: diff.map(v => v.path), reportSha256: hashFile(path.join(out, '最终独立审查结论.json')) }, null, 2));
if (report.status !== 'READY') process.exitCode = 1;
