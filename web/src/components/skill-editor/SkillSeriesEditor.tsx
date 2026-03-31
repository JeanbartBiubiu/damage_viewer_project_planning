import { Button, Empty, Input, InputNumber, Select, Space, Typography } from '@arco-design/web-react';
import type { SkillSeriesRow } from './skillModels';
import { createEmptySeriesRow } from './skillModels';

type SkillSeriesEditorProps = {
  title: string;
  description: string;
  rows: SkillSeriesRow[];
  disabled?: boolean;
  onChange: (rows: SkillSeriesRow[]) => void;
};

export function SkillSeriesEditor({ title, description, rows, disabled = false, onChange }: SkillSeriesEditorProps) {
  const addRow = () => {
    onChange([...rows, createEmptySeriesRow()]);
  };

  const updateRow = (index: number, patch: Partial<SkillSeriesRow>) => {
    onChange(rows.map((row, currentIndex) => (currentIndex === index ? { ...row, ...patch } : row)));
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
              <Space wrap align="start" style={{ width: '100%' }}>
                <div style={{ minWidth: 160 }}>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                    kind
                  </Typography.Text>
                  <Select
                    style={{ width: 160 }}
                    value={row.kind}
                    disabled={disabled}
                    options={[
                      { label: 'const', value: 'const' },
                      { label: 'table', value: 'table' }
                    ]}
                    onChange={(value) => updateRow(index, { kind: value === 'table' ? 'table' : 'const' })}
                  />
                </div>

                {row.kind === 'table' ? (
                  <div style={{ minWidth: 180 }}>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                      by
                    </Typography.Text>
                    <Input value={row.by} disabled={disabled} onChange={(value) => updateRow(index, { by: value })} placeholder="skillLevel" />
                  </div>
                ) : (
                  <div style={{ minWidth: 180 }}>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                      value
                    </Typography.Text>
                    <InputNumber style={{ width: 180 }} value={row.value} disabled={disabled} onChange={(value) => updateRow(index, { value: Number(value ?? 0) })} />
                  </div>
                )}

                <Button status="danger" onClick={() => removeRow(index)} disabled={disabled}>
                  删除
                </Button>
              </Space>

              {row.kind === 'table' ? (
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                    values（逗号分隔）
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
                    placeholder="例如：11, 10, 9, 8, 7"
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