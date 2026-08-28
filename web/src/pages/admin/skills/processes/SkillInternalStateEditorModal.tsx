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
  Switch,
  Table,
  Typography
} from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiRequestError, getErrorMessage } from '../../../../services/apiClient';
import { listSkillFormulas } from '../../../../services/skillFormulaClient';
import {
  createSkillInternalState,
  getSkillInternalState,
  updateSkillInternalState
} from '../../../../services/skillInternalStateClient';
import type { Skill } from '../../../../types/skill';
import type { SkillFormulaSummary } from '../../../../types/skillFormula';
import type {
  SkillInternalState,
  SkillInternalStateAmmoRecoveryMode,
  SkillInternalStateScope,
  SkillInternalStateSummary,
  SkillInternalStateType
} from '../../../../types/skillInternalState';
import {
  AMMO_RECOVERY_MODE_LABELS,
  MILLISECOND_FORMULA_HINT,
  MISSING_CATALOG_LABEL,
  SKILL_INTERNAL_STATE_SCOPE_LABELS,
  SKILL_INTERNAL_STATE_TYPES,
  SKILL_INTERNAL_STATE_TYPE_LABELS,
  allowsTargetScope,
  applyStateTypeChange,
  buildCreateSkillInternalStateRequest,
  buildUpdateSkillInternalStateRequest,
  createEmptyInternalStateDraft,
  createEmptyModeOptionDraft,
  isCatalogOptionSelectable,
  listFormulaOptions,
  mapSkillInternalStateFieldIssues,
  requiresFormulaCatalog,
  skillInternalStateToDraft,
  sortModeOptionDrafts,
  validateSkillInternalStateDraft,
  type CatalogRefOption,
  type SkillInternalStateDraft,
  type SkillInternalStateDraftErrors,
  type SkillInternalStateModeOptionDraft,
  type SkillInternalStateOptionDraftErrors,
  type SkillInternalStateOptionIndexError
} from './internalStateForm';

export type SkillInternalStateEditorMode = 'create' | 'view' | 'edit';

type SkillInternalStateEditorModalProps = {
  visible: boolean;
  mode: SkillInternalStateEditorMode;
  skill: Skill;
  internalState: SkillInternalStateSummary | null;
  apiBaseUrl: string;
  selectedGameId: string;
  adminToken: string;
  onClose: () => void;
  onSaved: (state: SkillInternalState) => void | Promise<void>;
  onSkillMissing: () => void;
  onDirtyChange: (dirty: boolean) => void;
  catalogRevision: number;
  onOpenParameterFormula?: () => void;
};

function titleFor(mode: SkillInternalStateEditorMode): string {
  if (mode === 'create') return '新增内部状态';
  if (mode === 'edit') return '编辑内部状态';
  return '查看内部状态';
}

function composeSaveError(error: unknown, unmappedMessages: string[]): string {
  const general = getErrorMessage(error);
  const extra = unmappedMessages.filter((item) => item && item !== general);
  return extra.length > 0 ? [general, ...extra].join('；') : general;
}

function isSkillNotFound(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === '404.SKILL_NOT_FOUND';
}

function catalogLabel(option: CatalogRefOption, names: Map<string, string>): string {
  if (option.source === 'unknown') {
    return `${option.key}（${MISSING_CATALOG_LABEL}）`;
  }
  return names.get(option.key) ?? option.key;
}

function optionErrorSummary(errors: SkillInternalStateOptionDraftErrors | undefined): string | null {
  if (!errors) return null;
  const messages = Object.values(errors).filter((item): item is string => Boolean(item));
  return messages.length > 0 ? messages.join('；') : null;
}

export function SkillInternalStateEditorModal({
  visible,
  mode,
  skill,
  internalState,
  apiBaseUrl,
  selectedGameId,
  adminToken,
  onClose,
  onSaved,
  onSkillMissing,
  onDirtyChange,
  catalogRevision,
  onOpenParameterFormula
}: SkillInternalStateEditorModalProps) {
  const [draft, setDraft] = useState<SkillInternalStateDraft>(createEmptyInternalStateDraft());
  const [baseline, setBaseline] = useState<SkillInternalStateDraft>(createEmptyInternalStateDraft());
  const [errors, setErrors] = useState<SkillInternalStateDraftErrors>({});
  const [optionErrors, setOptionErrors] = useState<SkillInternalStateOptionIndexError[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formulasError, setFormulasError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailReady, setDetailReady] = useState(mode === 'create');
  const [formulas, setFormulas] = useState<SkillFormulaSummary[]>([]);
  const [formulasLoadState, setFormulasLoadState] = useState<'ready' | 'failed' | undefined>(undefined);
  const detailSerial = useRef(0);
  const formulaSerial = useRef(0);
  const readOnly = mode === 'view';
  const existing = draft.originalStateType !== null;
  const closeBlocked = saving || (mode === 'edit' && loadingDetail);
  const needsFormulas = requiresFormulaCatalog(draft.stateType);

  const reportDirty = useCallback((next: SkillInternalStateDraft, currentBaseline: SkillInternalStateDraft) => {
    onDirtyChange(JSON.stringify(next) !== JSON.stringify(currentBaseline));
  }, [onDirtyChange]);

  const resetLocalState = useCallback(() => {
    detailSerial.current += 1;
    formulaSerial.current += 1;
    const empty = createEmptyInternalStateDraft();
    setDraft(empty);
    setBaseline(empty);
    setErrors({});
    setOptionErrors([]);
    setSaveError(null);
    setLoadError(null);
    setFormulasError(null);
    setSaving(false);
    setLoadingDetail(false);
    setDetailReady(mode === 'create');
    setFormulas([]);
    setFormulasLoadState(undefined);
  }, [mode]);

  const loadFormulas = useCallback(async () => {
    const serial = formulaSerial.current + 1;
    formulaSerial.current = serial;
    const token = adminToken.trim();
    if (!visible || !token || !needsFormulas) {
      if (!needsFormulas) {
        setFormulasError(null);
      }
      return;
    }
    try {
      const result = await listSkillFormulas(apiBaseUrl, selectedGameId, skill.skillKey, token);
      if (formulaSerial.current !== serial) return;
      setFormulas(result.data);
      setFormulasLoadState('ready');
      setFormulasError(null);
    } catch (error) {
      if (formulaSerial.current !== serial) return;
      if (isSkillNotFound(error)) {
        onSkillMissing();
        return;
      }
      setFormulas([]);
      setFormulasLoadState('failed');
      setFormulasError(getErrorMessage(error));
    }
  }, [adminToken, apiBaseUrl, needsFormulas, onSkillMissing, selectedGameId, skill.skillKey, visible]);

  const loadDetail = useCallback(async () => {
    const serial = detailSerial.current + 1;
    detailSerial.current = serial;
    if (!visible) {
      setLoadingDetail(false);
      return;
    }
    if (mode === 'create') {
      const empty = createEmptyInternalStateDraft();
      setDraft(empty);
      setBaseline(empty);
      setDetailReady(true);
      setLoadingDetail(false);
      setLoadError(null);
      onDirtyChange(false);
      return;
    }
    const token = adminToken.trim();
    if (!token) {
      setLoadError('请先配置 Admin Token。');
      setDetailReady(false);
      setLoadingDetail(false);
      return;
    }
    if (!internalState) {
      setLoadError('内部状态详情加载失败。');
      setDetailReady(false);
      setLoadingDetail(false);
      return;
    }
    setLoadingDetail(true);
    setLoadError(null);
    try {
      const result = await getSkillInternalState(
        apiBaseUrl,
        selectedGameId,
        skill.skillKey,
        internalState.stateKey,
        token
      );
      if (detailSerial.current !== serial) return;
      const next = skillInternalStateToDraft(result.data);
      setDraft(next);
      setBaseline(next);
      setDetailReady(true);
      onDirtyChange(false);
    } catch (error) {
      if (detailSerial.current !== serial) return;
      if (isSkillNotFound(error)) {
        onSkillMissing();
        return;
      }
      setDetailReady(false);
      setLoadError(getErrorMessage(error));
    } finally {
      if (detailSerial.current === serial) setLoadingDetail(false);
    }
  }, [
    adminToken,
    apiBaseUrl,
    internalState,
    mode,
    onDirtyChange,
    onSkillMissing,
    selectedGameId,
    skill.skillKey,
    visible
  ]);

  useEffect(() => {
    if (!visible) {
      resetLocalState();
      onDirtyChange(false);
      return;
    }
    setErrors({});
    setOptionErrors([]);
    setSaveError(null);
    setSaving(false);
    void loadDetail();
  }, [loadDetail, onDirtyChange, resetLocalState, visible]);

  useEffect(() => {
    if (!visible) return;
    void loadFormulas();
  }, [loadFormulas, visible]);

  const catalogRevisionRef = useRef(catalogRevision);
  useEffect(() => {
    const previous = catalogRevisionRef.current;
    catalogRevisionRef.current = catalogRevision;
    if (!visible || previous === catalogRevision) {
      return;
    }
    void loadFormulas();
  }, [catalogRevision, loadFormulas, visible]);

  const patchDraft = (next: SkillInternalStateDraft) => {
    setDraft(next);
    setErrors({});
    setOptionErrors([]);
    setSaveError(null);
    reportDirty(next, baseline);
  };

  const close = () => {
    if (closeBlocked) return;
    onDirtyChange(false);
    onClose();
  };

  const save = async () => {
    if (readOnly || saving || !detailReady || (mode === 'edit' && loadingDetail)) return;
    const sorted = {
      ...draft,
      options: sortModeOptionDrafts(draft.options)
    };
    const validation = validateSkillInternalStateDraft(sorted, {
      includeStateKey: mode === 'create',
      catalog: { formulas },
      catalogLoadState: formulasLoadState === 'failed' ? { formulas: 'failed' } : undefined
    });
    if (!validation.ok) {
      setDraft(sorted);
      setErrors(validation.fieldErrors);
      setOptionErrors(validation.optionErrors);
      return;
    }
    const token = adminToken.trim();
    if (!token) {
      setSaveError('请先配置 Admin Token。');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const result = mode === 'create'
        ? await createSkillInternalState(
            apiBaseUrl,
            selectedGameId,
            skill.skillKey,
            token,
            buildCreateSkillInternalStateRequest(validation.normalized)
          )
        : await updateSkillInternalState(
            apiBaseUrl,
            selectedGameId,
            skill.skillKey,
            internalState!.stateKey,
            token,
            buildUpdateSkillInternalStateRequest(validation.normalized)
          );
      onDirtyChange(false);
      await onSaved(result.data);
    } catch (error) {
      if (isSkillNotFound(error)) {
        onSkillMissing();
        return;
      }
      const mapped = mapSkillInternalStateFieldIssues(error);
      setDraft(sorted);
      setErrors(mapped.fieldErrors);
      setOptionErrors(mapped.optionErrors);
      setSaveError(composeSaveError(error, mapped.unmappedMessages));
    } finally {
      setSaving(false);
    }
  };

  const formulaNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const item of formulas) names.set(item.formulaKey, item.name);
    return names;
  }, [formulas]);

  const formulaSelectOptions = (currentKey: string) => listFormulaOptions(
    { formulas },
    currentKey
  ).map((option) => ({
    value: option.key,
    label: catalogLabel(option, formulaNames),
    disabled: !isCatalogOptionSelectable(option)
  }));

  const optionErrorMap = useMemo(() => {
    const map = new Map<number, SkillInternalStateOptionDraftErrors>();
    for (const item of optionErrors) map.set(item.index, item.fieldErrors);
    return map;
  }, [optionErrors]);

  const replaceOptions = (options: SkillInternalStateModeOptionDraft[]) => {
    patchDraft({ ...draft, options });
  };

  const displayedOptions = draft.options.map((item, index) => ({ item, index }));

  const optionColumns: TableColumnProps[] = [
    {
      title: '选项标识',
      render: (_value, row: { item: SkillInternalStateModeOptionDraft; index: number }) => (
        <Input
          aria-label={`选项标识 ${row.index + 1}`}
          value={row.item.optionKey}
          disabled={readOnly || row.item.originalOptionKey !== null || saving}
          maxLength={64}
          onChange={(value) => replaceOptions(draft.options.map((item, itemIndex) => (
            itemIndex === row.index ? { ...item, optionKey: value } : item
          )))}
        />
      )
    },
    {
      title: '名称',
      render: (_value, row: { item: SkillInternalStateModeOptionDraft; index: number }) => (
        <Input
          aria-label={`选项名称 ${row.index + 1}`}
          value={row.item.name}
          disabled={readOnly || saving}
          maxLength={100}
          onChange={(value) => replaceOptions(draft.options.map((item, itemIndex) => (
            itemIndex === row.index ? { ...item, name: value } : item
          )))}
        />
      )
    },
    {
      title: '排序',
      width: 110,
      render: (_value, row: { item: SkillInternalStateModeOptionDraft; index: number }) => (
        <InputNumber
          aria-label={`选项排序 ${row.index + 1}`}
          value={row.item.sortOrder.trim() ? Number(row.item.sortOrder) : undefined}
          disabled={readOnly || saving}
          min={0}
          precision={0}
          onChange={(value) => replaceOptions(draft.options.map((item, itemIndex) => (
            itemIndex === row.index ? { ...item, sortOrder: value === undefined ? '' : String(value) } : item
          )))}
        />
      )
    },
    {
      title: '初始',
      width: 80,
      render: (_value, row: { item: SkillInternalStateModeOptionDraft; index: number }) => (
        <Radio
          aria-label={`初始选项 ${row.index + 1}`}
          checked={row.item.initial}
          disabled={readOnly || saving}
          onChange={() => {
            replaceOptions(draft.options.map((item, itemIndex) => ({
              ...item,
              initial: itemIndex === row.index
            })));
          }}
        />
      )
    },
    {
      title: '操作',
      width: 90,
      render: (_value, row: { item: SkillInternalStateModeOptionDraft; index: number }) => (
        <div>
          {!readOnly ? (
            <Button
              size="mini"
              status="danger"
              disabled={saving}
              onClick={() => replaceOptions(draft.options.filter((_, itemIndex) => itemIndex !== row.index))}
            >
              删除
            </Button>
          ) : null}
          {optionErrorSummary(optionErrorMap.get(row.index)) ? (
            <Typography.Text type="error" style={{ display: 'block' }}>
              {optionErrorSummary(optionErrorMap.get(row.index))}
            </Typography.Text>
          ) : null}
        </div>
      )
    }
  ];

  return (
    <Modal
      title={titleFor(mode)}
      visible={visible}
      maskClosable
      onCancel={close}
      style={{ width: 'calc(100vw - 80px)', maxWidth: 1200 }}
      footer={
        <Space>
          {!readOnly ? (
            <Button onClick={onOpenParameterFormula}>参数与公式</Button>
          ) : null}
          <Button onClick={close} disabled={closeBlocked}>{readOnly ? '关闭' : '取消'}</Button>
          {!readOnly ? (
            <Button
              type="primary"
              loading={saving || (mode === 'edit' && loadingDetail)}
              disabled={!detailReady}
              onClick={() => void save()}
            >
              保存
            </Button>
          ) : null}
        </Space>
      }
    >
      <Space direction="vertical" size="medium" style={{ width: '100%' }}>
        {saveError ? <Alert type="error" content={saveError} /> : null}
        {loadError ? (
          <Alert
            type="error"
            content={loadError}
            action={
              <Button size="mini" loading={loadingDetail} onClick={() => void loadDetail()}>
                重试
              </Button>
            }
          />
        ) : null}
        {needsFormulas && formulasError ? (
          <Alert
            type="error"
            content={formulasError}
            action={
              <Button size="mini" onClick={() => void loadFormulas()}>重试</Button>
            }
          />
        ) : null}
        <Form layout="vertical">
          <Form.Item
            label="内部状态标识"
            required
            validateStatus={errors.stateKey ? 'error' : undefined}
            help={errors.stateKey}
          >
            <Input
              aria-label="内部状态标识"
              value={draft.stateKey}
              disabled={readOnly || mode !== 'create' || saving}
              maxLength={64}
              onChange={(value) => patchDraft({ ...draft, stateKey: value })}
            />
          </Form.Item>
          <Form.Item
            label="内部状态名称"
            required
            validateStatus={errors.name ? 'error' : undefined}
            help={errors.name}
          >
            <Input
              aria-label="内部状态名称"
              value={draft.name}
              disabled={readOnly || saving}
              maxLength={100}
              onChange={(value) => patchDraft({ ...draft, name: value })}
            />
          </Form.Item>
          <Form.Item
            label="状态种类"
            required
            validateStatus={errors.stateType ? 'error' : undefined}
            help={errors.stateType}
          >
            <Select
              aria-label="状态种类"
              value={draft.stateType}
              disabled={readOnly || existing || saving}
              options={SKILL_INTERNAL_STATE_TYPES.map((value) => ({
                value,
                label: SKILL_INTERNAL_STATE_TYPE_LABELS[value]
              }))}
              onChange={(value) => patchDraft(applyStateTypeChange(draft, value as SkillInternalStateType))}
            />
          </Form.Item>
          <Form.Item
            label="保存范围"
            required
            validateStatus={errors.scope ? 'error' : undefined}
            help={errors.scope}
          >
            <Radio.Group
              aria-label="保存范围"
              value={draft.scope}
              disabled={readOnly || existing || saving || !allowsTargetScope(draft.stateType)}
              onChange={(value) => patchDraft({ ...draft, scope: value as SkillInternalStateScope })}
            >
              <Radio value="SKILL">{SKILL_INTERNAL_STATE_SCOPE_LABELS.SKILL}</Radio>
              {allowsTargetScope(draft.stateType) ? (
                <Radio value="TARGET">{SKILL_INTERNAL_STATE_SCOPE_LABELS.TARGET}</Radio>
              ) : null}
            </Radio.Group>
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
              disabled={readOnly || saving}
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
              disabled={readOnly || saving}
              maxLength={2000}
              showWordLimit
              autoSize={{ minRows: 3, maxRows: 8 }}
              onChange={(value) => patchDraft({ ...draft, description: value })}
            />
          </Form.Item>

          {draft.stateType === 'COUNTER' || draft.stateType === 'AMMO' ? (
            <>
              <Form.Item
                label="初始值公式"
                required
                validateStatus={errors.initialValueFormulaKey ? 'error' : undefined}
                help={errors.initialValueFormulaKey}
              >
                <Select
                  aria-label="初始值公式"
                  value={draft.initialValueFormulaKey || undefined}
                  disabled={readOnly || saving}
                  options={formulaSelectOptions(draft.initialValueFormulaKey)}
                  placeholder="请选择初始值公式"
                  onChange={(value) => patchDraft({ ...draft, initialValueFormulaKey: String(value ?? '') })}
                />
              </Form.Item>
              <Form.Item
                label="上限公式"
                required
                validateStatus={errors.maxValueFormulaKey ? 'error' : undefined}
                help={errors.maxValueFormulaKey}
              >
                <Select
                  aria-label="上限公式"
                  value={draft.maxValueFormulaKey || undefined}
                  disabled={readOnly || saving}
                  options={formulaSelectOptions(draft.maxValueFormulaKey)}
                  placeholder="请选择上限公式"
                  onChange={(value) => patchDraft({ ...draft, maxValueFormulaKey: String(value ?? '') })}
                />
              </Form.Item>
            </>
          ) : null}

          {draft.stateType === 'AMMO' ? (
            <>
              <Form.Item
                label="恢复间隔公式"
                required
                extra={MILLISECOND_FORMULA_HINT}
                validateStatus={errors.recoveryIntervalFormulaKey ? 'error' : undefined}
                help={errors.recoveryIntervalFormulaKey}
              >
                <Select
                  aria-label="恢复间隔公式"
                  value={draft.recoveryIntervalFormulaKey || undefined}
                  disabled={readOnly || saving}
                  options={formulaSelectOptions(draft.recoveryIntervalFormulaKey)}
                  placeholder="请选择恢复间隔公式"
                  onChange={(value) => patchDraft({ ...draft, recoveryIntervalFormulaKey: String(value ?? '') })}
                />
              </Form.Item>
              <Form.Item
                label="恢复方式"
                required
                validateStatus={errors.recoveryMode ? 'error' : undefined}
                help={errors.recoveryMode}
              >
                <Radio.Group
                  aria-label="恢复方式"
                  value={draft.recoveryMode}
                  disabled={readOnly || saving}
                  onChange={(value) => patchDraft({
                    ...draft,
                    recoveryMode: value as SkillInternalStateAmmoRecoveryMode
                  })}
                >
                  <Radio value="ONE_BY_ONE">{AMMO_RECOVERY_MODE_LABELS.ONE_BY_ONE}</Radio>
                  <Radio value="ALL_AT_ONCE">{AMMO_RECOVERY_MODE_LABELS.ALL_AT_ONCE}</Radio>
                </Radio.Group>
              </Form.Item>
            </>
          ) : null}

          {draft.stateType === 'FLAG' ? (
            <Form.Item
              label="初始是否启用"
              validateStatus={errors.initialEnabled ? 'error' : undefined}
              help={errors.initialEnabled}
            >
              <Switch
                aria-label="初始是否启用"
                checked={draft.initialEnabled}
                disabled={readOnly || saving}
                onChange={(value) => patchDraft({ ...draft, initialEnabled: value })}
              />
            </Form.Item>
          ) : null}

          {draft.stateType === 'INTERNAL_COOLDOWN' ? (
            <Form.Item
              label="时长公式"
              required
              extra={MILLISECOND_FORMULA_HINT}
              validateStatus={errors.durationFormulaKey ? 'error' : undefined}
              help={errors.durationFormulaKey}
            >
              <Select
                aria-label="时长公式"
                value={draft.durationFormulaKey || undefined}
                disabled={readOnly || saving}
                options={formulaSelectOptions(draft.durationFormulaKey)}
                placeholder="请选择时长公式"
                onChange={(value) => patchDraft({ ...draft, durationFormulaKey: String(value ?? '') })}
              />
            </Form.Item>
          ) : null}
        </Form>

        {draft.stateType === 'MODE' ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Typography.Title heading={6} style={{ margin: 0 }}>模式选项</Typography.Title>
              {!readOnly ? (
                <Button
                  type="primary"
                  disabled={saving}
                  onClick={() => replaceOptions([...draft.options, createEmptyModeOptionDraft()])}
                >
                  新增选项
                </Button>
              ) : null}
            </div>
            {errors.options ? <Alert type="error" content={errors.options} style={{ marginBottom: 12 }} /> : null}
            <Table
              className="data-table-shell"
              columns={optionColumns}
              data={displayedOptions}
              pagination={false}
              rowKey={(row: { item: SkillInternalStateModeOptionDraft; index: number }) => `option-${row.index}`}
            />
          </div>
        ) : null}
      </Space>
    </Modal>
  );
}
