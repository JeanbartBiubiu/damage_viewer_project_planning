import {readFile,writeFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {objects,skippedObjects,compareFields,request} from './录入装备技能.mjs';
const kinds=[['parameters','parameterKey'],['formulas','formulaKey'],['effects','effectKey'],['processes','processKey'],['internal-states','stateKey'],['trigger-rules','ruleKey']];
const prop=k=>k==='trigger-rules'?'triggerRules':k==='internal-states'?'internalStates':k;
const report={startedAt:new Date().toISOString(),scope:'第四批6装备：5技能组成、5挂载、5代表图，1项只有直接属性不新增技能。仅独立只读回读。',skills:{},readbacks:[],checks:[],differences:[],missing:[],unexpected:[],sourceLimits:['旧2026-06 Wiki就绪10000毫秒已移出业务参数','DecayTime=25只保留原始字段，不推定护盾生命周期'],validationBoundary:'业务API独立回读与数值/语义核对；不是浏览器、战斗或Wasm运行验证。'};
const live={};
const ok=r=>r.status>=200&&r.status<300;
async function get(route){const r=await request('GET',route);if(!ok(r))throw Error('读取失败 '+route+' HTTP '+r.status);return r.data;}
function check(name,actual,expected){const equal=typeof actual==='number'&&typeof expected==='number'?Math.abs(actual-expected)<1e-9:isDeepStrictEqual(actual,expected);report.checks.push({name,actual,expected,equal});if(!equal)report.differences.push({name,actual,expected});}
for(const obj of objects){const key=obj.skill.skillKey,base='/skills/'+key;const sd=await get(base);const fields=compareFields(obj.skill,sd);report.readbacks.push({route:base,actual:sd,fields});report.differences.push(...fields.filter(x=>!x.equal).map(x=>({route:base,...x})));const summary={equipmentKey:obj.equipmentKey,name:obj.equipmentName,status:'部分录入，范围内待配未完成',counts:{},pending:obj.pendingRules};live[key]={};
 for(const[kind,idKey]of kinds){const list=await get(base+'/'+kind);if(!Array.isArray(list))throw Error('非数组列表');summary.counts[kind]=list.length;live[key][kind]={};const expected=obj[prop(kind)]??[];for(const item of list){const id=item[idKey],route=base+'/'+kind+'/'+id,actual=await get(route);live[key][kind][id]=actual;const target=expected.find(x=>x[idKey]===id);if(!target){report.unexpected.push(route);continue;}const rows=compareFields(target,actual);report.readbacks.push({route,actual,fields:rows});report.differences.push(...rows.filter(x=>!x.equal).map(x=>({route,...x})));}for(const e of expected)if(!live[key][kind][e[idKey]])report.missing.push(base+'/'+kind+'/'+e[idKey]);}
 const relationList=await get('/equipment-skill-relations?equipmentKey='+obj.equipmentKey);const arr=Array.isArray(relationList)?relationList:relationList.items;const relationship=arr.find(x=>x.skillKey===key);const rf=compareFields(obj.relation,relationship);report.readbacks.push({route:'equipment-skill-relations:'+obj.equipmentKey,actual:relationship,fields:rf});report.differences.push(...rf.filter(x=>!x.equal));
 const [equipmentImage,skillImage]=await Promise.all([get('/equipment/'+obj.equipmentKey+'/representative-image'),get(base+'/representative-image')]);check(key+'代表图复用',skillImage.image?.imageKey,equipmentImage.image?.imageKey);summary.relationConfirmed=!!relationship;summary.representativeImageKey=skillImage.image?.imageKey;report.skills[key]=summary;
}
const pv=(s,k,level=1)=>{const p=live[s].parameters[k];return p.valueMode==='FIXED'?p.fixedValue:p.levelValues[String(level)];};
function evalFormula(s,key,attrs){function evaluate(n){if(n.nodeType==='PARAMETER')return pv(s,n.parameterKey);if(n.nodeType==='ATTRIBUTE'){const k=n.attributeOwner+'.'+n.attributeKey+'.'+n.attributeValueKind;if(!(k in attrs))throw Error('缺少算例属性 '+k);return attrs[k];}const [a,b]=n.operands.map(evaluate);if(n.operation==='MULTIPLY')return a*b;if(n.operation==='ADD')return a+b;throw Error('未支持算例运算');}return evaluate(live[s].formulas[key].expression);}
for(const hp of [2000,5000])check('收集者绝对阈值 最大生命'+hp,evalFormula('item_6676_passive','execute_threshold_health',{'TARGET.hp.TOTAL':hp}),hp*.05);
check('收集者效果读取绝对阈值公式',live.item_6676_passive.effects.execute_below_threshold.results[0].valueRule.value,{kind:'FORMULA',formulaKey:'execute_threshold_health'});
check('来源严格低于5%：2000最大生命、剩余100不应触发',100<.05*2000,false);
check('来源严格低于5%：2000最大生命、剩余99满足阈值',99<.05*2000,true);
check('通用EXECUTE的等于边界尚需外层LT过滤',100<=.05*2000,true);
for(const[l,v]of [[1,165],[8,165],[9,180],[18,315]])check('饮血剑'+l+'级护盾上限',pv('item_3072_passive','overshield_by_character_level',l),v);
check('饮血剑参数名称明确上限',live.item_3072_passive.parameters.overshield_by_character_level.name,'灵液护盾上限');
const attrs={'SOURCE.attack_damage.BASE':100,'SOURCE.critical_strike_chance.TOTAL':.25};
check('夺萃基础攻击100暴击率0.25伤害',evalFormula('item_3508_passive','spellblade_damage',attrs),137.5);
check('夺萃对应回蓝',evalFormula('item_3508_passive','total_mana_refund',attrs),68.75);
check('夺萃冷却仍为1500毫秒',pv('item_3508_passive','spellblade_cooldown_ms'),1500);
for(const route of ['/skills/item_3072_passive/effects/lifesteal_overshield','/skills/item_3072_passive/parameters/overshield_duration_ms','/skills/item_3508_passive/parameters/spellblade_ready_window_ms']){const r=await request('GET',route);check('已撤错录组件返回404 '+route,r.status,404);}
check('收集者尚未接宽泛触发',Object.keys(live.item_6676_passive['trigger-rules']).length,0);
check('中娅持续时长保持2500',pv('item_3157_active','stasis_duration_ms'),2500);check('水银主动冷却保持90000',pv('item_3140_active','active_cooldown_ms'),90000);
report.finishedAt=new Date().toISOString();report.summary={equipmentCount:6,skippedEquipmentCount:skippedObjects.length,skillCount:objects.length,counts:Object.fromEntries(kinds.map(([k])=>[k,Object.values(report.skills).reduce((n,s)=>n+s.counts[k],0)])),componentReadbacks:report.readbacks.length,fieldCount:report.readbacks.reduce((n,r)=>n+r.fields.length,0),checks:report.checks.length,mismatches:report.differences.length,missing:report.missing.length,unexpected:report.unexpected.length};
await writeFile(new URL('./纠错后独立回读.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
const disposition=JSON.parse(await readFile(new URL('./来源与处置清单.json',import.meta.url),'utf8'));
const text={item_3072:'只保存165至315的护盾上限；撤去直接给满上限的护盾效果及未经证明的25秒生命周期参数。实际溢出生命偷取金额和事件是作者配置结构缺口。',item_3508:'保留1.25倍基础攻击力加50倍暴击率、伤害50%回蓝和1500毫秒冷却；旧2026-06 Wiki的10000毫秒窗口已移出当前业务参数。',item_6676:'5%比例经公式转换为目标最大生命的绝对点数后交给斩杀结果；还须配置合法伤害、英雄目标及严格小于条件。',item_3140:'90秒主动冷却保留；全部控制移除并排除滞空无法由现有单状态操作完整表达，属于作者配置结构缺口。',item_3157:'保留2.5秒伤害免疫和120秒冷却；主动过程可继续配置，不可选取和凝滞行动限制属于现有结构缺口。'};
for(const row of disposition.rows){const obj=objects.find(x=>x.equipmentKey===row.equipmentKey);if(!obj)continue;row.status='部分录入，待配内容尚未完成';row.summary=text[row.equipmentKey];row.pending=obj.pendingRules;row.sourceRefs=obj.sourceRefs;row.finalCounts=report.skills[obj.skill.skillKey].counts;}
disposition.updatedAt=report.finishedAt;disposition.correctionEvidence='纠错后独立回读.json';disposition.classificationNote='近战与远程是攻击方式类别，不是双方距离；不得用距离比较替代。原装备属性及图片预检保留原证据时间，不冒称本次重新写入。';
await writeFile(new URL('./来源与处置清单.json',import.meta.url),JSON.stringify(disposition,null,2)+'\n');
console.log(JSON.stringify(report.summary));if(report.differences.length||report.missing.length||report.unexpected.length)process.exitCode=1;
