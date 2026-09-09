import assert from 'node:assert/strict';
export function verifyMath(skills,binding){
 const source=binding.heroes.find(h=>h.id==='Zoe').skills;
 const dv=(s,k,l)=>{const x=s.dataValues.find(v=>v.name===k);assert(x,k);return x.values[l];};
 const evalTree=(n,p,ap)=>{if(n.nodeType==='PARAMETER'){assert(p[n.parameterKey]!==undefined&&p[n.parameterKey]!==null,'缺失参数 '+n.parameterKey);return p[n.parameterKey];}if(n.nodeType==='ATTRIBUTE'){assert.equal(n.attributeOwner,'SOURCE');assert.equal(n.attributeKey,'ability_power');assert.equal(n.attributeValueKind,'TOTAL');assert(Number.isFinite(ap),'缺失法强');return ap;}assert.equal(n.nodeType,'OPERATION');const values=n.operands.map(x=>evalTree(x,p,ap));if(n.operation==='ADD')return values.reduce((a,b)=>a+b);if(n.operation==='MULTIPLY')return values.reduce((a,b)=>a*b);throw Error('未审核运算 '+n.operation);};
 const rows=[];
 for(const[skillKey,s]of Object.entries(skills))for(const f of s.write.formulas){
  const src=source.find(x=>x.skillKey===skillKey);assert(src);
  const expected=(level,ap,runtime)=>{
   if(skillKey==='zoe_p')return runtime.char_level_base_damage+dv(src,'APRatio',1)*ap;
   if(skillKey==='zoe_q'){const min=dv(src,'BaseDamage',level)+runtime.char_level_bonus_damage+dv(src,'APRatio',level)*ap;return f.formulaKey==='max_damage'?src.calculations.MaxDamageTooltip.mMultiplier.mNumber*min:min;}
   if(skillKey==='zoe_w')return dv(src,'TotalBaseDamage',level)+dv(src,'TotalAPRatio',level)*ap;
   if(skillKey==='zoe_e')return dv(src,'BaseDamage',level)+src.calculations[f.formulaKey==='damage'?'TotalDamageTooltip':'BreakDamageTooltip'].mFormulaParts[1].mCoefficient*ap;
   throw Error('未审核技能 '+skillKey);
  };
  for(const [level,ap,baseInput]of [[1,100,16],[5,173,42]]){
   const runtime={char_level_base_damage:baseInput,char_level_bonus_damage:level===1?2:8},params={};
   for(const p of s.write.parameters){if(p.valueMode==='FIXED')params[p.parameterKey]=p.fixedValue;else if(p.valueMode==='SKILL_LEVEL')params[p.parameterKey]=p.levelValues[level];else {assert.equal(p.valueMode,'RUNTIME_INPUT');assert.equal(p.fixedValue,null);assert.equal(p.levelValues,null);if(Object.hasOwn(runtime,p.parameterKey))params[p.parameterKey]=runtime[p.parameterKey];}}
   const actual=evalTree(f.expression,params,ap),want=expected(level,ap,runtime);assert(Math.abs(actual-want)<0.0001,skillKey+'/'+f.formulaKey);rows.push({skillKey,formulaKey:f.formulaKey,level,abilityPower:ap,runtimeInputs:runtime,actual,sourceExpected:want,passed:true});
   if(level===1){assert.throws(()=>evalTree(f.expression,params,undefined));rows.push({skillKey,formulaKey:f.formulaKey,case:'缺少来源法强拒绝',passed:true});const runtimeKey=s.write.parameters.find(p=>p.valueMode==='RUNTIME_INPUT')?.parameterKey;if(runtimeKey){delete params[runtimeKey];assert.throws(()=>evalTree(f.expression,params,ap));rows.push({skillKey,formulaKey:f.formulaKey,case:'缺少等级实际输入拒绝',passed:true});}}
  }
 }
 assert.equal(rows.filter(x=>x.actual!==undefined).length,12);assert.equal(rows.length,21);
 for(const key of ['zoe_q','zoe_e','zoe_r']){const s=skills[key];assert.equal(s.write.effects.length,1);const result=s.write.effects[0].results[0];assert.equal(result.resultType,'RESOURCE_CHANGE');assert.equal(result.target,'SOURCE');assert.equal(result.detail.attributeKey,'mana');assert.equal(result.detail.operation,'CONSUME');assert.equal(result.valueRule.value.parameterKey,'mana_cost');}
 assert(!skills.zoe_e.write.parameters.some(p=>['trap_duration_ms','sleep_duration_ms','brittle_linger_ms','cast_time_ms'].includes(p.parameterKey)));
 return {formulaCount:6,formulaCases:12,missingInputRejections:9,checks:21,resourceEffects:3,passed:true,rows};
}
