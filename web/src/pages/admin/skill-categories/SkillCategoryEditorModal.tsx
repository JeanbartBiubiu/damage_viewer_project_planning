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
import {
  createSkillCategory,
  updateSkillCategory
} from '../../../services/skillCategoryClient';
import type { SkillCategory } from '../../../types/skillCategory';
import {
  skillCategoryFieldIssues,
  validateSkillCategoryDraft,
  type SkillCategoryDraft,
  type SkillCategoryDraftErrors
} from './skillCategoryForm';

export type SkillCategoryEditorMode = 'create' | 'view' | 'edit';

type SkillCategoryEditorModalProps = {
  visible: boolean;
  mode: SkillCategoryEditorMode;
  category: SkillCategory | null;
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onClose: () => void;
  onSaved: (category: SkillCategory) => void | Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
};

const EMPTY_DRAFT: SkillCategoryDraft = {
  skillCategoryKey: '',
  name: '',
  description: '',
  sortOrder: '0'
};

function titleFor(mode: SkillCategoryEditorMode): string {
  if (mode === 'create') return '新增技能分类';
  if (mode === 'edit') return '编辑技能分类';
  return '查看技能分类';
}

export function SkillCategoryEditorModal({
  visible,
  mode,
  category,
  apiBaseUrl,
  selectedGameId,
  adminToken,
  onClose,
  onSaved,
  onDirtyChange
}: SkillCategoryEditorModalProps) {
  const initial = useMemo<SkillCategoryDraft>(() => category ? {
    skillCategoryKey: category.skillCategoryKey,
    name: category.name,
    description: category.description ?? '',
    sortOrder: String(category.sortOrder)
  } : EMPTY_DRAFT, [category]);
  const [draft, setDraft] = useState<SkillCategoryDraft>(initial);
  const [errors, setErrors] = useState<SkillCategoryDraftErrors>({});
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

  const patchDraft = (field: keyof SkillCategoryDraft, value: string) => {
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
    const nextErrors = validateSkillCategoryDraft(draft, mode === 'create');
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
      const status = category?.status ?? 'ENABLED';
      const body = {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        status,
        sortOrder: Number(draft.sortOrder.trim())
      };
      const result = mode === 'create'
        ? await createSkillCategory(apiBaseUrl, selectedGameId, token, {
            skillCategoryKey: draft.skillCategoryKey.trim(),
            ...body
          })
        : await updateSkillCategory(
            apiBaseUrl,
            selectedGameId,
            category!.skillCategoryKey,
            token,
            body
          );
      onDirtyChange(false);
      await onSaved(result.data);
    } catch (error) {
      const fieldErrors: SkillCategoryDraftErrors = {};
      for (const issue of skillCategoryFieldIssues(error)) {
        if (
          issue.field === 'skillCategoryKey'
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
            label="技能分类标识"
            required
            validateStatus={errors.skillCategoryKey ? 'error' : undefined}
            help={errors.skillCategoryKey}
          >
            <Input
              aria-label="技能分类标识"
              value={draft.skillCategoryKey}
              disabled={readOnly || mode === 'edit' || saving}
              maxLength={64}
              onChange={(value) => patchDraft('skillCategoryKey', value)}
            />
          </Form.Item>
          <Form.Item
            label="技能分类名称"
            required
            validateStatus={errors.name ? 'error' : undefined}
            help={errors.name}
          >
            <Input
              aria-label="技能分类名称"
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
        {readOnly && category ? (
          <Typography.Text type="secondary">
            状态：{category.status === 'ENABLED' ? '启用' : '停用'} · 创建时间：{category.createdAt || '—'} · 更新时间：{category.updatedAt || '—'}
          </Typography.Text>
        ) : null}
      </Space>
    </Modal>
  );
}
