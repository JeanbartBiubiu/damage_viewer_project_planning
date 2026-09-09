import { Alert, Button, Form, Input, Modal, Select, Space, Spin } from '@arco-design/web-react';
import { useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '../../../services/apiClient';
import { createRune, getRune, updateRune } from '../../../services/runeClient';
import { RUNE_CATEGORIES, RUNE_CATEGORY_LABELS, type Rune, type RuneCategory } from '../../../types/rune';
import { runeErrorMessage, runeFieldErrors, validateRuneDraft, type RuneDraft, type RuneFieldErrors } from './runeForm';

export type RuneEditorMode = 'create' | 'view' | 'edit';
export type RuneEditorContext = { apiBaseUrl: string; selectedGameId: string; adminToken: string; onClose: () => void; onDirtyChange: (dirty: boolean) => void };
type Props = RuneEditorContext & { mode: RuneEditorMode; runeKey: string | null; onSaved: (rune: Rune) => void };
const blank: RuneDraft = { runeKey: '', name: '', description: '', category: 'MINOR' };
export function RuneEditorModal({ mode, runeKey, apiBaseUrl, selectedGameId, adminToken, onClose, onSaved, onDirtyChange }: Props) {
  const [draft, setDraft] = useState<RuneDraft>(blank);
  const [initial, setInitial] = useState<RuneDraft>(blank);
  const [loaded, setLoaded] = useState(mode === 'create');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<RuneFieldErrors>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const active = useRef(true);
  const writing = useRef(false);
  const readOnly = mode === 'view';
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const disabled = readOnly || !loaded || saving || savedKey !== null;
  const load = async () => {
    if (!runeKey) return;
    setLoading(true); setError(null); setLoaded(false);
    try {
      const { data } = await getRune(apiBaseUrl, selectedGameId, runeKey, adminToken.trim());
      if (!active.current) return;
      const value = { runeKey: data.runeKey, name: data.name, description: data.description ?? '', category: data.category };
      setDraft(value); setInitial(value); setLoaded(true);
    } catch (cause) { if (active.current) setError(getErrorMessage(cause)); }
    finally { if (active.current) setLoading(false); }
  };
  useEffect(() => { active.current = true; void load(); return () => { active.current = false; onDirtyChange(false); }; }, []);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  const patch = (update: Partial<RuneDraft>) => { setDraft({ ...draft, ...update }); setErrors({}); setError(null); };
  const close = () => {
    if (writing.current || (dirty && !window.confirm('符文修改尚未完成，确定关闭吗？'))) return;
    onDirtyChange(false); onClose();
  };
  const save = async () => {
    if (writing.current || readOnly || !loaded) return;
    if (!adminToken.trim()) { setError('请先配置 Admin Token。'); return; }
    const checked = validateRuneDraft(draft, mode === 'create'); setErrors(checked);
    if (Object.keys(checked).length) return;
    writing.current = true; setSaving(true); setError(null);
    let writtenKey = savedKey;
    try {
      if (!writtenKey) {
        const body = { name: draft.name.trim(), description: draft.description.trim() || null, category: draft.category };
        const result = mode === 'create'
          ? await createRune(apiBaseUrl, selectedGameId, adminToken.trim(), { runeKey: draft.runeKey.trim(), ...body })
          : await updateRune(apiBaseUrl, selectedGameId, runeKey!, adminToken.trim(), body);
        writtenKey = result.data.runeKey;
        if (!active.current) return;
        setSavedKey(writtenKey);
      }
      const result = await getRune(apiBaseUrl, selectedGameId, writtenKey, adminToken.trim());
      if (!active.current) return;
      onDirtyChange(false); onSaved(result.data);
    } catch (cause) {
      if (active.current) { setErrors(runeFieldErrors(cause)); setError(`${writtenKey ? '已写入，最终回读失败；可重新回读。' : ''}${runeErrorMessage(cause)}`); }
    } finally { writing.current = false; if (active.current) setSaving(false); }
  };
  return <Modal visible title={mode === 'create' ? '新增符文' : mode === 'edit' ? '编辑符文' : '查看符文'} maskClosable={false} onCancel={close}
    footer={<Space><Button disabled={saving} onClick={close}>{readOnly ? '关闭' : '取消'}</Button>{!readOnly ? <Button type="primary" loading={saving} disabled={!loaded || loading} onClick={() => void save()}>{savedKey ? '重新回读' : '保存'}</Button> : null}</Space>}>
    {error ? <Alert type="error" content={error} style={{ marginBottom: 12 }} /> : null}
    {loading ? <Spin tip="正在读取符文" /> : !loaded ? <Button onClick={() => void load()}>重新读取</Button> : null}
    <Form layout="vertical">
      <Form.Item label="符文标识" required help={errors.runeKey} validateStatus={errors.runeKey ? 'error' : undefined}>
        <Input aria-label="符文标识" value={draft.runeKey} disabled={disabled || mode !== 'create'} maxLength={64} onChange={runeKey => patch({ runeKey })} />
      </Form.Item>
      <Form.Item label="符文名称" required help={errors.name} validateStatus={errors.name ? 'error' : undefined}>
        <Input aria-label="符文名称" value={draft.name} disabled={disabled} maxLength={100} onChange={name => patch({ name })} />
      </Form.Item>
      <Form.Item label="符文类别" required help={errors.category} validateStatus={errors.category ? 'error' : undefined}>
        <Select aria-label="符文类别" value={draft.category} disabled={disabled} options={RUNE_CATEGORIES.map(value => ({ value, label: RUNE_CATEGORY_LABELS[value] }))} onChange={(category: RuneCategory) => patch({ category })} />
      </Form.Item>
      <Form.Item label="说明" help={errors.description} validateStatus={errors.description ? 'error' : undefined}>
        <Input.TextArea aria-label="符文说明" value={draft.description} disabled={disabled} maxLength={2000} showWordLimit autoSize={{ minRows: 3, maxRows: 8 }} onChange={description => patch({ description })} />
      </Form.Item>
    </Form>
  </Modal>;
}
