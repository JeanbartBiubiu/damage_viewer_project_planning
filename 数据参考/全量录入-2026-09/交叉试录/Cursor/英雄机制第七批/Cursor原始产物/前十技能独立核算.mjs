import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const plan=JSON.parse(await readFile(new URL('./前十技能候选.json',import.meta.url),'utf8'));
const before=JSON.parse(await readFile(new URL('./写前现值.json',import.meta.url),'utf8'));
const arithmetic=[],invariants=[];
const pv=(s,key,rank=1,level=1,inputs={})=>{const p=s.write.parameters.find(p=>p.parameterKey===key);if(!p)throw Error('缺参数 '+s.skillKey+'/'+key);const n=p.valueMode==='FIXED'?p.fixedValue:p.valueMode==='RUNTIME_INPUT'?inputs[key]:p.levelValues[String(p.valueMode==='CHARACTER_LEVEL'?level:rank)];if(!Number.isFinite(n))throw Error('缺输入 '+s.skillKey+'/'+key);return n;};
const ev=(s,n,r,l,a,i)=>{if(n.nodeType==='PARAMETER')return pv(s,n.parameterKey,r,l,i);if(n.nodeType==='ATTRIBUTE'){const key=n.attributeOwner+'.'+n.attributeKey+'.'+n.attributeValueKind;if(!Number.isFinite(a[key]))throw Error('缺属性 '+key);return a[key];}const [x,y]=n.operands.map(v=>ev(s,v,r,l,a,i));return {ADD:()=>x+y,SUBTRACT:()=>x-y,MULTIPLY:()=>x*y,DIVIDE:()=>x/y,MIN:()=>Math.min(x,y),MAX:()=>Math.max(x,y)}[n.operation]();};
const AD={'SOURCE.attack_damage.TOTAL':200},BAD={'SOURCE.attack_damage.BONUS':100},THP={'TARGET.hp.TOTAL':2000},SHP={'SOURCE.hp.TOTAL':2000};
const cases=[
 ['vi_p','shield',1,1,SHP,240],
 ['vi_q','min_damage',1,1,BAD,100],['vi_q','max_damage',1,1,BAD,250],['vi_q','min_damage',5,18,BAD,180],['vi_q','max_damage',5,18,BAD,450],
 ['vi_w','damage',1,1,{...BAD,...THP},150],['vi_w','damage',1,1,{...{'SOURCE.attack_damage.BONUS':0},...THP},80],['vi_w','damage',5,18,{...BAD,...THP},230],['vi_w','damage',5,18,{...{'SOURCE.attack_damage.BONUS':0},...THP},160],
 ['vi_e','attack_damage',1,1,AD,230,{omitted_stat_value:0}],['vi_e','attack_damage',5,18,AD,310,{omitted_stat_value:0}],['vi_e','attack_damage',1,1,AD,280,{omitted_stat_value:50}],
 ['vi_r','primary_damage',1,1,BAD,240],['vi_r','primary_damage',3,18,BAD,440],
 ['olaf_p','attack_speed',1,1,{...SHP,'SOURCE.hp.MISSING':0},0,{actual_max_attack_speed:.5}],
 ['olaf_p','attack_speed',1,1,{...SHP,'SOURCE.hp.MISSING':1400},.5,{actual_max_attack_speed:.5}],
 ['olaf_p','attack_speed',1,1,{...SHP,'SOURCE.hp.MISSING':2000},.5,{actual_max_attack_speed:.5}],
 ['olaf_p','attack_speed',1,1,{...SHP,'SOURCE.hp.MISSING':700},.25,{actual_max_attack_speed:.5}],
 ['olaf_p','life_steal',1,1,{...SHP,'SOURCE.hp.MISSING':1400},.08,{actual_max_lifesteal:.08}],
 ['olaf_q','damage',1,1,BAD,170],['olaf_q','damage',5,18,BAD,370],
 ['olaf_w','uncapped_shield',1,1,{...SHP,'SOURCE.hp.MISSING':1000},185],
 ['olaf_w','max_shield',1,1,SHP,255],
 ['olaf_w','shield',1,1,{...SHP,'SOURCE.hp.MISSING':1000},185],
 ['olaf_w','shield',1,1,{...SHP,'SOURCE.hp.MISSING':1600},255],
 ['olaf_w','shield',1,1,{...SHP,'SOURCE.hp.MISSING':1400},255],
 ['olaf_w','uncapped_shield',5,18,{...SHP,'SOURCE.hp.MISSING':1000},305],
 ['olaf_w','shield',5,18,{...SHP,'SOURCE.hp.MISSING':1000},305],
 ['olaf_e','damage',1,1,AD,170],['olaf_e','health_cost',1,1,AD,68],['olaf_e','damage',5,18,AD,350],['olaf_e','health_cost',5,18,AD,140],
 ['olaf_r','active_attack_damage',1,1,AD,60],['olaf_r','active_attack_damage',3,18,AD,80]
];
for(const[skey,fkey,r,l,a,expected,inputs={}]of cases){const s=plan.skills[skey],f=s.write.formulas.find(f=>f.formulaKey===fkey);if(!f)throw Error('缺公式 '+skey+'/'+fkey);const actual=ev(s,f.expression,r,l,a,inputs);arithmetic.push({skill:skey,formula:fkey,rank:r,level:l,attributes:a,inputs,expected,actual,match:Math.abs(actual-expected)<1e-8});}
for(const[skey,key,r,expected,level]of [
 ['vi_p','shield_duration_ms',1,3000],['vi_p','cd_reduction_on_3_hit_ms',1,4000],['vi_p','shield_cooldown_ms',1,16000,1],['vi_p','shield_cooldown_ms',1,12000,9],['vi_p','shield_cooldown_ms',1,12000,10],['vi_p','shield_cooldown_ms',1,12000,18],
 ['vi_q','cooldown_ms',1,12000],['vi_q','mana_cost',5,90],['vi_q','max_damage_multiplier',1,2.5],
 ['vi_w','tooltip_percent_scale',1,.01],['vi_w','buff_duration_ms',1,4000],['vi_w','trigger_hit_count',1,3],
 ['vi_e','mana_cost',1,26],['vi_e','max_ammo',1,2],['vi_e','ammo_recharge_ms',1,12000],['vi_e','ammo_recharge_ms',5,8000],['vi_e','static_cooldown_ms',1,1000],['vi_e','attack_window_ms',1,6000],
 ['vi_r','cooldown_ms',1,140000],['vi_r','mana_cost',1,100],['vi_r','primary_knockup_ms',1,1300],['vi_r','secondary_stun_ms',1,750],
 ['olaf_p','max_stats_threshold',1,.3],['olaf_p','max_attack_speed_start',1,.5],['olaf_p','max_attack_speed_end',1,1],['olaf_p','max_lifesteal_start',1,.08],['olaf_p','max_lifesteal_end',1,.25],
 ['olaf_q','cooldown_ms',1,9000],['olaf_q','mana_cost',1,50],['olaf_q','pickup_cooldown_floor_ms',1,2500],['olaf_q','slow_ratio',1,.3],['olaf_q','slow_ratio',5,.5],
 ['olaf_w','cooldown_ms',1,16000],['olaf_w','mana_cost',1,50],['olaf_w','attack_speed_duration_ms',1,5000],['olaf_w','shield_duration_ms',1,2500],['olaf_w','max_shield_hp_threshold',1,.3],
 ['olaf_e','cooldown_ms',1,11000],['olaf_e','health_cost_ratio',1,.4],['olaf_e','champion_attack_cdr_ms',1,1000],['olaf_e','cast_time_base_ms',1,250],['olaf_e','cast_time_min_ms',1,175],
 ['olaf_r','cooldown_ms',1,100000],['olaf_r','mana_cost',1,100],['olaf_r','passive_resist',1,10],['olaf_r','passive_resist',3,20],['olaf_r','active_duration_ms',1,3000],['olaf_r','champion_hit_extension_ms',1,2500]
]){const actual=pv(plan.skills[skey],key,r,level??1);arithmetic.push({skill:skey,parameter:key,rank:r,level:level??1,expected,actual,match:Object.is(actual,expected)});}
const naive18=Math.round((16-0.5*17)*1000);arithmetic.push({skill:'vi_p',parameter:'shield_cooldown_ms',check:'18级不是简单贯穿',expected:12000,naive:naive18,actual:pv(plan.skills.vi_p,'shield_cooldown_ms',1,18),match:pv(plan.skills.vi_p,'shield_cooldown_ms',1,18)===12000&&naive18===7500});
const publicKeys={vi_q:['cooldown_ms','mana_cost'],vi_e:['mana_cost'],vi_r:['cooldown_ms','mana_cost'],olaf_q:['cooldown_ms','mana_cost'],olaf_w:['cooldown_ms','mana_cost'],olaf_e:['cooldown_ms'],olaf_r:['cooldown_ms','mana_cost']};
let reused=0,reuseFail=[];
for(const [skey,keys] of Object.entries(publicKeys)){
 for(const key of keys){
  const prev=before.skills[skey].components.parameters.find(p=>p.parameterKey===key);
  const cur=plan.skills[skey].write.parameters.find(p=>p.parameterKey===key);
  const keep=['parameterKey','name','description','valueType','valueMode','fixedValue','levelValues','sortOrder'];
  const ok=prev&&cur&&plan.skills[skey].reusedParameters.includes(key)&&keep.every(k=>JSON.stringify(prev[k])===JSON.stringify(cur[k]));
  if(ok)reused++;else reuseFail.push(skey+'/'+key);
 }
}
invariants.push({check:'公共参数完整保留12项',expected:12,actual:reused,missing:reuseFail,match:reused===12&&!reuseFail.length});
invariants.push({check:'未夹入魔腾或薇恩',keys:Object.keys(plan.skills),match:Object.keys(plan.skills).every(k=>k.startsWith('vi_')||k.startsWith('olaf_'))&&Object.keys(plan.skills).length===10});
for(const s of Object.values(plan.skills)){
 const keys={parameters:new Set(s.write.parameters.map(v=>v.parameterKey)),formulas:new Set(s.write.formulas.map(v=>v.formulaKey)),effects:new Set(s.write.effects.map(v=>v.effectKey))},missing=[];
 function walk(n){if(!n||typeof n!=='object')return;if((n.kind==='PARAMETER'||n.nodeType==='PARAMETER')&&!keys.parameters.has(n.parameterKey))missing.push(n.parameterKey);if(n.kind==='FORMULA'&&!keys.formulas.has(n.formulaKey))missing.push(n.formulaKey);if(n.actionType==='EXECUTE_EFFECT'&&!keys.effects.has(n.detail.effectKey))missing.push(n.detail.effectKey);for(const v of Object.values(n))if(v&&typeof v==='object')walk(v);}
 walk(s.write);invariants.push({skill:s.skillKey,check:'内部引用完整',missing,match:!missing.length});
 invariants.push({skill:s.skillKey,check:'施法过程有实际行为且不生成敌人命中',match:s.write.processes.every(p=>p.effectBindings.length+p.stateOperations.length>0&&p.effectBindings.every(b=>!s.write.effects.find(e=>e.effectKey===b.effectKey)?.results.some(r=>r.resultType==='DAMAGE')))});
 invariants.push({skill:s.skillKey,check:'无目标持续状态法术护盾绕过',match:s.write.effects.every(e=>e.results.every(r=>!(r.target==='TARGET'&&r.lifecycleBehavior?.moment==='PERSISTENT'&&r.resultType==='STATUS_OPERATION')))});
 const events=[];
 for(const rule of s.write.triggerRules)events.push(rule.eventSource?.eventType);
 invariants.push({skill:s.skillKey,check:'禁止假事件',events,match:events.every(t=>t==='SKILL_HIT')&&s.write.triggerRules.every(rule=>rule.eventSource?.detail?.sourceSkillKey===s.skillKey)});
}
const w=plan.skills.olaf_w.write;
invariants.push({skill:'olaf_w',check:'护盾与攻速分期限',match:w.effects.find(e=>e.effectKey==='cast_shield')?.lifecycle?.durationValue?.parameterKey==='shield_duration_ms'&&w.effects.find(e=>e.effectKey==='attack_speed')?.lifecycle?.durationValue?.parameterKey==='attack_speed_duration_ms'&&pv(plan.skills.olaf_w,'shield_duration_ms')===2500&&pv(plan.skills.olaf_w,'attack_speed_duration_ms')===5000&&w.effects.find(e=>e.effectKey==='cast_shield')!==w.effects.find(e=>e.effectKey==='attack_speed')});
invariants.push({skill:'vi_w',check:'外层0.01进入伤害公式',match:plan.skills.vi_w.write.formulas.find(f=>f.formulaKey==='damage')&&JSON.stringify(plan.skills.vi_w.write.formulas.find(f=>f.formulaKey==='damage').expression).includes('tooltip_percent_scale')&&pv(plan.skills.vi_w,'tooltip_percent_scale')===.01});
invariants.push({skill:'vi_e',check:'整次攻击不重复加一份普通攻击',match:plan.skills.vi_e.write.formulas.length===1&&plan.skills.vi_e.write.effects.every(e=>e.results.every(r=>r.resultType!=='DAMAGE'))&&pv(plan.skills.vi_e,'total_ad_ratio')===1.1});
invariants.push({skill:'olaf_e',check:'生命消耗为伤害的40%且非法力',match:pv(plan.skills.olaf_e,'health_cost_ratio')===.4&&plan.skills.olaf_e.write.effects.some(e=>e.effectKey==='health_cost'&&e.results[0].detail.attributeKey==='hp')&&!plan.skills.olaf_e.write.parameters.some(p=>p.parameterKey==='mana_cost')&&!plan.skills.olaf_e.write.effects.some(e=>e.results.some(r=>r.detail?.attributeKey==='mana'))});
invariants.push({skill:'olaf_p',check:'没有把未解码插值写成持续效果',match:plan.skills.olaf_p.write.effects.length===0&&plan.skills.olaf_p.write.triggerRules.length===0});
invariants.push({skill:'vi_q',check:'取消返还未接到普通命中',match:plan.skills.vi_q.write.triggerRules.length===0&&!plan.skills.vi_q.write.processes.some(p=>p.effectBindings.some(b=>['cancel_cooldown_ms','cancel_mana_refund_ratio'].includes(b.effectKey)))});
const sha256=createHash('sha256').update(await readFile(new URL('./前十技能候选.json',import.meta.url))).digest('hex');
const report={generatedAt:new Date().toISOString(),boundary:'仅冻结来源摘要、候选结构与独立算术；没有业务保存、数据库回读、浏览器或战斗运行证据。独立核算读取前十技能候选.json，不调用生成器生产预期。',candidateSha256:sha256,reusedPublicParameters:reused,arithmetic,invariants,failures:[...arithmetic,...invariants].filter(x=>!x.match)};
await writeFile(new URL('./前十技能独立核算.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({candidateSha256:sha256,arithmetic:arithmetic.length,invariants:invariants.length,failures:report.failures.length,reused}));
if(report.failures.length)process.exitCode=1;
