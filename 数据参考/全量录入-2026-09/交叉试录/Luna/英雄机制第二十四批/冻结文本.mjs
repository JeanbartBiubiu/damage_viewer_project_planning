// 保存当前根技能绑定引用到的中文正文；动态键缺失保留缺失事实，不借同名旧技能文案。
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const textPath = 'C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz';
const raw = gunzipSync(await readFile(textPath));
const table = JSON.parse(raw);
const entries = table.entries ?? table;
const evidence = JSON.parse(await readFile(new URL('./根绑定与数值证据.json', import.meta.url), 'utf8'));
const skills = {};
const chosen = {};
for (const hero of evidence.heroes) {
  for (const spell of hero.spells) {
    const locKeys = spell.object?.mSpell?.mClientData?.mTooltipData?.mLocKeys ?? {};
    skills[spell.skillKey] = { binding: spell.binding, keys: {} };
    for (const [field, sourceKey] of Object.entries(locKeys)) {
      const key = Object.keys(entries).find(candidate => candidate.toLowerCase() === String(sourceKey).toLowerCase());
      skills[spell.skillKey].keys[field] = { sourceKey, key: key ?? null, text: key ? entries[key] : null };
      if (key) chosen[key] = entries[key];
    }
  }
}
const out = {
  path: textPath,
  sha256: createHash('sha256').update(raw).digest('hex'),
  note: '仅保存当前四名英雄根绑定主技能的本地化键和中文正文；动态键缺失时保留缺失事实。',
  skills,
  entries: chosen
};
await writeFile(new URL('./补充文本证据.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ skills: Object.keys(skills).length, texts: Object.keys(chosen).length, sha256: out.sha256 }));
