import type { CompileRequest, DamageRecord, DoneResult, EmpoweredAttackWindow, ProcessInstanceSnapshot, RunRequest, SkillUseRecord } from '../types/genericEngine';

type WindowContract = { maximumAttackCount: number | null; windowMs: number; step: { stepKey: string } };
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const exact = (row: unknown, keys: readonly string[]): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row)
  && Object.keys(row).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(row, key));

export function empoweredWindowIssue(compile: CompileRequest, request: RunRequest, process: ProcessInstanceSnapshot, contract: WindowContract): string | null {
  const window = process.empoweredAttackWindow, deadline = process.stepStartedAtMs + contract.windowMs;
  if (!exact(window, ['maximumAttackCount', 'consumptionCount', 'pendingHitCount', 'consumptions'])
    || window.maximumAttackCount !== contract.maximumAttackCount || !integer(window.consumptionCount)
    || window.consumptionCount > window.maximumAttackCount || !integer(window.pendingHitCount) || !Array.isArray(window.consumptions)
    || window.consumptions.length !== window.consumptionCount || process.empoweredAttack !== undefined
    || process.target !== process.owner || process.repeat !== null || process.actionOccupancies.length !== 0
    || process.stepKey !== contract.step.stepKey || process.stepVersion !== 1 || process.stepExecutionIndex !== 0 || process.lastExecutionAtMs !== null
    || process.advanceAtMs !== process.stepStartedAtMs || process.expiresAtMs !== deadline) return '发动窗口须保留完整有界配额，步骤定时身份不能充当消费计数';
  const plan = request.driverPlan.basicAttack;
  if (!plan || plan.source !== process.owner) return '发动窗口缺少本场真实同拥有者普攻驱动';
  const uses = new Set<string>();
  let pending = 0, previous = process.stepStartedAtMs;
  for (const [index, row] of window.consumptions.entries()) {
    if (!exact(row, ['consumptionIndex', 'useRef', 'target', 'startedAtMs', 'hitRef', 'hitSequence', 'resolvedAtMs'])
      || row.consumptionIndex !== index + 1 || !text(row.useRef) || row.useRef === process.useKey || uses.has(row.useRef)
      || row.target !== plan.target || !integer(row.startedAtMs) || row.startedAtMs < previous || row.startedAtMs >= deadline
      || row.startedAtMs > doneTime(request) || !((row.hitRef === null && row.hitSequence === null)
        || text(row.hitRef) && integer(row.hitSequence) && row.hitSequence > 0)
      || !(row.resolvedAtMs === null ? row.hitRef === null : integer(row.resolvedAtMs) && row.resolvedAtMs >= row.startedAtMs
        && row.resolvedAtMs <= doneTime(request))) return '每份消费须保留连续序号及窗口内唯一真实发动，命中或未命中终结不能猜测';
    uses.add(row.useRef); previous = row.startedAtMs;
    if (row.resolvedAtMs === null) pending++;
  }
  if (window.pendingHitCount !== pending) return '待命中数量必须等于仍未真实终结的消费份数';
  if (process.status === 'complete') {
    const at = window.consumptionCount === window.maximumAttackCount ? window.consumptions[window.consumptions.length - 1]?.startedAtMs : deadline;
    if (process.finishedAtMs !== at || process.stepCompletedAtMs !== at || process.failureReason !== null) return '窗口只能在最后一次真实发动或期限正常完成，完成不能提前宣称命中';
  } else if (process.status === 'active') {
    if (window.consumptionCount === window.maximumAttackCount || process.stepCompletedAtMs !== null || process.finishedAtMs !== null) return '用尽配额必须同帧完成，活动窗口不能保留完成标记';
  }
  // 实际原使用定义仍从本次不可变普攻INITIAL解析，不能借同名其它过程。
  const ref = /^(source|target)\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$/.exec(plan.initialControlAbilityRef ?? '');
  const mount = compile.combatants.find(actor => actor.key === plan.source)?.providers.find(mount => mount.providerRef === ref?.[2]);
  const provider = compile.sharedProviders?.find(provider => provider.providerKey === mount?.definitionRef);
  if (ref?.[1] !== plan.source || provider?.abilities?.find(ability => ability.abilityKey === ref?.[3])?.processControl?.action !== 'INITIAL') return '消费没有真实普攻首次过程';
  return null;
}
function doneTime(request: RunRequest) { return request.stopPolicy.durationMs; }

export function empoweredWindowConsumption(process: ProcessInstanceSnapshot,
  row: Pick<DamageRecord, 'empoweredAttack' | 'timeMs' | 'source' | 'target' | 'hitRef'>) {
  const association = row.empoweredAttack;
  if (!exact(association, ['useRef', 'hitRef', 'target']) || !text(association.useRef) || !text(association.hitRef)
    || row.source !== process.owner || row.target !== association.target
    || row.hitRef !== association.hitRef) return null;
  const matching = process.empoweredAttackWindow?.consumptions.filter(consumption => consumption.useRef === association.useRef
    && consumption.target === association.target && consumption.hitRef === association.hitRef && consumption.resolvedAtMs === row.timeMs) ?? [];
  return matching.length === 1 ? matching[0]! : null;
}

export function empoweredWindowUseIssue(process: ProcessInstanceSnapshot, row: SkillUseRecord, stepKey: string): string | null {
  if (row.stepKey !== stepKey || row.stepVersion !== 1 || row.executionIndex !== 0) return '发动配额事实须保持原步骤版本和零执行号';
  if (['STEP_EXECUTED', 'RELEASED', 'HIT'].includes(row.kind)) {
    return empoweredWindowConsumption(process, { ...row, hitRef: row.empoweredAttack?.hitRef ?? row.hitRef })
      && (row.kind !== 'HIT' || row.hitRef === row.empoweredAttack?.hitRef) ? null : '负载事实须关联本窗口中真实已命中的消费份数';
  }
  if (row.empoweredAttack !== undefined || row.target !== process.target) return '窗口开始、完成或失败事实不能伪造普攻命中关联';
  if (['STEP_COMPLETED', 'COMPLETED'].includes(row.kind) && (process.status !== 'complete' || row.timeMs !== process.finishedAtMs)) return '窗口完成事实必须对应最后发动或实际到期';
  return null;
}

/** 完整窗口不受明细预算截断；保留的原普攻与负载记录只作真实交叉核对。 */
export function inspectEmpoweredWindowFacts(compile: CompileRequest, request: RunRequest, done: DoneResult,
  process: ProcessInstanceSnapshot): string[] {
  const issues: string[] = [], window = process.empoweredAttackWindow!;
  const check = (valid: unknown, reason: string) => { if (!valid) issues.push(`processInstances.${process.useKey}.empoweredAttackWindow: ${reason}`); };
  const plan = request.driverPlan.basicAttack!;
  const match = /^(source|target)\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$/.exec(plan.initialControlAbilityRef)!;
  const mount = compile.combatants.find(actor => actor.key === plan.source)!.providers.find(mount => mount.providerRef === match[2])!;
  const definition = compile.sharedProviders!.find(provider => provider.providerKey === mount.definitionRef)!;
  const initial = definition.abilities!.find(ability => ability.abilityKey === match[3])!;
  for (const row of window.consumptions) {
    check(row.startedAtMs <= done.summary.durationMs && (row.resolvedAtMs === null || row.resolvedAtMs <= done.summary.durationMs), '消费或真实终结晚于本次观察');
    const basic = done.finalSnapshot.processInstances?.filter(basic => basic.useKey === row.useRef && basic.owner === process.owner
      && basic.target === row.target && basic.startedAtMs === row.startedAtMs && basic.providerRef === mount.providerRef
      && basic.skillKey === plan.skillKey && basic.processKey === initial.processControl!.processKey) ?? [];
    check(basic.length === 1, '每次消费必须来自同刻真实普攻首次过程');
    const retained = done.attackRecords?.filter(attack => attack.useRef === row.useRef) ?? [];
    if (request.outputMode !== 'summary' && done.recording?.attackRecordsTruncated === false) check(retained.length === 1, '完整普攻明细缺少实际消费刀');
    check(retained.length <= 1 && retained.every(attack => attack.startAtMs === row.startedAtMs && attack.source === process.owner
      && attack.target === row.target && attack.skillKey === plan.skillKey && (row.hitRef === null || attack.hitAtMs === row.resolvedAtMs)), '保留普攻明细与实际消费不符');
    if (row.hitRef === null) {
      if (row.resolvedAtMs !== null) check(retained.every(attack => attack.hitAtMs === null && attack.completed), '未命中终结必须对应真实已完成且没有命中的原普攻');
      else check(retained.every(attack => !attack.completed && (attack.hitAtMs === null || done.summary.execution?.complete === false)), '仍待命中的消费不能与已完成命中的原普攻矛盾');
      check(!(done.damageRecords ?? []).some(damage => damage.abilityRef === plan.hitAbilityRef && damage.useRef === row.useRef)
        || row.resolvedAtMs === null && done.summary.execution?.complete === false, '未命中消费不能夹带实际原普攻伤害命中事实');
    }
    if (row.hitRef !== null) {
      const damage = (done.damageRecords ?? []).filter(damage => damage.abilityRef === plan.hitAbilityRef && damage.useRef === row.useRef && damage.hitRef === row.hitRef);
      if (request.outputMode !== 'summary' && done.recording?.damageRecordsTruncated === false) check(damage.length > 0, '完整原普攻伤害明细缺少消费的真实命中身份');
      check(damage.every(damage => damage.timeMs === row.resolvedAtMs && damage.source === process.owner && damage.target === row.target
        && damage.empoweredAttack === undefined), '消费命中与原普攻伤害身份不符');
    }
  }
  if (process.status === 'active' && done.summary.execution?.complete) check(done.summary.durationMs < process.expiresAtMs!, '完整执行不能保留已到期活动窗口');
  return issues;
}

export function empoweredWindowHitCount(window: EmpoweredAttackWindow): number {
  return window.consumptions.filter(row => row.hitRef !== null).length;
}
