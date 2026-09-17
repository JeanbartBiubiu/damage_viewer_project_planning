// 只读业务接口；手工列出的期望数值独立于候选表达式。
import {writeFile} from 'node:fs/promises';
import {plan} from './英雄候选.mjs';
import {request,diff,kinds,verifySources} from './录入.mjs';
await verifySources();
const out={startedAt:new Date().toISOString(),boundary:'完整业务GET、字段比较、冻结原文独立算术；不代表战斗或Wasm运行通过。',subjects:[],readbacks:[],arithmetic:[],invariants:[],failures:[],skills:{},totals:{}};
const live={};
for(const s of Object.values(plan.skills)){
 const subject=await request('/skills/'+s.skillKey);out.subjects.push({skillKey:s.skillKey,status:subject.status,actual:subject.data});if(!subject.ok||subject.data.maxLevel!==s.maxLevel)out.failures.push({skill:s.skillKey,subjectMismatch:true});
 live[s.skillKey]={};const summary={name:s.name,counts:{},pending:s.pending,excluded:s.excluded};
 for(const[kind,idField,apiKind]of kinds){
  const base='/skills/'+s.skillKey+'/'+apiKind;const list=await request(base);if(!list.ok||!Array.isArray(list.data))throw Error('列表读取失败 '+base);
  summary.counts[kind]=list.data.length;live[s.skillKey][kind]={};out.totals[kind]=(out.totals[kind]??0)+list.data.length;
  for(const item of list.data){const id=item[idField],r=await request(base+'/'+encodeURIComponent(id));if(!r.ok)throw Error('详情读取失败 '+base+'/'+id);live[s.skillKey][kind][id]=r.data;const expected=s.write[kind].find(v=>v[idField]===id);const d=expected?diff(expected,r.data):{unexpected:true};out.readbacks.push({skillKey:s.skillKey,kind,id,status:r.status,match:!d,diff:d,actual:r.data});if(d)out.failures.push({skillKey:s.skillKey,kind,id,diff:d});}
  for(const expected of s.write[kind])if(!live[s.skillKey][kind][expected[idField]])out.failures.push({skillKey:s.skillKey,kind,id:expected[idField],missing:true});
 }
 out.skills[s.skillKey]=summary;
}
function pv(skill,key,rank=1,level=1,inputs={}){const p=live[skill].parameters[key];if(!p)throw Error('参数缺失 '+skill+'/'+key);if(p.valueMode==='RUNTIME_INPUT'){if(!(key in inputs))throw Error('样例输入缺失 '+key);return inputs[key];}return p.valueMode==='FIXED'?p.fixedValue:p.levelValues[String(p.valueMode==='CHARACTER_LEVEL'?level:rank)];}
function ev(skill,node,rank,level,attrs,inputs){if(node.nodeType==='PARAMETER')return pv(skill,node.parameterKey,rank,level,inputs);if(node.nodeType==='ATTRIBUTE'){const k=node.attributeOwner+'.'+node.attributeKey+'.'+node.attributeValueKind;if(!(k in attrs))throw Error('样例属性缺失 '+k);return attrs[k];}const[a,b]=node.operands.map(n=>ev(skill,n,rank,level,attrs,inputs));return {ADD:()=>a+b,SUBTRACT:()=>a-b,MULTIPLY:()=>a*b,DIVIDE:()=>a/b,MIN:()=>Math.min(a,b),MAX:()=>Math.max(a,b)}[node.operation]();}
const AP={'SOURCE.ability_power.TOTAL':100},AD={'SOURCE.attack_damage.TOTAL':200},BAD={'SOURCE.attack_damage.BONUS':80},crit=(chance,bonus)=>({'SOURCE.critical_strike_chance.TOTAL':chance,'SOURCE.critical_strike_damage_bonus_percent.TOTAL':bonus});
const cases=[
 ...[[1,100],[6,100],[7,110],[12,110],[13,120],[18,120]].map(([l,v])=>['lucian_p','second_shot_damage',1,l,AD,v]),
 ['lucian_p','second_shot_crit_multiplier',1,1,crit(0,0),1.75],['lucian_p','second_shot_crit_multiplier',1,18,crit(0,.4),2.15],['lucian_p','vigilance_damage',1,1,AD,55],
 ['lucian_q','damage',1,1,BAD,160],['lucian_q','damage',5,18,BAD,300],['lucian_w','damage',1,1,AP,165],['lucian_w','damage',5,18,AP,305],
 ['lucian_r','bullet_damage',1,1,{...AP,...AD},80],['lucian_r','bullet_damage',3,18,{...AP,...AD},110],
 ['lucian_r','continuous_shot_count',1,1,crit(0,0),22],['lucian_r','continuous_shot_count',3,18,crit(.25,0),27.5],['lucian_r','continuous_shot_count',3,18,crit(.5,.4),37.4],
 ['lucian_r','tooltip_total_damage',1,1,{...AP,...AD,...crit(.25,0)},2200],
 ['sivir_q','precrit_damage',1,1,{...AP,...BAD},176],['sivir_q','precrit_damage',5,18,{...AP,...BAD},276],
 ['sivir_q','damage',1,1,{...AP,...BAD,...crit(0,0)},176],['sivir_q','damage',1,1,{...AP,...BAD,...crit(.5,0)},211.2],['sivir_q','damage',5,18,{...AP,...BAD,...crit(.5,.4)},353.28],
 ['sivir_e','block_heal',1,1,{...AP,...AD},170],['sivir_e','block_heal',5,18,{...AP,...AD},210],
 ['tristana_w','damage',1,1,{...AP,...BAD},200],['tristana_w','damage',5,18,{...AP,...BAD},340],
 ['tristana_e','unstacked_damage',1,1,{...AP,...BAD,...crit(0,0)},174],['tristana_e','unstacked_damage',5,18,{...AP,...BAD,...crit(.5,.4)},350.72],
 ...[[0,174],[1,217.5],[2,261],[3,304.5],[4,348]].map(([s,v])=>['tristana_e','bomb_damage',1,1,{...AP,...BAD,...crit(0,0)},v,{bomb_stacks:s}]),
 ['tristana_e','bomb_damage',5,18,{...AP,...BAD,...crit(.5,.4)},701.44,{bomb_stacks:4}],['tristana_e','max_damage',5,18,{...AP,...BAD,...crit(.5,.4)},701.44],
 ['tristana_r','damage',1,1,{...AP,...BAD},381],['tristana_r','damage',3,18,{...AP,...BAD},481],
 ...[[1,4],[4,4],[5,5],[8,5],[9,6],[12,6],[13,7],[16,7],[17,8],[18,8]].map(([l,v])=>['twitch_p','damage_per_stack_second',1,l,AP,v]),
 ['twitch_p','damage_per_second',1,18,AP,24,{poison_stacks:3}],['twitch_p','max_full_duration_damage',1,18,AP,288],
 ['twitch_w','slow_ratio',1,1,AP,.36],['twitch_w','slow_ratio',5,18,AP,.56],
 ...[[1,63],[3,149],[6,278]].map(([s,v])=>['twitch_e','physical_damage',1,1,BAD,v,{poison_stacks:s}]),
 ...[[1,35],[3,105],[6,210]].map(([s,v])=>['twitch_e','magic_damage',1,1,AP,v,{poison_stacks:s}]),
 ['twitch_e','max_physical_damage',5,18,BAD,438],['twitch_e','max_magic_damage',5,18,AP,210]
];
for(const[skill,formula,rank,level,attrs,expected,inputs={}]of cases){const actual=ev(skill,live[skill].formulas[formula].expression,rank,level,attrs,inputs);const match=Math.abs(actual-expected)<1e-6;const record={skill,formula,rank,level,attrs,inputs,expected,actual,match};out.arithmetic.push(record);if(!match)out.failures.push(record);}
const parameters=[...[[1,55],[5,55],[6,60],[10,60],[11,65],[15,65],[16,70],[17,70],[18,75]].map(([l,v])=>['sivir_p','initial_move_speed',1,l,v]),...[[1,32],[2,24],[3,16],[4,8],[5,0]].map(([r,v])=>['lucian_e','mana_cost',r,18,v]),...[[1,15],[2,20],[3,25],[4,30],[5,35]].map(([r,v])=>['tristana_q','mana_cost',r,18,v]),['tristana_r','stun_duration_ms',1,1,400],['tristana_r','stun_duration_ms',2,11,550],['tristana_r','stun_duration_ms',3,18,700],['tristana_q','bonus_attack_speed_ratio',5,18,1.2],['sivir_e','shield_duration_ms',1,1,1500],['twitch_r','bonus_attack_damage',3,18,60],['twitch_r','bonus_attack_range',3,18,300]];
for(const[skill,parameter,rank,level,expected]of parameters){const actual=pv(skill,parameter,rank,level);const match=Math.abs(actual-expected)<1e-6;const record={skill,parameter,rank,level,expected,actual,match};out.arithmetic.push(record);if(!match)out.failures.push(record);}
function invariant(name,match){out.invariants.push({name,match});if(!match)out.failures.push({name,match});}
invariant('未为缺省起点编造TristanaP等级曲线',Object.values(live.tristana_p).every(v=>Object.keys(v).length===0));
invariant('SivirP未写恒定移速冒充衰减',!Object.keys(live.sivir_p.effects).length);
invariant('SivirQ暴击为数值折算不重掷',live.sivir_q.effects.boomerang_hit.results[0].detail.critical.mode==='DISALLOWED');
invariant('LucianR未用小数子弹数启动引导步骤',!Object.keys(live.lucian_r.processes).length);
invariant('TwitchE两部分伤害整体法术盾阻挡',live.twitch_e.effects.contaminate_damage.results.length===2&&live.twitch_e.effects.contaminate_damage.results.every(r=>r.spellShieldBlockScope==='EFFECT'));
invariant('TwitchE和TristanaE未创建无层数来源的命中规则',!Object.keys(live.twitch_e.triggerRules).length&&!Object.keys(live.tristana_e.triggerRules).length);
invariant('TwitchQ施放没有立即获得离开伪装攻速',live.twitch_q.processes.cast.effectBindings.every(b=>b.effectKey!=='exit_camouflage_speed'));
invariant('SOURCE范围持续效果条件承受对象留空',live.sivir_r.triggerRules.active_attack_refund.conditionGroups[0].conditions.find(c=>c.conditionType==='LIFECYCLE_CHECK').detail.subject===null);
invariant('SivirE治疗由成功格挡事件触发',live.sivir_e.triggerRules.successful_spell_block?.eventSource.eventType==='SPELL_SHIELD_BLOCKED'&&live.sivir_e.triggerRules.successful_spell_block?.actions.every(a=>a.detail.effectKey==='block_heal'));
invariant('SivirE成功治疗同时显式移除自身护盾',live.sivir_e.effects.block_heal.results.some(r=>r.resultKey==='remove_spell_shield'&&r.resultType==='LIFECYCLE_OPERATION'&&r.target==='SOURCE'&&r.detail.targetEffectKey==='spell_shield'&&r.detail.operation==='REMOVE'&&r.valueRule===null));
invariant('未用提前移除冒充引爆',out.readbacks.filter(r=>r.kind==='effects').every(r=>r.actual.results.every(v=>v.lifecycleBehavior?.moment!=='EARLY_REMOVE')));
out.finishedAt=new Date().toISOString();
await writeFile(new URL('./护盾消费纠错/批次独立回读证据.json',import.meta.url),JSON.stringify(out,null,2)+'\n');
const {readbacks,subjects,...summary}=out;summary.componentsChecked=readbacks.length;summary.subjectCount=subjects.length;summary.arithmeticCount=out.arithmetic.length;summary.invariantCount=out.invariants.length;
await writeFile(new URL('./护盾消费纠错/批次回读摘要.json',import.meta.url),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({totals:out.totals,components:readbacks.length,arithmetic:out.arithmetic.length,invariants:out.invariants.length,failures:out.failures}));if(out.failures.length)process.exitCode=1;
