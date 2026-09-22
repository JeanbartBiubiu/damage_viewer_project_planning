import type { Attribute } from '../../../../types/attribute';
import type { SkillParameter } from '../../../../types/skillParameter';
import type { SkillProcessActivationType } from '../../../../types/skillProcess';
import type { SkillTriggerEventSource, SkillTriggerSourceCastResourceCostBinding } from '../../../../types/skillTriggerRule';

export type SourceCastResourceCostProcess = {
  processKey: string;
  activationType: SkillProcessActivationType;
};

export function sourceCastResourceCostEventEligible(eventSource: SkillTriggerEventSource): boolean {
  if (eventSource.eventType === 'SKILL_HIT') {
    return typeof eventSource.detail.sourceSkillKey === 'string'
      && /^[a-z][a-z0-9_]{0,63}$/.test(eventSource.detail.sourceSkillKey);
  }
  if (eventSource.eventType === 'PROCESS_MOMENT') {
    const momentType = eventSource.detail.moment.momentType;
    return momentType === 'PROCESS_COMPLETE' || momentType === 'PROCESS_FAILURE';
  }
  return false;
}

export function allowsSourceCastResourceCost(
  eventSource: SkillTriggerEventSource,
  processes?: ReadonlyArray<SourceCastResourceCostProcess>
): boolean {
  if (!sourceCastResourceCostEventEligible(eventSource)) return false;
  if (eventSource.eventType !== 'PROCESS_MOMENT') return true;
  if (!processes) return true;
  const process = processes.find((item) => item.processKey === eventSource.detail.processKey);
  if (!process) return true;
  return process.activationType !== 'PASSIVE';
}

export function sourceCastResourceCostError(
  binding: SkillTriggerSourceCastResourceCostBinding,
  eventSource: SkillTriggerEventSource,
  reachableParameters: readonly SkillParameter[],
  attributes: readonly Pick<Attribute, 'attributeKey'>[],
  attributesLoadState: 'idle' | 'loading' | 'ready' | 'error' | undefined,
  processes?: ReadonlyArray<SourceCastResourceCostProcess>,
  processesLoadState?: 'idle' | 'loading' | 'ready' | 'error'
): string | null {
  if (!sourceCastResourceCostEventEligible(eventSource)) {
    return '来源施放资源消耗仅用于已明确来源技能的技能命中，或当前技能非被动过程的完成与失败时点。';
  }
  if (eventSource.eventType === 'PROCESS_MOMENT') {
    if (processesLoadState !== undefined && processesLoadState !== 'ready') {
      return '过程目录尚未成功加载，请刷新后继续；当前草稿已保留。';
    }
    const process = processes?.find((item) => item.processKey === eventSource.detail.processKey);
    if (!process || process.activationType === 'PASSIVE') {
      return '请选择当前技能已存在的主动或消耗过程。';
    }
  }
  const parameter = reachableParameters.find((item) => item.parameterKey === binding.parameterKey);
  if (!parameter || parameter.valueMode !== 'RUNTIME_INPUT' || parameter.valueType !== 'DECIMAL') {
    return '请选择当前动作可达的计算时输入十进制参数。';
  }
  if (attributesLoadState !== 'ready') return '属性目录尚未成功加载，请刷新后继续；当前草稿已保留。';
  if (!attributes.some((item) => item.attributeKey === binding.detail.attributeKey)) {
    return '请选择当前游戏已存在的消耗属性。';
  }
  return null;
}
