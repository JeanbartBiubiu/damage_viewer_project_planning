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
const selected = ["Briar","Elise","Gnar","Hwei","Jayce","Karma","Kayn","Kled","KSante","LeeSin","Locke","MonkeyKing","Neeko","Nidalee","Qiyana","RekSai","Rengar","Seraphine","Shaco","Shyvana","Taric","Yorick","Yunara","Yuumi","Zaahen","Zeri","Ziggs","Zilean","Zoe","Zyra","Ashe"];
const selectedSlots = {Ashe:["q"]};
let visitedSlots = 0;
const skipped = {
  nidalee_w: '独立陷阱，沿用已约定独立战斗对象边界。',
  nidalee_r: '本槽替换另一形态攻击和技能组，相关新增收益依赖后置豹形态。',
  shaco_w: '独立惊吓魔盒陷阱，沿用既定边界。',
  ziggs_e: '独立地雷阵触发，沿用陷阱边界。',
  zyra_w: '独立种子与植物生成支路后置。',
  yorick_w: '具有独立生命值的阻路墙，沿用独立对象与空间后置边界。',
  yorick_r: '独立室女和雾行者；其独立攻击标记是相关本体额伤前提，整支路后置。',
  yuumi_w: '仅依附另一友方英雄，本轮不配置纯队友入口。',
};
const reviewedOrdinaryCooldowns = new Set(['briar_w','kayn_r','kled_e','leesin_q','leesin_w','leesin_e','locke_w','neeko_w','shyvana_q','shyvana_w','yorick_q','zaahen_q','ziggs_w','zoe_q','ashe_q','yunara_q','shyvana_r']);
const reviewedMixedZeroCosts = new Set([]);
const reviewedZeroCooldowns = new Set(['ashe_q','yunara_q','shyvana_r']);
const reviewedManaResourceSkills = new Set(['locke_w','taric_q','yunara_q','yunara_w','yunara_e','zilean_w']);
const nonOrdinaryCooldowns = {
  gnar_w:'当前小型纳尔W是被动，7000毫秒不作为玩家主动技能冷却。',
  gnar_r:'90/60/30秒属于后置的巨型主动分支；保留小型R对W移速的依赖，不把这组时间写作小型普通冷却。',
  zoe_w:'250毫秒根对象属于被动/切换槽，真实碎片施放另有子技能；不能替代全部碎片或飞弹的冷却。',
  taric_q:'3000毫秒是施放间隔，另有15000毫秒层数恢复；本批用专门施放间隔参数保存。',
  zeri_q:'按攻击周期运行，根零值不能覆盖最小冷却0.5秒与攻速上限等依赖。',
};
const scopeNotes = {
  elise_r:'保留形态条件与被动自身治疗依赖；完整替换技能组和独立小蜘蛛后置。',
  reksai_w:'保留地下形态消耗怒气自疗的依赖，完整替换技能组后置。',
  elise_w:'爆炸蜘蛛的独立可受击对象属性尚不明确，机制范围局部待核；不凭召唤关键词排除已确证参数。',
  jayce_r:'保留下次攻击削减双抗等本体组成，完整形态组后置。',
  monkeyking_w:'保留本体隐身等收益，独立分身分支后置。',
  neeko_w:'保留本体隐身及其他自用收益，独立分身分支后置。',
  shaco_r:'保留本体短暂消失与弹道销毁依赖，独立分身及盒子后置。',
  zoe_r:'保留Q距离增伤及施放后强化攻击依赖，空间执行后置。',
  hwei_q:'根与QQ/QW/QE字段逐级一致，是组共享基础值；选组本身不消费冷却，实际选招起算和扣费另配。',
  hwei_w:'根与WQ/WW/WE字段逐级一致，是组共享基础值；实际选招起算和扣费另配。',
  hwei_e:'根与EQ/EW/EE字段逐级一致，是组共享基础值；实际选招起算和扣费另配。',
  kled_w:'这是被动触发后的基础冷却，无需玩家主动按W。',
  ashe_q:'基础冷却零为两来源确值，仍受4层攻击门控；不能据此创建无条件施放。',
  yunara_q:'基础冷却零为确值，仍有8灵蕴及形态门控；30法力不代替门控。',
  shyvana_r:'基础冷却零且当前根不消费冷却；仍要求100龙怒，初始伤害及自身生命收益保留。',
  locke_w:'明确单次法力费用另有持续扣当前生命2%的组成，不混成同一资源。',
  taric_q:'每次施放60法力并消耗全部层数，3秒施放间隔与15秒层数恢复分别记录。',
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
    if (selectedSlots[id] && !selectedSlots[id].includes(slot)) continue;
    visitedSlots++;
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
        clientPointer: `${reference.clientPath}/mSpell/${pointer === 'cooldown' ? (Object.hasOwn(raw, 'Cooldown') ? 'Cooldown/values' : 'cooldownTime') : (Object.hasOwn(raw, 'manaValues') ? 'manaValues/values' : 'mana')}`,
        officialValues: spell[pointer], clientRawValues: rawValues,
        legacyClientRawValues: pointer === 'cooldown' ? raw.cooldownTime ?? null : raw.mana ?? null,
        clientOffset: offset, values, unit });
    };
    const cooldown = spell.cooldown;
    if (nonOrdinaryCooldowns[skillKey]) deferredFields.push({skillKey, field:'cooldown_ms', status:skillKey==='taric_q'?'改用施放间隔参数':'当前槽位不采用普通冷却', reason:nonOrdinaryCooldowns[skillKey]});
    else if (complexCooldown) deferredFields.push({ skillKey, field: 'cooldown_ms', status: '待核对', reason: '含充能/再施放/开关；区分施放间隔、整体冷却与充能恢复后再采用。' });
    else if (Array.isArray(cooldown) && cooldown.length === count && cooldown.every(v => Number.isFinite(v) && (v > 0 || (v === 0 && reviewedZeroCooldowns.has(skillKey)))) &&
      Array.isArray(clientCooldown) && clientCooldown.length >= count + 1 && cooldown.every((v, i) => Math.abs(v - clientCooldown[i + 1]) < 0.00001)) {
      add('cooldown_ms', '基础冷却时间（毫秒）', cooldown.map(v => Math.round(v * 1000)), 'cooldown', 1, clientCooldown, '秒转换为毫秒', 100);
    } else deferredFields.push({ skillKey, field: 'cooldown_ms', status: '待核对', reason: '基础冷却缺失、为零或两来源无法逐级对齐；当前字段存在时不回退旧数组。', official: cooldown, client: clientCooldown ?? null });
    if (skillKey === 'taric_q') {
      assert.ok(cooldown.length === count && cooldown.every(v=>v===3));
      assert.ok(Array.isArray(clientCooldown) && cooldown.every((v,i)=>Math.abs(v-clientCooldown[i+1])<0.00001));
      add('cast_interval_ms','施放间隔（毫秒）',cooldown.map(v=>v*1000),'cooldown',1,clientCooldown,'秒转换为毫秒；仅施放间隔，不是层数恢复',100);
    }
    const cost = spell.cost;
    if (champ.partype !== '法力') deferredFields.push({ skillKey, field: 'mana_cost', status: '不适用', reason: `英雄资源为${champ.partype}，不建立法力消耗。` });
    else if (spell.resource !== '{{ cost }} {{ abilityresourcename }}' && !reviewedManaResourceSkills.has(skillKey)) deferredFields.push({ skillKey, field: 'mana_cost', status: '待核对', reason: '资源文字不是明确的单次法力消耗，需另核对持续扣除/动态消耗。', resource: spell.resource });
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
const result = { generatedAt: new Date().toISOString(), selectedHeroes: selected, selectedSlots,
  excludedSkillFields: deferredFields, entries: plan,
  totals: { heroes: selected.length, slotsVisited: visitedSlots,
    skillsWithParameters: plan.filter(x => x.parameters.length).length,
    parameters: plan.reduce((sum, x) => sum + x.parameters.length, 0) },
  runtimeValidation: '未执行' };
fs.writeFileSync(path.join(here, '公共参数候选.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result.totals));
