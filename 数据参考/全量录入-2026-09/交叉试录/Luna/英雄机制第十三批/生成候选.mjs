import fs from 'node:fs';
if(fs.existsSync(new URL('冻结候选锁.json',import.meta.url)))throw Error('本批已冻结并授权实际补录，禁止重新生成覆盖候选；不得绕过冻结锁。');
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as eq} from 'node:util';
import {plan} from './候选.mjs';
import './英雄组成.mjs';
const here=new URL('./',import.meta.url),snapshot=JSON.parse(fs.readFileSync(new URL('写前现值.json',here))),order=['akali','kassadin','ryze','cassiopeia'].flatMap(h=>['p','q','w','e','r'].map(k=>h+'_'+k));
if(!eq(Object.keys(plan.skills),order))throw Error('必须精确覆盖20槽');
const protectedFields=['gameId','skillKey','createdAt','updatedAt'],reuse=[],changes=[],coverage=[];
for(const key of order){const s=plan.skills[key],old=snapshot.skills[key];if(!old||old.subject.status!==200)throw Error('缺写前主体 '+key);
 if(Object.entries(old.components).some(([k,v])=>k!=='parameters'&&v.items.length))throw Error('已有非参数组成，须独立核对不能推空 '+key);
 for(const p of old.components.parameters.items){const body=Object.fromEntries(Object.entries(p).filter(([k])=>!protectedFields.includes(k))),i=s.write.parameters.findIndex(x=>x.parameterKey===p.parameterKey);if(i>=0){if(!['valueType','valueMode','fixedValue','levelValues'].every(k=>eq(s.write.parameters[i][k],p[k])))throw Error('已有参数数值不同 '+key+'/'+p.parameterKey);const fields=Object.keys(body).filter(k=>!eq(body[k],s.write.parameters[i][k]));if(fields.length)changes.push({skillKey:key,parameterKey:p.parameterKey,policy:'原对象完整复用，不发更新请求',fields});s.write.parameters[i]=body;}else s.write.parameters.unshift(body);reuse.push({skillKey:key,parameterKey:p.parameterKey});}
 s.reusedParameters=reuse.filter(x=>x.skillKey===key).map(x=>x.parameterKey);s.disposition={范围外:s.excluded,来源待核:s.pending.filter(v=>v.kind==='来源'),系统缺口:s.pending.filter(v=>v.kind==='系统'),尚未接线:s.pending.filter(v=>!['来源','系统'].includes(v.kind))};s.status='确定组成候选；未保存/未接线不表示完整战斗机制';
 const rawData=snapshot;for(const[kind,items]of Object.entries(s.write)){const ids=items.map(v=>v.parameterKey??v.formulaKey??v.effectKey??v.processKey??v.stateKey??v.ruleKey);if(new Set(ids).size!==ids.length)throw Error('重复键 '+key+'/'+kind);}
 coverage.push({skillKey:key,parameters:s.write.parameters.length,formulas:s.write.formulas.length,effects:s.write.effects.length,pending:s.pending.length,excluded:s.excluded.length});
}
plan.meta.generatedAt=new Date().toISOString();plan.meta.apiWrites=0;plan.meta.executor='第十三批由Codex执行代理准备；仅来源与当前GET候选，未业务写入';plan.meta.reuseReport={publicParameters:reuse,preservedMetadataDifferences:changes,originalSnapshotSha256:createHash('sha256').update(fs.readFileSync(new URL('写前现值.json',here))).digest('hex')};
const bytes=JSON.stringify(plan,null,2)+'\n';fs.writeFileSync(new URL('完整候选.json',here),bytes);const sha=createHash('sha256').update(bytes).digest('hex'),objectSha=createHash('sha256').update(JSON.stringify(plan)).digest('hex');
const report={at:plan.meta.generatedAt,fileSha256:sha,planSha256:objectSha,skillCount:order.length,apiWrites:0,reusedParameters:reuse.length,preservedMetadataDifferences:changes,coverage,counts:Object.fromEntries(Object.keys(plan.skills.akali_p.write).map(k=>[k,order.reduce((n,s)=>n+plan.skills[s].write[k].length,0)]))};fs.writeFileSync(new URL('候选版本.json',here),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({fileSha256:sha,planSha256:objectSha,skills:order.length,reused:reuse.length,counts:report.counts,apiWrites:0}));
