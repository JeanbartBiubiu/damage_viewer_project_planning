// 仅生成本地候选与核算；没有业务接口写入能力。
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {plan,finalize} from './英雄工具.mjs';
import './瑟提组成.mjs';
import './特朗德尔组成.mjs';
const full=process.argv.includes('--full');
if(full){await import('./沃里克组成.mjs');await import('./赵信组成.mjs');}
await finalize();
const evidence=JSON.parse(await readFile(new URL('./根绑定与数值证据.json',import.meta.url),'utf8'));
const text=JSON.parse(await readFile(new URL('./补充文本证据.json',import.meta.url),'utf8'));
const sourceChecks=[];
const base='C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/技能公共参数实录';
for(const h of evidence.heroes.filter(h=>full||['Sett','Trundle'].includes(h.id))){
 for(const [kind,bytes,expected] of [['client',gunzipSync(await readFile(path.join(base,h.client.path))),h.client.sha256],['official',await readFile(path.resolve(base,h.official.path)),h.official.sha256]]){
  const actual=createHash('sha256').update(bytes).digest('hex');if(actual!==expected)throw Error('来源摘要变化 '+h.id+'/'+kind);sourceChecks.push({hero:h.id,kind,expected,actual,match:true});
 }
}
const locHash=createHash('sha256').update(gunzipSync(await readFile(text.path))).digest('hex');if(locHash!==text.sha256)throw Error('当前说明摘要变化');sourceChecks.push({kind:'当前绑定中文说明',expected:text.sha256,actual:locHash,match:true});
// 未确证原值仍完整保留在冻结证据，不进入业务候选。
for(const s of Object.values(plan.skills)){
 s.write.parameters=s.write.parameters.filter(p=>!p.parameterKey.startsWith('raw_'));
 s.proofs=s.proofs.filter(p=>!p.parameterKey?.startsWith('raw_'));
 s.source.currentBoundText=text.skills[s.skillKey];
 s.disposition={范围外:s.excluded,来源待核:s.pending.filter(p=>p.kind==='来源'),系统缺口:s.pending.filter(p=>p.kind==='系统'),尚未接线:s.pending.filter(p=>!['来源','系统'].includes(p.kind))};
}
for(const key of ['sett_e','sett_r','trundle_q','trundle_e',...(full?['warwick_e','warwick_r','xinzhao_q','xinzhao_w','xinzhao_e','xinzhao_r']:[])]){
 plan.skills[key].disposition.系统缺口.push({component:'需要按本次期限结束且可被法术护盾阻挡的目标控制状态',reason:'现PERSISTENT+TARGET状态结果不能配置非空spellShieldBlockScope；不以null绕过阻挡，也不改APPLICATION改变期限。应先明确该控制参与阻挡的规则，再在系统修正后补。普通持续属性变化不受此状态组合结论限制。'});
}
plan.meta={...plan.meta,stage:'仅候选；等待独立审查',scope:full?'四英雄20技能':'瑟提与特朗德尔10技能；另10技能继续整理',sourceChecks,generatedAt:new Date().toISOString(),apiWrites:0};
const prefix=full?'完整':'前十技能';
await writeFile(new URL('./'+prefix+'候选.json',import.meta.url),JSON.stringify(plan,null,2)+'\n');
const {arithmetic,invariants}=await import('./候选独立核算.mjs').then(m=>m.verify(plan));
const report={generatedAt:new Date().toISOString(),boundary:'仅冻结来源摘要、候选结构与独立算术；没有业务保存、数据库回读、浏览器或战斗运行证据。',sourceChecks,arithmetic,invariants,failures:[...arithmetic,...invariants].filter(x=>!x.match)};
await writeFile(new URL('./'+prefix+'独立核算.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
const totals=Object.fromEntries(Object.keys(Object.values(plan.skills)[0].write).map(k=>[k,Object.values(plan.skills).reduce((n,s)=>n+s.write[k].length,0)]));
const lines=['# 第五批'+(full?'四英雄':'前两英雄')+'候选审查','',`当前是${Object.keys(plan.skills).length}个技能的确定组成候选，未写业务接口。旧Cursor路线中断后由Codex执行代理接手。`, '',`组成计数：${JSON.stringify(totals)}；公共同值参数精确保留${Object.values(plan.skills).reduce((n,s)=>n+s.reusedParameters.length,0)}项。独立算例${arithmetic.length}项、结构约束${invariants.length}项，失败${report.failures.length}项。`, '', '版本保持客户端16.17与官方16.17.1；生成时验证原始来源摘要。当前根绑定文本已随每技能候选保留。旧字段冲突、未接线和系统缺口分别列出。', '', '| 技能 | 参数 | 公式 | 效果 | 过程 | 状态 | 规则 |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: |'];
for(const s of Object.values(plan.skills))lines.push(`| ${s.skillKey} ${s.name} | ${Object.values(s.write).map(v=>v.length).join(' | ')} |`);
for(const s of Object.values(plan.skills)){
 lines.push('',`## ${s.name} ${s.skillKey}`,'');
 for(const [kind,items] of Object.entries(s.disposition)){lines.push(`**${kind}**：${items.length?items.map(i=>`${i.component}：${i.reason}`).join('；'):'无新增记录。'}`,'');}
}
await writeFile(new URL('./'+prefix+'审查说明.md',import.meta.url),lines.join('\n')+'\n');
console.log(JSON.stringify({skills:Object.keys(plan.skills).length,totals,reused:Object.values(plan.skills).reduce((n,s)=>n+s.reusedParameters.length,0),arithmetic:arithmetic.length,invariants:invariants.length,failures:report.failures}));
if(report.failures.length)process.exitCode=1;
