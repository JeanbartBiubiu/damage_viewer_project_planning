import { Alert, Button, Empty, Input, InputNumber, Select, Space, Typography } from '@arco-design/web-react';
import { useEffect, useMemo, useState } from 'react';
import { AttributeKeySelector } from '../AttributeKeySelector';
import type { SkillActionRow, SkillModifierStatRow, SkillStackRow, SkillTriggerRow } from './skillModels';
import { createEmptyActionRow, createEmptyModifierStatRow, createEmptyStackRow, createEmptyTriggerRow, parseActionJson } from './skillModels';

type SkillMechanicsConfigEditorProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  version: number;
  stacks: SkillStackRow[];
  rows: SkillTriggerRow[];
  paramVarKeys: string[];
  disabled?: boolean;
  onVersionChange: (version: number) => void;
  onStacksChange: (rows: SkillStackRow[]) => void;
  onChange: (rows: SkillTriggerRow[]) => void;
};

const EVENT_OPTIONS = [
  { label: '施法时（on_spell_cast）', value: 'on_spell_cast' },
  { label: '普攻命中时（on_basic_attack_hit）', value: 'on_basic_attack_hit' },
  { label: '造成伤害时（on_damage_dealt）', value: 'on_damage_dealt' },
  { label: '受到伤害时（on_damage_taken）', value: 'on_damage_taken' },
  { label: 'Tick 触发时（on_tick）', value: 'on_tick' },
  { label: '层数变化时（on_stack_change）', value: 'on_stack_change' }
];

const ACTION_OPTIONS = [
  { label: '造成伤害（deal_damage）', value: 'deal_damage' },
  { label: '调度 Tick（schedule_tick）', value: 'schedule_tick' },
  { label: '应用修饰器（apply_modifier）', value: 'apply_modifier' },
  { label: '原始 JSON', value: '__raw__' }
];

const STACK_RESET_OPTIONS = [
  { label: '战斗结束（combat_end）', value: 'combat_end' },
  { label: '超时（timeout）', value: 'timeout' }
];

function RawActionFallbackEditor({
  action,
  disabled,
  onCommit
}: {
  action: SkillActionRow & { type: '__raw__' };
  disabled: boolean;
  onCommit: (nextAction: SkillActionRow) => void;
}) {
  const initialValue = useMemo(() => JSON.stringify(action.raw, null, 2), [action.raw]);
  const [draft, setDraft] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(initialValue);
    setError(null);
  }, [initialValue]);

  const commit = () => {
    try {
      onCommit(parseActionJson(draft));
      setError(null);
    } catch (commitError) {
      setError(commitError instanceof Error ? commitError.message : String(commitError));
    }
  };

  return (
    <div>
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
        未结构化支持的 action JSON
      </Typography.Text>
      <Input.TextArea
        value={draft}
        disabled={disabled}
        autoSize={{ minRows: 8, maxRows: 16 }}
        className="admin-json-input"
        onChange={setDraft}
        onBlur={commit}
      />
      {error ? <Alert type="error" content={`JSON 提交失败：${error}`} style={{ marginTop: 8 }} /> : null}
      <Button size="small" style={{ marginTop: 8 }} onClick={commit} disabled={disabled}>
        应用 JSON
      </Button>
    </div>
  );
}

export function SkillMechanicsConfigEditor({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  version,
  stacks,
  rows,
  paramVarKeys,
  disabled = false,
  onVersionChange,
  onStacksChange,
  onChange
}: SkillMechanicsConfigEditorProps) {
  const stackOptions = useMemo(
    () =>
      stacks
        .map((stack) => stack.id.trim())
        .filter(Boolean)
        .map((stackId) => ({ label: stackId, value: stackId })),
    [stacks]
  );

  const tickOptions = useMemo(() => {
    const keys = new Set<string>();
    rows.forEach((trigger) => {
      if (trigger.eventType === 'on_tick' && trigger.eventTickKey.trim()) {
        keys.add(trigger.eventTickKey.trim());
      }
      trigger.actions.forEach((action) => {
        if (action.type === 'schedule_tick' && action.tickKey.trim()) {
          keys.add(action.tickKey.trim());
        }
      });
    });
    return Array.from(keys).map((tickKey) => ({ label: tickKey, value: tickKey }));
  }, [rows]);

  const addStack = () => {
    onStacksChange([...stacks, createEmptyStackRow(stacks.map((item) => item.id))]);
  };

  const updateStack = (index: number, patch: Partial<SkillStackRow>) => {
    onStacksChange(stacks.map((row, currentIndex) => (currentIndex === index ? { ...row, ...patch } : row)));
  };

  const removeStack = (index: number) => {
    onStacksChange(stacks.filter((_, currentIndex) => currentIndex !== index));
  };

  const addTrigger = () => {
    onChange([...rows, createEmptyTriggerRow(rows.map((item) => item.id))]);
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
          actions: row.actions.map((action, currentActionIndex) =>
            currentActionIndex === actionIndex ? ({ ...action, ...patch } as SkillActionRow) : action
          )
        };
      })
    );
  };

  const replaceAction = (triggerIndex: number, actionIndex: number, nextAction: SkillActionRow) => {
    onChange(
      rows.map((row, currentIndex) => {
        if (currentIndex !== triggerIndex) {
          return row;
        }
        return {
          ...row,
          actions: row.actions.map((action, currentActionIndex) => (currentActionIndex === actionIndex ? nextAction : action))
        };
      })
    );
  };

  const updateActionType = (triggerIndex: number, actionIndex: number, type: string) => {
    onChange(
      rows.map((row, currentIndex) => {
        if (currentIndex !== triggerIndex) {
          return row;
        }
        return {
          ...row,
          actions: row.actions.map((action, currentActionIndex) => {
            if (currentActionIndex !== actionIndex) {
              return action;
            }
            const nextType = type === 'schedule_tick' || type === 'apply_modifier' || type === '__raw__' ? type : 'deal_damage';
            return {
              ...createEmptyActionRow(nextType),
              raw: action.raw
            };
          })
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

  const addModifierStat = (triggerIndex: number, actionIndex: number) => {
    onChange(
      rows.map((row, currentIndex) => {
        if (currentIndex !== triggerIndex) {
          return row;
        }
        return {
          ...row,
          actions: row.actions.map((action, currentActionIndex) => {
            if (currentActionIndex !== actionIndex || action.type !== 'apply_modifier') {
              return action;
            }
            return {
              ...action,
              stats: [...action.stats, createEmptyModifierStatRow()]
            };
          })
        };
      })
    );
  };

  const updateModifierStat = (triggerIndex: number, actionIndex: number, statIndex: number, patch: Partial<SkillModifierStatRow>) => {
    onChange(
      rows.map((row, currentIndex) => {
        if (currentIndex !== triggerIndex) {
          return row;
        }
        return {
          ...row,
          actions: row.actions.map((action, currentActionIndex) => {
            if (currentActionIndex !== actionIndex || action.type !== 'apply_modifier') {
              return action;
            }
            return {
              ...action,
              stats: action.stats.map((stat, currentStatIndex) => (currentStatIndex === statIndex ? { ...stat, ...patch } : stat))
            };
          })
        };
      })
    );
  };

  const removeModifierStat = (triggerIndex: number, actionIndex: number, statIndex: number) => {
    onChange(
      rows.map((row, currentIndex) => {
        if (currentIndex !== triggerIndex) {
          return row;
        }
        return {
          ...row,
          actions: row.actions.map((action, currentActionIndex) => {
            if (currentActionIndex !== actionIndex || action.type !== 'apply_modifier') {
              return action;
            }
            return {
              ...action,
              stats: action.stats.filter((_, currentStatIndex) => currentStatIndex !== statIndex)
            };
          })
        };
      })
    );
  };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Typography.Text bold>机制配置</Typography.Text>
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
            结构化支持 deal_damage / schedule_tick / apply_modifier；其它 action 走局部 JSON fallback。
          </Typography.Text>
        </div>
        <div style={{ minWidth: 160 }}>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
            版本
          </Typography.Text>
          <InputNumber style={{ width: '100%' }} value={version} min={1} disabled={disabled} onChange={(value) => onVersionChange(Number(value ?? 1))} />
        </div>
      </div>

      <div style={{ border: '1px solid var(--color-border-2)', borderRadius: 8, padding: 12 }}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <Typography.Text bold>叠层</Typography.Text>
              <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                供 `on_stack_change`、`add_stack/remove_stack` 等本地引用。
              </Typography.Text>
            </div>
            <Button size="small" type="primary" onClick={addStack} disabled={disabled}>
              添加 Stack
            </Button>
          </div>

          {stacks.length === 0 ? (
            <Empty description="暂无 stack 定义。" />
          ) : (
            stacks.map((stack, index) => (
              <div key={`${stack.id || 'stack'}-${index}`} style={{ border: '1px dashed var(--color-border-3)', borderRadius: 8, padding: 12 }}>
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  <div className="crud-form-grid">
                    <div>
                      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                        标识（id）
                      </Typography.Text>
                      <Input value={stack.id} disabled={disabled} onChange={(value) => updateStack(index, { id: value })} />
                    </div>
                    <div>
                      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                        名称
                      </Typography.Text>
                      <Input value={stack.name} disabled={disabled} onChange={(value) => updateStack(index, { name: value })} />
                    </div>
                  </div>

                  <div className="crud-form-grid">
                    <div>
                      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                        上限（max）
                      </Typography.Text>
                      <InputNumber style={{ width: '100%' }} value={stack.max} min={1} disabled={disabled} onChange={(value) => updateStack(index, { max: Number(value ?? 1) })} />
                    </div>
                    <div>
                      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                        超时毫秒（timeoutMs）
                      </Typography.Text>
                      <InputNumber style={{ width: '100%' }} value={stack.timeoutMs} min={0} disabled={disabled} onChange={(value) => updateStack(index, { timeoutMs: Number(value ?? 0) })} />
                    </div>
                  </div>

                  <div>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                      重置时机（resetOn）
                    </Typography.Text>
                    <Select
                      mode="multiple"
                      allowClear
                      value={stack.resetOn}
                      disabled={disabled}
                      options={STACK_RESET_OPTIONS}
                      onChange={(value) => updateStack(index, { resetOn: Array.isArray(value) ? value.map(String) : [] })}
                    />
                  </div>

                  <div>
                    <Button status="danger" onClick={() => removeStack(index)} disabled={disabled}>
                      删除 Stack
                    </Button>
                  </div>
                </Space>
              </div>
            ))
          )}
        </Space>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Typography.Text bold>触发器</Typography.Text>
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
            未结构化支持的 action 会保留 raw JSON，并可局部编辑。
          </Typography.Text>
        </div>
        <Button size="small" type="primary" onClick={addTrigger} disabled={disabled}>
          添加 Trigger
        </Button>
      </div>

      {rows.length === 0 ? (
        <Empty description="暂无 trigger。" />
      ) : (
        rows.map((row, triggerIndex) => (
          <div key={`${row.id || 'trigger'}-${triggerIndex}`} style={{ border: '1px solid var(--color-border-2)', borderRadius: 8, padding: 12 }}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <div className="crud-form-grid">
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                    触发器 ID
                  </Typography.Text>
                  <Input value={row.id} disabled={disabled} onChange={(value) => updateTrigger(triggerIndex, { id: value })} />
                </div>
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                    事件类型
                  </Typography.Text>
                  <Select value={row.eventType} disabled={disabled} options={EVENT_OPTIONS} onChange={(value) => updateTrigger(triggerIndex, { eventType: String(value ?? 'on_spell_cast') })} />
                </div>
              </div>

              {row.eventType === 'on_tick' ? (
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                    Tick 标识
                  </Typography.Text>
                  <Select
                    allowClear
                    showSearch
                    value={row.eventTickKey || undefined}
                    disabled={disabled}
                    options={tickOptions}
                    onChange={(value) => updateTrigger(triggerIndex, { eventTickKey: String(value ?? '') })}
                  />
                </div>
              ) : null}

              {row.eventType === 'on_stack_change' ? (
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                    叠层 ID
                  </Typography.Text>
                  <Select
                    allowClear
                    showSearch
                    value={row.eventStackId || undefined}
                    disabled={disabled}
                    options={stackOptions}
                    onChange={(value) => updateTrigger(triggerIndex, { eventStackId: String(value ?? '') })}
                  />
                </div>
              ) : null}

              <div>
                <Typography.Text bold>动作</Typography.Text>
              </div>

              {row.actions.length === 0 ? <Empty description="当前 trigger 暂无 action。" /> : null}

              {row.actions.map((action, actionIndex) => (
                <div key={`${action.rawType || action.type}-${actionIndex}`} style={{ border: '1px dashed var(--color-border-3)', borderRadius: 8, padding: 12 }}>
                  <Space direction="vertical" size={10} style={{ width: '100%' }}>
                    <div className="crud-form-grid">
                      <div>
                        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                          动作类型
                        </Typography.Text>
                        <Select
                          value={action.type}
                          disabled={disabled}
                          options={ACTION_OPTIONS}
                          onChange={(value) => updateActionType(triggerIndex, actionIndex, String(value ?? 'deal_damage'))}
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
                              来源
                            </Typography.Text>
                            <Select
                              value={action.damageSource}
                              disabled={disabled}
                              options={[
                                { label: '自身（self）', value: 'self' },
                                { label: '拥有者（owner）', value: 'owner' }
                              ]}
                              onChange={(value) => updateAction(triggerIndex, actionIndex, { damageSource: String(value ?? 'self') })}
                            />
                          </div>
                          <div>
                            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                              目标
                            </Typography.Text>
                            <Select
                              value={action.damageTarget}
                              disabled={disabled}
                              options={[{ label: '敌方（enemy）', value: 'enemy' }]}
                              onChange={(value) => updateAction(triggerIndex, actionIndex, { damageTarget: String(value ?? 'enemy') })}
                            />
                          </div>
                          <div>
                            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                              伤害类型
                            </Typography.Text>
                            <Select
                              value={action.damageType}
                              disabled={disabled}
                              options={[
                                { label: '物理（physical）', value: 'physical' },
                                { label: '魔法（magic）', value: 'magic' },
                                { label: '真实（true）', value: 'true' }
                              ]}
                              onChange={(value) => updateAction(triggerIndex, actionIndex, { damageType: String(value ?? 'magic') })}
                            />
                          </div>
                        </div>

                        <div>
                          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                            公式文本
                          </Typography.Text>
                          <Input value={action.formulaText} disabled={disabled} onChange={(value) => updateAction(triggerIndex, actionIndex, { formulaText: value })} />
                        </div>

                        <div>
                          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                            依赖变量
                          </Typography.Text>
                          <Select
                            mode="multiple"
                            showSearch
                            allowClear
                            value={action.formulaVars}
                            disabled={disabled}
                            options={paramVarKeys.map((key) => ({ label: key, value: key }))}
                            onChange={(value) => updateAction(triggerIndex, actionIndex, { formulaVars: Array.isArray(value) ? value.map(String) : [] })}
                          />
                        </div>
                      </>
                    ) : null}

                    {action.type === 'schedule_tick' ? (
                      <div className="crud-form-grid">
                        <div>
                          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                            Tick 标识
                          </Typography.Text>
                          <Input value={action.tickKey} disabled={disabled} onChange={(value) => updateAction(triggerIndex, actionIndex, { tickKey: value })} />
                        </div>
                        <div>
                          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                            间隔毫秒（everyMs）
                          </Typography.Text>
                          <InputNumber style={{ width: '100%' }} value={action.everyMs} disabled={disabled} onChange={(value) => updateAction(triggerIndex, actionIndex, { everyMs: Number(value ?? 0) })} />
                        </div>
                        <div>
                          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                            次数（times）
                          </Typography.Text>
                          <InputNumber style={{ width: '100%' }} value={action.times} disabled={disabled} onChange={(value) => updateAction(triggerIndex, actionIndex, { times: Number(value ?? 1) })} />
                        </div>
                      </div>
                    ) : null}

                    {action.type === 'apply_modifier' ? (
                      <>
                        <div className="crud-form-grid">
                          <div>
                            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                              目标
                            </Typography.Text>
                            <Select
                              value={action.modifierTarget}
                              disabled={disabled}
                              options={[
                                { label: '自身（self）', value: 'self' },
                                { label: '敌方（enemy）', value: 'enemy' }
                              ]}
                              onChange={(value) => updateAction(triggerIndex, actionIndex, { modifierTarget: String(value ?? 'self') })}
                            />
                          </div>
                          <div>
                            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                              持续毫秒（durationMs）
                            </Typography.Text>
                            <InputNumber style={{ width: '100%' }} value={action.durationMs} disabled={disabled} onChange={(value) => updateAction(triggerIndex, actionIndex, { durationMs: Number(value ?? 0) })} />
                          </div>
                          <div>
                            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                              叠加模式（stacking.mode）
                            </Typography.Text>
                            <Select
                              value={action.stackingMode}
                              disabled={disabled}
                              options={[
                                { label: '刷新（refresh）', value: 'refresh' },
                                { label: '叠加（stack）', value: 'stack' }
                              ]}
                              onChange={(value) => updateAction(triggerIndex, actionIndex, { stackingMode: String(value ?? 'refresh') })}
                            />
                          </div>
                        </div>

                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <Typography.Text bold>属性修改（modifier.stats）</Typography.Text>
                            <Button size="small" type="primary" onClick={() => addModifierStat(triggerIndex, actionIndex)} disabled={disabled}>
                              添加 stat
                            </Button>
                          </div>

                          {action.stats.length === 0 ? (
                            <Empty description="暂无 stat 修改。" />
                          ) : (
                            action.stats.map((stat, statIndex) => (
                              <div key={`${stat.key || 'stat'}-${statIndex}`} style={{ border: '1px solid var(--color-border-3)', borderRadius: 8, padding: 12, marginBottom: 8 }}>
                                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                                  <div className="crud-form-grid">
                                    <div>
                                      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                                        属性 key
                                      </Typography.Text>
                                      <AttributeKeySelector
                                        apiBaseUrl={apiBaseUrl}
                                        gameId={selectedGameId}
                                        token={adminToken}
                                        value={stat.key}
                                        disabled={disabled}
                                        placeholder="选择属性 key"
                                        onChange={(value) => updateModifierStat(triggerIndex, actionIndex, statIndex, { key: typeof value === 'string' ? value : '' })}
                                      />
                                    </div>
                                    <div>
                                      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                                        运算
                                      </Typography.Text>
                                      <Select
                                        value={stat.op}
                                        disabled={disabled}
                                        options={[
                                          { label: '加法（add）', value: 'add' },
                                          { label: '乘法（mul）', value: 'mul' }
                                        ]}
                                        onChange={(value) => updateModifierStat(triggerIndex, actionIndex, statIndex, { op: String(value ?? 'add') })}
                                      />
                                    </div>
                                  </div>

                                  <div>
                                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                                      公式文本
                                    </Typography.Text>
                                    <Input value={stat.formulaText} disabled={disabled} onChange={(value) => updateModifierStat(triggerIndex, actionIndex, statIndex, { formulaText: value })} />
                                  </div>

                                  <div>
                                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                                      依赖变量
                                    </Typography.Text>
                                    <Select
                                      mode="multiple"
                                      showSearch
                                      allowClear
                                      value={stat.formulaVars}
                                      disabled={disabled}
                                      options={paramVarKeys.map((key) => ({ label: key, value: key }))}
                                      onChange={(value) => updateModifierStat(triggerIndex, actionIndex, statIndex, { formulaVars: Array.isArray(value) ? value.map(String) : [] })}
                                    />
                                  </div>

                                  <div>
                                    <Button status="danger" onClick={() => removeModifierStat(triggerIndex, actionIndex, statIndex)} disabled={disabled}>
                                      删除 stat
                                    </Button>
                                  </div>
                                </Space>
                              </div>
                            ))
                          )}
                        </div>
                      </>
                    ) : null}

                    {action.type === '__raw__' ? <RawActionFallbackEditor action={action} disabled={disabled} onCommit={(nextAction) => replaceAction(triggerIndex, actionIndex, nextAction)} /> : null}
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
