import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {plan,evidence} from './候选.mjs';
import './艾瑞莉娅组成.mjs';
import './菲奥娜组成.mjs';
import './卡蜜尔组成.mjs';
import './格温组成.mjs';

const here=new URL('.',import.meta.url);
if(existsSync(new URL('完整候选.json',here)))throw Error('候选已冻结；当前值另有等级曲线修正记录，禁止覆盖历史候选');
const keys=['irelia_p','irelia_q','irelia_w','irelia_e','irelia_r','fiora_p','fiora_q','fiora_w','fiora_e','fiora_r','camille_p','camille_q','camille_w','camille_e','camille_r','gwen_p','gwen_q','gwen_w','gwen_e','gwen_r'];
const stripServerFields=value=>Object.fromEntries(Object.entries(value).filter(([k])=>!['gameId','skillKey','createdAt','updatedAt'].includes(k)));
const sha256=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const expressionNodeTypes=new Set(['PARAMETER','ATTRIBUTE','OPERATION']);
function assertExpression(node,path){
  if(!node||typeof node!=='object'||!expressionNodeTypes.has(node.nodeType))throw Error('公式表达式含不支持节点 '+path+'；只允许PARAMETER/ATTRIBUTE/OPERATION');
  if(node.nodeType==='PARAMETER'&&!node.parameterKey)throw Error('公式表达式参数键缺失 '+path);
  if(node.nodeType==='ATTRIBUTE'&&(!node.attributeOwner||!node.attributeKey||!node.attributeValueKind))throw Error('公式表达式属性字段缺失 '+path);
  if(node.nodeType==='OPERATION'){
    if(!Array.isArray(node.operands)||node.operands.length!==2)throw Error('公式表达式运算元不是二元 '+path);
    node.operands.forEach((child,i)=>assertExpression(child,path+'.operands['+i+']'));
  }
}

const currentPath=new URL('./当前20技能组成核对.json',here);
const currentSnapshotPath=new URL('./写前现值.json',here);
let current={status:'unavailable',reason:'第十一批只读GET在生成前未取得成功响应；不把失败响应当作空组成。'};
try{
  const report=JSON.parse(await readFile(currentPath,'utf8'));
  const snapshot=JSON.parse(await readFile(currentSnapshotPath,'utf8'));
  if(report.summary?.errorCount===0&&report.summary?.skillCount===20&&snapshot.skills)current={...snapshot,success:true,status:'success',summary:report.summary,snapshotSha256:report.snapshotSha256};
}catch{}

const reuseReport={existingCompleteSkills:[],sameValueParameters:[],differentValueParameters:[],collidingComponents:[],currentRead:current.status??(current.success?'success':'unavailable')};
const completeReuseKeys=new Set();

// 当前GET成功时只复用同值公共参数；同键异值和已有组成只报告，避免在候选阶段覆盖现值。
if(current.success&&current.skills){
  for(const key of keys){
    const skill=plan.skills[key], before=current.skills[key];
    if(!skill||!before)continue;
    const params=before.components?.parameters?.items??[];
    skill.reusedParameters=skill.reusedParameters??[];
    skill.currentValueDifferences=[];
    for(const p of skill.write.parameters){
      const prev=params.find(v=>v.parameterKey===p.parameterKey);
      if(!prev)continue;
      const same=['valueType','valueMode','fixedValue','levelValues'].every(k=>isDeepStrictEqual(p[k],prev[k]));
      if(same){skill.reusedParameters.push(p.parameterKey);reuseReport.sameValueParameters.push({skillKey:key,parameterKey:p.parameterKey});}
      else{
        skill.currentValueDifferences.push({parameterKey:p.parameterKey,candidate:stripServerFields(p),current:stripServerFields(prev)});
        reuseReport.differentValueParameters.push({skillKey:key,parameterKey:p.parameterKey});
        skill.write.parameters=skill.write.parameters.filter(v=>v.parameterKey!==p.parameterKey);
      }
    }
    for(const [kind,items] of Object.entries(skill.write)){
      if(!Array.isArray(items))continue;
      const apiItems=before.components?.[kind]?.items??[];
      for(const item of items){
        const id=item.parameterKey??item.formulaKey??item.effectKey??item.processKey??item.stateKey??item.ruleKey;
        if(completeReuseKeys.has(key)||(kind==='parameters'&&skill.reusedParameters.includes(id)))continue;
        if(apiItems.some(v=>(v.parameterKey??v.formulaKey??v.effectKey??v.processKey??v.stateKey??v.ruleKey)===id))reuseReport.collidingComponents.push({skillKey:key,kind,id});
      }
    }
  }
}

const ordered={};
for(const key of keys){
  const skill=plan.skills[key];
  if(!skill)throw Error('候选缺技能 '+key);
  for(const f of skill.write.formulas??[])assertExpression(f.expression,skill.skillKey+'/'+f.formulaKey);
  skill.disposition=skill.disposition??{范围外:skill.excluded??[],来源待核:(skill.pending??[]).filter(v=>v.kind==='来源'),系统缺口:(skill.pending??[]).filter(v=>v.kind==='系统'),尚未接线:(skill.pending??[]).filter(v=>!['来源','系统'].includes(v.kind))};
  skill.status=skill.status??'确定参数与公式候选；未保存或未接线不表示完整机制';
  ordered[key]=skill;
}
plan.skills=ordered;
plan.meta.generatedAt=new Date().toISOString();
plan.meta.apiWrites=0;
plan.meta.currentCompositionRead={status:current.success?'success':'unavailable',path:'当前20技能组成核对.json',summary:current.summary??current.reason??'第十一批生成时未得到成功GET'};
plan.meta.reuseReport=reuseReport;
plan.meta.skillOrder=keys;

await writeFile(new URL('./完整候选.json',here),JSON.stringify(plan,null,2)+'\n');
await mkdir(new URL('../../../../../.agents/artifacts/hero11-20260909/',here),{recursive:true});
const artifact={generatedAt:plan.meta.generatedAt,apiWrites:0,skillCount:keys.length,currentCompositionRead:plan.meta.currentCompositionRead,reuseReport,planSha256:sha256(plan),skillSummary:Object.fromEntries(keys.map(key=>{const s=plan.skills[key];return [key,{parameters:s.write.parameters.length,formulas:s.write.formulas.length,effects:s.write.effects.length,processes:s.write.processes.length,internalStates:s.write.internalStates.length,triggerRules:s.write.triggerRules.length,pending:s.pending.length,excluded:s.excluded.length,reusedParameters:s.reusedParameters?.length??0}]}))};
await writeFile(new URL('../../../../../.agents/artifacts/hero11-20260909/候选生成摘要.json',here),JSON.stringify(artifact,null,2)+'\n');
console.log(JSON.stringify({success:true,skillCount:keys.length,apiWrites:0,currentRead:plan.meta.currentCompositionRead.status,reusedComplete:reuseReport.existingCompleteSkills.length,reusedParameters:reuseReport.sameValueParameters.length,differentParameters:reuseReport.differentValueParameters.length,collidingComponents:reuseReport.collidingComponents.length,planSha256:artifact.planSha256}));
