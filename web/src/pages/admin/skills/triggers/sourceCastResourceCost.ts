import type { Attribute } from '../../../../types/attribute';
import type { SkillParameter } from '../../../../types/skillParameter';
import type { SkillTriggerEventSource, SkillTriggerSourceCastResourceCostBinding } from '../../../../types/skillTriggerRule';

export function allowsSourceCastResourceCost(eventSource: SkillTriggerEventSource): boolean {
  return eventSource.eventType === 'SKILL_HIT'
    && typeof eventSource.detail.sourceSkillKey === 'string'
    && /^[a-z][a-z0-9_]{0,63}$/.test(eventSource.detail.sourceSkillKey);
}

export function sourceCastResourceCostError(
  binding: SkillTriggerSourceCastResourceCostBinding,
  eventSource: SkillTriggerEventSource,
  reachableParameters: readonly SkillParameter[],
  attributes: readonly Pick<Attribute, 'attributeKey'>[],
  attributesLoadState: 'idle' | 'loading' | 'ready' | 'error' | undefined
): string | null {
  if (!allowsSourceCastResourceCost(eventSource)) return '来源施放资源消耗仅用于已明确来源技能的技能命中事件。';
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
