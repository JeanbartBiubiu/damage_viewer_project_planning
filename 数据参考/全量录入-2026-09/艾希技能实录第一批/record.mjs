import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// 固定的本地艾希 W/R 批次；默认只读，显式 --apply 才补建缺项，不覆盖现有值。
const dir = path.dirname(fileURLToPath(import.meta.url));
const batch = path.dirname(dir);
const sourcePath = path.join(batch, '艾希拉克丝客户端补证/ashe.bin.json');
const sourceHash = createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
assert.equal(sourceHash, '9b2e4e241134f8e93153a752fe54f65c2dddccc795b9c9d575ec45111fccafd2');
const raw = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const wPath = 'Characters/Ashe/Spells/VolleyAbility/Volley';
const rPath = 'Characters/Ashe/Spells/EnchantedCrystalArrowAbility/EnchantedCrystalArrow';
const w = raw[wPath].mSpell;
const r = raw[rPath].mSpell;
const vals = (s, name, count) => s.DataValues.find(v => v.name === name).values.slice(1, count + 1);
assert.deepEqual(vals(w, 'BaseDamage', 5), [60, 95, 130, 165, 200]);
assert.deepEqual(vals(w, 'NumberOfArrowsTooltip', 5), [7, 8, 9, 10, 11]);
assert.deepEqual(w.cooldownTime.slice(1, 6), [18, 14.5, 11, 7.5, 4]);
assert.deepEqual(w.mana.slice(0, 5), [75, 70, 65, 60, 55]);
assert.deepEqual(vals(r, 'RBaseDamage', 3), [200, 400, 600]);
assert.deepEqual(r.cooldownTime.slice(1, 4), [100, 80, 60]);
assert.deepEqual(r.mana.slice(0, 3), [100, 100, 100]);

const parameter = (parameterKey, name, values, description, sortOrder, valueType = 'INTEGER') => ({
  parameterKey, name, valueType, valueMode: Array.isArray(values) ? 'SKILL_LEVEL' : 'FIXED',
  fixedValue: Array.isArray(values) ? null : values,
  levelValues: Array.isArray(values) ? Object.fromEntries(values.map((v, i) => [String(i + 1), v])) : null,
  description, sortOrder
});
const p = parameterKey => ({ nodeType: 'PARAMETER', parameterKey });
const a = (attributeKey, attributeValueKind) => ({ nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey, attributeValueKind });
const op = (operation, x, y) => ({ nodeType: 'OPERATION', operation, operands: [x, y] });
const valueRule = value => ({ value, fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null });
const formula = (formulaKey, name, expression, description) => ({ formulaKey, name, description, sortOrder: 0, expression });
const damage = (name, damageTypeKey, description) => ({
  effectKey: 'hit_damage', name, description, sortOrder: 0, lifecycle: null,
  results: [{ resultKey: 'damage', name: '一次命中伤害', target: 'TARGET',
    description: '仅伤害数值组成，不加普通暴击倍率；减速或眩晕另行配置。旧 Wiki 明示可被法术护盾阻挡，本结果选择当前结果粒度。吸血留待游戏级规则，空列表不表示不吸血。',
    sortOrder: 0, lifecycleBehavior: null, spellShieldBlockScope: 'RESULT', resultType: 'DAMAGE',
    valueRule: valueRule({ kind: 'FORMULA', formulaKey: 'hit_damage' }),
    detail: { damageTypeKey, deliveryKind: 'SKILL', originKind: 'DIRECT',
      critical: { mode: 'DISALLOWED', multiplierValue: null }, vampRules: [] } }]
});
const mana = name => ({
  effectKey: 'mana_cost', name, description: '明确的施放法力消耗组成；当前尚未挂接施法过程，不表示已经自动消耗。',
  sortOrder: 10, lifecycle: null,
  results: [{ resultKey: 'consume_mana', name: '消耗法力', target: 'SOURCE', description: null,
    sortOrder: 0, lifecycleBehavior: null, spellShieldBlockScope: null, resultType: 'RESOURCE_CHANGE',
    valueRule: { ...valueRule({ kind: 'PARAMETER', parameterKey: 'mana_cost' }), fixedMinValue: 0 },
    detail: { attributeKey: 'mana', operation: 'CONSUME' } }]
});
const skills = [
  { skillKey: 'ashe_w', maxLevel: 5,
    parameters: [
      parameter('base_damage', 'W 基础物理伤害', [60, 95, 130, 165, 200], '冻结资料：客户端 16.17 Volley 主对象 DataValues.BaseDamage，取等级 1～5；仅基础伤害。', 0),
      parameter('bonus_ad_ratio', 'W 额外攻击力比例', 1, 'Volley.TotalDamage 的 mStat=2、mStatFormula=2、ADRatio=1；额外攻击力口径与冻结 Wiki 及同版本星蚀公式旁证一致。', 10, 'DECIMAL'),
      parameter('arrow_count', 'W 箭矢数量', [7, 8, 9, 10, 11], '采用当前说明绑定的 NumberOfArrowsTooltip；同一目标只受一次伤害，不能将箭数当作伤害次数。', 20),
      parameter('cooldown_ms', 'W 冷却时间（毫秒）', [18000, 14500, 11000, 7500, 4000], '客户端 cooldownTime 索引 1～5，秒转毫秒；与 DDragon 16.17.1 一致。仅参数，尚未挂接施法过程。', 30),
      parameter('mana_cost', 'W 法力消耗', [75, 70, 65, 60, 55], '客户端六位 mana 数组取索引 0～4；与 DDragon 16.17.1 一致，不套用冷却数组的偏移。', 40),
      parameter('cast_time_ms', 'W 施法时间（毫秒）', 250, '客户端 spellCastTime=0.25 秒，与冻结 Wiki 一致；施法过程尚未配置。', 50)
    ],
    formulas: [formula('hit_damage', 'W 一次命中物理伤害', op('ADD', p('base_damage'), op('MULTIPLY', a('attack_damage', 'BONUS'), p('bonus_ad_ratio'))), '基础伤害 + 100%额外攻击力。当前 Volley 主对象，不使用旧 VolleyRank2～5 子对象。')],
    effects: [damage('W 一次命中物理伤害', 'physics', '仅一次实际命中的伤害；多箭同目标去重、英雄强化减速和命中事件接线待补，不能按箭数重复执行。'), mana('W 施放法力消耗')]
  },
  { skillKey: 'ashe_r', maxLevel: 3,
    parameters: [
      parameter('base_damage', 'R 基础魔法伤害', [200, 400, 600], '客户端 RBaseDamage 索引 1～3，与冻结 Wiki 一致。', 0),
      parameter('ap_ratio', 'R 法术强度比例', 1.2, '客户端 RMainDamage.APRatio 原浮点 1.2000000476837158 按 1.2 归一，与冻结 Wiki 120%一致。', 10, 'DECIMAL'),
      parameter('cooldown_ms', 'R 冷却时间（毫秒）', [100000, 80000, 60000], '客户端 cooldownTime 索引 1～3，秒转毫秒；与 DDragon 16.17.1 一致。仅参数，尚未挂接施法过程。', 20),
      parameter('mana_cost', 'R 法力消耗', 100, '客户端 mana 索引 0～2 均为 100；与 DDragon 16.17.1 一致。', 30),
      parameter('min_stun_duration_ms', 'R 最短眩晕时间（毫秒）', 1000, '客户端 MinStunDuration=1 秒；仅上下界参数，不表示已有眩晕效果。', 40),
      parameter('max_stun_duration_ms', 'R 最长眩晕时间（毫秒）', 3500, '客户端 MaxStunDuration=3.5 秒；距离换算与控制行为待接线。', 50),
      parameter('cast_time_ms', 'R 施法时间（毫秒）', 250, '客户端 spellCastTime=0.25 秒，与冻结 Wiki 一致；施法过程尚未配置。', 60)
    ],
    formulas: [formula('hit_damage', 'R 命中英雄魔法伤害', op('ADD', p('base_damage'), op('MULTIPLY', a('ability_power', 'TOTAL'), p('ap_ratio'))), '基础伤害 + 120%法术强度；对应 RMainDamage，未建立附近目标选择。')],
    effects: [damage('R 命中英雄魔法伤害', 'magic', '仅直接命中英雄的伤害组成；眩晕、附近目标伤害及减速、视野和弹道待补，不默认命中。'), mana('R 施放法力消耗')]
  }
];
const apply = process.argv.includes('--apply');
const baseUrl = 'http://127.0.0.1:8080/api/admin/games/lol';
async function request(endpoint, body) {
  const response = await fetch(baseUrl + endpoint, { method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer local-entry', 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  if (!response.ok && response.status !== 404) throw new Error(`${endpoint}: ${response.status} ${JSON.stringify(result)}`);
  return { status: response.status, result };
}
function project(actual, expected) {
  if (Array.isArray(expected)) return actual?.map((v, i) => project(v, expected[i]));
  if (expected && typeof expected === 'object') return Object.fromEntries(Object.keys(expected).map(k => [k, project(actual?.[k], expected[k])]));
  return actual;
}
const journal = { observedAt: new Date().toISOString(), mode: apply ? '补缺实录' : '只读核对',
  gameId: 'lol', sourceHash, sourcePaths: [wPath, rPath], records: [], missing: [],
  mechanismStatus: '部分录入', runtimeStatus: '未执行' };
fs.writeFileSync(path.join(dir, '录入候选.json'), JSON.stringify({ sourceHash, skills }, null, 2) + '\n');
for (const skill of skills) {
  const owner = await request(`/skills/${skill.skillKey}`);
  assert.equal(owner.status, 200);
  assert.equal(owner.result.maxLevel, skill.maxLevel);
  for (const type of ['parameters', 'formulas', 'effects']) {
    const keyField = { parameters: 'parameterKey', formulas: 'formulaKey', effects: 'effectKey' }[type];
    for (const expected of skill[type]) {
      const endpoint = `/skills/${skill.skillKey}/${type}/${expected[keyField]}`;
      let found = await request(endpoint);
      let action = '保留已有一致值';
      if (found.status === 404) {
        if (!apply) { journal.missing.push(endpoint); continue; }
        const saved = await request(`/skills/${skill.skillKey}/${type}`, expected);
        assert.ok(saved.status >= 200 && saved.status < 300);
        action = '新增';
      } else assert.deepEqual(project(found.result, expected), expected, `已有值冲突：${endpoint}`);
      // 独立 GET 详情，不以保存响应充当回读；逐对象立即记录，便于失败后按稳定键续录。
      found = await request(endpoint);
      assert.equal(found.status, 200);
      assert.deepEqual(project(found.result, expected), expected, `回读差异：${endpoint}`);
      journal.records.push({ endpoint, action, expected, actual: found.result, matches: true });
      fs.writeFileSync(path.join(dir, apply ? '实录回读.json' : '独立核对.json'), JSON.stringify(journal, null, 2) + '\n');
      console.log(`${skill.skillKey} ${type} ${expected[keyField]} ${action}`);
    }
  }
}
journal.counts = Object.fromEntries(['parameters', 'formulas', 'effects'].map(type => [type, journal.records.filter(x => x.endpoint.includes(`/${type}/`)).length]));
fs.writeFileSync(path.join(dir, apply ? '实录回读.json' : '独立核对.json'), JSON.stringify(journal, null, 2) + '\n');
console.log(JSON.stringify({ counts: journal.counts, missing: journal.missing.length }));
