import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../../..');
const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const sourcePaths = [
  '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/items-16.17.cdtb.bin.json.gz',
  '数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz',
  '数据参考/全量录入-2026-09/装备符文/官方原始资料/item-16.17.1-zh_CN.json'
];
const bytes = sourcePaths.map(relative => fs.readFileSync(path.join(root, relative)));
const hashes = bytes.map((value, index) => ({ file: sourcePaths[index], sha256: createHash('sha256').update(value).digest('hex') }));
const items = JSON.parse(zlib.gunzipSync(bytes[0]));
const strings = JSON.parse(zlib.gunzipSync(bytes[1])).entries;
const evidence = [
  ['Items/3084', 'DamageCalc', 'item_3084_tooltip', 'TOTAL', '当前绑定说明明确使用最大生命值，计算节点mStat=12且省略mStatFormula。'],
  ['Items/4633', '{1247259a}', 'item_4633_tooltip', 'BONUS', '当前绑定说明明确使用额外生命值转法术强度，计算节点mStat=12、mStatFormula=2。']
].map(([key, calculation, stringKey, attributeValueKind, note]) => ({
  sourceFile: sourcePaths[0], pointer: `${key}/mItemCalculations/${calculation}/mFormulaParts/0`,
  rawCalculation: items[key].mItemCalculations[calculation],
  currentBoundStringKeys: items[key].mItemDataClient.mTooltipData.mLocKeys,
  stringSourceFile: sourcePaths[1], stringPointer: `entries/${stringKey}`, rawText: strings[stringKey],
  mapping: { attributeOwner: 'SOURCE', attributeKey: 'hp', attributeValueKind }, note
}));
if (!evidence[0].rawText.includes('最大生命值') || !evidence[1].rawText.includes('额外生命值')) throw new Error('冻结文本不符合已审旁证');
write('属性映射补证.json', {
  generatedAt: new Date().toISOString(), clientVersion: '16.17', officialVersion: '16.17.1', hashes, evidence,
  appliedTo: [
    { equipmentKey: 'item_2502', raw: items['Items/2502'].mItemCalculations.DrainCalc, system: 'SOURCE hp BONUS × 0.03' },
    { equipmentKey: 'item_2504', raw: items['Items/2504'].mItemCalculations.ShieldCalc, system: 'SOURCE hp TOTAL × 0.15' },
    { equipmentKey: 'item_3026', raw: items['Items/3026'].mEffectAmount, rawText: strings.item_3026_tooltip, system: ['SOURCE hp BASE × 0.5', 'SOURCE mana TOTAL × 1'] }
  ],
  note: '仅重读既有冻结文件，没有重新采集来源；属性映射不证明复活、周期或战斗时序已接通。'
});

// 预期值由独立手算常量列出，不从生成器或海妖展开文件导入。
const expectedLevels = [150, 150, 150, 150, 150, 150, 150, 150, 155, 160, 165, 170, 175, 180, 185, 190, 195, 200];
const candidate = read('接口候选.json');
const byKey = new Map(candidate.objects.map(object => [object.equipmentKey, object.apiPayload]));
const attrs = { SOURCE: { hp: { BASE: 1000, BONUS: 2000, TOTAL: 3000, CURRENT: 600 }, mana: { BASE: 500, BONUS: 300, TOTAL: 800, CURRENT: 100 } }, TARGET: { hp: { BASE: 1200, BONUS: 400, TOTAL: 1600, CURRENT: 1000 }, mana: { TOTAL: 400 } } };
function parameter(payload, key, level) {
  const p = payload.parameters.find(value => value.parameterKey === key);
  if (!p) throw new Error(`缺参数 ${key}`);
  return p.valueMode === 'FIXED' ? p.fixedValue : p.levelValues[String(level)];
}
function evaluate(node, payload, level, attributes = attrs) {
  if (node.nodeType === 'PARAMETER') return parameter(payload, node.parameterKey, level);
  if (node.nodeType === 'ATTRIBUTE') return attributes[node.attributeOwner][node.attributeKey][node.attributeValueKind];
  if (node.nodeType === 'OPERATION') {
    const [a, b] = node.operands.map(child => evaluate(child, payload, level, attributes));
    if (node.operation === 'MULTIPLY') return a * b;
    if (node.operation === 'ADD') return a + b;
  }
  throw new Error(`未支持的独立核算节点 ${JSON.stringify(node)}`);
}
const checks = [];
function check(name, expected, actual, note) {
  checks.push({ name, expected, actual, equal: JSON.stringify(expected) === JSON.stringify(actual), note });
}
for (const [key, formulaKey, expected, manual] of [
  ['item_2502', 'drain_damage', 60, '额外生命2000 × 0.03 = 60；最大生命3000不作基数'],
  ['item_2504', 'magic_shield_amount', 450, '最大生命3000 × 0.15 = 450；当前生命600不作基数'],
  ['item_3026', 'revive_base_health', 500, '基础生命1000 × 0.5 = 500；最大生命3000不作基数'],
  ['item_3026', 'revive_max_mana', 800, '最大法力800 × 1 = 800；当前法力100不作基数'],
  ['item_3084', 'empowered_attack_damage', 250, '70 + 最大生命3000 × 0.06 = 250'],
  ['item_3084', 'tracking_duration_ms', 3000, '6 × 500毫秒 = 3000毫秒'],
  ['item_6672', 'maximum_damage', 350, '18级基础200 × 1.75 = 350'],
  ['item_6672', 'ranged_damage', 160, '18级基础200 × 0.8 = 160']
]) {
  const payload = byKey.get(key);
  check(`${key}/${formulaKey}`, expected, evaluate(payload.formulas.find(f => f.formulaKey === formulaKey).expression, payload, 18), manual);
}
const zeroBonus = structuredClone(attrs); zeroBonus.SOURCE.hp.BONUS = 0;
check('苦楚零额外生命边界', 0, evaluate(byKey.get('item_2502').formulas[0].expression, byKey.get('item_2502'), 18, zeroBonus), '额外生命为0时，即使最大生命非0，该独立公式仍为0。');
for (let level = 1; level <= 18; level++) {
  check(`海妖${level}级基础伤害`, expectedLevels[level - 1], parameter(byKey.get('item_6672'), 'damage_amount_by_character_level', level), '独立预期序列；9级当级首次增加5。');
}
check('海妖参数使用角色等级', 'CHARACTER_LEVEL', byKey.get('item_6672').parameters.find(p => p.parameterKey === 'damage_amount_by_character_level').valueMode);
check('海妖上限独立再次核算', 350, evaluate(byKey.get('item_6672').formulas[0].expression, byKey.get('item_6672'), 18), '相同输入再次求值仍350；这只是公式核算，不代表第三击计数运行。');
for (const key of ['item_3084', 'item_6672']) check(`${key}独立伤害没有生命周期`, null, byKey.get(key).effects[0].lifecycle);
check('败魔为普通护盾', 'NORMAL_SHIELD', byKey.get('item_2504').effects[0].results[0].resultType);
check('败魔仅吸收魔法伤害', 'magic', byKey.get('item_2504').effects[0].results[0].detail.absorbedDamageTypeKey);
const shield = byKey.get('item_4632');
check('翠绿屏障授盾目标为持有者', 'SOURCE', shield.effects[0].results[0].target);
check('翠绿屏障只监听成功格挡本技能护盾', { eventType: 'SPELL_SHIELD_BLOCKED', detail: { shieldEffectKey: 'spell_shield' } }, shield.triggerRules[1].eventSource);
check('翠绿屏障成功消费移除自身护盾', { target: 'SOURCE', detail: { operation: 'REMOVE', targetEffectKey: 'spell_shield' } }, { target: shield.effects[1].results[0].target, detail: shield.effects[1].results[0].detail });
check('翠绿屏障初始化事件', 'SOURCE_INITIALIZED', shield.triggerRules[0].eventSource.eventType);
check('翠绿屏障冷却保留60秒', 60000, parameter(shield, 'spell_shield_cooldown_ms', 1));
check('翠绿屏障未伪写恢复或伤害触发', ['SOURCE_INITIALIZED', 'SPELL_SHIELD_BLOCKED'], shield.triggerRules.map(rule => rule.eventSource.eventType));
write('独立手算证据.json', {
  generatedAt: new Date().toISOString(), inputs: attrs, expectedLevels, checks,
  summary: { checkCount: checks.length, mismatchCount: checks.filter(c => !c.equal).length },
  sourceOnlyCases: [
    { name: '苦楚按已造成伤害治疗', expression: '实际伤害100 × 2.5 = 250', expected: 250, status: '来源手算，实际伤害联动待配' },
    { name: '苦楚首次周期', expected: '进入有效英雄战斗状态后4000毫秒首次执行；退出战斗后停止', status: '来源时序边界，未保存周期触发规则' },
    { name: '败魔受魔法伤害重置', expected: '14999毫秒尚未满足；连续满15000毫秒才满足，途中魔法伤害重新计时', status: '来源时序边界，授盾规则待配' },
    { name: '守护天使恢复', expected: '凝滞4000毫秒后执行；300000毫秒冷却', status: '仅恢复量公式已保存，致命伤害前置和凝滞未配置' },
    { name: '心之钢每目标冷却', expected: '同一目标30000毫秒内不能再次消费；不同目标分别计时', status: '来源时序边界，每目标消费触发待配' },
    { name: '翠绿屏障消费边界', expected: '成功格挡本技能护盾才移除；普通攻击、其他护盾格挡、自然结束不执行本规则', status: '已保存指定事件和自身移除配置，未执行战斗事件' },
    { name: '海妖上限与远程', expression: '18级上限200 × 1.75 = 350；若同时取远程上限则350 × 0.8 = 280', expected: 280, status: '端点手算；中间已损失生命曲线未知，未伪造' }
  ],
  note: '对正式候选做独立手算和静态结构比对；不等于浏览器、Wasm或战斗运行验证。历史概念候选和边界算例保持原样。'
});
console.log(JSON.stringify({ sourceHashCount: hashes.length, checkCount: checks.length, mismatchCount: checks.filter(c => !c.equal).length }));
if (checks.some(c => !c.equal)) process.exitCode = 1;
