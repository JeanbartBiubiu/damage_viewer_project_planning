import { Input, Select, Space, Typography } from '@arco-design/web-react';
import type { SkillFlatParamsForm } from './skillModels';

type SkillFlatParamsEditorProps = {
  form: SkillFlatParamsForm;
  disabled?: boolean;
  onChange: (form: SkillFlatParamsForm) => void;
};

function renderNumberInput(label: string, value: string, disabled: boolean, onChange: (value: string) => void, placeholder?: string) {
  return (
    <div>
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
        {label}
      </Typography.Text>
      <Input value={value} disabled={disabled} onChange={onChange} placeholder={placeholder ?? '可选'} />
    </div>
  );
}

export function SkillFlatParamsEditor({ form, disabled = false, onChange }: SkillFlatParamsEditorProps) {
  const update = (patch: Partial<SkillFlatParamsForm>) => {
    onChange({ ...form, ...patch });
  };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div>
        <Typography.Text bold>旧 Flat 快速区</Typography.Text>
        <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
          仅覆盖简单伤害技能常用字段，复杂 vars/conditions 仍建议走高级 JSON。
        </Typography.Text>
      </div>

      <div className="crud-form-grid">
        <div>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
            damageType
          </Typography.Text>
          <Select
            allowClear
            value={form.damageType || undefined}
            disabled={disabled}
            options={[
              { label: 'physical', value: 'physical' },
              { label: 'magic', value: 'magic' },
              { label: 'true', value: 'true' }
            ]}
            onChange={(value) => update({ damageType: String(value ?? '') })}
          />
        </div>

        {renderNumberInput('baseDamage', form.baseDamage, disabled, (value) => update({ baseDamage: value }))}
      </div>

      {renderNumberInput(
        'baseDamageBySkillLevel（逗号分隔）',
        form.baseDamageBySkillLevel,
        disabled,
        (value) => update({ baseDamageBySkillLevel: value }),
        '例如：80, 115, 150, 185, 220'
      )}

      <div className="crud-form-grid">
        {renderNumberInput('attackRatio', form.attackRatio, disabled, (value) => update({ attackRatio: value }))}
        {renderNumberInput('adRatio', form.adRatio, disabled, (value) => update({ adRatio: value }))}
      </div>

      <div className="crud-form-grid">
        {renderNumberInput('apRatio', form.apRatio, disabled, (value) => update({ apRatio: value }))}
        {renderNumberInput('bonusAttackSpeedRatio', form.bonusAttackSpeedRatio, disabled, (value) => update({ bonusAttackSpeedRatio: value }))}
      </div>

      <div className="crud-form-grid">
        {renderNumberInput('hitCount', form.hitCount, disabled, (value) => update({ hitCount: value }))}
        {renderNumberInput('hitIntervalMs', form.hitIntervalMs, disabled, (value) => update({ hitIntervalMs: value }))}
      </div>

      <div className="crud-form-grid">
        {renderNumberInput('channelDurationMs', form.channelDurationMs, disabled, (value) => update({ channelDurationMs: value }))}
        {renderNumberInput('defaultSkillLevel', form.defaultSkillLevel, disabled, (value) => update({ defaultSkillLevel: value }))}
      </div>
    </Space>
  );
}