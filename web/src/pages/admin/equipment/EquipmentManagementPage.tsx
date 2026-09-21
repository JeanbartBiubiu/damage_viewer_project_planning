import { ObjectRelationActions } from '../relations/ObjectRelationActions';
import { useRepresentativeImageColumn } from '../relations/useRepresentativeImageColumn';
import {
  Alert,
  Button,
  Empty,
  Input,
  Modal,
  Space,
  Table,
  Typography
} from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Panel } from '../../../components/Panel';
import { getErrorMessage } from '../../../services/apiClient';
import { deleteEquipment, listEquipment } from '../../../services/equipmentClient';
import type { Equipment } from '../../../types/equipment';
import { EquipmentAttributesModal } from './EquipmentAttributesModal';
import { EquipmentEditorModal, type EquipmentEditorMode } from './EquipmentEditorModal';
import { SkillRelationsModal } from '../relations/SkillRelationsModal';
import { SkillManagementPage } from '../skills/SkillManagementPage';

export type EquipmentManagementPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onDirtyChange: (dirty: boolean) => void;
};

type EditorState = {
  mode: EquipmentEditorMode;
  equipment: Equipment | null;
};

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

export function EquipmentManagementPage({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  onDirtyChange
}: EquipmentManagementPageProps) {
  const [keywordDraft, setKeywordDraft] = useState('');
  const [keyword, setKeyword] = useState<string | undefined>();
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [attributesTarget, setAttributesTarget] = useState<Equipment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Equipment | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [skillsTarget, setSkillsTarget] = useState<Equipment | null>(null);
  const [skillFocus, setSkillFocus] = useState<{ equipment: Equipment; skillKey: string; context: string } | null>(null);
  const skillFocusDirty = useRef(false);
  const focusContext = JSON.stringify([apiBaseUrl, selectedGameId, adminToken]);
  const requestSerial = useRef(0);

  const reportSkillDirty = useCallback((dirty: boolean) => {
    skillFocusDirty.current = dirty;
    onDirtyChange(dirty);
  }, [onDirtyChange]);

  const loadList = useCallback(async (queryKeyword?: string) => {
    const serial = requestSerial.current + 1;
    requestSerial.current = serial;
    const token = adminToken.trim();
    if (!selectedGameId || !token) {
      setEquipment([]);
      setTotal(0);
      setLoadError(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const result = await listEquipment(apiBaseUrl, selectedGameId, token, { keyword: queryKeyword });
      if (requestSerial.current !== serial) return;
      setEquipment(result.data.items);
      setTotal(result.data.total);
    } catch (error) {
      if (requestSerial.current !== serial) return;
      setEquipment([]);
      setTotal(0);
      setLoadError(getErrorMessage(error));
    } finally {
      if (requestSerial.current === serial) setLoading(false);
    }
  }, [adminToken, apiBaseUrl, selectedGameId]);

  useEffect(() => { void loadList(keyword); }, [keyword, loadList]);

  useEffect(() => {
    setSkillsTarget(null);
    setSkillFocus(null);
    skillFocusDirty.current = false;
  }, [focusContext]);

  useEffect(() => {
    setKeywordDraft('');
    setKeyword(undefined);
    setEditor(null);
    setAttributesTarget(null);
    setDeleteTarget(null);
    setDeleteError(null);
    setNotice(null);
    onDirtyChange(false);
  }, [onDirtyChange, selectedGameId]);

  const handleSaved = async (saved: Equipment) => {
    setEditor(null);
    setNotice(`装备「${saved.name}」已保存。`);
    onDirtyChange(false);
    await loadList(keyword);
  };

  const confirmDelete = async () => {
    if (!deleteTarget || !selectedGameId) return;
    const token = adminToken.trim();
    if (!token) {
      setDeleteError('请先配置 Admin Token。');
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      const deletedName = deleteTarget.name;
      await deleteEquipment(apiBaseUrl, selectedGameId, deleteTarget.equipmentKey, token);
      setDeleteTarget(null);
      setNotice(`装备「${deletedName}」已删除。`);
      await loadList(keyword);
    } catch (error) {
      setDeleteError(getErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  const { imageColumn, onImageSaved } = useRepresentativeImageColumn<Equipment>({
    apiBaseUrl, selectedGameId, adminToken,
    getTarget: record => ({ kind: 'equipment', key: record.equipmentKey, name: record.name })
  });
  const columns: TableColumnProps[] = [
    imageColumn,
    { title: '装备名称', dataIndex: 'name', width: 180 },
    { title: '装备标识', dataIndex: 'equipmentKey', width: 190 },
    {
      title: '说明',
      dataIndex: 'description',
      ellipsis: true,
      render: (value) => value || '—'
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 190,
      render: (value) => formatUpdatedAt(String(value ?? ''))
    },
    {
      title: '操作',
      width: 480,
      fixed: 'right',
      render: (_value, record: Equipment) => (
        <Space size="mini" wrap>
          <ObjectRelationActions
            key={`${apiBaseUrl}:${selectedGameId}:${record.equipmentKey}`}
            target={{ kind: 'equipment', key: record.equipmentKey, name: record.name }}
            apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} adminToken={adminToken}
            onDirtyChange={onDirtyChange}
            onImageSaved={() => onImageSaved(record)}
            onOpenSkills={() => setSkillsTarget(record)}
          />
          <Button size="mini" onClick={() => setEditor({ mode: 'view', equipment: record })}>查看</Button>
          <Button size="mini" onClick={() => setEditor({ mode: 'edit', equipment: record })}>编辑</Button>
          <Button size="mini" type="primary" onClick={() => setAttributesTarget(record)}>装备属性</Button>
          <Button size="mini" status="danger" onClick={() => {
            setDeleteTarget(record);
            setDeleteError(null);
          }}>删除</Button>
        </Space>
      )
    }
  ];

  if (skillFocus && skillFocus.context === focusContext) {
    return <SkillManagementPage
      key={`${focusContext}:${skillFocus.skillKey}`}
      apiBaseUrl={apiBaseUrl}
      selectedGameId={selectedGameId}
      adminToken={adminToken}
      onDirtyChange={reportSkillDirty}
      focus={{
        skillKey: skillFocus.skillKey,
        sourceKind: 'equipment',
        sourceKey: skillFocus.equipment.equipmentKey,
        sourceName: skillFocus.equipment.name,
        returnLabel: '返回装备技能',
        onReturn: () => {
          if (skillFocusDirty.current && !window.confirm('当前技能修改尚未保存，确定返回装备技能吗？')) return;
          reportSkillDirty(false);
          setSkillsTarget(skillFocus.equipment);
          setSkillFocus(null);
        }
      }}
    />;
  }

  return (
    <div className="page-stack">
      <Panel
        title="装备管理"
        actions={
          <Space>
            <Button loading={loading} disabled={!selectedGameId || !adminToken.trim()} onClick={() => void loadList(keyword)}>
              刷新
            </Button>
            <Button type="primary" disabled={!selectedGameId} onClick={() => setEditor({ mode: 'create', equipment: null })}>
              新增装备
            </Button>
          </Space>
        }
      >
        {!selectedGameId ? <Alert type="warning" content="请先在顶部选择游戏。" /> : null}
        {selectedGameId && !adminToken.trim() ? <Alert type="warning" content="请先在顶部配置 Admin Token。" /> : null}
        {loadError ? <Alert type="error" content={loadError} className="workspace-alert" /> : null}
        {notice ? <Alert type="success" content={notice} className="workspace-alert" /> : null}

        <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'end' }}>
          <label style={{ display: 'flex', flex: 1, flexDirection: 'column', gap: 6 }}>
            <span>关键词</span>
            <Input
              aria-label="装备关键词"
              value={keywordDraft}
              maxLength={100}
              allowClear
              onChange={setKeywordDraft}
              onPressEnter={() => setKeyword(keywordDraft.trim() || undefined)}
            />
          </label>
          <Space>
            <Button type="primary" disabled={!selectedGameId || !adminToken.trim()} onClick={() => setKeyword(keywordDraft.trim() || undefined)}>
              查询
            </Button>
            <Button onClick={() => { setKeywordDraft(''); setKeyword(undefined); }}>重置</Button>
          </Space>
        </div>

        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          共 {total} 件装备
        </Typography.Text>
        <Table
          className="data-table-shell"
          loading={loading}
          columns={columns}
          data={equipment}
          pagination={false}
          rowKey={(record: Equipment) => record.equipmentKey}
          scroll={{ x: 1344 }}
          noDataElement={<Empty description="暂无装备" />}
        />
      </Panel>

      {skillsTarget ? <SkillRelationsModal
        visible
        target={{ kind: 'equipment', key: skillsTarget.equipmentKey, name: skillsTarget.name }}
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        onDirtyChange={onDirtyChange}
        onClose={() => setSkillsTarget(null)}
        onEditSkill={(skillKey) => {
          reportSkillDirty(false);
          setSkillFocus({ equipment: skillsTarget, skillKey, context: focusContext });
          setSkillsTarget(null);
        }}
      /> : null}

      <EquipmentEditorModal
        visible={editor !== null}
        mode={editor?.mode ?? 'view'}
        equipment={editor?.equipment ?? null}
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        onClose={() => setEditor(null)}
        onSaved={handleSaved}
        onDirtyChange={onDirtyChange}
      />

      <EquipmentAttributesModal
        visible={attributesTarget !== null}
        equipment={attributesTarget}
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        onClose={() => setAttributesTarget(null)}
        onSaved={() => setNotice(`装备「${attributesTarget?.name ?? ''}」的属性已保存。`)}
        onDirtyChange={onDirtyChange}
      />

      <Modal
        title="删除装备"
        visible={deleteTarget !== null}
        okText="删除"
        cancelText="取消"
        okButtonProps={{ status: 'danger' }}
        confirmLoading={deleting}
        maskClosable
        onCancel={() => {
          if (deleting) return;
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        onOk={() => void confirmDelete()}
      >
        {deleteError ? <Alert type="error" content={deleteError} style={{ marginBottom: 12 }} /> : null}
        {deleteTarget ? `确定删除装备「${deleteTarget.name}」吗？` : null}
      </Modal>
    </div>
  );
}
