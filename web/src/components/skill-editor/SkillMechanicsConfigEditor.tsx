import { Alert, Button, Checkbox, Empty, Input, InputNumber, Select, Space, Tag, Typography } from '@arco-design/web-react';
import { useEffect, useMemo, useState } from 'react';
import { appendCurrentDamageTypeOption, type DamageTypeOption } from '../../pages/admin/resources/shared/damageTypes';
import { getCoefficientBuckets } from '../../services/apiClient';
import type { CoefficientBucket, JsonObject, JsonValue } from '../../types/api';
import { AttributeKeySelector } from '../AttributeKeySelector';
import {
  appendOperationsToPassive,
  buildDpsPassiveTemplateContext,
  createDpsPassiveFromTemplate,
  createDpsPassiveTemplateOperations,
  duplicateDpsPassive,
  getDpsPassiveTemplate,
  getDpsPassiveTemplateOptions,
  type DpsPassiveTemplateId
} from './dpsPassiveTemplates';
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
  skillId?: string;
  ownerId?: string;
  ownerType?: string;
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

const EXECUTE_THRESHOLD_TYPE_OPTIONS = [
  { label: '当前血量比例（current_hp_ratio）', value: 'current_hp_ratio' },
  { label: '当前血量数值（current_hp_value）', value: 'current_hp_value' }
];

const EXECUTE_THRESHOLD_CHECK_TIMING_OPTIONS = [{ label: '伤害后（after_damage）', value: 'after_damage' }];

const ENERGIZED_CHARGE_READY_POLICY_OPTIONS = [
  { label: '阈值后下次普攻（next_basic_attack_after_threshold_reached）', value: 'next_basic_attack_after_threshold_reached' }
];

const ENERGIZED_PROC_SCOPE_OPTIONS = [
  { label: '仅真实普攻（real_basic_attack_only）', value: 'real_basic_attack_only' }
];

const STAT_MODIFIER_MODE_OPTIONS = [
  { label: '百分比（percent）', value: 'percent' },
  { label: '固定值（flat）', value: 'flat' }
];

const DOT_REFRESH_MODE_OPTIONS = [{ label: '刷新（refresh）', value: 'refresh' }];

const PHANTOM_REPEAT_SCOPE_OPTIONS = [{ label: '可复制普攻命中', value: 'copyable_on_hit' }];

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

function updateDpsPassiveField(
  passives: JsonObject[],
  passiveIndex: number,
  apply: (passive: JsonObject) => JsonObject
): JsonObject[] {
  return passives.map((passive, currentPassiveIndex) => {
    if (currentPassiveIndex !== passiveIndex || !isPlainObject(passive)) {
      return passive;
    }
    return apply({ ...passive });
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

function setOptionalBooleanField(target: JsonObject, key: string, value: boolean) {
  target[key] = value;
}

function readOptionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readOptionalPositiveInteger(value: unknown): number | undefined {
  const numeric = readOptionalFiniteNumber(value);
  if (numeric === undefined || !Number.isInteger(numeric) || numeric < 1) {
    return undefined;
  }
  return numeric;
}

function DpsPassiveOperationKindFields({
  operation,
  operationKind,
  disabled,
  damageTypeOptions,
  defaultDamageTypeValue,
  onPatch
}: {
  operation: JsonObject;
  operationKind: string;
  disabled: boolean;
  damageTypeOptions: DamageTypeOption[];
  defaultDamageTypeValue: string;
  onPatch: (apply: (nextOperation: JsonObject) => JsonObject) => void;
}) {
  const damageTypeValue = typeof operation.damageType === 'string' ? operation.damageType : '';
  const amountValue = readOptionalFiniteNumber(operation.amount);
  const valueAmount = readOptionalFiniteNumber(operation.value);
  const thresholdValue = readOptionalFiniteNumber(operation.thresholdValue);
  const critMultiplierOverride = readOptionalFiniteNumber(operation.critMultiplierOverride);
  const critMultiplierScale = readOptionalFiniteNumber(operation.critMultiplierScale);
  const maxStacksValue = readOptionalPositiveInteger(operation.maxStacks);
  const triggerStacksValue = readOptionalPositiveInteger(operation.triggerStacks);

  const renderDamageFields = (includePhantomCopyable = false) => (
    <div className="crud-form-grid">
      <div>
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
          damageType
        </Typography.Text>
        <Select
          value={damageTypeValue || undefined}
          disabled={disabled}
          options={appendCurrentDamageTypeOption(
            damageTypeOptions,
            damageTypeValue,
            damageTypeValue ? `${damageTypeValue} (legacy)` : undefined
          )}
          onChange={(value) =>
            onPatch((nextOperation) => {
              setOptionalStringField(nextOperation, 'damageType', String(value ?? defaultDamageTypeValue));
              return nextOperation;
            })
          }
        />
      </div>
      <div>
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
          amount
        </Typography.Text>
        <InputNumber
          style={{ width: '100%' }}
          value={amountValue}
          disabled={disabled}
          placeholder="未设置"
          onChange={(value) =>
            onPatch((nextOperation) => {
              setOptionalNumberField(
                nextOperation,
                'amount',
                value === undefined || value === null ? undefined : Number(value)
              );
              return nextOperation;
            })
          }
        />
      </div>
      {includePhantomCopyable ? (
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <Checkbox
            checked={operation.phantomHitCopyable === true}
            disabled={disabled}
            onChange={(checked) =>
              onPatch((nextOperation) => {
                setOptionalBooleanField(nextOperation, 'phantomHitCopyable', checked);
                return nextOperation;
              })
            }
          >
            phantomHitCopyable
          </Checkbox>
        </div>
      ) : null}
    </div>
  );

  if (operationKind === 'damage') {
    return renderDamageFields(true);
  }

  if (operationKind === 'damage_modifier') {
    return (
      <div className="crud-form-grid">
        <div>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
            value
          </Typography.Text>
          <InputNumber
            style={{ width: '100%' }}
            value={valueAmount}
            disabled={disabled}
            placeholder="未设置"
            onChange={(value) =>
              onPatch((nextOperation) => {
                setOptionalNumberField(
                  nextOperation,
                  'value',
                  value === undefined || value === null ? undefined : Number(value)
                );
                return nextOperation;
              })
            }
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <Checkbox
            checked={operation.critOnly === true}
            disabled={disabled}
            onChange={(checked) =>
              onPatch((nextOperation) => {
                setOptionalBooleanField(nextOperation, 'critOnly', checked);
                return nextOperation;
              })
            }
          >
            critOnly
          </Checkbox>
        </div>
      </div>
    );
  }

  if (operationKind === 'execute_threshold') {
    const thresholdType = typeof operation.thresholdType === 'string' ? operation.thresholdType : undefined;
    const checkTiming = typeof operation.checkTiming === 'string' ? operation.checkTiming : undefined;
    return (
      <div className="crud-form-grid">
        <div>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
            thresholdType
          </Typography.Text>
          <Select
            value={thresholdType}
            disabled={disabled}
            options={EXECUTE_THRESHOLD_TYPE_OPTIONS}
            onChange={(value) =>
              onPatch((nextOperation) => {
                setOptionalStringField(nextOperation, 'thresholdType', String(value ?? ''));
                return nextOperation;
              })
            }
          />
        </div>
        <div>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
            thresholdValue
          </Typography.Text>
          <InputNumber
            style={{ width: '100%' }}
            min={0}
            value={thresholdValue}
            disabled={disabled}
            placeholder="必填"
            onChange={(value) =>
              onPatch((nextOperation) => {
                setOptionalNumberField(
                  nextOperation,
                  'thresholdValue',
                  value === undefined || value === null ? undefined : Number(value)
                );
                return nextOperation;
              })
            }
          />
        </div>
        <div>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
            checkTiming
          </Typography.Text>
          <Select
            allowClear
            value={checkTiming}
            disabled={disabled}
            placeholder="未设置"
            options={EXECUTE_THRESHOLD_CHECK_TIMING_OPTIONS}
            onChange={(value) =>
              onPatch((nextOperation) => {
                setOptionalStringField(nextOperation, 'checkTiming', String(value ?? ''));
                return nextOperation;
              })
            }
          />
        </div>
      </div>
    );
  }

  if (operationKind === 'crit_context_modifier') {
    return (
      <div className="crud-form-grid">
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <Checkbox
            checked={operation.forceCrit === true}
            disabled={disabled}
            onChange={(checked) =>
              onPatch((nextOperation) => {
                setOptionalBooleanField(nextOperation, 'forceCrit', checked);
                return nextOperation;
              })
            }
          >
            forceCrit
          </Checkbox>
        </div>
        <div>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
            critMultiplierOverride
          </Typography.Text>
          <InputNumber
            style={{ width: '100%' }}
            value={critMultiplierOverride}
            disabled={disabled}
            placeholder="未设置"
            onChange={(value) =>
              onPatch((nextOperation) => {
                setOptionalNumberField(
                  nextOperation,
                  'critMultiplierOverride',
                  value === undefined || value === null ? undefined : Number(value)
                );
                if (value !== undefined && value !== null) {
                  delete nextOperation.critMultiplierScale;
                  delete nextOperation.hasCritMultiplierScale;
                }
                return nextOperation;
              })
            }
          />
        </div>
        <div>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
            critMultiplierScale
          </Typography.Text>
          <InputNumber
            style={{ width: '100%' }}
            value={critMultiplierScale}
            disabled={disabled}
            placeholder="未设置"
            onChange={(value) =>
              onPatch((nextOperation) => {
                setOptionalNumberField(
                  nextOperation,
                  'critMultiplierScale',
                  value === undefined || value === null ? undefined : Number(value)
                );
                if (value !== undefined && value !== null) {
                  delete nextOperation.critMultiplierOverride;
                  delete nextOperation.hasCritMultiplierOverride;
                }
                return nextOperation;
              })
            }
          />
        </div>
      </div>
    );
  }

  if (operationKind === 'add_stack') {
    return (
      <div className="crud-form-grid">
        <div>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
            stackKey
          </Typography.Text>
          <Input
            value={typeof operation.stackKey === 'string' ? operation.stackKey : ''}
            disabled={disabled}
            onChange={(value) =>
              onPatch((nextOperation) => {
                setOptionalStringField(nextOperation, 'stackKey', value);
                return nextOperation;
              })
            }
          />
        </div>
        <div>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
            maxStacks
          </Typography.Text>
          <InputNumber
            style={{ width: '100%' }}
            min={1}
            step={1}
            precision={0}
            value={maxStacksValue}
            disabled={disabled}
            placeholder="正整数"
            onChange={(value) =>
              onPatch((nextOperation) => {
                if (value === undefined || value === null) {
                  setOptionalNumberField(nextOperation, 'maxStacks', undefined);
                } else {
                  const numeric = Math.trunc(Number(value));
                  setOptionalNumberField(
                    nextOperation,
                    'maxStacks',
                    Number.isFinite(numeric) && numeric >= 1 ? numeric : undefined
                  );
                }
                return nextOperation;
              })
            }
          />
        </div>
      </div>
    );
  }

  if (operationKind === 'trigger_damage_at_stacks') {
    return (
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <div className="crud-form-grid">
          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
              stackKey
            </Typography.Text>
            <Input
              value={typeof operation.stackKey === 'string' ? operation.stackKey : ''}
              disabled={disabled}
              onChange={(value) =>
                onPatch((nextOperation) => {
                  setOptionalStringField(nextOperation, 'stackKey', value);
                  return nextOperation;
                })
              }
            />
          </div>
          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
              triggerStacks
            </Typography.Text>
            <InputNumber
              style={{ width: '100%' }}
              min={1}
              step={1}
              precision={0}
              value={triggerStacksValue}
              disabled={disabled}
              placeholder="正整数"
              onChange={(value) =>
                onPatch((nextOperation) => {
                  if (value === undefined || value === null) {
                    setOptionalNumberField(nextOperation, 'triggerStacks', undefined);
                  } else {
                    const numeric = Math.trunc(Number(value));
                    setOptionalNumberField(
                      nextOperation,
                      'triggerStacks',
                      Number.isFinite(numeric) && numeric >= 1 ? numeric : undefined
                    );
                  }
                  return nextOperation;
                })
              }
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <Checkbox
              checked={operation.resetStacks === true}
              disabled={disabled}
              onChange={(checked) =>
                onPatch((nextOperation) => {
                  setOptionalBooleanField(nextOperation, 'resetStacks', checked);
                  return nextOperation;
                })
              }
            >
              resetStacks
            </Checkbox>
          </div>
        </div>
        {renderDamageFields()}
      </Space>
    );
  }

  if (operationKind === 'apply_dot') {
    const durationMs = readOptionalFiniteNumber(operation.durationMs);
    const tickIntervalMs = readOptionalFiniteNumber(operation.tickIntervalMs);
    const refreshMode = typeof operation.refreshMode === 'string' ? operation.refreshMode : undefined;
    return (
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        {renderDamageFields()}
        <div className="crud-form-grid">
          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
              durationMs
            </Typography.Text>
            <InputNumber
              style={{ width: '100%' }}
              min={1}
              step={1}
              precision={0}
              value={durationMs}
              disabled={disabled}
              placeholder="正整数"
              onChange={(value) =>
                onPatch((nextOperation) => {
                  if (value === undefined || value === null) {
                    setOptionalNumberField(nextOperation, 'durationMs', undefined);
                  } else {
                    const numeric = Math.trunc(Number(value));
                    setOptionalNumberField(
                      nextOperation,
                      'durationMs',
                      Number.isFinite(numeric) && numeric >= 1 ? numeric : undefined
                    );
                  }
                  return nextOperation;
                })
              }
            />
          </div>
          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
              tickIntervalMs
            </Typography.Text>
            <InputNumber
              style={{ width: '100%' }}
              min={1000}
              step={1000}
              precision={0}
              value={tickIntervalMs}
              disabled={disabled}
              placeholder="默认 1000"
              onChange={(value) =>
                onPatch((nextOperation) => {
                  if (value === undefined || value === null) {
                    setOptionalNumberField(nextOperation, 'tickIntervalMs', undefined);
                  } else {
                    const numeric = Math.trunc(Number(value));
                    setOptionalNumberField(
                      nextOperation,
                      'tickIntervalMs',
                      Number.isFinite(numeric) && numeric >= 1 ? numeric : undefined
                    );
                  }
                  return nextOperation;
                })
              }
            />
          </div>
          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
              refreshMode
            </Typography.Text>
            <Select
              allowClear
              value={refreshMode}
              disabled={disabled}
              placeholder="未设置"
              options={DOT_REFRESH_MODE_OPTIONS}
              onChange={(value) =>
                onPatch((nextOperation) => {
                  setOptionalStringField(nextOperation, 'refreshMode', String(value ?? ''));
                  return nextOperation;
                })
              }
            />
          </div>
        </div>
      </Space>
    );
  }

  if (operationKind === 'stat_modifier') {
    const perStack = operation.perStack === true;
    return (
      <div className="crud-form-grid">
        <div>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
            attrKey
          </Typography.Text>
          <Input
            value={typeof operation.attrKey === 'string' ? operation.attrKey : ''}
            disabled={disabled}
            onChange={(value) =>
              onPatch((nextOperation) => {
                setOptionalStringField(nextOperation, 'attrKey', value);
                return nextOperation;
              })
            }
          />
        </div>
        <div>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
            modifierMode
          </Typography.Text>
          <Select
            allowClear
            value={typeof operation.modifierMode === 'string' ? operation.modifierMode : undefined}
            disabled={disabled}
            options={STAT_MODIFIER_MODE_OPTIONS}
            onChange={(value) =>
              onPatch((nextOperation) => {
                setOptionalStringField(nextOperation, 'modifierMode', String(value ?? ''));
                return nextOperation;
              })
            }
          />
        </div>
        <div>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
            value
          </Typography.Text>
          <InputNumber
            style={{ width: '100%' }}
            value={valueAmount}
            disabled={disabled}
            placeholder="未设置"
            onChange={(value) =>
              onPatch((nextOperation) => {
                setOptionalNumberField(
                  nextOperation,
                  'value',
                  value === undefined || value === null ? undefined : Number(value)
                );
                return nextOperation;
              })
            }
          />
        </div>
        <div>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
            stackKey
          </Typography.Text>
          <Input
            value={typeof operation.stackKey === 'string' ? operation.stackKey : ''}
            disabled={disabled}
            onChange={(value) =>
              onPatch((nextOperation) => {
                setOptionalStringField(nextOperation, 'stackKey', value);
                return nextOperation;
              })
            }
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <Checkbox
            checked={perStack}
            disabled={disabled}
            onChange={(checked) =>
              onPatch((nextOperation) => {
                setOptionalBooleanField(nextOperation, 'perStack', checked);
                return nextOperation;
              })
            }
          >
            perStack
          </Checkbox>
        </div>
      </div>
    );
  }

  if (operationKind === 'phantom_hit_on_hit_repeat') {
    const repeatCount = readOptionalFiniteNumber(operation.repeatCount);
    const repeatTag = typeof operation.repeatTag === 'string' ? operation.repeatTag : '';
    const repeatScope = typeof operation.repeatScope === 'string' ? operation.repeatScope : undefined;
    return (
      <div className="crud-form-grid">
        <div>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
            stackKey
          </Typography.Text>
          <Input
            value={typeof operation.stackKey === 'string' ? operation.stackKey : ''}
            disabled={disabled}
            onChange={(value) =>
              onPatch((nextOperation) => {
                setOptionalStringField(nextOperation, 'stackKey', value);
                return nextOperation;
              })
            }
          />
        </div>
        <div>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
            triggerStacks
          </Typography.Text>
          <InputNumber
            style={{ width: '100%' }}
            min={1}
            step={1}
            precision={0}
            value={triggerStacksValue}
            disabled={disabled}
            placeholder="正整数"
            onChange={(value) =>
              onPatch((nextOperation) => {
                if (value === undefined || value === null) {
                  setOptionalNumberField(nextOperation, 'triggerStacks', undefined);
                } else {
                  const numeric = Math.trunc(Number(value));
                  setOptionalNumberField(
                    nextOperation,
                    'triggerStacks',
                    Number.isFinite(numeric) && numeric >= 1 ? numeric : undefined
                  );
                }
                return nextOperation;
              })
            }
          />
        </div>
        <div>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
            repeatCount
          </Typography.Text>
          <InputNumber
            style={{ width: '100%' }}
            min={1}
            max={1}
            step={1}
            precision={0}
            value={repeatCount}
            disabled={disabled}
            placeholder="1"
            onChange={(value) =>
              onPatch((nextOperation) => {
                if (value === undefined || value === null) {
                  setOptionalNumberField(nextOperation, 'repeatCount', undefined);
                } else {
                  setOptionalNumberField(nextOperation, 'repeatCount', 1);
                }
                return nextOperation;
              })
            }
          />
        </div>
        <div>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
            repeatTag
          </Typography.Text>
          <Input
            value={repeatTag}
            disabled={disabled}
            onChange={(value) =>
              onPatch((nextOperation) => {
                setOptionalStringField(nextOperation, 'repeatTag', value);
                return nextOperation;
              })
            }
          />
        </div>
        <div>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
            repeatScope
          </Typography.Text>
          <Select
            value={repeatScope}
            disabled={disabled}
            options={PHANTOM_REPEAT_SCOPE_OPTIONS}
            onChange={(value) =>
              onPatch((nextOperation) => {
                setOptionalStringField(nextOperation, 'repeatScope', String(value ?? ''));
                return nextOperation;
              })
            }
          />
        </div>
      </div>
    );
  }

  return null;
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
  skillId,
  ownerId,
  ownerType,
  disabled = false,
  onVersionChange,
  onStacksChange,
  onChange,
  onDpsPassiveEffectsChange
}: SkillMechanicsConfigEditorProps) {
  const defaultDamageTypeValue = damageTypeOptions[0]?.value ?? 'magic';
  const [coefficientBuckets, setCoefficientBuckets] = useState<CoefficientBucket[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<DpsPassiveTemplateId>('attacker_on_hit_damage');
  const [selectedPassiveIndex, setSelectedPassiveIndex] = useState<number | undefined>(undefined);
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
  const dpsPassiveTemplateOptions = useMemo(() => getDpsPassiveTemplateOptions(), []);
  const selectedTemplate = useMemo(() => getDpsPassiveTemplate(selectedTemplateId), [selectedTemplateId]);
  const dpsPassiveTemplateContext = useMemo(
    () => buildDpsPassiveTemplateContext({ skillId, ownerId, ownerType }),
    [skillId, ownerId, ownerType]
  );
  const dpsPassiveMalformed = 'dpsPassiveEffects' in root && !Array.isArray(root.dpsPassiveEffects);
  const canEditDpsPassives = Boolean(onDpsPassiveEffectsChange) && !disabled && !dpsPassiveMalformed;
  const editablePassiveCount = Array.isArray(root.dpsPassiveEffects) ? root.dpsPassiveEffects.length : 0;

  useEffect(() => {
    if (editablePassiveCount === 0) {
      setSelectedPassiveIndex(undefined);
      return;
    }
    setSelectedPassiveIndex((current) => {
      if (current === undefined || current >= editablePassiveCount) {
        return 0;
      }
      return current;
    });
  }, [editablePassiveCount]);
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

  const resolveEditablePassives = (): JsonObject[] => {
    if (Array.isArray(root.dpsPassiveEffects)) {
      return root.dpsPassiveEffects as JsonObject[];
    }
    return [];
  };

  const addPassiveFromTemplate = () => {
    if (!canEditDpsPassives) {
      return;
    }
    const passive = createDpsPassiveFromTemplate(selectedTemplateId, dpsPassiveTemplateContext);
    const nextPassives = [...resolveEditablePassives(), passive];
    commitDpsPassiveEffects(nextPassives);
    setSelectedPassiveIndex(nextPassives.length - 1);
  };

  const appendOperationTemplateToSelectedPassive = () => {
    if (!canEditDpsPassives || !dpsPassiveEffects || selectedPassiveIndex === undefined) {
      return;
    }
    const operations = createDpsPassiveTemplateOperations(selectedTemplateId, dpsPassiveTemplateContext);
    if (operations.length === 0) {
      return;
    }
    commitDpsPassiveEffects(
      dpsPassiveEffects.map((passive, index) =>
        index === selectedPassiveIndex && isPlainObject(passive)
          ? appendOperationsToPassive(passive, operations)
          : passive
      )
    );
  };

  const duplicatePassive = (passiveIndex: number) => {
    if (!canEditDpsPassives || !dpsPassiveEffects) {
      return;
    }
    const passive = dpsPassiveEffects[passiveIndex];
    if (!isPlainObject(passive)) {
      return;
    }
    const duplicate = duplicateDpsPassive(passive, dpsPassiveEffects);
    const nextPassives = [...dpsPassiveEffects];
    nextPassives.splice(passiveIndex + 1, 0, duplicate);
    commitDpsPassiveEffects(nextPassives);
    setSelectedPassiveIndex(passiveIndex + 1);
  };

  const deletePassive = (passiveIndex: number) => {
    if (!canEditDpsPassives || !dpsPassiveEffects) {
      return;
    }
    commitDpsPassiveEffects(dpsPassiveEffects.filter((_, index) => index !== passiveIndex));
  };

  const movePassive = (passiveIndex: number, direction: -1 | 1) => {
    if (!canEditDpsPassives || !dpsPassiveEffects) {
      return;
    }
    const targetIndex = passiveIndex + direction;
    if (targetIndex < 0 || targetIndex >= dpsPassiveEffects.length) {
      return;
    }
    const nextPassives = [...dpsPassiveEffects];
    const [moved] = nextPassives.splice(passiveIndex, 1);
    nextPassives.splice(targetIndex, 0, moved);
    commitDpsPassiveEffects(nextPassives);
    setSelectedPassiveIndex(targetIndex);
  };

  const passiveSelectOptions = useMemo(
    () =>
      dpsPassiveSummaryRows.map((row) => ({
        label: `[${row.index}] ${row.passiveId}`,
        value: row.index
      })),
    [dpsPassiveSummaryRows]
  );

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

  const updateDpsPassive = (passiveIndex: number, apply: (passive: JsonObject) => JsonObject) => {
    if (!dpsPassiveEffects) {
      return;
    }
    commitDpsPassiveEffects(updateDpsPassiveField(dpsPassiveEffects, passiveIndex, apply));
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
              展示 mechanicsConfig.dpsPassiveEffects；支持模板辅助创建与 Batch R 乘区字段维护。
            </Typography.Text>
          </div>

          {canEditDpsPassives ? (
            <div style={{ border: '1px dashed var(--color-border-3)', borderRadius: 8, padding: 12 }}>
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Typography.Text bold style={{ fontSize: 12 }}>
                  模板工具条
                </Typography.Text>
                <div className="crud-form-grid">
                  <div>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                      模板
                    </Typography.Text>
                    <Select
                      value={selectedTemplateId}
                      options={dpsPassiveTemplateOptions}
                      onChange={(value) => setSelectedTemplateId(String(value) as DpsPassiveTemplateId)}
                    />
                  </div>
                  <div>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                      目标 passive（追加 operation）
                    </Typography.Text>
                    <Select
                      allowClear
                      placeholder="选择 passive"
                      value={selectedPassiveIndex}
                      disabled={passiveSelectOptions.length === 0}
                      options={passiveSelectOptions}
                      onChange={(value) =>
                        setSelectedPassiveIndex(value === undefined || value === null ? undefined : Number(value))
                      }
                    />
                  </div>
                </div>
                <Space wrap>
                  <Button size="small" type="primary" onClick={addPassiveFromTemplate}>
                    新增 passive
                  </Button>
                  <Button
                    size="small"
                    onClick={appendOperationTemplateToSelectedPassive}
                    disabled={selectedPassiveIndex === undefined}
                  >
                    追加 operation 模板
                  </Button>
                </Space>
                {selectedTemplate ? (
                  <div>
                    <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
                      {selectedTemplate.description}
                    </Typography.Text>
                    <Space wrap size={6}>
                      <Tag size="small" color="arcoblue">
                        ownerRole={selectedTemplate.ownerRole}
                      </Tag>
                      <Tag size="small" color={selectedTemplate.supported === 'runtime' ? 'green' : 'gray'}>
                        {selectedTemplate.supported}
                      </Tag>
                      {selectedTemplate.requiresRealData ? (
                        <Tag size="small" color="orangered">
                          需真实数据
                        </Tag>
                      ) : null}
                      {selectedTemplate.keyFields.map((field) => (
                        <Tag key={field} size="small" color="purple">
                          {field}
                        </Tag>
                      ))}
                    </Space>
                  </div>
                ) : null}
              </Space>
            </div>
          ) : null}

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
            <Empty description="未配置 dpsPassiveEffects；可使用上方模板新增，旧技能可不填。" />
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
                        {canEditDpsPassives ? (
                          <Space wrap>
                            <Button size="small" onClick={() => duplicatePassive(summaryRow.index)}>
                              复制
                            </Button>
                            <Button size="small" status="danger" onClick={() => deletePassive(summaryRow.index)}>
                              删除
                            </Button>
                            <Button
                              size="small"
                              onClick={() => movePassive(summaryRow.index, -1)}
                              disabled={summaryRow.index === 0}
                            >
                              上移
                            </Button>
                            <Button
                              size="small"
                              onClick={() => movePassive(summaryRow.index, 1)}
                              disabled={summaryRow.index >= dpsPassiveSummaryRows.length - 1}
                            >
                              下移
                            </Button>
                          </Space>
                        ) : null}
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
                              cooldown
                            </Typography.Text>
                            <Typography.Text>
                              {summaryRow.internalCooldownMs != null && summaryRow.internalCooldownMs > 0
                                ? `${summaryRow.internalCooldownMs}ms`
                                : 'none'}
                            </Typography.Text>
                          </div>
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
                          <div className="crud-form-grid">
                            <div>
                              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                                internalCooldownMs
                              </Typography.Text>
                              {(() => {
                                const passive = dpsPassiveEffects[summaryRow.index];
                                const cooldownValue = isPlainObject(passive) && typeof passive.internalCooldownMs === 'number' && Number.isFinite(passive.internalCooldownMs)
                                  ? passive.internalCooldownMs
                                  : undefined;
                                return (
                                  <InputNumber
                                    style={{ width: '100%' }}
                                    min={0}
                                    step={1}
                                    precision={0}
                                    value={cooldownValue}
                                    disabled={disabled}
                                    placeholder="none"
                                    onChange={(value) =>
                                      updateDpsPassive(summaryRow.index, (nextPassive) => {
                                        if (value === undefined || value === null) {
                                          setOptionalNumberField(nextPassive, 'internalCooldownMs', undefined);
                                        } else {
                                          const numeric = Number(value);
                                          setOptionalNumberField(
                                            nextPassive,
                                            'internalCooldownMs',
                                            Number.isFinite(numeric) ? Math.trunc(numeric) : undefined
                                          );
                                        }
                                        return nextPassive;
                                      })
                                    }
                                  />
                                );
                              })()}
                            </div>
                          </div>
                        ) : null}

                        {dpsPassiveEffects && onDpsPassiveEffectsChange ? (
                          (() => {
                            const passive = dpsPassiveEffects[summaryRow.index];
                            if (!isPlainObject(passive)) {
                              return null;
                            }
                            const triggerKind = typeof passive.triggerKind === 'string' ? passive.triggerKind : '';
                            const showEnergizedFields =
                              triggerKind === 'energized_charge_and_consume'
                              || 'chargeKey' in passive
                              || 'chargeGainPerBasicAttack' in passive
                              || 'chargeThreshold' in passive;
                            if (!showEnergizedFields) {
                              return null;
                            }
                            const chargeKey = typeof passive.chargeKey === 'string' ? passive.chargeKey : '';
                            const chargeGain = readOptionalFiniteNumber(passive.chargeGainPerBasicAttack);
                            const chargeThreshold = readOptionalFiniteNumber(passive.chargeThreshold);
                            const chargeCap = readOptionalFiniteNumber(passive.chargeCap);
                            const chargeReadyPolicy =
                              typeof passive.chargeReadyPolicy === 'string' ? passive.chargeReadyPolicy : undefined;
                            const procScope = typeof passive.procScope === 'string' ? passive.procScope : undefined;
                            return (
                              <div>
                                <Typography.Text bold style={{ display: 'block', marginBottom: 8 }}>
                                  energized charge 字段
                                </Typography.Text>
                                <div className="crud-form-grid">
                                  <div>
                                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                                      chargeKey
                                    </Typography.Text>
                                    <Input
                                      value={chargeKey}
                                      disabled={disabled}
                                      onChange={(value) =>
                                        updateDpsPassive(summaryRow.index, (nextPassive) => {
                                          setOptionalStringField(nextPassive, 'chargeKey', value);
                                          return nextPassive;
                                        })
                                      }
                                    />
                                  </div>
                                  <div>
                                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                                      chargeGainPerBasicAttack
                                    </Typography.Text>
                                    <InputNumber
                                      style={{ width: '100%' }}
                                      min={0}
                                      value={chargeGain}
                                      disabled={disabled}
                                      onChange={(value) =>
                                        updateDpsPassive(summaryRow.index, (nextPassive) => {
                                          setOptionalNumberField(
                                            nextPassive,
                                            'chargeGainPerBasicAttack',
                                            value === undefined || value === null ? undefined : Number(value)
                                          );
                                          return nextPassive;
                                        })
                                      }
                                    />
                                  </div>
                                  <div>
                                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                                      chargeThreshold
                                    </Typography.Text>
                                    <InputNumber
                                      style={{ width: '100%' }}
                                      min={0}
                                      value={chargeThreshold}
                                      disabled={disabled}
                                      onChange={(value) =>
                                        updateDpsPassive(summaryRow.index, (nextPassive) => {
                                          setOptionalNumberField(
                                            nextPassive,
                                            'chargeThreshold',
                                            value === undefined || value === null ? undefined : Number(value)
                                          );
                                          return nextPassive;
                                        })
                                      }
                                    />
                                  </div>
                                  <div>
                                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                                      chargeCap
                                    </Typography.Text>
                                    <InputNumber
                                      style={{ width: '100%' }}
                                      min={0}
                                      value={chargeCap}
                                      disabled={disabled}
                                      placeholder="可选"
                                      onChange={(value) =>
                                        updateDpsPassive(summaryRow.index, (nextPassive) => {
                                          setOptionalNumberField(
                                            nextPassive,
                                            'chargeCap',
                                            value === undefined || value === null ? undefined : Number(value)
                                          );
                                          return nextPassive;
                                        })
                                      }
                                    />
                                  </div>
                                  <div>
                                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                                      chargeReadyPolicy
                                    </Typography.Text>
                                    <Select
                                      allowClear
                                      value={chargeReadyPolicy}
                                      disabled={disabled}
                                      options={ENERGIZED_CHARGE_READY_POLICY_OPTIONS}
                                      onChange={(value) =>
                                        updateDpsPassive(summaryRow.index, (nextPassive) => {
                                          setOptionalStringField(nextPassive, 'chargeReadyPolicy', String(value ?? ''));
                                          return nextPassive;
                                        })
                                      }
                                    />
                                  </div>
                                  <div>
                                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                                      procScope
                                    </Typography.Text>
                                    <Select
                                      allowClear
                                      value={procScope}
                                      disabled={disabled}
                                      options={ENERGIZED_PROC_SCOPE_OPTIONS}
                                      onChange={(value) =>
                                        updateDpsPassive(summaryRow.index, (nextPassive) => {
                                          setOptionalStringField(nextPassive, 'procScope', String(value ?? ''));
                                          return nextPassive;
                                        })
                                      }
                                    />
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                                    <Checkbox
                                      checked={passive.consumeChargeOnTrigger === true}
                                      disabled={disabled}
                                      onChange={(checked) =>
                                        updateDpsPassive(summaryRow.index, (nextPassive) => {
                                          setOptionalBooleanField(nextPassive, 'consumeChargeOnTrigger', checked);
                                          return nextPassive;
                                        })
                                      }
                                    >
                                      consumeChargeOnTrigger
                                    </Checkbox>
                                  </div>
                                </div>
                              </div>
                            );
                          })()
                        ) : null}

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

                                          <DpsPassiveOperationKindFields
                                            operation={operation}
                                            operationKind={operationKind}
                                            disabled={disabled}
                                            damageTypeOptions={damageTypeOptions}
                                            defaultDamageTypeValue={defaultDamageTypeValue}
                                            onPatch={(apply) =>
                                              updateDpsPassiveOperation(summaryRow.index, operationIndex, apply)
                                            }
                                          />

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
