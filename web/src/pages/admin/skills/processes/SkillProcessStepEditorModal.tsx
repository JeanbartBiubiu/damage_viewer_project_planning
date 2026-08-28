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
  MISSING_CATALOG_LABEL,
  POSITIVE_INTEGER_FORMULA_HINT,
  SKILL_PROCESS_STEP_TYPES,
  SKILL_PROCESS_STEP_TYPE_LABELS,
  applyStepTypeChange,
  clearHiddenStepFields,
  createEmptyProcessDraft,
  isCatalogOptionSelectable,
  listFormulaOptions,
  sortStepDrafts,
  validateSkillProcessDraft,
  type CatalogRefOption,
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

function catalogLabel(option: CatalogRefOption, names: Map<string, string>): string {
  if (option.source === 'unknown') return `${option.key}（${MISSING_CATALOG_LABEL}）`;
  return names.get(option.key) ?? option.key;
}

export function SkillProcessStepEditorModal({
  visible,
  mode,
  stepDraft,
  siblingSteps,
  stepIndex,
  fieldErrors,
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

  const formulaNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const item of formulas) names.set(item.formulaKey, item.name);
    return names;
  }, [formulas]);

  const catalog: ProcessFormCatalog = useMemo(() => ({
    formulas,
    effects: [],
    internalStates: [],
    modeOptionsByStateKey: {}
  }), [formulas]);

  const catalogLoadState: ProcessCatalogLoadState = {
    formulas: formulasLoadState
  };

  const formulaSelect = (currentKey: string) => listFormulaOptions(catalog, currentKey).map((option) => ({
    value: option.key,
    label: catalogLabel(option, formulaNames),
    disabled: !isCatalogOptionSelectable(option)
  }));

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
              label="延迟公式"
              required
              extra={MILLISECOND_FORMULA_HINT}
              validateStatus={errors.delayFormulaKey ? 'error' : undefined}
              help={errors.delayFormulaKey}
            >
              <Select
                aria-label="延迟公式"
                value={draft.delayFormulaKey || undefined}
                disabled={readOnly}
                options={formulaSelect(draft.delayFormulaKey)}
                placeholder="请选择延迟公式"
                onChange={(value) => patchDraft({ ...draft, delayFormulaKey: String(value ?? '') })}
              />
            </Form.Item>
          ) : null}

          {draft.stepType === 'MULTI_HIT' || draft.stepType === 'PERIODIC' ? (
            <Form.Item
              label="执行次数公式"
              required
              extra={POSITIVE_INTEGER_FORMULA_HINT}
              validateStatus={errors.repeatCountFormulaKey ? 'error' : undefined}
              help={errors.repeatCountFormulaKey}
            >
              <Select
                aria-label="执行次数公式"
                value={draft.repeatCountFormulaKey || undefined}
                disabled={readOnly}
                options={formulaSelect(draft.repeatCountFormulaKey)}
                placeholder="请选择执行次数公式"
                onChange={(value) => patchDraft({ ...draft, repeatCountFormulaKey: String(value ?? '') })}
              />
            </Form.Item>
          ) : null}

          {draft.stepType === 'MULTI_HIT' ? (
            <Form.Item
              label="间隔公式"
              extra={MILLISECOND_FORMULA_HINT}
              validateStatus={errors.intervalFormulaKey ? 'error' : undefined}
              help={errors.intervalFormulaKey}
            >
              <Select
                aria-label="间隔公式"
                value={draft.intervalFormulaKey || undefined}
                disabled={readOnly}
                allowClear
                options={formulaSelect(draft.intervalFormulaKey)}
                placeholder="可选间隔公式"
                onChange={(value) => patchDraft({ ...draft, intervalFormulaKey: String(value ?? '') })}
              />
            </Form.Item>
          ) : null}

          {draft.stepType === 'PERIODIC' ? (
            <Form.Item
              label="间隔公式"
              required
              extra={MILLISECOND_FORMULA_HINT}
              validateStatus={errors.intervalFormulaKey ? 'error' : undefined}
              help={errors.intervalFormulaKey}
            >
              <Select
                aria-label="间隔公式"
                value={draft.intervalFormulaKey || undefined}
                disabled={readOnly}
                options={formulaSelect(draft.intervalFormulaKey)}
                placeholder="请选择间隔公式"
                onChange={(value) => patchDraft({ ...draft, intervalFormulaKey: String(value ?? '') })}
              />
            </Form.Item>
          ) : null}

          {draft.stepType === 'CHANNEL' ? (
            <>
              <Form.Item
                label="持续时间公式"
                required
                extra={MILLISECOND_FORMULA_HINT}
                validateStatus={errors.durationFormulaKey ? 'error' : undefined}
                help={errors.durationFormulaKey}
              >
                <Select
                  aria-label="持续时间公式"
                  value={draft.durationFormulaKey || undefined}
                  disabled={readOnly}
                  options={formulaSelect(draft.durationFormulaKey)}
                  placeholder="请选择持续时间公式"
                  onChange={(value) => patchDraft({ ...draft, durationFormulaKey: String(value ?? '') })}
                />
              </Form.Item>
              <Form.Item
                label="执行次数公式"
                required
                extra={POSITIVE_INTEGER_FORMULA_HINT}
                validateStatus={errors.executionCountFormulaKey ? 'error' : undefined}
                help={errors.executionCountFormulaKey}
              >
                <Select
                  aria-label="执行次数公式"
                  value={draft.executionCountFormulaKey || undefined}
                  disabled={readOnly}
                  options={formulaSelect(draft.executionCountFormulaKey)}
                  placeholder="请选择执行次数公式"
                  onChange={(value) => patchDraft({ ...draft, executionCountFormulaKey: String(value ?? '') })}
                />
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
                label="最短蓄力公式"
                required
                extra={MILLISECOND_FORMULA_HINT}
                validateStatus={errors.minimumChargeFormulaKey ? 'error' : undefined}
                help={errors.minimumChargeFormulaKey}
              >
                <Select
                  aria-label="最短蓄力公式"
                  value={draft.minimumChargeFormulaKey || undefined}
                  disabled={readOnly}
                  options={formulaSelect(draft.minimumChargeFormulaKey)}
                  placeholder="请选择最短蓄力公式"
                  onChange={(value) => patchDraft({ ...draft, minimumChargeFormulaKey: String(value ?? '') })}
                />
              </Form.Item>
              <Form.Item
                label="最长蓄力公式"
                required
                extra={MILLISECOND_FORMULA_HINT}
                validateStatus={errors.maximumChargeFormulaKey ? 'error' : undefined}
                help={errors.maximumChargeFormulaKey}
              >
                <Select
                  aria-label="最长蓄力公式"
                  value={draft.maximumChargeFormulaKey || undefined}
                  disabled={readOnly}
                  options={formulaSelect(draft.maximumChargeFormulaKey)}
                  placeholder="请选择最长蓄力公式"
                  onChange={(value) => patchDraft({ ...draft, maximumChargeFormulaKey: String(value ?? '') })}
                />
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
                label="重施窗口公式"
                required
                extra={MILLISECOND_FORMULA_HINT}
                validateStatus={errors.windowFormulaKey ? 'error' : undefined}
                help={errors.windowFormulaKey}
              >
                <Select
                  aria-label="重施窗口公式"
                  value={draft.windowFormulaKey || undefined}
                  disabled={readOnly}
                  options={formulaSelect(draft.windowFormulaKey)}
                  placeholder="请选择重施窗口公式"
                  onChange={(value) => patchDraft({ ...draft, windowFormulaKey: String(value ?? '') })}
                />
              </Form.Item>
              <Form.Item
                label="最大重施次数公式"
                required
                extra={POSITIVE_INTEGER_FORMULA_HINT}
                validateStatus={errors.maximumRecastCountFormulaKey ? 'error' : undefined}
                help={errors.maximumRecastCountFormulaKey}
              >
                <Select
                  aria-label="最大重施次数公式"
                  value={draft.maximumRecastCountFormulaKey || undefined}
                  disabled={readOnly}
                  options={formulaSelect(draft.maximumRecastCountFormulaKey)}
                  placeholder="请选择最大重施次数公式"
                  onChange={(value) => patchDraft({ ...draft, maximumRecastCountFormulaKey: String(value ?? '') })}
                />
              </Form.Item>
            </>
          ) : null}

          {draft.stepType === 'EMPOWERED_BASIC_ATTACK' ? (
            <>
              <Form.Item
                label="有效窗口公式"
                required
                extra={MILLISECOND_FORMULA_HINT}
                validateStatus={errors.windowFormulaKey ? 'error' : undefined}
                help={errors.windowFormulaKey}
              >
                <Select
                  aria-label="有效窗口公式"
                  value={draft.windowFormulaKey || undefined}
                  disabled={readOnly}
                  options={formulaSelect(draft.windowFormulaKey)}
                  placeholder="请选择有效窗口公式"
                  onChange={(value) => patchDraft({ ...draft, windowFormulaKey: String(value ?? '') })}
                />
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
