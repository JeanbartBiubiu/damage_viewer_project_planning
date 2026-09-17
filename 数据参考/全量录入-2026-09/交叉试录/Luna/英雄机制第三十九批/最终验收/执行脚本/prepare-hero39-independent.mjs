import fs from 'node:fs';import assert from 'node:assert/strict';
const a='C:/project/damage_web_dev/.agents/artifacts',r=a+'/hero39-independent-review',m=a+'/hero39-independent-source-math';assert(!fs.existsSync(r));assert(!fs.existsSync(m));fs.mkdirSync(r);fs.mkdirSync(m);
let s=fs.readFileSync(a+'/hero38-independent-review/独立回读-实际GET.mjs','utf8').replaceAll('hero38','hero39').replaceAll('HERO38','HERO39').replace("|| ''","|| '修订一'").replaceAll('2f03daad0fc690bb96164e1a92da5c62977a842dcb59c85cf45484e88d9587eb','b79197a5ca3d1762bdbc5955871d4c17e6923274e318913cf8843481254122c8').replaceAll('90e673a8cc1f0475eb0bbf518e05f04168eb20f59c46a49e16ce4158532e319b','a0e64ff436968bad1fd401054b7fb6090638c378dde0da9659f52f58ba1b44b7');
for(const[x,y]of [['193','215'],['218','245'],['197','202'],['415','447']])s=s.replaceAll(x,y);
s=s.replaceAll('!== 25','!== 30').replaceAll('reusedDetails: 25','reusedDetails: 30').replaceAll('为25项','为30项').replaceAll('增加25项','增加30项');
fs.writeFileSync(r+'/独立回读-实际GET.mjs',s,{flag:'wx'});
let t=fs.readFileSync(a+'/hero39-luna-candidate/修订一/独立源值数学.mjs','utf8').replace('const INPUT = path.resolve(ROOT, "..", "..", "hero39-root-entry-20260910");','const INPUT = "C:/project/damage_web_dev/.agents/artifacts/hero39-root-entry-20260910";').replace('const candidatePath = path.join(ROOT, "完整候选.json");','const candidatePath = "C:/project/damage_web_dev/.agents/artifacts/hero39-luna-candidate/修订一/完整候选.json";');
const hydrate=[
"const getPath=process.env.HERO39_GET_REPORT;if(!getPath)throw new Error('必须提供独立GET快照');const actualGet=JSON.parse(fs.readFileSync(getPath));if(actualGet.status!=='PASS'||actualGet.actual.calls!==447||actualGet.candidateSha256!==candidateFileSha256)throw new Error('独立GET未通过或散列不符');",
"const actual=new Map(actualGet.rawResponses.map(x=>[x.route,x.data]));let actualHydrated=0;",
"for(const[k,sk]of Object.entries(candidate.skills))for(const[kind,id]of [['parameters','parameterKey'],['formulas','formulaKey'],['effects','effectKey']])sk.write[kind]=sk.write[kind].map(p=>{const route='/skills/'+k+'/'+kind+'/'+p[id];if(!actual.has(route))throw new Error('缺少真实详情'+route);actualHydrated++;return actual.get(route);});if(actualHydrated!==215)throw new Error('实际组成数不符');",
"const sourceSkills = new Map("
].join('\n');
t=t.replace('const sourceSkills = new Map(',hydrate);
t=t.replace('const report = {','const report = {\n  actualHydrated,actualGETFile:getPath,actualGETSha256:sha256(fs.readFileSync(getPath)),').replace('实际侧读取候选JSON中的参数和表达式；','实际侧读取独立447GET快照中的真实参数和表达式；').replace('候选静态表达式的实际代入核对','真实GET详情的静态表达式代入核对');
fs.writeFileSync(m+'/实际公式数学.mjs',t,{flag:'wx'});
console.log(JSON.stringify({prepared:true,GETs:447,mathGETs:0}));
