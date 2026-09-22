import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Typography
} from '@arco-design/web-react';
import { useEffect, useMemo, useState } from 'react';
import { ApiRequestError, getErrorMessage } from '../../../services/apiClient';
import { listAttributes } from '../../../services/attributeClient';
import { createSkillFormula, getSkillFormula, updateSkillFormula } from '../../../services/skillFormulaClient';
import { listSkillParameters } from '../../../services/skillParameterClient';
import type { Attribute } from '../../../types/attribute';
import type { SkillFormula, SkillFormulaSummary } from '../../../types/skillFormula';
import type { SkillParameter } from '../../../types/skillParameter';
import type { AuthoringLocation } from '../../../types/authoringLocation';
import { AuthoringFieldAnchor } from './AuthoringFieldAnchor';
import { resolveAuthoringLocation } from './authoringLocation';
import {
  AUTHORING_UNSAVED_CONFIRM,
  authoringLocateMessage,
  formulaNodePathFromResolved,
  lastFieldName,
  shouldDegradeUnsupportedAnchor
} from './authoringFocus';
import { FormulaExpressionEditor } from './FormulaExpressionEditor';
import {
  buildCreateFormulaRequest,
  buildUpdateFormulaRequest,
  collectReferencedAttributeKeys,
  createEmptyFormulaDraft,
  formulaToDraft,
  mapFormulaFieldIssues,
  previewFormulaExpression,
  updateNodeAtPath,
  validateFormulaDraft,
  type FormulaNodeIssue,
  type SkillFormulaDraft,
  type SkillFormulaDraftErrors
} from './formulaExpression';

export type SkillFormulaEditorMode = 'create' | 'view' | 'edit';

type SkillFormulaEditorModalProps = {
  visible: boolean;
  mode: SkillFormulaEditorMode;
  formula: SkillFormulaSummary | null;
  apiBaseUrl: string;
  selectedGameId: string;
  skillKey: string;
  adminToken: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onSkillMissing: () => void;
  authoringLocation?: AuthoringLocation | null;
};

function titleFor(mode: SkillFormulaEditorMode): string {
  if (mode === 'create') return '新增公式';
  if (mode === 'edit') return '编辑公式';
  return '查看公式';
}

function isSkillNotFound(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === '404.SKILL_NOT_FOUND';
}

export function SkillFormulaEditorModal({
  visible,
  mode,
  formula,
  apiBaseUrl,
  selectedGameId,
  skillKey,
  adminToken,
  onClose,
  onSaved,
  onSkillMissing,
  authoringLocation
}: SkillFormulaEditorModalProps) {
  const [draft, setDraft] = useState<SkillFormulaDraft>(createEmptyFormulaDraft());
  const [baseline, setBaseline] = useState<SkillFormulaDraft>(createEmptyFormulaDraft());
  const [locateNotice, setLocateNotice] = useState<string | null>(null);
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const [focusField, setFocusField] = useState<string | null>(null);
  const [errors, setErrors] = useState<SkillFormulaDraftErrors>({});
  const [nodeIssues, setNodeIssues] = useState<FormulaNodeIssue[]>([]);
  const [parameters, setParameters] = useState<SkillParameter[]>([]);
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [retainedDisabledAttributeKeys, setRetainedDisabledAttributeKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogReady, setCatalogReady] = useState(false);
  const [detailReady, setDetailReady] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const readOnly = mode === 'view';
  const expressionReady = mode === 'create' ? catalogReady : detailReady;
  const canSave = !readOnly && catalogReady && detailReady && !loading && !loadError && !catalogError;

  const previewCatalog = useMemo(() => ({
    parameters,
    attributes
  }), [attributes, parameters]);

  const previewSegments = useMemo(
    () => previewFormulaExpression(draft.expression, previewCatalog),
    [draft.expression, previewCatalog]
  );

  useEffect(() => {
    if (!visible) return;
    const token = adminToken.trim();
    if (!token) {
      setLoadError('请先配置 Admin Token。');
      setCatalogError(null);
      setCatalogReady(false);
      setDetailReady(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setCatalogError(null);
    setSaveError(null);
    setErrors({});
    setNodeIssues([]);
    setSaving(false);
    setCatalogReady(false);
    setDetailReady(mode === 'create');
    setDraft(createEmptyFormulaDraft());
    setParameters([]);
    setAttributes([]);
    setRetainedDisabledAttributeKeys(new Set());

    const load = async () => {
      const detailPromise: Promise<SkillFormula | null> = mode === 'create' || !formula
        ? Promise.resolve(null)
        : getSkillFormula(apiBaseUrl, selectedGameId, skillKey, formula.formulaKey, token)
          .then((result) => result.data);

      const [detailSettled, parameterSettled, attributeSettled] = await Promise.allSettled([
        detailPromise,
        listSkillParameters(apiBaseUrl, selectedGameId, skillKey, token),
        listAttributes(apiBaseUrl, selectedGameId, token)
      ]);

      if (cancelled) return;

      const settled = [detailSettled, parameterSettled, attributeSettled];
      if (settled.some((item) => item.status === 'rejected' && isSkillNotFound(item.reason))) {
        onSkillMissing();
        return;
      }

      let nextParameters: SkillParameter[] = [];
      let nextAttributes: Attribute[] = [];
      const catalogMessages: string[] = [];

      if (parameterSettled.status === 'fulfilled') {
        nextParameters = parameterSettled.value.data;
      } else {
        catalogMessages.push(getErrorMessage(parameterSettled.reason));
      }

      if (attributeSettled.status === 'fulfilled') {
        nextAttributes = attributeSettled.value.data.items;
      } else {
        catalogMessages.push(getErrorMessage(attributeSettled.reason));
      }

      const catalogsOk = parameterSettled.status === 'fulfilled'
        && attributeSettled.status === 'fulfilled';

      if (mode === 'create') {
        setDraft(createEmptyFormulaDraft());
        setDetailReady(true);
        if (!catalogsOk) {
          setCatalogError(catalogMessages.join('；') || '目录加载失败。');
          setCatalogReady(false);
        } else {
          setCatalogReady(true);
        }
        setParameters(nextParameters);
        setAttributes(nextAttributes);
        setRetainedDisabledAttributeKeys(new Set());
        return;
      }

      if (detailSettled.status === 'rejected') {
        setDetailReady(false);
        setLoadError(getErrorMessage(detailSettled.reason));
        if (formula) {
          setDraft({
            formulaKey: formula.formulaKey,
            name: formula.name,
            description: formula.description ?? '',
            sortOrder: String(formula.sortOrder),
            expression: { nodeType: 'empty' }
          });
        }
        if (!catalogsOk) {
          setCatalogError(catalogMessages.join('；') || '目录加载失败。');
        }
        setCatalogReady(catalogsOk);
        setParameters(nextParameters);
        setAttributes(nextAttributes);
        setRetainedDisabledAttributeKeys(new Set());
        return;
      }

      const detail = detailSettled.value;
      if (!detail) {
        setDetailReady(false);
        setLoadError('公式详情加载失败。');
        if (formula) {
          setDraft({
            formulaKey: formula.formulaKey,
            name: formula.name,
            description: formula.description ?? '',
            sortOrder: String(formula.sortOrder),
            expression: { nodeType: 'empty' }
          });
        }
        setCatalogReady(catalogsOk);
        if (!catalogsOk) {
          setCatalogError(catalogMessages.join('；') || '目录加载失败。');
        }
        setParameters(nextParameters);
        setAttributes(nextAttributes);
        setRetainedDisabledAttributeKeys(new Set());
        return;
      }

      const nextDraft = formulaToDraft(detail);
      const retained = new Set<string>();
      const referenced = collectReferencedAttributeKeys(nextDraft.expression);
      for (const key of referenced) {
        const attribute = nextAttributes.find((item) => item.attributeKey === key);
        if (attribute?.status === 'DISABLED') {
          retained.add(key);
        }
      }

      setDraft(nextDraft);
      setBaseline(nextDraft);
      setDetailReady(true);
      if (authoringLocation) {
        const resolved = resolveAuthoringLocation(authoringLocation, detail);
        const unsupported = shouldDegradeUnsupportedAnchor(authoringLocation.editor, resolved.matchedSegments, resolved.precision);
        if (resolved.precision !== 'FIELD' || unsupported || resolved.reason) {
          setLocateNotice(authoringLocateMessage({
            originalFieldPath: resolved.originalFieldPath,
            reason: resolved.reason,
            unsupportedAnchor: unsupported,
            reportChanged: resolved.reportChanged
          }));
          setFocusPath(null);
          setFocusField(null);
        } else if (resolved.path[0] === 'expression') {
          setLocateNotice(null);
          setFocusPath(formulaNodePathFromResolved(resolved.path));
          setFocusField(null);
        } else {
          setLocateNotice(null);
          setFocusPath(null);
          setFocusField(lastFieldName(resolved.matchedSegments));
        }
      } else {
        setLocateNotice(null);
        setFocusPath(null);
        setFocusField(null);
      }
      setParameters(nextParameters);
      setAttributes(nextAttributes);
      setRetainedDisabledAttributeKeys(retained);
      setCatalogReady(catalogsOk);
      if (!catalogsOk) {
        setCatalogError(catalogMessages.join('；') || '目录加载失败。');
      }
    };

    void load().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [adminToken, apiBaseUrl, formula, mode, onSkillMissing, selectedGameId, skillKey, visible, authoringLocation]);

  const close = () => {
    if (saving) return;
    if (mode !== 'view' && JSON.stringify(draft) !== JSON.stringify(baseline)
      && !window.confirm(AUTHORING_UNSAVED_CONFIRM)) return;
    onClose();
  };

  const patchField = <K extends keyof SkillFormulaDraft>(field: K, value: SkillFormulaDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setSaveError(null);
  };

  const save = async () => {
    if (!canSave) return;
    const validation = validateFormulaDraft(draft, mode === 'create', previewCatalog);
    if (!validation.ok) {
      setErrors(validation.fieldErrors);
      setNodeIssues(validation.nodeIssues);
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
      if (mode === 'create') {
        await createSkillFormula(
          apiBaseUrl,
          selectedGameId,
          skillKey,
          token,
          buildCreateFormulaRequest(validation.normalized)
        );
      } else {
        await updateSkillFormula(
          apiBaseUrl,
          selectedGameId,
          skillKey,
          formula!.formulaKey,
          token,
          buildUpdateFormulaRequest(validation.normalized)
        );
      }
      await onSaved();
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === '404.SKILL_NOT_FOUND') {
        onSkillMissing();
        return;
      }
      const mapped = mapFormulaFieldIssues(error);
      setErrors(mapped.fieldErrors);
      setNodeIssues(mapped.nodeIssues);
      if (error instanceof ApiRequestError && error.code === '409.FORMULA_ATTRIBUTE_DISABLED') {
        setSaveError(getErrorMessage(error));
      } else if (mapped.unmappedMessages.length > 0) {
        setSaveError([getErrorMessage(error), ...mapped.unmappedMessages].join('；'));
      } else {
        setSaveError(getErrorMessage(error));
      }
    } finally {
      setSaving(false);
    }
  };

  const formEditable = !readOnly && catalogReady && !saving;

  return (
    <Modal
      title={titleFor(mode)}
      visible={visible}
      maskClosable
      onCancel={close}
      style={{ width: 840 }}
      footer={
        <Space>
          <Button onClick={close} disabled={saving}>{readOnly ? '关闭' : '取消'}</Button>
          {canSave ? (
            <Button type="primary" loading={saving} onClick={() => void save()}>保存</Button>
          ) : null}
        </Space>
      }
    >
      <Space direction="vertical" size="medium" style={{ width: '100%' }}>
        {loadError ? <Alert type="error" content={loadError} /> : null}
        {catalogError ? <Alert type="error" content={catalogError} /> : null}
        {locateNotice ? <Alert type="warning" content={locateNotice} /> : null}
        {saveError ? <Alert type="error" content={saveError} /> : null}
        {loading ? <Typography.Text type="secondary">加载中…</Typography.Text> : null}
        {!loading ? (
          <Form layout="vertical">
            <AuthoringFieldAnchor field="formulaKey" active={focusField === 'formulaKey'}>
            <Form.Item
              label="稳定标识"
              required
              validateStatus={errors.formulaKey ? 'error' : undefined}
              help={errors.formulaKey}
            >
              <Input
                aria-label="稳定标识"
                value={draft.formulaKey}
                disabled={readOnly || mode !== 'create' || saving || !catalogReady}
                maxLength={64}
                onChange={(value) => patchField('formulaKey', value)}
              />
            </Form.Item>
            </AuthoringFieldAnchor>
            <AuthoringFieldAnchor field="name" active={focusField === 'name'}>
            <Form.Item
              label="公式名称"
              required
              validateStatus={errors.name ? 'error' : undefined}
              help={errors.name}
            >
              <Input
                aria-label="公式名称"
                value={draft.name}
                disabled={!formEditable}
                maxLength={100}
                onChange={(value) => patchField('name', value)}
              />
            </Form.Item>
            </AuthoringFieldAnchor>
            <AuthoringFieldAnchor field="description" active={focusField === 'description'}>
            <Form.Item
              label="说明"
              validateStatus={errors.description ? 'error' : undefined}
              help={errors.description}
            >
              <Input.TextArea
                aria-label="说明"
                value={draft.description}
                disabled={!formEditable}
                maxLength={2000}
                showWordLimit
                autoSize={{ minRows: 2, maxRows: 6 }}
                onChange={(value) => patchField('description', value)}
              />
            </Form.Item>
            </AuthoringFieldAnchor>
            <AuthoringFieldAnchor field="sortOrder" active={focusField === 'sortOrder'}>
            <Form.Item
              label="排序"
              required
              validateStatus={errors.sortOrder ? 'error' : undefined}
              help={errors.sortOrder}
            >
              <InputNumber
                aria-label="排序"
                value={draft.sortOrder.trim() ? Number(draft.sortOrder) : undefined}
                disabled={!formEditable}
                min={0}
                precision={0}
                style={{ width: '100%' }}
                onChange={(value) => patchField('sortOrder', value === undefined ? '' : String(value))}
              />
            </Form.Item>
            </AuthoringFieldAnchor>
            <AuthoringFieldAnchor field="expression" active={focusField === 'expression' && !focusPath}>
            <Form.Item
              label="公式结构"
              validateStatus={errors.expression ? 'error' : undefined}
              help={errors.expression}
            >
              {expressionReady ? (
                <FormulaExpressionEditor
                  root={draft.expression}
                  path="expression"
                  node={draft.expression}
                  readOnly={readOnly}
                  disabled={saving || !catalogReady}
                  parameters={parameters}
                  attributes={attributes}
                  retainedDisabledAttributeKeys={retainedDisabledAttributeKeys}
                  nodeIssues={nodeIssues}
                  focusPath={focusPath}
                  updateAtPath={(path, next) => {
                    setDraft((current) => ({
                      ...current,
                      expression: updateNodeAtPath(current.expression, path, next)
                    }));
                    setNodeIssues([]);
                    setErrors((current) => ({ ...current, expression: undefined }));
                    setSaveError(null);
                  }}
                  onNodeIssue={(issue) => {
                    setNodeIssues((current) => {
                      const filtered = current.filter((item) => item.path !== issue.path);
                      return [...filtered, issue];
                    });
                  }}
                />
              ) : (
                <Alert
                  type="warning"
                  content={mode === 'create'
                    ? '目录未就绪，无法编辑公式结构。'
                    : '公式详情未就绪，无法展示公式结构。'}
                />
              )}
            </Form.Item>
            </AuthoringFieldAnchor>
            <Form.Item label="中文预览">
              <Typography.Paragraph style={{ marginBottom: 0 }}>
                {previewSegments.map((segment, index) => (
                  <Typography.Text
                    key={`${index}-${segment.text}`}
                    type={segment.error ? 'error' : undefined}
                  >
                    {segment.text}
                  </Typography.Text>
                ))}
              </Typography.Paragraph>
            </Form.Item>
          </Form>
        ) : null}
      </Space>
    </Modal>
  );
}
