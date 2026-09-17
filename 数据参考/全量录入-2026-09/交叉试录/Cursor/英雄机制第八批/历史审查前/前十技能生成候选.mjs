// 仅本地候选生成，不调用业务接口。
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {plan,finalize} from './英雄工具.mjs';
import './凯特琳组成.mjs';
import './烬组成.mjs';

if(process.argv.length>2)throw Error('前十生成器不接受写入或其他参数');
await finalize();
const keys=['caitlyn','jhin'].flatMap(h=>['p','q','w','e','r'].map(s=>h+'_'+s));
plan.skills=Object.fromEntries(keys.map(k=>[k,plan.skills[k]]));
plan.meta={...plan.meta,stage:'前十技能候选；未写业务API',executor:'原Cursor运行未完成；Codex接手生成凯特琳与烬候选。',generatedAt:new Date().toISOString(),apiWrites:0};
const bytes=JSON.stringify(plan,null,2)+'\n';
const sha256=createHash('sha256').update(bytes).digest('hex');
const totals=Object.fromEntries(Object.keys(Object.values(plan.skills)[0].write).map(k=>[k,Object.values(plan.skills).reduce((n,s)=>n+s.write[k].length,0)]));
const reused=Object.values(plan.skills).reduce((n,s)=>n+s.reusedParameters.length,0);
await writeFile(new URL('./前十技能候选.json',import.meta.url),bytes);
const lines=['# 凯特琳与烬前十技能候选','',`本批前十技能只生成候选；数量${JSON.stringify(totals)}，精确保留${reused}项既有公共参数。未写业务接口，未运行战斗。`,'',`SHA256：${sha256}`,''];
for(const s of Object.values(plan.skills)){lines.push('## '+s.name+' '+s.skillKey,'');for(const[k,v]of Object.entries(s.disposition))lines.push('**'+k+'**：'+(v.length?v.map(x=>x.component+'：'+x.reason).join('；'):'无新增记录。'),'');}
await writeFile(new URL('./前十技能审查说明.md',import.meta.url),lines.join('\n')+'\n');
console.log(JSON.stringify({skills:Object.keys(plan.skills).length,sha256,totals,reused}));
