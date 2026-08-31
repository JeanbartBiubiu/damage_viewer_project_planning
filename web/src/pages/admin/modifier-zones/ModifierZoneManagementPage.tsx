import { Alert, Button, Empty, Input, Modal, Radio, Select, Space, Table, Tag, Typography } from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Panel } from '../../../components/Panel';
import { getErrorMessage } from '../../../services/apiClient';
import { deleteModifierZone, listModifierZones, updateModifierZone } from '../../../services/modifierZoneClient';
import type {
  ModifierZone,
  ModifierZoneDomain,
  ModifierZoneListQuery,
  ModifierZoneStatus,
  UpdateModifierZoneRequest
} from '../../../types/modifierZone';
import { APPLICATION_STAGE_LABELS, CALCULATION_MODE_LABELS, DOMAIN_LABELS } from './modifierZoneForm';
import { ModifierZoneEditorModal, type ModifierZoneEditorMode } from './ModifierZoneEditorModal';

type Props = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onDirtyChange: (dirty: boolean) => void;
};

type EditorState = { mode: ModifierZoneEditorMode; modifierZone: ModifierZone | null };
type StatusTarget = { modifierZone: ModifierZone; nextStatus: ModifierZoneStatus };

function statusRequest(zone: ModifierZone, status: ModifierZoneStatus): UpdateModifierZoneRequest {
  return {
    name: zone.name,
    domain: zone.domain,
    calculationMode: zone.calculationMode,
    applicationStage: zone.applicationStage,
    description: zone.description,
    status,
    sortOrder: zone.sortOrder
  };
}

export function ModifierZoneManagementPage({
  apiBaseUrl, selectedGameId, adminToken, onDirtyChange
}: Props) {
  const [keyword, setKeyword] = useState('');
  const [domain, setDomain] = useState<ModifierZoneDomain | ''>('');
  const [status, setStatus] = useState<ModifierZoneStatus | ''>('');
  const [query, setQuery] = useState<ModifierZoneListQuery>({});
  const [items, setItems] = useState<ModifierZone[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [statusTarget, setStatusTarget] = useState<StatusTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ModifierZone | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const serial = useRef(0);

  const load = useCallback(async (nextQuery: ModifierZoneListQuery) => {
    const request = ++serial.current;
    const token = adminToken.trim();
    if (!selectedGameId || !token) {
      setItems([]); setTotal(0); setLoadError(null); setLoading(false); return;
    }
    setLoading(true); setLoadError(null);
    try {
      const result = await listModifierZones(apiBaseUrl, selectedGameId, token, nextQuery);
      if (serial.current !== request) return;
      setItems(result.data.items); setTotal(result.data.total);
    } catch (error) {
      if (serial.current !== request) return;
      setItems([]); setTotal(0); setLoadError(getErrorMessage(error));
    } finally {
      if (serial.current === request) setLoading(false);
    }
  }, [adminToken, apiBaseUrl, selectedGameId]);

  useEffect(() => { void load(query); }, [load, query]);
  useEffect(() => {
    setKeyword(''); setDomain(''); setStatus(''); setQuery({}); setEditor(null);
    setStatusTarget(null); setDeleteTarget(null); setNotice(null); setActionError(null);
    onDirtyChange(false);
  }, [onDirtyChange, selectedGameId]);

  const applyQuery = () => setQuery({
    keyword: keyword.trim() || undefined,
    domain: domain || undefined,
    status: status || undefined
  });
  const resetQuery = () => {
    setKeyword(''); setDomain(''); setStatus(''); setQuery({}); setNotice(null);
  };

  const changeStatus = async () => {
    if (!statusTarget || !selectedGameId || actionLoading) return;
    const token = adminToken.trim();
    if (!token) return setActionError('请先配置 Admin Token。');
    setActionLoading(true); setActionError(null);
    try {
      const result = await updateModifierZone(
        apiBaseUrl, selectedGameId, statusTarget.modifierZone.modifierZoneKey, token,
        statusRequest(statusTarget.modifierZone, statusTarget.nextStatus)
      );
      setStatusTarget(null);
      setNotice(`乘区「${result.data.name}」已${result.data.status === 'ENABLED' ? '启用' : '停用'}。`);
      await load(query);
    } catch (error) { setActionError(getErrorMessage(error)); }
    finally { setActionLoading(false); }
  };

  const remove = async () => {
    if (!deleteTarget || !selectedGameId || actionLoading) return;
    const token = adminToken.trim();
    if (!token) return setActionError('请先配置 Admin Token。');
    setActionLoading(true); setActionError(null);
    try {
      const name = deleteTarget.name;
      await deleteModifierZone(apiBaseUrl, selectedGameId, deleteTarget.modifierZoneKey, token);
      setDeleteTarget(null); setNotice(`乘区「${name}」已删除。`); await load(query);
    } catch (error) { setActionError(getErrorMessage(error)); }
    finally { setActionLoading(false); }
  };

  const columns: TableColumnProps[] = [
    { title: '乘区名称', dataIndex: 'name', width: 180 },
    { title: '乘区标识', dataIndex: 'modifierZoneKey', width: 190 },
    { title: '作用域', dataIndex: 'domain', width: 100, render: (value) => DOMAIN_LABELS[value as ModifierZoneDomain] },
    { title: '计算方式', dataIndex: 'calculationMode', width: 130, render: (value) => CALCULATION_MODE_LABELS[value as keyof typeof CALCULATION_MODE_LABELS] },
    { title: '应用阶段', dataIndex: 'applicationStage', width: 170, render: (value) => APPLICATION_STAGE_LABELS[value as keyof typeof APPLICATION_STAGE_LABELS] },
    { title: '状态', dataIndex: 'status', width: 80, render: (value) => value === 'ENABLED' ? <Tag color="green">启用</Tag> : <Tag color="gray">停用</Tag> },
    { title: '排序', dataIndex: 'sortOrder', width: 70 },
    {
      title: '操作', width: 280, fixed: 'right',
      render: (_value, record: ModifierZone) => <Space size="mini">
        <Button size="mini" onClick={() => setEditor({ mode: 'view', modifierZone: record })}>查看</Button>
        <Button size="mini" onClick={() => setEditor({ mode: 'edit', modifierZone: record })}>编辑</Button>
        <Button size="mini" status={record.status === 'ENABLED' ? 'danger' : 'success'} onClick={() => {
          setActionError(null);
          setStatusTarget({ modifierZone: record, nextStatus: record.status === 'ENABLED' ? 'DISABLED' : 'ENABLED' });
        }}>{record.status === 'ENABLED' ? '停用' : '启用'}</Button>
        <Button size="mini" status="danger" onClick={() => { setActionError(null); setDeleteTarget(record); }}>删除</Button>
      </Space>
    }
  ];

  return <div className="page-stack">
    <Panel title="乘区管理" actions={<Space>
      <Button loading={loading} disabled={!selectedGameId || !adminToken.trim()} onClick={() => void load(query)}>刷新</Button>
      <Button type="primary" disabled={!selectedGameId} onClick={() => setEditor({ mode: 'create', modifierZone: null })}>新增乘区</Button>
    </Space>}>
      {!selectedGameId ? <Alert type="warning" content="请先在顶部选择游戏。" /> : null}
      {selectedGameId && !adminToken.trim() ? <Alert type="warning" content="请先在顶部配置 Admin Token。" /> : null}
      {loadError ? <Alert type="error" content={loadError} className="workspace-alert" /> : null}
      {notice ? <Alert type="success" content={notice} className="workspace-alert" /> : null}
      <Space wrap style={{ marginBottom: 16 }}>
        <Input aria-label="乘区关键词" value={keyword} allowClear style={{ width: 260 }} onChange={setKeyword} onPressEnter={applyQuery} />
        <Select aria-label="乘区作用域筛选" value={domain} style={{ width: 150 }} options={[{ value: '', label: '全部作用域' }, ...Object.entries(DOMAIN_LABELS).map(([value, label]) => ({ value, label }))]} onChange={(value) => setDomain(value as ModifierZoneDomain | '')} />
        <Radio.Group aria-label="乘区状态筛选" type="button" size="small" value={status} onChange={(value) => setStatus(value as ModifierZoneStatus | '')}>
          <Radio value="">全部</Radio><Radio value="ENABLED">启用</Radio><Radio value="DISABLED">停用</Radio>
        </Radio.Group>
        <Button type="primary" onClick={applyQuery}>查询</Button><Button onClick={resetQuery}>重置</Button>
      </Space>
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>共 {total} 条乘区</Typography.Text>
      <Table className="data-table-shell" loading={loading} columns={columns} data={items} pagination={false} rowKey={(record: ModifierZone) => record.modifierZoneKey} scroll={{ x: 1250 }} noDataElement={<Empty description="暂无乘区" />} />
    </Panel>

    <ModifierZoneEditorModal visible={editor !== null} mode={editor?.mode ?? 'view'} modifierZone={editor?.modifierZone ?? null} apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} adminToken={adminToken} onClose={() => setEditor(null)} onSaved={async (saved) => { setEditor(null); setNotice(`乘区「${saved.name}」已保存。`); onDirtyChange(false); await load(query); }} onDirtyChange={onDirtyChange} />

    <Modal title={statusTarget?.nextStatus === 'ENABLED' ? '启用乘区' : '停用乘区'} visible={statusTarget !== null} okText={statusTarget?.nextStatus === 'ENABLED' ? '启用' : '停用'} cancelText="取消" confirmLoading={actionLoading} maskClosable onCancel={() => { if (!actionLoading) { setStatusTarget(null); setActionError(null); } }} onOk={() => void changeStatus()}>
      {actionError ? <Alert type="error" content={actionError} style={{ marginBottom: 12 }} /> : null}
      {statusTarget ? `确定${statusTarget.nextStatus === 'ENABLED' ? '启用' : '停用'}乘区「${statusTarget.modifierZone.name}」吗？` : null}
    </Modal>
    <Modal title="删除乘区" visible={deleteTarget !== null} okText="删除" cancelText="取消" okButtonProps={{ status: 'danger' }} confirmLoading={actionLoading} maskClosable onCancel={() => { if (!actionLoading) { setDeleteTarget(null); setActionError(null); } }} onOk={() => void remove()}>
      {actionError ? <Alert type="error" content={actionError} style={{ marginBottom: 12 }} /> : null}
      {deleteTarget ? `确定删除乘区「${deleteTarget.name}」吗？` : null}
    </Modal>
  </div>;
}
