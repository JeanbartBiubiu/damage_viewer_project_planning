import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const candidate=JSON.parse(fs.readFileSync(path.join(dir,'候选与来源.json'),'utf8'));
const apply=process.argv.includes('--apply');
assert.ok(process.argv.slice(2).every(x=>x==='--apply'));
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const base='http://127.0.0.1:8080/api/admin/games/lol';
const run={at:new Date().toISOString(),mode:apply?'补缺图片':'只读准备',objects:[],writes:0};
async function api(route,method='GET',body){
  assert.ok(method==='GET'||apply);
  const response=await fetch(base+route,{method,headers:{Authorization:'Bearer local-entry','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  const data=await response.json();
  return {status:response.status,body:data};
}
function inspect(image){
  const {imageBase64,...metadata}=image;
  assert.equal(metadata.mimeType,'image/png');assert.equal(metadata.width,64);assert.equal(metadata.height,64);assert.equal(metadata.enabled,true);
  const bytes=Buffer.from(imageBase64.slice(imageBase64.indexOf(',')+1),'base64');
  assert.equal(bytes.length,metadata.byteSize);
  return {metadata,sha256:sha(bytes)};
}
fs.mkdirSync(path.join(dir,'来源图片'),{recursive:true});
for(const id of ['2010','2150','2152']){
  const item=candidate.objects.find(x=>x.itemId===id);assert.ok(item);
  const route=`/images/${item.imageKey}`;
  const before=await api(route);assert.ok([200,404].includes(before.status));
  const file=path.join(dir,'来源图片',`${id}.png`);
  const url=`https://ddragon.leagueoflegends.com/cdn/16.17.1/img/item/${id}.png`;
  if(!fs.existsSync(file)){
    const response=await fetch(url,{signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);
    const bytes=Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(bytes.readUInt32BE(16),64);assert.equal(bytes.readUInt32BE(20),64);
    fs.writeFileSync(file,bytes,{flag:'wx'});
  }
  const bytes=fs.readFileSync(file),expectedHash=sha(bytes);
  const imageName=`${item.name}（16.17.1）`;
  const options=await api(`/image-options?keyword=${encodeURIComponent(imageName)}`);assert.equal(options.status,200);
  assert.deepEqual(options.body.items.filter(x=>x.name===imageName&&x.imageKey!==item.imageKey),[],'同名图片已存在，须人工核对复用');
  const record={itemId:id,imageKey:item.imageKey,source:{url,relativePath:`来源图片/${id}.png`,sha256:expectedHash,byteSize:bytes.length},before:before.status===200?inspect(before.body):before};
  if(before.status===200){assert.equal(inspect(before.body).sha256,expectedHash);record.same=true;}
  else if(apply){
    const payload={imageKey:item.imageKey,name:imageName,description:`官方16.17.1装备${id}图标`,imageBase64:`data:image/png;base64,${bytes.toString('base64')}`};
    try{const response=await api('/images','POST',payload);record.responseStatus=response.status;if(response.status!==201&&response.status!==200)record.responseBody=response.body;}catch(error){record.error=String(error);}
    const actual=await api(route);assert.equal(actual.status,200);record.after=inspect(actual.body);assert.equal(record.after.sha256,expectedHash);assert.equal(record.after.metadata.imageKey,item.imageKey);
    run.writes++;fs.appendFileSync(path.join(dir,'图片写入流水.jsonl'),JSON.stringify(record)+'\n');
  }
  run.objects.push(record);
}
run.passed=run.objects.every(x=>x.same||x.after);
fs.writeFileSync(path.join(dir,apply?'图片写入结果.json':'图片当前只读检查.json'),JSON.stringify(run,null,2)+'\n');
console.log(JSON.stringify({mode:run.mode,objects:run.objects.length,writes:run.writes,passed:run.passed}));
