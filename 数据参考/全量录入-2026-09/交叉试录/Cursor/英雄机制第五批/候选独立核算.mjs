// 预期值按冻结主技能与当前绑定文本独立手算，不从候选表达式生成。
export function verify(plan){
 const arithmetic=[],invariants=[];
 function pv(s,key,rank,level,inputs){const p=s.write.parameters.find(p=>p.parameterKey===key);if(!p)throw Error('缺参数 '+s.skillKey+'/'+key);const value=p.valueMode==='FIXED'?p.fixedValue:p.valueMode==='RUNTIME_INPUT'?inputs[key]:p.levelValues[String(p.valueMode==='CHARACTER_LEVEL'?level:rank)];if(!Number.isFinite(value))throw Error('样例缺输入 '+key);return value;}
 function ev(s,n,rank,level,attrs,inputs){if(n.nodeType==='PARAMETER')return pv(s,n.parameterKey,rank,level,inputs);if(n.nodeType==='ATTRIBUTE'){const k=n.attributeOwner+'.'+n.attributeKey+'.'+n.attributeValueKind;if(!(k in attrs))throw Error('样例缺属性 '+k);return attrs[k];}const [a,b]=n.operands.map(n=>ev(s,n,rank,level,attrs,inputs));return {ADD:()=>a+b,SUBTRACT:()=>a-b,MULTIPLY:()=>a*b,DIVIDE:()=>a/b,MIN:()=>Math.min(a,b),MAX:()=>Math.max(a,b)}[n.operation]();}
 const AD={'SOURCE.attack_damage.TOTAL':200},BAD={'SOURCE.attack_damage.BONUS':100},AP={'SOURCE.ability_power.TOTAL':100},THP={'TARGET.hp.TOTAL':2000},SHP={'SOURCE.hp.TOTAL':2000};
 const cases=[
 ['sett_p','right_punch_bonus',1,1,BAD,60],['sett_p','right_punch_bonus',1,9,BAD,100],['sett_p','right_punch_bonus',1,18,BAD,145],
 ['sett_q','bonus_damage',1,1,{...AD,...THP},70],['sett_q','bonus_damage',3,9,{...AD,...THP},130],['sett_q','bonus_damage',5,18,{...AD,...THP},190],
 ['sett_w','max_grit',1,1,SHP,1000],['sett_w','max_grit',1,1,{'SOURCE.hp.TOTAL':1000},500],['sett_w','released_grit_shield',1,1,SHP,0,{released_grit:0}],['sett_w','released_grit_shield',1,1,SHP,1000,{released_grit:1000}],['sett_w','released_grit_shield',1,1,{'SOURCE.hp.TOTAL':1000},1000,{released_grit:1000}],['sett_w','damage',1,1,{...SHP,...BAD},380,{released_grit:600}],['sett_w','damage',5,18,{...SHP,...BAD},660,{released_grit:1000}],['sett_w','damage',1,1,{...SHP,...BAD},80,{released_grit:0}],['sett_w','damage',1,1,{'SOURCE.hp.TOTAL':1000,...BAD},580,{released_grit:1000}],
 ['sett_e','damage',1,1,AD,170],['sett_e','damage',5,18,AD,250],['sett_r','captured_target_damage',1,1,{...BAD,'TARGET.hp.BONUS':500},520],['sett_r','captured_target_damage',3,18,{...BAD,'TARGET.hp.BONUS':500},820],
 ['trundle_p','tribute_heal',1,1,THP,36],['trundle_p','tribute_heal',1,18,THP,110],
 ['trundle_q','total_noncritical_damage',1,1,AD,240],['trundle_q','total_noncritical_damage',5,18,AD,400],['trundle_q','bonus_noncritical_damage',1,1,AD,40],['trundle_q','bonus_noncritical_damage',5,18,AD,200],
 ['trundle_r','drain_total_damage',1,1,{...AP,...THP},440],['trundle_r','drain_total_damage',3,18,{...AP,...THP},640],['trundle_r','initial_drain_damage',1,1,{...AP,...THP},220],['trundle_r','initial_drain_damage',3,18,{...AP,...THP},320],
 ];
 if(plan.skills.warwick_p)cases.push(...extraCases({AD,BAD,AP,THP,SHP}));
 for(const [skill,formula,rank,level,attrs,expected,inputs={}]of cases){const s=plan.skills[skill],f=s.write.formulas.find(f=>f.formulaKey===formula);if(!f)throw Error('缺公式 '+skill+'/'+formula);const actual=ev(s,f.expression,rank,level,attrs,inputs);arithmetic.push({skill,formula,rank,level,attrs,inputs,expected,actual,match:Math.abs(actual-expected)<1e-6});}
 const paramCases=[['trundle_w','attack_speed_ratio',1,.3],['trundle_w','attack_speed_ratio',5,1.1],['trundle_w','move_speed_ratio',1,.2],['trundle_w','move_speed_ratio',5,.52],['trundle_e','slow_ratio',1,.34],['trundle_e','slow_ratio',5,.5],['trundle_e','pillar_duration_ms',1,6000],['trundle_r','actual_drain_duration_ms',1,5000],['trundle_r','post_drain_shred_duration_ms',1,4000],['trundle_q','target_attack_damage_loss',1,10],['trundle_q','target_attack_damage_loss',5,20]];
 for(const [skill,parameter,rank,expected]of paramCases){const actual=pv(plan.skills[skill],parameter,rank,1,{});arithmetic.push({skill,parameter,rank,expected,actual,match:Math.abs(actual-expected)<1e-6});}
 for(const s of Object.values(plan.skills)){
  const params=new Set(s.write.parameters.map(p=>p.parameterKey)),forms=new Set(s.write.formulas.map(f=>f.formulaKey)),effects=new Set(s.write.effects.map(e=>e.effectKey));
  const missing=[];function walk(n){if(!n||typeof n!=='object')return;if((n.kind==='PARAMETER'||n.nodeType==='PARAMETER')&&!params.has(n.parameterKey))missing.push(n.parameterKey);if(n.kind==='FORMULA'&&!forms.has(n.formulaKey))missing.push(n.formulaKey);if(n.actionType==='EXECUTE_EFFECT'&&!effects.has(n.detail.effectKey))missing.push(n.detail.effectKey);for(const v of Object.values(n))if(v&&typeof v==='object')walk(v);}
  walk(s.write);invariants.push({skill:s.skillKey,check:'本技能参数公式效果引用完整',match:missing.length===0,missing});
  invariants.push({skill:s.skillKey,check:'施法过程不生成伤害命中',match:s.write.processes.every(p=>p.effectBindings.every(b=>!s.write.effects.find(e=>e.effectKey===b.effectKey)?.results.some(r=>r.resultType==='DAMAGE')))});
  invariants.push({skill:s.skillKey,check:'目标持续控制状态未绕过法术护盾限制',match:s.write.effects.every(e=>e.results.every(r=>!(r.target==='TARGET'&&r.lifecycleBehavior?.moment==='PERSISTENT'&&r.resultType==='STATUS_OPERATION')))});
 }
 const settHit=plan.skills.sett_e.write.triggerRules.find(r=>r.ruleKey==='actual_hit');
 invariants.push({skill:'sett_e',check:'实际命中规则不依赖被撤出的施法过程',match:settHit?.eventSource.eventType==='SKILL_HIT'&&settHit.eventSource.detail.sourceSkillKey==='sett_e'&&settHit.actions.length===1&&settHit.actions[0].detail.effectKey==='facebreaker_hit'&&!JSON.stringify(settHit).includes('processKey')});
 return {arithmetic,invariants};
}
function extraCases({AD,BAD,AP,THP,SHP}){return [
 ['warwick_p','on_hit_damage',1,1,{...BAD,...AP},31],['warwick_p','on_hit_damage',1,9,{...BAD,...AP},54.058824],['warwick_p','on_hit_damage',1,18,{...BAD,...AP},80],['warwick_p','normal_heal',1,1,{},100,{passive_actual_damage:100}],['warwick_p','empowered_heal',1,1,{},250,{passive_actual_damage:100}],
 ['warwick_q','bite_damage',1,1,{...AD,...AP,...THP},460],['warwick_q','bite_damage',5,18,{...AD,...AP,...THP},540],['warwick_q','bite_heal',1,1,{},50,{bite_actual_damage:200}],['warwick_q','bite_heal',5,18,{},150,{bite_actual_damage:200}],
 ['warwick_w','empowered_attack_speed',1,1,{},2.1],['warwick_w','empowered_attack_speed',5,18,{},3.3],['warwick_w','empowered_move_speed',1,1,{},1.05],['warwick_w','empowered_move_speed',5,18,{},1.95],['warwick_w','no_target_cooldown_refund',1,1,{},24000],['warwick_w','no_target_cooldown_refund',5,18,{},12000],
 ['warwick_e','remaining_damage_ratio',1,1,{},.65],['warwick_e','remaining_damage_ratio',5,18,{},.45],['warwick_r','channel_total_damage',1,1,BAD,342],['warwick_r','channel_total_damage',3,18,BAD,692],['warwick_r','channel_heal',1,1,{},188,{channel_actual_damage:188}],
 ...[[1,35],[5,35],[6,70],[10,70],[11,105],[15,105],[16,140],[18,140]].map(([l,n])=>['xinzhao_p','bonus_damage',1,l,{...AD,...AP},n]),
 ...[[1,80],[5,80],[6,120],[10,120],[11,170],[18,170]].map(([l,n])=>['xinzhao_p','determination_heal',1,l,{...SHP,...AP},n]),
 ['xinzhao_q','bonus_damage',1,1,BAD,55],['xinzhao_q','bonus_damage',5,18,BAD,115],['xinzhao_w','slash_damage',1,1,AD,90],['xinzhao_w','slash_damage',5,18,AD,130],
 ['xinzhao_w','thrust_damage',1,1,{...AD,...AP,'SOURCE.critical_strike_chance.TOTAL':0},295],['xinzhao_w','thrust_damage',5,18,{...AD,...AP,'SOURCE.critical_strike_chance.TOTAL':0},435],['xinzhao_w','thrust_damage',1,1,{...AD,...AP,'SOURCE.critical_strike_chance.TOTAL':.5},344.1175],['xinzhao_w','thrust_damage',5,18,{...AD,...AP,'SOURCE.critical_strike_chance.TOTAL':1},579.855],['xinzhao_w','thrust_damage',1,1,{...AD,...AP,'SOURCE.critical_strike_chance.TOTAL':-1},295],['xinzhao_w','thrust_damage',1,1,{...AD,...AP,'SOURCE.critical_strike_chance.TOTAL':2},393.235],['xinzhao_w','slow_duration_ms',1,1,AP,2000],
 ['xinzhao_e','charge_damage',1,1,AP,170],['xinzhao_e','charge_damage',5,18,AP,270],['xinzhao_e','attack_speed_bonus',1,1,AP,.58,{permanent_bonus_attack_speed_ratio:.5}],['xinzhao_e','attack_speed_bonus',5,18,AP,.9,{permanent_bonus_attack_speed_ratio:.5}],['xinzhao_e','attack_speed_bonus',1,1,{...AP,'SOURCE.bonus_attack_speed_percent.TOTAL':100},.58,{permanent_bonus_attack_speed_ratio:.5}],
 ['xinzhao_r','sweep_damage',1,1,{...AP,...BAD,'TARGET.hp.CURRENT':1200},465],['xinzhao_r','sweep_damage',3,18,{...AP,...BAD,'TARGET.hp.CURRENT':1200},665],['xinzhao_r','sweep_damage',1,1,{...AP,...BAD,'TARGET.hp.CURRENT':500},360]
 ];}
