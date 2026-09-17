import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '../..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const save = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2) + '\n');
const manifest = read('装备效果补证/来源与覆盖.json');
const sources = [];
function frozen(name) {
  const record = manifest.原始资料.find(row => row.文件.endsWith(name));
  assert.ok(record, name);
  const compressed = fs.readFileSync(path.join(root, '装备效果补证', record.文件));
  const raw = zlib.gunzipSync(compressed);
  for (const [bytes, expected] of [[compressed, record.压缩SHA256], [raw, record.原始SHA256]]) {
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expected);
  }
  sources.push(record);
  return JSON.parse(raw);
}
const items = frozen('items-16.17.cdtb.bin.json.gz');
const strings = frozen('lol-16.17-zh_CN.stringtable.json.gz').entries;
const official = read('装备符文/官方原始资料/item-16.17.1-zh_CN.json');
assert.equal(official.version, '16.17.1');
const ids = [1120, 3009, 3046, 3085, 3109];
const expectedAttributes = {
  1120: { hp: 150, armor: 8, magic_resistance: 8 },
  3009: { move_speed: 55 },
  3046: { move_speed_percent: 0.1, bonus_attack_speed_percent: 0.65, critical_strike_chance: 0.25 },
  3085: { move_speed_percent: 0.05, bonus_attack_speed_percent: 0.4, critical_strike_chance: 0.25 },
  3109: { hp: 200, base_hp_regen_percent: 1, armor: 40, ability_haste: 10 },
};
const decisions = {
  1120: { status: '范围内直接属性已录；额外效果范围外', reason: '帮助之手只对小兵造成伤害，不作用于对手英雄。' },
  3009: { status: '补录常驻直接属性', reason: '客户端根对象直接给出25%减速抗性；新建属性目录并在现有装备属性中补值，不另建技能或触发规则。' },
  3046: { status: '范围内直接属性已录；额外效果范围外', reason: '幽灵状态当前定义为无视其他单位碰撞体积，属于已排除的纯空间效果。官方简述旧护盾不属于当前绑定说明。' },
  3085: { status: '范围内直接属性已录；额外效果范围外', reason: '弩箭发向主目标之外的两个额外敌人，本次1V1不把其伤害重复添加到主目标。远程购买限制保留来源，不伪造战斗效果。' },
  3109: { status: '范围内直接属性已录；额外效果范围外', reason: '主动要求绑定另一名友方英雄；自身治疗读取该队友对英雄的伤害，伤害转移读取该队友所受伤害，均无独立的本体1V1触发。保留自身直接属性。' },
};
const roots = ids.map(id => {
  const object = items[`Items/${id}`];
  assert.equal(object.itemID, id);
  const bindings = Object.entries(object.mItemDataClient.mTooltipData.mLocKeys).map(([field, key]) => ({
    field, key, pointer: `/entries/${key.toLowerCase()}`, value: strings[key.toLowerCase()] ?? null,
  }));
  return { id, name: official.data[id].name, pointer: `/Items~1${id}`, object, bindings, official: official.data[id], decision: decisions[id] };
});
assert.equal(items['Items/1120'].mDataValues[0].mValue, 5);
assert.ok(strings.item_1120_tooltip.includes('小兵'));
assert.equal(items['Items/3009'].mPercentSlowResistMod, 0.25);
assert.equal(items['Items/3009'].mDataValues[0].mValue, 25);
assert.equal(items['Items/3009'].mFlatMovementSpeedMod, 55);
assert.ok(strings.item_3046_keyworddefinitions.includes('Item_KeywordDefinition_Ghost'));
assert.ok(strings.item_keyworddefinition_ghost.includes('碰撞体积'));
assert.equal(items['Items/3085'].mEffectAmount[2], 2);
assert.ok(strings.item_3085_tooltip.includes('额外敌人'));
assert.ok(strings.item_3109_active.includes('友方英雄'));
assert.ok(strings.item_3109_tooltip.includes('其对英雄'));
save('冻结来源与范围.json', { generatedAt: new Date().toISOString(), sources, roots,
  indirectDefinition: { pointer: '/entries/item_keyworddefinition_ghost', value: strings.item_keyworddefinition_ghost },
  scopeRule: '只有交战双方；不会因为文字出现自身治疗就忽略必需的第三方队友依赖。已有业务数据不因排除自动删除。',
  passed: true });

const api = 'http://127.0.0.1:8080/api/admin/games/lol';
async function get(route) {
  const response = await fetch(api + route, { headers: { Authorization: 'Bearer local-entry' }, signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  assert.equal(response.status, 200, route);
  return data;
}
const catalog = await get('/attributes?page=1&pageSize=200');
assert.equal(catalog.items.length, catalog.total);
const objects = [];
for (const id of ids) {
  const key = `item_${id}`;
  const [equipment, attributes, relations, representativeImage] = await Promise.all([
    get(`/equipment/${key}`), get(`/equipment/${key}/attributes`),
    get(`/equipment-skill-relations?equipmentKey=${key}&page=1&pageSize=200`), get(`/equipment/${key}/representative-image`),
  ]);
  assert.equal(relations.items.length, relations.total);
  assert.equal(relations.total, 0, `${key}: 已出现真实关联，需先核对而非创建同名技能`);
  const expected = { ...expectedAttributes[id] };
  if (id === 3009 && attributes.attributeValues.slow_resist_percent !== undefined) expected.slow_resist_percent = 0.25;
  assert.deepEqual(attributes.attributeValues, expected, key);
  assert.equal(equipment.equipmentKey, key);
  objects.push({ id, equipmentKey: key, equipment, attributes, relations, representativeImage, decision: decisions[id] });
}
const evidence = { generatedAt: new Date().toISOString(), mode: '仅GET', catalog, objects, passed: true };
const baselinePath = path.join(dir, '写前现值.json');
if (!fs.existsSync(baselinePath)) fs.writeFileSync(baselinePath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
save('当前只读核对.json', evidence);
console.log(JSON.stringify({ mode: evidence.mode, equipmentCount: objects.length, catalogCount: catalog.total, slowResistPresent: catalog.items.some(row => row.attributeKey === 'slow_resist_percent'), passed: true }));
