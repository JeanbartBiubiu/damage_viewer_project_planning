import { Alert, Button, Form, Input, Modal, Space, Typography } from '@arco-design/web-react';
import { useEffect, useMemo, useState } from 'react';
import { getErrorMessage } from '../../../services/apiClient';
import { createEquipment, updateEquipment } from '../../../services/equipmentClient';
import type { Equipment } from '../../../types/equipment';
import {
  equipmentFieldIssues,
  validateEquipmentDraft,
  type EquipmentDraft,
  type EquipmentDraftErrors
} from './equipmentForm';

export type EquipmentEditorMode = 'create' | 'view' | 'edit';

type EquipmentEditorModalProps = {
  visible: boolean;
  mode: EquipmentEditorMode;
  equipment: Equipment | null;
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onClose: () => void;
  onSaved: (equipment: Equipment) => void | Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
};

const EMPTY_DRAFT: EquipmentDraft = { equipmentKey: '', name: '', description: '' };

function titleFor(mode: EquipmentEditorMode): string {
  if (mode === 'create') return '新增装备';
  if (mode === 'edit') return '编辑装备';
  return '查看装备';
}

export function EquipmentEditorModal({
  visible,
  mode,
  equipment,
  apiBaseUrl,
  selectedGameId,
  adminToken,
  onClose,
  onSaved,
  onDirtyChange
}: EquipmentEditorModalProps) {
  const initial = useMemo<EquipmentDraft>(() => equipment ? {
    equipmentKey: equipment.equipmentKey,
    name: equipment.name,
    description: equipment.description ?? ''
  } : EMPTY_DRAFT, [equipment]);
  const [draft, setDraft] = useState<EquipmentDraft>(initial);
  const [errors, setErrors] = useState<EquipmentDraftErrors>({});
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

  const patchDraft = (field: keyof EquipmentDraft, value: string) => {
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
    const nextErrors = validateEquipmentDraft(draft, mode === 'create');
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
      const result = mode === 'create'
        ? await createEquipment(apiBaseUrl, selectedGameId, token, {
            equipmentKey: draft.equipmentKey.trim(),
            name: draft.name.trim(),
            description: draft.description.trim() || null
          })
        : await updateEquipment(apiBaseUrl, selectedGameId, equipment!.equipmentKey, token, {
            name: draft.name.trim(),
            description: draft.description.trim() || null
          });
      onDirtyChange(false);
      await onSaved(result.data);
    } catch (error) {
      const fieldErrors: EquipmentDraftErrors = {};
      for (const issue of equipmentFieldIssues(error)) {
        if (issue.field === 'equipmentKey' || issue.field === 'name' || issue.field === 'description') {
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
          {!readOnly ? <Button type="primary" loading={saving} onClick={() => void save()}>保存</Button> : null}
        </Space>
      }
    >
      <Space direction="vertical" size="medium" style={{ width: '100%' }}>
        {saveError ? <Alert type="error" content={saveError} /> : null}
        <Form layout="vertical">
          <Form.Item label="装备标识" required validateStatus={errors.equipmentKey ? 'error' : undefined} help={errors.equipmentKey}>
            <Input
              aria-label="装备标识"
              value={draft.equipmentKey}
              disabled={readOnly || mode === 'edit' || saving}
              maxLength={64}
              onChange={(value) => patchDraft('equipmentKey', value)}
            />
          </Form.Item>
          <Form.Item label="装备名称" required validateStatus={errors.name ? 'error' : undefined} help={errors.name}>
            <Input
              aria-label="装备名称"
              value={draft.name}
              disabled={readOnly || saving}
              maxLength={100}
              onChange={(value) => patchDraft('name', value)}
            />
          </Form.Item>
          <Form.Item label="说明" validateStatus={errors.description ? 'error' : undefined} help={errors.description}>
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
        </Form>
        {readOnly && equipment ? (
          <Typography.Text type="secondary">
            创建时间：{equipment.createdAt || '—'} · 更新时间：{equipment.updatedAt || '—'}
          </Typography.Text>
        ) : null}
      </Space>
    </Modal>
  );
}
