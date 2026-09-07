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
const selected = ["Galio","Graves","Gwen","Illaoi","Janna","Jhin","Jinx","Kalista","Kayle","Khazix","KogMaw","MasterYi","Mordekaiser","Morgana","Nocturne","Olaf","Pantheon","Poppy","Quinn","Rakan","Rell","Samira","Sejuani","Senna"];
const skipped = {
  kalista_w:'本轮跳过：哨兵与誓约者协同支路不属于无队友的一对一计算。',
  kalista_r:'本轮跳过：依赖誓约者参与的投掷过程。',
  rakan_e:'本轮跳过：仅以友方英雄为目标的位移和护盾。',
  illaoi_e:'本轮跳过：独立可受击灵魂及伤害转移，沿用独立目标排除边界。',
  jhin_e:'本轮跳过：独立陷阱，沿用凯特琳W边界。',
  jinx_e:'本轮跳过：持续等待触碰的独立陷阱，沿用凯特琳W边界。',
  galio_r:'本轮跳过：依赖友方英雄为降落目标，无队友的一对一无法使用。',
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
    // 格温 Q 的“充能”是普攻积累剪切次数，不是弹药；两源普通冷却已核对。
    const reviewedOrdinaryCooldown = skillKey === 'gwen_q';
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
        description: `DDragon16.17.1 ${id}.spells[${slotIndex}].${pointer}，等级1起索引0；与冻结客户端根绑定字段索引${offset}起逐级一致。${unit}。仅基础参数，未计急速或其他技能修正；不表示过程与机制完成。${skillKey === 'kogmaw_r' && key === 'mana_cost' ? '此40法力仅为无额外层数的基础消耗，连续施放的8秒累加及400上限另行配置。' : ''}${skillKey === 'samira_r' && key === 'cooldown_ms' ? '冻结根明确mCooldownNotAffectedByCDR=true；该5000毫秒冷却不可按通用技能急速折算。' : ''}` });
      proofs.push({ parameterKey: key, officialPointer: `data.${id}.spells[${slotIndex}].${pointer}`,
        clientPointer: `${reference.clientPath}/mSpell/${key === 'cooldown_ms' ? 'cooldownTime' : 'mana'}`,
        officialValues: spell[pointer], clientRawValues: rawValues, clientOffset: offset, values, unit });
    };
    const cooldown = spell.cooldown;
    if (['quinn_w', 'jinx_q'].includes(skillKey)) deferredFields.push({skillKey, field:'cooldown_ms', status:skillKey === 'quinn_w' ? '范围外字段跳过' : '另按切换间隔配置', reason:skillKey === 'quinn_w' ? '主动仅侦查；被动攻速移速仍保留后续录入。' : '900毫秒为武器切换间隔，非受急速影响的普通冷却；武器切换和攻击效果另配。'});
    else if (complexCooldown) deferredFields.push({ skillKey, field: 'cooldown_ms', status: '待核对', reason: '含充能/再施放/开关；区分施放间隔、整体冷却与充能恢复后再采用。' });
    else if (Array.isArray(cooldown) && cooldown.length === count && cooldown.every(v => Number.isFinite(v) && v > 0) &&
      Array.isArray(raw.cooldownTime) && raw.cooldownTime.length >= count + 1 && cooldown.every((v, i) => Math.abs(v - raw.cooldownTime[i + 1]) < 0.00001)) {
      add('cooldown_ms', '基础冷却时间（毫秒）', cooldown.map(v => Math.round(v * 1000)), 'cooldown', 1, raw.cooldownTime, '秒转换为毫秒', 100);
    } else deferredFields.push({ skillKey, field: 'cooldown_ms', status: '待核对', reason: '基础冷却缺失、为零或两来源无法逐级对齐；不自动采用。', official: cooldown, client: raw.cooldownTime ?? null });
    const cost = spell.cost;
    if (champ.partype !== '法力') deferredFields.push({ skillKey, field: 'mana_cost', status: '不适用', reason: `英雄资源为${champ.partype}，不建立法力消耗。` });
    else if (spell.resource !== '{{ cost }} {{ abilityresourcename }}') deferredFields.push({ skillKey, field: 'mana_cost', status: '待核对', reason: '资源文字不是明确的单次法力消耗，需另核对持续扣除/动态消耗。', resource: spell.resource });
    else if (Array.isArray(cost) && cost.length === count && cost.every(v => Number.isFinite(v) && v > 0) &&
      Array.isArray(raw.mana) && raw.mana.length >= count && cost.every((v, i) => Math.abs(v - raw.mana[i]) < 0.00001)) {
      add('mana_cost', '基础法力消耗', cost, 'cost', 0, raw.mana, '法力值；未接入实际扣除时点', 110);
    } else deferredFields.push({ skillKey, field: 'mana_cost', status: '待核对', reason: '法力缺失、为零或两来源无法逐级对齐；不自动补零。', official: cost, client: raw.mana ?? null });
    plan.push({ championId: id, skillKey, name: spell.name, maxLevel: count,
      status: '仅基础公共参数', parameters, proofs,
      sources: { official: hero.official, client: hero.client },
      scopeReview: '本批保留直接战斗技能的基础字段；控制、伤害、被动、跨技能修正和完整过程另按英雄实录，不以本批计为完成。' });
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
