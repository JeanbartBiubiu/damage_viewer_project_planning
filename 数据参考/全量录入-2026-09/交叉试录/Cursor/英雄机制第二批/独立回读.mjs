// 只读API。算术期望值由冻结原文独立列出，不从候选生成结果反算。
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {plan} from './候选.mjs';
import {here,request,diff,kinds,verifySources} from './录入.mjs';
await verifySources();
const out={startedAt:new Date().toISOString(),boundary:'独立GET、冻结来源算术和对象结构核对；不是战斗运行验证。',readbacks:[],arithmetic:[],invariants:[],failures:[],skills:{}};
const live={};
for(const s of Object.values(plan.skills)){live[s.skillKey]={};const summary={name:s.name,counts:{},pending:s.pending,excluded:s.excluded,status:'部分录入'};
 for(const[kind,idField,apiKind]of kinds){const base='/skills/'+s.skillKey+'/'+apiKind;const list=await request(base);if(!list.ok||!Array.isArray(list.data))throw Error('列表读取失败 '+base);summary.counts[kind]=list.data.length;live[s.skillKey][kind]={};for(const item of list.data){const id=item[idField],r=await request(base+'/'+encodeURIComponent(id));if(!r.ok)throw Error('详情读取失败 '+base+'/'+id);live[s.skillKey][kind][id]=r.data;const expected=s.write[kind].find(v=>v[idField]===id);if(expected){const d=diff(expected,r.data);out.readbacks.push({skillKey:s.skillKey,kind,id,match:!d,diff:d,actual:r.data});if(d)out.failures.push({skillKey:s.skillKey,kind,id,diff:d});}}
  for(const expected of s.write[kind])if(!live[s.skillKey][kind][expected[idField]])out.failures.push({skillKey:s.skillKey,kind,id:expected[idField],missing:true});
 }
 out.skills[s.skillKey]=summary;
}
function pv(skill,key,rank=1,level=1){const p=live[skill].parameters[key];if(!p)throw Error('参数缺失 '+skill+'/'+key);return p.valueMode==='FIXED'?p.fixedValue:p.levelValues[String(p.valueMode==='CHARACTER_LEVEL'?level:rank)];}
function evaluate(skill,node,rank,level,attrs){if(node.nodeType==='PARAMETER')return pv(skill,node.parameterKey,rank,level);if(node.nodeType==='ATTRIBUTE'){const k=node.attributeOwner+'.'+node.attributeKey+'.'+node.attributeValueKind;if(!(k in attrs))throw Error('样例属性缺失 '+k);return attrs[k];}const[a,b]=node.operands.map(n=>evaluate(skill,n,rank,level,attrs));return {ADD:()=>a+b,SUBTRACT:()=>a-b,MULTIPLY:()=>a*b,DIVIDE:()=>a/b,MIN:()=>Math.min(a,b),MAX:()=>Math.max(a,b)}[node.operation]();}
const AP={'SOURCE.ability_power.TOTAL':100},AD={'SOURCE.attack_damage.TOTAL':100},AR={'SOURCE.armor.TOTAL':100},HP={'TARGET.hp.TOTAL':1000};
const cases=[
 ['malphite_p','shield',1,1,{'SOURCE.hp.TOTAL':1000},100],['malphite_q','damage',1,1,AP,130],['malphite_q','damage',5,18,AP,330],
 ['malphite_w','next_attack_damage',1,1,{...AP,...AR},65],['malphite_w','next_attack_damage',5,18,{...AP,...AR},105],['malphite_w','splash_damage',1,1,{...AP,...AR},60],['malphite_w','splash_damage',5,18,{...AP,...AR},100],
 ['malphite_e','damage',1,1,{...AP,...AR},160],['malphite_e','damage',5,18,{...AP,...AR},300],['malphite_r','damage',1,1,AP,290],['malphite_r','damage',3,18,AP,490],
 ...[[1,50],[4,60],[7,70],[9,80],[11,90],[13,100],[18,100]].map(([l,v])=>['missfortune_p','love_tap_damage',1,l,AD,v]),
 ['missfortune_q','damage',1,1,{...AP,...AD},155],['missfortune_q','damage',5,18,{...AP,...AD},255],
 ['missfortune_e','damage_per_second',1,1,AP,95],['missfortune_e','damage_per_tick',1,1,AP,23.75],['missfortune_e','full_duration_damage',1,1,AP,190],['missfortune_e','damage_per_tick',5,18,AP,38.75],['missfortune_e','full_duration_damage',5,18,AP,310],['missfortune_e','slow_ratio',1,1,AP,.46],
 ['missfortune_r','wave_damage',1,1,{...AP,...AD},105],['missfortune_r','wave_damage',3,18,{...AP,...AD},125],['missfortune_r','all_waves_noncritical_damage',1,1,{...AP,...AD},1470],['missfortune_r','all_waves_noncritical_damage',3,18,{...AP,...AD},2250],['missfortune_r','wave_crit_multiplier',1,1,{'SOURCE.critical_strike_damage_bonus_percent.TOTAL':0},1.3],['missfortune_r','wave_crit_multiplier',3,18,{'SOURCE.critical_strike_damage_bonus_percent.TOTAL':.4},1.42],
 ['annie_q','damage',1,1,AP,160],['annie_q','damage',5,18,AP,340],['annie_w','damage',1,1,AP,150],['annie_w','damage',5,18,AP,310],['annie_e','shield',1,1,AP,100],['annie_e','shield',5,18,AP,240],['annie_e','return_damage',1,1,AP,65],['annie_e','return_damage',5,18,AP,105],['annie_r','damage',1,1,AP,225],['annie_r','damage',3,18,AP,475],
 ['brand_p','burn_total',1,1,HP,20],['brand_p','explosion',1,1,{...AP,...HP},80],['brand_p','explosion',1,18,{...AP,...HP},140],['brand_q','damage',1,1,AP,135],['brand_q','damage',5,18,AP,255],['brand_w','damage',1,1,AP,145],['brand_w','damage',5,18,AP,325],['brand_w','empowered_damage',1,1,AP,181.25],['brand_w','empowered_damage',5,18,AP,406.25],['brand_e','damage',1,1,AP,115],['brand_e','damage',5,18,AP,215],['brand_r','damage',1,1,AP,130],['brand_r','damage',3,18,AP,280]
];
for(const[skill,formula,rank,level,attrs,expected]of cases){const actual=evaluate(skill,live[skill].formulas[formula].expression,rank,level,attrs);const match=Math.abs(actual-expected)<1e-6;const r={skill,formula,rank,level,attrs,expected,actual,match};out.arithmetic.push(r);if(!match)out.failures.push(r);}
const paramCases=[['malphite_p','recharge_delay_ms',1,6,8000],['malphite_p','recharge_delay_ms',1,7,7000],['malphite_p','recharge_delay_ms',1,13,6000],['missfortune_w','bonus_attack_speed_ratio',1,1,.4],['missfortune_w','bonus_attack_speed_ratio',5,18,1],['annie_p','stun_duration_ms',1,5,1250],['annie_p','stun_duration_ms',1,6,1500],['annie_p','stun_duration_ms',1,10,1500],['annie_p','stun_duration_ms',1,11,1750],['annie_e','move_speed_ratio',1,1,.2],['annie_e','move_speed_ratio',5,18,.5],['annie_e','cooldown_ms',1,1,10000],['annie_r','magic_penetration_ratio',1,1,.1],['annie_r','magic_penetration_ratio',3,18,.2],['brand_p','kill_mana_restore',1,18,39.983]];
for(const[skill,parameter,rank,level,expected]of paramCases){const actual=pv(skill,parameter,rank,level);const match=Math.abs(actual-expected)<1e-6;const r={skill,parameter,rank,level,expected,actual,match};out.arithmetic.push(r);if(!match)out.failures.push(r);}
function invariant(name,match){out.invariants.push({name,match});if(!match)out.failures.push({name,match});}
invariant('Brand E 冲突法力没有补零或选边',!live.brand_e.parameters.mana_cost&&!live.brand_e.effects.mana_cost&&!Object.keys(live.brand_e.processes).length);
invariant('MF Q 普攻前摇未写成零',!live.missfortune_q.parameters.cast_time_ms&&!Object.keys(live.missfortune_q.processes).length);
invariant('安妮 R 未用错误加算录入百分比穿透效果',!live.annie_r.effects.passive_magic_penetration);
for(const[skill,key]of [['malphite_p','granite_shield'],['annie_e','molten_shield']]){const e=live[skill].effects[key];invariant(skill+' 自身护盾目标和实例范围',e.lifecycle.instanceScope==='SOURCE'&&e.results.every(r=>r.target==='SOURCE'));}
invariant('MF R 每波依来源暴击率及正确倍率公式',live.missfortune_r.effects.bullet_wave.results[0].detail.critical.mode==='SOURCE_CRIT_CHANCE'&&live.missfortune_r.effects.bullet_wave.results[0].detail.critical.multiplierValue.formulaKey==='wave_crit_multiplier');
invariant('Brand W 普通与强化未同时触发',!Object.keys(live.brand_w.triggerRules).length);
invariant('未用提前移除冒充引爆',out.readbacks.filter(r=>r.kind==='effects').every(r=>r.actual.results.every(v=>v.lifecycleBehavior?.moment!=='EARLY_REMOVE')));
out.finishedAt=new Date().toISOString();out.totals={};for(const s of Object.values(out.skills))for(const[k,v]of Object.entries(s.counts))out.totals[k]=(out.totals[k]??0)+v;
await writeFile(path.join(here,'独立回读证据.json'),JSON.stringify(out,null,2)+'\n');
const summary={startedAt:out.startedAt,finishedAt:out.finishedAt,executor:plan.meta.executor,heroCount:4,skillCount:20,totals:out.totals,componentsChecked:out.readbacks.length,arithmetic:out.arithmetic.length,invariants:out.invariants.length,failures:out.failures,skills:out.skills,validationBoundary:out.boundary};
await writeFile(path.join(here,'回读摘要.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({totals:out.totals,components:out.readbacks.length,arithmetic:out.arithmetic.length,invariants:out.invariants.length,failures:out.failures}));if(out.failures.length)process.exitCode=1;
