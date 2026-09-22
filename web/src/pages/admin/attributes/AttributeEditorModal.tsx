import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Typography
} from '@arco-design/web-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiRequestError, getErrorMessage } from '../../../services/apiClient';
import {
  createAttribute,
  updateAttribute
} from '../../../services/attributeClient';
import type { Attribute } from '../../../types/attribute';
import {
  attributeToDraft,
  buildCreateAttributeRequest,
  buildUpdateAttributeRequest,
  createEmptyAttributeDraft,
  isAttributeDraftDirty,
  mapAttributeFieldIssues,
  validateAttributeDraft,
  type AttributeEditorMode,
  type AttributeFieldErrors,
  type AttributeFormDraft,
  type AttributeFormField
} from './attributeForm';

export type AttributeEditorModalProps = {
  visible: boolean;
  mode: AttributeEditorMode;
  attribute: Attribute | null;
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onClose: () => void;
  onSaved: (attribute: Attribute) => void | Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
};

const UNSAVED_CONFIRM_MESSAGE = '当前修改尚未保存，确定要离开吗？';

function initialDraftFor(attribute: Attribute | null): AttributeFormDraft {
  return attribute ? attributeToDraft(attribute) : createEmptyAttributeDraft();
}

function modalTitle(mode: AttributeEditorMode): string {
  if (mode === 'create') {
    return '新增属性';
  }
  if (mode === 'edit') {
    return '编辑属性';
  }
  return '查看属性';
}

export function AttributeEditorModal({
  visible,
  mode,
  attribute,
  apiBaseUrl,
  selectedGameId,
  adminToken,
  onClose,
  onSaved,
  onDirtyChange
}: AttributeEditorModalProps) {
  const [draft, setDraft] = useState<AttributeFormDraft>(() => initialDraftFor(attribute));
  const [baseline, setBaseline] = useState<AttributeFormDraft>(() => initialDraftFor(attribute));
  const [fieldErrors, setFieldErrors] = useState<AttributeFieldErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const context = useMemo(() => ({}), [apiBaseUrl, selectedGameId, adminToken, attribute, mode, visible]);
  const currentContext = useRef(context);
  currentContext.current = context;
  const active = useRef(true);
  const busy = useRef(false);

  const readOnly = mode === 'view';
  const dirty = useMemo(
    () => visible && !readOnly && isAttributeDraftDirty(draft, baseline),
    [baseline, draft, readOnly, visible]
  );

  useEffect(() => {
    active.current = visible;
    busy.current = false;
    if (!visible) {
      return;
    }
    const next = initialDraftFor(attribute);
    setDraft(next);
    setBaseline(next);
    setFieldErrors({});
    setSaveError(null);
    setSaving(false);
    return () => { active.current = false; };
  }, [attribute, context, mode, visible]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const patchDraft = <K extends AttributeFormField>(key: K, value: AttributeFormDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key]) {
        return current;
      }
      const { [key]: _removed, ...rest } = current;
      return rest;
    });
    setSaveError(null);
  };

  const requestClose = () => {
    if (busy.current) {
      return;
    }
    if (dirty && !window.confirm(UNSAVED_CONFIRM_MESSAGE)) {
      return;
    }
    onDirtyChange(false);
    onClose();
  };

  const handleSave = async () => {
    if (readOnly || busy.current || !visible) {
      return;
    }
    const validation = validateAttributeDraft(draft, mode);
    if (!validation.ok) {
      setFieldErrors(validation.fieldErrors);
      setSaveError(null);
      return;
    }
    if (!selectedGameId) {
      setSaveError('请先在顶部选择游戏。');
      return;
    }
    const token = adminToken.trim();
    if (!token) {
      setSaveError('保存需要 Admin Token。');
      return;
    }

    busy.current = true;
    const isCurrent = () => active.current && currentContext.current === context;
    setSaving(true);
    setFieldErrors({});
    setSaveError(null);
    try {
      const result = mode === 'create'
        ? await createAttribute(
            apiBaseUrl,
            selectedGameId,
            token,
            buildCreateAttributeRequest(validation.normalized)
          )
        : await updateAttribute(
            apiBaseUrl,
            selectedGameId,
            validation.normalized.attributeKey,
            token,
            buildUpdateAttributeRequest(validation.normalized)
          );
      if (!isCurrent()) return;
      setBaseline(draft);
      onDirtyChange(false);
      await onSaved(result.data);
    } catch (error) {
      if (!isCurrent()) return;
      if (error instanceof ApiRequestError) {
        const mapped = mapAttributeFieldIssues(error.details);
        setFieldErrors(mapped.fieldErrors);
        if (mapped.unmappedMessages.length > 0) {
          setSaveError(`${getErrorMessage(error)}：${mapped.unmappedMessages.join('；')}`);
        } else if (Object.keys(mapped.fieldErrors).length === 0) {
          setSaveError(getErrorMessage(error));
        }
      } else {
        setSaveError(getErrorMessage(error));
      }
    } finally {
      if (isCurrent()) {
        busy.current = false;
        setSaving(false);
      }
    }
  };

  const fieldsDisabled = readOnly || saving;

  return (
    <Modal
      title={modalTitle(mode)}
      visible={visible}
      closable={!saving}
      maskClosable={!saving}
      escToExit={!saving}
      onCancel={requestClose}
      autoFocus={false}
      focusLock
      footer={
        <Space>
          <Button onClick={requestClose} disabled={saving}>
            {readOnly ? '关闭' : '取消'}
          </Button>
          {!readOnly ? (
            <Button type="primary" loading={saving} onClick={() => void handleSave()}>
              保存
            </Button>
          ) : null}
        </Space>
      }
    >
      <Space direction="vertical" size="medium" style={{ width: '100%' }}>
        {saveError ? <Alert type="error" content={saveError} /> : null}
        {mode === 'edit' ? (
          <Alert type="info" content="稳定标识创建后不可修改；其他字段将按当前表单全量保存。" />
        ) : null}
        <Form layout="vertical">
          <Form.Item
            label="稳定标识"
            required
            validateStatus={fieldErrors.attributeKey ? 'error' : undefined}
            help={fieldErrors.attributeKey}
            extra="小写字母开头，只能包含小写字母、数字和下划线。"
          >
            <Input
              aria-label="稳定标识"
              value={draft.attributeKey}
              disabled={fieldsDisabled || mode === 'edit'}
              maxLength={64}
              placeholder="例如 move_speed"
              onChange={(value) => patchDraft('attributeKey', value)}
            />
          </Form.Item>
          <Form.Item
            label="属性名称"
            required
            validateStatus={fieldErrors.name ? 'error' : undefined}
            help={fieldErrors.name}
          >
            <Input
              aria-label="属性名称"
              value={draft.name}
              disabled={fieldsDisabled}
              maxLength={100}
              placeholder="例如 移动速度"
              onChange={(value) => patchDraft('name', value)}
            />
          </Form.Item>
          <Form.Item
            label="数值类型"
            required
            validateStatus={fieldErrors.valueType ? 'error' : undefined}
            help={fieldErrors.valueType}
          >
            <Select
              aria-label="数值类型"
              value={draft.valueType}
              disabled={fieldsDisabled}
              options={[
                { label: '小数', value: 'DECIMAL' },
                { label: '整数', value: 'INTEGER' }
              ]}
              onChange={(value) =>
                patchDraft('valueType', value === 'INTEGER' ? 'INTEGER' : 'DECIMAL')
              }
            />
          </Form.Item>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12
            }}
          >
            <Form.Item
              label="最小值"
              validateStatus={fieldErrors.minValue ? 'error' : undefined}
              help={fieldErrors.minValue}
            >
              <InputNumber
                aria-label="最小值"
                value={draft.minValue.trim() ? Number(draft.minValue) : undefined}
                disabled={fieldsDisabled}
                placeholder="可选"
                style={{ width: '100%' }}
                onChange={(value) => patchDraft('minValue', value === undefined ? '' : String(value))}
              />
            </Form.Item>
            <Form.Item
              label="最大值"
              validateStatus={fieldErrors.maxValue ? 'error' : undefined}
              help={fieldErrors.maxValue}
            >
              <InputNumber
                aria-label="最大值"
                value={draft.maxValue.trim() ? Number(draft.maxValue) : undefined}
                disabled={fieldsDisabled}
                placeholder="可选"
                style={{ width: '100%' }}
                onChange={(value) => patchDraft('maxValue', value === undefined ? '' : String(value))}
              />
            </Form.Item>
          </div>
          <Form.Item
            label="说明"
            validateStatus={fieldErrors.description ? 'error' : undefined}
            help={fieldErrors.description}
          >
            <Input.TextArea
              aria-label="说明"
              value={draft.description}
              disabled={fieldsDisabled}
              maxLength={2000}
              showWordLimit
              autoSize={{ minRows: 3, maxRows: 8 }}
              placeholder="可选；说明这个属性表示什么"
              onChange={(value) => patchDraft('description', value)}
            />
          </Form.Item>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12
            }}
          >
            <Form.Item
              label="状态"
              required
              validateStatus={fieldErrors.status ? 'error' : undefined}
              help={fieldErrors.status}
            >
              <Select
                aria-label="状态"
                value={draft.status}
                disabled={fieldsDisabled}
                options={[
                  { label: '启用', value: 'ENABLED' },
                  { label: '停用', value: 'DISABLED' }
                ]}
                onChange={(value) =>
                  patchDraft('status', value === 'DISABLED' ? 'DISABLED' : 'ENABLED')
                }
              />
            </Form.Item>
            <Form.Item
              label="排序"
              required
              validateStatus={fieldErrors.sortOrder ? 'error' : undefined}
              help={fieldErrors.sortOrder}
            >
              <InputNumber
                aria-label="排序"
                value={draft.sortOrder.trim() ? Number(draft.sortOrder) : undefined}
                disabled={fieldsDisabled}
                min={0}
                precision={0}
                style={{ width: '100%' }}
                onChange={(value) => patchDraft('sortOrder', value === undefined ? '' : String(value))}
              />
            </Form.Item>
          </div>
        </Form>
        {readOnly && attribute ? (
          <Typography.Text type="secondary">
            创建时间：{attribute.createdAt || '—'} · 更新时间：{attribute.updatedAt || '—'}
          </Typography.Text>
        ) : null}
      </Space>
    </Modal>
  );
}
