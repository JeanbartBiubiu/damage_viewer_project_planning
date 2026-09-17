import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
if(process.argv.length!==2)throw Error('只读准备，不写业务');
const here=path.dirname(fileURLToPath(import.meta.url)),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
if(fs.existsSync(path.join(here,'最终请求.json')))throw Error('最终请求已冻结，不覆盖');
const oldBytes=fs.readFileSync(path.join(here,'可审查请求.json'));assert.equal(sha(oldBytes),'f142aa7fdb7b58ee5648ad6d02e94d72aa648cc064abf998fd4da73816394305');
assert.equal(sha(fs.readFileSync(path.join(here,'可审查候选.json'))),'78f899001fd93c3b208bfbbb22d9408919c3ba8b6c17f53a1e5684924fddab73');
const old=JSON.parse(oldBytes),proposals=JSON.parse(fs.readFileSync(path.join(here,'可审查候选.json'))).proposals,token=process.env.RUNE4_API_TOKEN;assert.ok(token);
const reads=[];
async function get(route){const r=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{method:'GET',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});const data=await r.json();assert.ok([200,404].includes(r.status),route);return{route,status:r.status,data};}
function sanitizeImage(image){const x=structuredClone(image);assert.equal(typeof x.imageBase64,'string');const bytes=Buffer.from(x.imageBase64.includes(',')?x.imageBase64.split(',').at(-1):x.imageBase64,'base64');assert.ok(bytes.length);delete x.imageBase64;return{metadata:x,bytes:bytes.length,contentSha256:sha(bytes)};}
const kinds=['parameters','formulas','effects','processes','internal-states','trigger-rules'];
const identities=await get('/runes'),layouts=await get('/rune-paths');assert.equal(identities.status,200);assert.equal(layouts.status,200);
const owners=[],images=[];
for(const p of proposals){
 const rune=await get('/runes/'+p.runeKey);assert.equal(rune.status,200);const skill=await get('/skills/'+p.skillKey),sourceImage=await get('/runes/'+p.runeKey+'/representative-image');assert.equal(sourceImage.status,200);assert.equal(sourceImage.data.image?.enabled,true);
 const imageKey=sourceImage.data.image.imageKey,image=await get('/images/'+imageKey);assert.equal(image.status,200);const frozenImage=sanitizeImage(image.data),usages=await get('/images/'+imageKey+'/usages');assert.equal(usages.status,200);assert.ok(usages.data.runes.some(r=>r.runeKey===p.runeKey));
 const skillImage=await get('/skills/'+p.skillKey+'/representative-image');if(skillImage.status===200&&skillImage.data.image)assert.equal(skillImage.data.image.imageKey,imageKey,'已有不同图不覆盖');
 const existing={};for(const kind of kinds){if(skill.status===404){existing[kind]=[];continue;}const list=await get(`/skills/${p.skillKey}/${kind}`);assert.equal(list.status,200);assert.ok(Array.isArray(list.data));const key={parameters:'parameterKey',formulas:'formulaKey',effects:'effectKey',processes:'processKey','internal-states':'stateKey','trigger-rules':'ruleKey'}[kind];existing[kind]=[];for(const row of list.data){const detail=await get(`/skills/${p.skillKey}/${kind}/${row[key]}`);assert.equal(detail.status,200);existing[kind].push(detail.data);}}
 owners.push({id:p.id,runeKey:p.runeKey,skillKey:p.skillKey,rune:rune.data,skill:skill.status===200?skill.data:null,existing,sourceImage:sourceImage.data,skillImage:skillImage.status===200?skillImage.data:null,imageKey,image:frozenImage,usagesBefore:usages.data});
 images.push({id:p.id,skillKey:p.skillKey,kind:'image',method:'PUT',route:`/skills/${p.skillKey}/representative-image`,readRoute:`/skills/${p.skillKey}/representative-image`,body:{imageKey}});
 reads.push({runeKey:p.runeKey,skillStatus:skill.status,imageKey,sourceImageVerified:true,contentSha256:frozenImage.contentSha256});
}
const removed=[];const requests=old.requests.map(r=>({...r,method:'POST'}));assert.equal(requests.length,120);assert.equal(images.length,12);
const result={generatedAt:new Date().toISOString(),originalRequestSha256:sha(oldBytes),change:'120项主体、明确数值和独立组成保持审查候选原样；12代表图仅复用现有图键，不上传。',scope:proposals.map(p=>({id:p.id,runeKey:p.runeKey,skillKey:p.skillKey,name:p.name})),requests:[...requests,...images],counts:{content:120,images:12,total:132}};
const finalBytes=JSON.stringify(result,null,2)+'\n';fs.writeFileSync(path.join(here,'最终请求.json'),finalBytes);fs.writeFileSync(path.join(here,'保护基线.json'),JSON.stringify({at:result.generatedAt,identities:identities.data,layouts:layouts.data,owners,reads,businessWrites:0},null,2)+'\n');fs.writeFileSync(path.join(here,'最终请求版本.json'),JSON.stringify({finalSha256:sha(finalBytes),originalRequestSha256:sha(oldBytes),baselineSha256:sha(fs.readFileSync(path.join(here,'保护基线.json'))),removed:removed.map(r=>({route:r.readRoute,value:r.body.fixedValue})),counts:result.counts},null,2)+'\n');console.log(JSON.stringify({counts:result.counts,finalSha256:sha(finalBytes),existingSkills:owners.filter(o=>o.skill).length,writes:0}));
