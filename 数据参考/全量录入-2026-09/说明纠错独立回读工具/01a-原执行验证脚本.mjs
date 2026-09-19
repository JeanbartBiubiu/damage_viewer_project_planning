import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {runReadback} from '../../tools/authoring/read-reviewed-description-updates.mjs';

const outputDir=path.resolve(import.meta.dirname);
const repoRoot=path.resolve(outputDir,'../..');
const helperPath=path.join(repoRoot,'tools/authoring/read-reviewed-description-updates.mjs');
const writerPath=path.join(repoRoot,'tools/authoring/update-reviewed-descriptions-v2.mjs');
const dataRoot=path.join(repoRoot,'数据参考','__offline-description-readback-helper__');
const hash=value=>crypto.createHash('sha256').update(Buffer.isBuffer(value)?value:Buffer.from(value)).digest('hex');
const json=value=>Buffer.from(`${JSON.stringify(value,null,2)}\n`);
const clone=value=>structuredClone(value);
const keyPath=(root,name)=>path.normalize(path.join(root,name));

function virtualIo(files){
  const table=new Map(Object.entries(files).map(([file,value])=>[path.normalize(file),Buffer.isBuffer(value)?value:Buffer.from(value)]));
  return {readFileSync(file){
    const found=table.get(path.normalize(file));
    if(!found)throw new Error(`offline file missing: ${file}`);
    return found;
  }};
}

function detailFieldSet(kind){
  return kind==='skill'
    ? ['name','description','maxLevel','status','sortOrder','skillCategoryKeys']
    : kind==='parameter'
      ? ['name','description','valueType','valueMode','fixedValue','levelValues','sortOrder']
      : ['name','description','sortOrder','lifecycle','results'];
}

function makeFixture(caseName){
  const batchDir=keyPath(repoRoot,path.join('数据参考','__offline-description-readback-helper__',caseName));
  const sourceRelative=`数据参考/__offline-description-readback-helper__/${caseName}-source.md`;
  const sourceAbsolute=keyPath(repoRoot,sourceRelative);
  const oldTime='2026-09-18T00:00:00.000Z';
  const newTimes=['2026-09-19T00:00:01.000Z','2026-09-19T00:00:02.000Z','2026-09-19T00:00:03.000Z','2026-09-19T00:00:04.000Z'];
  const skill={createdAt:'2026-09-01T00:00:00.000Z',description:'旧技能说明',gameId:'lol',maxLevel:5,name:'测试技能',skillCategoryKeys:['common'],skillKey:'fixture_skill',sortOrder:1,status:'ENABLED',updatedAt:oldTime};
  const makeParameter=(parameterKey,description,name,sortOrder,fixedValue)=>({createdAt:'2026-09-02T00:00:00.000Z',description,fixedValue,gameId:'lol',levelValues:null,name,parameterKey,skillKey:'fixture_skill',sortOrder,updatedAt:oldTime,valueMode:'FIXED',valueType:'INTEGER'});
  const mana=makeParameter('mana_cost','旧法力说明','法力',10,60);
  const cast=makeParameter('cast_time_ms','旧施法时间说明','施法时间',20,500);
  const power=makeParameter('power','未目标参数说明','强度',30,100);
  const effectDetail={createdAt:'2026-09-04T00:00:00.000Z',description:'旧效果说明',effectKey:'resource',gameId:'lol',lifecycle:null,name:'资源变化',results:[{description:null,detail:{attributeKey:'mana',operation:'CONSUME'},lifecycleBehavior:null,name:'消耗资源',resultKey:'resource',resultType:'RESOURCE_CHANGE',sortOrder:10,spellShieldBlockScope:null,target:'SOURCE',valueRule:{fixedMaxValue:null,fixedMinValue:0,fixedMultiplier:1,value:{kind:'PARAMETER',parameterKey:'mana_cost'}}}],skillKey:'fixture_skill',sortOrder:10,updatedAt:oldTime};
  const otherEffect={createdAt:'2026-09-05T00:00:00.000Z',description:'未目标效果说明',effectKey:'other',gameId:'lol',lifecycle:null,name:'其他效果',results:[{description:null,detail:{attributeKey:'health',operation:'ADD'},lifecycleBehavior:null,name:'增加生命',resultKey:'health',resultType:'RESOURCE_CHANGE',sortOrder:10,spellShieldBlockScope:null,target:'SOURCE',valueRule:{fixedMaxValue:null,fixedMinValue:0,fixedMultiplier:1,value:{kind:'FIXED',value:1}}}],skillKey:'fixture_skill',sortOrder:20,updatedAt:oldTime};
  const values={
    '/skills/fixture_skill':skill,
    '/skills/fixture_skill/parameters':[mana,cast,power].map(row=>clone(row)),
    '/skills/fixture_skill/parameters/mana_cost':clone(mana),
    '/skills/fixture_skill/parameters/cast_time_ms':clone(cast),
    '/skills/fixture_skill/parameters/power':clone(power),
    '/skills/fixture_skill/effects':[{
      createdAt:effectDetail.createdAt,description:effectDetail.description,effectKey:'resource',gameId:'lol',lifecycleEnabled:false,name:effectDetail.name,resultCount:1,skillKey:'fixture_skill',sortOrder:10,updatedAt:oldTime
    },{
      createdAt:otherEffect.createdAt,description:otherEffect.description,effectKey:'other',gameId:'lol',lifecycleEnabled:false,name:otherEffect.name,resultCount:1,skillKey:'fixture_skill',sortOrder:20,updatedAt:oldTime
    }],
    '/skills/fixture_skill/effects/resource':clone(effectDetail),
    '/skills/fixture_skill/effects/other':clone(otherEffect),
    '/skills/fixture_skill/formulas':[{createdAt:'2026-09-06T00:00:00.000Z',description:'公式列表说明',formulaKey:'formula_a',gameId:'lol',name:'测试公式',skillKey:'fixture_skill',sortOrder:1,updatedAt:oldTime}],
    '/skills/fixture_skill/formulas/formula_a':{createdAt:'2026-09-06T00:00:00.000Z',description:'公式详情说明',formulaKey:'formula_a',gameId:'lol',name:'测试公式',expression:{kind:'FIXED',value:1},skillKey:'fixture_skill',sortOrder:1,updatedAt:oldTime},
    '/skills/fixture_skill/processes':[{createdAt:'2026-09-07T00:00:00.000Z',description:'过程列表说明',gameId:'lol',name:'测试过程',processKey:'process_a',skillKey:'fixture_skill',sortOrder:1,updatedAt:oldTime}],
    '/skills/fixture_skill/processes/process_a':{createdAt:'2026-09-07T00:00:00.000Z',description:'过程详情说明',gameId:'lol',name:'测试过程',processKey:'process_a',steps:[{kind:'CAST'}],skillKey:'fixture_skill',sortOrder:1,updatedAt:oldTime},
    '/skills/fixture_skill/trigger-rules':[{createdAt:'2026-09-08T00:00:00.000Z',description:'触发列表说明',gameId:'lol',name:'测试触发',ruleKey:'rule_a',skillKey:'fixture_skill',sortOrder:1,updatedAt:oldTime}],
    '/skills/fixture_skill/trigger-rules/rule_a':{createdAt:'2026-09-08T00:00:00.000Z',description:'触发详情说明',gameId:'lol',name:'测试触发',ruleKey:'rule_a',condition:{kind:'ALWAYS'},skillKey:'fixture_skill',sortOrder:1,updatedAt:oldTime}
  };
  const changes=[
    {kind:'skill',skillKey:'fixture_skill',route:'/skills/fixture_skill',description:'新技能说明'},
    {kind:'parameter',skillKey:'fixture_skill',route:'/skills/fixture_skill/parameters/mana_cost',description:'新法力说明'},
    {kind:'parameter',skillKey:'fixture_skill',route:'/skills/fixture_skill/parameters/cast_time_ms',description:'新施法时间说明'},
    {kind:'effect',skillKey:'fixture_skill',route:'/skills/fixture_skill/effects/resource',description:'新效果说明'}
  ];
  const plan={title:'离线说明回读样例',reason:'只用于离线校验',changes,sourceFiles:[{root:'web',path:sourceRelative}]};
  const sourceBytes=Buffer.from(`offline source for ${caseName}\n`);
  const sources=[{root:'web',path:sourceRelative,sha256:hash(sourceBytes)}];
  if(caseName==='bad-source-hash')sources[0].sha256='0'.repeat(64);
  const audit=Object.keys(values).map(route=>({method:'GET',path:route,status:200}));
  const baseline={at:'2026-09-18T00:00:00.000Z',base:'http://127.0.0.1:8080/api/admin/games/lol',values,audit,businessWrites:0};
  const requests=changes.map(change=>{
    const before=values[change.route];
    const body={};
    for(const field of detailFieldSet(change.kind))body[field]=field==='description'?change.description:before[field];
    return {method:'PUT',route:change.route,body,expectedReadback:{...before,description:change.description}};
  });
  const freeze={base:'http://127.0.0.1:8080/api/admin/games/lol',requests,sourceSha256:hash(json(sources)),baselineSha256:hash(json(baseline))};
  const write={status:'PASS',businessWritesAttempted:requests.length,pendingRoute:null,operations:requests.map(request=>({route:request.route,response:{status:200},readback:request.expectedReadback}))};
  const planBytes=json(plan);
  const freezeBytes=json(freeze);
  const sourceBytesJson=json(sources);
  const baselineBytes=json(baseline);
  const review={status:'APPROVED',approvedFiles:{
    'tools/authoring/update-reviewed-descriptions-v2.mjs':hash(fs.readFileSync(writerPath)),
    '01-纠错计划.json':hash(planBytes),
    '02-冻结请求.json':hash(freezeBytes),
    '03-来源摘要.json':hash(sourceBytesJson),
    '04-写入前现值.json':hash(baselineBytes)
  }};
  if(caseName==='bad-approval')review.approvedFiles['01-纠错计划.json']='0'.repeat(64);
  const files={
    [helperPath]:fs.readFileSync(helperPath),
    [writerPath]:fs.readFileSync(writerPath),
    [keyPath(batchDir,'01-纠错计划.json')]:planBytes,
    [keyPath(batchDir,'02-冻结请求.json')]:freezeBytes,
    [keyPath(batchDir,'03-来源摘要.json')]:sourceBytesJson,
    [keyPath(batchDir,'04-写入前现值.json')]:baselineBytes,
    [keyPath(batchDir,'05-独立评审.json')]:json(review),
    [keyPath(batchDir,'06-写入与即时回读.json')]:json(write),
    [sourceAbsolute]:sourceBytes
  };
  const actualValues=clone(values);
  const detailTimes={
    '/skills/fixture_skill':newTimes[0],
    '/skills/fixture_skill/parameters/mana_cost':newTimes[1],
    '/skills/fixture_skill/parameters/cast_time_ms':newTimes[2],
    '/skills/fixture_skill/effects/resource':newTimes[3]
  };
  for(const change of changes){
    const detail=actualValues[change.route];
    detail.description=change.description;
    detail.updatedAt=detailTimes[change.route];
    if(change.kind!=='skill'){
      const collection=change.kind==='parameter'?'parameters':'effects';
      const stableField=change.kind==='parameter'?'parameterKey':'effectKey';
      const stableKey=change.route.split('/').at(-1);
      const row=actualValues[`/skills/fixture_skill/${collection}`].find(item=>item[stableField]===stableKey);
      row.description=change.description;
      row.updatedAt=detail.updatedAt;
    }
  }
  if(caseName==='createdAt-drift')actualValues['/skills/fixture_skill/parameters/mana_cost'].createdAt='2026-09-02T00:00:01.000Z';
  if(caseName==='nested-numeric-drift')actualValues['/skills/fixture_skill/effects/other'].results[0].sortOrder=999;
  if(caseName==='list-detail-mismatch')actualValues['/skills/fixture_skill/effects'].find(row=>row.effectKey==='resource').updatedAt='2026-09-19T00:00:08.000Z';
  return {batchDir,files,actualValues,baselinePaths:Object.keys(values)};
}

async function runCase(caseName,expectedStatus){
  const fixture=makeFixture(caseName);
  const calls=[];
  const fetchMock=async(url,options)=>{
    if(options.method!=='GET')throw new Error(`unexpected method ${options.method}`);
    const route=new URL(url).pathname.replace('/api/admin/games/lol','')||'/';
    calls.push({method:options.method,path:route});
    const value=fixture.actualValues[route];
    if(value===undefined)return {status:404,ok:false,headers:{get:()=> 'application/json'},arrayBuffer:async()=>Buffer.from('{}')};
    if(caseName==='status-201'&&route===fixture.baselinePaths[0])return {status:201,ok:true,headers:{get:()=> 'application/json'},arrayBuffer:async()=>Buffer.from(JSON.stringify(value))};
    if(caseName==='body-read-error'&&route===fixture.baselinePaths[0])return {status:200,ok:true,headers:{get:()=> 'application/json'},arrayBuffer:async()=>{throw new Error('offline body read error');}};
    return {status:200,ok:true,headers:{get:()=> 'application/json'},arrayBuffer:async()=>Buffer.from(JSON.stringify(value))};
  };
  const report=await runReadback({batchDir:fixture.batchDir,fetchImpl:fetchMock,io:virtualIo(fixture.files),realHTTP0:true});
  const expectedCalls=caseName==='bad-approval'||caseName==='bad-source-hash'?0:fixture.baselinePaths.length;
  const allGets=calls.every(call=>call.method==='GET');
  const statusMatches=report.status===expectedStatus;
  const callsMatch=calls.length===expectedCalls;
  const firstAudit=report.audit[0];
  const auditStatusPreserved=caseName==='status-201'?firstAudit?.status===201:caseName==='body-read-error'?firstAudit?.status===200&&firstAudit?.error==='BODY_READ_FAILED':true;
  const result={case:caseName,status:report.status,expectedStatus,statusMatches,GETs:report.GETs,fetchCalls:calls.length,expectedGETs:expectedCalls,allMethodsGET:allGets,auditStatusPreserved,realHTTP0:report.realHTTP0,businessWrites:report.businessWrites,failureCategories:[...new Set(report.failures.map(failure=>failure.category))]};
  if(!statusMatches||!callsMatch||!allGets||!auditStatusPreserved||report.businessWrites!==0)throw new Error(`offline case failed: ${JSON.stringify(result)}`);
  if(report.status==='FAIL'){
    const failureDir=path.join(outputDir,'failure-originals');
    fs.mkdirSync(failureDir,{recursive:true});
    fs.writeFileSync(path.join(failureDir,`${caseName}.json`),JSON.stringify({actualValues:fixture.actualValues,report},null,2)+'\n');
  }
  return result;
}

const cases=[];
cases.push(await runCase('success', 'PASS'));
cases.push(await runCase('createdAt-drift', 'FAIL'));
cases.push(await runCase('nested-numeric-drift', 'FAIL'));
cases.push(await runCase('list-detail-mismatch', 'FAIL'));
cases.push(await runCase('bad-approval', 'FAIL'));
cases.push(await runCase('bad-source-hash', 'FAIL'));
cases.push(await runCase('status-201', 'FAIL'));
cases.push(await runCase('body-read-error', 'FAIL'));
const selfSHA=hash(fs.readFileSync(helperPath));
const output={schemaVersion:'description-readback-helper.offline.v1',status:cases.every(item=>item.statusMatches&&item.allMethodsGET&&item.auditStatusPreserved)?'PASS':'FAIL',selfSHA,scriptSha256:selfSHA,realHTTP0:true,businessWrites:0,businessWrites0:true,cases};
fs.writeFileSync(path.join(outputDir,'offline-verification.json'),JSON.stringify(output,null,2)+'\n');
process.stdout.write(`${JSON.stringify(output)}\n`);
if(output.status!=='PASS')process.exitCode=1;
