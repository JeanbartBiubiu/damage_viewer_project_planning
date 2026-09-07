import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const base='C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/技能公共参数实录';
const idx=JSON.parse(await readFile(path.join(base,'技能来源索引.json'),'utf8'));
const ids=['Malphite','MissFortune','Annie','Brand'];
const out={generatedAt:new Date().toISOString(),note:'接手后独立沿角色根绑定核对，不以名称相似评分选对象。完整原文及SHA位于规划树公共来源。',heroes:[]};
for(const id of ids){
 const h=idx.heroes.find(x=>x.championId===id);
 const raw=gunzipSync(await readFile(path.join(base,h.client.path)));
 const offRaw=await readFile(path.resolve(base,h.official.path));
 if(createHash('sha256').update(raw).digest('hex')!==h.client.sha256||createHash('sha256').update(offRaw).digest('hex')!==h.official.sha256) throw Error('来源摘要不符 '+id);
 const c=JSON.parse(raw), d=JSON.parse(offRaw).data[id], root=c[h.rootPath];
 const spells=h.skills.map((s,i)=>{
  const expected=i===0?root.mCharacterPassiveSpell:root.spells[i-1];
  if(expected!==s.clientPath) throw Error('根绑定不符 '+id+'/'+s.slot);
  const obj=c[expected],sp=obj.mSpell;
  return {slot:s.slot,skillKey:id.toLowerCase()+'_'+s.slot.toLowerCase(),binding:expected,official:i===0?d.passive:d.spells[i-1],object:obj};
 });
 out.heroes.push({id,client:h.client,official:h.official,rootPath:h.rootPath,spells});
}
await writeFile(path.join(here,'根绑定与数值证据.json'),JSON.stringify(out,null,2)+'\n');
for(const h of out.heroes){for(const s of h.spells){const p=s.object.mSpell??{};console.log(JSON.stringify({id:h.id,slot:s.slot,data:(p.DataValues??p.mDataValues)?.map(x=>({name:x.mName??x.name,values:x.mValues??x.values}))}));}}
