import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
if (process.argv.length !== 2) throw new Error('只生成本地候选，不接受写入参数');
const here = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(here, '../../装备符文');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (name, body) => fs.writeFileSync(path.join(here, name), JSON.stringify(body, null, 2) + '\n');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceFile = path.join(sourceDir, '客户端提取资料/perks-16.17-zh_CN.json');
const sourceSha256 = 'be0bb4eedde39f3a8e1dc245f9b4382379d87674c2fdc62b2650b6af4d9f565b';
assert.equal(hash(sourceFile), sourceSha256);
assert.equal(fs.statSync(sourceFile).size, 102473);
const perks = read(sourceFile), baseline = read(path.join(here, '当前只读现值.json'));
const records = new Map(baseline.records.map(row => [row.route, row]));
const attrs = new Map(records.get('/attributes').data.items.map(row => [row.attributeKey, row]));
const zone = records.get('/modifier-zones').data.items.find(row => row.modifierZoneKey === 'attribute_flat_add');
assert.equal(zone.status, 'ENABLED'); assert.equal(zone.domain, 'ATTRIBUTE'); assert.equal(zone.calculationMode, 'FLAT_ADD'); assert.equal(zone.applicationStage, 'ATTRIBUTE_FLAT');
assert(records.get('/skill-categories').data.items.some(row => row.skillCategoryKey === 'passive' && row.status === 'ENABLED'));
const clean = value => value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const source = id => { const index = perks.findIndex(row => row.id === id); assert(index >= 0); return { file: '装备符文/客户端提取资料/perks-16.17-zh_CN.json', pointer: `/${index}`, sha256: sourceSha256, raw: perks[index], text: clean(perks[index].longDesc), version: '16.17' }; };
const sources = [5005, 5007, 5010, 5011, 5013, 5008, 5001].map(source);
const expectedText = new Map([[5005,'+10%攻击速度'],[5007,'+8技能急速'],[5010,'+2.5% 移动速度'],[5011,'+65生命值'],[5013,'+15%韧性和减速抗性'],[5008,'+9 适应之力'],[5001,'+10-180生命值(基于等级)']]);
for (const row of sources) assert.equal(row.text, expectedText.get(row.raw.id));
const fixed = value => ({ kind: 'FIXED', value });
const parameterValue = parameterKey => ({ kind: 'PARAMETER', parameterKey });
const parameter = (key, name, value, description, sortOrder = 10) => ({ parameterKey: key, name, valueType: Number.isInteger(value) ? 'INTEGER' : 'DECIMAL', valueMode: 'FIXED', fixedValue: value, levelValues: null, description, sortOrder });
const life = () => ({ durationValue: null, maxStacksValue: fixed(1), applicationStacksValue: fixed(1), instanceScope: 'SOURCE', reapplicationStackMode: 'KEEP', reapplicationDurationMode: null, expiryMode: 'EXPLICIT_ONLY', periodicIntervalValue: null, firstPeriodicExecution: null });
const behavior = () => ({ moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED', reapplicationValueMode: 'REPLACE', periodicExecutionMode: null });
const entries = [];
function passive({ id, name, key, value, attributeKey, unit, meaning, boundary, withEffect = true }) {
  const src = source(id); assert.equal(attrs.get(attributeKey)?.status, 'ENABLED');
  const skillKey = `rune_${id}_passive`;
  const skill = { skillKey, name: `符文碎片·${name}`, description: `${src.text}。来源：客户端提取16.17符文${id}。${meaning}`, maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive'] };
  const parameters = [parameter(key, `${name}${unit}`, value, `${src.pointer}/longDesc：${src.text}。${meaning}`)];
  const effects = withEffect ? [{ effectKey: 'stat_bonus', name: `${name}常驻加成`, description: meaning, sortOrder: 10, lifecycle: life(), results: [{ resultKey: 'stat_bonus', name: `${name}加成`, description: meaning, sortOrder: 10, resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE', lifecycleBehavior: behavior(), spellShieldBlockScope: null, valueRule: { value: parameterValue(key), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null }, detail: { attributeKey, operation: 'INCREASE', modifierZoneKey: 'attribute_flat_add' } }] }] : [];
  const triggerRules = withEffect ? [{ ruleKey: 'initialize_stat_bonus', name: `初始化${name}常驻加成`, description: '来源对象初始化完成时，建立此来源的单层常驻属性加成。重复施加保持一层，不在初始化时造成伤害、治疗或扣除资源。', sortOrder: 10, eventSource: { eventType: 'SOURCE_INITIALIZED', detail: {} }, perTargetCooldown: null, maxTriggersPerProcess: null, conditionGroups: [], actions: [{ actionKey: 'execute_stat_bonus', name: `执行${name}加成`, actionType: 'EXECUTE_EFFECT', targetContext: 'EVENT_SOURCE', sortOrder: 10, detail: { effectKey: 'stat_bonus' }, runtimeInputBindings: [], resultModifiers: [] }] }] : [];
  const relation = { runeKey: `rune_${id}`, skillKey, sortOrder: 0 };
  const api = { skill, parameters, formulas: [], effects, processes: [], internalStates: [], triggerRules, relation };
  const requests = [{ method: 'POST', path: '/skills', body: skill }, ...parameters.map(body => ({ method: 'POST', path: `/skills/${skillKey}/parameters`, body })), ...effects.map(body => ({ method: 'POST', path: `/skills/${skillKey}/effects`, body })), ...triggerRules.map(body => ({ method: 'POST', path: `/skills/${skillKey}/trigger-rules`, body })), { method: 'POST', path: '/rune-skill-relations', body: relation }];
  const result = { id, source: src, status: withEffect ? '固定自身属性配置候选' : '仅参数候选', api, requests, attributeEvidence: attrs.get(attributeKey), modifierZoneEvidence: zone, semanticBoundary: boundary, beforeSkill: records.get(`/skills/${skillKey}`), beforeRelation: records.get(`/rune-skill-relations?runeKey=rune_${id}`) };
  entries.push(result); return result;
}
const haste = passive({ id: 5007, name: '技能急速', key: 'ability_haste_bonus', value: 8, attributeKey: 'ability_haste', unit: '点数', meaning: '给持有者增加8点技能急速；不是8%冷却缩减，也不直接修改某个技能的冷却。', boundary: ['沿当前ability_haste点数属性固定加算；战斗冷却公式由既有结算读取，不在本技能复制或重写。'] });
write('页面种子.json', { status: '只准备未执行', source: haste.source, api: haste.api, requests: haste.requests, prerequisite: '由身份录入任务先建立rune_5007；当前只读记录为404时不得把关系失败当作技能失败，也不得本任务重复创建符文。', arithmetic: [{ expression: '已有20点技能急速 + 8点', expected: 28, unit: '点' }, { expression: '已有0点技能急速 + 8点', expected: 8, unit: '点' }, { expression: '重复初始化保持同一来源一层', expectedContribution: 8, incorrectContribution: 16, unit: '点' }] });
passive({ id: 5005, name: '攻击速度', key: 'bonus_attack_speed_ratio', value: 0.1, attributeKey: 'bonus_attack_speed_percent', unit: '比例', meaning: '向额外攻击速度比例贡献0.10，即10个百分点；不是增加每秒0.10次，也不是把当前总攻速乘1.10。', boundary: ['当前属性目录以1表示100%；沿既有额外攻速比例累加口径，具体攻速系数、上限和英雄例外由战斗结算负责。'] });
passive({ id: 5011, name: '固定生命值', key: 'health_bonus', value: 65, attributeKey: 'hp', unit: '点数', meaning: '增加持有者65点生命值属性；不创建治疗、回复当前生命或每次事件获得65生命的离散效果。', boundary: ['属性形成后的最大生命与初始当前生命如何建立由角色/战斗初始化负责；候选只授予常驻生命属性。'] });
passive({ id: 5010, name: '移动速度', key: 'move_speed_ratio', value: 0.025, attributeKey: 'move_speed_percent', unit: '比例', meaning: '记录2.5%移速加成比例0.025；多个百分比移速来源的加算/乘算分组在当前冻结文本中尚未确证。', boundary: ['已有独立move_speed_percent字典只说明比例单位，不能证明本碎片与全部装备移速组合规则。暂不直接加算持续属性，也不借用attribute_percent_bonus乘总移速。'], withEffect: false });
const tenacity = passive({ id: 5013, name: '韧性和减速抗性', key: 'tenacity_ratio', value: 0.15, attributeKey: 'tenacity_percent', unit: '比例', meaning: '确定提供15%韧性和15%减速抗性；两者为不同属性。多来源合并规则待核，因此当前不配置持续属性效果。', boundary: ['tenacity_percent、slow_resist_percent均已存在并启用；attribute_flat_add结构合法，但不能证明与装备韧性或减速抗性简单加算正确。无已核实的专用组合区，不创建新修正区。'], withEffect: false });
assert.equal(attrs.get('slow_resist_percent')?.status, 'ENABLED');
tenacity.api.parameters.push(parameter('slow_resist_ratio', '减速抗性比例', 0.15, `${tenacity.source.pointer}/longDesc同时给出15%减速抗性，按1代表100%记录，组合口径待核。`, 20));
tenacity.requests.splice(2, 0, { method: 'POST', path: '/skills/rune_5013_passive/parameters', body: tenacity.api.parameters[1] });
tenacity.additionalAttributeEvidence = attrs.get('slow_resist_percent');
const pending = [{ id: 5008, source: source(5008), status: '只核来源，不建立技能参数公式效果', issues: ['原文只确证9适应之力；tooltip仍含@f2@，未给攻击力/法强选择条件与0.6换算。不能保存5.4攻击力或9法强的自选分支冒充自动适应。'] }, { id: 5001, source: source(5001), status: '只核来源，不建立成长参数公式效果', issues: ['原文只给10–180生命值(基于等级)，tooltip仍含@f1@；没有1至18级逐级值或可验证曲线，不推断10×等级。'] }];
const arithmetic = [
  { id: 5007, sample: '已有技能急速20', independent: '20 + 8', expected: 28, actual: 20 + haste.api.parameters[0].fixedValue, unit: '点' },
  { id: 5005, sample: '已有额外攻速比例0.35', independent: '0.35 + 0.10', expected: 0.45, actual: 0.35 + entries.find(x => x.id === 5005).api.parameters[0].fixedValue, unit: '额外攻速比例' },
  { id: 5005, sample: '单位核对', independent: '10 / 100', expected: 0.1, actual: entries.find(x => x.id === 5005).api.parameters[0].fixedValue, unit: '比例' },
  { id: 5011, sample: '已有生命值属性1000', independent: '1000 + 65', expected: 1065, actual: 1000 + entries.find(x => x.id === 5011).api.parameters[0].fixedValue, unit: '点' },
  { id: 5010, sample: '单位核对，不推断与装备组合', independent: '2.5 / 100', expected: 0.025, actual: entries.find(x => x.id === 5010).api.parameters[0].fixedValue, unit: '比例' },
  { id: 5013, sample: '两个独立比例，不合成30%', independent: '[15 / 100, 15 / 100]', expected: [0.15,0.15], actual: tenacity.api.parameters.map(x => x.fixedValue), unit: '依次韧性和减速抗性比例' },
  { id: 5013, sample: '阻止错误跨来源加算效果', independent: '效果数量应为0', expected: 0, actual: tenacity.api.effects.length, unit: '个' },
  { id: 5010, sample: '未证实移速分组前不生成属性效果', independent: '效果数量应为0', expected: 0, actual: entries.find(x => x.id === 5010).api.effects.length, unit: '个' }
];
for (const check of arithmetic) { if (typeof check.expected === 'number') assert(Math.abs(check.expected - check.actual) < 1e-12); else assert.deepEqual(check.expected, check.actual); check.passed = true; }
for (const entry of entries) {
  assert.equal(entry.api.skill.skillKey, `rune_${entry.id}_passive`);
  assert(entry.api.effects.every(effect => effect.results.every(result => result.target === 'SOURCE')));
  assert(entry.api.triggerRules.every(rule => rule.eventSource.eventType === 'SOURCE_INITIALIZED'));
  assert(!entry.requests.some(request => request.path === '/runes' || request.path === '/modifier-zones' || request.path === '/attributes'));
}
const counts = { checkedIdentities: 7, independentSkillCandidates: entries.length, completeFixedAttributeCandidates: entries.filter(x => x.api.effects.length).length, parameterOnlyCandidates: entries.filter(x => !x.api.effects.length).length, sourceOnly: pending.length, parameters: entries.reduce((n,x)=>n+x.api.parameters.length,0), effects: entries.reduce((n,x)=>n+x.api.effects.length,0), triggerRules: entries.reduce((n,x)=>n+x.api.triggerRules.length,0), formulas: 0, runeSkillRelations: entries.length, apiWritesPerformed: 0 };
write('冻结来源.json', { checkedAt: new Date().toISOString(), version: '16.17', sourceFile: '装备符文/客户端提取资料/perks-16.17-zh_CN.json', sourceUrl: 'https://raw.communitydragon.org/16.17/plugins/rcp-be-lol-game-data/global/zh_cn/v1/perks.json', sourceSha256, byteSize: 102473, sources, note: '精确根指当前冻结perks数组索引和完整对象，不把它宣称为客户端玩法脚本或数值计算树。' });
write('候选与边界.json', { status: '只准备未执行', counts, baselineAt: baseline.checkedAt, entries, pending });
write('可审查请求.json', entries.map(entry => ({ id: entry.id, status: entry.status, requests: entry.requests })));
write('独立数值核对.json', { checkedAt: new Date().toISOString(), scope: '冻结值、存储单位及明确属性加算的独立算例；未运行战斗引擎', arithmetic });
console.log(JSON.stringify({ counts, candidateSha256: hash(path.join(here, '候选与边界.json')), seed: path.join(here, '页面种子.json') }, null, 2));
