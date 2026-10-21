import type { SkillProcess } from '../types/skillProcess';
import type { SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import type { ProcessDefinition, ProcessMomentDefinition } from '../types/genericEngine';
import { NumericAdaptationError, tryFoldConstant } from './numericAdapter';

export type ProcessSkillHitStage = {
  rules: SkillTriggerRuleDetail[];
  abilityKey: string;
  hitBindingKey: string;
  moment: ProcessMomentDefinition;
  requiresPriorHitBindingKey?: string;
  authorPaths: string[];
};

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }
const keyPattern = /^[a-z][a-z0-9_]{0,63}$/;
function exact(value: unknown, fields: string[], path: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length
    || Object.keys(value).some(key => !fields.includes(key))) fail(path, '分阶段命中声明必须完整且不能含额外字段');
}

/** 完整验证作者阶段图后才降低事件元数据；每个真实时点只生成一个命中绑定。 */
export function processSkillHitStages(skillKey: string, process: SkillProcess, rules: readonly SkillTriggerRuleDetail[]): ProcessSkillHitStage[] {
  if (!rules.length) return [];
  const root = `skills.${skillKey}`;
  const explicit = rules.some(rule => rule.eventSource.eventType === 'SKILL_HIT'
    && Object.prototype.hasOwnProperty.call(rule.eventSource.detail, 'processMoment'));
  const steps = [...process.steps].sort((a, b) => a.sortOrder - b.sortOrder);
  if (!explicit) {
    const terminal = steps[steps.length - 1];
    if (!terminal) return fail(`${root}.processes.${process.processKey}`, '命中缺少真实过程步骤');
    const stepExecution = ['CHARGE', 'RECAST', 'MULTI_HIT', 'CHANNEL', 'EMPOWERED_BASIC_ATTACK'].includes(terminal.stepType);
    return [{ rules: [...rules], abilityKey: 'selected_skill_hit', hitBindingKey: 'selected_skill_release_hit',
      moment: { momentType: stepExecution ? 'STEP_EXECUTION' : 'PROCESS_COMPLETE', stepKey: stepExecution ? terminal.stepKey : null, failureReason: null }, authorPaths: [] }];
  }
  if (process.skillKey !== skillKey || process.activationType !== 'ACTIVE' || steps.length < 1 || steps.length > 64
    || steps.some(step => !['IMMEDIATE', 'DELAY'].includes(step.stepType))
    || steps.length > 1 && !steps.some(step => step.stepType === 'DELAY')
    || steps.some(step => !Number.isFinite(step.sortOrder)) || new Set(steps.map(step => step.sortOrder)).size !== steps.length
    || new Set(steps.map(step => step.stepKey)).size !== steps.length) {
    fail(`${root}.processes.${process.processKey}`, '分阶段命中只接同技能有明确排序的1至64个即时或延时步骤');
  }
  const groups = new Map<string, { rules: SkillTriggerRuleDetail[]; prior: string | null; paths: string[] }>();
  for (const rule of rules) {
    const path = `${root}.triggerRules.${rule.ruleKey}.eventSource.detail`;
    if (rule.eventSource.eventType !== 'SKILL_HIT' || !Object.prototype.hasOwnProperty.call(rule.eventSource.detail, 'processMoment')) {
      fail(path, '同一主动过程不能混合隐式末尾与显式阶段命中');
    }
    const detail = rule.eventSource.detail;
    exact(detail, ['sourceSkillKey', 'processMoment'], path);
    if (detail.sourceSkillKey !== skillKey) fail(path, '分阶段命中必须来自本主动作者技能');
    const stage = detail.processMoment;
    exact(stage, ['processKey', 'moment', 'requiresPriorStepKey'], `${path}.processMoment`);
    exact(stage.moment, ['momentType', 'stepKey'], `${path}.processMoment.moment`);
    if (stage.processKey !== process.processKey || stage.moment.momentType !== 'STEP_EXECUTION'
      || typeof stage.moment.stepKey !== 'string' || !keyPattern.test(stage.moment.stepKey)
      || !steps.some(step => step.stepKey === stage.moment.stepKey)
      || stage.requiresPriorStepKey !== null && (typeof stage.requiresPriorStepKey !== 'string' || !keyPattern.test(stage.requiresPriorStepKey))
      || !rule.actions.length) fail(path, '分阶段命中必须引用本首次过程真实步骤与明确前置阶段');
    const stepKey = stage.moment.stepKey;
    let group = groups.get(stepKey);
    if (group && group.prior !== stage.requiresPriorStepKey) fail(path, '同一阶段全部命中规则的前置依赖必须一致');
    if (!group) { group = { rules: [], prior: stage.requiresPriorStepKey, paths: [] }; groups.set(stepKey, group); }
    if (group.rules.some(existing => existing.sortOrder === rule.sortOrder || existing.ruleKey === rule.ruleKey)) fail(path, '同一阶段规则排序或标识重复');
    group.rules.push({ ...structuredClone(rule), eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: skillKey } } });
    group.paths.push(`${path}.processMoment`);
  }
  const ordered = steps.filter(step => groups.has(step.stepKey));
  const indices = new Map(ordered.map((step, index) => [step.stepKey, index]));
  return ordered.map((step, index) => {
    const group = groups.get(step.stepKey)!;
    const prior = group.prior === null ? undefined : indices.get(group.prior);
    if (group.prior !== null && (prior === undefined || prior >= index)) fail(`${root}.processes.${process.processKey}.steps.${step.stepKey}`,
      '前置阶段必须是同过程严格更早且有实际命中规则的阶段');
    return { rules: group.rules.sort((a, b) => a.sortOrder - b.sortOrder), abilityKey: `selected_skill_hit_${index}`,
      hitBindingKey: `selected_skill_release_hit_${index}`, moment: { momentType: 'STEP_EXECUTION', stepKey: step.stepKey, failureReason: null },
      ...(prior !== undefined ? { requiresPriorHitBindingKey: `selected_skill_release_hit_${prior}` } : {}), authorPaths: group.paths };
  });
}

/** 自动入口仅新增明确的有限普通步骤链；复杂步骤仍保留原单步骤边界。 */
export function automaticProcessShapeAllowed(steps: readonly { stepType: string }[]): boolean {
  if (steps.length === 1) return ['IMMEDIATE', 'DELAY', 'EMPOWERED_BASIC_ATTACK', 'CHANNEL'].includes(steps[0]!.stepType);
  return steps.length > 1 && steps.length <= 64 && steps.every(step => ['IMMEDIATE', 'DELAY'].includes(step.stepType))
    && steps.some(step => step.stepType === 'DELAY');
}

export function automaticProcessStepsAllowed(process: Pick<ProcessDefinition, 'steps'>): boolean {
  const steps = process.steps;
  if (!automaticProcessShapeAllowed(steps)) return false;
  if (steps.length === 1) return true;
  return steps.length > 1 && steps.length <= 64 && steps.every(step => ['IMMEDIATE', 'DELAY'].includes(step.stepType)
    && typeof step.occupiesAction === 'boolean') && new Set(steps.map(step => step.stepKey)).size === steps.length && steps.some(step => step.stepType === 'DELAY')
    && steps.every(step => step.stepType !== 'DELAY' || step.delayMs !== undefined
      && (() => { const duration = tryFoldConstant(step.delayMs); return duration === null || Number.isSafeInteger(duration) && duration > 0; })());
}
