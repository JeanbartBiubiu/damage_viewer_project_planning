import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT=path.resolve(HERE,'..','..','..','..','..','damage_web_dev','.agents','artifacts','gear20-finalize');
const CANDIDATE_PATH=path.join(HERE,'最终候选.json');
const candidate=JSON.parse(fs.readFileSync(CANDIDATE_PATH,'utf8'));
const candidateSha256=crypto.createHash('sha256').update(fs.readFileSync(CANDIDATE_PATH)).digest('hex');
const formulaCount=candidate.objects.reduce((n,o)=>n+o.apiPayload.formulas.length,0);
const parameterCount=candidate.objects.reduce((n,o)=>n+o.apiPayload.parameters.length,0);
const selected={};
for(const object of candidate.objects){selected[object.skillKey]=object;}
function pmap(object){return Object.fromEntries(object.apiPayload.parameters.map(p=>[p.parameterKey,p]));}
function fmap(object){return Object.fromEntries(object.apiPayload.formulas.map(f=>[f.formulaKey,f]));}
function fail(message){throw new Error(message);}
function approx(actual,expected,epsilon=1e-9){return typeof actual==='number'&&Number.isFinite(actual)&&Math.abs(actual-expected)<=epsilon;}
function getRuntime(parameterKey,parameter,overrides){
 if(!Object.hasOwn(overrides,parameterKey)) throw new Error(`MISSING_RUNTIME_PARAMETER:${parameterKey}`);
 const value=overrides[parameterKey];
 if(typeof value!=='number'||!Number.isFinite(value)) throw new Error(`INVALID_RUNTIME_PARAMETER:${parameterKey}`);
 if(parameter.valueType==='INTEGER'&&!Number.isInteger(value)) throw new Error(`INVALID_INTEGER_RUNTIME_PARAMETER:${parameterKey}`);
 return value;
}
function evaluateExpression(node,object,overrides,attributes={}){
 if(!node||typeof node!=='object') throw new Error('INVALID_EXPRESSION_NODE');
 if(node.nodeType==='PARAMETER'){
  const parameter=pmap(object)[node.parameterKey];
  if(!parameter) throw new Error(`UNKNOWN_PARAMETER:${node.parameterKey}`);
  if(parameter.valueMode==='FIXED') return parameter.fixedValue;
  if(parameter.valueMode==='RUNTIME_INPUT') return getRuntime(node.parameterKey,parameter,overrides);
  throw new Error(`UNSUPPORTED_VALUE_MODE:${node.parameterKey}`);
 }
 if(node.nodeType==='ATTRIBUTE'){
  const key=`${node.attributeOwner}.${node.attributeKey}.${node.attributeValueKind}`;
  if(!Object.hasOwn(attributes,key)) throw new Error(`MISSING_ATTRIBUTE:${key}`);
  return attributes[key];
 }
 if(node.nodeType==='FORMULA') throw new Error(`FORMULA_REFERENCE_NOT_ALLOWED:${node.formulaKey}`);
 if(node.nodeType==='OPERATION'){
  const values=(node.operands??[]).map(child=>evaluateExpression(child,object,overrides,attributes));
  if(node.operation==='ADD') return values.reduce((a,b)=>a+b,0);
  if(node.operation==='MULTIPLY') return values.reduce((a,b)=>a*b,1);
  if(node.operation==='MIN') return Math.min(...values);
  throw new Error(`UNSUPPORTED_OPERATION:${node.operation}`);
 }
 throw new Error(`UNSUPPORTED_NODE:${node.nodeType}`);
}
function getFormula(skillKey,formulaKey){const object=selected[skillKey];const value=fmap(object)[formulaKey];if(!value)fail(`缺少公式：${skillKey}/${formulaKey}`);return {object,formula:value};}
function runPositive(name,skillKey,formulaKey,overrides,expected){
 const {object,formula}=getFormula(skillKey,formulaKey);let actual;let error=null;try{actual=evaluateExpression(formula.expression,object,overrides);}catch(e){error=String(e);}
 return {name,skillKey,formulaKey,overrides,expected,actual,error,pass:error===null&&approx(actual,expected)};
}
function runReject(name,skillKey,formulaKey,overrides,expectedError){
 const {object,formula}=getFormula(skillKey,formulaKey);let error=null;try{evaluateExpression(formula.expression,object,overrides);}catch(e){error=String(e);}
 return {name,skillKey,formulaKey,overrides,rejected:error!==null,error,expectedError,pass:error===expectedError};
}
const positives=[
 runPositive('不朽之路五层', 'item_3168_passive','stacked_omnivamp',{actual_stacks:5},0.03),
 runPositive('迅速进军移动速度400', 'item_3170_passive','adaptive_force_from_move_speed',{actual_source_move_speed:400},20),
 runPositive('猩红明朗远程比例', 'item_3171_passive','ranged_move_speed_ratio',{},0.08),
 runPositive('带链碾碎者护盾', 'item_3173_passive','magic_shield_value',{actual_level_base_shield:100,source_mstat12_formula2_value:500},140),
 runPositive('装甲战靴护盾', 'item_3174_passive','physical_shield_value',{actual_level_base_shield:100,source_mstat12_formula2_value:500},140),
];
const stackCaps=[9,10,11].map(actual_stacks=>runPositive(`不朽之路层数${actual_stacks}`,'item_3168_passive','stacked_omnivamp',{actual_stacks},Math.min(actual_stacks,10)*0.006));
const rejects=[
 runReject('不朽之路缺当前层数','item_3168_passive','stacked_omnivamp',{},'Error: MISSING_RUNTIME_PARAMETER:actual_stacks'),
 runReject('迅速进军缺移动速度','item_3170_passive','adaptive_force_from_move_speed',{},'Error: MISSING_RUNTIME_PARAMETER:actual_source_move_speed'),
 runReject('带链碾碎者缺等级基础护盾','item_3173_passive','magic_shield_value',{source_mstat12_formula2_value:500},'Error: MISSING_RUNTIME_PARAMETER:actual_level_base_shield'),
 runReject('装甲战靴缺等级基础护盾','item_3174_passive','physical_shield_value',{source_mstat12_formula2_value:500},'Error: MISSING_RUNTIME_PARAMETER:actual_level_base_shield'),
];
const noRuntimeRequired=[
 runPositive('猩红明朗公式无运行时输入','item_3171_passive','ranged_move_speed_ratio',{},0.08),
];
const shieldNoDefault=[];
for(const skillKey of ['item_3173_passive','item_3174_passive']){
 const parameter=pmap(selected[skillKey]).actual_level_base_shield;
 const missing=runReject(`${skillKey}等级基础护盾无默认`,skillKey,skillKey==='item_3173_passive'?'magic_shield_value':'physical_shield_value',{source_mstat12_formula2_value:500},'Error: MISSING_RUNTIME_PARAMETER:actual_level_base_shield');
 shieldNoDefault.push({skillKey,parameter:{parameterKey:parameter.parameterKey,valueType:parameter.valueType,valueMode:parameter.valueMode,fixedValue:parameter.fixedValue,levelValues:parameter.levelValues},missingEvaluation:missing,pass:parameter.valueType==='DECIMAL'&&parameter.valueMode==='RUNTIME_INPUT'&&parameter.fixedValue===null&&parameter.levelValues===null&&missing.pass});
}
const formulaShapes=[];
for(const object of candidate.objects){for(const f of object.apiPayload.formulas){let nodeCount=0,unknown=[];evaluateExpression;const walk=node=>{if(!node||typeof node!=='object')return;nodeCount++;if(!['PARAMETER','ATTRIBUTE','OPERATION'].includes(node.nodeType))unknown.push(node.nodeType);if(node.nodeType==='OPERATION')for(const child of node.operands??[])walk(child);};walk(f.expression);formulaShapes.push({skillKey:object.skillKey,formulaKey:f.formulaKey,nodeCount,unknownNodes:unknown,pass:unknown.length===0});}}
const allPass=[...positives,...stackCaps,...rejects,...noRuntimeRequired,...shieldNoDefault.flatMap(x=>[x.missingEvaluation])].every(x=>x.pass) && formulaCount===5 && parameterCount===32 && formulaShapes.every(x=>x.pass);
const result={generatedAt:new Date().toISOString(),mode:'独立解析候选表达式',noBusinessWrites:true,apiWrites:0,candidateSha256,parameterCount,formulaCount,positiveCases:positives,capCases:stackCaps,missingValueRejections:rejects,noRuntimeRequired,shieldLevelNoDefault:shieldNoDefault,formulaShapes,allPass,businessMathReady:allPass};
fs.mkdirSync(ARTIFACT,{recursive:true});
const resultPath=path.join(ARTIFACT,`独立数学核算-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
fs.writeFileSync(resultPath,JSON.stringify(result,null,2)+'\n','utf8');
if(!allPass) process.exitCode=1;
console.log(JSON.stringify({resultPath,candidateSha256,parameterCount,formulaCount,positivePassed:positives.filter(x=>x.pass).length,positiveTotal:positives.length,capPassed:stackCaps.filter(x=>x.pass).length,capTotal:stackCaps.length,rejectionPassed:rejects.filter(x=>x.pass).length,rejectionTotal:rejects.length,noRuntimePassed:noRuntimeRequired.filter(x=>x.pass).length,noRuntimeTotal:noRuntimeRequired.length,shieldNoDefaultPassed:shieldNoDefault.filter(x=>x.pass).length,shieldNoDefaultTotal:shieldNoDefault.length,allPass,businessMathReady:allPass}));

