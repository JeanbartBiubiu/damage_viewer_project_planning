import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const read=file=>JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));
const save=(file,data)=>fs.writeFileSync(path.join(dir,file),JSON.stringify(data,null,2)+'\n');
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const candidate=read('候选与来源.json');
const apply=process.argv.includes('--apply'),verify=process.argv.includes('--verify');
assert.ok(!(apply&&verify));
const run={startedAt:new Date().toISOString(),mode:apply?'只补缺项':verify?'独立最终GET':'写前只读',sourceChecks:[],writes:[]};
for(const source of candidate.sources){
  const actual=sha(fs.readFileSync(path.join(root,source.relativePath)));
  assert.equal(actual,source.sha256,source.relativePath);
  run.sourceChecks.push({relativePath:source.relativePath,sha256:actual});
}
const base='http://127.0.0.1:8080/api/admin/games/lol';
async function api(route,method='GET',body){
  assert.ok(method==='GET'||apply,'只读入口禁止写');
  const response=await fetch(base+route,{method,headers:{Authorization:'Bearer local-entry','Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
  const result={status:response.status,body:await response.json()};
  assert.ok(response.ok||response.status===404||method!=='GET',`${route} ${response.status}`);
  return result;
}
async function list(route){
  const rows=[];let total;
  for(let page=1;page<100;page++){
    const response=await api(`${route}?page=${page}&pageSize=200`);
    assert.equal(response.status,200);total=response.body.total;rows.push(...response.body.items);
    if(rows.length>=total)break;
    assert.ok(response.body.items.length>0);
  }
  assert.equal(rows.length,total,route);return rows;
}
const catalog=await list('/attributes');
const equipment=await list('/equipment');
for(const item of candidate.objects){
  for(const key of Object.keys(item.attributeValues))assert.ok(catalog.some(x=>x.attributeKey===key&&x.enabled!==false),key);
  assert.deepEqual(equipment.filter(x=>x.name.trim()===item.name&&x.equipmentKey!==item.equipmentKey),[],`同名别键 ${item.name}`);
}
const imageChecks=[];
for(const item of candidate.objects){
  const response=await api(`/images/${item.imageKey}`);assert.equal(response.status,200);
  const {imageBase64,...metadata}=response.body;
  const payload=imageBase64.startsWith('data:')?imageBase64.slice(imageBase64.indexOf(',')+1):imageBase64;
  const bytes=Buffer.from(payload,'base64');
  assert.equal(metadata.imageKey,item.imageKey);assert.equal(metadata.enabled,true);
  assert.equal(metadata.mimeType,'image/png');assert.equal(metadata.width,64);assert.equal(metadata.height,64);
  assert.equal(bytes.length,metadata.byteSize);assert.ok(bytes.length>0);
  imageChecks.push({metadata,contentSha256:sha(bytes),note:'复用既有图片，内容与元数据已核对；未声称与16.17图片原文件逐字节相同。'});
}
run.preflight={catalog,equipment,imageChecks};
function expectedSubject(item){return {equipmentKey:item.equipmentKey,name:item.name,description:item.description};}
function subjectMatches(actual,expected){return Object.entries(expected).every(([k,v])=>actual[k]===v);}
async function snapshot(){
  const objects=[];
  for(const item of candidate.objects){
    const subject=await api(`/equipment/${item.equipmentKey}`);
    if(subject.status===404){objects.push({equipmentKey:item.equipmentKey,subject,complete:false});continue;}
    assert.ok(subjectMatches(subject.body,expectedSubject(item)),`现有主体冲突 ${item.equipmentKey}`);
    const [attributes,image,relations]=await Promise.all([
      api(`/equipment/${item.equipmentKey}/attributes`),api(`/equipment/${item.equipmentKey}/representative-image`),
      api(`/equipment-skill-relations?equipmentKey=${item.equipmentKey}&page=1&pageSize=200`),
    ]);
    assert.equal(attributes.status,200);assert.equal(image.status,200);assert.equal(relations.status,200);
    const values=attributes.body.attributeValues;
    for(const [key,value] of Object.entries(item.attributeValues)){
      if(Object.hasOwn(values,key)) assert.equal(values[key],value,`${item.equipmentKey}/${key}`);
    }
    if(image.body.image)assert.equal(image.body.image.imageKey,item.imageKey,`代表图冲突 ${item.equipmentKey}`);
    const complete=Object.entries(item.attributeValues).every(([k,v])=>values[k]===v)&&image.body.image?.imageKey===item.imageKey&&image.body.image.enabled===true;
    objects.push({equipmentKey:item.equipmentKey,subject,attributes,image,relations,complete});
  }
  return {at:new Date().toISOString(),objects,complete:objects.every(x=>x.complete)};
}
run.before=await snapshot();
if(!fs.existsSync(path.join(dir,'首次写前现值.json')))fs.writeFileSync(path.join(dir,'首次写前现值.json'),JSON.stringify(run,null,2)+'\n',{flag:'wx'});
async function writeThenRead(route,method,body,matches){
  const record={at:new Date().toISOString(),route,method,request:body};
  try{record.response=await api(route,method,body);}catch(error){record.error=String(error);}
  const readRoute=method==='POST'?`${route}/${body.equipmentKey}`:route;
  record.independentReadback=await api(readRoute);
  record.passed=record.independentReadback.status===200&&matches(record.independentReadback.body);
  fs.appendFileSync(path.join(dir,'写入流水.jsonl'),JSON.stringify(record)+'\n');
  run.writes.push(record);assert.equal(record.passed,true,`${method} ${route}`);
}
if(apply){
  for(const item of candidate.objects){
    const route=`/equipment/${item.equipmentKey}`,expected=expectedSubject(item);
    const before=await api(route);
    if(before.status===404)await writeThenRead('/equipment','POST',expected,x=>subjectMatches(x,expected));
    else assert.ok(subjectMatches(before.body,expected));
    const beforeAttributes=await api(`${route}/attributes`);assert.equal(beforeAttributes.status,200);
    const current=beforeAttributes.body.attributeValues;
    for(const [key,value] of Object.entries(item.attributeValues))if(Object.hasOwn(current,key))assert.equal(current[key],value);
    const merged={...current,...item.attributeValues};
    if(!Object.entries(merged).every(([k,v])=>current[k]===v)){
      await writeThenRead(`${route}/attributes`,'PUT',{attributeValues:merged},x=>{
        assert.deepEqual(x.attributeValues,merged);return true;
      });
    }
    const beforeImage=await api(`${route}/representative-image`);assert.equal(beforeImage.status,200);
    if(!beforeImage.body.image)await writeThenRead(`${route}/representative-image`,'PUT',{imageKey:item.imageKey},x=>x.image?.imageKey===item.imageKey&&x.image.enabled===true);
    else assert.equal(beforeImage.body.image.imageKey,item.imageKey);
  }
}
run.final=await snapshot();
run.completedAt=new Date().toISOString();
run.counts={subjects:5,attributeValues:15,representativeImageReuses:5,actualWrites:run.writes.length,completeSubjects:run.final.objects.filter(x=>x.complete).length};
run.passed=run.final.complete;
save(apply?'写入结果.json':verify?'独立最终回读.json':'当前只读检查.json',run);
if(apply||verify)assert.equal(run.passed,true);
console.log(JSON.stringify({mode:run.mode,...run.counts,passed:run.passed}));
