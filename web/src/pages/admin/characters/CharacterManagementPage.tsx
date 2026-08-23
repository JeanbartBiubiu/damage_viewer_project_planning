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
import { deleteCharacter, listCharacters } from '../../../services/characterClient';
import type { Character } from '../../../types/character';
import { CharacterAttributesModal } from './CharacterAttributesModal';
import { CharacterEditorModal, type CharacterEditorMode } from './CharacterEditorModal';

export type CharacterManagementPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onDirtyChange: (dirty: boolean) => void;
};

type EditorState = {
  mode: CharacterEditorMode;
  character: Character | null;
};

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

export function CharacterManagementPage({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  onDirtyChange
}: CharacterManagementPageProps) {
  const [keywordDraft, setKeywordDraft] = useState('');
  const [keyword, setKeyword] = useState<string | undefined>();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [attributesTarget, setAttributesTarget] = useState<Character | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Character | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const requestSerial = useRef(0);

  const loadList = useCallback(async (queryKeyword?: string) => {
    const serial = requestSerial.current + 1;
    requestSerial.current = serial;
    const token = adminToken.trim();
    if (!selectedGameId || !token) {
      setCharacters([]);
      setTotal(0);
      setLoadError(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const result = await listCharacters(apiBaseUrl, selectedGameId, token, {
        keyword: queryKeyword
      });
      if (requestSerial.current !== serial) return;
      setCharacters(result.data.items);
      setTotal(result.data.total);
    } catch (error) {
      if (requestSerial.current !== serial) return;
      setCharacters([]);
      setTotal(0);
      setLoadError(getErrorMessage(error));
    } finally {
      if (requestSerial.current === serial) setLoading(false);
    }
  }, [adminToken, apiBaseUrl, selectedGameId]);

  useEffect(() => { void loadList(keyword); }, [keyword, loadList]);

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

  const handleSaved = async (saved: Character) => {
    setEditor(null);
    setNotice(`角色「${saved.name}」已保存。`);
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
      await deleteCharacter(apiBaseUrl, selectedGameId, deleteTarget.characterKey, token);
      setDeleteTarget(null);
      setNotice(`角色「${deletedName}」已删除。`);
      await loadList(keyword);
    } catch (error) {
      setDeleteError(getErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  const columns: TableColumnProps[] = [
    { title: '角色名称', dataIndex: 'name', width: 180 },
    { title: '角色标识', dataIndex: 'characterKey', width: 190 },
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
      width: 290,
      fixed: 'right',
      render: (_value, record: Character) => (
        <Space size="mini">
          <Button size="mini" onClick={() => setEditor({ mode: 'view', character: record })}>查看</Button>
          <Button size="mini" onClick={() => setEditor({ mode: 'edit', character: record })}>编辑</Button>
          <Button size="mini" type="primary" onClick={() => setAttributesTarget(record)}>等级属性</Button>
          <Button size="mini" status="danger" onClick={() => {
            setDeleteTarget(record);
            setDeleteError(null);
          }}>删除</Button>
        </Space>
      )
    }
  ];

  return (
    <div className="page-stack">
      <Panel
        title="角色管理"
        actions={
          <Space>
            <Button
              loading={loading}
              disabled={!selectedGameId || !adminToken.trim()}
              onClick={() => void loadList(keyword)}
            >刷新</Button>
            <Button type="primary" disabled={!selectedGameId} onClick={() => setEditor({ mode: 'create', character: null })}>
              新增角色
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
              aria-label="角色关键词"
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
          共 {total} 个角色
        </Typography.Text>
        <Table
          className="data-table-shell"
          loading={loading}
          columns={columns}
          data={characters}
          pagination={false}
          rowKey={(record: Character) => record.characterKey}
          scroll={{ x: 950 }}
          noDataElement={<Empty description="暂无角色" />}
        />
      </Panel>

      <CharacterEditorModal
        visible={editor !== null}
        mode={editor?.mode ?? 'view'}
        character={editor?.character ?? null}
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        onClose={() => setEditor(null)}
        onSaved={handleSaved}
        onDirtyChange={onDirtyChange}
      />

      <CharacterAttributesModal
        visible={attributesTarget !== null}
        character={attributesTarget}
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        onClose={() => setAttributesTarget(null)}
        onSaved={() => setNotice(`角色「${attributesTarget?.name ?? ''}」的等级属性已保存。`)}
        onDirtyChange={onDirtyChange}
      />

      <Modal
        title="删除角色"
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
        {deleteTarget ? `确定删除角色「${deleteTarget.name}」吗？` : null}
      </Modal>
    </div>
  );
}
