import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPriorityScope } from './generate-simulation-priority-scope.mjs';

function fixture() {
  const keys = ['p', 'q', 'w', 'e', 'r'].map(slot => `hero_${slot}`);
  return { gameId: 'test', heroes: { priorityScope: { batches: [{ order: 1, heroes: [{ characterKey: 'hero', name: '英雄', sourceChampionId: 'Hero', skillKeys: keys }] }] } },
    equipment: { count: 2 }, inventoryConclusions: {
      skills: keys.map((skillKey, index) => ({ sourceChampionId: 'Hero', slot: ['P', 'Q', 'W', 'E', 'R'][index], skillKey,
        name: skillKey, conclusion: '资料待核', reason: '未准备', evidenceRefs: ['原资料'] })),
      equipment: [{ currentEquipmentKey: 'item_one', sourceItemId: '1', name: '装备1', conclusion: '已录入', reason: '固定来源确认只有直接属性；原结论', evidenceRefs: ['原资料'] },
        { currentEquipmentKey: 'item_two', sourceItemId: '2', name: '装备2', conclusion: '资料待核', reason: '没有绑定' }],
    } };
}

test('只机械复制当前批次，不根据旧完成数删除缺技能槽或放行无绑定装备', () => {
  const result = buildPriorityScope(fixture());
  assert.equal(result.characters[0].expectedSkills.length, 5);
  assert.ok(result.characters[0].expectedSkills.every(item => !item.excluded));
  assert.equal(result.equipment[0].requiresSkillBindings, false);
  assert.equal(result.equipment[1].requiresSkillBindings, true);
  assert.equal(JSON.stringify(result).includes('C:'), false);
});

test('只有原逐技能明确排除可以带完整依据生成排除项', () => {
  const ledger = fixture();
  ledger.inventoryConclusions.skills[0].conclusion = '明确排除';
  const expected = buildPriorityScope(ledger).characters[0].expectedSkills[0];
  assert.equal(expected.excluded, true);
  assert.equal(expected.exclusion.reason, '未准备');
  ledger.inventoryConclusions.skills[0].evidenceRefs = [];
  assert.throws(() => buildPriorityScope(ledger), /排除依据/);
});

test('遗漏、重复和错配来源不能静默缩小范围', () => {
  const ledger = fixture();
  ledger.inventoryConclusions.skills.pop();
  assert.throws(() => buildPriorityScope(ledger), /唯一原始槽位/);
  const duplicate = fixture();
  duplicate.inventoryConclusions.equipment.push(duplicate.inventoryConclusions.equipment[0]);
  assert.throws(() => buildPriorityScope(duplicate), /重复/);
});
