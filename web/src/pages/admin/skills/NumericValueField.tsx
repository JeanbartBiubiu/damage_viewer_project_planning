import { Alert, Button, InputNumber, Radio, Select, Space } from '@arco-design/web-react';
import type { NumericValue } from '../../../types/numericValue';
import type { SkillParameter } from '../../../types/skillParameter';

type Props = {
  value: NumericValue | null | undefined;
  onChange: (value: NumericValue | null) => void;
  parameters: readonly SkillParameter[];
  formulas: ReadonlyArray<{ formulaKey: string; name?: string }>;
  parametersLoadState?: 'ready' | 'failed';
  formulasLoadState?: 'ready' | 'failed';
  disabled?: boolean;
  allowClear?: boolean;
  'aria-label': string;
};

export function NumericValueField({ value, onChange, parameters, formulas, parametersLoadState, formulasLoadState, disabled, allowClear, 'aria-label': label }: Props) {
  const kind = value?.kind ?? 'FIXED';
  return <div role="group" aria-label={label}><Space direction="vertical" style={{ width: '100%' }}>
    <Radio.Group aria-label={`${label}取值来源`} value={kind} disabled={disabled}
      onChange={(next) => {
        if (next === kind && value) return;
        onChange(next === 'FIXED' ? { kind: 'FIXED', value: Number.NaN }
          : next === 'PARAMETER' ? { kind: 'PARAMETER', parameterKey: '' } : { kind: 'FORMULA', formulaKey: '' });
      }}>
      <Radio value="FIXED">固定数值</Radio><Radio value="PARAMETER">技能参数</Radio><Radio value="FORMULA">技能公式</Radio>
    </Radio.Group>
    {kind === 'FIXED' ? <InputNumber aria-label={`${label}固定数值`} style={{ width: '100%' }} disabled={disabled}
      value={value?.kind === 'FIXED' && Number.isFinite(value.value) ? value.value : undefined}
      onChange={(next) => onChange({ kind: 'FIXED', value: next ?? Number.NaN })} />
      : kind === 'PARAMETER' ? <Select aria-label={`${label}技能参数`} style={{ width: '100%' }} disabled={disabled}
        value={value?.kind === 'PARAMETER' ? value.parameterKey || undefined : undefined}
        options={parameters.map((item) => ({ value: item.parameterKey, label: `${item.name}（${item.parameterKey}）` }))}
        onChange={(next) => onChange({ kind: 'PARAMETER', parameterKey: String(next) })} />
        : <Select aria-label={`${label}技能公式`} style={{ width: '100%' }} disabled={disabled}
          value={value?.kind === 'FORMULA' ? value.formulaKey || undefined : undefined}
          options={formulas.map((item) => ({ value: item.formulaKey, label: `${item.name || item.formulaKey}（${item.formulaKey}）` }))}
          onChange={(next) => onChange({ kind: 'FORMULA', formulaKey: String(next) })} />}
    {kind === 'PARAMETER' && parametersLoadState === 'failed' ? <Alert type="error" content="参数目录加载失败，请重试后选择技能参数。" /> : null}
    {kind === 'FORMULA' && formulasLoadState === 'failed' ? <Alert type="error" content="公式目录加载失败，请重试后选择技能公式。" /> : null}
    {allowClear && value ? <Button size="mini" disabled={disabled} onClick={() => onChange(null)} aria-label={`${label}清除取值`}>清除取值</Button> : null}
  </Space></div>;
}
