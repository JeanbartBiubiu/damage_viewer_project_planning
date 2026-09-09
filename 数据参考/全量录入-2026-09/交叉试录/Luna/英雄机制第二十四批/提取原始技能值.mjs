import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '根绑定与数值证据.json');
const out = resolve(here, '来源冻结', '主技能原始展开.json');
const evidence = JSON.parse(await readFile(root, 'utf8'));

function pick(object, keys) {
  const result = {};
  for (const key of keys) if (Object.prototype.hasOwnProperty.call(object ?? {}, key)) result[key] = object[key];
  return result;
}

function extractSpell(spell) {
  const mSpell = spell.object?.mSpell ?? {};
  const values = Object.fromEntries((mSpell.DataValues ?? []).map((entry) => [entry.name, entry.values]));
  const calculations = mSpell.mSpellCalculations ?? {};
  const castFields = pick(mSpell, [
    'mClientData', 'mImgIconName', 'castRange', 'castTime', 'mClientData',
    'mSpellCalculations', 'mDataValues', 'mMaxAmmo', 'mAmmoNotAffectedByCDR',
    'mCantCancelWhileWindingUp', 'mUseAnimatorFramerate', 'mAnimationName',
    'mTargetingTypeData', 'mAffectsTypeFlags', 'mDataValues', 'mSpellCalculations',
  ]);
  return {
    slot: spell.slot,
    skillKey: spell.skillKey,
    binding: spell.binding,
    name: spell.name,
    maxrank: spell.maxrank,
    officialCooldown: spell.officialCooldown,
    officialCost: spell.officialCost,
    officialResource: spell.officialResource,
    officialDescription: spell.officialDescription,
    officialTooltip: spell.officialTooltip,
    rawDataValues: values,
    rawDataValueEntries: mSpell.DataValues ?? [],
    rawCalculations: calculations,
    rawSpellFields: castFields,
    rawObjectShaSource: spell.object,
  };
}

const output = {
  generatedAt: new Date().toISOString(),
  sourceEvidence: '根绑定与数值证据.json；完整客户端对象、官方16.17.1文本及原始计算树保留',
  heroes: evidence.heroes.map((hero) => ({
    id: hero.id,
    chineseName: hero.chineseName,
    rootPath: hero.rootPath,
    client: hero.client,
    official: hero.official,
    skills: hero.spells.map(extractSpell),
  })),
};
await writeFile(out, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out, heroes: output.heroes.length, skills: output.heroes.reduce((n, h) => n + h.skills.length, 0) }));
