import fs from 'node:fs';
import crypto from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
const here=new URL('./',import.meta.url),read=n=>JSON.parse(fs.readFileSync(new URL(n,here),'utf8'));
const candidateBytes=fs.readFileSync(new URL('完整候选.json',here)),candidate=JSON.parse(candidateBytes),apply=read('写入结果.json'),verify=read('独立全量回读.json'),original=read('写前现值.json');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
if(sha(candidateBytes)!=='d4856e5e8914e8a02c8d02a264c1e84acc84171d8733f434db345ef69b28bc0e')throw Error('冻结候选变化');
const knownComparisonIssue=apply.errors.length===1&&apply.errors[0].finalFailures===5&&apply.verification.failures.length===5&&apply.verification.failures.every(f=>f.name.startsWith('特朗德尔完整写对象原样复用 '))&&read('实值核算顺序误判证据.json').failures.every(f=>f.kinds.every(k=>k.matched));
if(apply.errors.length&&!knownComparisonIssue||!verify.success||verify.snapshot.missing.length||verify.snapshot.conflicts.length)throw Error('先处理写入或回读失败，不输出成功');
const written=apply.events.filter(e=>e.postStatus>=200&&e.postStatus<300&&e.match),reconciled=apply.events.filter(e=>e.action==='创建响应异常后查询落地'&&e.match),byKind=written.reduce((a,e)=>{a[e.kind]=(a[e.kind]??0)+1;return a;},{});
if(written.length!==161||byKind.parameters!==112||byKind.formulas!==34||byKind.effects!==15||reconciled.length)throw Error('最终写数与本次批准/预期不同，需明确核对');
const protectedComponents=[];
for(const[key,s]of Object.entries(original.skills))for(const[kind,comp]of Object.entries(s.components))for(const old of comp.details){const now=verify.snapshot.readbacks.find(r=>r.skillKey===key&&r.kind===kind&&r.id===old.key);protectedComponents.push({skillKey:key,kind,key:old.key,unchanged:equal(now?.actual,old.detail.data)});}
if(!protectedComponents.every(r=>r.unchanged))throw Error('保护组成发生变化');
const used={attributes:new Set(),'modifier-zones':new Set(),'damage-types':new Set(),statuses:new Set()},fields={attributeKey:'attributes',modifierZoneKey:'modifier-zones',damageTypeKey:'damage-types',statusKey:'statuses'};
function walk(x){if(!x||typeof x!=='object')return;for(const[k,v]of Object.entries(x)){if(fields[k]&&typeof v==='string')used[fields[k]].add(v);if(v&&typeof v==='object')walk(v);}}
for(const s of Object.values(candidate.skills))walk(s.write);
const catalogProtection=[];
for(const[name,keys]of Object.entries(used)){const id=apply.catalogs.catalogs[name].id;for(const key of keys){const before=apply.catalogs.catalogs[name].items.find(x=>x[id]===key),after=verify.catalogs.catalogs[name].items.find(x=>x[id]===key);catalogProtection.push({catalog:name,key,unchanged:equal(before,after)});}}
if(!catalogProtection.every(r=>r.unchanged))throw Error('已引用目录对象发生变化');
const final={finishedAt:new Date().toISOString(),status:'已录入确定集合并独立回读通过',candidateFileSha256:sha(candidateBytes),candidateObjectSha256:sha(JSON.stringify(candidate)),applyRun:apply.runId,independentReadRun:verify.runId,created:written.length,createdByKind:byKind,reconciledAfterUnknownResponse:reconciled.length,reused:protectedComponents.length,reusedPublicParameters:protectedComponents.filter(x=>!x.skillKey.startsWith('trundle_')).length,trundleProtectedComponents:protectedComponents.filter(x=>x.skillKey.startsWith('trundle_')).length,finalTotals:verify.snapshot.totals,readback:{subjects:verify.snapshot.subjects.length,collections:verify.snapshot.lists.length,details:verify.snapshot.readbacks.length,images:verify.snapshot.images.length,relations:verify.snapshot.relations.length,catalogs:4,httpGetCount:4+verify.snapshot.subjects.length+verify.snapshot.lists.length+verify.snapshot.readbacks.length+verify.snapshot.images.length+verify.snapshot.relations.length,missing:verify.snapshot.missing.length,conflicts:verify.snapshot.conflicts.length,businessLeafFields:verify.verification.fields,formulaCases:verify.verification.arithmetic.length,checks:verify.verification.invariants.length},protectedComponents,catalogProtection,limits:['只完成确定组成；无新DAMAGE/DIRECT_HEAL/过程/触发规则。','五个等级项与其他未知属性/实际事件输入没有默认；缺输入不可直接计算。','易R/潘森Q/泰隆Q比例冷却只保存事实参数；潘森P六字段、E治疗及强化伤害树仅留资料。','页面验收和Git提交由主负责人完成；本批未修改主体、图、关系、目录或特朗德尔。']};
final.resolvedHistoricalCheckIssue=knownComparisonIssue?{count:5,kind:'核算脚本顺序误判',originalReport:'写入结果.json',evidence:'实值核算顺序误判证据.json',resolution:'按组成稳定键配对并逐字段比较；独立重新GET与1252项检查通过，未重放POST。'}:null;
fs.writeFileSync(new URL('最终结果.json',here),JSON.stringify(final,null,2)+'\n');
console.log(JSON.stringify({status:final.status,created:final.created,createdByKind:byKind,reused:final.reused,readback:final.readback,catalogProtected:catalogProtection.length,candidateFileSha256:final.candidateFileSha256}));
