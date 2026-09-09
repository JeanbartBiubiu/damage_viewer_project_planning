import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as eq} from 'node:util';
import {plan} from './候选.mjs';
import './英雄组成.mjs';

if(fs.existsSync(new URL('冻结候选锁.json',import.meta.url)))throw Error('本批已有冻结锁，禁止重新生成覆盖候选。');
const here=new URL('./',import.meta.url);
const snapshot=JSON.parse(fs.readFileSync(new URL('写前现值.json',here),'utf8'));
const order=['viktor','orianna','syndra','taliyah'].flatMap(h=>['p','q','w','e','r'].map(k=>h+'_'+k));
if(!eq(Object.keys(plan.skills),order))throw Error('必须精确覆盖20槽');
const protectedFields=['gameId','skillKey','createdAt','updatedAt'];
const reuse=[];
const changes=[];
const coverage=[];

function checkFormulaNode(node,path){
  if(!node||typeof node!=='object')throw Error('缺公式节点 '+path);
  if(node.nodeType==='PARAMETER'){
    if(!node.parameterKey)throw Error('公式参数键缺失 '+path);
    return;
  }
  if(node.nodeType==='ATTRIBUTE'){
    if(!node.attributeOwner||!node.attributeKey||!node.attributeValueKind)throw Error('公式属性字段缺失 '+path);
    return;
  }
  if(node.nodeType!=='OPERATION')throw Error('出现后端不支持公式节点 '+path+'/'+String(node.nodeType));
  if(!Array.isArray(node.operands)||node.operands.length!==2)throw Error('公式不是二元运算 '+path);
  node.operands.forEach((child,i)=>checkFormulaNode(child,path+'.operands['+i+']'));
}
function validateReferences(skill){
  const params=new Set(skill.write.parameters.map(x=>x.parameterKey));
  const formulas=new Set(skill.write.formulas.map(x=>x.formulaKey));
  function walkValue(v,path){
    if(!v||typeof v!=='object')return;
    if(v.kind==='PARAMETER'){
      if(!params.has(v.parameterKey))throw Error('未定义参数引用 '+skill.skillKey+'/'+path+'/'+v.parameterKey);
      return;
    }
    if(v.kind==='FORMULA'){
      if(!formulas.has(v.formulaKey))throw Error('未定义公式引用 '+skill.skillKey+'/'+path+'/'+v.formulaKey);
      return;
    }
    for(const [k,x] of Object.entries(v))walkValue(x,path+'.'+k);
  }
  for(const [i,f] of skill.write.formulas.entries())checkFormulaNode(f.expression,skill.skillKey+'/formulas['+i+'].expression');
  for(const group of Object.values(skill.write))for(const item of group){
    if(!item||typeof item!=='object')continue;
    for(const [k,v] of Object.entries(item))walkValue(v,k);
  }
  for(const f of skill.write.formulas)walkValue(f.expression,'formula:'+f.formulaKey);
}

for(const key of order){
  const s=plan.skills[key],old=snapshot.skills[key];
  if(!old||old.subject.status!==200)throw Error('缺写前主体 '+key);
  if(Object.entries(old.components).some(([k,v])=>k!=='parameters'&&v.items.length))throw Error('已有非参数组成，须独立核对不能推空 '+key);
  for(const p of old.components.parameters.items){
    const body=Object.fromEntries(Object.entries(p).filter(([k])=>!protectedFields.includes(k)));
    const i=s.write.parameters.findIndex(x=>x.parameterKey===p.parameterKey);
    if(i>=0){
      if(!['valueType','valueMode','fixedValue','levelValues'].every(k=>eq(s.write.parameters[i][k],p[k])))throw Error('已有参数数值不同 '+key+'/'+p.parameterKey);
      const fields=Object.keys(body).filter(k=>!eq(body[k],s.write.parameters[i][k]));
      if(fields.length)changes.push({skillKey:key,parameterKey:p.parameterKey,policy:'原对象完整复用，不发更新请求',fields});
      s.write.parameters[i]=body;
    }else{
      s.write.parameters.unshift(body);
    }
    reuse.push({skillKey:key,parameterKey:p.parameterKey});
  }
  s.reusedParameters=reuse.filter(x=>x.skillKey===key).map(x=>x.parameterKey);
  s.disposition={
    范围外:s.excluded,
    来源待核:s.pending.filter(v=>v.kind==='来源'),
    系统缺口:s.pending.filter(v=>v.kind==='系统'),
    尚未接线:s.pending.filter(v=>!['来源','系统'].includes(v.kind))
  };
  s.status='确定组成候选；未保存/未接线不表示完整战斗机制';
  for(const [kind,items] of Object.entries(s.write)){
    const ids=items.map(v=>v.parameterKey??v.formulaKey??v.effectKey??v.processKey??v.stateKey??v.ruleKey);
    if(new Set(ids).size!==ids.length)throw Error('重复键 '+key+'/'+kind);
  }
  validateReferences(s);
  coverage.push({skillKey:key,parameters:s.write.parameters.length,formulas:s.write.formulas.length,effects:s.write.effects.length,processes:s.write.processes.length,internalStates:s.write.internalStates.length,triggerRules:s.write.triggerRules.length,pending:s.pending.length,excluded:s.excluded.length});
}
plan.meta.generatedAt=new Date().toISOString();
plan.meta.apiWrites=0;
plan.meta.executor='第十五批由Codex执行代理准备；仅来源与当前GET候选，未业务写入';
plan.meta.reuseReport={publicParameters:reuse,preservedMetadataDifferences:changes,originalSnapshotSha256:createHash('sha256').update(fs.readFileSync(new URL('写前现值.json',here))).digest('hex')};
const bytes=JSON.stringify(plan,null,2)+'\n';
fs.writeFileSync(new URL('完整候选.json',here),bytes);
const sha=createHash('sha256').update(bytes).digest('hex');
const objectSha=createHash('sha256').update(JSON.stringify(plan)).digest('hex');
const counts={};
for(const kind of ['parameters','formulas','effects','processes','internalStates','triggerRules'])counts[kind]=order.reduce((n,k)=>n+plan.skills[k].write[kind].length,0);
const report={at:plan.meta.generatedAt,fileSha256:sha,planSha256:objectSha,skillCount:order.length,apiWrites:0,reusedParameters:reuse.length,preservedMetadataDifferences:changes,coverage,counts};
fs.writeFileSync(new URL('候选版本.json',here),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({fileSha256:sha,planSha256:objectSha,skills:order.length,reused:reuse.length,counts,apiWrites:0}));
