import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const path='C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz';
const raw=gunzipSync(await readFile(path)),json=JSON.parse(raw),entries=json.entries??json;
const evidence=JSON.parse(await readFile(new URL('./根绑定与数值证据.json',import.meta.url),'utf8'));
const skills={},chosen={};
for(const h of evidence.heroes)for(const s of h.spells){
 const keys=s.object.mSpell?.mClientData?.mTooltipData?.mLocKeys??{};
 skills[s.skillKey]={binding:s.binding,keys:{}};
 for(const [field,sourceKey]of Object.entries(keys)){
  const key=Object.keys(entries).find(k=>k.toLowerCase()===sourceKey.toLowerCase());
  skills[s.skillKey].keys[field]={sourceKey,key:key??null,text:key?entries[key]:null};
  if(key)chosen[key]=entries[key];
 }
}
await writeFile(new URL('./补充文本证据.json',import.meta.url),JSON.stringify({path,sha256:createHash('sha256').update(raw).digest('hex'),note:'仅保留当前角色根绑定主技能mLocKeys所引用文本，不按名称猜旧对象。',skills,entries:chosen},null,2)+'\n');
console.log(JSON.stringify({skills:Object.keys(skills).length,texts:Object.keys(chosen).length}));
