import { Button, Empty, Input, InputNumber, Select, Space, Typography } from '@arco-design/web-react';
import type { SkillValueDefinitionKind, SkillValueDefinitionRow } from './skillModels';
import { createEmptyValueDefinitionRow } from './skillModels';

type SkillSeriesEditorProps = {
  title: string;
  description: string;
  rows: SkillValueDefinitionRow[];
  disabled?: boolean;
  onChange: (rows: SkillValueDefinitionRow[]) => void;
};

const VALUE_KIND_OPTIONS: Array<{ label: string; value: SkillValueDefinitionKind }> = [
  { label: '固定值', value: 'const' },
  { label: '等级表', value: 'table' },
  { label: '公式', value: 'formula' }
];

export function SkillSeriesEditor({ title, description, rows, disabled = false, onChange }: SkillSeriesEditorProps) {
  const addRow = () => {
    onChange([...rows, createEmptyValueDefinitionRow()]);
  };

  const updateRow = (index: number, patch: Partial<SkillValueDefinitionRow>) => {
    onChange(rows.map((row, currentIndex) => (currentIndex === index ? { ...row, ...patch } : row)));
  };

  const updateKind = (index: number, kind: SkillValueDefinitionKind) => {
    onChange(
      rows.map((row, currentIndex) =>
        currentIndex === index
          ? {
              ...createEmptyValueDefinitionRow(kind),
              raw: row.raw
            }
          : row
      )
    );
  };

  const removeRow = (index: number) => {
    onChange(rows.filter((_, currentIndex) => currentIndex !== index));
  };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Typography.Text bold>{title}</Typography.Text>
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
            {description}
          </Typography.Text>
        </div>
        <Button size="small" type="primary" onClick={addRow} disabled={disabled}>
          添加条目
        </Button>
      </div>

      {rows.length === 0 ? (
        <Empty description="暂无条目，点击“添加条目”开始录入。" />
      ) : (
        rows.map((row, index) => (
          <div key={`${row.kind}-${index}`} style={{ border: '1px solid var(--color-border-2)', borderRadius: 8, padding: 12 }}>
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <div className="crud-form-grid">
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                    类型（kind）
                  </Typography.Text>
                  <Select
                    value={row.kind}
                    disabled={disabled}
                    options={VALUE_KIND_OPTIONS}
                    onChange={(value) => updateKind(index, value as SkillValueDefinitionKind)}
                  />
                </div>

                {row.kind === 'const' ? (
                  <div>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                      数值（value）
                    </Typography.Text>
                    <InputNumber
                      style={{ width: '100%' }}
                      value={row.value}
                      disabled={disabled}
                      onChange={(value) => updateRow(index, { value: value == null ? undefined : Number(value) })}
                    />
                  </div>
                ) : null}

                {row.kind === 'table' ? (
                  <div>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                      维度（by）
                    </Typography.Text>
                    <Select
                      value={row.by}
                      disabled={disabled}
                      options={[
                        { label: '技能等级', value: 'skillLevel' },
                        { label: '英雄等级', value: 'championLevel' }
                      ]}
                      onChange={(value) => updateRow(index, { by: String(value ?? 'skillLevel') })}
                    />
                  </div>
                ) : null}

                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <Button status="danger" onClick={() => removeRow(index)} disabled={disabled}>
                    删除
                  </Button>
                </div>
              </div>

              {row.kind === 'table' ? (
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                    数值列表（逗号分隔）
                  </Typography.Text>
                  <Input
                    value={row.values.join(', ')}
                    disabled={disabled}
                    onChange={(value) =>
                      updateRow(index, {
                        values: value
                          .split(',')
                          .map((entry) => entry.trim())
                          .filter(Boolean)
                          .map((entry) => Number(entry))
                          .filter((entry) => Number.isFinite(entry))
                      })
                    }
                    placeholder="例如：1, 10, 9, 8, 7"
                  />
                </div>
              ) : null}

              {row.kind === 'formula' ? (
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                    绑定键（bindingKey）
                  </Typography.Text>
                  <Input
                    value={row.bindingKey}
                    disabled={disabled}
                    onChange={(value) => updateRow(index, { bindingKey: value })}
                    placeholder="例如：cooldown.base / cost.mana / damage.main"
                  />
                </div>
              ) : null}
            </Space>
          </div>
        ))
      )}
    </Space>
  );
}
