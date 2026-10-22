import type { CompileRequest, DoneResult, ProcessActionOccupancy, ProcessInstanceSnapshot, RunRequest, SkillActionPlan } from '../types/genericEngine';
import { tryFoldConstant } from './numericAdapter';
import { simulationAbility } from './simulationAdapter';
import { inspectEmpoweredPredecessors } from './empoweredAttackContract';
import { empoweredWindowHitCount } from './empoweredAttackWindowContract';
import { recastDefinition } from './finiteRecast';
import { inspectProcessSkillHitStages } from './processSkillHitStageFacts';

function channelWindowExecutionOffset(first: number, last: number, count: number, ordinal: number): number {
  if (count === 1) return first;
  const divisor = count - 1;
  const span = last - first;
  const index = ordinal - 1;
  const quotient = Math.floor(span / divisor);
  const remainder = span % divisor;
  return first + quotient * index + Math.floor((remainder * index * 2 + divisor) / (divisor * 2));
}

export function committedSkillControl(compile: CompileRequest, request: RunRequest, action: SkillActionPlan, process: ProcessInstanceSnapshot): boolean {
  const binding = compile.rules.skillActionBindings?.find(binding => binding.bindingKey === action.bindingKey);
  const control = binding?.controls.find(control => control.action === action.action);
  const ability = control && simulationAbility(compile, control.abilityRef);
  const parent = request.driverPlan.skillActions?.find(parent => parent.instructionKey === action.parentInstructionKey);
  if (action.action === 'INITIAL' || !binding || !control || !ability || !parent || parent.action !== 'INITIAL'
    || process.providerRef !== binding.providerRef || process.skillKey !== binding.skillKey || process.processKey !== control.processKey
    || process.owner !== action.source || process.target !== action.target || process.startedAtMs !== parent.firstAtMs) return false;
  if (action.action === 'CANCEL') return process.status === 'failed' && process.failureReason === 'ACTIVE_CANCELLED'
    && process.finishedAtMs === action.firstAtMs;
  const recast = action.action === 'RECAST' && ability.provider.processes?.find(p => p.processKey === control.processKey);
  if (recast && recastDefinition(recast) && process.skillHitStages) return process.skillHitStages.some(fact => fact.stepKey === ability.ability.processControl?.stepKey
    && fact.timeMs === action.firstAtMs && fact.released && fact.completed);
  if (process.stepKey !== ability.ability.processControl?.stepKey || process.stepExecutionIndex !== 1
    || process.lastExecutionAtMs !== action.firstAtMs) return false;
  const step = ability.provider.processes?.find(definition => definition.processKey === control.processKey)?.steps.find(step => step.stepKey === process.stepKey);
  if (!step || (action.action === 'CHARGE_RELEASE' ? step.stepType !== 'CHARGE' : step.stepType !== 'RECAST')) return false;
  const duration = step.stepType === 'CHARGE' ? step.maximumChargeMs : step.windowMs;
  const folded = duration && tryFoldConstant(duration);
  const deadline = process.actionOccupancies.find(occupancy => occupancy.stepVersion === process.stepVersion)?.expectedEndAtMs
    ?? process.expiresAtMs ?? (folded !== undefined && folded !== null ? process.stepStartedAtMs + folded : null);
  if (deadline === null || deadline <= process.stepStartedAtMs) return false;
  if (action.action === 'RECAST') return action.firstAtMs < deadline;
  return action.firstAtMs >= process.advanceAtMs && action.firstAtMs < deadline;
}

export function inspectSimulationProcessFacts(compile: CompileRequest, request: RunRequest, done: DoneResult) {
  const empowered = inspectEmpoweredPredecessors(compile, request, done);
  const issues: string[] = empowered.issues;
  const occupancies: Array<ProcessActionOccupancy & { useRef: string }> = [];
  const processes: ProcessInstanceSnapshot[] = [];
  const check = (valid: boolean, path: string, message: string) => { if (!valid) issues.push(`${path}: ${message}`); };
  const time = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  const useRefs = new Set<string>();
  const bindings = compile.rules.skillActionBindings ?? [];
  const actions = request.driverPlan.skillActions ?? [];
  const automaticRules = request.driverPlan.automaticSkills?.rules;
  if (!Array.isArray(done.finalSnapshot.processInstances)) {
    return { issues: ['finalSnapshot.processInstances: 缺少完整过程快照'], occupancies, processes, empoweredSuccessions: empowered.successions };
  }
  for (const process of done.finalSnapshot.processInstances) {
    const binding = bindings.find(binding => binding.providerRef === process.providerRef && binding.source === process.owner);
    if (!binding) continue;
    const path = `processInstances.${process.useKey}`;
    const definition = compile.sharedProviders?.find(provider => provider.providerKey === binding.providerDefinitionRef)
      ?.processes?.find(definition => definition.processKey === process.processKey);
    const currentIndex = definition?.steps.findIndex(step => step.stepKey === process.stepKey) ?? -1;
    const step = definition?.steps[currentIndex];
    const beforeFirstStep = process.stepKey === '' && process.stepVersion === 0;
    const initial = actions.filter(action => action.action === 'INITIAL' && action.bindingKey === binding.bindingKey
      && action.source === process.owner && action.target === process.target && action.firstAtMs === process.startedAtMs);
    const automatic = automaticRules?.find(rule => rule.bindingKey === binding.bindingKey && process.owner === binding.source && process.target === rule.target);
    check(!!definition && process.skillKey === binding.skillKey && (automatic !== undefined || initial.length > 0) && typeof process.useKey === 'string'
      && !!process.useKey && !useRefs.has(process.useKey), path, '过程必须属于真实来源、原首次、唯一使用和原定义');
    check(time(process.startedAtMs) && time(process.stepStartedAtMs) && process.startedAtMs <= process.stepStartedAtMs
      && process.stepStartedAtMs <= done.summary.durationMs
      && (beforeFirstStep ? process.stepStartedAtMs === process.startedAtMs : process.stepVersion === currentIndex + 1 && currentIndex >= 0),
    path, '当前步骤身份、版本或进入时刻不合法');
    check(time(process.stepExecutionIndex) && process.stepExecutionIndex <= 64
      && (process.stepExecutionIndex === 0 ? process.lastExecutionAtMs === null : time(process.lastExecutionAtMs)
        && process.lastExecutionAtMs >= process.stepStartedAtMs && process.lastExecutionAtMs <= done.summary.durationMs)
      && (process.stepCompletedAtMs === null || (process.empoweredAttackWindow !== undefined || process.stepExecutionIndex > 0)
        && time(process.stepCompletedAtMs) && process.stepCompletedAtMs >= (process.lastExecutionAtMs ?? process.stepStartedAtMs)
        && process.stepCompletedAtMs <= done.summary.durationMs),
    path, '完整步骤执行进度、最后执行与真实完成时刻不一致，不从有限明细补全');
    check(process.status === 'active' ? process.finishedAtMs === null && process.failureReason === null
      : ['complete', 'failed'].includes(process.status) && time(process.finishedAtMs) && process.finishedAtMs >= process.stepStartedAtMs
        && process.finishedAtMs <= done.summary.durationMs && (process.status === 'complete' ? process.failureReason === null
          : ['CONTROLLED', 'SOURCE_DIED', 'TARGET_UNTARGETABLE', 'ACTIVE_CANCELLED', 'EVENT_ABORTED'].includes(process.failureReason ?? '')),
    path, '实际终结状态、失败原因或终结时刻不一致');
    if (process.status === 'complete') check(currentIndex === (definition?.steps.length ?? 0) - 1
      && process.stepCompletedAtMs === process.finishedAtMs && process.stepCompletedAtMs !== null,
    path, '完整过程必须有末尾步骤真实完成标记，不以终结状态猜完成');
    if (automaticRules) {
      if (done.outputMode !== 'summary' && done.automaticSkillRecording?.truncated === false) check(done.automaticSkillRecords?.some(row => row.kind === 'STARTED'
        && row.ruleKey === automatic?.ruleKey && row.useRef === process.useKey && row.timeMs === process.startedAtMs) === true, path, '过程没有对应真实自动开始');
    } else if (!done.recording?.skillActionRecordsTruncated) {
      check(done.skillActionRecords?.some(row => row.outcome === 'ACCEPTED' && row.useRef === process.useKey
        && initial.some(action => action.instructionKey === row.instructionKey)) === true, path, '过程没有对应已接受首次');
    }
    useRefs.add(process.useKey);
    processes.push(process);
    const repeating = step?.stepType === 'MULTI_HIT' || step?.stepType === 'CHANNEL';
    const recast = definition && recastDefinition(definition);
    if (recast && definition) {
      check(process.useKey.startsWith('skill:') && (automatic !== undefined
        ? new RegExp(`^skill:auto_${automatic.ruleKey}_[1-9][0-9]*$`).test(process.useKey)
        : initial.some(i => process.useKey === `skill:${i.instructionKey}`)), path, '重施窗口必须来自真实原生首次身份');
      if (automatic) {
        const ordinal = Number(process.useKey.slice(`skill:auto_${automatic.ruleKey}_`.length));
        check(Number.isSafeInteger(ordinal) && ordinal >= 1 && ordinal <= (done.automaticSkillSummary?.attemptCount ?? 0),
          path, '自动窗口编号不得越过真实首次尝试累计');
      }
      if (step?.stepType === 'RECAST') check(process.expiresAtMs === process.stepStartedAtMs + recast.window
        && time(process.expiresAtMs) && process.stepExecutionIndex <= recast.maximum
        && (process.status !== 'complete' || process.stepExecutionIndex === recast.maximum)
        && (process.status !== 'active' || process.stepExecutionIndex < recast.maximum
          && process.advanceAtMs === (process.lastExecutionAtMs ?? process.stepStartedAtMs) + recast.interval)
        && (process.failureReason !== 'EVENT_ABORTED' || process.finishedAtMs === process.expiresAtMs && process.stepExecutionIndex < recast.maximum),
      path, '重施原窗口、剩余额度、间隔或到期终结不一致');
      try { inspectProcessSkillHitStages(binding, definition, process, automatic?.hitBindings ?? initial[0]?.hitBindings ?? [], done.summary.durationMs, done); }
      catch (error) { check(false, path, error instanceof Error ? error.message : String(error)); }
    }
    if (!repeating) check(process.repeat === null && process.stepExecutionIndex <= (step?.stepType === 'RECAST' && recast ? recast.maximum : 1), `${path}.repeat`, '普通步骤不能伪造重复段或重复执行');
    else {
      const repeat = process.repeat;
      check(!!repeat && Number.isSafeInteger(repeat.executionCount) && repeat.executionCount >= 1 && repeat.executionCount <= 64
        && time(repeat.executionIndex) && repeat.executionIndex === process.stepExecutionIndex
        && repeat.executionIndex <= repeat.executionCount && time(repeat.intervalMs)
        && time(repeat.firstExecutionOffsetMs) && time(repeat.lastExecutionOffsetMs)
        && repeat.firstExecutionOffsetMs <= repeat.lastExecutionOffsetMs
        && (step.stepType === 'CHANNEL' ? repeat.intervalMs === 0 : repeat.executionCount === 1 || repeat.intervalMs > 0),
      `${path}.repeat`, '冻结段数、已提交段号或间隔不合法');
      if (repeat) check(repeat.nextExecutionAtMs === null
        ? process.status !== 'active' || repeat.executionIndex === repeat.executionCount
        : process.status === 'active' && repeat.executionIndex < repeat.executionCount && time(repeat.nextExecutionAtMs)
          && repeat.nextExecutionAtMs >= done.summary.durationMs,
      `${path}.repeat.nextExecutionAtMs`, '下一段必须是实际未提交段，不能完成后保留旧事件');
      const count = step && tryFoldConstant(step.stepType === 'MULTI_HIT' ? step.repeatCount! : step.executionCount!);
      if (count !== null) check(repeat?.executionCount === count, `${path}.repeat.executionCount`, '冻结次数必须保留明确作者表达式');
      if (repeat && step) {
        const interval = step.stepType === 'MULTI_HIT' ? step.intervalMs ? tryFoldConstant(step.intervalMs) : 0 : null;
        if (interval !== null) check(repeat.intervalMs === interval, `${path}.repeat.intervalMs`, '冻结间隔不能改写作者声明');
        if (step.stepType === 'MULTI_HIT') check(repeat.firstExecutionOffsetMs === 0
          && repeat.lastExecutionOffsetMs === (repeat.executionCount - 1) * repeat.intervalMs
          && time(process.stepStartedAtMs + repeat.lastExecutionOffsetMs)
          && process.advanceAtMs === process.stepStartedAtMs + repeat.lastExecutionOffsetMs,
        `${path}.repeat`, '多段冻结首末偏移和完整期限必须对应次数与间隔');
        if (repeat.nextExecutionAtMs !== null && step.stepType === 'MULTI_HIT') check(repeat.nextExecutionAtMs
          === process.stepStartedAtMs + repeat.executionIndex * repeat.intervalMs, `${path}.repeat.nextExecutionAtMs`, '多段下一绝对时点与冻结进度不一致');
        if (step.stepType === 'MULTI_HIT' && repeat.executionIndex > 0) check(process.stepStartedAtMs
          + (repeat.executionIndex - 1) * repeat.intervalMs === process.lastExecutionAtMs,
        `${path}.repeat.executionIndex`, '最后已提交段不能晚于最终快照');
        if (step.stepType === 'CHANNEL') {
          const duration = process.advanceAtMs - process.stepStartedAtMs;
          const customWindow = step.firstExecution === 'CUSTOM_WINDOW';
          const span = repeat.lastExecutionOffsetMs - repeat.firstExecutionOffsetMs;
          const offset = step.firstExecution === 'AFTER_INTERVAL' ? 1 : 0;
          const executionAt = (index: number) => customWindow
            ? process.stepStartedAtMs + channelWindowExecutionOffset(repeat.firstExecutionOffsetMs, repeat.lastExecutionOffsetMs, repeat.executionCount, index)
            : Math.round(process.stepStartedAtMs + duration * (index - 1 + offset) / repeat.executionCount);
          check(['IMMEDIATE', 'AFTER_INTERVAL', 'CUSTOM_WINDOW'].includes(step.firstExecution ?? '')
            && time(process.advanceAtMs) && duration > 0 && (customWindow || duration >= repeat.executionCount)
            && repeat.lastExecutionOffsetMs <= duration
            && (repeat.executionCount === 1 ? span === 0 : span >= repeat.executionCount - 1),
          `${path}.repeat`, '引导冻结全时长、首末窗口和不同段时点不合法');
          const authoredDuration = step.durationMs && tryFoldConstant(step.durationMs);
          if (authoredDuration !== undefined && authoredDuration !== null) check(duration === authoredDuration,
            `${path}.advanceAtMs`, '引导完整期限不能改写明确作者时长');
          if (customWindow) {
            for (const field of ['firstExecutionOffsetMs', 'lastExecutionOffsetMs'] as const) {
              const authored = step[field] && tryFoldConstant(step[field]);
              check(!!step[field], `${path}.repeat.${field}`, '指定窗口必须声明首末两项表达式');
              if (authored !== undefined && authored !== null) check(repeat[field] === authored, `${path}.repeat.${field}`, '冻结窗口不能改写明确作者端点');
            }
          } else check(repeat.firstExecutionOffsetMs === Math.round(duration * offset / repeat.executionCount)
            && repeat.lastExecutionOffsetMs === Math.round(duration * (repeat.executionCount - 1 + offset) / repeat.executionCount),
          `${path}.repeat`, '既有等分口径首末偏移须来自完整时长，不以端点重插值');
          if (repeat.executionIndex > 0) check(executionAt(repeat.executionIndex) === process.lastExecutionAtMs
            && process.lastExecutionAtMs! <= done.summary.durationMs,
            `${path}.repeat.executionIndex`, '引导最后已提交段不能晚于最终快照');
          if (repeat.nextExecutionAtMs !== null) check(repeat.nextExecutionAtMs === executionAt(repeat.executionIndex + 1),
            `${path}.repeat.nextExecutionAtMs`, '引导下一段须对应冻结口径的绝对时点，不累积舍入');
          if (process.stepCompletedAtMs !== null) check(process.stepCompletedAtMs === process.advanceAtMs,
            `${path}.stepCompletedAtMs`, '引导不能在末段执行后提前完成');
        }
      }
      if (process.status === 'complete') check(repeat?.executionIndex === repeat?.executionCount, `${path}.repeat`, '完成过程不得缺真实段执行');
    }
    if (!Array.isArray(process.actionOccupancies)) {
      issues.push(`${path}.actionOccupancies: 缺少不受记录预算影响的完整占用历史`);
      continue;
    }
    if (beforeFirstStep) check(process.repeat === null && process.actionOccupancies.length === 0 && process.status !== 'complete'
      && process.stepExecutionIndex === 0 && process.lastExecutionAtMs === null && process.stepCompletedAtMs === null,
      path, '已接受但尚未进入首步只能保留零步骤、零占用的合法在途或终结前缀');
    const versions = new Set<number>();
    let lastEnd = process.startedAtMs;
    for (const occupancy of process.actionOccupancies) {
      const occupiedIndex = definition?.steps.findIndex(step => step.stepKey === occupancy.stepKey) ?? -1;
      const end = occupancy.finishedAtMs ?? occupancy.expectedEndAtMs;
      check(occupiedIndex >= 0 && definition?.steps[occupiedIndex]?.occupiesAction === true && occupancy.stepVersion === occupiedIndex + 1
        && occupancy.stepVersion <= process.stepVersion && !versions.has(occupancy.stepVersion), path, '占用必须来自实际进入的明确占用步骤及唯一版本');
      check(time(occupancy.startedAtMs) && time(occupancy.expectedEndAtMs) && occupancy.startedAtMs >= lastEnd
        && occupancy.startedAtMs <= done.summary.durationMs && occupancy.expectedEndAtMs >= occupancy.startedAtMs
        && (occupancy.finishedAtMs === null ? process.status === 'active' && occupancy.stepVersion === process.stepVersion
          : time(occupancy.finishedAtMs) && occupancy.finishedAtMs >= occupancy.startedAtMs
            && occupancy.finishedAtMs <= occupancy.expectedEndAtMs && occupancy.finishedAtMs <= done.summary.durationMs),
      path, '占用原期限、实际提前退出或进入顺序不一致');
      if (occupancy.stepVersion === process.stepVersion) check(occupancy.startedAtMs === process.stepStartedAtMs
        && (process.stepCompletedAtMs !== null ? occupancy.finishedAtMs === process.stepCompletedAtMs
          : process.status === 'active' ? occupancy.finishedAtMs === null : occupancy.finishedAtMs === process.finishedAtMs),
      path, '当前占用须关联真实步骤完成或过程终结，不允许预算前缀偷偷解锁');
      if (occupancy.stepVersion === process.stepVersion && definition?.steps[occupiedIndex]?.stepType === 'CHANNEL') {
        check(occupancy.expectedEndAtMs === process.advanceAtMs, path, '引导占用必须保持到冻结完整期限，不取末段或下一段时点');
      }
      const author = definition?.steps[occupiedIndex];
      check(author?.stepType === 'IMMEDIATE' || author?.stepType === 'MULTI_HIT' && process.repeat?.executionCount === 1
        ? occupancy.expectedEndAtMs === occupancy.startedAtMs : occupancy.expectedEndAtMs > occupancy.startedAtMs,
      path, '真实完整期限必须为正，不因作者使用非常量表达式而放宽');
      const expectedDuration = author?.stepType === 'DELAY' ? author.delayMs : author?.stepType === 'CHARGE' ? author.maximumChargeMs
        : author?.stepType === 'RECAST' ? author.windowMs : author?.stepType === 'CHANNEL' ? author.durationMs : undefined;
      const duration = expectedDuration ? tryFoldConstant(expectedDuration) : author?.stepType === 'IMMEDIATE' ? 0 : null;
      if (duration !== null) check(occupancy.expectedEndAtMs === occupancy.startedAtMs + duration, path, '占用原期限不能改写明确作者完整时长');
      if (author?.stepType === 'MULTI_HIT' && process.repeat) check(occupancy.expectedEndAtMs === occupancy.startedAtMs
        + (process.repeat.executionCount - 1) * process.repeat.intervalMs, path, '多段完整期限必须对应冻结次数与间隔');
      if ((author?.stepType === 'IMMEDIATE' || author?.stepType === 'DELAY') && occupancy.finishedAtMs !== null
        && (occupancy.stepVersion < process.stepVersion || process.status !== 'failed')) check(occupancy.finishedAtMs === occupancy.expectedEndAtMs,
      path, '已成功退出的普通步骤不能伪造提前结束，不因后续过程失败放宽');
      if (occupancy.finishedAtMs !== null && occupancy.finishedAtMs < occupancy.expectedEndAtMs) {
        const control = actions.some(action => committedSkillControl(compile, request, action, process)
          && action.firstAtMs === occupancy.finishedAtMs);
        const death = process.status === 'failed' && process.finishedAtMs === occupancy.finishedAtMs
          && (process.failureReason === 'SOURCE_DIED' && done.summary.sourceFinalHp === 0
            || process.failureReason === 'TARGET_UNTARGETABLE' && done.summary.targetFinalHp === 0);
        check(occupancy.stepVersion === process.stepVersion && (control || death), path, '提前退出必须有原使用真实控制或死亡终结佐证，不仅改变期限');
      }
      if (definition?.steps[occupiedIndex - 1]?.occupiesAction === true) {
        const previous = process.actionOccupancies.find(row => row.stepVersion === occupancy.stepVersion - 1);
        check(!!previous && previous.finishedAtMs === occupancy.startedAtMs, path, '连续占用步骤不得产生中间行动窗口');
      }
      versions.add(occupancy.stepVersion);
      lastEnd = end;
      occupancies.push({ ...occupancy, useRef: process.useKey });
    }
    for (const [index, author] of (definition?.steps ?? []).entries()) if (author.occupiesAction === true && index < process.stepVersion) {
      check(versions.has(index + 1), path, '完整占用历史不得省略已进入的占用步骤');
    }
  }
  const summary = done.summary.skillUses;
  if (summary) check(processes.length === summary.startedCount && processes.filter(process => process.status === 'complete').length === summary.completedCount
    && processes.filter(process => process.status === 'failed').length === summary.failedCount
    && processes.filter(process => process.status === 'active').length === summary.inFlightCount,
  'processInstances', '完整计划过程快照与使用、完成、失败和在途累计不一致');
  if (summary) check(processes.reduce((count, process) => count + process.stepVersion, 0) === summary.stepEnteredCount,
    'summary.skillUses.stepEnteredCount', '步骤进入累计必须对应完整过程已进入版本，不依赖截断明细');
  if (summary) check(processes.reduce((count, process) => count + (process.empoweredAttackWindow ? empoweredWindowHitCount(process.empoweredAttackWindow)
    : process.stepVersion === 0 ? 0 : process.stepVersion - 1 + process.stepExecutionIndex), 0)
    === summary.stepExecutedCount, 'summary.skillUses.stepExecutedCount', '完整步骤执行累计必须对应可靠进度，零记录与截断不能绕过');
  if (summary) check(processes.reduce((count, process) => count + (process.stepVersion === 0 ? 0 : process.stepVersion - 1
    + (process.stepCompletedAtMs !== null ? 1 : 0)), 0) === summary.stepCompletedCount,
  'summary.skillUses.stepCompletedCount', '完整步骤完成累计必须对应真实完成标记，不能从执行次数或有限记录猜完成');
  const controls = new Set<string>();
  let recastControls = 0;
  for (const process of processes) {
    const binding = bindings.find(b => b.source === process.owner && b.providerRef === process.providerRef && b.skillKey === process.skillKey);
    const definition = compile.sharedProviders?.find(p => p.providerKey === binding?.providerDefinitionRef)?.processes?.find(p => p.processKey === process.processKey);
    const recast = definition && recastDefinition(definition);
    if (!definition || !recast || process.stepVersion !== definition.steps.length || automaticRules) continue;
    recastControls += process.stepExecutionIndex;
    const available = actions.filter(a => a.action === 'RECAST' && a.bindingKey === binding?.bindingKey && a.source === process.owner && a.target === process.target
      && a.parentInstructionKey === process.useKey.slice('skill:'.length));
    const consumed = new Set<string>();
    const committedTimes = process.skillHitStages?.filter(f => f.stepKey === process.stepKey).map(f => f.timeMs)
      ?? (recast.maximum === 1 && process.stepExecutionIndex === 1 && process.lastExecutionAtMs !== null ? [process.lastExecutionAtMs] : []);
    check(committedTimes.length === process.stepExecutionIndex, 'processInstances.skillHitStages', '每次已提交重施须有完整阶段或单次实际执行时点');
    for (const timeMs of committedTimes) {
      const action = available.find(a => a.firstAtMs === timeMs && !consumed.has(a.instructionKey));
      check(!!action, 'processInstances.skillHitStages', '每次重施必须对应不同的真实计划控制，不能复用同一指令');
      if (action) consumed.add(action.instructionKey);
    }
  }
  for (const process of processes) for (const action of actions) if (committedSkillControl(compile, request, action, process)) {
    if (action.action === 'RECAST') continue;
    controls.add(`${process.useKey}/${action.action}/${action.firstAtMs}`);
  }
  if (summary && done.summary.skillActions) check(done.summary.skillActions.acceptedCount === summary.startedCount + controls.size + recastControls,
    'summary.skillActions.acceptedCount', '完整控制接受累计须对应原使用实际执行或主动取消，零明细不得绕过');
  return { issues, occupancies, processes, empoweredSuccessions: empowered.successions };
}

export function simulationActionContribution(occupancies: readonly ProcessActionOccupancy[], start: number, end: number): number | null {
  const deadlines = occupancies.filter(occupancy => occupancy.startedAtMs >= start && occupancy.startedAtMs < end
    && (occupancy.finishedAtMs ?? occupancy.expectedEndAtMs) > occupancy.startedAtMs)
    .map(occupancy => occupancy.finishedAtMs ?? occupancy.expectedEndAtMs);
  return deadlines.length ? Math.max(...deadlines) : null;
}
