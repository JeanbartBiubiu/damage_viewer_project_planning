// 默认前两件成熟组成；--full 生成六装备七技能。仅本地文件，无业务写入。
import {firstTwo} from './前两件组成.mjs';
import {output} from './候选工具.mjs';
if(process.argv.slice(2).some(a=>a!=='--full'))throw Error('只允许无参数或 --full');
const full=process.argv.includes('--full'),objects=firstTwo();
if(full){const {remaining}=await import('./其余四件组成.mjs');objects.push(...remaining());const rank=new Map([3145,3146,4629,3082,3110,3143].map((n,i)=>['item_'+n,i]));objects.sort((a,b)=>rank.get(a.equipmentKey)-rank.get(b.equipmentKey)||a.apiPayload.relation.sortOrder-b.apiPayload.relation.sortOrder);}
await output(objects,full);
