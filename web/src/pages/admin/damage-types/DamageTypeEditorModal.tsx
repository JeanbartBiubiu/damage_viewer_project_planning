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
import { getErrorMessage } from '../../../services/apiClient';
import { createDamageType, updateDamageType } from '../../../services/damageTypeClient';
import type { DamageType } from '../../../types/damageType';
import {
  damageTypeFieldIssues,
  validateDamageTypeDraft,
  type DamageTypeDraft,
  type DamageTypeDraftErrors
} from './damageTypeForm';

export type DamageTypeEditorMode = 'create' | 'view' | 'edit';

type DamageTypeEditorModalProps = {
  visible: boolean;
  mode: DamageTypeEditorMode;
  damageType: DamageType | null;
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onClose: () => void;
  onSaved: (damageType: DamageType) => void | Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
};

const EMPTY_DRAFT: DamageTypeDraft = {
  damageTypeKey: '',
  name: '',
  description: '',
  sortOrder: '0'
};

function titleFor(mode: DamageTypeEditorMode): string {
  if (mode === 'create') return '新增伤害类型';
  if (mode === 'edit') return '编辑伤害类型';
  return '查看伤害类型';
}

export function DamageTypeEditorModal({
  visible,
  mode,
  damageType,
  apiBaseUrl,
  selectedGameId,
  adminToken,
  onClose,
  onSaved,
  onDirtyChange
}: DamageTypeEditorModalProps) {
  const initial = useMemo<DamageTypeDraft>(() => damageType ? {
    damageTypeKey: damageType.damageTypeKey,
    name: damageType.name,
    description: damageType.description ?? '',
    sortOrder: String(damageType.sortOrder)
  } : EMPTY_DRAFT, [damageType]);
  const [draft, setDraft] = useState<DamageTypeDraft>(initial);
  const [errors, setErrors] = useState<DamageTypeDraftErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const readOnly = mode === 'view';

  useEffect(() => {
    if (!visible) return;
    setDraft(initial);
    setErrors({});
    setSaveError(null);
    setSaving(false);
    onDirtyChange(false);
  }, [initial, onDirtyChange, visible]);

  const patchDraft = (field: keyof DamageTypeDraft, value: string) => {
    const next = { ...draft, [field]: value };
    setDraft(next);
    setErrors((current) => ({ ...current, [field]: undefined }));
    setSaveError(null);
    onDirtyChange(JSON.stringify(next) !== JSON.stringify(initial));
  };

  const close = () => {
    if (saving) return;
    onDirtyChange(false);
    onClose();
  };

  const save = async () => {
    const nextErrors = validateDamageTypeDraft(draft, mode === 'create');
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    if (!selectedGameId) {
      setSaveError('请先选择游戏。');
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
      const status = damageType?.status ?? 'ENABLED';
      const body = {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        status,
        sortOrder: Number(draft.sortOrder.trim())
      };
      const result = mode === 'create'
        ? await createDamageType(apiBaseUrl, selectedGameId, token, {
            damageTypeKey: draft.damageTypeKey.trim(),
            ...body
          })
        : await updateDamageType(
            apiBaseUrl,
            selectedGameId,
            damageType!.damageTypeKey,
            token,
            body
          );
      onDirtyChange(false);
      await onSaved(result.data);
    } catch (error) {
      const fieldErrors: DamageTypeDraftErrors = {};
      for (const issue of damageTypeFieldIssues(error)) {
        if (
          issue.field === 'damageTypeKey'
          || issue.field === 'name'
          || issue.field === 'description'
          || issue.field === 'sortOrder'
        ) {
          fieldErrors[issue.field] = issue.message;
        }
      }
      setErrors(fieldErrors);
      setSaveError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={titleFor(mode)}
      visible={visible}
      maskClosable
      onCancel={close}
      footer={
        <Space>
          <Button onClick={close} disabled={saving}>{readOnly ? '关闭' : '取消'}</Button>
          {!readOnly ? (
            <Button type="primary" loading={saving} onClick={() => void save()}>保存</Button>
          ) : null}
        </Space>
      }
    >
      <Space direction="vertical" size="medium" style={{ width: '100%' }}>
        {saveError ? <Alert type="error" content={saveError} /> : null}
        <Form layout="vertical">
          <Form.Item
            label="伤害类型标识"
            required
            validateStatus={errors.damageTypeKey ? 'error' : undefined}
            help={errors.damageTypeKey}
          >
            <Input
              aria-label="伤害类型标识"
              value={draft.damageTypeKey}
              disabled={readOnly || mode === 'edit' || saving}
              maxLength={64}
              onChange={(value) => patchDraft('damageTypeKey', value)}
            />
          </Form.Item>
          <Form.Item
            label="伤害类型名称"
            required
            validateStatus={errors.name ? 'error' : undefined}
            help={errors.name}
          >
            <Input
              aria-label="伤害类型名称"
              value={draft.name}
              disabled={readOnly || saving}
              maxLength={100}
              onChange={(value) => patchDraft('name', value)}
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
              onChange={(value) => patchDraft('description', value)}
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
              disabled={readOnly || saving}
              min={0}
              precision={0}
              style={{ width: '100%' }}
              onChange={(value) => patchDraft('sortOrder', value === undefined ? '' : String(value))}
            />
          </Form.Item>
        </Form>
        {readOnly && damageType ? (
          <Typography.Text type="secondary">
            状态：{damageType.status === 'ENABLED' ? '启用' : '停用'} · 创建时间：{damageType.createdAt || '—'} · 更新时间：{damageType.updatedAt || '—'}
          </Typography.Text>
        ) : null}
      </Space>
    </Modal>
  );
}
