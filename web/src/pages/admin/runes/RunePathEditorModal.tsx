import { Alert, Button, Form, Input, Modal, Select, Space, Spin, Typography } from '@arco-design/web-react';
import { useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '../../../services/apiClient';
import { createRunePath, getRunePath, listRunes, updateRunePath } from '../../../services/runeClient';
import { RUNE_CATEGORIES, RUNE_CATEGORY_LABELS, RUNE_PATH_KIND_LABELS, type Rune, type RuneCategory, type RunePath, type RunePathKind, type RuneSlot } from '../../../types/rune';
import type { RuneEditorContext, RuneEditorMode } from './RuneEditorModal';
import { moveOrdered, normalizeRuneSlots, runeErrorMessage, runeFieldErrors, validateRunePathDraft, type RuneFieldErrors, type RunePathDraft } from './runeForm';

type Props = RuneEditorContext & { mode: RuneEditorMode; pathKey: string | null; onSaved: (path: RunePath) => void };
const blank: RunePathDraft = { pathKey: '', name: '', description: '', kind: 'RUNE_PATH', sortOrder: '0', slots: [] };
export function RunePathEditorModal({ mode, pathKey, apiBaseUrl, selectedGameId, adminToken, onClose, onSaved, onDirtyChange }: Props) {
  const [draft, setDraft] = useState<RunePathDraft>(blank);
  const [initial, setInitial] = useState<RunePathDraft>(blank);
  const [runes, setRunes] = useState<Rune[]>([]);
  const [loaded, setLoaded] = useState(false);
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
    setLoading(true); setError(null); setLoaded(false);
    try {
      const [catalog, result] = await Promise.all([
        listRunes(apiBaseUrl, selectedGameId, adminToken.trim()),
        pathKey ? getRunePath(apiBaseUrl, selectedGameId, pathKey, adminToken.trim()) : Promise.resolve(null)
      ]);
      if (!active.current) return;
      const row = result?.data;
      const value: RunePathDraft = row ? { pathKey: row.pathKey, name: row.name, description: row.description ?? '', kind: row.kind, sortOrder: String(row.sortOrder), slots: row.slots } : blank;
      setDraft(value); setInitial(value); setRunes(catalog.data.items); setLoaded(true);
    } catch (cause) { if (active.current) setError(getErrorMessage(cause)); }
    finally { if (active.current) setLoading(false); }
  };
  useEffect(() => { active.current = true; void load(); return () => { active.current = false; onDirtyChange(false); }; }, []);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  const patch = (update: Partial<RunePathDraft>) => { setDraft({ ...draft, ...update }); setErrors({}); setError(null); };
  const patchSlot = (index: number, update: Partial<RuneSlot>) => patch({ slots: draft.slots.map((slot, i) => i === index ? { ...slot, ...update } : slot) });
  const close = () => {
    if (writing.current || (dirty && !window.confirm('分组与槽位修改尚未完成，确定关闭吗？'))) return;
    onDirtyChange(false); onClose();
  };
  const save = async () => {
    if (writing.current || readOnly || !loaded) return;
    if (!adminToken.trim()) { setError('请先配置 Admin Token。'); return; }
    const checked = validateRunePathDraft(draft, mode === 'create', runes); setErrors(checked);
    if (Object.keys(checked).length) return;
    writing.current = true; setSaving(true); setError(null);
    let writtenKey = savedKey;
    try {
      if (!writtenKey) {
        const body = { name: draft.name.trim(), description: draft.description.trim() || null, kind: draft.kind, sortOrder: Number(draft.sortOrder), slots: normalizeRuneSlots(draft.slots) };
        const result = mode === 'create'
          ? await createRunePath(apiBaseUrl, selectedGameId, adminToken.trim(), { pathKey: draft.pathKey.trim(), ...body })
          : await updateRunePath(apiBaseUrl, selectedGameId, pathKey!, adminToken.trim(), body);
        writtenKey = result.data.pathKey;
        if (!active.current) return;
        setSavedKey(writtenKey);
      }
      const result = await getRunePath(apiBaseUrl, selectedGameId, writtenKey, adminToken.trim());
      if (!active.current) return;
      onDirtyChange(false); onSaved(result.data);
    } catch (cause) {
      if (active.current) { setErrors(runeFieldErrors(cause)); setError(`${writtenKey ? '已写入，最终回读失败；可重新回读。' : ''}${runeErrorMessage(cause)}`); }
    } finally { writing.current = false; if (active.current) setSaving(false); }
  };
  const field = (name: string) => ({ help: errors[name], validateStatus: errors[name] ? 'error' as const : undefined });
  return <Modal visible title={mode === 'create' ? '新增符文分组' : mode === 'edit' ? '编辑分组与槽位' : '查看分组与槽位'} style={{ width: 'calc(100vw - 80px)', maxWidth: 1050 }} maskClosable={false} onCancel={close}
    footer={<Space><Button disabled={saving} onClick={close}>{readOnly ? '关闭' : '取消'}</Button>{!readOnly ? <Button type="primary" loading={saving} disabled={!loaded || loading} onClick={() => void save()}>{savedKey ? '重新回读' : '保存完整布局'}</Button> : null}</Space>}>
    {error ? <Alert type="error" content={error} style={{ marginBottom: 12 }} /> : null}
    {loading ? <Spin tip="正在读取布局与符文目录" /> : !loaded ? <Button onClick={() => void load()}>重新读取</Button> : null}
    <Form layout="vertical">
      <Form.Item label="分组标识" required {...field('pathKey')}><Input aria-label="分组标识" value={draft.pathKey} disabled={disabled || mode !== 'create'} maxLength={64} onChange={pathKey => patch({ pathKey })} /></Form.Item>
      <Form.Item label="分组名称" required {...field('name')}><Input aria-label="分组名称" value={draft.name} disabled={disabled} maxLength={100} onChange={name => patch({ name })} /></Form.Item>
      <Form.Item label="分组种类" required {...field('kind')}>
        <Select aria-label="分组种类" value={draft.kind} disabled={disabled || initial.slots.length > 0 || draft.slots.length > 0} options={Object.entries(RUNE_PATH_KIND_LABELS).map(([value, label]) => ({ value, label }))} onChange={(kind: RunePathKind) => patch({ kind })} />
        {initial.slots.length > 0 ? <Typography.Text type="secondary">已有槽位时不能修改种类；需先移除槽位并保存空布局。</Typography.Text> : null}
      </Form.Item>
      <Form.Item label="分组排序" required {...field('sortOrder')}><Input aria-label="分组排序" value={draft.sortOrder} disabled={disabled} onChange={sortOrder => patch({ sortOrder })} /></Form.Item>
      <Form.Item label="说明" {...field('description')}><Input.TextArea aria-label="分组说明" value={draft.description} disabled={disabled} maxLength={2000} autoSize={{ minRows: 2, maxRows: 5 }} onChange={description => patch({ description })} /></Form.Item>
      <Typography.Title heading={6}>有序槽位</Typography.Title>
      <Typography.Paragraph type="secondary">槽位从上到下、候选从上到下保存顺序。可以保存空布局或空槽位；同一属性碎片可以跨行复用。跨分组占用由保存时统一检查。</Typography.Paragraph>
      {errors.slots ? <Alert type="error" content={errors.slots} /> : null}
      {loaded && draft.slots.length === 0 ? <Typography.Paragraph type="secondary">当前为空布局。</Typography.Paragraph> : null}
      {draft.slots.map((slot, index) => <section key={index} aria-label={`槽位${index + 1}`} style={{ border: '1px solid var(--color-border-2)', padding: 16, marginBottom: 16 }}>
        <Space style={{ marginBottom: 12 }}>
          <Typography.Text bold>槽位 {index + 1}</Typography.Text>
          {!readOnly ? <><Button size="mini" disabled={disabled || index === 0} onClick={() => patch({ slots: moveOrdered(draft.slots, index, -1) })}>上移槽位</Button><Button size="mini" disabled={disabled || index === draft.slots.length - 1} onClick={() => patch({ slots: moveOrdered(draft.slots, index, 1) })}>下移槽位</Button><Button size="mini" status="danger" disabled={disabled} onClick={() => patch({ slots: draft.slots.filter((_, i) => i !== index) })}>移除槽位</Button></> : null}
        </Space>
        <Form.Item label="槽位名称" required {...field(`slots[${index}].name`)}><Input aria-label={`槽位${index + 1}名称`} value={slot.name} disabled={disabled} maxLength={100} onChange={name => patchSlot(index, { name })} /></Form.Item>
        <Form.Item label="槽位类别" required {...field(`slots[${index}].category`)}>
          <Select aria-label={`槽位${index + 1}类别`} value={slot.category} disabled={disabled} options={RUNE_CATEGORIES.filter(value => (draft.kind === 'SHARD_GROUP') === (value === 'SHARD')).map(value => ({ value, label: RUNE_CATEGORY_LABELS[value] }))} onChange={(category: RuneCategory) => patchSlot(index, { category })} />
        </Form.Item>
        {errors[`slots[${index}].runeKeys`] ? <Alert type="error" content={errors[`slots[${index}].runeKeys`]} /> : null}
        {slot.runeKeys.map((runeKey, position) => {
          const options = runes.filter(rune => rune.category === slot.category).map(rune => ({ value: rune.runeKey, label: `${rune.name} · ${rune.runeKey}` }));
          if (runeKey && !options.some(option => option.value === runeKey)) options.push({ value: runeKey, label: `${runes.find(rune => rune.runeKey === runeKey)?.name ?? '未找到'} · ${runeKey}（类别不符或不可用）` });
          return <Form.Item key={position} label={`候选 ${position + 1}`} {...field(`slots[${index}].runeKeys[${position}]`)}>
            <Space wrap>
              <Select aria-label={`槽位${index + 1}候选${position + 1}`} style={{ width: 380 }} showSearch allowClear value={runeKey || undefined} disabled={disabled}
                options={options} filterOption={(input, option) => String(option.props.children).toLowerCase().includes(input.trim().toLowerCase())}
                onChange={(value: string | undefined) => patchSlot(index, { runeKeys: slot.runeKeys.map((key, i) => i === position ? value ?? '' : key) })} />
              {!readOnly ? <><Button size="mini" disabled={disabled || position === 0} onClick={() => patchSlot(index, { runeKeys: moveOrdered(slot.runeKeys, position, -1) })}>上移候选</Button><Button size="mini" disabled={disabled || position === slot.runeKeys.length - 1} onClick={() => patchSlot(index, { runeKeys: moveOrdered(slot.runeKeys, position, 1) })}>下移候选</Button><Button size="mini" status="danger" disabled={disabled} onClick={() => patchSlot(index, { runeKeys: slot.runeKeys.filter((_, i) => i !== position) })}>移除候选</Button></> : null}
            </Space>
          </Form.Item>;
        })}
        {slot.runeKeys.length === 0 ? <Typography.Paragraph type="secondary">此槽位暂无候选。</Typography.Paragraph> : null}
        {!readOnly ? <Button disabled={disabled} onClick={() => patchSlot(index, { runeKeys: [...slot.runeKeys, ''] })}>添加候选</Button> : null}
      </section>)}
      {!readOnly ? <Button disabled={disabled} onClick={() => patch({ slots: [...draft.slots, { name: '', category: draft.kind === 'SHARD_GROUP' ? 'SHARD' : 'MINOR', runeKeys: [] }] })}>添加槽位</Button> : null}
    </Form>
  </Modal>;
}
