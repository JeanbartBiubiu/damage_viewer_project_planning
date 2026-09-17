import fs from 'node:fs';
import {createHash} from 'node:crypto';
const here=new URL('./',import.meta.url),read=n=>JSON.parse(fs.readFileSync(new URL(n,here))),sha=n=>createHash('sha256').update(fs.readFileSync(new URL(n,here))).digest('hex');
const plan=read('完整候选.json'),version=read('候选版本.json'),before=read('写前现值.json'),math=read('独立源值与算例.json'),relations=read('关联与图片保护快照.json');
if(sha('完整候选.json')!==version.fileSha256||math.candidateSha256!==version.fileSha256||math.failures.length||before.errors.length||relations.failures.length)throw Error('来源、独算或只读证据未完成');
const ids={parameters:'parameterKey',formulas:'formulaKey',effects:'effectKey'},requests=[],reuse=[];
for(const s of Object.values(plan.skills))for(const[kind,id]of Object.entries(ids))for(const body of s.write[kind]){
 const old=before.skills[s.skillKey].components[kind].details.find(v=>v.key===body[id]);
 if(old){reuse.push({skillKey:s.skillKey,kind,key:body[id],fullBefore:old.detail.data,body});continue;}
 requests.push({method:'POST',route:'/skills/'+s.skillKey+'/'+kind,skillKey:s.skillKey,kind,key:body[id],body});
}
if(requests.length!==189||reuse.length!==24)throw Error('计划计数错误');
const summary={parameters:130,formulas:34,effects:25,reusedParameters:24,totalNew:189,totalComposition:213};
fs.writeFileSync(new URL('写前计划.json',here),JSON.stringify({at:new Date().toISOString(),status:'仅准备，未获本批业务写入授权',candidateSha256:version.fileSha256,originalSnapshotSha256:sha('写前现值.json'),protectionSnapshotSha256:sha('关联与图片保护快照.json'),summary,policy:'仅待主负责人审查后另行授权；当前文件不是自动执行工具。同键异值不得覆盖；原24完整参数/20主体/4角色及关联/20代表图保护。未知输入不得默认0。',requests,reuse},null,2)+'\n');
const files=['完整候选.json','候选版本.json','写前现值.json','根绑定与数值证据.json','补充文本证据.json','阶段去重预检.json','关联与图片保护快照.json','独立源值与算例.json','写前计划.json'];
const manifest={at:new Date().toISOString(),status:'READY_FOR_PARENT_REVIEW',heroes:['Kennen','Velkoz','Ziggs','Xerath'],candidateSha256:version.fileSha256,planSha256:version.planSha256,summary,actualGETs:before.requests.length+relations.requests.length,allGETs200:before.requests.every(r=>r.status===200)&&relations.requests.every(r=>r.status===200),apiWrites:0,independent:{checks:math.checks,sourceCases:math.sourceCases.length,manualCases:math.manualCases.length,formulas:34,unknownLevelNodes:math.unknownCurves.length,failures:0},files:Object.fromEntries(files.map(n=>[n,sha(n)])),limits:['候选与请求准备，不代表已保存或完整战斗可运行。','关联保护快照在前一候选说明版本采集；本次仅将3个有证场景输入从来源待核改列未接线，20技能键及所有请求体未改变，保护原对象未改写。','凯南E暴击延长总时长公式含4秒延长上限，实际事件/剩余时长更新未接，不能在每次暴击重新应用完整总时长。','未知等级4项、未知9/2属性、未证充能索引和距离/减速算法均无默认。']};
fs.writeFileSync(new URL('最终交付清单.json',here),JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(new URL('冻结候选锁.json',here),JSON.stringify({at:new Date().toISOString(),fileSha256:version.fileSha256,planSha256:version.planSha256,scope:'本批只读候选已交独立主审；禁止直接重新生成覆盖。修改需保留历史并由主负责人协调。'},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({candidateSha256:version.fileSha256,deliverySha256:sha('最终交付清单.json'),summary,actualGETs:manifest.actualGETs,apiWrites:0}));
