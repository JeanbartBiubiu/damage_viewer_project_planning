import type { SkillInternalState } from '../types/skillInternalState';
import type { SkillParameter } from '../types/skillParameter';
import type { NumericValue } from '../types/numericValue';
import type { SkillTriggerSceneInitialParameterBinding } from '../types/skillTriggerRule';
import { NumericAdaptationError } from './numericAdapter';

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }
function exact(value: unknown, keys: readonly string[], path: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
    || Object.keys(value).some(key => !keys.includes(key))) fail(path, '场景初值声明形状不完整');
}

/** 状态初值只授权其真实引用字段，不把输入借给容量、时长或其它数值。 */
export function validateStateInitialBinding(row: SkillInternalState, field: 'initialValue' | 'initialRemainingValue',
  parameters: readonly SkillParameter[], gameId: string, skillKey: string, path: string): SkillTriggerSceneInitialParameterBinding | undefined {
  if (row.stateType !== 'COUNTER' && row.stateType !== 'AMMO') return undefined;
  const binding = field === 'initialValue' ? row.detail.initialValueBinding
    : row.stateType === 'AMMO' ? row.detail.initialRemainingMsBinding : undefined;
  if (binding === undefined) return undefined;
  if (row.scope !== 'SKILL') fail(path, '场景状态初值只允许本技能自身计数或弹药');
  exact(binding, ['bindingKey', 'parameterKey', 'sourceType', 'detail'], path);
  exact(binding.detail, ['minValue', 'maxValue'], `${path}.detail`);
  if (typeof binding.bindingKey !== 'string' || typeof binding.parameterKey !== 'string'
    || !/^[a-z][a-z0-9_]{0,63}$/.test(binding.bindingKey) || !/^[a-z][a-z0-9_]{0,63}$/.test(binding.parameterKey)
    || binding.sourceType !== 'SCENE_INITIAL_PARAMETER') fail(path, '状态初值必须明确声明场景输入');
  const value: NumericValue | undefined = field === 'initialValue' ? row.detail.initialValue
    : row.stateType === 'AMMO' ? row.detail.initialRemainingValue : undefined;
  if (!value || value.kind !== 'PARAMETER' || value.parameterKey !== binding.parameterKey) fail(path, '声明必须被对应状态初值直接消费');
  const matches = parameters.filter(parameter => parameter.parameterKey === binding.parameterKey);
  const parameter = matches[0];
  if (matches.length !== 1 || !parameter || parameter.gameId !== gameId || parameter.skillKey !== skillKey
    || parameter.valueMode !== 'RUNTIME_INPUT' || parameter.valueType !== 'INTEGER'
    || parameter.fixedValue !== null || parameter.levelValues !== null) fail(path, '状态初值必须绑定本技能无默认的整数计算时参数');
  const { minValue, maxValue } = binding.detail;
  if (!Number.isSafeInteger(minValue) || !Number.isSafeInteger(maxValue) || minValue < 0 || minValue > maxValue) fail(path, '状态初值边界必须为有序的非负安全整数');
  return binding;
}
