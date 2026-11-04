import type { SkillParameter } from '../../../../types/skillParameter';
import { NumericValueField } from '../NumericValueField';
import { AuthoringFieldAnchor } from '../AuthoringFieldAnchor';
import { AUTHORING_UNSAVED_CONFIRM } from '../authoringFocus';
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
  SkillInternalState,
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
  applyMomentTypeChange,
  applyStateKeyChange,
  applyStateOperationChange,
  createEmptyProcessDraft,
  isCatalogOptionSelectable,
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
  internalStates: ReadonlyArray<Pick<SkillInternalStateSummary, 'skillKey' | 'stateKey' | 'name' | 'stateType'>>;
  internalStatesLoadState?: 'ready' | 'failed';
  localModeOptionsByStateKey?: { [stateKey: string]: Array<{ optionKey: string; name: string }> };
  apiBaseUrl: string;
  selectedGameId: string;
  skillKey: string;
  onOpenParameterFormula?: () => void;
  onClose: () => void;
  onConfirm: (draft: SkillProcessStateOperationDraft) => void;
  focusField?: string | null;
  locateMessage?: string | null;
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
  localModeOptionsByStateKey,
  apiBaseUrl,
  selectedGameId,
  skillKey,
  onOpenParameterFormula,
  onClose,
  onConfirm,
  focusField = null,
  locateMessage = null
}: SkillProcessStateOperationEditorModalProps) {
  const [draft, setDraft] = useState<SkillProcessStateOperationDraft>(operationDraft);
  const [errors, setErrors] = useState<SkillProcessStateOperationDraftErrors>(fieldErrors);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [modeOptions, setModeOptions] = useState<Array<{ optionKey: string; name: string }>>([]);
  const [modeOptionsLoadState, setModeOptionsLoadState] = useState<'ready' | 'failed' | undefined>(undefined);
  const [modeOptionsError, setModeOptionsError] = useState<string | null>(null);
  const [externalStateDetail, setExternalStateDetail] = useState<SkillInternalState | null>(null);
  const modeOptionSerial = useRef(0);
  const readOnly = mode === 'view';
  const existing = draft.originalOperation !== null;
  const selectedState = internalStates.find((item) => item.skillKey === skillKey
    && item.stateKey === draft.stateKey.trim());
  const externalState = Boolean(draft.stateSkillKey && draft.stateSkillKey !== skillKey);
  const resolvedExternalState = externalStateDetail?.skillKey === draft.stateSkillKey
    && externalStateDetail.stateKey === draft.stateKey.trim() ? externalStateDetail : null;
  const selectedStateType = externalState ? resolvedExternalState?.stateType : selectedState?.stateType;
  const needsModeOptions = selectedStateType === 'MODE';
  const allowedOperations = allowedOperationsForStateType(selectedStateType);

  useEffect(() => {
    if (!visible) {
      modeOptionSerial.current += 1;
      setModeOptions([]);
      setModeOptionsLoadState(undefined);
      setModeOptionsError(null);
      setExternalStateDetail(null);
      return;
    }
    setDraft(operationDraft);
    setErrors(fieldErrors);
    setSaveError(null);
  }, [fieldErrors, operationDraft, visible]);

  const loadModeOptions = useCallback(async () => {
    const serial = modeOptionSerial.current + 1;
    modeOptionSerial.current = serial;

    const stateKey = draft.stateKey.trim();
    if (!visible || !stateKey) {
      setExternalStateDetail(null);
      setModeOptions([]);
      setModeOptionsLoadState(undefined);
      setModeOptionsError(null);
      return;
    }
    if (externalState) {
      setExternalStateDetail(null);
      setModeOptions([]);
      setModeOptionsLoadState(undefined);
      setModeOptionsError(null);
      try {
        const result = await getSkillInternalState(apiBaseUrl, selectedGameId,
          draft.stateSkillKey, stateKey);
        if (modeOptionSerial.current !== serial) return;
        setExternalStateDetail(result.data);
        setModeOptions(result.data.stateType === 'MODE' ? result.data.detail.options.map((item) => ({
          optionKey: item.optionKey, name: item.name
        })) : []);
        setModeOptionsLoadState('ready');
      } catch (error) {
        if (modeOptionSerial.current !== serial) return;
        setModeOptionsLoadState('failed');
        setModeOptionsError(getErrorMessage(error));
      }
      return;
    }
    setExternalStateDetail(null);
    if (localModeOptionsByStateKey && !externalState) {
      setModeOptions(localModeOptionsByStateKey[stateKey] ?? []);
      setModeOptionsLoadState('ready');
      setModeOptionsError(null);
      return;
    }
    if (!needsModeOptions) {
      if (!needsModeOptions) {
        setModeOptions([]);
        setModeOptionsLoadState(undefined);
        setModeOptionsError(null);
      }
      return;
    }
    try {
      const result = await getSkillInternalState(apiBaseUrl, selectedGameId,
        draft.stateSkillKey || skillKey, stateKey);
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
    apiBaseUrl,
    draft.stateKey,
    selectedState?.stateType,
    selectedGameId,
    skillKey,
    draft.stateSkillKey,
    externalState,
    localModeOptionsByStateKey,
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
    if (externalState && (modeOptionsLoadState !== 'ready' || !resolvedExternalState)) {
      setSaveError(modeOptionsError || '外部内部状态详情尚未读取，不能确认操作。');
      return;
    }
    if (selectedStateType && draft.operation
      && !allowedOperations.includes(draft.operation as SkillProcessStateOperationKind)) {
      setErrors({ operation: '该内部状态不支持此操作。' });
      return;
    }
    if (externalState && draft.operation === 'SELECT'
      && !modeOptions.some((item) => item.optionKey === draft.optionKey)) {
      setErrors({ optionKey: '请选择外部模式状态中的有效选项。' });
      return;
    }
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
        skillKey,
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

  const close = () => {
    if (!readOnly && JSON.stringify(draft) !== JSON.stringify(operationDraft) && !window.confirm(AUTHORING_UNSAVED_CONFIRM)) return;
    onClose();
  };

  return (
    <Modal
      title={titleFor(mode)}
      visible={visible}
      maskClosable
      onCancel={close}
      style={{ width: 'calc(100vw - 80px)', maxWidth: 960 }}
      footer={
        <Space>
          {!readOnly && onOpenParameterFormula ? (
            <Button onClick={onOpenParameterFormula}>参数与公式</Button>
          ) : null}
          <Button onClick={close}>{readOnly ? '关闭' : '取消'}</Button>
          {!readOnly ? (
            <Button type="primary" onClick={save}>保存</Button>
          ) : null}
        </Space>
      }
    >
      <Space direction="vertical" size="medium" style={{ width: '100%' }}>
        {saveError ? <Alert type="error" content={saveError} /> : null}
        {locateMessage ? <Alert type="warning" content={locateMessage} /> : null}
        {internalStatesLoadState === 'failed' ? (
          <Alert type="error" content={INCOMPLETE_CATALOG_MESSAGE} />
        ) : null}
        {(needsModeOptions || externalState) && modeOptionsError ? (
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
            <AuthoringFieldAnchor field="operationKey" active={focusField === 'operationKey'}>
            <Input
              aria-label="操作标识"
              value={draft.operationKey}
              disabled={readOnly || existing}
              maxLength={64}
              onChange={(value) => patchDraft({ ...draft, operationKey: value })}
            />
            </AuthoringFieldAnchor>
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
            label="内部状态所属技能"
            required
            validateStatus={errors.stateSkillKey ? 'error' : undefined}
            help={errors.stateSkillKey}
          >
            <Input aria-label="内部状态所属技能" value={draft.stateSkillKey} disabled={readOnly}
              onChange={(value) => patchDraft({ ...draft, stateSkillKey: value.trim(), stateKey: '', operation: '' })} />
          </Form.Item>
          {externalState ? <Form.Item label="外部内部状态标识" required>
            <Input aria-label="外部内部状态标识" value={draft.stateKey} disabled={readOnly}
              onChange={(value) => patchDraft({ ...draft, stateKey: value.trim() })} />
          </Form.Item> : <Form.Item
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
          </Form.Item>}
          <Form.Item
            label="操作"
            required
            validateStatus={errors.operation ? 'error' : undefined}
            help={errors.operation}
          >
            <Select
              aria-label="操作"
              value={draft.operation || undefined}
              disabled={readOnly || existing || allowedOperations.length === 0
                || (externalState && modeOptionsLoadState !== 'ready')}
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
            failureReason={draft.failureReason}
            steps={steps}
            momentError={errors.moment ?? errors.momentType}
            stepKeyError={errors.stepKey}
            failureReasonError={errors.failureReason}
            disabled={readOnly}
            onMomentTypeChange={(value) => patchDraft(applyMomentTypeChange(draft, value))}
            onStepKeyChange={(value) => patchDraft({ ...draft, stepKey: value })}
            onFailureReasonChange={(value) => patchDraft({ ...draft, failureReason: value })}
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
