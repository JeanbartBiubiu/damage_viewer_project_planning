import { Alert, Button, Empty, Input, Modal, Select, Space, Table, Tabs, Typography, type TableColumnProps } from '@arco-design/web-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Panel } from '../../../components/Panel';
import { getErrorMessage } from '../../../services/apiClient';
import { getBuildDefinition, listBuildGroups, listBuildOptions, listBuildSystems } from '../../../services/buildClient';
import { deleteBuildGroup, deleteBuildOption, deleteBuildSystem } from '../../../services/maintenance/buildWrites';
import {
  BUILD_CONFIGURATION_MODE_LABELS,
  type BuildGroup, type BuildOption, type BuildSystem
} from '../../../types/build';
import { ObjectRelationActions } from '../relations/ObjectRelationActions';
import { SkillRelationsModal } from '../relations/SkillRelationsModal';
import { useRepresentativeImageColumn } from '../relations/useRepresentativeImageColumn';
import { SkillManagementPage } from '../skills/SkillManagementPage';
import { BuildGroupEditorModal } from './BuildGroupEditorModal';
import { BuildOptionEditorModal } from './BuildOptionEditorModal';
import { BuildSystemEditorModal, type BuildEditorMode } from './BuildSystemEditorModal';
import { BuildTrialPanel } from './BuildTrialPanel';
import { buildErrorMessage } from './buildForm';

type Props = { apiBaseUrl: string; selectedGameId: string | null; onDirtyChange: (dirty: boolean) => void };
type View = 'systems' | 'options' | 'groups' | 'trial';
type CatalogFilter = { keywordDraft: string; query: string; page: number; pageSize: number };
type Entry = BuildSystem | BuildOption | BuildGroup;

const EMPTY_FILTER: CatalogFilter = { keywordDraft: '', query: '', page: 1, pageSize: 25 };

export function BuildManagementPage(props: Props) {
  const [view, setView] = useState<View>('systems');
  const [systems, setSystems] = useState<BuildSystem[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [skillsTarget, setSkillsTarget] = useState<BuildOption | null>(null);
  const [skillFocus, setSkillFocus] = useState<{ option: BuildOption; system: BuildSystem; skillKey: string; context: string } | null>(null);
  const [filters, setFilters] = useState<Record<View, CatalogFilter>>({
    systems: { ...EMPTY_FILTER }, options: { ...EMPTY_FILTER }, groups: { ...EMPTY_FILTER }, trial: { ...EMPTY_FILTER }
  });
  const dirty = useRef(false);
  const skillFocusDirty = useRef(false);
  const active = useRef(true);
  const serial = useRef(0);
  const focusContext = JSON.stringify([props.apiBaseUrl, props.selectedGameId]);

  const selected = systems.find(system => system.systemKey === selectedKey) ?? null;
  const onDirtyChange = useCallback((value: boolean) => { dirty.current = value; props.onDirtyChange(value); }, [props.onDirtyChange]);
  const reportSkillDirty = useCallback((value: boolean) => { skillFocusDirty.current = value; props.onDirtyChange(value); }, [props.onDirtyChange]);
  const loadSystems = useCallback(async () => {
    const request = ++serial.current;
    if (!props.selectedGameId) { setSystems([]); setSelectedKey(null); return; }
    try {
      const result = await listBuildSystems(props.apiBaseUrl, props.selectedGameId);
      if (!active.current || request !== serial.current) return;
      setSystems(result.data.items);
      setCatalogError(null);
      setSelectedKey(current => current && result.data.items.some(system => system.systemKey === current) ? current : result.data.items[0]?.systemKey ?? null);
    } catch (cause) {
      if (active.current && request === serial.current) { setSystems([]); setSelectedKey(null); setCatalogError(getErrorMessage(cause)); }
    }
  }, [props.apiBaseUrl, props.selectedGameId]);
  useEffect(() => {
    active.current = true;
    setSkillsTarget(null); setSkillFocus(null); skillFocusDirty.current = false;
    setFilters({ systems: { ...EMPTY_FILTER }, options: { ...EMPTY_FILTER }, groups: { ...EMPTY_FILTER }, trial: { ...EMPTY_FILTER } });
    setView('systems');
    void loadSystems();
    return () => { active.current = false; serial.current += 1; };
  }, [focusContext, loadSystems]);
  const patchFilter = (update: Partial<CatalogFilter>) => setFilters(current => ({ ...current, [view]: { ...current[view], ...update } }));
  if (skillFocus !== null && skillFocus.context === focusContext && selected?.systemKey === skillFocus.system.systemKey) {
    return <SkillManagementPage
      key={`${focusContext}:${skillFocus.skillKey}`}
      apiBaseUrl={props.apiBaseUrl}
      selectedGameId={props.selectedGameId}

      onDirtyChange={reportSkillDirty}
      focus={{
        skillKey: skillFocus.skillKey,
        sourceKind: 'buildOption',
        sourceKey: skillFocus.option.optionKey,
        sourceName: skillFocus.option.name,
        systemKey: skillFocus.system.systemKey,
        systemName: skillFocus.system.name,
        returnLabel: '返回构筑技能',
        onReturn: () => {
          if (skillFocusDirty.current && !window.confirm('当前技能修改尚未保存，确定返回构筑技能吗？')) return;
          reportSkillDirty(false);
          setSkillsTarget(skillFocus.option);
          setSkillFocus(null);
        }
      }}
    />;
  }
  return <div className="page-stack">
    <Panel title="构筑系统管理">

      {catalogError ? <Alert type="error" content={catalogError} /> : null}
      <Space wrap>
        <Select aria-label="当前构筑系统" placeholder="选择当前构筑系统" style={{ width: 360 }} disabled={!props.selectedGameId}
          value={selectedKey ?? undefined} options={systems.map(system => ({ value: system.systemKey, label: `${system.name} · ${system.systemKey}` }))}
          onChange={(value: string) => {
            if ((dirty.current || skillFocusDirty.current) && !window.confirm('当前修改尚未保存，确定切换构筑系统吗？')) return;
            onDirtyChange(false); setSkillsTarget(null); setSelectedKey(value);
          }} />
        <Button disabled={!props.selectedGameId} onClick={() => {
          if ((dirty.current || skillFocusDirty.current) && !window.confirm('当前修改尚未保存，确定刷新构筑系统吗？')) return;
          onDirtyChange(false); reportSkillDirty(false); setSkillsTarget(null); setSkillFocus(null); void loadSystems();
        }}>刷新系统</Button>
      </Space>
    </Panel>
    <Tabs activeTab={view} onChange={next => {
      if ((dirty.current || skillFocusDirty.current) && !window.confirm('当前修改尚未保存，确定切换视图吗？')) return;
      onDirtyChange(false); setSkillsTarget(null); setView(next as View);
    }}>
      <Tabs.TabPane key="systems" title="系统与规则" />
      <Tabs.TabPane key="options" title="可选项" />
      <Tabs.TabPane key="groups" title="分组与位置" />
      <Tabs.TabPane key="trial" title="试配与校验" />
    </Tabs>
    {view === 'trial'
      ? selected && props.selectedGameId
        ? <BuildTrialPanel key={JSON.stringify([props.apiBaseUrl, props.selectedGameId, selected.systemKey])} apiBaseUrl={props.apiBaseUrl} selectedGameId={props.selectedGameId} systemKey={selected.systemKey}  onDirtyChange={onDirtyChange} />
        : <Alert type="warning" content="请先选择当前游戏内的构筑系统。" />
      : <BuildCatalog
        key={JSON.stringify([props.apiBaseUrl, props.selectedGameId, view, selectedKey])}
        {...props}
        view={view}
        system={selected}
        filter={filters[view]}
        onFilter={patchFilter}
        onDirtyChange={onDirtyChange}
        onSystemsChanged={() => void loadSystems()}
        onOpenSkills={setSkillsTarget}
      />}
    {skillsTarget && selected ? <SkillRelationsModal
      visible
      target={{
        kind: 'buildOption', key: skillsTarget.optionKey, name: skillsTarget.name,
        systemKey: selected.systemKey, systemName: selected.name,
        configurationMode: selected.configurationMode, maxRank: skillsTarget.maxRank
      }}
      apiBaseUrl={props.apiBaseUrl}
      selectedGameId={props.selectedGameId}

      onDirtyChange={onDirtyChange}
      onClose={() => setSkillsTarget(null)}
      onEditSkill={skillKey => {
        reportSkillDirty(false);
        setSkillFocus({ option: skillsTarget, system: selected, skillKey, context: focusContext });
        setSkillsTarget(null);
      }}
    /> : null}
  </div>;
}

function BuildCatalog({
  view, system, filter, onFilter, apiBaseUrl, selectedGameId, onDirtyChange, onSystemsChanged, onOpenSkills
}: Props & {
  view: Exclude<View, 'trial'>;
  system: BuildSystem | null;
  filter: CatalogFilter;
  onFilter: (update: Partial<CatalogFilter>) => void;
  onSystemsChanged: () => void;
  onOpenSkills: (option: BuildOption) => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ mode: BuildEditorMode; key: string | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Entry | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePreview, setDeletePreview] = useState<{ groups: number; options: number; grants: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const active = useRef(true);
  const serial = useRef(0);
  const deleteBusy = useRef(false);
  const deleteSerial = useRef(0);

  const ready = Boolean(selectedGameId && (view === 'systems' || system));
  const current = Math.min(filter.page, Math.max(1, Math.ceil(entries.length / filter.pageSize)));
  const load = useCallback(async () => {
    const request = ++serial.current;
    if (!selectedGameId || (view !== 'systems' && !system)) return;
    setLoading(true); setLoadError(null);
    try {
      const keyword = filter.query || undefined;
      const result = view === 'systems'
        ? await listBuildSystems(apiBaseUrl, selectedGameId, keyword)
        : view === 'options'
          ? await listBuildOptions(apiBaseUrl, selectedGameId, system!.systemKey, keyword)
          : await listBuildGroups(apiBaseUrl, selectedGameId, system!.systemKey, keyword);
      if (active.current && request === serial.current) setEntries(result.data.items);
    } catch (cause) {
      if (active.current && request === serial.current) { setEntries([]); setLoadError(getErrorMessage(cause)); }
    } finally { if (active.current && request === serial.current) setLoading(false); }
  }, [apiBaseUrl, filter.query, selectedGameId, system, view]);
  useEffect(() => { active.current = true; return () => { active.current = false; serial.current += 1; onDirtyChange(false); }; }, [onDirtyChange]);
  useEffect(() => { void load(); }, [load]);
  const saved = () => { setEditor(null); setNotice('已保存并回读。'); onDirtyChange(false); onSystemsChanged(); void load(); };
  const openDelete = async (entry: Entry) => {
    const request = ++deleteSerial.current;
    setDeleteTarget(entry); setDeleteError(null); setDeletePreview(null);
    if (view !== 'systems' || !selectedGameId) return;
    try {
      const definition = await getBuildDefinition(apiBaseUrl, selectedGameId, (entry as BuildSystem).systemKey);
      if (active.current && request === deleteSerial.current) {
        setDeletePreview({ groups: definition.data.groups.length, options: definition.data.options.length, grants: definition.data.skillRelations.length });
      }
    } catch (cause) { if (active.current && request === deleteSerial.current) setDeleteError(buildErrorMessage(cause)); }
  };
  const remove = async () => {
    if (!deleteTarget || !selectedGameId || deleteBusy.current) return;
    if (view === 'systems' && !deletePreview) return;
    deleteBusy.current = true; setDeleting(true); setDeleteError(null);
    try {
      if (view === 'systems') await deleteBuildSystem(apiBaseUrl, selectedGameId, (deleteTarget as BuildSystem).systemKey);
      else if (view === 'options') await deleteBuildOption(apiBaseUrl, selectedGameId, system!.systemKey, (deleteTarget as BuildOption).optionKey);
      else await deleteBuildGroup(apiBaseUrl, selectedGameId, system!.systemKey, (deleteTarget as BuildGroup).groupKey);
      if (!active.current) return;
      setDeleteTarget(null); setNotice(`「${deleteTarget.name}」已删除。`); onSystemsChanged(); await load();
    } catch (cause) { if (active.current) setDeleteError(buildErrorMessage(cause)); }
    finally { deleteBusy.current = false; if (active.current) setDeleting(false); }
  };
  const optionColumn = useRepresentativeImageColumn<BuildOption>({
    apiBaseUrl, selectedGameId, getTarget: option => ({ kind: 'buildOption', key: option.optionKey, name: option.name, systemKey: option.systemKey })
  });
  const groupColumn = useRepresentativeImageColumn<BuildGroup>({
    apiBaseUrl, selectedGameId, getTarget: group => ({ kind: 'buildGroup', key: group.groupKey, name: group.name, systemKey: group.systemKey })
  });
  const columns: TableColumnProps<Entry>[] = view === 'systems' ? [
    { title: '系统名称', dataIndex: 'name', width: 180 },
    { title: '系统标识', dataIndex: 'systemKey', width: 180 },
    { title: '配置方式', width: 140, render: (_, entry) => BUILD_CONFIGURATION_MODE_LABELS[(entry as BuildSystem).configurationMode] },
    { title: '显示顺序', dataIndex: 'sortOrder', width: 100 },
    { title: '说明', dataIndex: 'description', ellipsis: true, render: value => value || '—' },
    actionColumn(220)
  ] : view === 'options' ? [
    optionColumn.imageColumn as TableColumnProps<Entry>,
    { title: '可选项名称', dataIndex: 'name', width: 180 },
    { title: '可选项标识', dataIndex: 'optionKey', width: 180 },
    { title: '最高投入等级', dataIndex: 'maxRank', width: 120 },
    { title: '各级成本', width: 180, render: (_, entry) => (entry as BuildOption).rankCosts.join(' / ') },
    { title: '说明', dataIndex: 'description', ellipsis: true, render: value => value || '—' },
    actionColumn(390, true)
  ] : [
    groupColumn.imageColumn as TableColumnProps<Entry>,
    { title: '分组名称', dataIndex: 'name', width: 180 },
    { title: '分组标识', dataIndex: 'groupKey', width: 180 },
    { title: '显示顺序', dataIndex: 'sortOrder', width: 100 },
    { title: '位置', width: 160, render: (_, entry) => `${(entry as BuildGroup).slots.length} 个位置` },
    { title: '说明', dataIndex: 'description', ellipsis: true, render: value => value || '—' },
    actionColumn(300)
  ];
  function actionColumn(width: number, skills = false): TableColumnProps<Entry> {
    return { title: '操作', width, fixed: 'right', render: (_, entry) => {
      const key = 'systemKey' in entry && view === 'systems' ? entry.systemKey : 'optionKey' in entry ? entry.optionKey : (entry as BuildGroup).groupKey;
      const target = view === 'options'
        ? { kind: 'buildOption' as const, key, name: entry.name, systemKey: (entry as BuildOption).systemKey }
        : view === 'groups'
          ? { kind: 'buildGroup' as const, key, name: entry.name, systemKey: (entry as BuildGroup).systemKey }
          : null;
      return <Space size="mini" wrap>
        {target ? <ObjectRelationActions apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId}  onDirtyChange={onDirtyChange} target={target}
          onImageSaved={() => view === 'options' ? optionColumn.onImageSaved(entry as BuildOption) : groupColumn.onImageSaved(entry as BuildGroup)}
          onOpenSkills={skills ? () => onOpenSkills(entry as BuildOption) : undefined} /> : null}
        <Button size="mini" disabled={!ready} onClick={() => setEditor({ mode: 'view', key })}>查看</Button>
        <Button size="mini" disabled={!ready} onClick={() => setEditor({ mode: 'edit', key })}>编辑</Button>
        <Button size="mini" status="danger" disabled={!ready} onClick={() => void openDelete(entry)}>删除</Button>
      </Space>;
    } };
  }
  const label = view === 'systems' ? '构筑系统' : view === 'options' ? '可选项' : '分组';
  return <Panel title={view === 'systems' ? '系统与规则' : view === 'options' ? '可选项' : '分组与位置'} actions={<Space>
    <Button disabled={!ready} loading={loading} onClick={() => void load()}>刷新</Button>
    <Button type="primary" disabled={!ready} onClick={() => setEditor({ mode: 'create', key: null })}>新增{label}</Button>
  </Space>}>
    {view !== 'systems' && !system ? <Alert type="warning" content="请先选择当前游戏内的构筑系统。" /> : null}
    {loadError ? <Alert type="error" content={loadError} className="workspace-alert" /> : null}
    {notice ? <Alert type="success" content={notice} className="workspace-alert" /> : null}
    <Space wrap style={{ marginBottom: 16 }}>
      <Input aria-label={`${label}关键词`} placeholder="按名称或标识查询" value={filter.keywordDraft} allowClear maxLength={100} style={{ width: 320 }}
        onChange={keywordDraft => onFilter({ keywordDraft })} onPressEnter={() => onFilter({ page: 1, query: filter.keywordDraft.trim() })} />
      <Button type="primary" disabled={!ready} onClick={() => onFilter({ page: 1, query: filter.keywordDraft.trim() })}>查询</Button>
      <Button onClick={() => onFilter({ ...EMPTY_FILTER })}>重置</Button>
    </Space>
    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>共 {entries.length} 个{label}</Typography.Text>
    <Table<Entry> className="data-table-shell" columns={columns} data={entries} loading={loading} rowKey={entry => `${view}:${'optionKey' in entry ? entry.optionKey : 'groupKey' in entry && view === 'groups' ? (entry as BuildGroup).groupKey : (entry as BuildSystem).systemKey}`}
      scroll={{ x: 1200 }} noDataElement={<Empty description={loadError ? '读取失败' : `暂无${label}`} />}
      pagination={{ current, pageSize: filter.pageSize, total: entries.length, sizeCanChange: true, sizeOptions: [25, 50, 100], showTotal: true, onChange: page => onFilter({ page }), onPageSizeChange: pageSize => onFilter({ pageSize, page: 1 }) }} />
    {editor && selectedGameId && view === 'systems' ? <BuildSystemEditorModal key={`${editor.mode}:${editor.key}`} mode={editor.mode} systemKey={editor.key} apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId}  onClose={() => setEditor(null)} onSaved={saved} onDirtyChange={onDirtyChange} /> : null}
    {editor && selectedGameId && system && view === 'options' ? <BuildOptionEditorModal key={`${editor.mode}:${editor.key}`} mode={editor.mode} systemKey={system.systemKey} optionKey={editor.key} configurationMode={system.configurationMode} budgetEnabled={system.selectionRules.budget !== null} apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId}  onClose={() => setEditor(null)} onSaved={saved} onDirtyChange={onDirtyChange} /> : null}
    {editor && selectedGameId && system && view === 'groups' ? <BuildGroupEditorModal key={`${editor.mode}:${editor.key}`} mode={editor.mode} systemKey={system.systemKey} groupKey={editor.key} configurationMode={system.configurationMode} apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId}  onClose={() => setEditor(null)} onSaved={saved} onDirtyChange={onDirtyChange} /> : null}
    <Modal title={`删除${label}`} visible={deleteTarget !== null} okText="删除" cancelText="取消" okButtonProps={{ status: 'danger', disabled: view === 'systems' && !deletePreview }} confirmLoading={deleting} maskClosable={false}
      onCancel={() => { if (!deleteBusy.current) { deleteSerial.current += 1; setDeleteTarget(null); } }} onOk={() => void remove()}>
      {deleteError ? <Alert type="error" content={deleteError} style={{ marginBottom: 12 }} /> : null}
      {deleteTarget ? <Typography.Paragraph>确定删除{label}「{deleteTarget.name}」吗？</Typography.Paragraph> : null}
      {view === 'systems' && deletePreview ? <Typography.Text type="secondary">将同时删除 {deletePreview.groups} 个分组、{deletePreview.options} 个可选项和 {deletePreview.grants} 条技能授予。不会删除技能或图片。</Typography.Text> : null}
      {view === 'systems' && !deletePreview && !deleteError ? <Typography.Text>正在读取将被删除的分组、可选项和技能授予数量。</Typography.Text> : null}
      {view !== 'systems' ? <Typography.Text type="secondary">仍被分组、规则或技能授予占用时，后端会拒绝删除并保留当前草稿。</Typography.Text> : null}
    </Modal>
  </Panel>;
}
