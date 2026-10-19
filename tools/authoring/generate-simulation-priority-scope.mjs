import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const slots = ['P', 'Q', 'W', 'E', 'R'];
const keyPattern = /^[a-z][a-z0-9_]{0,63}$/;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

/** 只复制原账本范围和明确排除依据，不推导完成状态。 */
export function buildPriorityScope(ledger) {
  requireValue(keyPattern.test(ledger.gameId ?? ''), '账本游戏标识不合法');
  const batches = ledger.heroes?.priorityScope?.batches;
  const inventory = ledger.inventoryConclusions;
  requireValue(Array.isArray(batches) && batches.length > 0, '缺少现行优先英雄批次');
  requireValue(Array.isArray(inventory?.skills) && Array.isArray(inventory?.equipment), '缺少逐项来源结论');
  const characters = [];
  const characterKeys = new Set();
  for (const batch of batches) {
    for (const hero of batch.heroes ?? []) {
      requireValue(keyPattern.test(hero.characterKey) && !characterKeys.has(hero.characterKey), '英雄标识缺失或重复');
      characterKeys.add(hero.characterKey);
      requireValue(Array.isArray(hero.skillKeys) && hero.skillKeys.length === slots.length, `${hero.characterKey}缺少完整五槽`);
      const expectedSkills = slots.map((slot, index) => {
        const key = hero.skillKeys[index];
        const matches = inventory.skills.filter(item => item.sourceChampionId === hero.sourceChampionId && item.slot === slot && item.skillKey === key);
        requireValue(keyPattern.test(key) && matches.length === 1, `${hero.characterKey}/${slot}没有唯一原始槽位结论`);
        const item = matches[0];
        const currentSkillKeys = item.splitAuthoring?.currentSkillKeys;
        if (currentSkillKeys !== undefined) {
          requireValue(Array.isArray(currentSkillKeys) && currentSkillKeys.length > 0
            && currentSkillKeys.every(currentKey => keyPattern.test(currentKey))
            && new Set(currentSkillKeys).size === currentSkillKeys.length, `${key}实际拆分技能标识缺失或重复`);
          requireValue(item.splitAuthoring.sourceArchiveSkillKey === key, `${key}拆分来源归档不一致`);
        }
        const excluded = item.conclusion === '明确排除';
        if (excluded) requireValue(typeof item.reason === 'string' && item.reason.trim() && item.evidenceRefs?.length, `${key}缺少明确排除依据`);
        return {
          slot, key, name: item.name, excluded,
          ...(currentSkillKeys === undefined ? {} : { currentSkillKeys: [...currentSkillKeys] }),
          exclusion: excluded ? { reason: item.reason, evidenceRefs: item.evidenceRefs, candidateSha256: item.candidateSha256 ?? null } : null,
        };
      });
      requireValue(new Set(expectedSkills.map(item => item.key)).size === slots.length, `${hero.characterKey}技能槽重复`);
      const actualSkillKeys = expectedSkills.flatMap(item => item.currentSkillKeys ?? [item.key]);
      requireValue(new Set(actualSkillKeys).size === actualSkillKeys.length, `${hero.characterKey}实际技能跨槽重复`);
      characters.push({ key: hero.characterKey, name: hero.name, batchOrder: batch.order, sourceChampionId: hero.sourceChampionId,
        scopeBoundary: hero.scopeBoundary ?? null, expectedSkills });
    }
  }
  const equipment = [];
  const equipmentKeys = new Set();
  for (const item of inventory.equipment) {
    if (item.currentEquipmentKey == null) continue;
    requireValue(keyPattern.test(item.currentEquipmentKey) && !equipmentKeys.has(item.currentEquipmentKey), '装备标识不合法或重复');
    equipmentKeys.add(item.currentEquipmentKey);
    // 原账本使用此明确结论确认纯属性装备；零绑定、名称或行数均不能替代来源依据。
    const attributesOnly = item.conclusion === '已录入' && item.reason?.startsWith('固定来源确认只有直接属性；') === true;
    equipment.push({ key: item.currentEquipmentKey, name: item.name, sourceItemId: item.sourceItemId,
      requiresSkillBindings: !attributesOnly,
      attributesOnlyEvidence: attributesOnly ? { reason: item.reason, evidenceRefs: item.evidenceRefs } : null,
    });
  }
  requireValue(characters.length > 0 && equipment.length === ledger.equipment.count, '原装备清单与当前范围数量不一致');
  return { schemaVersion: 'simulation-priority-scope-v1', gameId: ledger.gameId, profile: 'combat-analysis-v1',
    source: { ledger: '数据参考/全量录入-2026-09/阶段进度.json', characters: 'heroes.priorityScope.batches',
      conclusions: 'inventoryConclusions', equipment: 'inventoryConclusions.equipment.currentEquipmentKey' },
    characters, equipment };
}

function main() {
  const args = process.argv.slice(2);
  requireValue(args.length === 2 && args[0] === '--ledger' && path.isAbsolute(args[1]), '用法：node tools/authoring/generate-simulation-priority-scope.mjs --ledger <原阶段进度.json绝对路径>');
  const ledger = JSON.parse(fs.readFileSync(args[1], 'utf8'));
  const scope = buildPriorityScope(ledger);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const output = path.join(root, 'server/data_manage/src/main/resources/simulation-scope', scope.gameId, 'combat-analysis.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(scope, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: path.relative(root, output).replaceAll('\\', '/'), characters: scope.characters.length,
    slots: scope.characters.reduce((count, item) => count + item.expectedSkills.length, 0), equipment: scope.equipment.length,
    attributesOnly: scope.equipment.filter(item => !item.requiresSkillBindings).length }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
