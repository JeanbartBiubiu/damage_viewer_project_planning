import { Alert, Button, Form, Input, Modal, Space, Spin } from '@arco-design/web-react';
import { useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '../../../services/apiClient';
import { createBuildOption, getBuildOption, updateBuildOption } from '../../../services/buildClient';
import { BUILD_CONFIGURATION_MODE_LABELS, type BuildConfigurationMode, type BuildOption } from '../../../types/build';
import {
  buildErrorMessage,
  buildFieldErrors,
  buildReadbackConfirmedMissing,
  buildWriteResultIsUncertain,
  validateOptionDraft,
  type BuildFieldErrors,
  type BuildOptionDraft
} from './buildForm';

type Props = {
  mode: 'create' | 'view' | 'edit';
  systemKey: string;
  optionKey: string | null;
  configurationMode: BuildConfigurationMode;
  budgetEnabled: boolean;
  apiBaseUrl: string;
  selectedGameId: string;
  onClose: () => void;
  onSaved: (option: BuildOption) => void;
  onDirtyChange: (dirty: boolean) => void;
};

function blankDraft(mode: BuildConfigurationMode, budgetEnabled: boolean): BuildOptionDraft {
  return {
    optionKey: '', name: '', description: '', maxRank: mode === 'SLOT_SELECTION' ? '1' : '',
    rankCosts: [budgetEnabled ? '' : '0']
  };
}

export function BuildOptionEditorModal(props: Props) {
  const { mode, systemKey, optionKey, configurationMode, budgetEnabled, apiBaseUrl, selectedGameId, onClose, onSaved, onDirtyChange } = props;
  const [draft, setDraft] = useState<BuildOptionDraft>(() => blankDraft(configurationMode, budgetEnabled));
  const [initial, setInitial] = useState<BuildOptionDraft>(() => blankDraft(configurationMode, budgetEnabled));
  const [loaded, setLoaded] = useState(mode === 'create');
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
  const load = async () => {
    if (!optionKey) return;
    setLoading(true); setError(null); setLoaded(false);
    try {
      const { data } = await getBuildOption(apiBaseUrl, selectedGameId, systemKey, optionKey);
      if (!active.current) return;
      const value = { optionKey: data.optionKey, name: data.name, description: data.description ?? '', maxRank: String(data.maxRank), rankCosts: data.rankCosts.map(String) };
      setDraft(value); setInitial(value); setLoaded(true);
    } catch (cause) { if (active.current) setError(getErrorMessage(cause)); }
    finally { if (active.current) setLoading(false); }
  };
  useEffect(() => { active.current = true; void load(); return () => { active.current = false; onDirtyChange(false); }; }, []);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  const patch = (update: Partial<BuildOptionDraft>) => { setDraft({ ...draft, ...update }); setErrors({}); setError(null); };
  const rankCostError = errors.rankCosts ?? Object.entries(errors)
    .find(([field]) => field.startsWith('rankCosts['))?.[1];
  const close = () => {
    if (writing.current || (dirty && !window.confirm('可选项修改尚未完成，确定关闭吗？'))) return;
    onDirtyChange(false); onClose();
  };
  const save = async () => {
    if (writing.current || readOnly || !loaded) return;
    const checked = validateOptionDraft(draft, mode === 'create', configurationMode, budgetEnabled);
    setErrors(checked);
    if (Object.keys(checked).length) return;
    writing.current = true; setSaving(true); setError(null);
    let writtenKey = savedKey;
    const attemptedKey = savedKey ?? (mode === 'create' ? draft.optionKey.trim() : optionKey!);
    try {
      if (!writtenKey) {
        const body = { name: draft.name.trim(), description: draft.description.trim() || null, maxRank: Number(draft.maxRank), rankCosts: draft.rankCosts.map(Number) };
        const result = mode === 'create'
          ? await createBuildOption(apiBaseUrl, selectedGameId, systemKey, { optionKey: draft.optionKey.trim(), ...body })
          : await updateBuildOption(apiBaseUrl, selectedGameId, systemKey, optionKey!, body);
        writtenKey = result.data.optionKey;
        if (!active.current) return;
        setSavedKey(writtenKey);
      }
      const result = await getBuildOption(apiBaseUrl, selectedGameId, systemKey, writtenKey);
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
  return <Modal visible title={mode === 'create' ? '新增可选项' : mode === 'edit' ? '编辑可选项' : '查看可选项'} maskClosable={false} onCancel={close}
    footer={<Space><Button disabled={saving} onClick={close}>{readOnly ? '关闭' : '取消'}</Button>{!readOnly ? <Button type="primary" loading={saving} disabled={!loaded || loading} onClick={() => void save()}>{savedKey ? '重新回读' : '保存'}</Button> : null}</Space>}>
    {error ? <Alert type="error" content={error} style={{ marginBottom: 12 }} /> : null}
    {loading ? <Spin tip="正在读取可选项" /> : !loaded ? <Button onClick={() => void load()}>重新读取</Button> : null}
    {loaded ? <Form layout="vertical">
      <Alert type="info" style={{ marginBottom: 12 }} content={`当前配置方式：${BUILD_CONFIGURATION_MODE_LABELS[configurationMode]}。${!budgetEnabled ? '系统没有预算，成本只能为 0。' : '成本从第 1 级累计到目标等级，不把单级成本当作累计成本。'}`} />
      <Form.Item label="可选项标识" required help={errors.optionKey} validateStatus={errors.optionKey ? 'error' : undefined}>
        <Input aria-label="可选项标识" value={draft.optionKey} disabled={disabled || mode !== 'create'} maxLength={64} onChange={optionKeyValue => patch({ optionKey: optionKeyValue })} />
      </Form.Item>
      <Form.Item label="可选项名称" required help={errors.name} validateStatus={errors.name ? 'error' : undefined}>
        <Input aria-label="可选项名称" value={draft.name} disabled={disabled} maxLength={100} onChange={name => patch({ name })} />
      </Form.Item>
      <Form.Item label="最高投入等级" required help={errors.maxRank} validateStatus={errors.maxRank ? 'error' : undefined}>
        <Input aria-label="最高投入等级" value={draft.maxRank} disabled={disabled || configurationMode === 'SLOT_SELECTION'} onChange={maxRank => patch({ maxRank })} />
      </Form.Item>
      <Form.Item label="各级成本" required extra="每行填写一级成本，行数必须等于最高投入等级。" help={rankCostError} validateStatus={rankCostError ? 'error' : undefined}>
        <Input.TextArea aria-label="各级成本" value={draft.rankCosts.join('\n')} disabled={disabled} autoSize={{ minRows: 2, maxRows: 12 }}
          onChange={value => patch({ rankCosts: value.replace(/\r/g, '').split('\n') })} />
      </Form.Item>
      <Form.Item label="说明" help={errors.description} validateStatus={errors.description ? 'error' : undefined}>
        <Input.TextArea aria-label="可选项说明" value={draft.description} disabled={disabled} maxLength={2000} showWordLimit autoSize={{ minRows: 2, maxRows: 6 }} onChange={description => patch({ description })} />
      </Form.Item>
    </Form> : null}
  </Modal>;
}
