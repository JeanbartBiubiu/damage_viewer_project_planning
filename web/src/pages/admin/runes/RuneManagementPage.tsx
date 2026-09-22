import { Alert, Button, Empty, Input, Modal, Select, Space, Table, Tabs, Typography, type TableColumnProps } from '@arco-design/web-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Panel } from '../../../components/Panel';
import { getErrorMessage } from '../../../services/apiClient';
import { deleteRune, deleteRunePath, listRunePaths, listRunes } from '../../../services/runeClient';
import { RUNE_CATEGORIES, RUNE_CATEGORY_LABELS, RUNE_PATH_KIND_LABELS, type Rune, type RuneCategory, type RunePath } from '../../../types/rune';
import { ObjectRelationActions } from '../relations/ObjectRelationActions';
import { SkillRelationsModal } from '../relations/SkillRelationsModal';
import { SkillManagementPage } from '../skills/SkillManagementPage';
import { useRepresentativeImageColumn } from '../relations/useRepresentativeImageColumn';
import { RuneEditorModal, type RuneEditorMode } from './RuneEditorModal';
import { RunePathEditorModal } from './RunePathEditorModal';
import { runeErrorMessage } from './runeForm';

type Props = { apiBaseUrl: string; selectedGameId: string | null; adminToken: string; onDirtyChange: (dirty: boolean) => void };
type Entry = Rune | RunePath;
type RuneQuery = { keyword?: string; category?: RuneCategory };
type CatalogFilter = {
  keywordDraft: string;
  categoryDraft: RuneCategory | undefined;
  query: RuneQuery;
  page: number;
  pageSize: number;
  onKeywordDraft: (value: string) => void;
  onCategoryDraft: (value: RuneCategory | undefined) => void;
  onQuery: (value: RuneQuery) => void;
  onPage: (value: number) => void;
  onPageSize: (value: number) => void;
};
function keyOf(entry: Entry) { return 'runeKey' in entry ? entry.runeKey : entry.pathKey; }
const EMPTY_FILTER = { keywordDraft: '', categoryDraft: undefined as RuneCategory | undefined, query: {} as RuneQuery, page: 1, pageSize: 25 };
export function RuneManagementPage(props: Props) {
  const [view, setView] = useState('runes');
  const [skillsTarget, setSkillsTarget] = useState<Rune | null>(null);
  const [skillFocus, setSkillFocus] = useState<{ rune: Rune; skillKey: string; context: string } | null>(null);
  const [keywordDraft, setKeywordDraft] = useState(EMPTY_FILTER.keywordDraft);
  const [categoryDraft, setCategoryDraft] = useState<RuneCategory | undefined>(EMPTY_FILTER.categoryDraft);
  const [query, setQuery] = useState<RuneQuery>(EMPTY_FILTER.query);
  const [page, setPage] = useState(EMPTY_FILTER.page);
  const [pageSize, setPageSize] = useState(EMPTY_FILTER.pageSize);
  const dirty = useRef(false);
  const skillFocusDirty = useRef(false);
  const focusContext = JSON.stringify([props.apiBaseUrl, props.selectedGameId, props.adminToken]);
  const onDirtyChange = useCallback((value: boolean) => { dirty.current = value; props.onDirtyChange(value); }, [props.onDirtyChange]);
  const reportSkillDirty = useCallback((value: boolean) => { skillFocusDirty.current = value; props.onDirtyChange(value); }, [props.onDirtyChange]);
  const resetFilter = () => {
    setKeywordDraft(EMPTY_FILTER.keywordDraft);
    setCategoryDraft(EMPTY_FILTER.categoryDraft);
    setQuery(EMPTY_FILTER.query);
    setPage(EMPTY_FILTER.page);
    setPageSize(EMPTY_FILTER.pageSize);
  };
  useEffect(() => {
    setSkillsTarget(null);
    setSkillFocus(null);
    skillFocusDirty.current = false;
    setKeywordDraft(EMPTY_FILTER.keywordDraft);
    setCategoryDraft(EMPTY_FILTER.categoryDraft);
    setQuery(EMPTY_FILTER.query);
    setPage(EMPTY_FILTER.page);
    setPageSize(EMPTY_FILTER.pageSize);
  }, [focusContext]);
  if (skillFocus !== null && skillFocus.context === focusContext) {
    return <SkillManagementPage
      key={`${focusContext}:${skillFocus.skillKey}`}
      apiBaseUrl={props.apiBaseUrl}
      selectedGameId={props.selectedGameId}
      adminToken={props.adminToken}
      onDirtyChange={reportSkillDirty}
      focus={{
        skillKey: skillFocus.skillKey,
        sourceKind: 'rune',
        sourceKey: skillFocus.rune.runeKey,
        sourceName: skillFocus.rune.name,
        returnLabel: '返回符文技能',
        onReturn: () => {
          if (skillFocusDirty.current && !window.confirm('当前技能修改尚未保存，确定返回符文技能吗？')) return;
          reportSkillDirty(false);
          setSkillsTarget(skillFocus.rune);
          setSkillFocus(null);
        }
      }}
    />;
  }
  return <div className="page-stack">
    <Tabs activeTab={view} onChange={next => {
      if ((dirty.current || skillFocusDirty.current) && !window.confirm('当前修改尚未保存，确定切换视图吗？')) return;
      onDirtyChange(false);
      setSkillsTarget(null);
      resetFilter();
      setView(next);
    }}>
      <Tabs.TabPane key="runes" title="符文列表" />
      <Tabs.TabPane key="paths" title="分组与槽位" />
    </Tabs>
    <RuneCatalog
      key={JSON.stringify([props.apiBaseUrl, props.selectedGameId, props.adminToken, view])}
      {...props}
      onDirtyChange={onDirtyChange}
      paths={view === 'paths'}
      onOpenSkills={setSkillsTarget}
      keywordDraft={keywordDraft}
      categoryDraft={categoryDraft}
      query={query}
      page={page}
      pageSize={pageSize}
      onKeywordDraft={setKeywordDraft}
      onCategoryDraft={setCategoryDraft}
      onQuery={setQuery}
      onPage={setPage}
      onPageSize={setPageSize}
    />
    {skillsTarget ? <SkillRelationsModal
      visible
      target={{ kind: 'rune', key: skillsTarget.runeKey, name: skillsTarget.name }}
      apiBaseUrl={props.apiBaseUrl}
      selectedGameId={props.selectedGameId}
      adminToken={props.adminToken}
      onDirtyChange={onDirtyChange}
      onClose={() => setSkillsTarget(null)}
      onEditSkill={(skillKey) => {
        reportSkillDirty(false);
        setSkillFocus({ rune: skillsTarget, skillKey, context: focusContext });
        setSkillsTarget(null);
      }}
    /> : null}
  </div>;
}
function RuneCatalog({
  paths, apiBaseUrl, selectedGameId, adminToken, onDirtyChange, onOpenSkills,
  keywordDraft, categoryDraft, query, page, pageSize,
  onKeywordDraft, onCategoryDraft, onQuery, onPage, onPageSize
}: Props & CatalogFilter & { paths: boolean; onOpenSkills?: (rune: Rune) => void }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ mode: RuneEditorMode; key: string | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Entry | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const active = useRef(true);
  const serial = useRef(0);
  const deleteBusy = useRef(false);
  const token = adminToken.trim();
  const label = paths ? '符文分组' : '符文';
  const current = Math.min(page, Math.max(1, Math.ceil(entries.length / pageSize)));
  const ready = Boolean(selectedGameId && token);
  const load = useCallback(async () => {
    const request = ++serial.current;
    if (!selectedGameId || !token) return;
    setLoading(true); setLoadError(null);
    try {
      const result = paths ? await listRunePaths(apiBaseUrl, selectedGameId, token, { keyword: query.keyword }) : await listRunes(apiBaseUrl, selectedGameId, token, query);
      if (active.current && request === serial.current) setEntries(result.data.items);
    } catch (cause) {
      if (active.current && request === serial.current) { setEntries([]); setLoadError(getErrorMessage(cause)); }
    } finally { if (active.current && request === serial.current) setLoading(false); }
  }, [apiBaseUrl, paths, query, selectedGameId, token]);
  useEffect(() => { active.current = true; return () => { active.current = false; serial.current++; onDirtyChange(false); }; }, [onDirtyChange]);
  useEffect(() => { void load(); }, [load]);
  const saved = (entry: Entry) => {
    setEditor(null); setNotice(`${label}「${entry.name}」已保存并回读。`); onDirtyChange(false); void load();
  };
  const remove = async () => {
    if (!deleteTarget || !selectedGameId || !token || deleteBusy.current) return;
    deleteBusy.current = true; setDeleting(true); setDeleteError(null);
    try {
      if (paths) await deleteRunePath(apiBaseUrl, selectedGameId, keyOf(deleteTarget), token);
      else await deleteRune(apiBaseUrl, selectedGameId, keyOf(deleteTarget), token);
      if (!active.current) return;
      setDeleteTarget(null); setNotice(`${label}「${deleteTarget.name}」已删除。`); await load();
    } catch (cause) { if (active.current) setDeleteError(runeErrorMessage(cause)); }
    finally { deleteBusy.current = false; if (active.current) setDeleting(false); }
  };
  const getTarget = (entry: Entry) => ({ kind: paths ? 'runePath' as const : 'rune' as const, key: keyOf(entry), name: entry.name });
  const { imageColumn, onImageSaved } = useRepresentativeImageColumn<Entry>({ apiBaseUrl, selectedGameId, adminToken, getTarget });
  const columns: TableColumnProps<Entry>[] = [
    imageColumn,
    { title: `${label}名称`, dataIndex: 'name', width: 180 },
    { title: '稳定标识', width: 190, render: (_, entry) => keyOf(entry) },
    { title: paths ? '分组种类' : '类别', width: 120, render: (_, entry) => 'runeKey' in entry ? RUNE_CATEGORY_LABELS[entry.category] : RUNE_PATH_KIND_LABELS[entry.kind] },
    ...(paths ? [{ title: '排序', dataIndex: 'sortOrder', width: 80 }, { title: '布局', width: 140, render: (_: unknown, entry: Entry) => 'slots' in entry ? `${entry.slots.length} 槽位 · ${entry.slots.reduce((sum, slot) => sum + slot.runeKeys.length, 0)} 位置` : '—' }] : []),
    { title: '说明', dataIndex: 'description', ellipsis: true, render: value => value || '—' },
    { title: '操作', width: paths ? 300 : 390, fixed: 'right', render: (_, entry) => <Space size="mini" wrap>
      <ObjectRelationActions apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} adminToken={adminToken} onDirtyChange={onDirtyChange} target={getTarget(entry)} onImageSaved={() => onImageSaved(entry)} onOpenSkills={!paths && 'runeKey' in entry ? () => onOpenSkills?.(entry) : undefined} />
      <Button size="mini" disabled={!ready} onClick={() => setEditor({ mode: 'view', key: keyOf(entry) })}>查看</Button>
      <Button size="mini" disabled={!ready} onClick={() => setEditor({ mode: 'edit', key: keyOf(entry) })}>编辑</Button>
      <Button size="mini" status="danger" disabled={!ready} onClick={() => { setDeleteTarget(entry); setDeleteError(null); }}>删除</Button>
    </Space> }
  ];
  const queryList = () => { onPage(1); onQuery({ keyword: keywordDraft.trim() || undefined, category: categoryDraft }); };
  return <Panel title={paths ? '符文分组与槽位' : '符文管理'} actions={<Space><Button disabled={!ready} loading={loading} onClick={() => void load()}>刷新</Button><Button type="primary" disabled={!ready} onClick={() => setEditor({ mode: 'create', key: null })}>新增{label}</Button></Space>}>
    {!selectedGameId ? <Alert type="warning" content="请先在顶部选择游戏。" /> : !token ? <Alert type="warning" content="请先在顶部配置 Admin Token。" /> : null}
    {loadError ? <Alert type="error" content={loadError} className="workspace-alert" /> : null}
    {notice ? <Alert type="success" content={notice} className="workspace-alert" /> : null}
    <Space wrap style={{ marginBottom: 16 }}>
      <Input aria-label={paths ? '符文分组关键词' : '符文关键词'} placeholder="按名称或标识查询" value={keywordDraft} allowClear maxLength={100} style={{ width: 320 }} onChange={onKeywordDraft} onPressEnter={queryList} />
      {!paths ? <Select aria-label="筛选符文类别" placeholder="全部类别" allowClear value={categoryDraft} style={{ width: 150 }} options={RUNE_CATEGORIES.map(value => ({ value, label: RUNE_CATEGORY_LABELS[value] }))} onChange={onCategoryDraft} /> : null}
      <Button type="primary" disabled={!ready} onClick={queryList}>查询</Button>
      <Button onClick={() => { onPage(1); onKeywordDraft(''); onCategoryDraft(undefined); onQuery({}); }}>重置</Button>
    </Space>
    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>共 {entries.length} 个{label}</Typography.Text>
    <Table<Entry> className="data-table-shell" columns={columns} data={entries} loading={loading} rowKey={keyOf} scroll={{ x: paths ? 1400 : 1250 }} noDataElement={<Empty description={loadError ? '读取失败' : `暂无${label}`} />}
      pagination={{ current, pageSize, total: entries.length, sizeCanChange: true, sizeOptions: [25, 50, 100], showTotal: true, onChange: next => onPage(next), onPageSizeChange: size => { onPageSize(size); onPage(1); } }} />
    {editor && selectedGameId ? paths ? <RunePathEditorModal key={`${editor.mode}:${editor.key}`} mode={editor.mode} pathKey={editor.key} apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} adminToken={adminToken} onClose={() => setEditor(null)} onSaved={saved} onDirtyChange={onDirtyChange} />
      : <RuneEditorModal key={`${editor.mode}:${editor.key}`} mode={editor.mode} runeKey={editor.key} apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} adminToken={adminToken} onClose={() => setEditor(null)} onSaved={saved} onDirtyChange={onDirtyChange} /> : null}
    <Modal title={`删除${label}`} visible={deleteTarget !== null} okText="删除" cancelText="取消" okButtonProps={{ status: 'danger' }} confirmLoading={deleting} maskClosable={false} onCancel={() => { if (!deleteBusy.current) setDeleteTarget(null); }} onOk={() => void remove()}>
      {deleteError ? <Alert type="error" content={deleteError} style={{ marginBottom: 12 }} /> : null}
      {deleteTarget ? <><Typography.Paragraph>确定删除{label}「{deleteTarget.name}」吗？</Typography.Paragraph><Typography.Text type="secondary">{paths ? '删除布局和该分组的图片关系，保留符文、技能和图片。' : '槽位引用需要先从分组布局中解除。删除后清除该符文挂载与图片关系，保留技能和图片。'}</Typography.Text></> : null}
    </Modal>
  </Panel>;
}
