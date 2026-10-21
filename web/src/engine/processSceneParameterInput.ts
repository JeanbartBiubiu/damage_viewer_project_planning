import type { SkillConfiguration } from '../types/skillConfiguration';
import type { NumericValue } from '../types/numericValue';
import type { SkillTriggerAction, SkillTriggerRuleDetail, SkillTriggerSceneInitialParameterBinding } from '../types/skillTriggerRule';
import { skillFormulaReachableInputs } from '../services/skillFormulaContract';
import { sceneInitialParameterDetailIssue } from '../services/sceneInitialParameterContract';
import { NumericAdaptationError } from './numericAdapter';

export type ProcessSceneParameterConfiguration = Pick<SkillConfiguration, 'parameters' | 'formulas' | 'processes' | 'effects'> & {
  skill: Pick<SkillConfiguration['skill'], 'gameId' | 'skillKey'>;
};
function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }

/** 冻结场景值仅供真实首次过程的命中负载伤害金额；不进入过程通用求值上下文。 */
export function validateProcessSceneParameterBinding(configuration: ProcessSceneParameterConfiguration, rule: SkillTriggerRuleDetail,
  action: SkillTriggerAction, binding: SkillTriggerSceneInitialParameterBinding, path: string): string {
  const skillKey = configuration.skill.skillKey;
  const parameter = configuration.parameters.filter(row => row.parameterKey === binding.parameterKey);
  const detailIssue = sceneInitialParameterDetailIssue(binding.detail, parameter[0]?.valueType === 'INTEGER');
  if (detailIssue) fail(path, detailIssue);
  if (rule.eventSource.eventType !== 'SKILL_USED' || rule.eventSource.detail.sourceSkillKey !== skillKey
    || rule.eventSource.detail.useKind !== 'ACTIVE' || rule.eventSource.detail.castPhase !== 'INITIAL'
    || action.actionType !== 'START_PROCESS' || action.targetContext !== 'CURRENT_TARGET' || action.resultModifiers.length
    || parameter.length !== 1 || parameter[0]!.gameId !== configuration.skill.gameId || parameter[0]!.skillKey !== skillKey
    || parameter[0]!.valueMode !== 'RUNTIME_INPUT' || parameter[0]!.fixedValue !== null || parameter[0]!.levelValues !== null
    || !['INTEGER', 'DECIMAL'].includes(parameter[0]!.valueType)) fail(path, '场景负载输入只允许本技能真实首次主动过程及无默认数值参数');
  const processes = configuration.processes.filter(row => row.processKey === action.detail.processKey);
  const process = processes[0];
  if (processes.length !== 1 || !process || process.skillKey !== skillKey || process.activationType !== 'ACTIVE'
    || process.steps.length !== 1 || process.steps[0]!.stepType !== 'EMPOWERED_BASIC_ATTACK') fail(path, '场景负载输入必须引用唯一真实强化过程');
  const stepKey = process.steps[0]!.stepKey;
  const consumes = (value: NumericValue): boolean => {
    if (value.kind === 'PARAMETER') return value.parameterKey === binding.parameterKey;
    if (value.kind !== 'FORMULA') return false;
    const formulas = configuration.formulas.filter(row => row.formulaKey === value.formulaKey);
    if (formulas.length !== 1) fail(path, '负载公式缺失或重复');
    return skillFormulaReachableInputs(formulas[0]!.expression).some(input => input.binding.kind === 'parameter'
      && input.binding.skillKey === skillKey && input.binding.parameterKey === binding.parameterKey);
  };
  const allowed = new Set<NumericValue>();
  const effects = process.effectBindings.map(link => {
    const rows = configuration.effects.filter(row => row.effectKey === link.effectKey);
    if (rows.length !== 1) fail(path, '真实过程效果缺失或重复');
    const effect = rows[0]!;
    if (link.moment.momentType === 'STEP_EXECUTION' && link.moment.stepKey === stepKey && link.moment.failureReason == null) {
      for (const result of effect.results) if (result.resultType === 'DAMAGE' && result.target === 'TARGET'
        && result.lifecycleBehavior === null && result.valueRule && consumes(result.valueRule.value)) allowed.add(result.valueRule.value);
    }
    return effect;
  });
  if (!allowed.size) fail(path, '场景参数没有被本过程真实命中负载伤害金额消费');
  const inspect = (value: unknown, location: string): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((row, index) => inspect(row, `${location}[${index}]`)); return; }
    const row = value as Record<string, unknown>;
    if (['FIXED', 'PARAMETER', 'FORMULA'].includes(String(row.kind))) {
      if (consumes(value as NumericValue) && !allowed.has(value as NumericValue)) fail(location, '场景负载参数不得供给费用、冷却、时间、生命周期、条件或状态操作');
      return;
    }
    for (const [key, child] of Object.entries(row)) inspect(child, `${location}.${key}`);
  };
  inspect(process, `skills.${skillKey}.processes.${process.processKey}`);
  effects.forEach(effect => inspect(effect, `skills.${skillKey}.effects.${effect.effectKey}`));
  inspect(rule.conditionGroups, `${path}.conditionGroups`);
  return process.processKey;
}
