import { Alert, Button, Form, Input, Modal, Space, Typography } from '@arco-design/web-react';
import { useEffect, useMemo, useState } from 'react';
import { getErrorMessage } from '../../../services/apiClient';
import { createCharacter, updateCharacter } from '../../../services/characterClient';
import type { Character } from '../../../types/character';
import {
  characterFieldIssues,
  validateCharacterDraft,
  type CharacterDraft,
  type CharacterDraftErrors
} from './characterForm';

export type CharacterEditorMode = 'create' | 'view' | 'edit';

type CharacterEditorModalProps = {
  visible: boolean;
  mode: CharacterEditorMode;
  character: Character | null;
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onClose: () => void;
  onSaved: (character: Character) => void | Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
};

const EMPTY_DRAFT: CharacterDraft = { characterKey: '', name: '', description: '' };

function titleFor(mode: CharacterEditorMode): string {
  if (mode === 'create') return '新增角色';
  if (mode === 'edit') return '编辑角色';
  return '查看角色';
}

export function CharacterEditorModal({
  visible,
  mode,
  character,
  apiBaseUrl,
  selectedGameId,
  adminToken,
  onClose,
  onSaved,
  onDirtyChange
}: CharacterEditorModalProps) {
  const initial = useMemo<CharacterDraft>(() => character ? {
    characterKey: character.characterKey,
    name: character.name,
    description: character.description ?? ''
  } : EMPTY_DRAFT, [character]);
  const [draft, setDraft] = useState<CharacterDraft>(initial);
  const [errors, setErrors] = useState<CharacterDraftErrors>({});
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

  const patchDraft = (field: keyof CharacterDraft, value: string) => {
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
    const nextErrors = validateCharacterDraft(draft, mode === 'create');
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
        ? await createCharacter(apiBaseUrl, selectedGameId, token, {
            characterKey: draft.characterKey,
            name: draft.name.trim(),
            description: draft.description.trim() || null
          })
        : await updateCharacter(apiBaseUrl, selectedGameId, character!.characterKey, token, {
            name: draft.name.trim(),
            description: draft.description.trim() || null
          });
      onDirtyChange(false);
      await onSaved(result.data);
    } catch (error) {
      const fieldErrors: CharacterDraftErrors = {};
      for (const issue of characterFieldIssues(error)) {
        if (issue.field === 'characterKey' || issue.field === 'name' || issue.field === 'description') {
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
          <Form.Item
            label="角色标识"
            required
            validateStatus={errors.characterKey ? 'error' : undefined}
            help={errors.characterKey}
          >
            <Input
              aria-label="角色标识"
              value={draft.characterKey}
              disabled={readOnly || mode === 'edit' || saving}
              maxLength={64}
              onChange={(value) => patchDraft('characterKey', value)}
            />
          </Form.Item>
          <Form.Item
            label="角色名称"
            required
            validateStatus={errors.name ? 'error' : undefined}
            help={errors.name}
          >
            <Input
              aria-label="角色名称"
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
        </Form>
        {readOnly && character ? (
          <Typography.Text type="secondary">
            创建时间：{character.createdAt || '—'} · 更新时间：{character.updatedAt || '—'}
          </Typography.Text>
        ) : null}
      </Space>
    </Modal>
  );
}
