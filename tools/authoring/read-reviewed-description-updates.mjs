import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// 普通说明纠错 v2 的独立只读回读器。
// 这个文件只读取批次和接口，不创建07文件，也不会发出PUT请求。
const executor=fileURLToPath(import.meta.url);
const web=path.resolve(path.dirname(executor),'../..');
const dataRoot=path.join(web,'数据参考');
const base='http://127.0.0.1:8080/api/admin/games/lol';
const writerPath='tools/authoring/update-reviewed-descriptions-v2.mjs';
const lockedWriterSha256='f4c052309203d0c6cda9c5efb8dbc477888ebc6e239d90979617231cf1922517';
const timeoutMs=30_000;

const fieldSets=Object.freeze({
  skill:['name','description','maxLevel','status','sortOrder','skillCategoryKeys'],
  parameter:['name','description','valueType','valueMode','fixedValue','levelValues','sortOrder'],
  effect:['name','description','sortOrder','lifecycle','results']
});
const collectionIds=Object.freeze({parameters:'parameterKey',effects:'effectKey'});
const requiredBatchFiles=Object.freeze({
  plan:'01-纠错计划.json',
  freeze:'02-冻结请求.json',
  sources:'03-来源摘要.json',
  baseline:'04-写入前现值.json',
  review:'05-独立评审.json',
  write:'06-写入与即时回读.json'
});
const approvedFiles=Object.freeze([
  writerPath,
  requiredBatchFiles.plan,
  requiredBatchFiles.freeze,
  requiredBatchFiles.sources,
  requiredBatchFiles.baseline
]);

class ReadbackFailure extends Error {
  constructor(message,category='PREFLIGHT') {
    super(message);
    this.name='ReadbackFailure';
    this.category=category;
  }
}

const own=(value,key)=>value!==null&&typeof value==='object'&&Object.hasOwn(value,key);
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=(condition,message,category='PREFLIGHT')=>{
  if(!condition)throw new ReadbackFailure(message,category);
};
const asBytes=value=>Buffer.isBuffer(value)?value:Buffer.from(value instanceof Uint8Array?value:String(value));
const defaultIo={readFileSync:(file,...args)=>fs.readFileSync(file,...args)};
const bytesOf=(io,file)=>asBytes(io.readFileSync(file));
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const sha256File=(io,file)=>sha256(bytesOf(io,file));
const parseJson=(io,file,label)=>{
  try{return JSON.parse(bytesOf(io,file).toString('utf8'));}
  catch(error){throw new ReadbackFailure(`${label}读取或JSON解析失败：${error.message}`);}
};

// 结构相等包含对象键集合、数组顺序和所有时间戳。
export function sameValue(left,right){
  if(Object.is(left,right))return true;
  if(typeof left!==typeof right||left===null||right===null)return false;
  if(Array.isArray(left)||Array.isArray(right)){
    return Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&left.every((value,index)=>sameValue(value,right[index]));
  }
  if(typeof left!=='object')return false;
  const leftKeys=Object.keys(left).sort();
  const rightKeys=Object.keys(right).sort();
  return leftKeys.length===rightKeys.length&&leftKeys.every((key,index)=>key===rightKeys[index]&&sameValue(left[key],right[key]));
}

function differenceExcept(expected,actual,ignoredKeys){
  const differences=[];
  if(!isObject(expected)||!isObject(actual))return ['$'];
  const leftKeys=Object.keys(expected).filter(key=>!ignoredKeys.has(key)).sort();
  const rightKeys=Object.keys(actual).filter(key=>!ignoredKeys.has(key)).sort();
  if(!sameValue(leftKeys,rightKeys))differences.push('$keys');
  for(const key of leftKeys)if(!sameValue(expected[key],actual[key]))differences.push(`$.${key}`);
  return differences;
}

const validIso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const isLater=(actual,before)=>validIso(actual)&&validIso(before)&&Date.parse(actual)>Date.parse(before);
const routeForFile=(batchDir,file)=>path.join(batchDir,file);
const relativePath=(root,target)=>path.relative(root,target);
const inside=(root,target)=>{
  const relative=relativePath(root,target);
  return relative!==''&&!relative.startsWith('..')&&!path.isAbsolute(relative);
};

function checkBatchDir(value){
  fail(typeof value==='string'&&value.trim(),'必须提供批次目录');
  const batchDir=path.resolve(value);
  fail(inside(dataRoot,batchDir),'批次目录必须位于当前Web数据参考下');
  return batchDir;
}

function resolveSource(source){
  fail(isObject(source),'来源条目必须是对象');
  fail(source.root==='web'||source.root==='planning',`不支持的来源根：${String(source.root)}`);
  fail(typeof source.path==='string'&&source.path.length>0,'来源路径无效');
  const root=source.root==='web'?web:path.resolve(web,'../damage_viewer_project_planning');
  const file=path.resolve(root,source.path);
  fail(inside(root,file),`来源路径越界：${source.path}`);
  return {root,file};
}

function routeInfo(route){
  const match=/^\/skills\/([a-z0-9_]+)(?:\/(parameters|effects)\/([a-z0-9_]+))?$/.exec(route);
  if(!match)return null;
  const [,skillKey,collection,stableKey]=match;
  return {route,skillKey,collection,stableKey,kind:collection==='parameters'?'parameter':collection==='effects'?'effect':'skill'};
}

function validBaselineRoute(route){
  return /^\/skills\/[a-z0-9_]+(?:\/(?:parameters|formulas|effects|processes|internal-states|trigger-rules)(?:\/[a-z0-9_]+)?)?$/.test(route);
}

function validatePlan(plan){
  fail(isObject(plan)&&Array.isArray(plan.changes)&&plan.changes.length>0,'01.changes必须是非空数组');
  const targets=new Map();
  for(const change of plan.changes){
    fail(isObject(change),'01.changes含无效条目');
    const info=routeInfo(change.route);
    fail(info!==null,`只允许技能、参数或效果说明：${String(change.route)}`);
    fail(!targets.has(info.route),`01存在重复路由：${info.route}`);
    fail(change.kind===info.kind,`01.kind与路由不一致：${info.route}`);
    fail(change.skillKey===info.skillKey,`01.skillKey与路由不一致：${info.route}`);
    fail(typeof change.description==='string'&&change.description.trim().length>0&&change.description.length<=2000,`01说明无效：${info.route}`);
    targets.set(info.route,{...info,description:change.description});
  }
  fail(Array.isArray(plan.sourceFiles)&&plan.sourceFiles.length>0,'01.sourceFiles必须是非空数组');
  return targets;
}

function exactKeys(value,keys,label){
  fail(isObject(value),`${label}必须是对象`);
  const actual=Object.keys(value).sort();
  const expected=[...keys].sort();
  fail(sameValue(actual,expected),`${label}字段集合不符合当前v2白名单`);
}

function validateBaseline(baseline){
  fail(isObject(baseline),'04必须是对象');
  fail(baseline.base===base,`04.base不符合固定接口：${String(baseline.base)}`);
  fail(baseline.businessWrites===0,'04.businessWrites必须为0');
  fail(isObject(baseline.values)&&Object.keys(baseline.values).length>0,'04.values必须是非空对象');
  fail(Array.isArray(baseline.audit),'04.audit必须是数组');
  const paths=Object.keys(baseline.values);
  const pathSet=new Set(paths);
  fail(baseline.audit.length===paths.length,'04.audit与values数量不一致');
  const auditPaths=new Set();
  for(const entry of baseline.audit){
    fail(isObject(entry)&&entry.method==='GET'&&entry.status===200,'04只能包含成功GET审计');
    fail(typeof entry.path==='string'&&!auditPaths.has(entry.path),'04.audit路径重复或无效');
    auditPaths.add(entry.path);
  }
  fail(auditPaths.size===pathSet.size&&[...auditPaths].every(route=>pathSet.has(route)),'04.audit路径集合与values不一致');
  for(const route of paths)fail(validBaselineRoute(route),`04包含不支持的路径：${route}`);
  return paths;
}

function validateWriteReport(write,expectedCount,expectedRoutes){
  fail(isObject(write)&&write.status==='PASS','06必须是PASS');
  fail(write.businessWritesAttempted===expectedCount,'06写入次数与01不一致');
  fail(Array.isArray(write.operations)&&write.operations.length===expectedCount,'06.operations数量与01不一致');
  fail(write.pendingRoute===null,'06.pendingRoute必须为null');
  const routes=[];
  for(const operation of write.operations){
    fail(isObject(operation)&&typeof operation.route==='string','06.operations缺少路由');
    routes.push(operation.route);
    fail(isObject(operation.response)&&operation.response.status===200,'06存在非200写入响应');
    fail(isObject(operation.readback),'06缺少即时回读');
  }
  fail(sameValue(routes,expectedRoutes),'06.operations路由顺序与冻结请求不一致');
}

function buildExpectedBody(detail,target){
  const fields=fieldSets[target.kind];
  for(const field of fields)fail(own(detail,field),`04目标详情缺少白名单字段：${target.route}/${field}`);
  const body={};
  for(const field of fields)body[field]=field==='description'?target.description:detail[field];
  return body;
}

function validateFrozen(planTargets,freeze,baseline,sourceSha,baselineSha){
  fail(isObject(freeze)&&freeze.base===base,`02.base不符合固定接口：${String(freeze?.base)}`);
  fail(freeze.sourceSha256===sourceSha,'02.sourceSha256未绑定当前03原字节');
  fail(freeze.baselineSha256===baselineSha,'02.baselineSha256未绑定当前04原字节');
  fail(Array.isArray(freeze.requests)&&freeze.requests.length===planTargets.size,'02.requests数量与01不一致');
  const requests=[];
  const seen=new Set();
  for(const request of freeze.requests){
    fail(isObject(request)&&request.method==='PUT'&&typeof request.route==='string','02存在无效请求');
    fail(planTargets.has(request.route),`02包含不在01中的路由：${request.route}`);
    fail(!seen.has(request.route),`02存在重复路由：${request.route}`);
    seen.add(request.route);
    const target=planTargets.get(request.route);
    const before=baseline.values[target.route];
    fail(isObject(before),`04缺少目标详情：${target.route}`);
    const expectedBody=buildExpectedBody(before,target);
    exactKeys(request.body,Object.keys(expectedBody),`02.body ${request.route}`);
    fail(sameValue(request.body,expectedBody),`02.body含description以外的漂移：${request.route}`);
    const expectedReadback={...before,description:target.description};
    fail(sameValue(request.expectedReadback,expectedReadback),`02.expectedReadback与04不一致：${request.route}`);
    if(target.collection){
      const listPath=`/skills/${target.skillKey}/${target.collection}`;
      const list=baseline.values[listPath];
      const stableField=collectionIds[target.collection];
      fail(Array.isArray(list),`04缺少目标列表：${listPath}`);
      const rows=list.filter(row=>row?.[stableField]===target.stableKey);
      fail(rows.length===1,`04目标列表缺少或重复目标：${target.route}`);
    }
    requests.push({request,target,before});
  }
  fail(requests.length===planTargets.size&&[...planTargets.keys()].every(route=>seen.has(route)),'01与02路由集合不一致');
  return requests;
}

function sourceChecks(io,plan,sourcesFile){
  fail(sourcesFile.length===plan.sourceFiles.length,'03来源条目数量异常');
  const checks=[];
  for(let index=0;index<plan.sourceFiles.length;index+=1){
    const planned=plan.sourceFiles[index];
    const source=sourcesFile[index];
    fail(isObject(source)&&source.root===planned.root&&source.path===planned.path,`03来源条目与01不一致：${planned.path}`);
    exactKeys(source,['root','path','sha256'],`03来源 ${planned.path}`);
    const resolved=resolveSource(source);
    let actual;
    try{actual=sha256File(io,resolved.file);}
    catch(error){throw new ReadbackFailure(`来源文件读取失败：${planned.path}：${error.message}`);}
    const matches=source.sha256===actual;
    checks.push({root:source.root,path:source.path,expectedSha256:source.sha256,actualSha256:actual,matches});
    fail(matches,`来源摘要不匹配：${source.path}`);
  }
  return checks;
}

function initialReport(selfSHA,realHTTP0){
  return {
    schemaVersion:'authoring.independent-readback.v2',
    generatedAt:new Date().toISOString(),
    status:'FAIL',
    endpoint:base,
    requestMethod:'GET',
    methodsUsed:['GET'],
    requestAuth:'temporary_non_empty_bearer',
    realHTTP0:Boolean(realHTTP0),
    businessWrites:0,
    businessWrites0:true,
    GETs:0,
    selfSHA,
    scriptSha256:selfSHA,
    preflight:null,
    counts:{requestedGETs:0,completedGETs:0,successfulJSONResponses:0,statusCounts:{},targetDetailPaths:0,targetListPaths:0,changedDetailPass:0,changedListPass:0,unchangedResponsesIncludingTimestamps:0,unchangedPathsExpected:0,unchangedPathsPass:0,expectedChangedCollections:0,failureCount:0},
    expectedChangedCollections:0,
    unchangedResponsesIncludingTimestamps:0,
    changedDetails:{},
    values:{},
    audit:[],
    failures:[]
  };
}

function failureMessage(error){
  return error instanceof Error?error.message:String(error);
}

async function readCurrentValues({fetchImpl,paths,actualValues,audit,failures,realHTTP0}){
  fail(typeof fetchImpl==='function','当前环境没有可用fetch','PREFLIGHT');
  const token=`Bearer ${crypto.randomUUID()}`;
  for(let index=0;index<paths.length;index+=1){
    const route=paths[index];
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    let response=null;
    let bytes=Buffer.alloc(0);
    try{
      // 唯一网络调用固定为GET；token只存在于请求头，不进入返回对象。
      response=await fetchImpl(base+route,{method:'GET',headers:{Accept:'application/json',Authorization:token},redirect:'error',signal:controller.signal});
      const entry={requestIndex:index+1,method:'GET',path:route,status:response.status??null,contentType:response.headers?.get?.('content-type')??null,ok:response.status===200,rawBodyLength:0,responseSha256:sha256(bytes)};
      try{
        bytes=Buffer.from(await response.arrayBuffer());
        entry.rawBodyLength=bytes.length;
        entry.responseSha256=sha256(bytes);
      }catch(error){
        entry.ok=false;
        entry.error='BODY_READ_FAILED';
        audit.push(entry);
        failures.push({path:route,category:'BODY',reasons:['BODY_READ_FAILED']});
        continue;
      }
      audit.push(entry);
      if(response.status!==200){
        failures.push({path:route,category:'HTTP',reasons:[`HTTP_${String(response.status??'UNKNOWN')}`]});
        continue;
      }
      try{
        actualValues[route]=JSON.parse(bytes.toString('utf8'));
      }catch(error){
        entry.ok=false;
        entry.error='INVALID_JSON';
        failures.push({path:route,category:'JSON',reasons:['INVALID_JSON']});
      }
    }catch(error){
      const reason=error?.name==='AbortError'?'TIMEOUT':'FETCH_FAILED';
      audit.push({requestIndex:index+1,method:'GET',path:route,status:null,contentType:null,ok:false,rawBodyLength:bytes.length,responseSha256:sha256(bytes),error:reason});
      failures.push({path:route,category:'FETCH',reasons:[reason]});
    }finally{
      clearTimeout(timer);
    }
  }
  return {tokenUsed:Boolean(token),realHTTP0:Boolean(realHTTP0)};
}

function addFailure(failures,pathValue,category,reasons){
  if(reasons.length)failures.push({path:pathValue,category,reasons});
}

function compareCurrent({planTargets,requests,baseline,paths,actualValues,failures}){
  const targetLists=new Map();
  for(const {target} of requests){
    if(!target.collection)continue;
    const listPath=`/skills/${target.skillKey}/${target.collection}`;
    const list=targetLists.get(listPath)??{path:listPath,skillKey:target.skillKey,collection:target.collection,stableField:collectionIds[target.collection],targets:[]};
    list.targets.push({detailPath:target.route,stableKey:target.stableKey,description:target.description});
    targetLists.set(listPath,list);
  }
  const targetDetails=new Map([...planTargets.entries()]);
  const changedDetails={};
  const detailEvidence=[];
  const listEvidence=[];
  const unchangedPaths=[];
  let unchangedPass=0;
  for(const route of paths){
    if(!Object.hasOwn(actualValues,route))continue;
    const expected=baseline.values[route];
    const actual=actualValues[route];
    const target=targetDetails.get(route);
    if(target){
      const reasons=differenceExcept(expected,actual,new Set(['description','updatedAt']));
      const detailReasons=[];
      if(!isObject(actual))detailReasons.push('detail_not_object');
      else{
        if(actual.description!==target.description)detailReasons.push('description_not_approved');
        if(actual.createdAt!==expected.createdAt)detailReasons.push('createdAt_changed');
        if(!validIso(actual.updatedAt))detailReasons.push('updatedAt_invalid');
      }
      reasons.push(...detailReasons);
      addFailure(failures,route,'TARGET_DETAIL',reasons);
      const detailPass=reasons.length===0;
      detailEvidence.push({path:route,kind:target.kind,descriptionMatchesApproved:actual?.description===target.description,createdAtUnchanged:actual?.createdAt===expected?.createdAt,updatedAtValid:validIso(actual?.updatedAt),updatedAtChanged:actual?.updatedAt!==expected?.updatedAt,updatedAtAfterBaseline:isLater(actual?.updatedAt,expected?.updatedAt),pass:detailPass});
      if(detailPass)changedDetails[route]=actual;
      continue;
    }
    const list=targetLists.get(route);
    if(list){
      const reasons=[];
      if(!Array.isArray(expected)||!Array.isArray(actual))reasons.push('list_not_array');
      else{
        if(expected.length!==actual.length)reasons.push('list_length_changed');
        const expectedKeys=expected.map(row=>row?.[list.stableField]);
        const actualKeys=actual.map(row=>row?.[list.stableField]);
        if(!sameValue(expectedKeys,actualKeys))reasons.push('stable_key_sequence_changed');
        for(let index=0;index<Math.min(expected.length,actual.length);index+=1){
          const expectedRow=expected[index];
          const actualRow=actual[index];
          const targetRow=list.targets.find(item=>item.stableKey===actualRow?.[list.stableField]);
          if(!targetRow){
            if(!sameValue(expectedRow,actualRow))reasons.push(`[${index}]other_row_changed`);
            continue;
          }
          if(!isObject(expectedRow)||!isObject(actualRow)){
            reasons.push(`[${index}]target_row_not_object`);
            continue;
          }
          const rowReasons=differenceExcept(expectedRow,actualRow,new Set(['description','updatedAt']));
          if(actualRow.description!==targetRow.description)rowReasons.push(`[${index}]description_not_approved`);
          if(actualRow.createdAt!==expectedRow.createdAt)rowReasons.push(`[${index}]createdAt_changed`);
          if(!validIso(actualRow.updatedAt))rowReasons.push(`[${index}]updatedAt_invalid`);
          const detail=actualValues[targetRow.detailPath];
          if(!detail||actualRow.description!==detail.description)rowReasons.push(`[${index}]description_detail_mismatch`);
          if(!detail||actualRow.updatedAt!==detail.updatedAt)rowReasons.push(`[${index}]updatedAt_detail_mismatch`);
          reasons.push(...rowReasons);
        }
        for(const targetRow of list.targets){
          const count=actualKeys.filter(key=>key===targetRow.stableKey).length;
          if(count!==1)reasons.push(`${targetRow.stableKey}_missing_or_duplicated`);
        }
      }
      const targetEvidence=list.targets.map(targetRow=>{
        const row=Array.isArray(actual)?actual.find(item=>item?.[list.stableField]===targetRow.stableKey):null;
        const detail=actualValues[targetRow.detailPath];
        return {stableKey:targetRow.stableKey,detailPath:targetRow.detailPath,descriptionMatchesDetail:row?.description===detail?.description,updatedAtMatchesDetail:row?.updatedAt===detail?.updatedAt,pass:row?.description===detail?.description&&row?.updatedAt===detail?.updatedAt};
      });
      const pass=reasons.length===0;
      addFailure(failures,route,'TARGET_LIST',reasons);
      listEvidence.push({path:route,targets:targetEvidence,pass});
      continue;
    }
    unchangedPaths.push(route);
    if(sameValue(expected,actual))unchangedPass+=1;
    else addFailure(failures,route,'UNCHANGED',['structural_difference']);
  }
  const changedDetailPass=detailEvidence.filter(item=>item.pass).length;
  const changedListPass=listEvidence.filter(item=>item.pass).length;
  return {targetLists,changedDetails,detailEvidence,listEvidence,unchangedPaths,unchangedPass,changedDetailPass,changedListPass};
}

function statusCounts(audit){
  const counts={};
  for(const entry of audit){
    const key=entry.status===null||entry.status===undefined?'FETCH_FAILED':String(entry.status);
    counts[key]=(counts[key]??0)+1;
  }
  return counts;
}

export async function runReadback({batchDir,fetchImpl=globalThis.fetch,io=defaultIo,realHTTP0=false}={}){
  let selfSHA;
  try{selfSHA=sha256File(io,executor);}catch{selfSHA=sha256(fs.readFileSync(executor));}
  const report=initialReport(selfSHA,realHTTP0);
  let batch;
  try{
    batch=checkBatchDir(batchDir);
    const read=(name,label=name)=>parseJson(io,routeForFile(batch,name),label);
    const plan=read(requiredBatchFiles.plan,'01-纠错计划.json');
    const freeze=read(requiredBatchFiles.freeze,'02-冻结请求.json');
    const sources=read(requiredBatchFiles.sources,'03-来源摘要.json');
    const baseline=read(requiredBatchFiles.baseline,'04-写入前现值.json');
    const review=read(requiredBatchFiles.review,'05-独立评审.json');
    const write=read(requiredBatchFiles.write,'06-写入与即时回读.json');
    const fileHashes={
      [writerPath]:sha256File(io,path.join(web,writerPath)),
      [requiredBatchFiles.plan]:sha256File(io,routeForFile(batch,requiredBatchFiles.plan)),
      [requiredBatchFiles.freeze]:sha256File(io,routeForFile(batch,requiredBatchFiles.freeze)),
      [requiredBatchFiles.sources]:sha256File(io,routeForFile(batch,requiredBatchFiles.sources)),
      [requiredBatchFiles.baseline]:sha256File(io,routeForFile(batch,requiredBatchFiles.baseline))
    };
    const approvedShaChecks=[];
    fail(isObject(review)&&review.status==='APPROVED','05独立评审必须为APPROVED');
    fail(isObject(review.approvedFiles),'05.approvedFiles必须是对象');
    for(const file of approvedFiles){
      const expected=review.approvedFiles[file];
      const actual=fileHashes[file];
      const matches=expected===actual;
      approvedShaChecks.push({path:file,expectedSha256:expected,actualSha256:actual,matches});
      fail(matches,`批准文件摘要不匹配：${file}`);
    }
    fail(fileHashes[writerPath]===lockedWriterSha256,'当前v2写入器摘要不是锁定版本');
    const planTargets=validatePlan(plan);
    fail(Array.isArray(sources),'03必须是来源数组');
    const sourceShaChecks=sourceChecks(io,plan,sources);
    const baselinePaths=validateBaseline(baseline);
    const sourceSha=sha256File(io,routeForFile(batch,requiredBatchFiles.sources));
    const baselineSha=sha256File(io,routeForFile(batch,requiredBatchFiles.baseline));
    const requests=validateFrozen(planTargets,freeze,baseline,sourceSha,baselineSha);
    const requestRoutes=requests.map(item=>item.request.route);
    validateWriteReport(write,requests.length,requestRoutes);
    const targetListPaths=new Set(requests.filter(item=>item.target.collection).map(item=>`/skills/${item.target.skillKey}/${item.target.collection}`));
    const unchangedExpected=baselinePaths.filter(route=>!planTargets.has(route)&&!targetListPaths.has(route));
    report.preflight={
      batchDir:batch,
      reviewStatus:review.status,
      writerPath,
      lockedWriterSha256,
      approvedShaChecks,
      sourceShaChecks,
      freezeSourceSha256Matches:freeze.sourceSha256===sourceSha,
      freezeBaselineSha256Matches:freeze.baselineSha256===baselineSha,
      baselineBase:baseline.base,
      baselinePathCount:baselinePaths.length,
      baselineAuditCount:baseline.audit.length,
      writeStatus:write.status,
      writeBusinessWritesAttempted:write.businessWritesAttempted,
      targetRoutes:requestRoutes
    };
    report.expectedChangedCollections=targetListPaths.size;
    report.counts.requestedGETs=baselinePaths.length;
    report.counts.targetDetailPaths=planTargets.size;
    report.counts.targetListPaths=targetListPaths.size;
    report.counts.unchangedPathsExpected=unchangedExpected.length;
    const actualValues={};
    const audit=[];
    const failures=[];
    await readCurrentValues({fetchImpl,paths:baselinePaths,actualValues,audit,failures,realHTTP0});
    report.values=actualValues;
    report.audit=audit;
    report.GETs=audit.length;
    report.counts.completedGETs=audit.length;
    report.counts.successfulJSONResponses=Object.keys(actualValues).length;
    report.counts.statusCounts=statusCounts(audit);
    const comparison=compareCurrent({planTargets,requests,baseline,paths:baselinePaths,actualValues,failures});
    report.changedDetails=comparison.changedDetails;
    report.unchangedResponsesIncludingTimestamps=comparison.unchangedPass;
    report.counts.unchangedResponsesIncludingTimestamps=comparison.unchangedPass;
    report.counts.unchangedPathsPass=comparison.unchangedPass;
    report.counts.changedDetailPass=comparison.changedDetailPass;
    report.counts.changedListPass=comparison.changedListPass;
    report.counts.expectedChangedCollections=targetListPaths.size;
    report.detailEvidence=comparison.detailEvidence;
    report.collectionEvidence=comparison.listEvidence;
    report.unchangedPaths=unchangedExpected;
    report.failures=failures;
    report.counts.failureCount=failures.length;
    report.status=failures.length===0&&Object.keys(actualValues).length===baselinePaths.length?'PASS':'FAIL';
    return report;
  }catch(error){
    report.failures=[{path:null,category:error?.category??'PREFLIGHT',reasons:[failureMessage(error)]}];
    report.error=failureMessage(error);
    report.counts.failureCount=1;
    return report;
  }
}

const isMain=process.argv[1]&&path.resolve(process.argv[1])===executor;
if(isMain){
  const report=await runReadback({batchDir:process.argv[2],fetchImpl:globalThis.fetch,io:defaultIo,realHTTP0:false});
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if(report.status!=='PASS')process.exitCode=1;
}
