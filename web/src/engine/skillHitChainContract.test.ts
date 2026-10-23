import { describe, expect, it } from 'vitest';
import { skillHitChainSample } from '../../tests/fixtures/skillHitChain';
import { prepareSimulation } from './simulationAdapter';
import { skillHitChainContract } from './skillHitChainContract';
import { compiledSkillHitChain } from './skillHitChainResult';
import {syncSimulationSkillSources} from '../../tests/fixtures/simulationSkillSources';

describe('真实首段资格与末段实际命中门禁',()=>{
  it('生产装配分流后置即时过程，共享唯一资格，尾能力带真实门禁',async()=>{
    const {snapshot,config}=skillHitChainSample(), before=structuredClone(snapshot);
    const prepared=await prepareSimulation(snapshot,{source:{},target:{}},{source:500,target:1000});
    const binding=prepared.compileRequest.rules.skillActionBindings!.find(row=>row.skillKey===config.skill.skillKey)!;
    const parent=prepared.compileRequest.sharedProviders!.find(row=>row.providerKey===binding.providerDefinitionRef)!;
    expect(parent.processes).toHaveLength(1); expect(binding.hitBindings).toHaveLength(2);
    expect(parent.initialStateSchema!.link_eligible).toEqual({valueType:'integer',defaultValue:0,maxValue:1,durationMs:0});
    const hit=parent.abilities!.find(row=>binding.hitBindings[1]!.hitAbilityRef.endsWith(`.ability[${row.abilityKey}]`))!;
    expect(hit.castCondition).toEqual({op:'eq',args:[{op:'read',path:'provider.state.link_eligible'},{op:'const',value:1}]});
    const listener=parent.abilities!.find(row=>row.listenerSpec)!.listenerSpec!;
    expect(listener.condition).toBeUndefined(); expect(listener.operations).toHaveLength(2);
    for(const operation of listener.operations!)expect(operation.condition).toEqual({op:'min',args:[
      {op:'eq',args:[{op:'read',path:'event.skill_hit.firstContact'},{op:'const',value:1}]},
      {op:'eq',args:[{op:'read',path:'event.skill_hit.blocked'},{op:'const',value:0}]}]});
    expect(snapshot).toEqual(before);
    expect(compiledSkillHitChain(prepared.compileRequest,binding)).not.toBeNull();
  });
  it.each(['state_scope','expiry','initial','cap','initial_binding','missing_clear','tail_clear','extra_writer','missing_first','missing_blocked','post_once','post_delay','post_occupy','post_cooldown','post_extra','tail_or','tail_wrong','head_dependency','foreign_source','foreign_process','extra_rule','extra_effect','wrong_speed','mixed_speed','speed_scope','speed_duration'])(
    '拒绝借首段链扩大不完整图：%s',kind=>{
      const {config,cast,post,after,tail,speed}=skillHitChainSample();
      if(kind==='state_scope')config.internalStates[0]!.scope='TARGET';
      if(kind==='expiry')(config.internalStates[0]!.detail as {durationValue:unknown}).durationValue={kind:'FIXED',value:3000};
      if(kind==='initial')(config.internalStates[0]!.detail as {initialValue:unknown}).initialValue={kind:'FIXED',value:1};
      if(kind==='cap')(config.internalStates[0]!.detail as {maxValue:unknown}).maxValue={kind:'FIXED',value:2};
      if(kind==='initial_binding')(config.internalStates[0]!.detail as unknown as Record<string,unknown>).initialValueBinding={};
      if(kind==='missing_clear')cast.stateOperations.pop();
      if(kind==='tail_clear')cast.stateOperations[2]!.moment={momentType:'STEP_EXECUTION',stepKey:'tail',failureReason:null};
      if(kind==='extra_writer')post.stateOperations.push({...post.stateOperations[0]!,operationKey:'another'});
      if(kind==='missing_first')after.conditionGroups[0]!.conditions.shift();
      if(kind==='missing_blocked')after.conditionGroups[0]!.conditions.pop();
      if(kind==='post_once')after.oncePerUse={groupKey:'wrong',scope:'SKILL'};
      if(kind==='post_delay')post.steps[0]={...post.steps[0]!,stepType:'DELAY',detail:{delayValue:{kind:'FIXED',value:1}}};
      if(kind==='post_occupy')post.steps[0]!.occupiesAction=true;
      if(kind==='post_cooldown')post.cooldown=cast.cooldown;
      if(kind==='post_extra')after.actions.push({...after.actions[0]!,actionKey:'extra'});
      if(kind==='tail_or')tail.conditionGroups.push({...structuredClone(tail.conditionGroups[0]!),groupKey:'another'});
      if(kind==='tail_wrong')(tail.conditionGroups[0]!.conditions[0]!.detail as unknown as Record<string,unknown>).stateKey='other';
      if(kind==='head_dependency' && after.eventSource.eventType==='SKILL_HIT')after.eventSource.detail.processMoment!.requiresPriorStepKey='first';
      if(kind==='foreign_source' && after.eventSource.eventType==='SKILL_HIT')after.eventSource.detail.sourceSkillKey='foreign';
      if(kind==='foreign_process' && after.eventSource.eventType==='SKILL_HIT')after.eventSource.detail.processMoment!.processKey='foreign';
      if(kind==='extra_rule')config.triggerRules.push({...structuredClone(tail),ruleKey:'extra'});
      if(kind==='extra_effect')config.effects.push({...structuredClone(speed),effectKey:'extra'});
      if(kind==='wrong_speed' && speed.results[0]!.resultType==='ATTRIBUTE_CHANGE')speed.results[0]!.detail.attributeKey='attack_damage';
      if(kind==='mixed_speed')speed.results.push({...structuredClone(speed.results[0]!),resultKey:'extra'});
      if(kind==='speed_scope')speed.lifecycle!.instanceScope='SOURCE_TARGET';
      if(kind==='speed_duration')speed.lifecycle!.durationValue=null;
      expect(()=>skillHitChainContract(config)).toThrow('首段资格链');
    });
  it.each(['mount','owner','skill','gate','op_guard','both_first','listener_guard','matcher','extra_writer','clear','speed_expiry','speed_modifier','head_scope','tail_scope','tail_gate','extra_state'])(
    '已编译读取者拒绝近似或伪造图：%s',async kind=>{
      const {snapshot,config}=skillHitChainSample(),prepared=await prepareSimulation(snapshot,{source:{},target:{}},{source:500,target:1000});
      const compile=structuredClone(prepared.compileRequest),binding=compile.rules.skillActionBindings!.find(row=>row.skillKey===config.skill.skillKey)!;
      const parent=compile.sharedProviders!.find(row=>row.providerKey===binding.providerDefinitionRef)!;
      const listener=parent.abilities!.find(row=>row.listenerSpec)!.listenerSpec!,tail=parent.abilities!.find(row=>binding.hitBindings[1]!.hitAbilityRef.endsWith(`.ability[${row.abilityKey}]`))!;
      if(kind==='mount')compile.combatants[0]!.providers.find(row=>row.providerRef===binding.providerRef)!.definitionRef='foreign';
      if(kind==='owner')binding.source='target' as never;
      if(kind==='skill')parent.skillKey='foreign';
      if(kind==='gate')tail.castCondition={op:'const',value:1};
      if(kind==='op_guard')delete listener.operations![1]!.condition;
      if(kind==='both_first')for(const op of listener.operations!)op.condition={op:'eq',args:[{op:'read',path:'event.skill_hit.blocked'},{op:'const',value:0}]};
      if(kind==='listener_guard')listener.condition={op:'const',value:1};
      if(kind==='matcher')listener.eventMatcher.any=['ability/skill/foreign'];
      if(kind==='extra_writer')parent.processes![0]!.momentOperations[0]!.operations.push({...listener.operations![0]!});
      if(kind==='clear')parent.processes![0]!.momentOperations.pop();
      if(kind==='speed_expiry')(parent.initialStateSchema!.effect_self_speed as {durationMs:number}).durationMs=2999;
      if(kind==='speed_modifier')parent.modifiers![0]!.value={op:'const',value:.2};
      if(kind==='head_scope')parent.abilities!.find(row=>row.abilityKey==='selected_skill_hit_0')!.operations![0]!.skillHit!.candidates[0]!.spellShieldBlockScope=null;
      if(kind==='tail_scope')tail.operations![0]!.skillHit!.candidates[0]!.spellShieldBlockScope='SKILL';
      if(kind==='tail_gate')delete tail.operations![0]!.skillHit!.candidates[1]!.participationCondition;
      if(kind==='extra_state')parent.initialStateSchema!.another={valueType:'integer',defaultValue:0,maxValue:1,durationMs:0};
      expect(()=>compiledSkillHitChain(compile,binding)).toThrow('skillHitChain');
    });
  it.each(['off','zero','unplanned'])('来源%s保留完整定义但不挂资格或偷启后置规则',async kind=>{
    const {snapshot,config}=skillHitChainSample(),setting=snapshot.selection.sourceSkillSettings.find(row=>row.skillKey===config.skill.skillKey)!;
    snapshot.selection.plannedSkills=[];
    if(kind==='off')setting.enabled=false;
    if(kind==='zero')setting.skillLevel=0;
    syncSimulationSkillSources(snapshot);
    const prepared=await prepareSimulation(snapshot,{source:{},target:{}},{source:500,target:1000});
    expect(prepared.compileRequest.sharedProviders?.some(row=>row.skillKey===config.skill.skillKey)).toBe(false);
    expect(prepared.compileRequest.rules.skillActionBindings??[]).toEqual([]);
    expect(prepared.compileRequest.sharedProviders?.some(row=>row.abilities?.some(a=>a.listenerSpec?.operations?.some(op=>op.ref==='link_eligible')))).toBe(false);
    expect(config.triggerRules).toHaveLength(6);
  });
  it.each(['duration','zone','shared','slow_kind','stun_kind'])('实际装配拒绝错误有限属性和目录：%s',async kind=>{
    const {snapshot,speed}=skillHitChainSample();
    if(kind==='duration')speed.lifecycle!.durationValue={kind:'FIXED',value:2999};
    if(kind==='zone')snapshot.catalogs.modifierZones[0]!.calculationMode='FLAT_ADD';
    if(kind==='shared')speed.results[0]!.lifecycleBehavior!.stackValueMode='PER_STACK';
    if(kind==='slow_kind')snapshot.catalogs.statuses[0]!.statusKind='ROOT';
    if(kind==='stun_kind')snapshot.catalogs.statuses[1]!.statusKind='ROOT';
    await expect(prepareSimulation(snapshot,{source:{},target:{}},{source:500,target:1000})).rejects.toThrow();
  });
});
