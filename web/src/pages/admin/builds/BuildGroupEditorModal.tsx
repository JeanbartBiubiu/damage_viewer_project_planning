import { Alert, Button, Form, Input, Modal, Select, Space, Spin, Typography } from '@arco-design/web-react';
import { useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '../../../services/apiClient';
import { createBuildGroup, getBuildGroup, listBuildGroups, listBuildOptions, updateBuildGroup } from '../../../services/buildClient';
import type { BuildConfigurationMode, BuildGroup, BuildOption } from '../../../types/build';
import {
  applySlotPatch,
  buildErrorMessage,
  buildFieldErrors,
  buildReadbackConfirmedMissing,
  buildWriteResultIsUncertain,
  emptySlotDraft,
  moveOrdered,
  slotsToDraft,
  validateGroupDraft,
  type BuildFieldErrors,
  type BuildGroupDraft,
  type SlotDraft
} from './buildForm';

type Props = {
  mode: 'create' | 'view' | 'edit';
  systemKey: string;
  groupKey: string | null;
  configurationMode: BuildConfigurationMode;
  apiBaseUrl: string;
  selectedGameId: string;
  adminToken: string;
  onClose: () => void;
  onSaved: (group: BuildGroup) => void;
  onDirtyChange: (dirty: boolean) => void;
};

const blank: BuildGroupDraft = { groupKey: '', name: '', description: '', sortOrder: '0', slots: [] };

export function BuildGroupEditorModal(props: Props) {
  const { mode, systemKey, groupKey, configurationMode, apiBaseUrl, selectedGameId, adminToken, onClose, onSaved, onDirtyChange } = props;
  const [draft, setDraft] = useState<BuildGroupDraft>(blank);
  const [initial, setInitial] = useState<BuildGroupDraft>(blank);
  const [options, setOptions] = useState<BuildOption[]>([]);
  const [otherGroups, setOtherGroups] = useState<BuildGroup[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<BuildFieldErrors>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const active = useRef(true);
  const writing = useRef(false);
  const readOnly = mode === 'view';
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const disabled = readOnly || !loaded || saving || savedKey !== null;
  const groupErrors = Object.entries(errors).filter(([path]) => path === 'slots' || path.startsWith('slots['));
  const load = async () => {
    setLoading(true); setError(null); setLoaded(false);
    try {
      const [optionResult, groupResult] = await Promise.all([
        listBuildOptions(apiBaseUrl, selectedGameId, systemKey, adminToken.trim()),
        listBuildGroups(apiBaseUrl, selectedGameId, systemKey, adminToken.trim())
      ]);
      const current = groupKey ? await getBuildGroup(apiBaseUrl, selectedGameId, systemKey, groupKey, adminToken.trim()) : null;
      if (!active.current) return;
      const value: BuildGroupDraft = current ? {
        groupKey: current.data.groupKey, name: current.data.name, description: current.data.description ?? '',
        sortOrder: String(current.data.sortOrder), slots: slotsToDraft(current.data.slots)
      } : blank;
      setDraft(value); setInitial(value); setOptions(optionResult.data.items);
      setOtherGroups(groupResult.data.items.filter(item => item.groupKey !== groupKey));
      setLoaded(true);
    } catch (cause) { if (active.current) setError(getErrorMessage(cause)); }
    finally { if (active.current) setLoading(false); }
  };
  useEffect(() => { active.current = true; void load(); return () => { active.current = false; onDirtyChange(false); }; }, []);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  const patchSlot = (index: number, update: Partial<SlotDraft>) => setDraft({
    ...draft, slots: draft.slots.map((slot, slotIndex) => slotIndex === index ? applySlotPatch(slot, update) : slot)
  });
  const removeSlot = (index: number) => {
    const slot = draft.slots[index];
    if (!slot) return;
    if (slot.persisted && !window.confirm(`删除位置「${slot.name || slot.slotKey}」后需要另行新建。这不是修改位置标识。确定删除吗？`)) return;
    setDraft({ ...draft, slots: draft.slots.filter((_, slotIndex) => slotIndex !== index) });
  };
  const close = () => {
    if (writing.current || (dirty && !window.confirm('分组修改尚未完成，确定关闭吗？'))) return;
    onDirtyChange(false); onClose();
  };
  const save = async () => {
    if (writing.current || readOnly || !loaded) return;
    const checked = validateGroupDraft(draft, mode === 'create', options, otherGroups, configurationMode);
    setErrors(checked);
    if (Object.keys(checked).length) return;
    writing.current = true; setSaving(true); setError(null);
    let writtenKey = savedKey;
    const attemptedKey = savedKey ?? (mode === 'create' ? draft.groupKey.trim() : groupKey!);
    try {
      if (!writtenKey) {
        const body = {
          name: draft.name.trim(), description: draft.description.trim() || null, sortOrder: Number(draft.sortOrder),
          slots: draft.slots.map(slot => ({
            slotKey: slot.slotKey.trim(), name: slot.name.trim(), minimumSelections: Number(slot.minimumSelections),
            maximumSelections: Number(slot.maximumSelections), optionKeys: [...slot.optionKeys]
          }))
        };
        const result = mode === 'create'
          ? await createBuildGroup(apiBaseUrl, selectedGameId, systemKey, adminToken.trim(), { groupKey: draft.groupKey.trim(), ...body })
          : await updateBuildGroup(apiBaseUrl, selectedGameId, systemKey, groupKey!, adminToken.trim(), body);
        writtenKey = result.data.groupKey;
        if (!active.current) return;
        setSavedKey(writtenKey);
      }
      const result = await getBuildGroup(apiBaseUrl, selectedGameId, systemKey, writtenKey, adminToken.trim());
      if (!active.current) return;
      onDirtyChange(false); onSaved(result.data);
    } catch (cause) {
      if (active.current) {
        if (writtenKey && mode === 'create' && buildReadbackConfirmedMissing(cause)) {
          setSavedKey(null);
          setError(`独立回读确认「${writtenKey}」尚未创建，可修正后重新保存。${buildErrorMessage(cause)}`);
        } else {
          const uncertain = !writtenKey && buildWriteResultIsUncertain(cause);
          if (uncertain) setSavedKey(attemptedKey);
          setErrors(buildFieldErrors(cause));
          setError(`${writtenKey || uncertain ? '写入结果不明；后续只会按标识重新读取，不会重放写入。' : ''}${buildErrorMessage(cause)}`);
        }
      }
    } finally { writing.current = false; if (active.current) setSaving(false); }
  };
  const optionChoices = options.map(option => ({ value: option.optionKey, label: `${option.name} · ${option.optionKey}` }));
  return <Modal visible title={mode === 'create' ? '新增分组' : mode === 'edit' ? '编辑分组' : '查看分组'} style={{ width: 980 }} maskClosable={false} onCancel={close}
    footer={<Space><Button disabled={saving} onClick={close}>{readOnly ? '关闭' : '取消'}</Button>{!readOnly ? <Button type="primary" loading={saving} disabled={!loaded || loading} onClick={() => void save()}>{savedKey ? '重新回读' : '保存'}</Button> : null}</Space>}>
    {error ? <Alert type="error" content={error} style={{ marginBottom: 12 }} /> : null}
    {loading ? <Spin tip="正在读取分组" /> : !loaded ? <Button onClick={() => void load()}>重新读取</Button> : null}
    {loaded ? <Form layout="vertical">
      <Alert type="info" style={{ marginBottom: 12 }} content="已保存的位置标识不能直接改写。若要更换，请删除该位置后再新建。同一可选项可以出现在不同位置，每个位置仍是独立选择。" />
      {groupErrors.length ? <Alert type="error" style={{ marginBottom: 12 }} content={<ul style={{ margin: 0, paddingLeft: 20 }}>
        {groupErrors.map(([path, message]) => <li key={path}>{path}：{message}</li>)}
      </ul>} /> : null}
      <Form.Item label="分组标识" required help={errors.groupKey} validateStatus={errors.groupKey ? 'error' : undefined}>
        <Input aria-label="分组标识" value={draft.groupKey} disabled={disabled || mode !== 'create'} maxLength={64} onChange={groupKeyValue => setDraft({ ...draft, groupKey: groupKeyValue })} />
      </Form.Item>
      <Form.Item label="分组名称" required help={errors.name} validateStatus={errors.name ? 'error' : undefined}>
        <Input aria-label="分组名称" value={draft.name} disabled={disabled} maxLength={100} onChange={name => setDraft({ ...draft, name })} />
      </Form.Item>
      <Form.Item label="显示顺序" required help={errors.sortOrder} validateStatus={errors.sortOrder ? 'error' : undefined}>
        <Input aria-label="分组显示顺序" value={draft.sortOrder} disabled={disabled} onChange={sortOrder => setDraft({ ...draft, sortOrder })} />
      </Form.Item>
      <Form.Item label="说明" help={errors.description} validateStatus={errors.description ? 'error' : undefined}>
        <Input.TextArea aria-label="分组说明" value={draft.description} disabled={disabled} maxLength={2000} showWordLimit autoSize={{ minRows: 2, maxRows: 5 }} onChange={description => setDraft({ ...draft, description })} />
      </Form.Item>
      {draft.slots.map((slot, index) => <section key={`${slot.persisted}:${slot.slotKey}:${index}`} aria-label={`位置${index + 1}`} style={{ border: '1px solid var(--color-border-2)', padding: 12, marginBottom: 12 }}>
        <Space wrap>
          <Input aria-label={`位置${index + 1}标识`} addBefore="位置标识" value={slot.slotKey} disabled={disabled || slot.persisted} maxLength={64} onChange={slotKey => patchSlot(index, { slotKey })} />
          <Input aria-label={`位置${index + 1}名称`} addBefore="名称" value={slot.name} disabled={disabled} maxLength={100} onChange={name => patchSlot(index, { name })} />
          <Input aria-label={`位置${index + 1}最少`} addBefore="最少" value={slot.minimumSelections} disabled={disabled} onChange={minimumSelections => patchSlot(index, { minimumSelections })} />
          <Input aria-label={`位置${index + 1}最多`} addBefore="最多" value={slot.maximumSelections} disabled={disabled} onChange={maximumSelections => patchSlot(index, { maximumSelections })} />
          <Button size="mini" disabled={disabled || index === 0} onClick={() => setDraft({ ...draft, slots: moveOrdered(draft.slots, index, -1) })}>上移位置</Button>
          <Button size="mini" disabled={disabled || index === draft.slots.length - 1} onClick={() => setDraft({ ...draft, slots: moveOrdered(draft.slots, index, 1) })}>下移位置</Button>
          <Button size="mini" status="danger" disabled={disabled} onClick={() => removeSlot(index)}>删除位置</Button>
        </Space>
        {slot.persisted ? <Typography.Paragraph type="secondary">此位置标识已存在，不能当作普通改名。删除后新建才会使用新的位置标识。</Typography.Paragraph> : null}
        {errors[`slots[${index}].slotKey`] || errors[`slots[${index}].name`] || errors[`slots[${index}].minimumSelections`]
          ? <Alert type="error" content={errors[`slots[${index}].slotKey`] || errors[`slots[${index}].name`] || errors[`slots[${index}].minimumSelections`]} /> : null}
        {slot.optionKeys.map((optionKey, position) => <Space key={position} style={{ marginTop: 8 }}>
          <Select aria-label={`位置${index + 1}候选${position + 1}`} style={{ width: 420 }} showSearch allowClear disabled={disabled} value={optionKey || undefined}
            options={optionChoices} onChange={(value: string | undefined) => patchSlot(index, { optionKeys: slot.optionKeys.map((key, keyIndex) => keyIndex === position ? value ?? '' : key) })} />
          <Button size="mini" disabled={disabled || position === 0} onClick={() => patchSlot(index, { optionKeys: moveOrdered(slot.optionKeys, position, -1) })}>上移候选</Button>
          <Button size="mini" disabled={disabled || position === slot.optionKeys.length - 1} onClick={() => patchSlot(index, { optionKeys: moveOrdered(slot.optionKeys, position, 1) })}>下移候选</Button>
          <Button size="mini" status="danger" disabled={disabled} onClick={() => patchSlot(index, { optionKeys: slot.optionKeys.filter((_, keyIndex) => keyIndex !== position) })}>移除候选</Button>
          {errors[`slots[${index}].optionKeys[${position}]`] ? <Typography.Text type="error">{errors[`slots[${index}].optionKeys[${position}]`]}</Typography.Text> : null}
        </Space>)}
        {!readOnly ? <Button style={{ marginTop: 8 }} disabled={disabled} onClick={() => patchSlot(index, { optionKeys: [...slot.optionKeys, ''] })}>添加候选</Button> : null}
      </section>)}
      {!readOnly ? <Button disabled={disabled} onClick={() => setDraft({ ...draft, slots: [...draft.slots, emptySlotDraft()] })}>添加位置</Button> : null}
    </Form> : null}
  </Modal>;
}
