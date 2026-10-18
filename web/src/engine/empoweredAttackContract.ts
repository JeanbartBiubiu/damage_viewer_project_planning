import type { BasicAttackPlan, CompileRequest, DamageRecord, DoneResult, EmpoweredAttackConsumption, ProcessInstanceSnapshot, RunRequest, SkillActionBinding, SkillUseRecord } from '../types/genericEngine';
import { tryFoldConstant } from './numericAdapter';

/** 从真实编译定义识别待击绑定；普通技能保持原有路径。 */
export function empoweredAttackBinding(compile: CompileRequest, binding: SkillActionBinding) {
  const definition = compile.sharedProviders?.find(row => row.providerKey === binding.providerDefinitionRef);
  if (!definition?.processes?.some(process => process.steps.some(step => step.stepType === 'EMPOWERED_BASIC_ATTACK'))) return null;
  const initial = binding.controls[0];
  const process = definition.processes.find(row => row.processKey === initial?.processKey);
  const step = process?.steps[0];
  const hit = binding.hitBindings[0];
  const owner = compile.combatants.find(actor => actor.key === binding.source);
  const mount = owner?.providers.find(row => row.providerRef === binding.providerRef);
  const abilityKey = /^source\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$/.exec(initial?.abilityRef ?? '');
  const initialAbility = definition.abilities?.find(row => row.abilityKey === abilityKey?.[2]);
  const payloadKey = /^source\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$/.exec(hit?.hitAbilityRef ?? '');
  const payload = definition.abilities?.find(row => row.abilityKey === payloadKey?.[2]);
  const windowMs = step?.windowMs && tryFoldConstant(step.windowMs);
  if (binding.controls.length !== 1 || initial?.action !== 'INITIAL' || !process || process.skillKey !== binding.skillKey
    || process.steps.length !== 1 || step?.stepType !== 'EMPOWERED_BASIC_ATTACK' || step.consumeMoment !== 'ATTACK_HIT'
    || step.occupiesAction !== false || typeof windowMs !== 'number' || !Number.isSafeInteger(windowMs) || windowMs <= 0
    || mount?.definitionRef !== definition.providerKey || abilityKey?.[1] !== binding.providerRef || initialAbility?.kind !== 'active'
    || initialAbility.skillKey !== binding.skillKey || initialAbility.processControl?.action !== 'INITIAL'
    || initialAbility.processControl.processKey !== process.processKey
    || binding.hitBindings.length !== 1 || !hit || hit.processKey !== process.processKey
    || hit.moment.momentType !== 'STEP_EXECUTION' || hit.moment.stepKey !== step.stepKey || hit.moment.failureReason != null
    || payloadKey?.[1] !== binding.providerRef || payload?.kind !== 'active' || payload.skillKey !== binding.skillKey
    || payload.operations?.length !== 1 || payload.operations[0]?.operation !== 'resolve_skill_hit'
    || payload.operations[0].skillHit?.skillKey !== binding.skillKey || !payload.operations[0].skillHit.candidates.length) {
    throw new Error(`skillActionBindings.${binding.bindingKey}: 强化待击必须保留真实同来源首次、单步骤和完整负载绑定`);
  }
  return { process, step, windowMs, hit, payload };
}

/** 只接受本次实际普攻驱动引用的完整同拥有者 INITIAL。 */
export function requireEmpoweredBasicAttack(compile: CompileRequest, plan: Pick<BasicAttackPlan, 'source' | 'target' | 'skillKey' | 'startAbilityRef' | 'hitAbilityRef' | 'initialControlAbilityRef'> | null | undefined) {
  const ref = /^source\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$/.exec(plan?.initialControlAbilityRef ?? '');
  const mount = compile.combatants.find(actor => actor.key === 'source')?.providers.find(row => row.providerRef === ref?.[1]);
  const provider = compile.sharedProviders?.find(row => row.providerKey === mount?.definitionRef);
  const initial = provider?.abilities?.find(row => row.abilityKey === ref?.[2]);
  const process = provider?.processes?.find(row => row.processKey === initial?.processControl?.processKey);
  const ownAbility = (abilityRef: string | undefined) => {
    const match = /^source\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$/.exec(abilityRef ?? '');
    return match?.[1] === ref?.[1] ? provider?.abilities?.find(row => row.abilityKey === match?.[2]) : undefined;
  };
  const start = ownAbility(plan?.startAbilityRef), hit = ownAbility(plan?.hitAbilityRef);
  if (!plan || plan.source !== 'source' || plan.target !== 'target' || !provider || provider.skillKey !== plan.skillKey
    || initial?.kind !== 'active' || initial.skillKey !== plan.skillKey || initial.processControl?.action !== 'INITIAL'
    || initial.processControl.useRefFromEvent !== true || !process || process.skillKey !== plan.skillKey || !process.cooldown
    || start?.kind !== 'active' || start.skillKey !== plan.skillKey || start.processControl
    || hit?.kind !== 'active' || hit.skillKey !== plan.skillKey || !hit.operations?.some(row => row.operation === 'resolve_skill_hit' && row.skillHit?.skillKey === plan.skillKey)
    || new Set([plan.startAbilityRef, plan.hitAbilityRef, plan.initialControlAbilityRef]).size !== 3) {
    throw new Error('empoweredAttack.basicAttack: 强化待击需要本次同拥有者真实完整普通攻击驱动，不能猜测或省略');
  }
  return plan;
}

export function sameEmpoweredAttack(left: unknown, right: unknown): left is EmpoweredAttackConsumption {
  const valid = (value: unknown): value is EmpoweredAttackConsumption => !!value && typeof value === 'object'
    && !Array.isArray(value) && Object.keys(value).sort().join(',') === 'hitRef,target,useRef'
    && ['useRef', 'hitRef', 'target'].every(key => typeof (value as Record<string, unknown>)[key] === 'string' && !!(value as Record<string, unknown>)[key]);
  return valid(left) && valid(right) && left.useRef === right.useRef && left.hitRef === right.hitRef && left.target === right.target;
}

/** 对零明细也可核对的完整快照约束；保留的普攻明细另作交叉核对。 */
export function empoweredConsumptionIssue(compile: CompileRequest, request: RunRequest, process: ProcessInstanceSnapshot): string | null {
  const binding = compile.rules.skillActionBindings?.find(row => row.source === process.owner && row.providerRef === process.providerRef);
  const contract = binding && empoweredAttackBinding(compile, binding);
  if (!contract) return process.empoweredAttack === undefined ? null : '普通过程不能伪造强化消费关联';
  const plan = requireEmpoweredBasicAttack(compile, request.driverPlan.basicAttack);
  if (process.target !== process.owner || process.repeat !== null || process.actionOccupancies.length !== 0
    || process.advanceAtMs !== process.stepStartedAtMs || process.expiresAtMs !== process.stepStartedAtMs + contract.windowMs) return '待击窗口、激活目标或占用与真实定义不符';
  if (process.stepExecutionIndex === 0) return process.empoweredAttack === undefined && process.lastExecutionAtMs === null
    && process.stepCompletedAtMs === null && process.status !== 'complete' ? null : '未消费待击不能拥有完成或消费关联';
  if (!sameEmpoweredAttack(process.empoweredAttack, process.empoweredAttack) || process.empoweredAttack.useRef === process.useKey
    || process.empoweredAttack.target !== plan.target || process.owner !== plan.source || process.stepExecutionIndex !== 1
    || process.status !== 'complete' || process.lastExecutionAtMs === null || process.lastExecutionAtMs < process.stepStartedAtMs
    || process.lastExecutionAtMs >= process.expiresAtMs || process.stepCompletedAtMs !== process.lastExecutionAtMs
    || process.finishedAtMs !== process.lastExecutionAtMs) return '消费必须关联窗口内真实下一刀且只执行并完成一次';
  return null;
}

export function empoweredDamageProcess(compile: CompileRequest, done: DoneResult, row: Pick<DamageRecord, 'abilityRef' | 'useRef' | 'empoweredAttack' | 'timeMs' | 'source' | 'target' | 'hitRef'>) {
  const binding = compile.rules.skillActionBindings?.find(binding => binding.hitBindings.some(hit => hit.hitAbilityRef === row.abilityRef));
  if (!binding || !empoweredAttackBinding(compile, binding)) return null;
  const process = done.finalSnapshot.processInstances?.find(process => process.useKey === row.useRef
    && process.providerRef === binding.providerRef && process.owner === binding.source && process.skillKey === binding.skillKey);
  return process?.status === 'complete' && process.lastExecutionAtMs === row.timeMs && row.source === process.owner
    && row.target === process.empoweredAttack?.target && row.hitRef === process.empoweredAttack?.hitRef
    && sameEmpoweredAttack(row.empoweredAttack, process.empoweredAttack) ? process : null;
}

export function empoweredUseRecordIssue(compile: CompileRequest, done: DoneResult, row: SkillUseRecord): string | null {
  const binding = compile.rules.skillActionBindings?.find(binding => binding.source === row.source && binding.providerRef === row.providerRef);
  const contract = binding && empoweredAttackBinding(compile, binding);
  if (!contract) return row.empoweredAttack === undefined ? null : '普通使用事实不能伪造强化关联';
  const process = done.finalSnapshot.processInstances?.find(process => process.useKey === row.useRef && process.owner === row.source
    && process.providerRef === binding!.providerRef && process.skillKey === binding!.skillKey && process.processKey === contract.process.processKey);
  if (!process) return '强化使用事实缺少真实原使用过程';
  const consumed = ['STEP_EXECUTED', 'RELEASED', 'STEP_COMPLETED', 'HIT', 'COMPLETED'].includes(row.kind);
  if (!consumed) return row.empoweredAttack === undefined && row.target === process.target ? null : '开始、进入或失败不能带成功消费关联';
  return process.status === 'complete' && row.timeMs === process.lastExecutionAtMs && row.target === process.empoweredAttack?.target
    && row.stepKey === contract.step.stepKey && row.stepVersion === 1 && row.executionIndex === 1
    && sameEmpoweredAttack(row.empoweredAttack, process.empoweredAttack)
    && (row.kind !== 'HIT' || row.hitRef === process.empoweredAttack?.hitRef) ? null : '成功消费事实必须保留真实普攻关联及实际目标';
}

/** 完整过程可核使用关系；未保留原普攻伤害时，不能把非空命中标识称为独立明细证明。 */
export function empoweredAttackIdentityGaps(request: RunRequest, done: DoneResult): string[] {
  const plan = request.driverPlan.basicAttack;
  if (!plan) return [];
  return (done.finalSnapshot.processInstances ?? []).filter(process => process.empoweredAttack !== undefined).flatMap(process => {
    const association = process.empoweredAttack;
    const retained = sameEmpoweredAttack(association, association) && done.damageRecords?.some(row => row.useRef === association.useRef
      && row.hitRef === association.hitRef && row.timeMs === process.lastExecutionAtMs && row.target === association.target
      && row.source === process.owner && row.abilityRef === plan.hitAbilityRef && row.empoweredAttack === undefined);
    return retained ? [] : [`强化使用 ${process.useKey} 未保留关联原普攻的伤害明细，无法独立核实命中标识；完整过程与累计仍单独核对`];
  });
}

export function inspectEmpoweredAttackFacts(compile: CompileRequest, request: RunRequest, done: DoneResult): string[] {
  const issues: string[] = [], consumed = new Set<string>(), active = new Set<string>();
  const processes = done.finalSnapshot.processInstances ?? [];
  const summaryOnly = request.outputMode === 'summary' && done.outputMode === 'summary';
  for (const process of processes) {
    const problem = empoweredConsumptionIssue(compile, request, process);
    if (problem) issues.push(`processInstances.${process.useKey}.empoweredAttack: ${problem}`);
    const binding = compile.rules.skillActionBindings?.find(row => row.source === process.owner && row.providerRef === process.providerRef);
    if (process.status === 'active' && binding && empoweredAttackBinding(compile, binding)) {
      const identity = JSON.stringify([process.owner, process.providerRef, process.processKey]);
      if (active.has(identity)) issues.push(`processInstances.${process.useKey}.empoweredAttack: 同一真实挂载过程只能有一个活动等待`);
      active.add(identity);
    }
    const association = process.empoweredAttack;
    if (!association || problem) continue;
    const plan = request.driverPlan.basicAttack!;
    const ref = /^source\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$/.exec(plan.initialControlAbilityRef)!;
    const mount = compile.combatants.find(actor => actor.key === plan.source)!.providers.find(row => row.providerRef === ref[1])!;
    const definition = compile.sharedProviders!.find(row => row.providerKey === mount.definitionRef)!;
    const initial = definition.abilities!.find(row => row.abilityKey === ref[2])!;
    const base = processes.filter(row => row.useKey === association.useRef && row.owner === plan.source && row.target === plan.target
      && row.providerRef === ref[1] && row.skillKey === plan.skillKey && row.processKey === initial.processControl!.processKey
      && row.status === 'complete' && row.cooldownStarted && row.finishedAtMs === process.lastExecutionAtMs);
    if (base.length !== 1) issues.push(`processInstances.${process.useKey}.empoweredAttack: 缺少关联普攻的真实完整过程`);
    const identity = JSON.stringify([process.owner, process.providerRef, process.processKey, association.useRef]);
    if (consumed.has(identity)) issues.push(`processInstances.${process.useKey}.empoweredAttack: 同一挂载的同一刀重复消费`);
    consumed.add(identity);
    const attack = done.attackRecords?.find(row => row.useRef === association.useRef);
    if (attack ? attack.source !== plan.source || attack.target !== association.target || attack.skillKey !== plan.skillKey
      || attack.hitAtMs !== process.lastExecutionAtMs || !attack.completed : !summaryOnly && done.recording?.attackRecordsTruncated === false) {
      issues.push(`processInstances.${process.useKey}.empoweredAttack: 关联与真实普攻明细不符`);
    }
    if (!summaryOnly && done.recording?.damageRecordsTruncated === false && !done.damageRecords?.some(row => row.useRef === association.useRef
      && row.abilityRef === plan.hitAbilityRef && row.hitRef === association.hitRef && row.timeMs === process.lastExecutionAtMs
      && row.source === plan.source && row.target === association.target && row.empoweredAttack === undefined)) {
      issues.push(`processInstances.${process.useKey}.empoweredAttack: 关联命中身份没有原普攻伤害事实`);
    }
  }
  for (const row of done.skillUseRecords ?? []) {
    const problem = empoweredUseRecordIssue(compile, done, row);
    if (problem) issues.push(`skillUseRecords.${row.useRef}.${row.kind}.empoweredAttack: ${problem}`);
  }
  for (const row of done.damageRecords ?? []) {
    const binding = compile.rules.skillActionBindings?.find(binding => binding.hitBindings.some(hit => hit.hitAbilityRef === row.abilityRef));
    const required = binding && empoweredAttackBinding(compile, binding);
    if (required || row.empoweredAttack !== undefined) {
      const process = empoweredDamageProcess(compile, done, row);
      const attack = done.attackRecords?.find(attack => attack.attackIndex === row.attackIndex);
      if (!required || !process || !Number.isSafeInteger(row.attackIndex) || row.attackIndex! <= 0
        || attack && (attack.useRef !== row.empoweredAttack?.useRef || attack.hitAtMs !== row.timeMs)) {
        issues.push(`damageRecords.${row.damageId}.empoweredAttack: 附伤必须保留原激活使用与真实普攻双身份`);
      }
    }
  }
  return issues;
}

/** 完整逐使用因果可跨零明细回溯；只证明该刀之后同刻开始的后项，不豁免其它占用。 */
export function inspectEmpoweredPredecessors(compile: CompileRequest, request: RunRequest, done: DoneResult) {
  const issues = inspectEmpoweredAttackFacts(compile, request, done);
  const successions = new Map<string, { attack: EmpoweredAttackConsumption; timeMs: number }>();
  const processes = done.finalSnapshot.processInstances ?? [], rules = request.driverPlan.automaticSkills?.rules ?? [];
  const bindings = compile.rules.skillActionBindings ?? [];
  const context = (process: ProcessInstanceSnapshot) => {
    const binding = bindings.find(row => row.source === process.owner && row.providerRef === process.providerRef
      && row.skillKey === process.skillKey && row.controls.some(control => control.action === 'INITIAL' && control.processKey === process.processKey));
    const rule = rules.find(row => row.bindingKey === binding?.bindingKey);
    return binding && rule ? { binding, rule } : null;
  };
  const needsReference = (process: ProcessInstanceSnapshot): boolean => {
    let current = context(process)?.rule, depth = 0;
    const visited = new Set<string>();
    while (current?.releaseAfterRuleKey != null && depth++ < 16) {
      if (visited.has(current.ruleKey)) return true;
      visited.add(current.ruleKey);
      const parent = rules.find(row => row.ruleKey === current!.releaseAfterRuleKey);
      const binding = bindings.find(row => row.bindingKey === parent?.bindingKey);
      if (!parent || !binding) return true;
      if (empoweredAttackBinding(compile, binding)) return true;
      current = parent;
    }
    return current?.releaseAfterRuleKey != null;
  };
  const check = (condition: boolean, use: string, message: string) => {
    if (!condition) issues.push(`processInstances.${use}.empoweredPredecessorUseRef: ${message}`);
    return condition;
  };
  const detailed = request.outputMode !== 'summary' || done.outputMode !== 'summary';
  const records = done.automaticSkillRecords ?? [];
  for (const process of processes) {
    const required = needsReference(process), ref = process.empoweredPredecessorUseRef;
    if (!required) {
      check(ref === undefined, process.useKey, '非强化自动资格链不能夹带因果引用');
      continue;
    }
    if (!check(typeof ref === 'string' && !!ref.trim(), process.useKey, '含强化消费的后项必须保留实际消费前项，不能从有限记录猜测')) continue;
    let consumer = process, root: ProcessInstanceSnapshot | undefined, valid = true;
    const chain: ProcessInstanceSnapshot[] = [], visited = new Set<string>();
    for (let depth = 0; depth < 16; depth++) {
      const own = context(consumer), parentRule = rules.find(rule => rule.ruleKey === own?.rule.releaseAfterRuleKey);
      const parentBinding = bindings.find(binding => binding.bindingKey === parentRule?.bindingKey);
      const parents = processes.filter(row => row.useKey === consumer.empoweredPredecessorUseRef);
      const parent = parents[0];
      if (!check(!!own && !!parentRule && !!parentBinding && parents.length === 1 && !!parent
        && typeof consumer.empoweredPredecessorUseRef === 'string' && !visited.has(consumer.useKey)
        && parent.useKey !== consumer.useKey && parent.owner === consumer.owner && parent.owner === parentBinding.source
        && parent.providerRef === parentBinding.providerRef && parent.skillKey === parentBinding.skillKey
        && parentBinding.controls.some(control => control.action === 'INITIAL' && control.processKey === parent.processKey)
        && parent.status === 'complete' && parent.failureReason === null && typeof parent.finishedAtMs === 'number'
        && parent.finishedAtMs <= consumer.startedAtMs, process.useKey, '每跳必须是同拥有者、真实前项绑定和已完成且先于开始的唯一使用')) { valid = false; break; }
      visited.add(consumer.useKey); chain.push(consumer);
      const consumed = records.filter(row => row.kind === 'QUALIFICATION_CONSUMED' && row.useRef === consumer.useKey);
      const started = records.filter(row => row.kind === 'STARTED' && row.useRef === consumer.useKey);
      const granted = records.filter(row => row.kind === 'QUALIFICATION_GRANTED' && row.useRef === parent!.useKey && row.relatedRuleKey === own!.rule.ruleKey);
      const recordsValid = consumed.length <= 1 && started.length <= 1 && granted.length <= 1
        && consumed.every(row => row.ruleKey === own!.rule.ruleKey && row.relatedRuleKey === parentRule!.ruleKey && row.relatedUseRef === parent!.useKey && row.timeMs === consumer.startedAtMs)
        && started.every(row => row.ruleKey === own!.rule.ruleKey && row.timeMs === consumer.startedAtMs)
        && granted.every(row => row.ruleKey === parentRule!.ruleKey && row.timeMs === parent!.finishedAtMs)
        && (!consumed[0] || !started[0] || consumed[0].sequence < started[0].sequence)
        && (!granted[0] || !consumed[0] || granted[0].sequence < consumed[0].sequence)
        && (!detailed || done.automaticSkillRecording?.truncated !== false || consumed.length === 1 && started.length === 1 && granted.length === 1);
      if (!check(recordsValid, process.useKey, '保留自动明细须按真实授予、消费、开始顺序与完整因果引用一致')) { valid = false; break; }
      if (parent!.empoweredAttack !== undefined) { root = parent; break; }
      if (!check(typeof parent!.empoweredPredecessorUseRef === 'string' && !!parent!.empoweredPredecessorUseRef, process.useKey, '因果链必须持续引用至真实强化消费')) { valid = false; break; }
      consumer = parent!;
    }
    if (!valid || !check(!!root && !visited.has(root!.useKey), process.useKey, '因果链必须无环且在16跳内到达真实强化消费')) continue;
    if (!check(empoweredConsumptionIssue(compile, request, root!) === null && sameEmpoweredAttack(root!.empoweredAttack, root!.empoweredAttack),
      process.useKey, '因果根必须保留该刀真实使用、命中和消费窗口')) continue;
    const at = root!.lastExecutionAtMs!;
    if (!issues.length && chain.every(row => row.startedAtMs === at && (row === process || row.finishedAtMs === at))) {
      successions.set(process.useKey, { attack: root!.empoweredAttack!, timeMs: at });
    }
  }
  // 汇总省略逐刀记录，同一首步边界也必须从完整过程核对，不能只在明细解释器内检查。
  if (bindings.some(binding => empoweredAttackBinding(compile, binding))) {
    const plan = requireEmpoweredBasicAttack(compile, request.driverPlan.basicAttack);
    const match = /^source\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$/.exec(plan.initialControlAbilityRef)!;
    const mount = compile.combatants.find(actor => actor.key === plan.source)!.providers.find(row => row.providerRef === match[1])!;
    const initial = compile.sharedProviders!.find(provider => provider.providerKey === mount.definitionRef)!.abilities!.find(ability => ability.abilityKey === match[2])!;
    const attacks = processes.filter(process => process.owner === plan.source && process.target === plan.target && process.providerRef === match[1]
      && process.skillKey === plan.skillKey && process.processKey === initial.processControl!.processKey);
    for (const attack of attacks) for (const consumer of processes) {
      if (!bindings.some(binding => binding.source === consumer.owner && binding.providerRef === consumer.providerRef && binding.skillKey === consumer.skillKey)) continue;
      for (const occupancy of consumer.actionOccupancies ?? []) {
        if (attack.startedAtMs < occupancy.startedAtMs || attack.startedAtMs >= (occupancy.finishedAtMs ?? occupancy.expectedEndAtMs)) continue;
        const succession = successions.get(consumer.useKey);
        check(!!succession && succession.attack.useRef === attack.useKey && succession.timeMs === attack.startedAtMs
          && occupancy.stepVersion === 1 && occupancy.startedAtMs === attack.startedAtMs && consumer.startedAtMs === attack.startedAtMs,
        consumer.useKey, '同刻占用必须由这一刀实际消费后的首步因果证明，旧轮或无关资格不能豁免');
      }
    }
  }
  if (issues.length) successions.clear();
  return { issues, successions };
}
