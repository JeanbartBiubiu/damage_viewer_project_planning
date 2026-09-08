import assert from 'node:assert/strict';
export function arithmetic(objects){
  const checks=[];
  const subject=key=>{const o=objects.find(x=>x.skillKey===key);assert.ok(o,key);return o.apiPayload;};
  const check=(name,actual,expected)=>{const match=Number.isFinite(actual)&&Math.abs(actual-expected)<1e-9;checks.push({name,actual,expected,match});};
  function value(node,s,inputs,attributes){
    if(node.nodeType==='PARAMETER'){const p=s.parameters.find(x=>x.parameterKey===node.parameterKey);assert.ok(p);if(p.valueMode==='FIXED')return p.fixedValue;assert.equal(p.valueMode,'RUNTIME_INPUT');assert.equal(p.valueType,'DECIMAL');assert.ok(Object.hasOwn(inputs,p.parameterKey));return inputs[p.parameterKey];}
    if(node.nodeType==='ATTRIBUTE'){assert.equal(node.attributeOwner,'SOURCE');assert.equal(node.attributeValueKind,'TOTAL');assert.ok(Object.hasOwn(attributes,node.attributeKey));return attributes[node.attributeKey];}
    assert.equal(node.nodeType,'OPERATION');assert.equal(node.operation,'MULTIPLY');return node.operands.reduce((n,x)=>n*value(x,s,inputs,attributes),1);
  }
  function formula(skill,key,inputs={},attributes={}){const s=subject(skill),f=s.formulas.find(x=>x.formulaKey===key);assert.ok(f,key);return value(f.expression,s,inputs,attributes);}
  const expected={item_3142_passive:{melee_out_of_combat_move_speed:20,ranged_out_of_combat_move_speed:10},item_3142_active:{melee_move_speed_ratio:.2,ranged_move_speed_ratio:.15,melee_duration_ms:6000,ranged_duration_multiplier:.667,cooldown_ms:45000},item_3144_passive:{magic_damage:40,cooldown_ms:40000,cooldown_reduction_ms_per_attack:1000},item_3802_passive:{max_mana_restore_ratio:.2,restoration_duration_ms:3000},item_3070_passive:{max_mana_per_hit:3,max_accumulated_mana:360,charge_recovery_ms:8000,max_charges:4,champion_hit_multiplier:2},item_3077_active:{total_attack_damage_ratio:.75,cooldown_ms:10000}};
  for(const [skill,params]of Object.entries(expected))for(const [key,want]of Object.entries(params)){const p=subject(skill).parameters.find(x=>x.parameterKey===key);assert.ok(p);assert.equal(p.valueMode,'FIXED');check(`${skill}/${key}`,p.fixedValue,want);}
  check('幽梦远程持续时间',formula('item_3142_active','ranged_duration_ms'),4002);
  for(const n of [0,1,100,1000.25,5000])check(`章节明确输入${n}`,formula('item_3802_passive','total_mana_restoration',{max_mana_for_restoration:n}),n*.2);
  check('泪合法英雄技能命中的独立数值',formula('item_3070_passive','champion_hit_max_mana'),6);
  for(const n of [0,1,25,100,200.5,500])check(`提亚总攻击力${n}`,formula('item_3077_active','active_physical_damage',{}, {attack_damage:n}),n*.75);
  assert.equal(checks.length,32);return checks;
}
