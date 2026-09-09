// 只保留四名英雄当前根技能绑定的本地化键；不按同名旧对象猜正文。
import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';

const textPath='C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz';
const raw=gunzipSync(await readFile(textPath));
const table=JSON.parse(raw),entries=table.entries??table;
const evidence=JSON.parse(await readFile(new URL('./根绑定与数值证据.json',import.meta.url),'utf8'));
const skills={},chosen={};
for(const hero of evidence.heroes)for(const spell of hero.spells){
  const locKeys=spell.object?.mSpell?.mClientData?.mTooltipData?.mLocKeys??{};
  skills[spell.skillKey]={binding:spell.binding,keys:{}};
  for(const [field,sourceKey] of Object.entries(locKeys)){
    const key=Object.keys(entries).find(candidate=>candidate.toLowerCase()===String(sourceKey).toLowerCase());
    skills[spell.skillKey].keys[field]={sourceKey,key:key??null,text:key?entries[key]:null};
    if(key)chosen[key]=entries[key];
  }
}
const out={path:textPath,sha256:createHash('sha256').update(raw).digest('hex'),note:'仅保留当前角色根绑定主技能mLocKeys引用文本；动态键缺失时保留缺失事实，不借旧技能或其他英雄文案。',skills,entries:chosen};
await writeFile(new URL('./补充文本证据.json',import.meta.url),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({skills:Object.keys(skills).length,texts:Object.keys(chosen).length,sha256:out.sha256}));

