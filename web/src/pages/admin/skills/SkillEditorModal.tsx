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
  Tag,
  Typography
} from '@arco-design/web-react';
import { useEffect, useMemo, useState } from 'react';
import { getErrorMessage } from '../../../services/apiClient';
import { createSkill, updateSkill } from '../../../services/skillClient';
import type { Skill, SkillStatus } from '../../../types/skill';
import type { SkillCategory } from '../../../types/skillCategory';
import {
  buildCreateSkillRequest,
  buildUpdateSkillRequest,
  createEmptySkillDraft,
  mapSkillFieldIssues,
  skillToDraft,
  validateSkillDraft,
  type SkillCategoryIndexError,
  type SkillDraft,
  type SkillDraftErrors
} from './skillForm';

export type SkillEditorMode = 'create' | 'view' | 'edit';

type SkillEditorModalProps = {
  visible: boolean;
  mode: SkillEditorMode;
  skill: Skill | null;
  skillCategories: SkillCategory[];
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onClose: () => void;
  onSaved: (skill: Skill, options?: { maxLevelExpanded?: boolean }) => void | Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
};

function titleFor(mode: SkillEditorMode): string {
  if (mode === 'create') return '新增技能';
  if (mode === 'edit') return '编辑技能';
  return '查看技能';
}

function formatCategoryIndexError(
  issue: SkillCategoryIndexError,
  keys: string[],
  categories: SkillCategory[]
): string {
  const key = keys[issue.index];
  const name = categories.find((item) => item.skillCategoryKey === key)?.name;
  if (key && name) {
    return `第 ${issue.index + 1} 项 ${key}（${name}）：${issue.message}`;
  }
  if (key) {
    return `第 ${issue.index + 1} 项 ${key}：${issue.message}`;
  }
  return `第 ${issue.index + 1} 项：${issue.message}`;
}

function composeSaveError(error: unknown, unmappedMessages: string[]): string {
  const general = getErrorMessage(error);
  const extra = unmappedMessages.filter((item) => item && item !== general);
  return extra.length > 0 ? [general, ...extra].join('；') : general;
}

export function SkillEditorModal({
  visible,
  mode,
  skill,
  skillCategories,
  apiBaseUrl,
  selectedGameId,
  adminToken,
  onClose,
  onSaved,
  onDirtyChange
}: SkillEditorModalProps) {
  const initial = useMemo<SkillDraft>(
    () => (skill ? skillToDraft(skill) : createEmptySkillDraft()),
    [skill]
  );
  const [draft, setDraft] = useState<SkillDraft>(initial);
  const [errors, setErrors] = useState<SkillDraftErrors>({});
  const [categoryIndexErrors, setCategoryIndexErrors] = useState<SkillCategoryIndexError[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [openedMaxLevel, setOpenedMaxLevel] = useState<number | null>(null);
  const readOnly = mode === 'view';
  const categoryOptions = useMemo(() => {
    const originalKeys = new Set(skill?.skillCategoryKeys ?? []);
    return skillCategories
      .filter((item) => item.status === 'ENABLED' || originalKeys.has(item.skillCategoryKey))
      .map((item) => ({
        label: item.status === 'DISABLED' ? `${item.name}（已停用）` : item.name,
        value: item.skillCategoryKey,
        disabled: item.status === 'DISABLED'
      }));
  }, [skill, skillCategories]);
  const categoryHelp = [
    errors.skillCategoryKeys,
    ...categoryIndexErrors.map((issue) => formatCategoryIndexError(issue, draft.skillCategoryKeys, skillCategories))
  ].filter((item): item is string => Boolean(item));

  useEffect(() => {
    if (!visible) return;
    setDraft(initial);
    setErrors({});
    setCategoryIndexErrors([]);
    setSaveError(null);
    setSaving(false);
    setOpenedMaxLevel(skill?.maxLevel ?? null);
    onDirtyChange(false);
  }, [initial, mode, onDirtyChange, skill?.maxLevel, visible]);

  const patchDraft = <K extends keyof SkillDraft>(field: K, value: SkillDraft[K]) => {
    const next = { ...draft, [field]: value };
    setDraft(next);
    setErrors((current) => ({ ...current, [field]: undefined }));
    if (field === 'skillCategoryKeys') {
      setCategoryIndexErrors([]);
    }
    setSaveError(null);
    onDirtyChange(JSON.stringify(next) !== JSON.stringify(initial));
  };

  const close = () => {
    if (saving) return;
    onDirtyChange(false);
    onClose();
  };

  const save = async () => {
    const validation = validateSkillDraft(draft, mode === 'create');
    if (!validation.ok) {
      setErrors(validation.fieldErrors);
      setCategoryIndexErrors([]);
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

    const nextMaxLevel = validation.normalized.maxLevel;
    const previousMaxLevel = openedMaxLevel;
    if (
      mode === 'edit'
      && previousMaxLevel !== null
      && nextMaxLevel < previousMaxLevel
    ) {
      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: '确认缩小最高等级',
          content: `高于 Lv${nextMaxLevel} 的技能等级参数值将被删除`,
          okText: '确认保存',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false)
        });
      });
      if (!confirmed) return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const result = mode === 'create'
        ? await createSkill(
            apiBaseUrl,
            selectedGameId,
            token,
            buildCreateSkillRequest(validation.normalized)
          )
        : await updateSkill(
            apiBaseUrl,
            selectedGameId,
            skill!.skillKey,
            token,
            buildUpdateSkillRequest(validation.normalized)
          );
      onDirtyChange(false);
      await onSaved(result.data, {
        maxLevelExpanded: mode === 'edit'
          && previousMaxLevel !== null
          && nextMaxLevel > previousMaxLevel
      });
    } catch (error) {
      const mapped = mapSkillFieldIssues(error);
      setErrors(mapped.fieldErrors);
      setCategoryIndexErrors(mapped.categoryIndexErrors);
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
          <Form.Item
            label="技能标识"
            required
            validateStatus={errors.skillKey ? 'error' : undefined}
            help={errors.skillKey}
          >
            <Input
              aria-label="技能标识"
              value={draft.skillKey}
              disabled={readOnly || mode !== 'create' || saving}
              maxLength={64}
              onChange={(value) => patchDraft('skillKey', value)}
            />
          </Form.Item>
          <Form.Item
            label="技能名称"
            required
            validateStatus={errors.name ? 'error' : undefined}
            help={errors.name}
          >
            <Input
              aria-label="技能名称"
              value={draft.name}
              disabled={readOnly || saving}
              maxLength={100}
              onChange={(value) => patchDraft('name', value)}
            />
          </Form.Item>
          <Form.Item
            label="最高等级"
            required
            validateStatus={errors.maxLevel ? 'error' : undefined}
            help={errors.maxLevel}
          >
            <InputNumber
              aria-label="最高等级"
              value={draft.maxLevel.trim() ? Number(draft.maxLevel) : undefined}
              disabled={readOnly || saving}
              min={1}
              precision={0}
              style={{ width: '100%' }}
              onChange={(value) => patchDraft('maxLevel', value === undefined ? '' : String(value))}
            />
          </Form.Item>
          <Form.Item
            label="技能分类"
            validateStatus={categoryHelp.length > 0 ? 'error' : undefined}
            help={
              categoryHelp.length > 0
                ? categoryHelp.map((item, index) => <div key={`${index}-${item}`}>{item}</div>)
                : undefined
            }
          >
            <Select
              aria-label="技能分类"
              mode="multiple"
              value={draft.skillCategoryKeys}
              disabled={readOnly || saving}
              options={categoryOptions}
              placeholder="请选择技能分类"
              renderTag={({ label, onClose }) => (
                <Tag closable={!readOnly && !saving} onClose={onClose}>{label}</Tag>
              )}
              onChange={(value) => patchDraft('skillCategoryKeys', Array.isArray(value) ? value : [])}
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
            label="状态"
            required
            validateStatus={errors.status ? 'error' : undefined}
            help={errors.status}
          >
            <Radio.Group
              aria-label="状态"
              value={draft.status}
              disabled={readOnly || saving}
              onChange={(value) => patchDraft('status', value as SkillStatus)}
            >
              <Radio value="ENABLED">启用</Radio>
              <Radio value="DISABLED">停用</Radio>
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
              onChange={(value) => patchDraft('sortOrder', value === undefined ? '' : String(value))}
            />
          </Form.Item>
        </Form>
        {readOnly && skill ? (
          <Typography.Text type="secondary">
            创建时间：{skill.createdAt || '—'} · 更新时间：{skill.updatedAt || '—'}
          </Typography.Text>
        ) : null}
      </Space>
    </Modal>
  );
}
