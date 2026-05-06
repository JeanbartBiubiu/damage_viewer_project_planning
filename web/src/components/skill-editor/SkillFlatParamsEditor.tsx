import { Input, Select, Space, Typography } from '@arco-design/web-react';
import { appendCurrentDamageTypeOption, type DamageTypeOption } from '../../pages/admin/resources/shared/damageTypes';
import type { SkillFlatParamsForm } from './skillModels';

type SkillFlatParamsEditorProps = {
  form: SkillFlatParamsForm;
  damageTypeOptions: DamageTypeOption[];
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

export function SkillFlatParamsEditor({ form, damageTypeOptions, disabled = false, onChange }: SkillFlatParamsEditorProps) {
  const update = (patch: Partial<SkillFlatParamsForm>) => {
    onChange({ ...form, ...patch });
  };

  const defaultDamageTypeValue = damageTypeOptions[0]?.value ?? '';
  const mergedDamageTypeOptions = appendCurrentDamageTypeOption(
    damageTypeOptions,
    form.damageType,
    form.damageType ? `${form.damageType} (legacy)` : undefined
  );

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div>
        <Typography.Text bold>旧版 Flat 快速区</Typography.Text>
        <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
          这里只覆盖简单伤害技能常用字段，复杂 vars 或 conditions 仍建议走高级 JSON。
        </Typography.Text>
      </div>

      <div className="crud-form-grid">
        <div>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
            伤害类型（damageType）
          </Typography.Text>
          <Select
            allowClear
            value={form.damageType || undefined}
            disabled={disabled}
            options={mergedDamageTypeOptions}
            onChange={(value) => update({ damageType: String(value ?? defaultDamageTypeValue) })}
          />
        </div>

        {renderNumberInput('基础伤害（baseDamage）', form.baseDamage, disabled, (value) => update({ baseDamage: value }))}
      </div>

      {renderNumberInput(
        '按技能等级的基础伤害（baseDamageBySkillLevel，逗号分隔）',
        form.baseDamageBySkillLevel,
        disabled,
        (value) => update({ baseDamageBySkillLevel: value }),
        '例如：80, 115, 150, 185, 220'
      )}

      <div className="crud-form-grid">
        {renderNumberInput('攻击力系数（attackRatio）', form.attackRatio, disabled, (value) => update({ attackRatio: value }))}
        {renderNumberInput('AD 系数（adRatio）', form.adRatio, disabled, (value) => update({ adRatio: value }))}
      </div>

      <div className="crud-form-grid">
        {renderNumberInput('AP 系数（apRatio）', form.apRatio, disabled, (value) => update({ apRatio: value }))}
        {renderNumberInput('额外攻速系数（bonusAttackSpeedRatio）', form.bonusAttackSpeedRatio, disabled, (value) =>
          update({ bonusAttackSpeedRatio: value })
        )}
      </div>

      <div className="crud-form-grid">
        {renderNumberInput('命中次数（hitCount）', form.hitCount, disabled, (value) => update({ hitCount: value }))}
        {renderNumberInput('命中间隔（hitIntervalMs）', form.hitIntervalMs, disabled, (value) => update({ hitIntervalMs: value }))}
      </div>

      <div className="crud-form-grid">
        {renderNumberInput('引导时长（channelDurationMs）', form.channelDurationMs, disabled, (value) =>
          update({ channelDurationMs: value })
        )}
        {renderNumberInput('默认技能等级（defaultSkillLevel）', form.defaultSkillLevel, disabled, (value) =>
          update({ defaultSkillLevel: value })
        )}
      </div>
    </Space>
  );
}
