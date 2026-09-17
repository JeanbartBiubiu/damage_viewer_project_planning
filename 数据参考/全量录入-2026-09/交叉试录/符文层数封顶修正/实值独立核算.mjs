import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const planBytes=fs.readFileSync(path.join(here,'可审查请求.json'));assert.equal(sha(planBytes),'9eedde869856eaf7fd119d4b1ad192fa4cba7509ddc6b9a8571ac7c261ee89d9');const plan=JSON.parse(planBytes);
const verify=JSON.parse(fs.readFileSync(path.join(here,'verify-20260909073057989.json')));assert.equal(verify.summary.passed,true);
const auth=process.env.RUNE_CAP_MATH_TOKEN;assert.ok(auth,'缺少本地只读认证');
const run=new Date().toISOString().replace(/[-:.TZ]/g,''),file=path.join(here,`实值独立核算-${run}.json`);
const report={startedAt:new Date().toISOString(),planSha256:sha(planBytes),reads:[],math:[],businessWrites:0,summary:null};
const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
const formulas=new Map(),parameters=new Map();
async function get(route){const response=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{headers:{Authorization:'Bearer '+auth},signal:AbortSignal.timeout(30000)});const actual=await response.json();report.reads.push({at:new Date().toISOString(),method:'GET',route,status:response.status,actual});save();assert.equal(response.status,200,route);const prior=verify.reads.find(r=>r.route===route);assert.ok(prior);assert.deepEqual(actual,prior.actual,'本次独立实际GET必须与已确认写后完整对象一致');return actual;}
function refs(node,result=new Set()){if(node&&typeof node==='object'){if(node.nodeType==='PARAMETER')result.add(node.parameterKey);for(const child of Object.values(node))if(child&&typeof child==='object')refs(child,result);}return result;}
function evaluate(id,node,input){
 if(node.nodeType==='PARAMETER'){const p=parameters.get(`${id}/${node.parameterKey}`);assert.ok(p,'参数只能来自本次实际GET');if(p.valueMode==='FIXED')return p.fixedValue;assert.equal(p.valueMode,'RUNTIME_INPUT');assert.equal(p.fixedValue,null);assert.equal(p.levelValues,null);if(!Object.hasOwn(input,p.parameterKey)||!Number.isFinite(input[p.parameterKey]))throw Error('缺输入 '+p.parameterKey);if(p.valueType==='INTEGER'&&!Number.isInteger(input[p.parameterKey]))throw Error('违反整数输入域 '+p.parameterKey);if(p.parameterKey==='actual_stacks'&&input[p.parameterKey]<0)throw Error('违反非负输入域 actual_stacks');return input[p.parameterKey];}
 assert.equal(node.nodeType,'OPERATION','合法公式节点');const vs=node.operands.map(v=>evaluate(id,v,input));if(node.operation==='MULTIPLY')return vs.reduce((a,b)=>a*b,1);if(node.operation==='MIN')return Math.min(...vs);throw Error('非法运算');
}
try{
 for(const c of plan.changes){const f=await get(c.route);formulas.set(`${c.id}/${c.formulaKey}`,f);for(const key of refs(f.expression)){const mapKey=`${c.id}/${key}`;if(!parameters.has(mapKey))parameters.set(mapKey,await get(`/skills/${c.skillKey}/parameters/${key}`));}}
 assert.equal(formulas.size,3);assert.equal(parameters.size,7);assert.equal(report.reads.length,10);
 for(const example of plan.math){const formula=formulas.get(`${example.id}/${example.formulaKey}`);assert.ok(formula);let actual;try{actual=evaluate(example.id,formula.expression,example.supplied);}catch(e){actual=e.message;}const expected=example.expectedAfter;const passed=typeof expected==='number'?typeof actual==='number'&&Math.abs(actual-expected)<1e-9:typeof actual==='string'&&actual.startsWith(expected);report.math.push({id:example.id,formulaKey:example.formulaKey,label:example.label,supplied:example.supplied,actual,expected,passed,inputSource:'本次实际3公式7参数GET',negativeCheckBoundary:typeof expected==='string'?'独立求值器按必要输入与整数域拒绝；不冒充后端战斗执行':null});assert.ok(passed,example.label);}
 assert.equal(report.math.length,19);assert.ok(report.math.every(r=>r.passed));
 report.staticQualificationEvidence={caseCount:6,source:'可审查请求.json/branchChecks',cases:plan.branchChecks,boundary:'保留6项写前静态资格案例；不声称其条件已进入当前公式或已有自动运行入口。写后44路由另证对应未改公式/动作仍同值。'};
 report.summary={passed:true,actualGET:10,actualFormulas:3,actualParameters:7,independentCases:19,preservedStaticQualificationCases:6,businessWrites:0};report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({file:path.basename(file),...report.summary,sha256:sha(fs.readFileSync(file))}));
}catch(e){report.failure={name:e.name,message:e.message};save();console.error(JSON.stringify({error:e.message,completedGET:report.reads.length}));process.exitCode=1;}
