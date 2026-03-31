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
          <Typography.Text bold>时序阶段</Typography.Text>
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
            结构化编辑 `timingProfile.phases[]`，其余 timing 字段继续 passthrough 保留。
          </Typography.Text>
        </div>
        <Button size="small" type="primary" onClick={addRow} disabled={disabled}>
          添加阶段
        </Button>
      </div>

      {rows.length === 0 ? (
        <Empty description="暂无阶段配置，可直接添加施法、引导、后摇或持续效果阶段。" />
      ) : (
        rows.map((row, index) => (
          <div key={`${row.phaseKey || 'phase'}-${index}`} style={{ border: '1px solid var(--color-border-2)', borderRadius: 8, padding: 12 }}>
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <div className="crud-form-grid">
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                    阶段键（phaseKey）
                  </Typography.Text>
                  <Input value={row.phaseKey} disabled={disabled} onChange={(value) => updateRow(index, { phaseKey: value })} placeholder="例如 cast" />
                </div>
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                    阶段类型（kind）
                  </Typography.Text>
                  <Select
                    value={row.kind}
                    disabled={disabled}
                    options={[
                      { label: '施法', value: 'cast' },
                      { label: '引导', value: 'channel' },
                      { label: '后摇', value: 'recovery' },
                      { label: '持续效果', value: 'persistent_effect' }
                    ]}
                    onChange={(value) => updateRow(index, { kind: String(value ?? 'cast') })}
                  />
                </div>
              </div>

              <div className="crud-form-grid">
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                    时长（durationMs）
                  </Typography.Text>
                  <InputNumber
                    style={{ width: '100%' }}
                    value={row.durationMs}
                    disabled={disabled}
                    onChange={(value) => updateRow(index, { durationMs: value == null ? undefined : Number(value) })}
                  />
                </div>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', paddingTop: 28, flexWrap: 'wrap' }}>
                  <Space>
                    <Typography.Text type="secondary">可打断</Typography.Text>
                    <Switch checked={row.interruptible} disabled={disabled} onChange={(checked) => updateRow(index, { interruptible: checked })} />
                  </Space>
                  <Space>
                    <Typography.Text type="secondary">打断时取消已调度效果</Typography.Text>
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
