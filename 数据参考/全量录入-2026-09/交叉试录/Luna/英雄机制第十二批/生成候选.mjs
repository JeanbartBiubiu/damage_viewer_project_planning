import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {plan,evidence} from './候选.mjs';
import './英雄机制.mjs';




const here=new URL('.',import.meta.url);
const keys=['twitch_p','twitch_q','twitch_w','twitch_e','twitch_r','lucian_p','lucian_q','lucian_w','lucian_e','lucian_r','sivir_p','sivir_q','sivir_w','sivir_e','sivir_r','tristana_p','tristana_q','tristana_w','tristana_e','tristana_r'];
const stripServerFields=value=>Object.fromEntries(Object.entries(value).filter(([k])=>!['gameId','skillKey','createdAt','updatedAt'].includes(k)));
const stripPresentation=value=>Array.isArray(value)?value.map(stripPresentation):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([k])=>!['gameId','skillKey','createdAt','updatedAt','name','description','sortOrder'].includes(k)).map(([k,v])=>[k,stripPresentation(v)])):value;
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
const rawPlan=structuredClone(plan);
await writeFile(new URL('./候选原始.json',here),JSON.stringify(rawPlan,null,2)+'\n');
let current={status:'unavailable',reason:'第十二批只读GET在生成前未取得成功响应；不把失败响应当作空组成。'};
try{
  const report=JSON.parse(await readFile(currentPath,'utf8'));
  const snapshot=JSON.parse(await readFile(currentSnapshotPath,'utf8'));
  if(report.summary?.errorCount===0&&report.summary?.skillCount===20&&snapshot.skills)current={...snapshot,success:true,status:'success',summary:report.summary,snapshotSha256:report.snapshotSha256};
}catch{}

const componentId=(kind,item)=>item?.[{parameters:'parameterKey',formulas:'formulaKey',effects:'effectKey',processes:'processKey',internalStates:'stateKey',triggerRules:'ruleKey'}[kind]];
const reuseReport={existingCompleteHeroes:[],existingPartialHeroes:[],sameValueComponents:[],differentValueComponents:[],sameValueParameters:[],differentValueParameters:[],currentProtectedComponents:[],collidingComponents:[],currentRead:current.status??(current.success?'success':'unavailable')};

// 当前GET成功时按六类组成逐项保护：同值从待写候选移出，异值只留差异记录；两者都不覆盖现值。
if(current.success&&current.skills){
  const heroState=new Map();
  for(const key of keys){
    const skill=plan.skills[key], before=current.skills[key];
    if(!skill||!before)continue;
    const heroId=skill.source.hero;
    const state=heroState.get(heroId)??{skills:[],structural:true,semantic:true};
    const componentStatus=Object.values(before.components??{}).every(c=>Array.isArray(c.items)&&c.details.every(d=>d.detail?.status===200));
    state.structural=state.structural&&before.subject?.status===200&&componentStatus;
    state.semantic=state.semantic&&skill.pending.length===0&&skill.excluded.length===0;
    state.skills.push(key);
    heroState.set(heroId,state);
    skill.reusedParameters=skill.reusedParameters??[];
    skill.currentValueDifferences=[];
    for(const [kind,items] of Object.entries(skill.write)){
      if(!Array.isArray(items))continue;
      const component=before.components?.[kind]??{};
      const detailedItems=(component.details??[]).map(row=>row.detail?.data).filter(Boolean);
      const apiItems=detailedItems.length?detailedItems:(component.items??[]);
      const next=[];
      for(const item of items){
        const id=componentId(kind,item),prev=apiItems.find(v=>componentId(kind,v)===id);
        if(!prev){next.push(item);continue;}
        const candidate=stripServerFields(item),currentValue=stripServerFields(prev);
        const same=isDeepStrictEqual(stripPresentation(candidate),stripPresentation(currentValue));
        const row={skillKey:key,kind,id};
        reuseReport.collidingComponents.push(row);
        if(same){
          reuseReport.sameValueComponents.push(row);
          if(kind==='parameters')skill.reusedParameters.push(id);
          if(kind==='parameters')reuseReport.sameValueParameters.push(row);
        }else{
          reuseReport.differentValueComponents.push({...row,candidate,current:currentValue});
          if(kind==='parameters'){
            skill.currentValueDifferences.push({parameterKey:id,candidate,current:currentValue});
            reuseReport.differentValueParameters.push(row);
          }
        }
      }
      skill.write[kind]=next;
      const candidateIds=new Set(items.map(item=>componentId(kind,item)).filter(Boolean));
      for(const item of apiItems){const id=componentId(kind,item);if(id)reuseReport.currentProtectedComponents.push({skillKey:key,kind,id,represented:candidateIds.has(id)});}
    }
  }
  for(const [heroId,state] of heroState){
    const row={heroId,skillKeys:state.skills,structuralComplete:state.structural,semanticCandidateComplete:state.semantic};
    if(state.structural&&state.semantic)reuseReport.existingCompleteHeroes.push(row);
    else reuseReport.existingPartialHeroes.push(row);
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
reuseReport.currentProtectedComponents=Array.from(new Map(reuseReport.currentProtectedComponents.map(row=>[JSON.stringify(row),row])).values());
reuseReport.collidingComponents=Array.from(new Map(reuseReport.collidingComponents.map(row=>[JSON.stringify(row),row])).values());
reuseReport.sameValueComponents=Array.from(new Map(reuseReport.sameValueComponents.map(row=>[JSON.stringify(row),row])).values());
reuseReport.differentValueComponents=Array.from(new Map(reuseReport.differentValueComponents.map(row=>[JSON.stringify(row),row])).values());
plan.meta.generatedAt=new Date().toISOString();
plan.meta.apiWrites=0;
plan.meta.currentCompositionRead={status:current.success?'success':'unavailable',path:'当前20技能组成核对.json',summary:current.summary??current.reason??'第十二批生成时未得到成功GET'};
plan.meta.reuseReport=reuseReport;
plan.meta.skillOrder=keys;

await writeFile(new URL('./完整候选.json',here),JSON.stringify(plan,null,2)+'\n');
await mkdir(new URL('../../../../../.agents/artifacts/hero12-20260909/',here),{recursive:true});
 const skillSummary=source=>Object.fromEntries(keys.map(key=>{const s=source.skills[key];return [key,{parameters:s.write.parameters.length,formulas:s.write.formulas.length,effects:s.write.effects.length,processes:s.write.processes.length,internalStates:s.write.internalStates.length,triggerRules:s.write.triggerRules.length,pending:s.pending.length,excluded:s.excluded.length,reusedParameters:s.reusedParameters?.length??0}]}));
 const artifact={generatedAt:plan.meta.generatedAt,apiWrites:0,skillCount:keys.length,currentCompositionRead:plan.meta.currentCompositionRead,reuseReport,rawPlanSha256:sha256(rawPlan),planSha256:sha256(plan),rawSkillSummary:skillSummary(rawPlan),skillSummary:skillSummary(plan)};
await writeFile(new URL('../../../../../.agents/artifacts/hero12-20260909/候选生成摘要.json',here),JSON.stringify(artifact,null,2)+'\n');
console.log(JSON.stringify({success:true,skillCount:keys.length,apiWrites:0,currentRead:plan.meta.currentCompositionRead.status,existingCompleteHeroes:reuseReport.existingCompleteHeroes.length,existingPartialHeroes:reuseReport.existingPartialHeroes.length,reusedComponents:reuseReport.sameValueComponents.length,differentComponents:reuseReport.differentValueComponents.length,collidingComponents:reuseReport.collidingComponents.length,planSha256:artifact.planSha256}));

