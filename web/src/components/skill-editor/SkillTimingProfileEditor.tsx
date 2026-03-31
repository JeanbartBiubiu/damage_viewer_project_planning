import { Button, Empty, Input, InputNumber, Select, Space, Switch, Typography } from '@arco-design/web-react';
import type { SkillTimingPhaseRow } from './skillModels';
import { createEmptyTimingPhaseRow } from './skillModels';

type SkillTimingProfileEditorProps = {
  rows: SkillTimingPhaseRow[];
  disabled?: boolean;
  onChange: (rows: SkillTimingPhaseRow[]) => void;
};

export function SkillTimingProfileEditor({ rows, disabled = false, onChange }: SkillTimingProfileEditorProps) {
  const addRow = () => {
    onChange([...rows, createEmptyTimingPhaseRow()]);
  };

  const updateRow = (index: number, patch: Partial<SkillTimingPhaseRow>) => {
    onChange(rows.map((row, currentIndex) => (currentIndex === index ? { ...row, ...patch } : row)));
  };

  const removeRow = (index: number) => {
    onChange(rows.filter((_, currentIndex) => currentIndex !== index));
  };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Typography.Text bold>Timing Profile</Typography.Text>
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
            第一版只结构化 `phases[]`，覆盖 cast / channel / recovery 的常用字段。
          </Typography.Text>
        </div>
        <Button size="small" type="primary" onClick={addRow} disabled={disabled}>
          添加阶段
        </Button>
      </div>

      {rows.length === 0 ? (
        <Empty description="暂无阶段配置，可直接添加 cast/channel/recovery。" />
      ) : (
        rows.map((row, index) => (
          <div key={`${row.phaseKey || 'phase'}-${index}`} style={{ border: '1px solid var(--color-border-2)', borderRadius: 8, padding: 12 }}>
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <div className="crud-form-grid">
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                    phaseKey
                  </Typography.Text>
                  <Input value={row.phaseKey} disabled={disabled} onChange={(value) => updateRow(index, { phaseKey: value })} placeholder="例如 cast" />
                </div>
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                    kind
                  </Typography.Text>
                  <Select
                    value={row.kind}
                    disabled={disabled}
                    options={[
                      { label: 'cast', value: 'cast' },
                      { label: 'channel', value: 'channel' },
                      { label: 'recovery', value: 'recovery' }
                    ]}
                    onChange={(value) => updateRow(index, { kind: String(value ?? 'cast') })}
                  />
                </div>
              </div>

              <div className="crud-form-grid">
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                    durationMs
                  </Typography.Text>
                  <InputNumber style={{ width: '100%' }} value={row.durationMs} disabled={disabled} onChange={(value) => updateRow(index, { durationMs: Number(value ?? 0) })} />
                </div>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', paddingTop: 28 }}>
                  <Space>
                    <Typography.Text type="secondary">interruptible</Typography.Text>
                    <Switch checked={row.interruptible} disabled={disabled} onChange={(checked) => updateRow(index, { interruptible: checked })} />
                  </Space>
                  <Space>
                    <Typography.Text type="secondary">cancelScheduledOnInterrupt</Typography.Text>
                    <Switch
                      checked={row.cancelScheduledOnInterrupt}
                      disabled={disabled}
                      onChange={(checked) => updateRow(index, { cancelScheduledOnInterrupt: checked })}
                    />
                  </Space>
                </div>
              </div>

              <div>
                <Button status="danger" onClick={() => removeRow(index)} disabled={disabled}>
                  删除阶段
                </Button>
              </div>
            </Space>
          </div>
        ))
      )}
    </Space>
  );
}