import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const base='C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/技能公共参数实录';
const sourceIndex=JSON.parse(await readFile(path.join(base,'技能来源索引.json'),'utf8'));
async function get(route){const r=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{headers:{Authorization:'Bearer local-entry'},signal:AbortSignal.timeout(30000)});const data=await r.json();assert.equal(r.status,200,route);return {status:r.status,data};}
const listing=await get('/skills'),all=listing.data.items??listing.data;
const out={at:new Date().toISOString(),meaning:'只读核对已有根R且带Trait_Ultimate的明确终极技能集合；缺标记留待核，R后缀本身不作为语义证据。旧Ezreal依当前ez_r主体和角色ez挂载映射。',subjects:all.length,accepted:[],pending:[]};
for(const h of sourceIndex.heroes){
 const raw=gunzipSync(await readFile(path.join(base,h.client.path))),sha=createHash('sha256').update(raw).digest('hex');assert.equal(sha,h.client.sha256);
 const tree=JSON.parse(raw),r=h.skills.find(s=>s.slot==='R'),binding=tree[h.rootPath].spells[3];assert.equal(binding,r.clientPath);
 const tags=tree[binding].mSpell.mSpellTags??[],skillKey=h.championId==='Ezreal'?'ez_r':h.championId.toLowerCase()+'_r',subject=all.find(s=>s.skillKey===skillKey);
 const record={championId:h.championId,rootPath:h.rootPath,binding,client:h.client,officialR:r,skillKey,tags,subject};
 if(!tags.includes('Trait_Ultimate')){out.pending.push({...record,reason:'当前根R未标记Trait_Ultimate，单凭槽位不纳入本次明确集合'});continue;}
 assert.ok(subject,'现有技能不存在 '+skillKey);assert.equal(subject.maxLevel,r.officialMaxRank);assert.ok(subject.name.includes(r.name),'技能中文名不匹配 '+skillKey);
 out.accepted.push(record);
}
for(let i=0;i<out.accepted.length;i+=6)await Promise.all(out.accepted.slice(i,i+6).map(async row=>{const rel=await get('/character-skill-relations?skillKey='+row.skillKey);assert.equal(rel.data.items.length,1,'必须唯一角色挂载 '+row.skillKey);assert.equal(rel.data.items[0].skillKey,row.skillKey);row.relation=rel;row.detail=await get('/skills/'+row.skillKey);assert.equal(row.detail.data.maxLevel,row.officialR.officialMaxRank);}));
out.skillKeys=out.accepted.map(s=>s.skillKey).sort();assert.equal(new Set(out.skillKeys).size,out.skillKeys.length);
await writeFile(new URL('./终极技能范围证据.json',import.meta.url),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({accepted:out.accepted.length,pending:out.pending.map(p=>({championId:p.championId,skillKey:p.skillKey,tags:p.tags})),containsEz:out.skillKeys.includes('ez_r'),containsUdyr:out.skillKeys.includes('udyr_r')}));
