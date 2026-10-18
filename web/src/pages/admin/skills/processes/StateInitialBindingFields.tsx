import { Form, Input, InputNumber, Space, Switch } from '@arco-design/web-react';
import type { NumericValue } from '../../../../types/numericValue';
import type { SkillTriggerSceneInitialParameterBinding } from '../../../../types/skillTriggerRule';

export function StateInitialBindingFields({ label, binding, numeric, disabled, error, onChange }: {
  label: string; binding?: SkillTriggerSceneInitialParameterBinding; numeric: NumericValue | null | undefined;
  disabled: boolean; error?: string; onChange: (value: SkillTriggerSceneInitialParameterBinding | undefined) => void;
}) {
  return <Form.Item label={`${label}场景声明`} validateStatus={error ? 'error' : undefined} help={error}
    extra="直接引用本技能无默认整数参数；这里只声明范围，每次计算由场景填写实际值。">
    <Space direction="vertical" style={{ width: '100%' }}>
      <Switch aria-label={`${label}场景声明`} checked={binding !== undefined} disabled={disabled}
        onChange={checked => onChange(checked ? { bindingKey: '', parameterKey: numeric?.kind === 'PARAMETER' ? numeric.parameterKey : '',
          sourceType: 'SCENE_INITIAL_PARAMETER', detail: { minValue: Number.NaN, maxValue: Number.NaN } } : undefined)} />
      {binding && <>
        <Input aria-label={`${label}声明标识`} value={binding.bindingKey} disabled={disabled} placeholder="声明标识"
          onChange={bindingKey => onChange({ ...binding, bindingKey })} />
        <Input aria-label={`${label}参数标识`} value={binding.parameterKey} disabled={disabled} placeholder="须与上方数值参数相同"
          onChange={parameterKey => onChange({ ...binding, parameterKey })} />
        <Space>
          <InputNumber aria-label={`${label}最小值`} min={0} precision={0} disabled={disabled}
            value={Number.isFinite(binding.detail.minValue) ? binding.detail.minValue : undefined} placeholder="最小值"
            onChange={value => onChange({ ...binding, detail: { ...binding.detail, minValue: value ?? Number.NaN } })} />
          <InputNumber aria-label={`${label}最大值`} min={0} precision={0} disabled={disabled}
            value={Number.isFinite(binding.detail.maxValue) ? binding.detail.maxValue : undefined} placeholder="最大值"
            onChange={value => onChange({ ...binding, detail: { ...binding.detail, maxValue: value ?? Number.NaN } })} />
        </Space>
      </>}
    </Space>
  </Form.Item>;
}
