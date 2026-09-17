import type { SkillParameter } from '../../../../types/skillParameter';
import { NumericValueField } from '../NumericValueField';
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space
} from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getErrorMessage } from '../../../../services/apiClient';
import { getSkillInternalState } from '../../../../services/skillInternalStateClient';
import type { SkillFormulaSummary } from '../../../../types/skillFormula';
import type {
  SkillInternalStateSummary,
  SkillInternalStateType
} from '../../../../types/skillInternalState';
import type { SkillProcessStateOperationKind } from '../../../../types/skillProcess';
import { SkillProcessMomentFields } from './SkillProcessMomentFields';
import {
  INCOMPLETE_CATALOG_MESSAGE,
  MISSING_CATALOG_LABEL,
  STATE_OPERATION_LABELS,
  allowedOperationsForStateType,
  applyStateKeyChange,
  applyStateOperationChange,
  createEmptyProcessDraft,
  isCatalogOptionSelectable,
  isProcessLevelMoment,
  listInternalStateOptions,
  listModeOptionOptions,
  requiresModeOption,
  requiresValueFormula,
  sortOperationDrafts,
  validateSkillProcessDraft,
  type ProcessCatalogLoadState,
  type ProcessFormCatalog,
  type SkillProcessStateOperationDraft,
  type SkillProcessStateOperationDraftErrors,
  type SkillProcessStepDraft
} from './processForm';
import { SKILL_INTERNAL_STATE_TYPE_LABELS as STATE_TYPE_LABELS } from './internalStateForm';

export type SkillProcessStateOperationEditorMode = 'create' | 'view' | 'edit';

type SkillProcessStateOperationEditorModalProps = {
  visible: boolean;
  mode: SkillProcessStateOperationEditorMode;
  operationDraft: SkillProcessStateOperationDraft;
  siblingOperations: SkillProcessStateOperationDraft[];
  operationIndex: number | null;
  steps: SkillProcessStepDraft[];
  fieldErrors: SkillProcessStateOperationDraftErrors;
  parameters: readonly SkillParameter[];
  parametersLoadState?: 'ready' | 'failed';
  formulas: ReadonlyArray<Pick<SkillFormulaSummary, 'formulaKey' | 'name'>>;
  formulasLoadState?: 'ready' | 'failed';
  internalStates: ReadonlyArray<Pick<SkillInternalStateSummary, 'stateKey' | 'name' | 'stateType'>>;
  internalStatesLoadState?: 'ready' | 'failed';
  apiBaseUrl: string;
  selectedGameId: string;
  skillKey: string;
  adminToken: string;
  onOpenParameterFormula?: () => void;
  onClose: () => void;
  onConfirm: (draft: SkillProcessStateOperationDraft) => void;
};

function titleFor(mode: SkillProcessStateOperationEditorMode): string {
  if (mode === 'create') return '新增内部状态操作';
  if (mode === 'edit') return '编辑内部状态操作';
  return '查看内部状态操作';
}

export function SkillProcessStateOperationEditorModal({
  visible,
  mode,
  operationDraft,
  siblingOperations,
  operationIndex,
  steps,
  fieldErrors,
  parameters,
  parametersLoadState,
  formulas,
  formulasLoadState,
  internalStates,
  internalStatesLoadState,
  apiBaseUrl,
  selectedGameId,
  skillKey,
  adminToken,
  onOpenParameterFormula,
  onClose,
  onConfirm
}: SkillProcessStateOperationEditorModalProps) {
  const [draft, setDraft] = useState<SkillProcessStateOperationDraft>(operationDraft);
  const [errors, setErrors] = useState<SkillProcessStateOperationDraftErrors>(fieldErrors);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [modeOptions, setModeOptions] = useState<Array<{ optionKey: string; name: string }>>([]);
  const [modeOptionsLoadState, setModeOptionsLoadState] = useState<'ready' | 'failed' | undefined>(undefined);
  const [modeOptionsError, setModeOptionsError] = useState<string | null>(null);
  const modeOptionSerial = useRef(0);
  const readOnly = mode === 'view';
  const existing = draft.originalOperation !== null;
  const selectedState = internalStates.find((item) => item.stateKey === draft.stateKey.trim());
  const selectedStateType = selectedState?.stateType;
  const needsModeOptions = selectedStateType === 'MODE';
  const allowedOperations = allowedOperationsForStateType(selectedStateType);

  useEffect(() => {
    if (!visible) {
      modeOptionSerial.current += 1;
      setModeOptions([]);
      setModeOptionsLoadState(undefined);
      setModeOptionsError(null);
      return;
    }
    setDraft(operationDraft);
    setErrors(fieldErrors);
    setSaveError(null);
  }, [fieldErrors, operationDraft, visible]);

  const loadModeOptions = useCallback(async () => {
    const serial = modeOptionSerial.current + 1;
    modeOptionSerial.current = serial;
    const token = adminToken.trim();
    const stateKey = draft.stateKey.trim();
    if (!visible || !needsModeOptions || !stateKey || !token) {
      if (!needsModeOptions) {
        setModeOptions([]);
        setModeOptionsLoadState(undefined);
        setModeOptionsError(null);
      }
      return;
    }
    try {
      const result = await getSkillInternalState(apiBaseUrl, selectedGameId, skillKey, stateKey, token);
      if (modeOptionSerial.current !== serial) return;
      if (result.data.stateType !== 'MODE') {
        setModeOptions([]);
        setModeOptionsLoadState('ready');
        setModeOptionsError(null);
        return;
      }
      setModeOptions(result.data.detail.options.map((item) => ({
        optionKey: item.optionKey,
        name: item.name
      })));
      setModeOptionsLoadState('ready');
      setModeOptionsError(null);
    } catch (error) {
      if (modeOptionSerial.current !== serial) return;
      setModeOptions([]);
      setModeOptionsLoadState('failed');
      setModeOptionsError(getErrorMessage(error));
    }
  }, [
    adminToken,
    apiBaseUrl,
    draft.stateKey,
    needsModeOptions,
    selectedGameId,
    skillKey,
    visible
  ]);

  useEffect(() => {
    void loadModeOptions();
  }, [loadModeOptions]);

  const catalog: ProcessFormCatalog = useMemo(() => ({
    formulas,
    effects: [{ effectKey: 'placeholder', name: 'placeholder' }],
    internalStates,
    modeOptionsByStateKey: draft.stateKey.trim()
      ? { [draft.stateKey.trim()]: modeOptions }
      : {}
  }), [draft.stateKey, formulas, internalStates, modeOptions]);

  const catalogLoadState: ProcessCatalogLoadState = {
    formulas: formulasLoadState,
    internalStates: internalStatesLoadState,
    modeOptions: modeOptionsLoadState
  };

  const stateOptions = listInternalStateOptions(catalog, draft.stateKey).map((option) => {
    const state = internalStates.find((item) => item.stateKey === option.key);
    const typeLabel = state ? STATE_TYPE_LABELS[state.stateType] : '';
    const name = state?.name ?? option.key;
    return {
      value: option.key,
      label: option.source === 'unknown'
        ? `${option.key}（${MISSING_CATALOG_LABEL}）`
        : (typeLabel ? `${name}（${typeLabel}）` : name),
      disabled: !isCatalogOptionSelectable(option)
    };
  });

  const patchDraft = (next: SkillProcessStateOperationDraft) => {
    setDraft(next);
    setErrors({});
    setSaveError(null);
  };

  const save = () => {
    const others = operationIndex === null
      ? siblingOperations
      : siblingOperations.filter((_, index) => index !== operationIndex);
    const prepared = [...others, draft];
    const parent = createEmptyProcessDraft();
    const validation = validateSkillProcessDraft(
      {
        ...parent,
        processKey: 'placeholder',
        name: 'placeholder',
        steps: steps.length > 0 ? steps : parent.steps,
        effectBindings: [],
        stateOperations: prepared
      },
      {
        includeProcessKey: false,
      parameters, parametersLoadState,
        catalog,
        catalogLoadState
      }
    );
    if (!validation.ok) {
      const submittedIndex = sortOperationDrafts(prepared).findIndex((item) => (
        item.operationKey.trim() === draft.operationKey.trim()
        && item.sortOrder.trim() === draft.sortOrder.trim()
      ));
      const current = validation.operationErrors.find((item) => (
        item.index === submittedIndex || (submittedIndex < 0 && item.index === prepared.length - 1)
      ));
      if (current && Object.keys(current.fieldErrors).length > 0) {
        setErrors(current.fieldErrors);
        return;
      }
    }
    onConfirm(draft);
  };

  return (
    <Modal
      title={titleFor(mode)}
      visible={visible}
      maskClosable
      onCancel={onClose}
      style={{ width: 'calc(100vw - 80px)', maxWidth: 960 }}
      footer={
        <Space>
          {!readOnly ? (
            <Button onClick={onOpenParameterFormula}>参数与公式</Button>
          ) : null}
          <Button onClick={onClose}>{readOnly ? '关闭' : '取消'}</Button>
          {!readOnly ? (
            <Button type="primary" onClick={save}>保存</Button>
          ) : null}
        </Space>
      }
    >
      <Space direction="vertical" size="medium" style={{ width: '100%' }}>
        {saveError ? <Alert type="error" content={saveError} /> : null}
        {internalStatesLoadState === 'failed' ? (
          <Alert type="error" content={INCOMPLETE_CATALOG_MESSAGE} />
        ) : null}
        {needsModeOptions && modeOptionsError ? (
          <Alert
            type="error"
            content={modeOptionsError}
            action={<Button size="mini" onClick={() => void loadModeOptions()}>重试</Button>}
          />
        ) : null}
        <Form layout="vertical">
          <Form.Item
            label="操作标识"
            required
            validateStatus={errors.operationKey ? 'error' : undefined}
            help={errors.operationKey}
          >
            <Input
              aria-label="操作标识"
              value={draft.operationKey}
              disabled={readOnly || existing}
              maxLength={64}
              onChange={(value) => patchDraft({ ...draft, operationKey: value })}
            />
          </Form.Item>
          <Form.Item
            label="操作名称"
            required
            validateStatus={errors.name ? 'error' : undefined}
            help={errors.name}
          >
            <Input
              aria-label="操作名称"
              value={draft.name}
              disabled={readOnly}
              maxLength={100}
              onChange={(value) => patchDraft({ ...draft, name: value })}
            />
          </Form.Item>
          <Form.Item
            label="内部状态"
            required
            validateStatus={errors.stateKey ? 'error' : undefined}
            help={errors.stateKey}
          >
            <Select
              aria-label="内部状态"
              value={draft.stateKey || undefined}
              disabled={readOnly}
              options={stateOptions}
              placeholder="请选择内部状态"
              onChange={(value) => {
                const nextKey = String(value ?? '');
                const nextType = internalStates.find((item) => item.stateKey === nextKey)?.stateType;
                patchDraft(applyStateKeyChange(draft, nextKey, nextType as SkillInternalStateType | undefined));
              }}
            />
          </Form.Item>
          <Form.Item
            label="操作"
            required
            validateStatus={errors.operation ? 'error' : undefined}
            help={errors.operation}
          >
            <Select
              aria-label="操作"
              value={draft.operation || undefined}
              disabled={readOnly || existing || allowedOperations.length === 0}
              options={allowedOperations.map((value) => ({
                value,
                label: STATE_OPERATION_LABELS[value]
              }))}
              placeholder="请选择操作"
              onChange={(value) => patchDraft(
                applyStateOperationChange(draft, value as SkillProcessStateOperationKind)
              )}
            />
          </Form.Item>
          {requiresValueFormula(draft.operation) ? (
            <Form.Item
              label="数值"
              required
              validateStatus={errors.value ? 'error' : undefined}
              help={errors.value}
            >
              <NumericValueField aria-label="数值"
                  value={draft.value}
                  onChange={(value) => patchDraft({ ...draft, value: value! })}
                  parameters={parameters}
                  formulas={formulas}
                  disabled={readOnly} />
            </Form.Item>
          ) : null}
          {requiresModeOption(draft.operation) ? (
            <Form.Item
              label="模式选项"
              required
              validateStatus={errors.optionKey ? 'error' : undefined}
              help={errors.optionKey}
            >
              <Select
                aria-label="模式选项"
                value={draft.optionKey || undefined}
                disabled={readOnly}
                options={listModeOptionOptions(catalog, draft.stateKey.trim(), draft.optionKey).map((option) => {
                  const named = modeOptions.find((item) => item.optionKey === option.key);
                  return {
                    value: option.key,
                    label: option.source === 'unknown'
                      ? `${option.key}（${MISSING_CATALOG_LABEL}）`
                      : (named?.name ?? option.key),
                    disabled: !isCatalogOptionSelectable(option)
                  };
                })}
                placeholder="请选择模式选项"
                onChange={(value) => patchDraft({ ...draft, optionKey: String(value ?? '') })}
              />
            </Form.Item>
          ) : null}
          <SkillProcessMomentFields
            momentType={draft.momentType}
            stepKey={draft.stepKey}
            steps={steps}
            momentError={errors.moment ?? errors.momentType}
            stepKeyError={errors.stepKey}
            disabled={readOnly}
            onMomentTypeChange={(value) => patchDraft({
              ...draft,
              momentType: value,
              stepKey: isProcessLevelMoment(value) ? '' : draft.stepKey
            })}
            onStepKeyChange={(value) => patchDraft({ ...draft, stepKey: value })}
          />
          <Form.Item
            label="排序"
            required
            validateStatus={errors.sortOrder ? 'error' : undefined}
            help={errors.sortOrder}
          >
            <InputNumber
              aria-label="排序"
              value={draft.sortOrder.trim() ? Number(draft.sortOrder) : undefined}
              disabled={readOnly}
              min={0}
              precision={0}
              style={{ width: '100%' }}
              onChange={(value) => patchDraft({ ...draft, sortOrder: value === undefined ? '' : String(value) })}
            />
          </Form.Item>
        </Form>
      </Space>
    </Modal>
  );
}
