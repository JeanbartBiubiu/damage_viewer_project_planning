import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const current = JSON.parse(fs.readFileSync(path.join(here, '01-普通物理魔法真实伤害实际来源.json'), 'utf8'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const files = [
  '英雄/原始资料/en_US/champion/Annie.json', '英雄/原始资料/en_US/champion/Garen.json',
  '盖伦技能候选/README.md', '真实页面恢复-2026-09-24/符文生命门槛准备/08-伤害范围与乘区口径.md'
];
const evidence = files.map(file => ({ path: file, sha256: hash(fs.readFileSync(path.join(root, file))) }));
const rows = [
  ['annie_q', 'champion_annie', 'actual_hit', 'damage', 'spell_hit', 'magic', 'Annie', 0],
  ['garen_r', 'champion_garen', 'on_hit', 'damage', 'justice_damage', 'real', 'Garen', 3]
];
const reviews = rows.map(([skillKey, characterKey, ruleKey, actionKey, effectKey, damageTypeKey, officialName, slot]) => {
  const skill = current.values[`/skills/${skillKey}`];
  const relation = current.values[`/character-skill-relations?skillKey=${skillKey}`].items.find(x => x.characterKey === characterKey);
  assert.equal(relation.gameId, 'lol'); assert.equal(relation.skillKey, skillKey);
  assert.equal(skill.status, 'ENABLED'); assert.equal(relation.skillStatus, 'ENABLED');
  const rule = current.values[`/skills/${skillKey}/trigger-rules/${ruleKey}`];
  assert.equal(rule.eventSource.eventType, 'SKILL_HIT');
  const action = rule.actions.find(a => a.actionKey === actionKey);
  assert.equal(action.actionType, 'EXECUTE_EFFECT'); assert.equal(action.detail.effectKey, effectKey);
  const effect = current.values[`/skills/${skillKey}/effects/${effectKey}`];
  assert.equal(effect.results.length, 1); const result = effect.results[0];
  assert.equal(result.resultKey, 'damage'); assert.equal(result.resultType, 'DAMAGE');
  assert.equal(result.detail.damageTypeKey, damageTypeKey); assert.equal(result.detail.deliveryKind, 'SKILL');
  assert.equal(result.detail.originKind, 'DIRECT'); assert.equal(result.detail.critical.mode, 'DISALLOWED');
  const raw = JSON.parse(fs.readFileSync(path.join(root, `英雄/原始资料/en_US/champion/${officialName}.json`), 'utf8'));
  assert.equal(raw.version, '16.17.1');
  const spell = raw.data[officialName].spells[slot];
  assert(spell.tooltip.includes(damageTypeKey === 'magic' ? '<magicDamage>' : '<trueDamage>'));
  return {
    reviewKey: `${skillKey}_${effectKey}_damage`, gameId: 'lol', characterKey, skillKey,
    ruleKey, actionKey, effectKey, resultKey: 'damage', damageTypeKey, deliveryKind: 'SKILL', originKind: 'DIRECT',
    classification: 'ORDINARY_DIRECT',
    rationale: damageTypeKey === 'magic'
      ? '固定官方说明为英雄自身Q火球造成魔法伤害，实际直接技能结果与挂载一致；本条只批准命中伤害组成，不包含击杀退款或被动。'
      : '固定官方提示为基础值加目标已损失生命比例的真实伤害，实际结果为DAMAGE而非直接处决；按已采用的官方历史增幅规则纳入普通直接伤害，非惩戒或打野宠物。',
    evidenceRefs: [files[damageTypeKey === 'magic' ? 0 : 1], files[3], ...(damageTypeKey === 'real' ? [files[2]] : [])],
    reviewedResult: result
  };
});
const manifest = { catalogKey: 'ordinary_direct_20260924_annie_q_garen_r', gameId: 'lol',
  scope: 'ORDINARY_DIRECT_DAMAGE', reviews };
const json = JSON.stringify(manifest, null, 2) + '\n';
fs.writeFileSync(path.join(here, '02-已核定普通伤害来源目录.json'), json, { flag: 'wx' });
fs.writeFileSync(path.join(here, '03-来源核定依据.json'), JSON.stringify({ at: new Date().toISOString(),
  decision: '主负责人批准这两条已保存完整命中伤害效果作为普通直接伤害来源；不是整技能批准或正式符文扩大过滤批准',
  catalogSha256: hash(json), evidence,
  actualDataEvidence: '01-普通物理魔法真实伤害实际来源.json',
  modelAssumption: '沿已采用的2025官方历史通用规则模拟16.17普通真实伤害增幅；不是16.17逐项实测',
  excludedFromThisCatalog: ['共享普攻仍有暴击与并列命中关联适配缺口', '惩戒', '打野宠物', '未核定反射及其他来源'],
  trustBoundary: '目录是主负责人审核后的可信输入；宿主验证目录事实、当前完整作者数据和编译操作一致，不认证伪造的资料或API快照',
  businessWrites: 0, wholeSkillsComplete: false
}, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ reviews: reviews.length, catalogSha256: hash(json), businessWrites: 0 }));
