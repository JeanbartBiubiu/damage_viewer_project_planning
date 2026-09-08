// 仅GET业务接口。独立数值期望按冻结原文手算，不从候选表达式生成。
import {writeFile} from 'node:fs/promises';
import {plan} from './组成.mjs';
import {request,diff,kinds,verifySources} from './录入.mjs';
await verifySources();
const allowPendingBrowser=process.argv.includes('--allow-pending-browser');
const reserved=(s,k,id)=>s==='veigar_e'&&[['effects','event_horizon_stun'],['triggerRules','actual_cage_contact']].some(([a,b])=>k===a&&id===b);
const out={startedAt:new Date().toISOString(),boundary:'真实20技能/120列表/组成详情GET及独立算术；不代表战斗或Wasm运行通过。',allowPendingBrowser,subjects:[],lists:[],readbacks:[],arithmetic:[],invariants:[],pendingBrowser:[],failures:[],skills:{},totals:{}};
const live={};
for(const s of Object.values(plan.skills)){
 const subject=await request('/skills/'+s.skillKey);out.subjects.push({skillKey:s.skillKey,status:subject.status,actual:subject.data});if(!subject.ok||subject.data.maxLevel!==s.maxLevel)out.failures.push({skill:s.skillKey,subjectMismatch:true});
 live[s.skillKey]={};const summary={name:s.name,counts:{},pending:s.pending,excluded:s.excluded};
 for(const[kind,idField,apiKind]of kinds){
  const base='/skills/'+s.skillKey+'/'+apiKind,list=await request(base);if(!list.ok||!Array.isArray(list.data))throw Error('列表读取失败 '+base);
  out.lists.push({skillKey:s.skillKey,kind,status:list.status,count:list.data.length,items:list.data});
  summary.counts[kind]=list.data.length;live[s.skillKey][kind]={};out.totals[kind]=(out.totals[kind]??0)+list.data.length;
  for(const item of list.data){const id=item[idField],r=await request(base+'/'+encodeURIComponent(id));if(!r.ok)throw Error('详情读取失败 '+base+'/'+id);live[s.skillKey][kind][id]=r.data;const expected=s.write[kind].find(v=>v[idField]===id),d=expected?diff(expected,r.data):{unexpected:true};out.readbacks.push({skillKey:s.skillKey,kind,id,status:r.status,match:!d,diff:d,actual:r.data});if(d)out.failures.push({skillKey:s.skillKey,kind,id,diff:d});}
  for(const expected of s.write[kind])if(!live[s.skillKey][kind][expected[idField]]){const miss={skillKey:s.skillKey,kind,id:expected[idField],missing:true};if(allowPendingBrowser&&reserved(s.skillKey,kind,expected[idField]))out.pendingBrowser.push(miss);else out.failures.push(miss);}
 }
 out.skills[s.skillKey]=summary;
}
const status=await request('/statuses/vertigo');out.statusEvidence=status;
function pv(skill,key,rank=1,level=1,inputs={}){const p=live[skill].parameters[key];if(!p)throw Error('参数缺失 '+skill+'/'+key);if(p.valueMode==='RUNTIME_INPUT'){if(!(key in inputs))throw Error('样例输入缺失 '+key);return inputs[key];}return p.valueMode==='FIXED'?p.fixedValue:p.levelValues[String(p.valueMode==='CHARACTER_LEVEL'?level:rank)];}
function ev(skill,node,rank,level,attrs,inputs){if(node.nodeType==='PARAMETER')return pv(skill,node.parameterKey,rank,level,inputs);if(node.nodeType==='ATTRIBUTE'){const k=node.attributeOwner+'.'+node.attributeKey+'.'+node.attributeValueKind;if(!(k in attrs))throw Error('样例属性缺失 '+k);return attrs[k];}const[a,b]=node.operands.map(n=>ev(skill,n,rank,level,attrs,inputs));return {ADD:()=>a+b,SUBTRACT:()=>a-b,MULTIPLY:()=>a*b,DIVIDE:()=>a/b,MIN:()=>Math.min(a,b),MAX:()=>Math.max(a,b)}[node.operation]();}
const AP={'SOURCE.ability_power.TOTAL':100},AD={'SOURCE.attack_damage.TOTAL':200},BAD={'SOURCE.attack_damage.BONUS':80};
const cases=[
 ['ahri_p','champion_heal',1,1,AP,105],['ahri_p','champion_heal',1,18,AP,195],
 ['ahri_q','damage',1,1,AP,85],['ahri_q','damage',5,18,AP,185],
 ['ahri_w','damage',1,1,AP,80],['ahri_w','damage',5,18,AP,160],['ahri_w','repeat_damage',1,1,AP,32],['ahri_w','repeat_damage',5,18,AP,64],
 ['ahri_e','damage',1,1,AP,165],['ahri_e','damage',5,18,AP,325],['ahri_r','damage',1,1,AP,110],['ahri_r','damage',3,18,AP,210],
 ['darius_p','bleed_total_per_stack',1,1,BAD,37],['darius_p','bleed_total_per_stack',1,18,BAD,54],
 ['darius_q','blade_damage',1,1,AD,250],['darius_q','blade_damage',5,18,AD,450],['darius_q','handle_damage',1,1,AD,87.5],['darius_q','handle_damage',5,18,AD,157.5],['darius_q','blade_heal',1,1,{'SOURCE.hp.MISSING':1000},170],
 ['darius_w','empowered_attack_damage',1,1,AD,280],['darius_w','empowered_attack_damage',5,18,AD,320],['darius_w','bonus_attack_damage',1,1,AD,80],['darius_w','bonus_attack_damage',5,18,AD,120],
 ['darius_r','base_damage',1,1,BAD,185],['darius_r','base_damage',3,18,BAD,435],
 ...[[-1,185],[0,185],[1,222],[2,259],[3,296],[4,333],[5,370],[6,370]].map(([n,v])=>['darius_r','damage',1,1,BAD,v,{bleed_stacks:n}]),['darius_r','damage',3,18,BAD,870,{bleed_stacks:5}],
 ...[[1,70],[6,95],[7,105],[11,145],[12,160],[16,220],[17,245],[18,270]].map(([l,v])=>['diana_p','cleave_damage',1,l,AP,v]),
 ['diana_p','additional_attack_speed',1,1,{},.3],['diana_p','additional_attack_speed',1,18,{},.7],
 ['diana_q','damage',1,1,AP,140],['diana_q','damage',5,18,AP,280],['diana_w','damage',1,1,AP,38],['diana_w','damage',5,18,AP,86],
 ['diana_w','shield',1,1,{...AP,'SOURCE.hp.BONUS':500},130],['diana_w','shield',5,18,{...AP,'SOURCE.hp.BONUS':500},190],
 ['diana_e','damage',1,1,AP,110],['diana_e','damage',5,18,AP,190],['diana_r','damage',1,1,AP,260],['diana_r','damage',3,18,AP,460],
 ...[0,1,50,1000].map(n=>['veigar_p','stack_ability_power',1,18,{},n,{phenomenal_evil_stacks:n}]),
 ['veigar_q','damage',1,1,AP,130],['veigar_q','damage',5,18,AP,310],['veigar_w','damage',1,1,AP,155],['veigar_w','damage',5,18,AP,415],
 ['veigar_r','damage',1,1,AP,240],['veigar_r','damage',3,18,AP,400],['veigar_r','max_damage',1,1,AP,480],['veigar_r','max_damage',3,18,AP,800]
];
for(const[skill,formula,rank,level,attrs,expected,inputs={}]of cases){const actual=ev(skill,live[skill].formulas[formula].expression,rank,level,attrs,inputs),match=Math.abs(actual-expected)<1e-6,record={skill,formula,rank,level,attrs,inputs,expected,actual,match};out.arithmetic.push(record);if(!match)out.failures.push(record);}
const parameters=[
 ['ahri_p','recent_damage_window_ms',1,1,3000],['ahri_w','repeat_damage_ratio',1,1,.4],['ahri_r','recast_window_ms',1,1,15000],['ahri_r','between_dash_lockout_ms',1,1,1000],['ahri_r','maximum_stored_casts',1,1,3],
 ['darius_p','raw_bleed_tick_interval_ms',1,1,1260],['darius_p','max_stacks',1,1,5],...[[1,30],[10,75],[11,85],[13,105],[14,130],[18,230]].map(([l,v])=>['darius_p','noxian_might_bonus_ad',1,l,v]),
 ['darius_e','armor_penetration_ratio',1,1,.2],['darius_e','armor_penetration_ratio',5,18,.4],['darius_r','mana_cost',1,1,100],['darius_r','mana_cost',2,11,100],['darius_r','mana_cost',3,18,0],['darius_r','kill_recast_window_ms',1,1,20000],
 ['diana_p','passive_attack_speed_ratio',1,1,.15],['diana_p','passive_attack_speed_ratio',1,18,.35],['diana_p','empowered_duration_ms',1,18,5000],['diana_w','shield_bonus_hp_ratio',1,1,.11],['diana_w','orb_count',1,1,3],['diana_e','moonlight_reset_delay_ms',1,1,250],['diana_r','explosion_delay_ms',1,1,1000],
 ['veigar_w','base_cooldown_ms',1,1,8000],['veigar_w','impact_delay_ms',1,1,1200],['veigar_p','stacks_per_w_cdr',1,1,50],['veigar_p','w_cdr_increment',1,1,.1],['veigar_e','stun_duration_ms',1,1,1500],['veigar_e','stun_duration_ms',5,18,2500],['veigar_e','cage_delay_ms',1,1,500],['veigar_e','cage_duration_ms',1,1,3000]
];
for(const[skill,parameter,rank,level,expected]of parameters){const actual=pv(skill,parameter,rank,level),match=Math.abs(actual-expected)<1e-6,record={skill,parameter,rank,level,expected,actual,match};out.arithmetic.push(record);if(!match)out.failures.push(record);}
function invariant(name,match){out.invariants.push({name,match});if(!match)out.failures.push({name,match});}
invariant('阿狸Q去程魔法与返程真实分别保留',live.ahri_q.effects.outgoing_orb.results[0].detail.damageTypeKey==='magic'&&live.ahri_q.effects.returning_orb.results[0].detail.damageTypeKey==='real');
invariant('未用命中序号冒充阿狸Q方向',Object.keys(live.ahri_q.triggerRules).length===0);
invariant('阿狸W未恒定移速或施放打满三团',!live.ahri_w.effects.move_speed&&live.ahri_w.processes.cast.effectBindings.every(b=>b.effectKey==='mana_cost'));
invariant('德莱厄斯P总出血没有冒充单次周期',Object.values(live.darius_p.effects).every(e=>e.results.every(r=>r.resultType!=='DAMAGE')));
invariant('德莱厄斯Q两阶段没有错误同命中触发',Object.keys(live.darius_q.triggerRules).length===0);
invariant('德莱厄斯W不额外加整份强化普攻',live.darius_w.effects.noncritical_bonus.results[0].valueRule.value.formulaKey==='bonus_attack_damage');
invariant('德莱厄斯E未用固定加算冒充穿透组合',!Object.values(live.darius_e.effects).some(e=>e.results.some(r=>r.resultType==='ATTRIBUTE_CHANGE')));
invariant('德莱厄斯R为真实伤害而非生命阈值处决',live.darius_r.effects.guillotine_damage.results[0].resultType==='DAMAGE'&&live.darius_r.effects.guillotine_damage.results[0].detail.damageTypeKey==='real');
invariant('德莱厄斯R未接任意击杀刷新',Object.keys(live.darius_r.triggerRules).length===0);
invariant('黛安娜常态和施法额外攻速合为三倍',Math.abs(pv('diana_p','passive_attack_speed_ratio',1,18)+ev('diana_p',live.diana_p.formulas.additional_attack_speed.expression,1,18,{},{} )-1.05)<1e-6);
invariant('黛安娜初始化常态规则存在',live.diana_p.triggerRules.initialize_passive_attack_speed.eventSource.eventType==='SOURCE_INITIALIZED');
invariant('黛安娜常态与临时攻速均动态读取当前等级', ['passive_attack_speed','cast_attack_speed'].every(k=>{const b=live.diana_p.effects[k].results[0].lifecycleBehavior;return b.valueReadMode==='MOMENT_EVALUATION'&&b.stackValueMode==='SHARED'&&b.reapplicationValueMode===null;}));
invariant('黛安娜施法强化仅限本人QWER四项',Object.values(live.diana_p.triggerRules).filter(r=>r.eventSource.eventType==='SKILL_USED').length===4&&['q','w','e','r'].every(s=>live.diana_p.triggerRules['after_'+s+'_attack_speed'].eventSource.detail.sourceSkillKey==='diana_'+s));
invariant('黛安娜W施放只给初始盾不自动三次伤害或双盾',live.diana_w.processes.cast.effectBindings.filter(b=>b.effectKey!=='mana_cost').length===1&&live.diana_w.processes.cast.effectBindings.some(b=>b.effectKey==='pale_cascade_shield'));
invariant('黛安娜R初始拉入不冒充后续爆炸命中',Object.keys(live.diana_r.triggerRules).length===0);
invariant('维迦W未将动态零值写成零冷却过程',!live.veigar_w.parameters.cooldown_ms&&Object.keys(live.veigar_w.processes).length===0);
invariant('维迦P未编造无证据叠层上限',Object.keys(live.veigar_p.internalStates).length===0);
invariant('维迦R上下限没有同时绑定命中',Object.keys(live.veigar_r.triggerRules).length===0&&live.veigar_r.processes.cast.effectBindings.every(b=>b.effectKey==='mana_cost'));
invariant('过程没有把施法完成自动当作敌人命中伤害',Object.values(live).every(s=>Object.values(s.processes).every(p=>p.effectBindings.every(b=>!s.effects[b.effectKey]?.results.some(r=>r.resultType==='DAMAGE')))));
invariant('未用提前移除冒充引爆',out.readbacks.filter(r=>r.kind==='effects').every(r=>r.actual.results.every(v=>v.lifecycleBehavior?.moment!=='EARLY_REMOVE')));
if(live.veigar_e.effects.event_horizon_stun)invariant('维迦E仅复用状态标识且时长随技能等级',live.veigar_e.effects.event_horizon_stun.results[0].detail.statusKey==='vertigo'&&live.veigar_e.effects.event_horizon_stun.lifecycle.durationValue.parameterKey==='stun_duration_ms');
out.finishedAt=new Date().toISOString();
const prefix=allowPendingBrowser?'阶段':'最终';
await writeFile(new URL('./'+prefix+'独立回读证据.json',import.meta.url),JSON.stringify(out,null,2)+'\n');
const{readbacks,subjects,lists,...summary}=out;Object.assign(summary,{componentsChecked:readbacks.length,subjectCount:subjects.length,listCount:lists.length,arithmeticCount:out.arithmetic.length,invariantCount:out.invariants.length});
await writeFile(new URL('./'+prefix+'回读摘要.json',import.meta.url),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({totals:out.totals,components:readbacks.length,arithmetic:out.arithmetic.length,invariants:out.invariants.length,pendingBrowser:out.pendingBrowser,failures:out.failures}));if(out.failures.length)process.exitCode=1;
