import { Alert, Button, Form, Input, Modal, Select, Space, Spin } from '@arco-design/web-react';
import { useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '../../../services/apiClient';
import { createBuildSystem, getBuildSystem, listBuildGroups, listBuildOptions, updateBuildSystem } from '../../../services/buildClient';
import {
  BUILD_CONFIGURATION_MODE_LABELS,
  BUILD_CONFIGURATION_MODES,
  type BuildConfigurationMode,
  type BuildGroup,
  type BuildOption,
  type BuildSystem
} from '../../../types/build';
import { SelectionRulesEditor } from './SelectionRulesEditor';
import {
  buildErrorMessage,
  buildFieldErrors,
  buildReadbackConfirmedMissing,
  buildWriteResultIsUncertain,
  emptySelectionRulesDraft,
  selectionRulesFromDraft,
  selectionRulesToDraft,
  validateSystemDraft,
  type BuildFieldErrors,
  type BuildSystemDraft
} from './buildForm';

export type BuildEditorMode = 'create' | 'view' | 'edit';
type Props = {
  mode: BuildEditorMode;
  systemKey: string | null;
  apiBaseUrl: string;
  selectedGameId: string;
  onClose: () => void;
  onSaved: (system: BuildSystem) => void;
  onDirtyChange: (dirty: boolean) => void;
};

const blank: BuildSystemDraft = {
  systemKey: '', name: '', description: '', configurationMode: '', sortOrder: '0',
  selectionRules: emptySelectionRulesDraft()
};

export function BuildSystemEditorModal(props: Props) {
  const { mode, systemKey, apiBaseUrl, selectedGameId, onClose, onSaved, onDirtyChange } = props;
  const [draft, setDraft] = useState<BuildSystemDraft>(blank);
  const [initial, setInitial] = useState<BuildSystemDraft>(blank);
  const [groups, setGroups] = useState<BuildGroup[]>([]);
  const [options, setOptions] = useState<BuildOption[]>([]);
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
  const rulesPresent = initial.selectionRules.groupRoles.length > 0 || initial.selectionRules.budgetEnabled
    || initial.selectionRules.prerequisites.length > 0 || initial.selectionRules.exclusions.length > 0;
  const modeLocked = mode !== 'create' && (groups.length > 0 || rulesPresent || options.some(option => option.maxRank !== 1));
  const load = async () => {
    if (!systemKey) return;
    setLoading(true); setError(null); setLoaded(false);
    try {
      const [systemResult, groupResult, optionResult] = await Promise.all([
        getBuildSystem(apiBaseUrl, selectedGameId, systemKey),
        listBuildGroups(apiBaseUrl, selectedGameId, systemKey),
        listBuildOptions(apiBaseUrl, selectedGameId, systemKey)
      ]);
      if (!active.current) return;
      const value: BuildSystemDraft = {
        systemKey: systemResult.data.systemKey,
        name: systemResult.data.name,
        description: systemResult.data.description ?? '',
        configurationMode: systemResult.data.configurationMode,
        sortOrder: String(systemResult.data.sortOrder),
        selectionRules: selectionRulesToDraft(systemResult.data.selectionRules)
      };
      setDraft(value); setInitial(value); setGroups(groupResult.data.items); setOptions(optionResult.data.items); setLoaded(true);
    } catch (cause) { if (active.current) setError(getErrorMessage(cause)); }
    finally { if (active.current) setLoading(false); }
  };
  useEffect(() => { active.current = true; void load(); return () => { active.current = false; onDirtyChange(false); }; }, []);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  const patch = (update: Partial<BuildSystemDraft>) => { setDraft({ ...draft, ...update }); setErrors({}); setError(null); };
  const close = () => {
    if (writing.current || (dirty && !window.confirm('构筑系统修改尚未完成，确定关闭吗？'))) return;
    onDirtyChange(false); onClose();
  };
  const save = async () => {
    if (writing.current || readOnly || !loaded) return;

    const checked = validateSystemDraft(draft, mode === 'create', groups, options);
    setErrors(checked);
    if (Object.keys(checked).length) return;
    writing.current = true; setSaving(true); setError(null);
    let writtenKey = savedKey;
    const attemptedKey = savedKey ?? (mode === 'create' ? draft.systemKey.trim() : systemKey!);
    try {
      if (!writtenKey) {
        const body = {
          name: draft.name.trim(),
          description: draft.description.trim() || null,
          configurationMode: draft.configurationMode as BuildConfigurationMode,
          sortOrder: Number(draft.sortOrder),
          selectionRules: selectionRulesFromDraft(draft.selectionRules)
        };
        const result = mode === 'create'
          ? await createBuildSystem(apiBaseUrl, selectedGameId, { systemKey: draft.systemKey.trim(), ...body })
          : await updateBuildSystem(apiBaseUrl, selectedGameId, systemKey!, body);
        writtenKey = result.data.systemKey;
        if (!active.current) return;
        setSavedKey(writtenKey);
      }
      const result = await getBuildSystem(apiBaseUrl, selectedGameId, writtenKey);
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
  return <Modal visible title={mode === 'create' ? '新增构筑系统' : mode === 'edit' ? '编辑构筑系统' : '查看构筑系统'} style={{ width: 1080 }} maskClosable={false} onCancel={close}
    footer={<Space><Button disabled={saving} onClick={close}>{readOnly ? '关闭' : '取消'}</Button>{!readOnly ? <Button type="primary" loading={saving} disabled={!loaded || loading} onClick={() => void save()}>{savedKey ? '重新回读' : '保存'}</Button> : null}</Space>}>
    {error ? <Alert type="error" content={error} style={{ marginBottom: 12 }} /> : null}
    {loading ? <Spin tip="正在读取构筑系统" /> : !loaded ? <Button onClick={() => void load()}>重新读取</Button> : null}
    {loaded ? <Form layout="vertical">
      <Form.Item label="系统标识" required help={errors.systemKey} validateStatus={errors.systemKey ? 'error' : undefined}>
        <Input aria-label="系统标识" value={draft.systemKey} disabled={disabled || mode !== 'create'} maxLength={64} onChange={systemKeyValue => patch({ systemKey: systemKeyValue })} />
      </Form.Item>
      <Form.Item label="系统名称" required help={errors.name} validateStatus={errors.name ? 'error' : undefined}>
        <Input aria-label="系统名称" value={draft.name} disabled={disabled} maxLength={100} onChange={name => patch({ name })} />
      </Form.Item>
      <Form.Item label="配置方式" required extra={draft.configurationMode === 'SLOT_SELECTION' ? '按位置选择：每次选择的投入等级固定为 1。' : '按点投入：必须显式给出最终投入等级，成本按各级累计。'} help={errors.configurationMode} validateStatus={errors.configurationMode ? 'error' : undefined}>
        <Select aria-label="配置方式" value={draft.configurationMode || undefined} placeholder="请选择配置方式" disabled={disabled || modeLocked}
          options={BUILD_CONFIGURATION_MODES.map(value => ({ value, label: BUILD_CONFIGURATION_MODE_LABELS[value] }))}
          onChange={(configurationMode: BuildConfigurationMode) => patch({ configurationMode })} />
      </Form.Item>
      {modeLocked ? <Alert type="warning" content="已有分组、规则或更高投入等级时不能直接修改配置方式。请先清空对应结构并保存，再重新打开后修改。" style={{ marginBottom: 12 }} /> : null}
      <Form.Item label="显示顺序" required help={errors.sortOrder} validateStatus={errors.sortOrder ? 'error' : undefined}>
        <Input aria-label="显示顺序" value={draft.sortOrder} disabled={disabled} onChange={sortOrder => patch({ sortOrder })} />
      </Form.Item>
      <Form.Item label="说明" help={errors.description} validateStatus={errors.description ? 'error' : undefined}>
        <Input.TextArea aria-label="系统说明" value={draft.description} disabled={disabled} maxLength={2000} showWordLimit autoSize={{ minRows: 2, maxRows: 6 }} onChange={description => patch({ description })} />
      </Form.Item>
      <SelectionRulesEditor draft={draft.selectionRules} groups={groups} options={options} mode={draft.configurationMode} disabled={disabled} errors={errors}
        onChange={selectionRules => patch({ selectionRules })} />
    </Form> : null}
  </Modal>;
}
