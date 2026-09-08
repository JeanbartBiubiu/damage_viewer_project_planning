import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {plan,finalize} from './英雄工具.mjs';
import './蔚组成.mjs';
import './奥拉夫组成.mjs';
await finalize();
const allowed=new Set(['vi_p','vi_q','vi_w','vi_e','vi_r','olaf_p','olaf_q','olaf_w','olaf_e','olaf_r']);
const extra=Object.keys(plan.skills).filter(k=>!allowed.has(k));
if(extra.length)throw Error('生成器夹入了非前十技能 '+extra.join(','));
if([...allowed].some(k=>!plan.skills[k]))throw Error('前十技能缺槽');
const evidence=JSON.parse(await readFile(new URL('./根绑定与数值证据.json',import.meta.url),'utf8'));
const text=JSON.parse(await readFile(new URL('./补充文本证据.json',import.meta.url),'utf8'));
const sourceChecks=[];
const base='C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/技能公共参数实录';
for(const h of evidence.heroes.filter(h=>['Vi','Olaf'].includes(h.id))){
 for(const [kind,bytes,expected] of [['client',gunzipSync(await readFile(path.join(base,h.client.path))),h.client.sha256],['official',await readFile(path.resolve(base,h.official.path)),h.official.sha256]]){
  const actual=createHash('sha256').update(bytes).digest('hex');if(actual!==expected)throw Error('来源摘要变化 '+h.id+'/'+kind);sourceChecks.push({hero:h.id,kind,expected,actual,match:true});
 }
}
const locHash=createHash('sha256').update(gunzipSync(await readFile(text.path))).digest('hex');if(locHash!==text.sha256)throw Error('当前说明摘要变化');sourceChecks.push({kind:'当前绑定中文说明',expected:text.sha256,actual:locHash,match:true});
plan.meta={...plan.meta,stage:'仅候选与既有组成只读复核；等待独立审查',scope:'蔚与奥拉夫10技能；魔腾与薇恩不在本生成器',executor:'Cursor SDK隔离副本本地候选',sources:evidence.heroes.filter(h=>['Vi','Olaf'].includes(h.id)).map(h=>({id:h.id,client:h.client,official:h.official})),sourceChecks,generatedAt:new Date().toISOString(),apiWrites:0};
await writeFile(new URL('./前十技能候选.json',import.meta.url),JSON.stringify(plan,null,2)+'\n');
const totals=Object.fromEntries(Object.keys(Object.values(plan.skills)[0].write).map(k=>[k,Object.values(plan.skills).reduce((n,s)=>n+s.write[k].length,0)]));
const reused=Object.values(plan.skills).reduce((n,s)=>n+s.reusedParameters.length,0);
const lines=['# 第七批前十技能候选审查','',`当前是蔚与奥拉夫10个技能的确定组成候选，本轮未写业务接口，也没有夹入魔腾或薇恩。公共参数按写前GET精确保留，不改说明与排序。`,'',`组成计数：${JSON.stringify(totals)}；同值参数精确保留${reused}项。独立算术与结构约束由前十技能独立核算.mjs读取本JSON后另行记账。`,'','版本保持客户端16.17与官方16.17.1；生成时验证原始来源摘要。当前根绑定文本已随每技能候选保留。范围外、来源待核、系统缺口和尚未接线分别列出。','','| 技能 | 参数 | 公式 | 效果 | 过程 | 状态 | 规则 |','| --- | ---: | ---: | ---: | ---: | ---: | ---: |'];
for(const s of Object.values(plan.skills))lines.push(`| ${s.skillKey} ${s.name} | ${Object.values(s.write).map(v=>v.length).join(' | ')} |`);
for(const s of Object.values(plan.skills)){
 lines.push('',`## ${s.name} ${s.skillKey}`,'');
 for(const [kind,items] of Object.entries(s.disposition)){lines.push(`**${kind}**：${items.length?items.map(i=>`${i.component}：${i.reason}`).join('；'):'无新增记录。'}`,'');}
}
await writeFile(new URL('./前十技能审查说明.md',import.meta.url),lines.join('\n')+'\n');
console.log(JSON.stringify({skills:Object.keys(plan.skills),totals,reused,sourceChecks:sourceChecks.length}));
