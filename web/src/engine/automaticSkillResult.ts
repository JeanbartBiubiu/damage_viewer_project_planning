import type { AutomaticSkillCounts, AutomaticSkillWaitingReason, BudgetCause, CompileRequest, DoneResult,
  ProcessInstanceSnapshot, ProcessStepDefinition, RunRequest } from '../types/genericEngine';
import { simulationAbility } from './simulationAdapter';
import type { OperationOrigin } from './simulationAdapter';
import { validateAutomaticSkillRelations } from './automaticSkillRequest';
import { inspectContinuousAttackSeries } from './continuousAttackSeries';
import { assessContinuousAttackResult } from './continuousAttackResult';
import { inspectSimulationProcessFacts } from './simulationProcessFacts';
import { inspectSimulationHealthLedger } from './simulationHealthLedger';
import { inspectResourceChangeContract } from './resourceChangeContract';
import { inspectPermanentHealthInitialization } from './permanentHealthInitialization';
import { empoweredWindowHitCount } from './empoweredAttackWindowContract';
import { inspectEmpoweredHealingAliases } from './empoweredHealingAlias';
import { AUTOMATIC_SKILL_RECORD_KINDS, AUTOMATIC_SKILL_WAIT_REASONS } from '../types/skillSystemEnums.generated';
import { empoweredAttackBinding, empoweredAttackIdentityGaps, empoweredDamageProcess, requireEmpoweredBasicAttack } from './empoweredAttackContract';
import { tryFoldConstant } from './numericAdapter';
import { inspectActiveAmmoMechanics } from './simulationAmmoMechanics';
import { automaticProcessStepsAllowed } from './processSkillHitStages';
import { inspectProcessSkillHitStages, processSkillHitTimes, skillHitStageStoppedByTargetDeath } from './processSkillHitStageFacts';
import { finiteRecastControls, processForSkillUse, recastUseOrdinal } from './finiteRecast';
import { inspectTargetMarkResult } from './targetMarkResultContract';

export type AutomaticSkillAssessment = { complete: boolean; factsValid: boolean; detailIdentityVerified: boolean; identityGaps: string[]; issues: string[] };
type Row = Record<string, unknown>;
const counts = ['attemptCount', 'startedCount', 'rejectedCount', 'abortedBeforeStartCount', 'completedCount', 'failedCount', 'inFlightCount'] as const;
const waitingReasons = AUTOMATIC_SKILL_WAIT_REASONS;
const recordKinds = AUTOMATIC_SKILL_RECORD_KINDS;
const budgetCauses: BudgetCause[] = ['max_events', 'max_commands_per_event', 'max_chain_depth', 'max_queue_events',
  'max_process_instances', 'max_skill_hits', 'max_basic_attacks', 'max_use_trigger_ledger'];
const close = (first: number, second: number) => Math.abs(first - second) <= 1e-9 * Math.max(1, Math.abs(first), Math.abs(second));
const edgeKey = (grantor: string, consumer: string) => `${grantor}/${consumer}`;
const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

/** 从完整冻结进度核对已提交圈时点，不依赖可截断的伤害或自动明细。 */
function committedChannelTimes(process: ProcessInstanceSnapshot, step: ProcessStepDefinition): number[] {
  const repeat = process.repeat;
  if (!repeat || !Number.isSafeInteger(repeat.executionCount) || repeat.executionCount < 1 || repeat.executionCount > 64
    || !Number.isSafeInteger(repeat.executionIndex) || repeat.executionIndex < 0 || repeat.executionIndex > repeat.executionCount) return [];
  return Array.from({ length: repeat.executionIndex }, (_, index) => {
    let offset: number;
    if (step.firstExecution === 'CUSTOM_WINDOW') {
      const span = repeat.lastExecutionOffsetMs - repeat.firstExecutionOffsetMs;
      const divisor = repeat.executionCount - 1;
      offset = repeat.firstExecutionOffsetMs + (divisor === 0 ? 0 : Math.floor(span / divisor) * index
        + Math.floor(((span % divisor) * index * 2 + divisor) / (divisor * 2)));
    } else offset = Math.round((process.advanceAtMs - process.stepStartedAtMs)
      * (index + (step.firstExecution === 'AFTER_INTERVAL' ? 1 : 0)) / repeat.executionCount);
    return process.stepStartedAtMs + offset;
  });
}

/** 自动运行独立核对真实规则、使用、资格与完整累计，不匹配手动指令及预先填写的时刻。 */
export function assessAutomaticSkillResult(compile: CompileRequest, request: RunRequest, done: DoneResult, origins: OperationOrigin[] = []): AutomaticSkillAssessment {
  const issues: string[] = [];
  const identityGaps: string[] = [];
  const marks = inspectTargetMarkResult(compile, request, done, origins);
  issues.push(...marks.issues); identityGaps.push(...marks.identityGaps);
  const check = (condition: boolean, path: string, message: string) => { if (!condition) issues.push(`${path}: ${message}`); };
  const object = (value: unknown, path: string): Row => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}: 必须返回完整对象`);
    return value as Row;
  };
  const exact = (value: unknown, fields: readonly string[], path: string) => {
    const row = object(value, path);
    check(Object.keys(row).every(key => fields.includes(key)) && fields.every(key => hasOwn(row, key)), path, '字段缺失或包含未知字段');
    return row;
  };
  const number = (value: unknown, path: string, integral = true): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || integral && !Number.isSafeInteger(value)) throw new Error(`${path}: 需要明确非负${integral ? '安全整数' : '有限值'}`);
    return value;
  };
  const text = (value: unknown, path: string): string => {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${path}: 需要真实非空标识`);
    return value;
  };
  const array = <T>(value: T[] | undefined, path: string): T[] => {
    if (!Array.isArray(value)) throw new Error(`${path}: 必须返回明确数组`);
    return value;
  };
  const nullableRef = (value: unknown, path: string) => value === null ? null : text(value, path);
  const nullableTime = (value: unknown, path: string) => value === null ? null : number(value, path);
  const inspectCounts = (row: AutomaticSkillCounts, path: string) => {
    for (const key of counts) number(row[key], `${path}.${key}`);
    check(row.attemptCount === row.startedCount + row.rejectedCount + row.abortedBeforeStartCount, path, '真实尝试与开始／拒绝／开始前中止不守恒');
    check(row.startedCount === row.completedCount + row.failedCount + row.inFlightCount, path, '成功开始与完成／失败／在途不守恒');
  };
  try {
    const rules = request.driverPlan.automaticSkills?.rules;
    if (!rules || !rules.length) throw new Error('driverPlan.automaticSkills.rules: 缺少自动规则');
    validateAutomaticSkillRelations(rules);
    check(Array.isArray(request.driverPlan.entries) && request.driverPlan.entries.length === 0
      && Array.isArray(request.driverPlan.skillActions) && request.driverPlan.skillActions.length === 0
      && [request.skillUses, request.skillHitFacts, request.attackStartFacts, request.processCommandFacts].every(rows => Array.isArray(rows) && rows.length === 0),
    'driverPlan', '自动计划必须与手动动作及外部事实互斥，全部明确为空数组');
    const ordered = [...rules].sort((left, right) => left.sortOrder - right.sortOrder);
    const byKey = new Map(ordered.map(rule => [rule.ruleKey, rule]));
    const contexts = new Map(ordered.map(rule => {
      const matches = compile.rules.skillActionBindings?.filter(binding => binding.bindingKey === rule.bindingKey) ?? [];
      const binding = matches[0];
      const control = binding?.controls.find(control => control.action === 'INITIAL');
      const ability = control && simulationAbility(compile, control.abilityRef);
      const process = ability?.provider.processes?.find(process => process.processKey === control?.processKey);
      if (matches.length !== 1 || !binding || !control || !ability || binding.source !== 'source'
        || binding.controls.length !== 1 && (!process || !finiteRecastControls(binding, process))
        || ability.mount.providerRef !== binding.providerRef || ability.mount.definitionRef !== binding.providerDefinitionRef
        || ability.ability.skillKey !== binding.skillKey || ability.ability.processControl?.action !== 'INITIAL'
        || ability.ability.processControl.processKey !== control.processKey || !process || !automaticProcessStepsAllowed(process)) {
        throw new Error(`automaticSkills.rules.${rule.ruleKey}.bindingKey: 必须对应真实首次有限普通步骤链或既有单步骤过程`);
      }
      const empowered = empoweredAttackBinding(compile, binding);
      if (empowered) {
        requireEmpoweredBasicAttack(compile, request.driverPlan.basicAttack);
        const cooldown = process.cooldown && tryFoldConstant(process.cooldown.durationMs);
        check(typeof cooldown === 'number' && Number.isFinite(cooldown) && cooldown > 0, 'automaticSkills.rules', '自动强化待击需要真实正数普通冷却');
      }
      check((empowered ? rule.hitBindings.length === 0 : rule.hitBindings.length === binding.hitBindings.length && binding.hitBindings.every(hit => rule.hitBindings.filter(input => input.hitBindingKey === hit.hitBindingKey).length === 1))
        && rule.hitBindings.every(hit => ['TARGET_HIT', 'MISS'].includes(hit.preset))
        && rule.target === (!empowered && binding.hitBindings.length ? 'target' : 'source'), `automaticSkills.rules.${rule.ruleKey}.hitBindings`, '命中绑定或实际目标与作者不一致');
      return [rule.ruleKey, { rule, binding, control, process }] as const;
    }));
    check(new Set(rules.map(rule => rule.bindingKey)).size === rules.length, 'automaticSkills.rules', '绑定不得重复');
    const summary = done.summary;
    const duration = number(summary.durationMs, 'summary.durationMs');
    check(done.ok === true && duration <= request.stopPolicy.durationMs && done.finalSnapshot.timeMs === duration
      && request.initialSnapshot.timeMs === 0, 'summary.durationMs', '必须是0初态开始的真实成功载荷，停止时刻与观察范围一致');
    check(request.expectedRulesHash === compile.rulesHash && request.rulesHash === compile.rulesHash && request.schemaHash === compile.schemaHash
      && done.finalSnapshot.rulesHash === compile.rulesHash && done.finalSnapshot.schemaHash === compile.schemaHash
      && request.initialSnapshot.rulesHash === compile.rulesHash && request.initialSnapshot.schemaHash === compile.schemaHash, 'finalSnapshot', '结构与规则摘要不属于本次编译');
    check(['duration_reached', 'target_dead', 'source_dead', 'both_dead', 'no_events', 'budget_exceeded'].includes(summary.stopReason), 'summary.stopReason', '未知停止原因');
    const execution = object(summary.execution, 'summary.execution');
    check(execution.requestedDurationMs === request.stopPolicy.durationMs && typeof execution.complete === 'boolean'
      && (execution.complete ? execution.incompleteReason === null && execution.budgetCause === null
        : ['budget_exceeded', 'unfinished_tail'].includes(String(execution.incompleteReason)) && budgetCauses.includes(execution.budgetCause as BudgetCause)), 'summary.execution', '公共完整性或预算字段不一致');
    check(typeof execution.targetKilled === 'boolean' && (execution.targetKilled ? nullableTime(execution.targetKilledAtMs, 'summary.execution.targetKilledAtMs') !== null
      && (execution.targetKilledAtMs as number) <= duration && summary.targetFinalHp === 0 : execution.targetKilledAtMs === null && summary.targetFinalHp > 0), 'summary.execution.targetKilled', '击杀时刻与生命不一致');
    check(summary.stopReason !== 'duration_reached' || duration === request.stopPolicy.durationMs, 'summary.stopReason', '时长停止必须到达观察终点');
    check(summary.stopReason !== 'target_dead' || summary.targetFinalHp === 0 && summary.sourceFinalHp > 0
      && execution.targetKilled === true, 'summary.stopReason', '目标死亡停止必须保留真实致死事实');
    check(summary.stopReason !== 'source_dead' || summary.sourceFinalHp === 0 && summary.targetFinalHp > 0, 'summary.stopReason', '攻击方死亡停止与双方生命矛盾');
    check(summary.stopReason !== 'both_dead' || summary.sourceFinalHp === 0 && summary.targetFinalHp === 0 && execution.targetKilled === true, 'summary.stopReason', '双方死亡停止与真实生命矛盾');
    check(summary.stopReason !== 'budget_exceeded' || execution.complete === false && execution.budgetCause !== null, 'summary.stopReason', '预算停止不能标记完整执行');
    check(!hasOwn(summary, 'skillActions') && !hasOwn(done, 'skillActionRecords') && !hasOwn(done, 'skillUseRecords'), 'done', '自动模式不能返回手动计划及其专用明细');
    const automatic = done.automaticSkillSummary;
    exact(automatic, ['ruleCount', ...counts, 'rules', 'qualifications'], 'automaticSkillSummary');
    if (!automatic) throw new Error('automaticSkillSummary: 缺少完整自动累计');
    inspectCounts(automatic, 'automaticSkillSummary');
    check(number(automatic.ruleCount, 'automaticSkillSummary.ruleCount') === ordered.length, 'automaticSkillSummary.ruleCount', '配置规则数与实际循环数不得混用');
    const ruleSummaries = array(automatic.rules, 'automaticSkillSummary.rules');
    check(ruleSummaries.length === ordered.length, 'automaticSkillSummary.rules', '必须逐项返回所有配置规则');
    for (const [index, row] of ruleSummaries.entries()) {
      const path = `automaticSkillSummary.rules[${index}]`;
      exact(row, ['ruleKey', ...counts, 'waiting'], path);
      inspectCounts(row, path);
      check(row.ruleKey === ordered[index]?.ruleKey, `${path}.ruleKey`, '规则汇总必须按实际优先级排列且不重复');
      const rule = byKey.get(row.ruleKey);
      if (!rule) throw new Error(`${path}.ruleKey: 未知自动规则`);
      if (row.waiting !== null) {
        exact(row.waiting, ['reason', 'relatedRuleKeys', 'nextCheckAtMs'], `${path}.waiting`);
        check(waitingReasons.includes(row.waiting.reason), `${path}.waiting.reason`, '未知等待原因');
        const related = array(row.waiting.relatedRuleKeys, `${path}.waiting.relatedRuleKeys`);
        check(new Set(related).size === related.length && related.every(key => byKey.has(key))
          && related.every((key, position) => position === 0 || byKey.get(key)!.sortOrder > byKey.get(related[position - 1]!)!.sortOrder), `${path}.waiting.relatedRuleKeys`, '关联必须为真实规则且按优先级排序');
        if (row.waiting.reason === 'RELATED_COOLDOWN') check(related.length > 0 && related.every(key => rule.waitForCooldowns.includes(key)), `${path}.waiting`, '关联冷却必须指向本规则明确选择的技能');
        if (row.waiting.reason === 'RELEASE_QUALIFICATION') check(rule.releaseAfterRuleKey !== null && related.length === 1 && related[0] === rule.releaseAfterRuleKey, `${path}.waiting`, '缺资格必须保留实际前置来源');
        const next = nullableTime(row.waiting.nextCheckAtMs, `${path}.waiting.nextCheckAtMs`);
        check(next === null || next >= duration, `${path}.waiting.nextCheckAtMs`, '最后等待不能保留过去的检查时刻');
      }
    }
    for (const key of counts) check(ruleSummaries.reduce((sum, row) => sum + row[key], 0) === automatic[key], `automaticSkillSummary.${key}`, '各规则累计之和必须等于总计');
    const uses = summary.skillUses;
    if (!uses) throw new Error('summary.skillUses: 缺少实际使用累计');
    for (const key of ['startedCount', 'releasedCount', 'hitCount', 'completedCount', 'failedCount', 'inFlightCount', 'stepEnteredCount', 'stepExecutedCount', 'stepCompletedCount'] as const) number(uses[key], `summary.skillUses.${key}`);
    check(uses.startedCount === automatic.startedCount && uses.completedCount === automatic.completedCount && uses.failedCount === automatic.failedCount && uses.inFlightCount === automatic.inFlightCount
      && uses.hitCount <= uses.releasedCount && uses.releasedCount <= uses.stepExecutedCount && uses.stepCompletedCount <= uses.stepEnteredCount, 'summary.skillUses', '通用使用与自动真实开始／终结累计不一致');
    const processFacts = inspectSimulationProcessFacts(compile, request, done);
    issues.push(...processFacts.issues);
    identityGaps.push(...empoweredAttackIdentityGaps(request, done));
    identityGaps.push(...inspectEmpoweredHealingAliases(compile, done).identityGaps);
    const processByUse = new Map(processFacts.processes.map(process => [process.useKey, process]));
    const definitions = [...contexts.values()].map(c => c.process);
    const findProcess = (ref: string) => processByUse.get(ref) ?? processForSkillUse(processFacts.processes, definitions, ref);
    const ruleForUse = (ref: string) => {
      const process = findProcess(ref);
      return process && ordered.find(rule => {
        const context = contexts.get(rule.ruleKey)!;
        return context.binding.providerRef === process.providerRef && context.binding.skillKey === process.skillKey && context.control.processKey === process.processKey && rule.target === process.target;
      })?.ruleKey;
    };
    for (const row of ruleSummaries) {
      const processes = processFacts.processes.filter(process => ruleForUse(process.useKey) === row.ruleKey);
      check(processes.length === row.startedCount && processes.filter(process => process.status === 'complete').length === row.completedCount
        && processes.filter(process => process.status === 'failed').length === row.failedCount && processes.filter(process => process.status === 'active').length === row.inFlightCount,
      `automaticSkillSummary.rules.${row.ruleKey}`, '逐规则真实过程与成功开始／完成／失败／在途累计不一致');
    }
    let expectedReleases = 0, possibleHits = 0, requiredHits = 0;
    for (const process of processFacts.processes) {
      const ruleKey = ruleForUse(process.useKey);
      const context = ruleKey && contexts.get(ruleKey);
      if (!context) continue;
      if (process.empoweredAttackWindow) {
        const hits = empoweredWindowHitCount(process.empoweredAttackWindow);
        expectedReleases += hits; possibleHits += hits;
        if (execution.complete && process.status !== 'failed') requiredHits += hits;
        continue;
      }
      if (!context.binding.hitBindings.length && process.status === 'complete') expectedReleases++;
      const stages = inspectProcessSkillHitStages(context.binding, context.process, process, context.rule.hitBindings, duration, done);
      if (stages) {
        expectedReleases += stages.filter(stage => stage.released).length;
        possibleHits += stages.filter(stage => stage.contact).length;
        requiredHits += stages.filter(stage => stage.contact).length;
        for (const stage of stages) {
          const hit = context.binding.hitBindings.find(hit => hit.hitBindingKey === stage.hitBindingKey)!;
          const ability = simulationAbility(compile, hit.hitAbilityRef)?.ability;
          if (stage.released && context.rule.hitBindings.find(preset => preset.hitBindingKey === hit.hitBindingKey)?.preset === 'TARGET_HIT'
            && execution.complete && summary.attemptSkippedCount === 0 && process.status !== 'failed' && ability && !ability.castCondition
            && !skillHitStageStoppedByTargetDeath(process, stage, done)) {
            check(stage.contact, 'processInstances.skillHitStages.contact', '已提交的正常目标命中阶段缺少真实接触');
          }
        }
        continue;
      }
      for (const hit of context.binding.hitBindings) {
        const released = hit.moment.momentType === 'STEP_EXECUTION' && hit.moment.stepKey === process.stepKey
          ? process.stepExecutionIndex : hit.moment.momentType === 'PROCESS_COMPLETE' && process.status === 'complete' ? 1 : 0;
        expectedReleases += released;
        if (context.rule.hitBindings.find(preset => preset.hitBindingKey === hit.hitBindingKey)?.preset === 'MISS') continue;
        possibleHits += released;
        const ability = simulationAbility(compile, hit.hitAbilityRef)?.ability;
        // 失败、预算尾部或真实命中能力条件可能阻止尚未完成的命中，不能由释放数补造成功。
        if (execution.complete && summary.attemptSkippedCount === 0 && process.status !== 'failed' && ability && !ability.castCondition) requiredHits += released;
      }
    }
    check(uses.releasedCount === expectedReleases, 'summary.skillUses.releasedCount', '完整释放累计必须对应真实步骤或完成时点，不从有限明细重建');
    check(uses.hitCount >= requiredHits && uses.hitCount <= possibleHits, 'summary.skillUses.hitCount', '完整命中累计必须符合实际释放、命中预设及真实失败边界');
    const qualifications = array(automatic.qualifications, 'automaticSkillSummary.qualifications');
    const expectedEdges = new Map(ordered.filter(rule => rule.releaseAfterRuleKey !== null).map(rule => [edgeKey(rule.releaseAfterRuleKey!, rule.ruleKey), rule]));
    check(qualifications.length === expectedEdges.size, 'automaticSkillSummary.qualifications', '资格账本必须完整对应配置边');
    const seenEdges = new Set<string>();
    for (const [index, edge] of qualifications.entries()) {
      const path = `automaticSkillSummary.qualifications[${index}]`;
      exact(edge, ['grantorRuleKey', 'consumerRuleKey', 'grantedCount', 'consumedCount', 'remainingCount', 'lastGrantUseRef', 'lastConsumeUseRef'], path);
      const key = edgeKey(edge.grantorRuleKey, edge.consumerRuleKey);
      check(expectedEdges.has(key) && !seenEdges.has(key), path, '资格边未知或重复'); seenEdges.add(key);
      for (const field of ['grantedCount', 'consumedCount', 'remainingCount'] as const) number(edge[field], `${path}.${field}`);
      check(edge.remainingCount <= 1 && edge.grantedCount === edge.consumedCount + edge.remainingCount, path, '单份资格必须守恒且最多保留1份');
      check(edge.consumedCount === ruleSummaries.find(row => row.ruleKey === edge.consumerRuleKey)?.startedCount
        && edge.grantedCount <= (ruleSummaries.find(row => row.ruleKey === edge.grantorRuleKey)?.completedCount ?? -1), path, '消费数须等于后继成功开始，授予不得超过来源完整完成');
      const grantRef = nullableRef(edge.lastGrantUseRef, `${path}.lastGrantUseRef`);
      const consumeRef = nullableRef(edge.lastConsumeUseRef, `${path}.lastConsumeUseRef`);
      check(edge.grantedCount === 0 ? grantRef === null : grantRef !== null && ruleForUse(grantRef) === edge.grantorRuleKey && processByUse.get(grantRef)?.status === 'complete', `${path}.lastGrantUseRef`, '授予归属必须是来源已完成的真实使用');
      check(edge.consumedCount === 0 ? consumeRef === null : consumeRef !== null && processByUse.has(consumeRef) && ruleForUse(consumeRef) === edge.consumerRuleKey, `${path}.lastConsumeUseRef`, '消费归属必须是后继已开始的真实使用');
    }
    const records = array(done.automaticSkillRecords, 'automaticSkillRecords');
    const recording = done.automaticSkillRecording;
    exact(recording, ['totalCount', 'returnedCount', 'omittedCount', 'droppedCount', 'truncated'], 'automaticSkillRecording');
    if (!recording) throw new Error('automaticSkillRecording: 缺少自动明细保留统计');
    for (const key of ['totalCount', 'returnedCount', 'omittedCount', 'droppedCount'] as const) number(recording[key], `automaticSkillRecording.${key}`);
    const summaryOnly = request.outputMode === 'summary';
    check((summaryOnly ? done.outputMode === 'summary' : done.outputMode === undefined) && typeof recording.truncated === 'boolean', 'outputMode', '返回输出模式与请求不一致');
    const maximum = request.recordBudget?.maxAutomaticSkillRecords ?? 1000;
    check(recording.returnedCount === records.length && recording.totalCount === recording.returnedCount + recording.omittedCount + recording.droppedCount
      && (summaryOnly ? records.length === 0 && recording.omittedCount === recording.totalCount && recording.droppedCount === 0 && !recording.truncated
        : recording.omittedCount === 0 && recording.returnedCount === Math.min(recording.totalCount, maximum) && recording.truncated === (recording.droppedCount > 0)), 'automaticSkillRecording', '未请求明细与预算丢弃必须分别守恒');
    if (summaryOnly) identityGaps.push('汇总模式未请求自动明细；完整规则与资格累计仍独立核对');
    else if (recording.truncated) identityGaps.push('自动明细已截断；仅核实返回前缀，完整累计与资格不从记录重建');
    const lifecycle = new Set<string>();
    const ledger = new Map<string, string>();
    const lastGrant = new Map<string, string>();
    const lastConsume = new Map<string, string>();
    for (const [index, row] of records.entries()) {
      const path = `automaticSkillRecords[${index}]`;
      exact(row, ['sequence', 'timeMs', 'kind', 'ruleKey', 'useRef', 'relatedRuleKey', 'relatedUseRef', 'reason', 'nextCheckAtMs'], path);
      check(number(row.sequence, `${path}.sequence`) === index + 1 && number(row.timeMs, `${path}.timeMs`) <= duration
        && (index === 0 || row.timeMs >= records[index - 1]!.timeMs), path, '明细必须是从1开始的单调序号前缀，时间不得逆序或超过终点');
      check(recordKinds.includes(row.kind) && byKey.has(row.ruleKey), path, '未知类别或规则');
      const useRef = nullableRef(row.useRef, `${path}.useRef`);
      const related = nullableRef(row.relatedRuleKey, `${path}.relatedRuleKey`);
      const relatedUse = nullableRef(row.relatedUseRef, `${path}.relatedUseRef`);
      const reason = nullableRef(row.reason, `${path}.reason`);
      const next = nullableTime(row.nextCheckAtMs, `${path}.nextCheckAtMs`);
      if (useRef !== null) check(processByUse.has(useRef) && ruleForUse(useRef) === row.ruleKey, `${path}.useRef`, '窗口记录必须保留本规则原首次使用身份');
      const process = useRef === null ? undefined : processByUse.get(useRef);
      if (row.kind === 'WAIT_CHANGED') {
        check(useRef === null && relatedUse === null && (reason === null ? related === null && next === null : waitingReasons.includes(reason as AutomaticSkillWaitingReason))
          && (related === null || byKey.has(related)) && (next === null || next >= row.timeMs), path, '等待变化不能造使用身份，清空等待应明确返回null');
        const rule = byKey.get(row.ruleKey)!;
        if (reason === 'RELATED_COOLDOWN') check(related !== null && rule.waitForCooldowns.includes(related), path, '关联冷却等待必须来自本规则已选引用');
        else if (reason === 'RELEASE_QUALIFICATION') check(related !== null && related === rule.releaseAfterRuleKey, path, '缺资格等待必须来自实际前置规则');
        else check(related === null, path, '普通等待不得伪造关联规则');
      } else if (['ATTEMPT_REJECTED', 'ABORTED_BEFORE_START'].includes(row.kind)) {
        check(useRef === null && related === null && relatedUse === null && reason !== null && next === null, path, '拒绝或开始前中止不能产生使用身份');
      } else if (row.kind === 'QUALIFICATION_GRANTED') {
        const key = edgeKey(row.ruleKey, related ?? '');
        check(useRef !== null && related !== null && relatedUse === null && reason === null && next === null && expectedEdges.has(key)
          && process?.status === 'complete' && process.finishedAtMs === row.timeMs && !ledger.has(key), path, '授予必须对应真实完整完成且只能保存单份资格');
        if (useRef) { ledger.set(key, useRef); lastGrant.set(key, useRef); }
      } else if (row.kind === 'QUALIFICATION_CONSUMED') {
        const key = edgeKey(related ?? '', row.ruleKey);
        check(useRef !== null && related !== null && relatedUse !== null && reason === null && next === null && expectedEdges.has(key)
          && process?.startedAtMs === row.timeMs && ledger.get(key) === relatedUse, path, '消费必须对应真实开始及实际未消费的授予使用');
        ledger.delete(key); if (useRef) lastConsume.set(key, useRef);
      } else {
        check(useRef !== null && related === null && relatedUse === null && next === null && (row.kind === 'FAILED' ? reason !== null : reason === null), path, '普通使用记录的身份或不适用字段不合法');
        if (row.kind === 'STARTED') check(process?.startedAtMs === row.timeMs, path, '开始时刻必须来自本次实际过程');
        if (row.kind === 'COMPLETED' || row.kind === 'FAILED') check(process?.finishedAtMs === row.timeMs && process.status === (row.kind === 'COMPLETED' ? 'complete' : 'failed')
          && (row.kind !== 'FAILED' || reason === process.failureReason), path, '终结必须对应真实过程状态和原因');
      }
      if (useRef !== null && row.kind !== 'WAIT_CHANGED') {
        const key = `${row.kind}/${useRef}`;
        check(!lifecycle.has(key), path, '同一使用的相同事实不得重复发布'); lifecycle.add(key);
      }
    }
    if (!summaryOnly && !recording.truncated) {
      for (const rule of ruleSummaries) {
        const last = [...records].reverse().find(row => row.ruleKey === rule.ruleKey && row.kind === 'WAIT_CHANGED');
        if (last) check(rule.waiting === null ? last.reason === null : last.reason === rule.waiting.reason && last.nextCheckAtMs === rule.waiting.nextCheckAtMs
          && last.relatedRuleKey === (rule.waiting.relatedRuleKeys[0] ?? null), 'automaticSkillRecords.WAIT_CHANGED', '完整等待明细与最后等待状态不一致');
      }
      for (const [kind, field] of [['STARTED', 'startedCount'], ['COMPLETED', 'completedCount'], ['FAILED', 'failedCount'],
        ['ATTEMPT_REJECTED', 'rejectedCount'], ['ABORTED_BEFORE_START', 'abortedBeforeStartCount']] as const) {
        for (const rule of ruleSummaries) check(records.filter(row => row.kind === kind && row.ruleKey === rule.ruleKey).length === rule[field], 'automaticSkillRecords', '完整使用明细与逐规则累计不一致');
      }
      for (const edge of qualifications) {
        const key = edgeKey(edge.grantorRuleKey, edge.consumerRuleKey);
        check(records.filter(row => row.kind === 'QUALIFICATION_GRANTED' && row.ruleKey === edge.grantorRuleKey && row.relatedRuleKey === edge.consumerRuleKey).length === edge.grantedCount
          && records.filter(row => row.kind === 'QUALIFICATION_CONSUMED' && row.ruleKey === edge.consumerRuleKey && row.relatedRuleKey === edge.grantorRuleKey).length === edge.consumedCount
          && Number(ledger.has(key)) === edge.remainingCount && (lastGrant.get(key) ?? null) === edge.lastGrantUseRef
          && (lastConsume.get(key) ?? null) === edge.lastConsumeUseRef, 'automaticSkillRecords.qualifications', '完整授予／消费明细与资格累计及归属不一致');
      }
    }
    for (const side of ['source', 'target'] as const) {
      const initial = request.initialSnapshot.combatants.find(actor => actor.key === side)?.attributes.hp;
      const final = done.finalSnapshot.combatants.find(actor => actor.key === side)?.attributes.hp;
      if (!initial || !final) throw new Error(`finalSnapshot.${side}.hp: 缺少真实生命槽`);
      const loss = number(summary[`${side}HpLoss`], `summary.${side}HpLoss`, false);
      const vamp = number(summary[`${side}VampHealing`], `summary.${side}VampHealing`, false);
      const healing = number(summary[`${side}DirectHealing`], `summary.${side}DirectHealing`, false);
      const hp = number(summary[`${side}FinalHp`], `summary.${side}FinalHp`, false);
      check(close(initial.current - loss + vamp + healing + (done.resourceChangeSummary?.[side].currentIncrease ?? 0)
        - (done.resourceChangeSummary?.[side].currentDecrease ?? 0), hp) && close(final.current, hp) && hp <= final.max, `summary.${side}FinalHp`, '真实生命账及最终槽不守恒');
      number(summary[`${side}DamageDealt`], `summary.${side}DamageDealt`, false); number(summary[`${side}DamageTaken`], `summary.${side}DamageTaken`, false);
    }
    check(close(summary.sourceDamageDealt, summary.targetDamageTaken) && close(summary.targetDamageDealt, summary.sourceDamageTaken), 'summary', '双方造成与承受伤害方向不一致');
    const breakdown = array(summary.damageBreakdown, 'summary.damageBreakdown');
    for (const row of breakdown) {
      check(['source', 'target'].includes(row.owner) && ['source', 'target'].includes(row.source) && ['source', 'target'].includes(row.target)
        && !!simulationAbility(compile, row.abilityRef) && row.abilityRef.startsWith(`${row.owner}.provider[`), 'summary.damageBreakdown', '分类来源必须属于真实编译挂载');
      number(row.damageCount, 'summary.damageBreakdown.damageCount');
      for (const field of ['postDefenseDamage', 'shieldAbsorbed', 'actualHpLoss', 'overkillDamage'] as const) number(row[field], `summary.damageBreakdown.${field}`, false);
      check(close(row.postDefenseDamage, row.shieldAbsorbed + row.actualHpLoss + row.overkillDamage), 'summary.damageBreakdown', '完整分类分解不守恒');
    }
    for (const side of ['source', 'target'] as const) check(close(breakdown.filter(row => row.source === side).reduce((sum, row) => sum + row.postDefenseDamage, 0), summary[`${side}DamageDealt`])
      && close(breakdown.filter(row => row.target === side).reduce((sum, row) => sum + row.actualHpLoss, 0), summary[`${side}HpLoss`]!), 'summary.damageBreakdown', '完整分类与数值累计不一致');
    const damages = array(done.damageRecords, 'damageRecords');
    const healing = array(done.healingRecords, 'healingRecords');
    const attacks = array(done.attackRecords, 'attackRecords');
    const mechanics = array(done.mechanicRecords, 'mechanicRecords');
    if (summaryOnly) check([damages, healing, attacks, mechanics].every(rows => rows.length === 0), 'done.outputMode', '汇总模式必须明确返回空明细数组');
    else {
      if (!done.recording) throw new Error('recording: 缺少通用有限明细统计');
      for (const [kind, rows, maximum] of [['damage', damages, request.recordBudget?.maxDamageRecords ?? 2000], ['healing', healing, request.recordBudget?.maxHealingRecords ?? 2000],
        ['attack', attacks, request.recordBudget?.maxAttackRecords ?? 1000], ['mechanic', mechanics, request.recordBudget?.maxMechanicRecords ?? 2000]] as const) {
        const stats = done.recording as unknown as Row;
        const capital = kind[0]!.toUpperCase() + kind.slice(1);
        const total = number(stats[`${kind}RecordCount`], `recording.${kind}RecordCount`);
        const returned = number(stats[`returned${capital}Records`], `recording.returned${capital}Records`);
        const dropped = number(stats[`dropped${capital}Records`], `recording.dropped${capital}Records`);
        check(returned === rows.length && total === returned + dropped && returned === Math.min(total, maximum)
          && stats[`${kind}RecordsTruncated`] === (dropped > 0), `recording.${kind}`, '通用明细预算与实际丢弃不守恒');
      }
      const hitIdentities = new Map<string, { useRef: string; timeMs: number; hitBindingKey: string }>();
      const executionHits = new Map<string, string>();
      for (const row of damages) {
        const ability = simulationAbility(compile, row.abilityRef);
        check(!!ability && row.abilityRef.startsWith(`${row.owner}.provider[`) && row.timeMs >= 0 && row.timeMs <= duration, 'damageRecords', '伤害拥有者、引用或时刻不一致');
        let operation: unknown = compile;
        for (const piece of row.operationPath.replace(/\[(\d+)\]/g, '.$1').split('.')) operation = operation && typeof operation === 'object' ? (operation as Row)[piece] : undefined;
        const actual = operation as { operation?: string; ref?: string; damageType?: string } | undefined;
        check(actual?.operation === 'damage' && actual.ref === row.operationRef && actual.damageType === row.damageType, 'damageRecords.operationPath', '伤害编译路径与作者结果不一致');
        for (const field of ['postDefenseDamage', 'shieldAbsorbed', 'actualHpLoss', 'overkillDamage', 'hpBefore', 'hpAfter'] as const) number(row[field], `damageRecords.${field}`, false);
        check(close(row.postDefenseDamage, row.shieldAbsorbed + row.actualHpLoss + row.overkillDamage) && close(row.hpBefore - row.actualHpLoss, row.hpAfter), 'damageRecords', '实际伤害及扣血分解不守恒');
        const binding = compile.rules.skillActionBindings?.find(binding => binding.hitBindings.some(hit => hit.hitAbilityRef === row.abilityRef));
        if (binding) check((empoweredAttackBinding(compile, binding) ? !!empoweredDamageProcess(compile, done, row)
          && Number.isSafeInteger(row.attackIndex) && row.attackIndex! > 0 : row.attackIndex === null) && typeof row.useRef === 'string' && findProcess(row.useRef)?.providerRef === binding.providerRef
          && typeof row.hitRef === 'string' && !!row.hitRef && typeof row.instructionKey === 'string' && !!row.instructionKey, 'damageRecords.useRef', '主动命中必须保留实际自动使用及命中身份');
        if (binding && !empoweredAttackBinding(compile, binding)) {
          const process = findProcess(row.useRef);
          const contextKey = process && ruleForUse(process.useKey);
          const context = contextKey ? contexts.get(contextKey) : undefined;
          const hit = binding.hitBindings.find(hit => hit.hitAbilityRef === row.abilityRef);
          const step = context?.process.steps.find(step => step.stepKey === hit?.moment.stepKey);
          const times = process && hit ? processSkillHitTimes(process, hit, row.useRef, context?.process) ?? (step?.stepType === 'CHANNEL' && hit.moment.momentType === 'STEP_EXECUTION'
            ? committedChannelTimes(process, step) : process.lastExecutionAtMs === null ? [] : [process.lastExecutionAtMs]) : [];
          check(!!process && !!context && context.binding === binding && row.source === process.owner && row.target === process.target
            && times.includes(row.timeMs), 'damageRecords.timeMs', '主动伤害必须来自该次使用已提交的实际圈时点');
          if (process && context) {
            const ordinal = recastUseOrdinal(process, context.process, row.useRef);
            if (ordinal !== null) {
              const first = process.useKey.slice('skill:'.length);
              check(row.instructionKey === (ordinal === 0 ? first : `${first}:recast:${ordinal}`), 'damageRecords.instructionKey', '逐发自动指令必须从真实窗口和已提交序号导出');
            }
          }
          if (typeof row.hitRef === 'string' && row.hitRef) {
            const prior = hitIdentities.get(row.hitRef), executionKey = `${row.useRef}/${hit?.hitBindingKey}/${row.timeMs}`;
            check(!prior || prior.useRef === row.useRef && prior.timeMs === row.timeMs && prior.hitBindingKey === hit?.hitBindingKey,
              'damageRecords.hitRef', '同一命中身份不能跨使用、阶段或执行时刻复用');
            check(!executionHits.has(executionKey) || executionHits.get(executionKey) === row.hitRef, 'damageRecords.hitRef', '同一次真实圈执行不能伪造多个主动命中');
            hitIdentities.set(row.hitRef, { useRef: row.useRef, timeMs: row.timeMs, hitBindingKey: hit!.hitBindingKey }); executionHits.set(executionKey, row.hitRef);
          }
        }
      }
      for (const row of healing) {
        const ability = simulationAbility(compile, row.abilityRef);
        check(!!ability && row.abilityRef.startsWith(`${row.source}.provider[`) && ability.ability.listenerSpec?.operations?.some(operation => operation.operation === 'heal' && operation.ref === row.operationRef) === true
          && row.timeMs >= 0 && row.timeMs <= duration, 'healingRecords', '直接治疗必须保留实际编译来源和观察时刻');
        for (const field of ['rawAmount', 'healingAfterDone', 'healingAfterModifiers', 'actualHealing', 'overheal', 'hpBefore', 'hpAfter'] as const) number(row[field], `healingRecords.${field}`, false);
        check(close(row.actualHealing + row.overheal, row.healingAfterModifiers) && close(row.hpBefore + row.actualHealing, row.hpAfter), 'healingRecords', '治疗及溢出与生命变化不守恒');
        if (row.instructionKey !== null) check(row.useRef !== null && !!findProcess(row.useRef), 'healingRecords.useRef', '自动治疗不得伪造实际使用身份');
        const process = row.useRef && findProcess(row.useRef);
        const definition = process && definitions.find(d => d.processKey === process.processKey && d.skillKey === process.skillKey);
        const ordinal = process && definition && row.useRef ? recastUseOrdinal(process, definition, row.useRef) : null;
        if (ordinal !== null && process) {
          const first = process.useKey.slice('skill:'.length);
          check(row.instructionKey === (ordinal === 0 ? first : `${first}:recast:${ordinal}`), 'healingRecords.instructionKey', '重施派生治疗必须保留当前真实施放指令');
        }
      }
      if (!done.resourceChangeSummary && !done.recording.damageRecordsTruncated && !done.recording.healingRecordsTruncated) issues.push(...inspectSimulationHealthLedger(compile, request, done));
      if (request.driverPlan.basicAttack) {
        const background = assessContinuousAttackResult(compile, request, done, origins);
        issues.push(...background.issues);
        identityGaps.push(...background.identityGaps);
      } else issues.push(...inspectActiveAmmoMechanics(compile, request, done, processFacts.processes, mechanics));
    }
    issues.push(...inspectResourceChangeContract(compile, request, done));
    const initializedHealth = inspectPermanentHealthInitialization(compile, request, done);
    issues.push(...initializedHealth.issues); identityGaps.push(...initializedHealth.identityGaps);
    if (done.resourceChangeSummary) issues.push(...inspectSimulationHealthLedger(compile, request, done));
    if (request.driverPlan.basicAttack) {
      const basic = object(summary.basicAttack, 'summary.basicAttack');
      const started = number(basic.startedCount, 'summary.basicAttack.startedCount');
      const hit = number(basic.hitCount, 'summary.basicAttack.hitCount');
      const complete = number(basic.completedCount, 'summary.basicAttack.completedCount');
      check(basic.planKey === request.driverPlan.basicAttack.planKey && complete <= hit && hit <= started, 'summary.basicAttack', '真实背景普攻累计不一致');
    } else check(!hasOwn(summary, 'basicAttack') && attacks.length === 0, 'summary.basicAttack', '关闭背景普攻后不能造普攻事实');
    issues.push(...inspectContinuousAttackSeries(request, done).seriesIssues);
  } catch (cause) { issues.push(cause instanceof Error ? cause.message : String(cause)); }
  return { complete: issues.length === 0 && done.summary.execution?.complete === true, factsValid: issues.length === 0,
    detailIdentityVerified: issues.length === 0 && identityGaps.length === 0, identityGaps, issues };
}
