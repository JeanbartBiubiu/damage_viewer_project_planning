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
import { useEffect, useMemo, useState } from 'react';
import type { SkillEffectSummary } from '../../../../types/skillEffect';
import { SkillProcessMomentFields } from './SkillProcessMomentFields';
import {
  INCOMPLETE_CATALOG_MESSAGE,
  MISSING_CATALOG_LABEL,
  createEmptyProcessDraft,
  isCatalogOptionSelectable,
  isProcessLevelMoment,
  listEffectOptions,
  sortBindingDrafts,
  validateSkillProcessDraft,
  type ProcessCatalogLoadState,
  type ProcessFormCatalog,
  type SkillProcessEffectBindingDraft,
  type SkillProcessEffectBindingDraftErrors,
  type SkillProcessStepDraft
} from './processForm';

export type SkillProcessEffectBindingEditorMode = 'create' | 'view' | 'edit';

type SkillProcessEffectBindingEditorModalProps = {
  visible: boolean;
  mode: SkillProcessEffectBindingEditorMode;
  bindingDraft: SkillProcessEffectBindingDraft;
  siblingBindings: SkillProcessEffectBindingDraft[];
  bindingIndex: number | null;
  steps: SkillProcessStepDraft[];
  fieldErrors: SkillProcessEffectBindingDraftErrors;
  effects: ReadonlyArray<Pick<SkillEffectSummary, 'effectKey' | 'name'>>;
  effectsLoadState?: 'ready' | 'failed';
  onOpenEffects?: () => void;
  onClose: () => void;
  onConfirm: (draft: SkillProcessEffectBindingDraft) => void;
};

function titleFor(mode: SkillProcessEffectBindingEditorMode): string {
  if (mode === 'create') return '新增效果挂接';
  if (mode === 'edit') return '编辑效果挂接';
  return '查看效果挂接';
}

export function SkillProcessEffectBindingEditorModal({
  visible,
  mode,
  bindingDraft,
  siblingBindings,
  bindingIndex,
  steps,
  fieldErrors,
  effects,
  effectsLoadState,
  onOpenEffects,
  onClose,
  onConfirm
}: SkillProcessEffectBindingEditorModalProps) {
  const [draft, setDraft] = useState<SkillProcessEffectBindingDraft>(bindingDraft);
  const [errors, setErrors] = useState<SkillProcessEffectBindingDraftErrors>(fieldErrors);
  const [saveError, setSaveError] = useState<string | null>(null);
  const readOnly = mode === 'view';
  const existing = draft.originalBindingKey !== null;

  useEffect(() => {
    if (!visible) return;
    setDraft(bindingDraft);
    setErrors(fieldErrors);
    setSaveError(null);
  }, [bindingDraft, fieldErrors, visible]);

  const effectNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const item of effects) names.set(item.effectKey, item.name);
    return names;
  }, [effects]);

  const catalog: ProcessFormCatalog = useMemo(() => ({
    formulas: [],
    effects,
    internalStates: [],
    modeOptionsByStateKey: {}
  }), [effects]);

  const catalogLoadState: ProcessCatalogLoadState = {
    effects: effectsLoadState
  };

  const effectOptions = listEffectOptions(catalog, draft.effectKey).map((option) => ({
    value: option.key,
    label: option.source === 'unknown'
      ? `${option.key}（${MISSING_CATALOG_LABEL}）`
      : (effectNames.get(option.key) ?? option.key),
    disabled: !isCatalogOptionSelectable(option)
  }));

  const patchDraft = (next: SkillProcessEffectBindingDraft) => {
    setDraft(next);
    setErrors({});
    setSaveError(null);
  };

  const save = () => {
    const others = bindingIndex === null
      ? siblingBindings
      : siblingBindings.filter((_, index) => index !== bindingIndex);
    const prepared = [...others, draft];
    const parent = createEmptyProcessDraft();
    const validation = validateSkillProcessDraft(
      {
        ...parent,
        processKey: 'placeholder',
        name: 'placeholder',
        steps: steps.length > 0 ? steps : parent.steps,
        effectBindings: prepared,
        stateOperations: []
      },
      {
        includeProcessKey: false,
        catalog,
        catalogLoadState
      }
    );
    if (!validation.ok) {
      const submittedIndex = sortBindingDrafts(prepared).findIndex((item) => (
        item.bindingKey.trim() === draft.bindingKey.trim()
        && item.sortOrder.trim() === draft.sortOrder.trim()
      ));
      const current = validation.bindingErrors.find((item) => (
        item.index === submittedIndex || (submittedIndex < 0 && item.index === prepared.length - 1)
      ));
      if (current && Object.keys(current.fieldErrors).length > 0) {
        setErrors(current.fieldErrors);
        return;
      }
      if (validation.fieldErrors.effectBindings && prepared.length === 0) {
        setSaveError(validation.fieldErrors.effectBindings);
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
      style={{ width: 'calc(100vw - 80px)', maxWidth: 900 }}
      footer={
        <Space>
          {!readOnly ? (
            <Button onClick={onOpenEffects}>效果与结果</Button>
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
        {effectsLoadState === 'failed' ? (
          <Alert type="error" content={INCOMPLETE_CATALOG_MESSAGE} />
        ) : null}
        <Form layout="vertical">
          <Form.Item
            label="挂接标识"
            required
            validateStatus={errors.bindingKey ? 'error' : undefined}
            help={errors.bindingKey}
          >
            <Input
              aria-label="挂接标识"
              value={draft.bindingKey}
              disabled={readOnly || existing}
              maxLength={64}
              onChange={(value) => patchDraft({ ...draft, bindingKey: value })}
            />
          </Form.Item>
          <Form.Item
            label="效果"
            required
            validateStatus={errors.effectKey ? 'error' : undefined}
            help={errors.effectKey}
          >
            <Select
              aria-label="效果"
              value={draft.effectKey || undefined}
              disabled={readOnly}
              options={effectOptions}
              placeholder="请选择效果"
              onChange={(value) => patchDraft({ ...draft, effectKey: String(value ?? '') })}
            />
          </Form.Item>
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
