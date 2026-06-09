import { Alert, Button, Empty, Input, InputNumber, Select, Space, Tag, Typography } from '@arco-design/web-react';
import { useEffect, useMemo, useState } from 'react';
import { appendCurrentDamageTypeOption, type DamageTypeOption } from '../../pages/admin/resources/shared/damageTypes';
import { getCoefficientBuckets } from '../../services/apiClient';
import type { CoefficientBucket, JsonObject, JsonValue } from '../../types/api';
import { AttributeKeySelector } from '../AttributeKeySelector';
import type { SkillActionRow, SkillDpsPassiveSummaryRow, SkillModifierStatRow, SkillStackRow, SkillTriggerRow } from './skillModels';
import {
  createEmptyActionRow,
  createEmptyModifierStatRow,
  createEmptyStackRow,
  createEmptyTriggerRow,
  parseActionJson,
  summarizeDpsPassiveEffects,
  validateDpsPassiveEffects
} from './skillModels';

type SkillMechanicsConfigEditorProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  damageTypeOptions: DamageTypeOption[];
  root: JsonObject;
  version: number;
  stacks: SkillStackRow[];
  rows: SkillTriggerRow[];
  disabled?: boolean;
  onVersionChange: (version: number) => void;
  onStacksChange: (rows: SkillStackRow[]) => void;
  onChange: (rows: SkillTriggerRow[]) => void;
  onDpsPassiveEffectsChange?: (passives: JsonObject[]) => void;
};

const DPS_PASSIVE_OWNER_GROUP_ORDER = ['attacker', 'target', 'other'] as const;

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

function groupDpsPassiveRowsByOwnerRole(rows: SkillDpsPassiveSummaryRow[]): Map<string, SkillDpsPassiveSummaryRow[]> {
  const groups = new Map<string, SkillDpsPassiveSummaryRow[]>();
  rows.forEach((row) => {
    const normalizedOwnerRole = row.ownerRole.replace('(default)', '').trim() || 'attacker';
    const groupKey =
      normalizedOwnerRole === 'attacker' || normalizedOwnerRole === 'target' ? normalizedOwnerRole : 'other';
    const bucket = groups.get(groupKey) ?? [];
    bucket.push(row);
    groups.set(groupKey, bucket);
  });
  return groups;
}

function formatDpsPassiveOwnerGroupLabel(groupKey: string): string {
  if (groupKey === 'attacker') {
    return 'attacker';
  }
  if (groupKey === 'target') {
    return 'target';
  }
  return 'other';
}

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatCoefficientBucketLabel(bucket: CoefficientBucket): string {
  const tail = bucket.targetAttrKey?.trim() || bucket.aggregationMode?.trim() || '';
  return [bucket.bucketKey, bucket.resolutionDomain, bucket.stageKey, tail].filter(Boolean).join(' · ');
}

function cloneDpsPassiveEffects(passives: JsonObject[]): JsonObject[] {
  return passives.map((passive) => (isPlainObject(passive) ? { ...passive } : passive));
}

function updateDpsPassiveOperationField(
  passives: JsonObject[],
  passiveIndex: number,
  operationIndex: number,
  apply: (operation: JsonObject) => JsonObject
): JsonObject[] {
  return passives.map((passive, currentPassiveIndex) => {
    if (currentPassiveIndex !== passiveIndex || !isPlainObject(passive)) {
      return passive;
    }

    const operations = Array.isArray(passive.operations) ? passive.operations : [];
    return {
      ...passive,
      operations: operations.map((operation, currentOperationIndex) => {
        if (currentOperationIndex !== operationIndex || !isPlainObject(operation)) {
          return operation;
        }
        return apply({ ...operation });
      })
    };
  });
}

function setOptionalStringField(target: JsonObject, key: string, value: string) {
  const trimmed = value.trim();
  if (trimmed) {
    target[key] = trimmed;
    return;
  }
  delete target[key];
}

function setOptionalNumberField(target: JsonObject, key: string, value: number | undefined) {
  if (value !== undefined && Number.isFinite(value)) {
    target[key] = value;
    return;
  }
  delete target[key];
}

function setOptionalJsonField(target: JsonObject, key: string, value: JsonValue | undefined) {
  if (value === undefined) {
    delete target[key];
    return;
  }
  target[key] = value;
}

function OptionalJsonFieldEditor({
  label,
  value,
  expectedKind,
  disabled,
  onCommit
}: {
  label: string;
  value: unknown;
  expectedKind: 'object' | 'array';
  disabled: boolean;
  onCommit: (nextValue: unknown) => void;
}) {
  const initialValue = value === undefined ? '' : JSON.stringify(value, null, 2);
  const [draft, setDraft] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(initialValue);
    setError(null);
  }, [initialValue]);

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      onCommit(undefined);
      setError(null);
      return;
    }

    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (expectedKind === 'object') {
        if (!isPlainObject(parsed)) {
          setError('必须是 JSON 对象。');
          return;
        }
      } else if (!Array.isArray(parsed)) {
        setError('必须是 JSON 数组。');
        return;
      }
      onCommit(parsed);
      setError(null);
    } catch (commitError) {
      setError(commitError instanceof Error ? commitError.message : String(commitError));
    }
  };

  return (
    <div>
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
        {label}
      </Typography.Text>
      <Input.TextArea
        value={draft}
        disabled={disabled}
        autoSize={{ minRows: 4, maxRows: 10 }}
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
  damageTypeOptions,
  root,
  version,
  stacks,
  rows,
  disabled = false,
  onVersionChange,
  onStacksChange,
  onChange,
  onDpsPassiveEffectsChange
}: SkillMechanicsConfigEditorProps) {
  const defaultDamageTypeValue = damageTypeOptions[0]?.value ?? 'magic';
  const [coefficientBuckets, setCoefficientBuckets] = useState<CoefficientBucket[]>([]);
  const dpsPassiveEffects = useMemo((): JsonObject[] | null => {
    if (!Array.isArray(root.dpsPassiveEffects)) {
      return null;
    }
    return root.dpsPassiveEffects as JsonObject[];
  }, [root.dpsPassiveEffects]);
  const dpsPassiveSummaryRows = useMemo(() => summarizeDpsPassiveEffects(root), [root]);
  const dpsPassiveIssues = useMemo(() => validateDpsPassiveEffects(root), [root]);
  const dpsPassiveErrors = useMemo(() => dpsPassiveIssues.filter((issue) => issue.severity === 'error'), [dpsPassiveIssues]);
  const dpsPassiveWarnings = useMemo(() => dpsPassiveIssues.filter((issue) => issue.severity === 'warning'), [dpsPassiveIssues]);
  const dpsPassiveGroups = useMemo(() => groupDpsPassiveRowsByOwnerRole(dpsPassiveSummaryRows), [dpsPassiveSummaryRows]);
  const stackOptions = useMemo(
    () =>
      stacks
        .map((stack) => stack.id.trim())
        .filter(Boolean)
        .map((stackId) => ({ label: stackId, value: stackId })),
    [stacks]
  );

  useEffect(() => {
    if (!apiBaseUrl || !selectedGameId) {
      setCoefficientBuckets([]);
      return;
    }

    let cancelled = false;
    void getCoefficientBuckets(apiBaseUrl, selectedGameId, adminToken)
      .then((result) => {
        if (!cancelled) {
          setCoefficientBuckets(result.data.coefficientBuckets ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCoefficientBuckets([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, selectedGameId, adminToken]);

  const coefficientBucketOptions = useMemo(
    () =>
      coefficientBuckets.map((bucket) => ({
        label: formatCoefficientBucketLabel(bucket),
        value: bucket.bucketKey
      })),
    [coefficientBuckets]
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
    const nextTrigger = createEmptyTriggerRow(rows.map((item) => item.id));
    if (nextTrigger.actions[0]?.type === 'deal_damage') {
      nextTrigger.actions[0].damageType = defaultDamageTypeValue;
    }
    onChange([...rows, nextTrigger]);
  };

  const updateTrigger = (index: number, patch: Partial<SkillTriggerRow>) => {
    onChange(rows.map((row, currentIndex) => (currentIndex === index ? { ...row, ...patch } : row)));
  };

  const removeTrigger = (index: number) => {
    onChange(rows.filter((_, currentIndex) => currentIndex !== index));
  };

  const addAction = (triggerIndex: number) => {
    const nextAction = createEmptyActionRow();
    if (nextAction.type === 'deal_damage') {
      nextAction.damageType = defaultDamageTypeValue;
    }
    onChange(
      rows.map((row, currentIndex) =>
        currentIndex === triggerIndex ? { ...row, actions: [...row.actions, nextAction] } : row
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
            const nextAction = {
              ...createEmptyActionRow(nextType),
              raw: action.raw
            };
            if (nextAction.type === 'deal_damage') {
              nextAction.damageType = defaultDamageTypeValue;
            }
            return nextAction;
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

  const commitDpsPassiveEffects = (nextPassives: JsonObject[]) => {
    onDpsPassiveEffectsChange?.(cloneDpsPassiveEffects(nextPassives));
  };

  const updateDpsPassiveOperation = (
    passiveIndex: number,
    operationIndex: number,
    apply: (operation: JsonObject) => JsonObject
  ) => {
    if (!dpsPassiveEffects) {
      return;
    }
    commitDpsPassiveEffects(updateDpsPassiveOperationField(dpsPassiveEffects, passiveIndex, operationIndex, apply));
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
                              options={appendCurrentDamageTypeOption(
                                damageTypeOptions,
                                action.damageType,
                                action.damageType ? `${action.damageType} (legacy)` : undefined
                              )}
                              onChange={(value) =>
                                updateAction(triggerIndex, actionIndex, { damageType: String(value ?? defaultDamageTypeValue) })
                              }
                            />
                          </div>
                        </div>

                        <div>
                          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                            绑定键
                          </Typography.Text>
                          <Input
                            value={action.bindingKey}
                            disabled={disabled}
                            onChange={(value) => updateAction(triggerIndex, actionIndex, { bindingKey: value })}
                            placeholder="例如：damage.main"
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
                                      绑定键
                                    </Typography.Text>
                                    <Input
                                      value={stat.bindingKey}
                                      disabled={disabled}
                                      onChange={(value) => updateModifierStat(triggerIndex, actionIndex, statIndex, { bindingKey: value })}
                                      placeholder="例如：modifier.attack_speed"
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

      <div style={{ border: '1px solid var(--color-border-2)', borderRadius: 8, padding: 12 }}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <Typography.Text bold>DPS Passive</Typography.Text>
            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
              展示 mechanicsConfig.dpsPassiveEffects；operations 支持维护 Batch R 乘区字段。
            </Typography.Text>
          </div>

          {dpsPassiveErrors.length > 0 ? (
            <Alert
              type="error"
              content={
                <div>
                  {dpsPassiveErrors.map((issue) => (
                    <div key={`${issue.path}:${issue.message}`}>
                      {issue.path}: {issue.message}
                    </div>
                  ))}
                </div>
              }
            />
          ) : null}

          {dpsPassiveWarnings.length > 0 ? (
            <Alert
              type="warning"
              content={
                <div>
                  {dpsPassiveWarnings.map((issue) => (
                    <div key={`${issue.path}:${issue.message}`}>
                      {issue.path}: {issue.message}
                    </div>
                  ))}
                </div>
              }
            />
          ) : null}

          {dpsPassiveEffects === null && 'dpsPassiveEffects' in root ? (
            <Alert type="error" content="dpsPassiveEffects 不是数组，无法结构化编辑；请修正 JSON 或使用下方 mechanicsConfig JSON。" />
          ) : null}

          {dpsPassiveSummaryRows.length === 0 ? (
            <Empty description="未配置 dpsPassiveEffects；旧技能可不填。" />
          ) : (
            DPS_PASSIVE_OWNER_GROUP_ORDER.filter((groupKey) => (dpsPassiveGroups.get(groupKey) ?? []).length > 0).map((groupKey) => (
              <div key={groupKey}>
                <Typography.Text bold style={{ display: 'block', marginBottom: 8 }}>
                  {formatDpsPassiveOwnerGroupLabel(groupKey)}（{(dpsPassiveGroups.get(groupKey) ?? []).length}）
                </Typography.Text>
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  {(dpsPassiveGroups.get(groupKey) ?? []).map((summaryRow) => (
                    <div
                      key={`${summaryRow.passiveId}-${summaryRow.index}`}
                      style={{ border: '1px dashed var(--color-border-3)', borderRadius: 8, padding: 12 }}
                    >
                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        <div className="crud-form-grid">
                          <div>
                            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                              passiveId
                            </Typography.Text>
                            <Typography.Text>{summaryRow.passiveId}</Typography.Text>
                          </div>
                          <div>
                            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                              source
                            </Typography.Text>
                            <Typography.Text>{summaryRow.source}</Typography.Text>
                          </div>
                          <div>
                            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                              ownerRole
                            </Typography.Text>
                            <Typography.Text>{summaryRow.ownerRole}</Typography.Text>
                          </div>
                          <div>
                            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                              trigger.event
                            </Typography.Text>
                            <Typography.Text>{summaryRow.triggerEvent || '(missing)'}</Typography.Text>
                          </div>
                        </div>

                        {summaryRow.matcherSummary ? (
                          <div>
                            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                              matcher
                            </Typography.Text>
                            <Typography.Text>{summaryRow.matcherSummary}</Typography.Text>
                          </div>
                        ) : null}

                        <div className="crud-form-grid">
                          <div>
                            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                              operation kinds
                            </Typography.Text>
                            <Typography.Text>
                              {summaryRow.operationKinds.length > 0 ? summaryRow.operationKinds.join(', ') : '(none)'}
                            </Typography.Text>
                          </div>
                          <div>
                            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                              targetRoles
                            </Typography.Text>
                            <Typography.Text>
                              {summaryRow.targetRoles.length > 0 ? summaryRow.targetRoles.join(', ') : '(none)'}
                            </Typography.Text>
                          </div>
                          {summaryRow.priority !== null ? (
                            <div>
                              <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                                priority
                              </Typography.Text>
                              <Typography.Text>{summaryRow.priority}</Typography.Text>
                            </div>
                          ) : null}
                          <div>
                            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                              bucketKeys
                            </Typography.Text>
                            <Typography.Text>
                              {summaryRow.hasBucketOperations
                                ? summaryRow.bucketKeys.length > 0
                                  ? summaryRow.bucketKeys.join(', ')
                                  : '(empty bucketKey)'
                                : '(none)'}
                            </Typography.Text>
                          </div>
                          <div>
                            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                              evidenceKeys
                            </Typography.Text>
                            <Typography.Text>
                              {summaryRow.evidenceKeys.length > 0 ? summaryRow.evidenceKeys.join(', ') : '(none)'}
                            </Typography.Text>
                          </div>
                        </div>

                        {dpsPassiveEffects && onDpsPassiveEffectsChange ? (
                          <div>
                            <Typography.Text bold style={{ display: 'block', marginBottom: 8 }}>
                              Batch R 乘区（operations）
                            </Typography.Text>
                            {(() => {
                              const passive = dpsPassiveEffects[summaryRow.index];
                              const operations = isPlainObject(passive) && Array.isArray(passive.operations) ? passive.operations : [];
                              if (operations.length === 0) {
                                return <Empty description="当前 passive 暂无 operations。" />;
                              }

                              return (
                                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                                  {operations.map((operation, operationIndex) => {
                                    if (!isPlainObject(operation)) {
                                      return (
                                        <Alert
                                          key={`operation-invalid-${operationIndex}`}
                                          type="warning"
                                          content={`operations[${operationIndex}] 不是对象，跳过编辑。`}
                                        />
                                      );
                                    }

                                    const operationKind = typeof operation.kind === 'string' ? operation.kind : `#${operationIndex}`;
                                    const operationPriority =
                                      typeof operation.priority === 'number' && Number.isFinite(operation.priority)
                                        ? operation.priority
                                        : undefined;

                                    return (
                                      <div
                                        key={`operation-${summaryRow.index}-${operationIndex}`}
                                        style={{ border: '1px solid var(--color-border-3)', borderRadius: 8, padding: 12 }}
                                      >
                                        <Space direction="vertical" size={10} style={{ width: '100%' }}>
                                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                            operation[{operationIndex}] · kind={operationKind || '(missing)'}
                                          </Typography.Text>

                                          <div className="crud-form-grid">
                                            <div>
                                              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                                                bucketKey
                                              </Typography.Text>
                                              <Select
                                                allowClear
                                                showSearch
                                                value={typeof operation.bucketKey === 'string' ? operation.bucketKey : undefined}
                                                disabled={disabled}
                                                options={coefficientBucketOptions}
                                                placeholder="选择 coefficient bucket"
                                                onChange={(value) =>
                                                  updateDpsPassiveOperation(summaryRow.index, operationIndex, (nextOperation) => {
                                                    setOptionalStringField(nextOperation, 'bucketKey', String(value ?? ''));
                                                    return nextOperation;
                                                  })
                                                }
                                              />
                                            </div>
                                            <div>
                                              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                                                priority
                                              </Typography.Text>
                                              <InputNumber
                                                style={{ width: '100%' }}
                                                value={operationPriority}
                                                disabled={disabled}
                                                onChange={(value) =>
                                                  updateDpsPassiveOperation(summaryRow.index, operationIndex, (nextOperation) => {
                                                    setOptionalNumberField(
                                                      nextOperation,
                                                      'priority',
                                                      value === undefined || value === null ? undefined : Number(value)
                                                    );
                                                    return nextOperation;
                                                  })
                                                }
                                              />
                                            </div>
                                          </div>

                                          <div>
                                            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                                              evidenceKey
                                            </Typography.Text>
                                            <Input
                                              value={typeof operation.evidenceKey === 'string' ? operation.evidenceKey : ''}
                                              disabled={disabled}
                                              onChange={(value) =>
                                                updateDpsPassiveOperation(summaryRow.index, operationIndex, (nextOperation) => {
                                                  setOptionalStringField(nextOperation, 'evidenceKey', value);
                                                  return nextOperation;
                                                })
                                              }
                                            />
                                          </div>

                                          <OptionalJsonFieldEditor
                                            label="valueSpec（JSON 对象）"
                                            value={operation.valueSpec}
                                            expectedKind="object"
                                            disabled={disabled}
                                            onCommit={(nextValue) =>
                                              updateDpsPassiveOperation(summaryRow.index, operationIndex, (nextOperation) => {
                                                setOptionalJsonField(
                                                  nextOperation,
                                                  'valueSpec',
                                                  nextValue === undefined ? undefined : (nextValue as JsonObject)
                                                );
                                                return nextOperation;
                                              })
                                            }
                                          />

                                          <OptionalJsonFieldEditor
                                            label="conditions（JSON 数组）"
                                            value={operation.conditions}
                                            expectedKind="array"
                                            disabled={disabled}
                                            onCommit={(nextValue) =>
                                              updateDpsPassiveOperation(summaryRow.index, operationIndex, (nextOperation) => {
                                                setOptionalJsonField(
                                                  nextOperation,
                                                  'conditions',
                                                  nextValue === undefined ? undefined : (nextValue as JsonValue[])
                                                );
                                                return nextOperation;
                                              })
                                            }
                                          />
                                        </Space>
                                      </div>
                                    );
                                  })}
                                </Space>
                              );
                            })()}
                          </div>
                        ) : null}

                        {summaryRow.warnings.length > 0 ? (
                          <div>
                            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                              warnings
                            </Typography.Text>
                            <Space wrap size={6}>
                              {summaryRow.warnings.map((warning) => (
                                <Tag key={warning} color="orangered">
                                  {warning}
                                </Tag>
                              ))}
                            </Space>
                          </div>
                        ) : null}
                      </Space>
                    </div>
                  ))}
                </Space>
              </div>
            ))
          )}
        </Space>
      </div>
    </Space>
  );
}
