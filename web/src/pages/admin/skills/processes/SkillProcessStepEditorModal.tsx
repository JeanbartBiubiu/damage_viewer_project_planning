import type { SkillParameter } from '../../../../types/skillParameter';
import { NumericValueField } from '../NumericValueField';
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Switch
} from '@arco-design/web-react';
import { useEffect, useMemo, useState } from 'react';
import type { SkillFormulaSummary } from '../../../../types/skillFormula';
import type {
  SkillProcessEmpoweredConsumeMoment,
  SkillProcessFirstExecution,
  SkillProcessStepType
} from '../../../../types/skillProcess';
import {
  EMPOWERED_CONSUME_MOMENT_LABELS,
  FIRST_EXECUTION_LABELS,
  INCOMPLETE_CATALOG_MESSAGE,
  MILLISECOND_FORMULA_HINT,
  POSITIVE_INTEGER_FORMULA_HINT,
  SKILL_PROCESS_STEP_TYPES,
  SKILL_PROCESS_STEP_TYPE_LABELS,
  applyStepTypeChange,
  clearHiddenStepFields,
  createEmptyProcessDraft,
  sortStepDrafts,
  validateSkillProcessDraft,
  type ProcessCatalogLoadState,
  type ProcessFormCatalog,
  type SkillProcessStepDraft,
  type SkillProcessStepDraftErrors
} from './processForm';

export type SkillProcessStepEditorMode = 'create' | 'view' | 'edit';

type SkillProcessStepEditorModalProps = {
  visible: boolean;
  mode: SkillProcessStepEditorMode;
  stepDraft: SkillProcessStepDraft;
  siblingSteps: SkillProcessStepDraft[];
  stepIndex: number | null;
  fieldErrors: SkillProcessStepDraftErrors;
  parameters: readonly SkillParameter[];
  parametersLoadState?: 'ready' | 'failed';
  formulas: ReadonlyArray<Pick<SkillFormulaSummary, 'formulaKey' | 'name'>>;
  formulasLoadState?: 'ready' | 'failed';
  onOpenParameterFormula?: () => void;
  onClose: () => void;
  onConfirm: (draft: SkillProcessStepDraft) => void;
};

function titleFor(mode: SkillProcessStepEditorMode): string {
  if (mode === 'create') return '新增步骤';
  if (mode === 'edit') return '编辑步骤';
  return '查看步骤';
}

export function SkillProcessStepEditorModal({
  visible,
  mode,
  stepDraft,
  siblingSteps,
  stepIndex,
  fieldErrors,
  parameters,
  parametersLoadState,
  formulas,
  formulasLoadState,
  onOpenParameterFormula,
  onClose,
  onConfirm
}: SkillProcessStepEditorModalProps) {
  const [draft, setDraft] = useState<SkillProcessStepDraft>(stepDraft);
  const [errors, setErrors] = useState<SkillProcessStepDraftErrors>(fieldErrors);
  const [saveError, setSaveError] = useState<string | null>(null);
  const readOnly = mode === 'view';
  const existing = draft.originalStepType !== null;

  useEffect(() => {
    if (!visible) return;
    setDraft(stepDraft);
    setErrors(fieldErrors);
    setSaveError(null);
  }, [fieldErrors, stepDraft, visible]);

  const catalog: ProcessFormCatalog = useMemo(() => ({
    formulas,
    effects: [],
    internalStates: [],
    modeOptionsByStateKey: {}
  }), [formulas]);

  const catalogLoadState: ProcessCatalogLoadState = {
    formulas: formulasLoadState
  };

  const patchDraft = (next: SkillProcessStepDraft) => {
    setDraft(next);
    setErrors({});
    setSaveError(null);
  };

  const save = () => {
    const others = stepIndex === null
      ? siblingSteps
      : siblingSteps.filter((_, index) => index !== stepIndex);
    const preparedSteps = [...others, draft];
    const parent = createEmptyProcessDraft();
    const validation = validateSkillProcessDraft(
      {
        ...parent,
        processKey: 'placeholder',
        name: 'placeholder',
        steps: preparedSteps,
        effectBindings: [{
          bindingKey: 'placeholder',
          effectKey: 'placeholder',
          momentType: 'PROCESS_START',
          stepKey: '',
          sortOrder: '0',
          originalBindingKey: null
        }]
      },
      {
        includeProcessKey: false,
      parameters, parametersLoadState,
        catalog: {
          ...catalog,
          effects: [{ effectKey: 'placeholder', name: 'placeholder' }]
        },
        catalogLoadState
      }
    );
    if (!validation.ok) {
      const submittedIndex = sortStepDrafts(preparedSteps.map(clearHiddenStepFields))
        .findIndex((item) => (
          item.stepKey.trim() === draft.stepKey.trim()
          && item.sortOrder.trim() === draft.sortOrder.trim()
        ));
      const current = validation.stepErrors.find((item) => (
        item.index === submittedIndex || (submittedIndex < 0 && item.index === preparedSteps.length - 1)
      ));
      if (current && Object.keys(current.fieldErrors).length > 0) {
        setErrors(current.fieldErrors);
        return;
      }
      if (validation.fieldErrors.steps) {
        setSaveError(validation.fieldErrors.steps);
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
        {formulasLoadState === 'failed' ? (
          <Alert type="error" content={INCOMPLETE_CATALOG_MESSAGE} />
        ) : null}
        <Form layout="vertical">
          <Form.Item
            label="步骤标识"
            required
            validateStatus={errors.stepKey ? 'error' : undefined}
            help={errors.stepKey}
          >
            <Input
              aria-label="步骤标识"
              value={draft.stepKey}
              disabled={readOnly || existing}
              maxLength={64}
              onChange={(value) => patchDraft({ ...draft, stepKey: value })}
            />
          </Form.Item>
          <Form.Item
            label="步骤名称"
            required
            validateStatus={errors.name ? 'error' : undefined}
            help={errors.name}
          >
            <Input
              aria-label="步骤名称"
              value={draft.name}
              disabled={readOnly}
              maxLength={100}
              onChange={(value) => patchDraft({ ...draft, name: value })}
            />
          </Form.Item>
          <Form.Item
            label="步骤种类"
            required
            validateStatus={errors.stepType ? 'error' : undefined}
            help={errors.stepType}
          >
            <Select
              aria-label="步骤种类"
              value={draft.stepType}
              disabled={readOnly || existing}
              options={SKILL_PROCESS_STEP_TYPES.map((value) => ({
                value,
                label: SKILL_PROCESS_STEP_TYPE_LABELS[value]
              }))}
              onChange={(value) => patchDraft(applyStepTypeChange(draft, value as SkillProcessStepType))}
            />
          </Form.Item>
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
          <Form.Item
            label="说明"
            validateStatus={errors.description ? 'error' : undefined}
            help={errors.description}
          >
            <Input.TextArea
              aria-label="说明"
              value={draft.description}
              disabled={readOnly}
              maxLength={2000}
              showWordLimit
              autoSize={{ minRows: 3, maxRows: 6 }}
              onChange={(value) => patchDraft({ ...draft, description: value })}
            />
          </Form.Item>

          {draft.stepType === 'DELAY' ? (
            <Form.Item
              label="延迟取值"
              required
              extra={MILLISECOND_FORMULA_HINT}
              validateStatus={errors.delayValue ? 'error' : undefined}
              help={errors.delayValue}
            >
              <NumericValueField aria-label="延迟取值"
                  value={draft.delayValue}
                  onChange={(value) => patchDraft({ ...draft, delayValue: value! })}
                  parameters={parameters}
                  formulas={formulas}
                  disabled={readOnly} />
            </Form.Item>
          ) : null}

          {draft.stepType === 'MULTI_HIT' || draft.stepType === 'PERIODIC' ? (
            <Form.Item
              label="执行次数取值"
              required
              extra={POSITIVE_INTEGER_FORMULA_HINT}
              validateStatus={errors.repeatCountValue ? 'error' : undefined}
              help={errors.repeatCountValue}
            >
              <NumericValueField aria-label="执行次数取值"
                  value={draft.repeatCountValue}
                  onChange={(value) => patchDraft({ ...draft, repeatCountValue: value! })}
                  parameters={parameters}
                  formulas={formulas}
                  disabled={readOnly} />
            </Form.Item>
          ) : null}

          {draft.stepType === 'MULTI_HIT' ? (
            <Form.Item
              label="间隔取值"
              extra={MILLISECOND_FORMULA_HINT}
              validateStatus={errors.intervalValue ? 'error' : undefined}
              help={errors.intervalValue}
            >
              <NumericValueField aria-label="间隔取值"
                  value={draft.intervalValue}
                  onChange={(value) => patchDraft({ ...draft, intervalValue: value! })}
                  parameters={parameters}
                  formulas={formulas}
                  disabled={readOnly}
                  allowClear />
            </Form.Item>
          ) : null}

          {draft.stepType === 'PERIODIC' ? (
            <Form.Item
              label="间隔取值"
              required
              extra={MILLISECOND_FORMULA_HINT}
              validateStatus={errors.intervalValue ? 'error' : undefined}
              help={errors.intervalValue}
            >
              <NumericValueField aria-label="间隔取值"
                  value={draft.intervalValue}
                  onChange={(value) => patchDraft({ ...draft, intervalValue: value! })}
                  parameters={parameters}
                  formulas={formulas}
                  disabled={readOnly} />
            </Form.Item>
          ) : null}

          {draft.stepType === 'CHANNEL' ? (
            <>
              <Form.Item
                label="持续时间取值"
                required
                extra={MILLISECOND_FORMULA_HINT}
                validateStatus={errors.durationValue ? 'error' : undefined}
                help={errors.durationValue}
              >
                <NumericValueField aria-label="持续时间取值"
                  value={draft.durationValue}
                  onChange={(value) => patchDraft({ ...draft, durationValue: value! })}
                  parameters={parameters}
                  formulas={formulas}
                  disabled={readOnly} />
              </Form.Item>
              <Form.Item
                label="执行次数取值"
                required
                extra={POSITIVE_INTEGER_FORMULA_HINT}
                validateStatus={errors.executionCountValue ? 'error' : undefined}
                help={errors.executionCountValue}
              >
                <NumericValueField aria-label="执行次数取值"
                  value={draft.executionCountValue}
                  onChange={(value) => patchDraft({ ...draft, executionCountValue: value! })}
                  parameters={parameters}
                  formulas={formulas}
                  disabled={readOnly} />
              </Form.Item>
            </>
          ) : null}

          {draft.stepType === 'PERIODIC' || draft.stepType === 'CHANNEL' ? (
            <Form.Item
              label="首次执行时机"
              required
              validateStatus={errors.firstExecution ? 'error' : undefined}
              help={errors.firstExecution}
            >
              <Radio.Group
                aria-label="首次执行时机"
                value={draft.firstExecution}
                disabled={readOnly}
                onChange={(value) => patchDraft({ ...draft, firstExecution: value as SkillProcessFirstExecution })}
              >
                <Radio value="IMMEDIATE">{FIRST_EXECUTION_LABELS.IMMEDIATE}</Radio>
                <Radio value="AFTER_INTERVAL">{FIRST_EXECUTION_LABELS.AFTER_INTERVAL}</Radio>
              </Radio.Group>
            </Form.Item>
          ) : null}

          {draft.stepType === 'CHARGE' ? (
            <>
              <Form.Item
                label="最短蓄力取值"
                required
                extra={MILLISECOND_FORMULA_HINT}
                validateStatus={errors.minimumChargeValue ? 'error' : undefined}
                help={errors.minimumChargeValue}
              >
                <NumericValueField aria-label="最短蓄力取值"
                  value={draft.minimumChargeValue}
                  onChange={(value) => patchDraft({ ...draft, minimumChargeValue: value! })}
                  parameters={parameters}
                  formulas={formulas}
                  disabled={readOnly} />
              </Form.Item>
              <Form.Item
                label="最长蓄力取值"
                required
                extra={MILLISECOND_FORMULA_HINT}
                validateStatus={errors.maximumChargeValue ? 'error' : undefined}
                help={errors.maximumChargeValue}
              >
                <NumericValueField aria-label="最长蓄力取值"
                  value={draft.maximumChargeValue}
                  onChange={(value) => patchDraft({ ...draft, maximumChargeValue: value! })}
                  parameters={parameters}
                  formulas={formulas}
                  disabled={readOnly} />
              </Form.Item>
              <Form.Item
                label="到达最长时间是否自动释放"
                validateStatus={errors.releaseAtMaximum ? 'error' : undefined}
                help={errors.releaseAtMaximum}
              >
                <Switch
                  aria-label="到达最长时间是否自动释放"
                  checked={draft.releaseAtMaximum}
                  disabled={readOnly}
                  onChange={(value) => patchDraft({ ...draft, releaseAtMaximum: value })}
                />
              </Form.Item>
            </>
          ) : null}

          {draft.stepType === 'RECAST' ? (
            <>
              <Form.Item
                label="重施窗口取值"
                required
                extra={MILLISECOND_FORMULA_HINT}
                validateStatus={errors.windowValue ? 'error' : undefined}
                help={errors.windowValue}
              >
                <NumericValueField aria-label="重施窗口取值"
                  value={draft.windowValue}
                  onChange={(value) => patchDraft({ ...draft, windowValue: value! })}
                  parameters={parameters}
                  formulas={formulas}
                  disabled={readOnly} />
              </Form.Item>
              <Form.Item
                label="最大重施次数取值"
                required
                extra={POSITIVE_INTEGER_FORMULA_HINT}
                validateStatus={errors.maximumRecastCountValue ? 'error' : undefined}
                help={errors.maximumRecastCountValue}
              >
                <NumericValueField aria-label="最大重施次数取值"
                  value={draft.maximumRecastCountValue}
                  onChange={(value) => patchDraft({ ...draft, maximumRecastCountValue: value! })}
                  parameters={parameters}
                  formulas={formulas}
                  disabled={readOnly} />
              </Form.Item>
            </>
          ) : null}

          {draft.stepType === 'EMPOWERED_BASIC_ATTACK' ? (
            <>
              <Form.Item
                label="有效窗口取值"
                required
                extra={MILLISECOND_FORMULA_HINT}
                validateStatus={errors.windowValue ? 'error' : undefined}
                help={errors.windowValue}
              >
                <NumericValueField aria-label="有效窗口取值"
                  value={draft.windowValue}
                  onChange={(value) => patchDraft({ ...draft, windowValue: value! })}
                  parameters={parameters}
                  formulas={formulas}
                  disabled={readOnly} />
              </Form.Item>
              <Form.Item
                label="消耗时点"
                required
                validateStatus={errors.consumeMoment ? 'error' : undefined}
                help={errors.consumeMoment}
              >
                <Radio.Group
                  aria-label="消耗时点"
                  value={draft.consumeMoment}
                  disabled={readOnly}
                  onChange={(value) => patchDraft({
                    ...draft,
                    consumeMoment: value as SkillProcessEmpoweredConsumeMoment
                  })}
                >
                  <Radio value="ATTACK_START">{EMPOWERED_CONSUME_MOMENT_LABELS.ATTACK_START}</Radio>
                  <Radio value="ATTACK_HIT">{EMPOWERED_CONSUME_MOMENT_LABELS.ATTACK_HIT}</Radio>
                </Radio.Group>
              </Form.Item>
            </>
          ) : null}
        </Form>
      </Space>
    </Modal>
  );
}
