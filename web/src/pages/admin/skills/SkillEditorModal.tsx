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
import { useEffect, useMemo, useRef, useState } from 'react';
import { getErrorMessage } from '../../../services/apiClient';
import { createSkill, updateSkill } from '../../../services/skillClient';
import type { Skill, SkillStatus } from '../../../types/skill';
import type { SkillCategory } from '../../../types/skillCategory';
import { loadFocusedSkill } from './focusedSkill';
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

export type SkillEditorSaveOptions = {
  expandedLevelRange?: { minLevel: number; maxLevel: number };
};

type SkillEditorModalProps = {
  visible: boolean;
  mode: SkillEditorMode;
  skill: Skill | null;
  skillCategories: SkillCategory[];
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onClose: () => void;
  onSaved: (skill: Skill, options?: SkillEditorSaveOptions) => void | Promise<void>;
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
  const skillKey = skill?.skillKey;
  const [initial, setInitial] = useState<SkillDraft>(createEmptySkillDraft);
  const [draft, setDraft] = useState<SkillDraft>(createEmptySkillDraft);
  const [loadedSkill, setLoadedSkill] = useState<Skill | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(mode !== 'create');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [errors, setErrors] = useState<SkillDraftErrors>({});
  const [categoryIndexErrors, setCategoryIndexErrors] = useState<SkillCategoryIndexError[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [openedMaxLevel, setOpenedMaxLevel] = useState<number | null>(null);
  const saveRequestSerial = useRef(0);
  const readOnly = mode === 'view';
  const detailReady = mode === 'create' || (loadedSkill !== null && !loadingDetail && !loadError);
  const categoryOptions = useMemo(() => {
    const originalKeys = new Set(loadedSkill?.skillCategoryKeys ?? []);
    return skillCategories
      .filter((item) => item.status === 'ENABLED' || originalKeys.has(item.skillCategoryKey))
      .map((item) => ({
        label: item.status === 'DISABLED' ? `${item.name}（已停用）` : item.name,
        value: item.skillCategoryKey,
        disabled: item.status === 'DISABLED'
      }));
  }, [loadedSkill, skillCategories]);
  const categoryHelp = [
    errors.skillCategoryKeys,
    ...categoryIndexErrors.map((issue) => formatCategoryIndexError(issue, draft.skillCategoryKeys, skillCategories))
  ].filter((item): item is string => Boolean(item));

  useEffect(() => {
    if (!visible) return;
    let active = true;
    saveRequestSerial.current += 1;
    const invalidate = () => {
      active = false;
      saveRequestSerial.current += 1;
    };
    const empty = createEmptySkillDraft();
    setInitial(empty);
    setDraft(empty);
    setLoadedSkill(null);
    setLoadError(null);
    setErrors({});
    setCategoryIndexErrors([]);
    setSaveError(null);
    setSaving(false);
    setOpenedMaxLevel(null);
    onDirtyChange(false);
    if (mode === 'create') {
      setLoadingDetail(false);
      return invalidate;
    }
    const token = adminToken.trim();
    if (!selectedGameId || !skillKey || !token) {
      setLoadingDetail(false);
      setLoadError('请先选择游戏并配置 Admin Token，再重新打开技能。');
      return invalidate;
    }
    setLoadingDetail(true);
    void loadFocusedSkill(apiBaseUrl, selectedGameId, skillKey, token)
      .then((current) => {
        if (!active) return;
        const fresh = skillToDraft(current);
        setLoadedSkill(current);
        setInitial(fresh);
        setDraft(fresh);
        setOpenedMaxLevel(current.maxLevel);
        setLoadingDetail(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(getErrorMessage(error));
        setLoadingDetail(false);
      });
    return invalidate;
  }, [adminToken, apiBaseUrl, detailAttempt, mode, onDirtyChange, selectedGameId, skillKey, visible]);

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
    if (readOnly || !detailReady || saving) return;
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
    const expandedLevelRange = mode === 'edit'
      && previousMaxLevel !== null
      && nextMaxLevel > previousMaxLevel
      ? { minLevel: previousMaxLevel + 1, maxLevel: nextMaxLevel }
      : undefined;
    const saveSerial = ++saveRequestSerial.current;

    setSaving(true);
    setSaveError(null);
    try {
      if (mode === 'edit' && previousMaxLevel !== null && nextMaxLevel !== previousMaxLevel) {
        const confirmed = await new Promise<boolean>((resolve) => {
          Modal.confirm({
            title: expandedLevelRange ? '确认扩大最高等级' : '确认缩小最高等级',
            content: expandedLevelRange
              ? `最高等级将从 Lv${previousMaxLevel} 扩大至 Lv${nextMaxLevel}。已有按技能等级取值的参数将由服务端为新增 Lv${expandedLevelRange.minLevel}～Lv${expandedLevelRange.maxLevel} 补 0；保存后请按来源逐项核对并填写新增等级数值。`
              : `高于 Lv${nextMaxLevel} 的技能等级参数值将被删除`,
            okText: '确认保存',
            cancelText: '取消',
            onOk: () => resolve(true),
            onCancel: () => resolve(false)
          });
        });
        if (!confirmed || saveRequestSerial.current !== saveSerial) return;
      }

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
            loadedSkill!.skillKey,
            token,
            buildUpdateSkillRequest(validation.normalized)
          );
      if (saveRequestSerial.current !== saveSerial) return;
      onDirtyChange(false);
      await onSaved(result.data, { expandedLevelRange });
    } catch (error) {
      if (saveRequestSerial.current !== saveSerial) return;
      const mapped = mapSkillFieldIssues(error);
      setErrors(mapped.fieldErrors);
      setCategoryIndexErrors(mapped.categoryIndexErrors);
      setSaveError(composeSaveError(error, mapped.unmappedMessages));
    } finally {
      if (saveRequestSerial.current === saveSerial) setSaving(false);
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
            <Button type="primary" loading={saving} disabled={!detailReady} onClick={() => void save()}>保存</Button>
          ) : null}
        </Space>
      }
    >
      <Space direction="vertical" size="medium" style={{ width: '100%' }}>
        {saveError ? <Alert type="error" content={saveError} /> : null}
        {loadError ? (
          <Alert type="error" content={loadError}
            action={<Button size="mini" onClick={() => setDetailAttempt((attempt) => attempt + 1)}>重试</Button>} />
        ) : null}
        {detailReady ? (
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
        ) : !loadError ? <Alert type="info" content="正在加载技能详情…" /> : null}
        {readOnly && loadedSkill && detailReady ? (
          <Typography.Text type="secondary">
            创建时间：{loadedSkill.createdAt || '—'} · 更新时间：{loadedSkill.updatedAt || '—'}
          </Typography.Text>
        ) : null}
      </Space>
    </Modal>
  );
}
