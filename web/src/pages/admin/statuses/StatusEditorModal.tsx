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
import { useEffect, useMemo, useState } from 'react';
import { getErrorMessage } from '../../../services/apiClient';
import { createStatus, updateStatus } from '../../../services/statusClient';
import type { GameStatus } from '../../../types/status';
import { STATUS_KIND_LABELS } from '../../../types/status';
import {
  buildCreateStatusRequest,
  buildUpdateStatusRequest,
  createEmptyStatusDraft,
  mapStatusFieldIssues,
  statusToDraft,
  validateStatusDraft,
  type StatusDraft,
  type StatusDraftErrors
} from './statusForm';

export type StatusEditorMode = 'create' | 'view' | 'edit';

type StatusEditorModalProps = {
  visible: boolean;
  mode: StatusEditorMode;
  statusRecord: GameStatus | null;
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onClose: () => void;
  onSaved: (status: GameStatus) => void | Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
};

function titleFor(mode: StatusEditorMode): string {
  if (mode === 'create') return '新增状态';
  if (mode === 'edit') return '编辑状态';
  return '查看状态';
}

function composeSaveError(error: unknown, unmappedMessages: string[]): string {
  const general = getErrorMessage(error);
  const extra = unmappedMessages.filter((item) => item && item !== general);
  return extra.length > 0 ? [general, ...extra].join('；') : general;
}

export function StatusEditorModal({
  visible,
  mode,
  statusRecord,
  apiBaseUrl,
  selectedGameId,
  adminToken,
  onClose,
  onSaved,
  onDirtyChange
}: StatusEditorModalProps) {
  const initial = useMemo<StatusDraft>(
    () => (statusRecord ? statusToDraft(statusRecord) : createEmptyStatusDraft()),
    [statusRecord]
  );
  const [draft, setDraft] = useState<StatusDraft>(initial);
  const [errors, setErrors] = useState<StatusDraftErrors>({});
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

  const patchDraft = (field: keyof StatusDraft, value: string) => {
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
    const validation = validateStatusDraft(draft, mode === 'create');
    if (!validation.ok) {
      setErrors(validation.fieldErrors);
      return;
    }
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
        ? await createStatus(
            apiBaseUrl,
            selectedGameId,
            token,
            buildCreateStatusRequest(validation.normalized)
          )
        : await updateStatus(
            apiBaseUrl,
            selectedGameId,
            statusRecord!.statusKey,
            token,
            buildUpdateStatusRequest(validation.normalized, statusRecord!.status)
          );
      onDirtyChange(false);
      await onSaved(result.data);
    } catch (error) {
      const mapped = mapStatusFieldIssues(error);
      setErrors(mapped.fieldErrors);
      setSaveError(composeSaveError(error, mapped.unmappedMessages));
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
          <Form.Item label="状态种类" required
            validateStatus={errors.statusKind ? 'error' : undefined} help={errors.statusKind}>
            <Select aria-label="状态种类" value={draft.statusKind || undefined}
              placeholder="请选择状态种类" disabled={mode !== 'create' || saving}
              options={Object.entries(STATUS_KIND_LABELS).map(([value, label]) => ({ value, label }))}
              onChange={(value) => patchDraft('statusKind', value)} />
          </Form.Item>
          <Form.Item
            label="状态标识"
            required
            validateStatus={errors.statusKey ? 'error' : undefined}
            help={errors.statusKey}
          >
            <Input
              aria-label="状态标识"
              value={draft.statusKey}
              disabled={readOnly || mode === 'edit' || saving}
              maxLength={64}
              onChange={(value) => patchDraft('statusKey', value)}
            />
          </Form.Item>
          <Form.Item
            label="状态名称"
            required
            validateStatus={errors.name ? 'error' : undefined}
            help={errors.name}
          >
            <Input
              aria-label="状态名称"
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
        {readOnly && statusRecord ? (
          <Typography.Text type="secondary">
            启停状态：{statusRecord.status === 'ENABLED' ? '启用' : '停用'}
            {' · '}创建时间：{statusRecord.createdAt || '—'}
            {' · '}更新时间：{statusRecord.updatedAt || '—'}
          </Typography.Text>
        ) : null}
      </Space>
    </Modal>
  );
}
