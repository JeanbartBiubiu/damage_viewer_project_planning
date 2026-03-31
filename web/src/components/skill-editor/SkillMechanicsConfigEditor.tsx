import { Button, Empty, Input, InputNumber, Select, Space, Typography } from '@arco-design/web-react';
import type { SkillActionRow, SkillTriggerRow } from './skillModels';
import { createEmptyActionRow, createEmptyTriggerRow } from './skillModels';

type SkillMechanicsConfigEditorProps = {
  version: number;
  rows: SkillTriggerRow[];
  disabled?: boolean;
  onVersionChange: (version: number) => void;
  onChange: (rows: SkillTriggerRow[]) => void;
};

export function SkillMechanicsConfigEditor({ version, rows, disabled = false, onVersionChange, onChange }: SkillMechanicsConfigEditorProps) {
  const addTrigger = () => {
    onChange([...rows, createEmptyTriggerRow()]);
  };

  const updateTrigger = (index: number, patch: Partial<SkillTriggerRow>) => {
    onChange(rows.map((row, currentIndex) => (currentIndex === index ? { ...row, ...patch } : row)));
  };

  const removeTrigger = (index: number) => {
    onChange(rows.filter((_, currentIndex) => currentIndex !== index));
  };

  const addAction = (triggerIndex: number) => {
    onChange(
      rows.map((row, currentIndex) =>
        currentIndex === triggerIndex ? { ...row, actions: [...row.actions, createEmptyActionRow()] } : row
      )
    );
  };

  const updateAction = (triggerIndex: number, actionIndex: number, patch: Partial<SkillActionRow>) => {
    onChange(
      rows.map((row, currentIndex) => {
        if (currentIndex !== triggerIndex) {
          return row;
        }
        return {
          ...row,
          actions: row.actions.map((action, currentActionIndex) => (currentActionIndex === actionIndex ? { ...action, ...patch } : action))
        };
      })
    );
  };

  const removeAction = (triggerIndex: number, actionIndex: number) => {
    onChange(
      rows.map((row, currentIndex) => {
        if (currentIndex !== triggerIndex) {
          return row;
        }
        return {
          ...row,
          actions: row.actions.filter((_, currentActionIndex) => currentActionIndex !== actionIndex)
        };
      })
    );
  };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Typography.Text bold>Mechanics Config（DSL 最小子集）</Typography.Text>
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
            第一版只支持 `on_spell_cast / on_tick` 与 `deal_damage / schedule_tick`。
          </Typography.Text>
        </div>
        <Button size="small" type="primary" onClick={addTrigger} disabled={disabled}>
          添加 Trigger
        </Button>
      </div>

      <div style={{ maxWidth: 180 }}>
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
          version
        </Typography.Text>
        <InputNumber style={{ width: '100%' }} value={version} min={1} disabled={disabled} onChange={(value) => onVersionChange(Number(value ?? 1))} />
      </div>

      {rows.length === 0 ? (
        <Empty description="暂无 trigger，保存时仍会回写合法的 version/triggers 骨架。" />
      ) : (
        rows.map((row, triggerIndex) => (
          <div key={`${row.id || 'trigger'}-${triggerIndex}`} style={{ border: '1px solid var(--color-border-2)', borderRadius: 8, padding: 12 }}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <div className="crud-form-grid">
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                    trigger id
                  </Typography.Text>
                  <Input value={row.id} disabled={disabled} onChange={(value) => updateTrigger(triggerIndex, { id: value })} placeholder="例如 cast_damage" />
                </div>
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                    event.type
                  </Typography.Text>
                  <Select
                    value={row.eventType}
                    disabled={disabled}
                    options={[
                      { label: 'on_spell_cast', value: 'on_spell_cast' },
                      { label: 'on_tick', value: 'on_tick' },
                      { label: 'on_basic_attack_hit', value: 'on_basic_attack_hit' }
                    ]}
                    onChange={(value) => updateTrigger(triggerIndex, { eventType: String(value ?? 'on_spell_cast') })}
                  />
                </div>
              </div>

              {row.eventType === 'on_tick' ? (
                <div style={{ maxWidth: 240 }}>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                    event.tickKey
                  </Typography.Text>
                  <Input value={row.eventTickKey} disabled={disabled} onChange={(value) => updateTrigger(triggerIndex, { eventTickKey: value })} placeholder="例如 katarina_r_hit" />
                </div>
              ) : null}

              <div>
                <Typography.Text bold>Actions</Typography.Text>
              </div>

              {row.actions.length === 0 ? <Empty description="当前 trigger 暂无 action。" /> : null}

              {row.actions.map((action, actionIndex) => (
                <div key={`${action.type}-${actionIndex}`} style={{ border: '1px dashed var(--color-border-3)', borderRadius: 8, padding: 12 }}>
                  <Space direction="vertical" size={10} style={{ width: '100%' }}>
                    <div className="crud-form-grid">
                      <div>
                        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                          action.type
                        </Typography.Text>
                        <Select
                          value={action.type}
                          disabled={disabled}
                          options={[
                            { label: 'deal_damage', value: 'deal_damage' },
                            { label: 'schedule_tick', value: 'schedule_tick' }
                          ]}
                          onChange={(value) => updateAction(triggerIndex, actionIndex, { type: String(value ?? 'deal_damage') })}
                        />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                        <Button status="danger" onClick={() => removeAction(triggerIndex, actionIndex)} disabled={disabled}>
                          删除 Action
                        </Button>
                      </div>
                    </div>

                    {action.type === 'deal_damage' ? (
                      <>
                        <div className="crud-form-grid">
                          <div>
                            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                              damageType
                            </Typography.Text>
                            <Select
                              value={action.damageType}
                              disabled={disabled}
                              options={[
                                { label: 'physical', value: 'physical' },
                                { label: 'magic', value: 'magic' },
                                { label: 'true', value: 'true' }
                              ]}
                              onChange={(value) => updateAction(triggerIndex, actionIndex, { damageType: String(value ?? 'magic') })}
                            />
                          </div>
                          <div>
                            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                              formulaVars（逗号分隔）
                            </Typography.Text>
                            <Input
                              value={action.formulaVarsText}
                              disabled={disabled}
                              onChange={(value) => updateAction(triggerIndex, actionIndex, { formulaVarsText: value })}
                              placeholder="例如 base_damage, ap_damage"
                            />
                          </div>
                        </div>
                        <div>
                          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                            formulaText
                          </Typography.Text>
                          <Input
                            value={action.formulaText}
                            disabled={disabled}
                            onChange={(value) => updateAction(triggerIndex, actionIndex, { formulaText: value })}
                            placeholder="例如 base_damage + ap_damage"
                          />
                        </div>
                      </>
                    ) : (
                      <div className="crud-form-grid">
                        <div>
                          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                            tickKey
                          </Typography.Text>
                          <Input value={action.tickKey} disabled={disabled} onChange={(value) => updateAction(triggerIndex, actionIndex, { tickKey: value })} />
                        </div>
                        <div>
                          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                            everyMs
                          </Typography.Text>
                          <InputNumber style={{ width: '100%' }} value={action.everyMs} disabled={disabled} onChange={(value) => updateAction(triggerIndex, actionIndex, { everyMs: Number(value ?? 0) })} />
                        </div>
                        <div>
                          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                            times
                          </Typography.Text>
                          <InputNumber style={{ width: '100%' }} value={action.times} disabled={disabled} onChange={(value) => updateAction(triggerIndex, actionIndex, { times: Number(value ?? 1) })} />
                        </div>
                      </div>
                    )}
                  </Space>
                </div>
              ))}

              <Space>
                <Button size="small" type="primary" onClick={() => addAction(triggerIndex)} disabled={disabled}>
                  添加 Action
                </Button>
                <Button status="danger" onClick={() => removeTrigger(triggerIndex)} disabled={disabled}>
                  删除 Trigger
                </Button>
              </Space>
            </Space>
          </div>
        ))
      )}
    </Space>
  );
}