import type { AbilityDefinition, CompileRequest, DoneResult, GenericFormulaExpr, OperationDefinition, ProcessInstanceSnapshot, RunRequest, SkillActionBinding } from '../types/genericEngine';
import { tryFoldConstant } from './numericAdapter';
import { skillHitChainPredicate } from './skillHitChainContract';

const same = (a: unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const scalar=(value:unknown):number|null=>typeof value==='number'?value:value && typeof value==='object'?tryFoldConstant(value as GenericFormulaExpr):null;
const read=(value:GenericFormulaExpr|undefined,path:string)=>value?.op==='read' && value.path===path && Object.keys(value).length===2;
const eq=(value:GenericFormulaExpr|undefined,path:string,n:number)=>value?.op==='eq' && value.args?.length===2 && read(value.args[0],path) && scalar(value.args[1])===n;
function state(operation:OperationDefinition,key:string,n:number,condition=false){
  return operation.operation==='state_change' && operation.target==='self' && operation.ref===key && operation.valuePolicy==='set'
    && scalar(operation.amount)===n && same(operation.types,['state_scope/provider'])
    && (condition?same(operation.condition,skillHitChainPredicate()):!operation.condition);
}
function hasFirst(value:unknown):boolean{
  if(Array.isArray(value))return value.some(hasFirst);
  if(!value || typeof value!=='object')return false;
  const object=value as Record<string,unknown>;
  return object.path==='event.skill_hit.firstContact' || Object.values(object).some(hasFirst);
}
function abilityAt(input:CompileRequest,binding:SkillActionBinding,ref:string){
  const parent=input.sharedProviders?.find(row=>row.providerKey===binding.providerDefinitionRef);
  return parent?.abilities?.find(row=>ref===`source.provider[${binding.providerRef}].ability[${row.abilityKey}]`);
}
function clean(ability:AbilityDefinition){return !ability.cost && !ability.cooldown && !ability.castCondition && !ability.processControl && !ability.tickSpec && !ability.listenerSpec;}

/** 反查完整已编译资格链；错误近似图拒绝，不能凭任意castCondition放过缺接触。 */
export function compiledSkillHitChain(input:CompileRequest,binding:SkillActionBinding){
  const parent=input.sharedProviders?.find(row=>row.providerKey===binding.providerDefinitionRef);
  const possible=parent?.abilities?.filter(row=>hasFirst(row.listenerSpec?.operations))??[];
  if(!possible.length){
    const gate=binding.hitBindings[1] && abilityAt(input,binding,binding.hitBindings[1].hitAbilityRef)?.castCondition;
    // 已知两段图的分类不得依赖仍然存在的后置操作或其condition；删除守卫本身就是不完整图。
    if(parent?.processes?.[0]?.steps.length===4 && binding.hitBindings.length===2 && gate)throw new Error('skillHitChain: 后置操作缺真实首接触冻结值');
    return null;
  }
  function fail(message:string):never{throw new Error(`skillHitChain: ${message}`);}
  const mounts=input.combatants.flatMap(actor=>actor.providers.filter(row=>row.definitionRef===binding.providerDefinitionRef).map(mount=>({actor,mount})));
  if(!parent || parent.kind!=='character' || parent.skillKey!==binding.skillKey || parent.lifecycle || parent.listeners?.length
    || mounts.length!==1 || mounts[0]!.actor.key!=='source' || mounts[0]!.mount.providerRef!==binding.providerRef
    || binding.source!=='source' || binding.controls.length!==1 || binding.controls[0]!.action!=='INITIAL'
    || parent.processes?.length!==1 || binding.hitBindings.length!==2 || possible.length!==1)fail('缺少唯一真实角色挂载及首次过程');
  const process=parent.processes[0]!, steps=process.steps;
  if(process.skillKey!==binding.skillKey || process.processKey!==binding.controls[0]!.processKey || steps.length!==4
    || steps.some((row,i)=>row.stepType!==(i%2===0?'DELAY':'IMMEDIATE') || row.occupiesAction!==(i===0)))fail('完整两段过程形状不相等');
  const castDelay=steps[0]!.delayMs && tryFoldConstant(steps[0]!.delayMs),wait=steps[2]!.delayMs && tryFoldConstant(steps[2]!.delayMs);
  if(typeof castDelay!=='number' || !Number.isSafeInteger(castDelay) || castDelay<=0 || typeof wait!=='number' || !Number.isSafeInteger(wait) || wait<=0)fail('缺少核定正整数两段延时');
  const initial=abilityAt(input,binding,binding.controls[0]!.abilityRef);
  if(!initial?.processControl || initial.processControl.action!=='INITIAL' || initial.processControl.processKey!==process.processKey || initial.skillKey!==binding.skillKey)fail('首次控制不是实际过程');
  const head=binding.hitBindings[0]!,tail=binding.hitBindings[1]!;
  for(const [index,hit] of [head,tail].entries())if(hit.processKey!==process.processKey || hit.moment.momentType!=='STEP_EXECUTION'
    || hit.moment.stepKey!==steps[index?3:1]!.stepKey || hit.moment.failureReason!=null
    || (index?hit.requiresPriorHitBindingKey!==head.hitBindingKey:hit.requiresPriorHitBindingKey!=null))fail('阶段或前置绑定不属于同一过程');
  const first=abilityAt(input,binding,head.hitAbilityRef),last=abilityAt(input,binding,tail.hitAbilityRef);
  if(!first || !last || !clean(first) || !clean({...last,castCondition:undefined}) || first.kind!=='active' || last.kind!=='active'
    || first.skillKey!==binding.skillKey || last.skillKey!==binding.skillKey || first.operations?.length!==1 || last.operations?.length!==1
    || first.operations[0]!.operation!=='resolve_skill_hit' || last.operations[0]!.operation!=='resolve_skill_hit')fail('阶段能力不属于真实普通命中');
  const before=first.operations[0]!.skillHit,after=last.operations[0]!.skillHit;
  if(before?.skillKey!==binding.skillKey || after?.skillKey!==binding.skillKey || before.ruleGroups?.length || after.ruleGroups?.length
    || before.candidates.length!==2 || after.candidates.length!==2)fail('并列必要结果不完整');
  const listenerAbility=possible[0]!,listener=listenerAbility.listenerSpec!,ops=listener.operations;
  const abilities=[initial,first,last,listenerAbility];
  if(parent.abilities?.length!==4 || new Set(abilities).size!==4 || new Set(abilities.map(row=>row.abilityKey)).size!==4
    || parent.abilities.some(row=>!abilities.includes(row)))fail('父能力列表不是唯一首次、首尾命中和后置监听闭包');
  if(listenerAbility.kind!=='passive_listener' || listenerAbility.skillKey!==binding.skillKey || !clean({...listenerAbility,listenerSpec:undefined})
    || listener.condition || listener.abilityRef || listener.oncePerUse || listener.perCastThrottleMs || listener.maxTriggersPerEvent!==1
    || !same(listener.eventMatcher.all,['event/skill_hit','event/source_owner',`ability/skill/${binding.skillKey}`])
    || listener.eventMatcher.any?.length || listener.eventMatcher.none?.length || ops?.length!==2
    || ops.some(row=>!same(row.condition,skillHitChainPredicate()) || row.operation!=='state_change'))fail('后置监听不能借额外身份、条件或操作');
  const validKey=ops.find(row=>scalar((parent.initialStateSchema?.[row.ref??''] as {durationMs?:unknown}|undefined)?.durationMs)===0)?.ref;
  const field=validKey && parent.initialStateSchema?.[validKey];
  if(!validKey || !field || typeof field!=='object' || field.valueType!=='integer' || scalar(field.defaultValue)!==0 || scalar(field.maxValue)!==1
    || scalar(field.durationMs)!==0 || Object.keys(field).some(key=>!['valueType','defaultValue','maxValue','durationMs'].includes(key))
    || ops.filter(row=>state(row,validKey,1,true)).length!==1 || !eq(last.castCondition,`provider.state.${validKey}`,1))fail('资格字段或末段真实门禁不相等');
  const timed=ops.find(row=>row.ref!==validKey),speedKey=timed?.ref,speed=speedKey && parent.initialStateSchema?.[speedKey];
  if(!speedKey || !speed || typeof speed!=='object' || speed.valueType!=='integer' || scalar(speed.defaultValue)!==0 || scalar(speed.maxValue)!==1
    || scalar(speed.durationMs)!==wait || speed.refreshPolicy!=='refresh_on_write' || !state(timed!,speedKey,1,true))fail('加速有期状态和链等待不一致');
  const modifiers=parent.modifiers??[];
  const magnitude=modifiers[0]?.value.args?.[0],layers=modifiers[0]?.value.args?.[1];
  if(modifiers.length!==1 || modifiers[0]!.kind!=='attribute' || modifiers[0]!.target!=='self.attr.move_speed'
    || modifiers[0]!.valuePolicy!=='percent_add' || modifiers[0]!.condition || modifiers[0]!.value.op!=='mul'
    || modifiers[0]!.value.args?.length!==2 || typeof scalar(magnitude)!=='number' || scalar(magnitude)!<0
    || layers?.op!=='min' || layers.args?.length!==2 || scalar(layers.args[0])!==1 || !read(layers.args[1],`provider.state.${speedKey}`)
    || Object.keys(parent.initialStateSchema??{}).length!==2)fail('加速不是独立真实有限自身属性');
  const groups=process.momentOperations??[];
  if(groups.filter(row=>row.operations.some(op=>op.operation==='state_change')).length!==3)fail('开始完成失败清理缺失');
  for(const kind of ['PROCESS_START','PROCESS_COMPLETE','PROCESS_FAILURE']){
    const found=groups.filter(group=>group.moment.momentType===kind && group.moment.stepKey===null && group.moment.failureReason==null);
    if(found.length!==1 || found[0]!.operations.filter(op=>state(op,validKey,0)).length!==1
      || found[0]!.operations.some(op=>op.operation!=='state_change' && !(kind==='PROCESS_START' && op.operation==='resource_change')))fail('清理时点或字段不一致');
  }
  const allOps=[...(parent.abilities??[]).flatMap(a=>[...(a.operations??[]),...(a.listenerSpec?.operations??[])]),...groups.flatMap(g=>g.operations)];
  if(allOps.filter(op=>op.operation==='state_change' && op.ref===validKey).length!==4
    || allOps.filter(op=>op.operation==='state_change' && op.ref===speedKey).length!==1)fail('存在额外状态写入者');
  for(const c of before.candidates)if(c.participationProviderRef || c.participationCondition || c.semantic.target!=='TARGET')fail('首段结果有额外参与条件');
  if(before.candidates.filter(c=>c.semantic.resultType==='DAMAGE' && c.spellShieldBlockScope==='SKILL').length!==1
    || before.candidates.filter(c=>c.semantic.resultType==='STATUS_OPERATION' && c.semantic.statusKind==='movement_slow'
      && c.spellShieldBlockScope==='RESULT' && c.eventValueConditions?.length===1 && c.eventValueConditions[0]!.key==='blocked'
      && c.eventValueConditions[0]!.comparator==='eq' && scalar(c.eventValueConditions[0]!.value)===0).length!==1)fail('首伤与减速没有共用真实判盾');
  for(const c of after.candidates)if(c.spellShieldBlockScope!==null || c.participationProviderRef || c.eventValueConditions?.length
    || !eq(c.participationCondition??undefined,`provider.state.${validKey}`,1) || c.semantic.target!=='TARGET')fail('末段必要结果没有完整共同资格');
  if(after.candidates.filter(c=>c.semantic.resultType==='DAMAGE').length!==1
    || after.candidates.filter(c=>c.semantic.resultType==='STATUS_OPERATION' && c.semantic.statusKind==='stun').length!==1)fail('末段伤害与晕眩不完整');
  return {binding,parent,process,head,tail,validKey,speedKey,castDelay,wait};
}
export function inspectSkillHitChainStageTimes(input:CompileRequest,binding:SkillActionBinding,process:ProcessInstanceSnapshot){
  const chain=compiledSkillHitChain(input,binding);
  if(!chain)return;
  const times=[process.startedAtMs+chain.castDelay,process.startedAtMs+chain.castDelay+chain.wait];
  const index=chain.process.steps.findIndex(step=>step.stepKey===process.stepKey);
  const starts=[process.startedAtMs,times[0]!,times[0]!,times[1]!];
  const expectedExpiry=index===0?times[0]:index===2?times[1]:null;
  if(process.expiresAtMs!==expectedExpiry || index>=0 && (process.stepStartedAtMs!==starts[index]
    || (index===0 || index===2) && process.advanceAtMs!==times[index===0?0:1]))throw new Error('skillHitChain: 真实固定步骤进入时刻或原等待终点不一致');
  for(const fact of process.skillHitStages??[]){
    const index=fact.hitBindingKey===chain.head.hitBindingKey?0:fact.hitBindingKey===chain.tail.hitBindingKey?1:-1;
    if(index<0 || fact.timeMs!==times[index])throw new Error('skillHitChain: 阶段时刻不等于本次真实固定过程');
  }
  if(process.status==='complete' && (process.finishedAtMs!==times[1] || process.stepCompletedAtMs!==times[1]
    || process.lastExecutionAtMs!==times[1]))throw new Error('skillHitChain: 末段同步完成时刻不一致');
}

/** 有明细严格核因果；证据截断只能保留不可截断过程事实，不能假称已证明判盾原因。 */
export function inspectSkillHitChainResult(input:CompileRequest,request:RunRequest,done:DoneResult){
  const issues:string[]=[],identityGaps:string[]=[];
  const check=(ok:unknown,message:string)=>{if(!ok)issues.push(`skillHitChain: ${message}`);};
  for(const binding of input.rules.skillActionBindings??[]){
    let chain:ReturnType<typeof compiledSkillHitChain>;
    try{chain=compiledSkillHitChain(input,binding);}catch(error){issues.push(String(error));continue;}
    if(!chain)continue;
    for(const process of done.finalSnapshot.processInstances??[]){
      if(process.providerRef!==binding.providerRef || process.owner!==binding.source || process.skillKey!==binding.skillKey)continue;
      try{inspectSkillHitChainStageTimes(input,binding,process);}catch(error){issues.push(String(error));continue;}
      const manual=request.driverPlan.skillActions?.filter(row=>row.action==='INITIAL' && row.bindingKey===binding.bindingKey && row.firstAtMs===process.startedAtMs
        && row.source===process.owner && row.target===process.target && process.useKey===`skill:${row.instructionKey}`)??[];
      const automatic=request.driverPlan.automaticSkills?.rules.filter(row=>row.bindingKey===binding.bindingKey && row.target===process.target)??[];
      const auto=automatic.length===1?automatic[0]:undefined;
      const prefix=auto?`skill:auto_${auto.ruleKey}_`:'';
      const ordinal=auto && process.useKey.startsWith(prefix)?Number(process.useKey.slice(prefix.length)):NaN;
      const max=done.automaticSkillSummary?.attemptCount;
      check(manual.length===1 || auto && Number.isSafeInteger(ordinal) && ordinal>=1 && process.useKey===prefix+ordinal
        && typeof max==='number' && ordinal<=max,'过程不是本次新鲜INITIAL实际使用');
      const head=process.skillHitStages?.find(row=>row.hitBindingKey===chain!.head.hitBindingKey),tail=process.skillHitStages?.find(row=>row.hitBindingKey===chain!.tail.hitBindingKey);
      for(const row of done.evidence.items.filter(row=>row.kind==='skill_hit' && row.data?.useRef===process.useKey)){
        const fact=row.ref===chain.head.hitAbilityRef?head:row.ref===chain.tail.hitAbilityRef?tail:undefined;
        check(fact?.contact && fact.timeMs===row.timeMs && row.data?.skillKey===binding.skillKey
          && row.data?.source===process.owner && row.data?.target===process.target,'无接触阶段或错误身份不能保留真实命中证据');
      }
      if(!head?.contact || !head.completed || !tail?.released || !tail.completed)continue;
      const presets=manual[0]?.hitBindings??auto?.hitBindings;
      if(presets?.find(row=>row.hitBindingKey===chain!.tail.hitBindingKey)?.preset!=='TARGET_HIT')continue;
      const evidence=done.evidence.items;
      const heads=evidence.filter(row=>row.kind==='skill_hit' && row.timeMs===head.timeMs && row.ref===chain!.head.hitAbilityRef
        && row.data?.useRef===process.useKey && row.data?.skillKey===binding.skillKey && row.data?.source===process.owner && row.data?.target===process.target);
      if(heads.length>1){check(false,'同阶段首段判盾证据重复');continue;}
      if(!heads.length){
        if(done.outputMode!=='summary' && !done.evidence.truncated)check(false,'首段缺少唯一同使用完整判盾冻结证据');
        else identityGaps.push(`skillHitChain.${process.useKey}: 首段判盾证据已截断，不能独立验证尾段跳过原因`);
        continue;
      }
      const data=heads[0]!.data!;
      check(data.firstContact===1 && (data.blocked===0 || data.blocked===1),'首段冻结值不完整');
      if(data.blocked===0)check(tail.contact,'已挂链末段不能缺接触');
      if(data.blocked===1){
        check(!tail.contact,'首盾阻挡不能发布尾接触');
        const original=manual[0]?.instructionKey??(auto && process.useKey.slice('skill:'.length));
        // 同一真实INITIAL的命中尝试序号连续递增；首段已实际接触，因此尾段恰为第2次。
        const entryKey=`${original}:${chain.tail.hitBindingKey}:2__native_hit`;
        const skips=evidence.filter(row=>row.kind==='attempt_skipped' && row.timeMs===tail.timeMs && row.ref===chain!.tail.hitAbilityRef);
        if(skips.length)check(skips.length===1 && skips[0]!.data?.source===process.owner && skips[0]!.data?.target===process.target
          && skips[0]!.data?.entryKey===entryKey && skips[0]!.data?.skipReason==='condition_false','尾段跳过证据身份、指令或原因错误');
        else if(done.outputMode!=='summary' && !done.evidence.truncated)check(false,'缺少真实尾段条件跳过证据');
        else identityGaps.push(`skillHitChain.${process.useKey}: 尾段跳过证据已截断`);
      }
    }
  }
  return {issues,identityGaps};
}
