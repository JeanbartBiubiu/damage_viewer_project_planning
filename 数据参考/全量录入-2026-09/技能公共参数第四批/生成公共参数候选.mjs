import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(here, '../技能公共参数实录');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const hash = b => createHash('sha256').update(b).digest('hex');
const index = read(path.join(sourceDir, '技能来源索引.json'));
const selected = ["Aatrox","Akali","Akshan","Ambessa","AurelionSol","Azir","Bard","Belveth","Braum","Camille","Chogath","Draven","Ekko","Evelynn","Fiddlesticks","Heimerdinger","Ivern","Kaisa","Leblanc","Lillia","Mel","Naafiri","Nami","Nilah"];
const skipped = {
  azir_q: '只指令独立沙兵攻击；沿用独立召唤物排除边界。',
  azir_w: '建立独立沙兵；本轮跳过独立召唤物。',
  heimerdinger_q: '建立独立炮台；本轮跳过独立召唤物。',
  ivern_r: '召唤并指令独立小菊；本轮跳过独立召唤物。',
  bard_e: '纯地形通道；本轮不要求空间执行。',
};
const reviewedOrdinaryCooldowns = new Set(['aatrox_q','akali_e','akali_r','akshan_r','aurelionsol_w','azir_e','belveth_e','camille_q','camille_w','camille_e','draven_e','draven_r','evelynn_q','heimerdinger_e','heimerdinger_r','ivern_q','kaisa_w','leblanc_w','naafiri_q','naafiri_r']);
const reviewedMixedZeroCosts = new Set(['akshan_w','mel_w','nilah_w']);
const scopeNotes = {
  bard_w: '保留自用治疗和70法力；独立治疗圣坛不等于独立战斗角色，成熟与被敌方踩毁分支后续核对。',
  ivern_w: '保留30法力；主动草丛与自身额外攻击伤害存在1V1依赖，纯视野组成跳过。',
  azir_e: '保留自身护盾和本体伤害，不在本轮建立沙兵战斗角色。',
  azir_r: '保留直接伤害与控制，空间执行后置。',
  heimerdinger_r: '保留升级W/E依赖，独立炮台分支跳过。',
};

const plan = [];
const deferredFields = [];
const rankMap = values => Object.fromEntries(values.map((v, i) => [i + 1, v]));
for (const id of selected) {
  const hero = index.heroes.find(x => x.championId === id);
  assert.ok(hero, id);
  const originalBytes = fs.readFileSync(path.join(sourceDir, hero.official.path));
  assert.equal(hash(originalBytes), hero.official.sha256);
  const champ = JSON.parse(originalBytes.toString('utf8')).data[id];
  const clientBytes = gunzipSync(fs.readFileSync(path.join(sourceDir, hero.client.path)));
  assert.equal(hash(clientBytes), hero.client.sha256);
  const client = JSON.parse(clientBytes.toString('utf8'));
  for (let slotIndex = 0; slotIndex < 4; slotIndex++) {
    const slot = ['q', 'w', 'e', 'r'][slotIndex];
    const skillKey = `${id.toLowerCase()}_${slot}`;
    const spell = champ.spells[slotIndex];
    const reference = hero.skills[slotIndex + 1];
    const raw = client[reference.clientPath]?.mSpell;
    assert.ok(raw, skillKey);
    if (skipped[skillKey]) { deferredFields.push({ skillKey, status: '范围外跳过', reason: skipped[skillKey] }); continue; }
    const count = spell.maxrank;
    assert.ok(Number.isInteger(count) && count > 0 && count <= 6);
    const parameters = [];
    const proofs = [];
    // 人工核过的再施放/充能文字只描述附加行为；此处保存整轮基础冷却。
    const reviewedOrdinaryCooldown = reviewedOrdinaryCooldowns.has(skillKey);
    const clientCooldown = Object.hasOwn(raw, 'Cooldown') ? raw.Cooldown?.values : raw.cooldownTime;
    const clientMana = Object.hasOwn(raw, 'manaValues') ? raw.manaValues?.values : raw.mana;
    const hasAmmo = Number(spell.maxammo) > 0 ||
      (Array.isArray(raw.mMaxAmmo) && raw.mMaxAmmo.some(value => Number.isFinite(value) && value > 0));
    const complexCooldown = hasAmmo || (!reviewedOrdinaryCooldown && /充能|蓄能|再次施放|重新激活|<toggle>/i.test(spell.tooltip ?? ''));
    const add = (key, name, values, pointer, offset, rawValues, unit, sortOrder) => {
      assert.equal(values.length, count, skillKey + key);
      assert.ok(values.every(Number.isFinite));
      const fixed = values.every(v => v === values[0]);
      parameters.push({ parameterKey: key, name, valueType: values.every(Number.isInteger) ? 'INTEGER' : 'DECIMAL',
        valueMode: fixed ? 'FIXED' : 'SKILL_LEVEL', fixedValue: fixed ? values[0] : null,
        levelValues: fixed ? null : rankMap(values), sortOrder,
        description: `DDragon16.17.1 ${id}.spells[${slotIndex}].${pointer}，等级1起索引0；与冻结客户端根绑定字段索引${offset}起逐级一致。${unit}。仅基础参数，未计急速或其他技能修正；不表示过程与机制完成。${key === 'cooldown_ms' && reviewedOrdinaryCooldown ? '已核对为首段或整轮基础冷却，再施放间隔和实际起算时点另配。' : ''}${key === 'mana_cost' && reviewedMixedZeroCosts.has(skillKey) ? '末级零费用为两来源明确数值，并非缺值补零。' : ''}${scopeNotes[skillKey] ?? ''}` });
      proofs.push({ parameterKey: key, officialPointer: `data.${id}.spells[${slotIndex}].${pointer}`,
        clientPointer: `${reference.clientPath}/mSpell/${key === 'cooldown_ms' ? (Object.hasOwn(raw, 'Cooldown') ? 'Cooldown/values' : 'cooldownTime') : (Object.hasOwn(raw, 'manaValues') ? 'manaValues/values' : 'mana')}`,
        officialValues: spell[pointer], clientRawValues: rawValues,
        legacyClientRawValues: key === 'cooldown_ms' ? raw.cooldownTime ?? null : raw.mana ?? null,
        clientOffset: offset, values, unit });
    };
    const cooldown = spell.cooldown;
    if (skillKey === 'belveth_q') deferredFields.push({skillKey, field:'cooldown_ms', status:'另按方向冷却配置', reason:'普通字段4/3.25/2.5/1.75/1秒不代表四方向冷却；PerSideCooldown为16/15/14/13/12秒并受攻速影响，后续按方向机制配置。'});
    else if (complexCooldown) deferredFields.push({ skillKey, field: 'cooldown_ms', status: '待核对', reason: '含充能/再施放/开关；区分施放间隔、整体冷却与充能恢复后再采用。' });
    else if (Array.isArray(cooldown) && cooldown.length === count && cooldown.every(v => Number.isFinite(v) && v > 0) &&
      Array.isArray(clientCooldown) && clientCooldown.length >= count + 1 && cooldown.every((v, i) => Math.abs(v - clientCooldown[i + 1]) < 0.00001)) {
      add('cooldown_ms', '基础冷却时间（毫秒）', cooldown.map(v => Math.round(v * 1000)), 'cooldown', 1, clientCooldown, '秒转换为毫秒', 100);
    } else deferredFields.push({ skillKey, field: 'cooldown_ms', status: '待核对', reason: '基础冷却缺失、为零或两来源无法逐级对齐；当前字段存在时不回退旧数组。', official: cooldown, client: clientCooldown ?? null });
    const cost = spell.cost;
    if (champ.partype !== '法力') deferredFields.push({ skillKey, field: 'mana_cost', status: '不适用', reason: `英雄资源为${champ.partype}，不建立法力消耗。` });
    else if (spell.resource !== '{{ cost }} {{ abilityresourcename }}') deferredFields.push({ skillKey, field: 'mana_cost', status: '待核对', reason: '资源文字不是明确的单次法力消耗，需另核对持续扣除/动态消耗。', resource: spell.resource });
    else if (Array.isArray(cost) && cost.length === count && cost.every(v => Number.isFinite(v) && (v > 0 || (v === 0 && reviewedMixedZeroCosts.has(skillKey)))) &&
      Array.isArray(clientMana) && clientMana.length >= count && cost.every((v, i) => Math.abs(v - clientMana[i]) < 0.00001)) {
      add('mana_cost', '基础法力消耗', cost, 'cost', 0, clientMana, '法力值；未接入实际扣除时点', 110);
    } else deferredFields.push({ skillKey, field: 'mana_cost', status: '待核对', reason: '法力缺失、零值未单独确证或两来源无法逐级对齐；不自动补零，不回退旧数组。', official: cost, client: clientMana ?? null });
    plan.push({ championId: id, skillKey, name: spell.name, maxLevel: count,
      status: '仅基础公共参数', parameters, proofs,
      sources: { official: hero.official, client: hero.client },
      scopeReview: scopeNotes[skillKey] ?? '本批保留直接战斗技能的基础字段；控制、伤害、被动、跨技能修正和完整过程另按英雄实录，不以本批计为完成。' });
  }
}
const result = { generatedAt: new Date().toISOString(), selectedHeroes: selected,
  excludedSkillFields: deferredFields, entries: plan,
  totals: { heroes: selected.length, slotsVisited: selected.length * 4,
    skillsWithParameters: plan.filter(x => x.parameters.length).length,
    parameters: plan.reduce((sum, x) => sum + x.parameters.length, 0) },
  runtimeValidation: '未执行' };
fs.writeFileSync(path.join(here, '公共参数候选.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result.totals));
