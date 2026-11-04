import {describe,it,expect} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {loadMechanismCases} from '../../tests/mechanisms/mechanismCase';
import {mechanismEngine,runMechanismCase,compareMechanismExpectation} from '../../tests/mechanisms/mechanismRunner';
import {prepareSimulation} from './simulationAdapter';
import {preflightSkillFormulas} from './skillFormulaPreflight';
import {skillActionRequest} from './skillActionRequest';
import {automaticSkillRequest} from './automaticSkillRequest';
import {assessSkillActionResult} from './skillActionResult';
import {assessAutomaticSkillResult} from './automaticSkillResult';
import type {GenericEngineClient} from './genericEngineClient';
import type {DoneResult} from '../types/genericEngine';
import {inspectSkillHitChainResult} from './skillHitChainResult';
import {compiledSkillHitChain} from './skillHitChainResult';
import {WASM_IDENTITY} from './wasmIdentity';

const directory=new URL(`../../output/morgana-r-web/runtime-${Date.now()}/`,import.meta.url);
mkdirSync(directory,{recursive:true});
const write=(name:string,value:unknown)=>writeFileSync(new URL(`${name}.json`,directory),JSON.stringify(value,null,2)+'\n');
const cases=loadMechanismCases().filter(row=>row.caseKey.startsWith('hit_chain_'));
const basis=cases.find(row=>row.caseKey==='hit_chain_manual')!;
const zeroRecord={maxSkillActionRecords:0,maxSkillUseRecords:0,maxHealingRecords:0};
async function fresh(name:string,mode:'manual'|'auto',shield=false,zero=false,summary=false){
  const {client:node,wasmSha256,wasmBytes}=await mechanismEngine(),client=node as unknown as GenericEngineClient;
  expect({sha256:wasmSha256,bytes:wasmBytes}).toEqual({sha256:WASM_IDENTITY.sha256,bytes:WASM_IDENTITY.bytes});
  const snapshot=basis.buildSnapshot();
  await preflightSkillFormulas(snapshot,client,()=>true);
  const prepared=await prepareSimulation(snapshot,{source:{},target:{}},{source:500,target:1000});
  const plan=snapshot.selection.plannedSkills[0]!, common={durationMs:3351,recordTimeSeries:false,attackSpeedInputMax:1,maxHealingRecords:1000,maxResourceChangeRecords:1000};
  const built=mode==='manual'?await skillActionRequest(prepared,snapshot,{...common,actions:basis.scenario.actions!,maxSkillActionRecords:1000,maxSkillUseRecords:1000})
    :await automaticSkillRequest(prepared,snapshot,{...common,rules:[{origin:plan.origin,skillKey:plan.skillKey,skillLevel:1,ruleKey:'chain',sortOrder:0,targetSide:'target',hitPreset:'TARGET_HIT',waitForCooldowns:[],releaseAfterRuleKey:null}],maxAutomaticSkillRecords:zero?0:1000,outputMode:summary?'summary':'detailed'});
  const request=built.runRequest;
  if(shield){
    // 既有Generic法盾合法初始挂载探针；不代表管理SPELL_SHIELD初始化结果已接入。
    const compile=prepared.compileRequest;
    compile.typeCatalog.types.push({key:'provider/spell_shield',domain:'provider'});
    compile.sharedProviders!.push({providerKey:'initial_shield_probe_definition',kind:'character',stableId:'initial_shield_probe',types:['provider/spell_shield']});
    compile.combatants.find(row=>row.key==='target')!.providers.push({providerRef:'initial_shield_probe',definitionRef:'initial_shield_probe_definition'});
    request.initialSnapshot.combatants.find(row=>row.key==='target')!.providers.push({providerRef:'initial_shield_probe',definitionRef:'initial_shield_probe_definition',source:'target',owner:'target',stacks:1,expireAt:null,state:{}});
  }
  const compiled=await client.compile(prepared.compileRequest);
  write(`${name}-compile`,{compiled,compile:prepared.compileRequest});
  if(!compiled.ok || !compiled.sessionId)throw new Error(JSON.stringify(compiled));
  const sessionId=compiled.sessionId;
  try{
    request.sessionId=sessionId;
    if(zero)request.recordBudget={...request.recordBudget,...zeroRecord};
    const done=await client.run(request),repeated=await client.run(request);
    const assessment=mode==='manual'?assessSkillActionResult(prepared.compileRequest,request,done,prepared.operationOrigins):assessAutomaticSkillResult(prepared.compileRequest,request,done,prepared.operationOrigins);
    write(name,{boundary:shield?'production adapter基础 + 独立Generic初盾探针':'production adapter',prepared,request,done,assessment,replayEqual:JSON.stringify(done)===JSON.stringify(repeated),wasmSha256});
    expect(repeated).toEqual(done);
    return {prepared,request,done,assessment};
  }finally{const released=await client.release(sessionId,prepared.compileRequest.rulesHash);write(`${name}-release`,released);expect(released.released).toBe(true);}
}

describe('真实首接触资格链：正式Wasm及宿主因果验证',()=>{
  it.each(cases.map(row=>[row.caseKey,row] as const))('%s固定首冻逐项、两次同会话与释放',async(key,definition)=>{
    const run=await runMechanismCase(definition);write(key,run);
    expect(compareMechanismExpectation(run.projection,definition.expected)).toEqual([]);
    if(key==='hit_chain_disabled' || key==='hit_chain_zero'){
      expect(run.prepared.compileRequest.rules.skillActionBindings??[]).toEqual([]);
      expect(run.done.finalSnapshot.combatants[0]!.providers.some(row=>row.providerRef===run.prepared.skillOrigins.find(row=>row.skillKey==='sample_active')?.providerRef)).toBe(false);
      return;
    }
    const process=run.done.finalSnapshot.processInstances!.find(row=>row.skillKey==='sample_active')!;
    const parent=run.done.finalSnapshot.combatants[0]!.providerState[process.providerRef] as {state:Record<string,unknown>;expireAt:Record<string,number>};
    expect(parent.state.link_eligible).toBe(key==='hit_chain_before_expiry'?1:0);
    if(key==='hit_chain_before_expiry'){
      expect(parent.expireAt.effect_self_speed).toBe(3350);
      const changed=structuredClone(run.done),wait=changed.finalSnapshot.processInstances!.find(row=>row.skillKey==='sample_active')!;
      wait.stepStartedAtMs++;wait.advanceAtMs++;
      expect(assessSkillActionResult(run.prepared.compileRequest,run.runRequest,changed,run.prepared.operationOrigins).complete).toBe(false);
    }
    if(key==='hit_chain_manual'){
      const actual=run.done.damageRecords!.filter(row=>row.operationRef.includes('skills.sample_active.'));
      expect(actual.map(row=>[row.timeMs,row.rawAmount,row.postDefenseDamage])).toEqual([[350,100,100],[3350,100,100]]);
      expect(actual[0]!.castInstanceId).toBe(actual[1]!.castInstanceId);
      expect(run.done.evidence.items.filter(row=>row.kind==='skill_hit' && row.data?.skillKey==='sample_active').map(row=>[row.data!.firstContact,row.data!.blocked])).toEqual([[1,0],[0,0]]);
    }
    if(key==='hit_chain_current_ap')expect(run.done.damageRecords!.filter(row=>row.operationRef.includes('skills.sample_active.')).map(row=>[row.timeMs,row.rawAmount,row.postDefenseDamage])).toEqual([[350,100,100],[3350,180,180]]);
  });
  it.each(['manual','auto'] as const)('%s首盾真实尾released但门禁拒空HIT，外部哨兵只有首接触一次',async mode=>{
    const {done,assessment}=await fresh(`first-shield-${mode}`,mode,true);
    expect(assessment.issues).toEqual([]);expect(assessment.complete).toBe(true);
    expect(done.summary.sourceDamageDealt).toBe(45);expect(done.summary.targetFinalHp).toBe(955);
    expect(done.summary.skillUses).toMatchObject({startedCount:1,releasedCount:2,hitCount:1,completedCount:1});
    expect(done.finalSnapshot.processInstances!.find(row=>row.skillKey==='sample_active')!.skillHitStages).toMatchObject([{timeMs:350,released:true,contact:true,completed:true},{timeMs:3350,released:true,contact:false,completed:true}]);
    expect(done.evidence.items.filter(row=>row.kind==='skill_hit' && row.data?.skillKey==='sample_active')).toHaveLength(1);
    expect(done.damageRecords!.filter(row=>row.operationRef.includes('skills.chain_witness.'))).toHaveLength(1);
    expect(done.summary.attemptSkippedCount).toBe(0);
    expect((done.mechanicRecords??[]).filter(row=>row.stateKey==='link_eligible' && row.afterValue===1)).toEqual([]);
  });
  it.each(['manual','auto'] as const)('%s零技能明细保留真实阶段与充分判盾证据',async mode=>{
    const {done,assessment}=await fresh(`record-zero-${mode}`,mode,true,true);
    expect((done.skillUseRecords??[]).length).toBe(0);expect(assessment.issues).toEqual([]);expect(assessment.complete).toBe(true);
    expect(done.summary.sourceDamageDealt).toBe(45);expect(done.finalSnapshot.processInstances!.find(row=>row.skillKey==='sample_active')!.skillHitStages).toHaveLength(2);
  });
  it('实际summary省略全部事件时只认可有限过程事实并显式身份缺口',async()=>{
    const {done,assessment}=await fresh('all-summary','auto',true,true,true);
    expect(done.outputMode).toBe('summary');expect(done.evidence.items).toEqual([]);
    expect(assessment.issues).toEqual([]);expect(assessment.complete).toBe(true);expect(assessment.detailIdentityVerified).toBe(false);
    expect(assessment.identityGaps.some(row=>row.startsWith('skillHitChain.'))).toBe(true);
  });
  it('有充分原档时拒绝伪造接触、首盾、时刻、使用及跳过原因',async()=>{
    const base=await fresh('mutation-base','manual',true);
    expect(base.assessment.issues).toEqual([]);
    const checks=[];
    for(const kind of ['tail_contact','head_unblocked','head_first','head_use','head_owner','head_ref','duplicate_head','tail_time','finished_time','use_alias','skip_reason','skip_entry','skip_owner','extra_tail_event']){
      const done:DoneResult=structuredClone(base.done),process=done.finalSnapshot.processInstances!.find(row=>row.skillKey==='sample_active')!;
      const head=done.evidence.items.find(row=>row.kind==='skill_hit' && row.data?.skillKey==='sample_active')!;
      const skip=done.evidence.items.find(row=>row.kind==='attempt_skipped')!;
      if(kind==='tail_contact')process.skillHitStages![1]!.contact=true;
      if(kind==='head_unblocked')head.data!.blocked=0;
      if(kind==='head_first')head.data!.firstContact=0;
      if(kind==='head_use')head.data!.useRef='foreign';
      if(kind==='head_owner')head.data!.source='target';
      if(kind==='head_ref')head.ref='foreign';
      if(kind==='duplicate_head')done.evidence.items.push(structuredClone(head));
      if(kind==='tail_time')process.skillHitStages![1]!.timeMs=3349;
      if(kind==='finished_time'){process.stepCompletedAtMs=3351;process.finishedAtMs=3351;}
      if(kind==='use_alias')process.useKey='old';
      if(kind==='skip_reason')skip.data!.skipReason='cooldown';
      if(kind==='skip_entry')skip.data!.entryKey='foreign';
      if(kind==='skip_owner')skip.data!.source='target';
      if(kind==='extra_tail_event')done.evidence.items.push({...structuredClone(head),timeMs:3350,ref:base.prepared.compileRequest.rules.skillActionBindings![0]!.hitBindings[1]!.hitAbilityRef});
      const result=assessSkillActionResult(base.prepared.compileRequest,base.request,done,base.prepared.operationOrigins);
      checks.push({kind,rejected:!result.complete,issues:result.issues});expect(result.complete,kind).toBe(false);
    }
    write('result-mutations',checks);
    const truncated=structuredClone(base.done);truncated.evidence.items=[];truncated.evidence.truncated=true;
    const partial=inspectSkillHitChainResult(base.prepared.compileRequest,base.request,truncated);
    expect(partial.issues).toEqual([]);expect(partial.identityGaps.length).toBeGreaterThan(0);
  });
  it.each([['manual',true],['auto',true],['manual',false],['auto',false]] as const)(
    '%s首盾=%s：同一真实DONE的编译图双删后置条件必须拒绝，不能分类回落',async(mode,shield)=>{
      const key=`double-guard-remove-${mode}-${shield}`,base=await fresh(key,mode,shield);
      expect(base.assessment.complete).toBe(true);
      const compile=structuredClone(base.prepared.compileRequest),binding=compile.rules.skillActionBindings!.find(row=>row.skillKey==='sample_active')!;
      const parent=compile.sharedProviders!.find(row=>row.providerKey===binding.providerDefinitionRef)!;
      const operations=parent.abilities!.find(row=>row.listenerSpec)!.listenerSpec!.operations!;
      expect(operations).toHaveLength(2);
      for(const operation of operations)delete operation.condition;
      const result=mode==='manual'?assessSkillActionResult(compile,base.request,base.done,base.prepared.operationOrigins)
        :assessAutomaticSkillResult(compile,base.request,base.done,base.prepared.operationOrigins);
      const inspection=inspectSkillHitChainResult(compile,base.request,base.done);
      let classified='returned';try{compiledSkillHitChain(compile,binding);}catch{classified='rejected';}
      write(`${key}-mutation`,{boundary:'仅在内存双删compile条件，复用该同档真实DONE，不重跑变异程序',compile,inspection,result,classified});
      expect(result.complete).toBe(false);expect(result.factsValid).toBe(false);
      expect(inspection.issues.length).toBeGreaterThan(0);expect(classified).toBe('rejected');
    });
  it.each([['manual',true],['auto',true],['manual',false],['auto',false]] as const)(
    '%s首盾=%s：同一真实DONE的父能力列表不得夹带额外周期能力',async(mode,shield)=>{
      const key=`extra-parent-tick-${mode}-${shield}`,base=await fresh(key,mode,shield);
      expect(base.assessment.complete).toBe(true);
      const checks=[];
      for(const writesState of [true,false]){
        const compile=structuredClone(base.prepared.compileRequest),binding=compile.rules.skillActionBindings!.find(row=>row.skillKey==='sample_active')!;
        const chain=compiledSkillHitChain(compile,binding)!;
        expect(chain).not.toBeNull();
        chain.parent.abilities!.push({abilityKey:'extra_parent_tick',skillKey:binding.skillKey,kind:'tick',
          tickSpec:{intervalMs:100000,startDelayMs:1000,onTick:writesState?[{operation:'state_change',target:'self',ref:chain.validKey,
            valuePolicy:'set',amount:{op:'const',value:1},types:['state_scope/provider']}]:[]}});
        const result=mode==='manual'?assessSkillActionResult(compile,base.request,base.done,base.prepared.operationOrigins)
          :assessAutomaticSkillResult(compile,base.request,base.done,base.prepared.operationOrigins);
        const inspection=inspectSkillHitChainResult(compile,base.request,base.done);
        let classified='returned';try{compiledSkillHitChain(compile,binding);}catch{classified='rejected';}
        checks.push({writesState,compile,inspection,result,classified});
      }
      write(`${key}-mutations`,{boundary:'仅在内存compile追加额外周期能力，复用该同档真实DONE，不重跑变异程序',checks});
      for(const {writesState,result,inspection,classified} of checks){
        expect(result.complete,`writesState=${writesState}`).toBe(false);expect(result.factsValid).toBe(false);
        expect(inspection.issues.length).toBeGreaterThan(0);expect(classified).toBe('rejected');
      }
    });
});
