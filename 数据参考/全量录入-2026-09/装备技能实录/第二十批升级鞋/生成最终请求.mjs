import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const CANDIDATE_PATH=path.join(HERE,'最终候选.json');
const SOURCE_PATH=path.join(HERE,'冻结来源.json');
const BEFORE_PATH=path.join(HERE,'写前保护快照.json');
const OUTPUT_PATH=path.join(HERE,'最终请求.json');
function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function sha(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function clone(value){return structuredClone(value);}
function fail(msg){throw new Error(msg);}
const candidate=readJson(CANDIDATE_PATH);
const source=readJson(SOURCE_PATH);
const before=readJson(BEFORE_PATH);
const candidateSha=sha(CANDIDATE_PATH),sourceSha=sha(SOURCE_PATH),beforeSha=sha(BEFORE_PATH);
const selected=candidate.objects.map(object=>({equipmentKey:object.equipmentKey,skillKey:object.skillKey}));
if(selected.length!==5) fail('候选技能数量不是5');
const requests=[];
for(const object of candidate.objects){
 const skillPath='/skills/'+encodeURIComponent(object.skillKey);
 requests.push({kind:'skill',equipmentKey:object.equipmentKey,skillKey:object.skillKey,method:'POST',route:'/skills',readRoute:skillPath,body:clone(object.apiPayload.skill)});
 for(const body of object.apiPayload.parameters??[]) requests.push({kind:'parameters',equipmentKey:object.equipmentKey,skillKey:object.skillKey,method:'POST',route:skillPath+'/parameters',readRoute:skillPath+'/parameters/'+encodeURIComponent(body.parameterKey),body:clone(body)});
 for(const body of object.apiPayload.formulas??[]) requests.push({kind:'formulas',equipmentKey:object.equipmentKey,skillKey:object.skillKey,method:'POST',route:skillPath+'/formulas',readRoute:skillPath+'/formulas/'+encodeURIComponent(body.formulaKey),body:clone(body)});
 for(const kind of ['effects','processes','internalStates','triggerRules']) if((object.apiPayload[kind]??[]).length) fail(`${object.skillKey}不应生成${kind}`);
 const relation=clone(object.apiPayload.relation);
 requests.push({kind:'relation',equipmentKey:object.equipmentKey,skillKey:object.skillKey,method:'POST',route:'/equipment-skill-relations',readRoute:'/equipment-skill-relations?equipmentKey='+encodeURIComponent(object.equipmentKey),body:relation});
 requests.push({kind:'image',equipmentKey:object.equipmentKey,skillKey:object.skillKey,method:'PUT',route:skillPath+'/representative-image',readRoute:skillPath+'/representative-image',body:clone(object.apiPayload.representativeImage)});
}
const requestSummary=Object.fromEntries(['skill','parameters','formulas','relation','image'].map(kind=>[kind,requests.filter(x=>x.kind===kind).length]));
requestSummary.total=requests.length;
const expected={skill:5,parameters:32,formulas:5,relation:5,image:5,total:52};
if(JSON.stringify(requestSummary)!==JSON.stringify(expected)) fail(`请求计数错误：${JSON.stringify(requestSummary)}`);
if(requests.some(x=>x.kind==='skill'&&JSON.stringify(x.body.skillCategoryKeys)!==JSON.stringify(['passive']))) fail('存在非passive技能分类');
const output={
 generatedAt:new Date().toISOString(),
 stage:'独立候选审查后最终请求草稿，未写业务',
 gameId:'lol',
 apiBaseUrl:'http://127.0.0.1:8080/api/admin/games/lol',
 clientVersion:candidate.clientVersion,
 officialVersion:candidate.officialVersion,
 gameSourceBuild:candidate.gameSourceBuild,
 authHeaderPersisted:false,
 noApply:true,
 apiWrites:0,
 candidateSha256:candidateSha,
 sourceSha256:sourceSha,
 beforeSha256:beforeSha,
 candidatePath:'最终候选.json',
 sourcePath:'冻结来源.json',
 beforePath:'写前保护快照.json',
 scope:selected,
 requestSummary,
 requests,
 pendingTargetQualifications:candidate.pendingTargetQualifications??[],
};
if(fs.existsSync(OUTPUT_PATH)) fail(`最终请求已存在：${OUTPUT_PATH}`);
fs.writeFileSync(OUTPUT_PATH,JSON.stringify(output,null,2)+'\n','utf8');
console.log(JSON.stringify({outputPath:OUTPUT_PATH,requestSha256:sha(OUTPUT_PATH),candidateSha256:candidateSha,sourceSha256:sourceSha,beforeSha256:beforeSha,requestSummary,apiWrites:0}));
