import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space, Typography } from '@arco-design/web-react';
import { useEffect, useMemo, useState } from 'react';
import { getErrorMessage } from '../../../services/apiClient';
import { createModifierZone, updateModifierZone } from '../../../services/modifierZoneClient';
import type {
  ModifierZone,
  ModifierZoneApplicationStage,
  ModifierZoneCalculationMode,
  ModifierZoneDomain
} from '../../../types/modifierZone';
import {
  allowedApplicationStages,
  allowedCalculationModes,
  APPLICATION_STAGE_LABELS,
  CALCULATION_MODE_LABELS,
  DOMAIN_LABELS,
  modifierZoneFieldIssues,
  validateModifierZoneDraft,
  type ModifierZoneDraft,
  type ModifierZoneDraftErrors
} from './modifierZoneForm';

export type ModifierZoneEditorMode = 'create' | 'view' | 'edit';

type Props = {
  visible: boolean;
  mode: ModifierZoneEditorMode;
  modifierZone: ModifierZone | null;
  initialDomain?: ModifierZoneDomain;
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onClose: () => void;
  onSaved: (modifierZone: ModifierZone) => void | Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
};

const EMPTY_DRAFT: ModifierZoneDraft = {
  modifierZoneKey: '', name: '', domain: '', calculationMode: '', applicationStage: '',
  description: '', sortOrder: '0'
};

function titleFor(mode: ModifierZoneEditorMode): string {
  if (mode === 'create') return '新增乘区';
  if (mode === 'edit') return '编辑乘区';
  return '查看乘区';
}

export function ModifierZoneEditorModal({
  visible, mode, modifierZone, apiBaseUrl, selectedGameId, adminToken,
  initialDomain, onClose, onSaved, onDirtyChange
}: Props) {
  const initial = useMemo<ModifierZoneDraft>(() => modifierZone ? {
    modifierZoneKey: modifierZone.modifierZoneKey,
    name: modifierZone.name,
    domain: modifierZone.domain,
    calculationMode: modifierZone.calculationMode,
    applicationStage: modifierZone.applicationStage,
    description: modifierZone.description ?? '',
    sortOrder: String(modifierZone.sortOrder)
  } : { ...EMPTY_DRAFT, domain: initialDomain ?? '' }, [initialDomain, modifierZone]);
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<ModifierZoneDraftErrors>({});
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

  const replaceDraft = (next: ModifierZoneDraft) => {
    setDraft(next);
    setErrors({});
    setSaveError(null);
    onDirtyChange(JSON.stringify(next) !== JSON.stringify(initial));
  };

  const patch = (field: keyof ModifierZoneDraft, value: string) => {
    replaceDraft({ ...draft, [field]: value });
  };

  const close = () => {
    if (saving) return;
    onDirtyChange(false);
    onClose();
  };

  const save = async () => {
    const nextErrors = validateModifierZoneDraft(draft, mode === 'create');
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    if (!selectedGameId) return setSaveError('请先选择游戏。');
    const token = adminToken.trim();
    if (!token) return setSaveError('请先配置 Admin Token。');
    setSaving(true);
    setSaveError(null);
    try {
      const body = {
        name: draft.name.trim(),
        domain: draft.domain as ModifierZoneDomain,
        calculationMode: draft.calculationMode as ModifierZoneCalculationMode,
        applicationStage: draft.applicationStage as ModifierZoneApplicationStage,
        description: draft.description.trim() || null,
        status: modifierZone?.status ?? 'ENABLED' as const,
        sortOrder: Number(draft.sortOrder)
      };
      const result = mode === 'create'
        ? await createModifierZone(apiBaseUrl, selectedGameId, token, {
            modifierZoneKey: draft.modifierZoneKey.trim(), ...body
          })
        : await updateModifierZone(
            apiBaseUrl, selectedGameId, modifierZone!.modifierZoneKey, token, body
          );
      onDirtyChange(false);
      await onSaved(result.data);
    } catch (error) {
      const fieldErrors: ModifierZoneDraftErrors = {};
      for (const issue of modifierZoneFieldIssues(error)) {
        if (issue.field in draft) fieldErrors[issue.field as keyof ModifierZoneDraft] = issue.message;
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
      footer={<Space>
        <Button onClick={close} disabled={saving}>{readOnly ? '关闭' : '取消'}</Button>
        {!readOnly ? <Button type="primary" loading={saving} onClick={() => void save()}>保存</Button> : null}
      </Space>}
    >
      <Space direction="vertical" size="medium" style={{ width: '100%' }}>
        {saveError ? <Alert type="error" content={saveError} /> : null}
        <Form layout="vertical">
          <Form.Item label="乘区标识" required validateStatus={errors.modifierZoneKey ? 'error' : undefined} help={errors.modifierZoneKey}>
            <Input aria-label="乘区标识" value={draft.modifierZoneKey} disabled={readOnly || mode === 'edit' || saving} maxLength={64} onChange={(value) => patch('modifierZoneKey', value)} />
          </Form.Item>
          <Form.Item label="乘区名称" required validateStatus={errors.name ? 'error' : undefined} help={errors.name}>
            <Input aria-label="乘区名称" value={draft.name} disabled={readOnly || saving} maxLength={100} onChange={(value) => patch('name', value)} />
          </Form.Item>
          <Form.Item label="作用域" required validateStatus={errors.domain ? 'error' : undefined} help={errors.domain}>
            <Select aria-label="乘区作用域" value={draft.domain || undefined} disabled={readOnly || saving} options={Object.entries(DOMAIN_LABELS).map(([value, label]) => ({ value, label }))} onChange={(value) => replaceDraft({ ...draft, domain: value as ModifierZoneDomain, calculationMode: '', applicationStage: '' })} />
          </Form.Item>
          <Form.Item label="计算方式" required validateStatus={errors.calculationMode ? 'error' : undefined} help={errors.calculationMode}>
            <Select aria-label="乘区计算方式" value={draft.calculationMode || undefined} disabled={readOnly || saving || !draft.domain} options={allowedCalculationModes(draft.domain).map((value) => ({ value, label: CALCULATION_MODE_LABELS[value] }))} onChange={(value) => replaceDraft({ ...draft, calculationMode: value as ModifierZoneCalculationMode, applicationStage: '' })} />
          </Form.Item>
          <Form.Item label="应用阶段" required validateStatus={errors.applicationStage ? 'error' : undefined} help={errors.applicationStage}>
            <Select aria-label="乘区应用阶段" value={draft.applicationStage || undefined} disabled={readOnly || saving || !draft.calculationMode} options={allowedApplicationStages(draft.domain, draft.calculationMode).map((value) => ({ value, label: APPLICATION_STAGE_LABELS[value] }))} onChange={(value) => patch('applicationStage', String(value))} />
          </Form.Item>
          <Form.Item label="说明" validateStatus={errors.description ? 'error' : undefined} help={errors.description}>
            <Input.TextArea aria-label="说明" value={draft.description} disabled={readOnly || saving} maxLength={2000} showWordLimit autoSize={{ minRows: 3, maxRows: 8 }} onChange={(value) => patch('description', value)} />
          </Form.Item>
          <Form.Item label="排序" required validateStatus={errors.sortOrder ? 'error' : undefined} help={errors.sortOrder}>
            <InputNumber aria-label="排序" value={draft.sortOrder ? Number(draft.sortOrder) : undefined} disabled={readOnly || saving} min={0} precision={0} style={{ width: '100%' }} onChange={(value) => patch('sortOrder', value === undefined ? '' : String(value))} />
          </Form.Item>
        </Form>
        {readOnly && modifierZone ? <Typography.Text type="secondary">状态：{modifierZone.status === 'ENABLED' ? '启用' : '停用'}</Typography.Text> : null}
      </Space>
    </Modal>
  );
}
