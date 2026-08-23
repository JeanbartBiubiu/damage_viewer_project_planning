import {
  Alert,
  Button,
  Input,
  Modal,
  Radio,
  Space,
  Table,
  Tag,
  Typography
} from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState } from '../../../components/EmptyState';
import { Panel } from '../../../components/Panel';
import { getErrorMessage } from '../../../services/apiClient';
import {
  listAttributes,
  updateAttribute
} from '../../../services/attributeClient';
import type {
  Attribute,
  AttributeListQuery,
  AttributeStatus,
  UpdateAttributeRequest
} from '../../../types/attribute';
import { AttributeEditorModal } from './AttributeEditorModal';
import type { AttributeEditorMode } from './attributeForm';

export type AttributeManagementPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onDirtyChange: (dirty: boolean) => void;
};

type StatusFilter = AttributeStatus | '';

type EditorState = {
  mode: AttributeEditorMode;
  attribute: Attribute | null;
};

type StatusChangeTarget = {
  attribute: Attribute;
  nextStatus: AttributeStatus;
};

const EMPTY_QUERY: AttributeListQuery = {};

function formatValueType(valueType: Attribute['valueType']): string {
  return valueType === 'INTEGER' ? '整数' : '小数';
}

function formatRange(attribute: Attribute): string {
  if (attribute.minValue === null && attribute.maxValue === null) {
    return '未限制';
  }
  if (attribute.minValue === null) {
    return `≤ ${attribute.maxValue}`;
  }
  if (attribute.maxValue === null) {
    return `≥ ${attribute.minValue}`;
  }
  return `${attribute.minValue} ～ ${attribute.maxValue}`;
}

function formatUpdatedAt(value: string): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function updateRequestFor(attribute: Attribute, status: AttributeStatus): UpdateAttributeRequest {
  return {
    name: attribute.name,
    valueType: attribute.valueType,
    minValue: attribute.minValue,
    maxValue: attribute.maxValue,
    description: attribute.description,
    status,
    sortOrder: attribute.sortOrder
  };
}

export function AttributeManagementPage({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  onDirtyChange
}: AttributeManagementPageProps) {
  const [keywordDraft, setKeywordDraft] = useState('');
  const [statusDraft, setStatusDraft] = useState<StatusFilter>('');
  const [appliedQuery, setAppliedQuery] = useState<AttributeListQuery>(EMPTY_QUERY);
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedAttributeKey, setSelectedAttributeKey] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [statusUpdatingKey, setStatusUpdatingKey] = useState<string | null>(null);
  const [statusChangeTarget, setStatusChangeTarget] = useState<StatusChangeTarget | null>(null);
  const [statusUpdateError, setStatusUpdateError] = useState<string | null>(null);
  const requestSerial = useRef(0);

  const loadList = useCallback(async (
    query: AttributeListQuery,
    preferredAttributeKey?: string
  ) => {
    const serial = requestSerial.current + 1;
    requestSerial.current = serial;

    if (!selectedGameId || !adminToken.trim()) {
      setAttributes([]);
      setTotal(0);
      setLoadError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);
    try {
      const result = await listAttributes(
        apiBaseUrl,
        selectedGameId,
        adminToken.trim(),
        query
      );
      if (requestSerial.current !== serial) {
        return;
      }
      setAttributes(result.data.items);
      setTotal(result.data.total);
      setSelectedAttributeKey((current) => {
        const desired = preferredAttributeKey ?? current;
        return desired && result.data.items.some((item) => item.attributeKey === desired)
          ? desired
          : null;
      });
    } catch (error) {
      if (requestSerial.current !== serial) {
        return;
      }
      setAttributes([]);
      setTotal(0);
      setLoadError(getErrorMessage(error));
    } finally {
      if (requestSerial.current === serial) {
        setLoading(false);
      }
    }
  }, [adminToken, apiBaseUrl, selectedGameId]);

  useEffect(() => {
    void loadList(appliedQuery);
  }, [appliedQuery, loadList]);

  useEffect(() => {
    setKeywordDraft('');
    setStatusDraft('');
    setAppliedQuery(EMPTY_QUERY);
    setSelectedAttributeKey(null);
    setEditor(null);
    setNotice(null);
    setStatusChangeTarget(null);
    setStatusUpdateError(null);
    setStatusUpdatingKey(null);
    onDirtyChange(false);
  }, [onDirtyChange, selectedGameId]);

  const applyQuery = () => {
    setNotice(null);
    setAppliedQuery({
      keyword: keywordDraft.trim() || undefined,
      status: statusDraft || undefined
    });
  };

  const resetQuery = () => {
    setKeywordDraft('');
    setStatusDraft('');
    setNotice(null);
    setAppliedQuery(EMPTY_QUERY);
  };

  const openEditor = (mode: AttributeEditorMode, attribute: Attribute | null) => {
    setSelectedAttributeKey(attribute?.attributeKey ?? null);
    setEditor({ mode, attribute });
    setNotice(null);
  };

  const handleSaved = async (saved: Attribute) => {
    setEditor(null);
    onDirtyChange(false);
    setKeywordDraft('');
    setStatusDraft('');
    setAppliedQuery(EMPTY_QUERY);
    setNotice(`属性「${saved.name}」已保存。`);
    await loadList(EMPTY_QUERY, saved.attributeKey);
  };

  const openStatusChange = (attribute: Attribute, nextStatus: AttributeStatus) => {
    setStatusChangeTarget({ attribute, nextStatus });
    setStatusUpdateError(null);
  };

  const confirmStatusChange = async () => {
    const target = statusChangeTarget;
    if (!target || statusUpdatingKey) {
      return;
    }

    const { attribute, nextStatus } = target;
    const actionLabel = nextStatus === 'DISABLED' ? '停用' : '启用';

    if (!selectedGameId) {
      setStatusUpdateError('请先在顶部选择游戏。');
      return;
    }
    const token = adminToken.trim();
    if (!token) {
      setStatusUpdateError(`${actionLabel}需要 Admin Token。`);
      return;
    }

    setStatusUpdatingKey(attribute.attributeKey);
    setStatusUpdateError(null);
    setNotice(null);
    try {
      const result = await updateAttribute(
        apiBaseUrl,
        selectedGameId,
        attribute.attributeKey,
        token,
        updateRequestFor(attribute, nextStatus)
      );
      setKeywordDraft('');
      setStatusDraft('');
      setAppliedQuery(EMPTY_QUERY);
      setNotice(`属性「${result.data.name}」已${actionLabel}。`);
      setStatusChangeTarget(null);
      setStatusUpdateError(null);
      await loadList(EMPTY_QUERY, result.data.attributeKey);
    } catch (error) {
      setStatusUpdateError(getErrorMessage(error));
    } finally {
      setStatusUpdatingKey(null);
    }
  };

  const columns: TableColumnProps[] = [
    {
      title: '属性名称',
      dataIndex: 'name',
      width: 180,
      render: (_value, record: Attribute) => (
        <Space>
          <Typography.Text bold>{record.name}</Typography.Text>
          {record.attributeKey === selectedAttributeKey ? <Tag color="arcoblue">已选中</Tag> : null}
        </Space>
      )
    },
    { title: '稳定标识', dataIndex: 'attributeKey', width: 180 },
    {
      title: '数值类型',
      dataIndex: 'valueType',
      width: 100,
      render: (value) => formatValueType(value as Attribute['valueType'])
    },
    {
      title: '有效范围',
      width: 150,
      render: (_value, record: Attribute) => formatRange(record)
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value) => value === 'ENABLED'
        ? <Tag color="green">启用</Tag>
        : <Tag color="gray">停用</Tag>
    },
    { title: '排序', dataIndex: 'sortOrder', width: 80 },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 190,
      render: (value) => formatUpdatedAt(String(value ?? ''))
    },
    {
      title: '操作',
      width: 210,
      fixed: 'right',
      render: (_value, record: Attribute) => (
        <Space size="mini">
          <Button size="mini" onClick={() => openEditor('view', record)}>
            查看
          </Button>
          <Button size="mini" onClick={() => openEditor('edit', record)}>
            编辑
          </Button>
          {record.status === 'ENABLED' ? (
            <Button
              size="mini"
              status="danger"
              loading={statusUpdatingKey === record.attributeKey}
              disabled={Boolean(statusUpdatingKey) && statusUpdatingKey !== record.attributeKey}
              onClick={() => openStatusChange(record, 'DISABLED')}
            >
              停用
            </Button>
          ) : (
            <Button
              size="mini"
              status="success"
              loading={statusUpdatingKey === record.attributeKey}
              disabled={Boolean(statusUpdatingKey) && statusUpdatingKey !== record.attributeKey}
              onClick={() => openStatusChange(record, 'ENABLED')}
            >
              启用
            </Button>
          )}
        </Space>
      )
    }
  ];

  return (
    <div className="page-stack">
      <Panel
        title="属性管理"
        actions={
          <Space>
            <Button
              onClick={() => void loadList(appliedQuery)}
              loading={loading}
              disabled={!selectedGameId || !adminToken.trim()}
            >
              刷新
            </Button>
            <Button
              type="primary"
              disabled={!selectedGameId}
              onClick={() => openEditor('create', null)}
            >
              新增属性
            </Button>
          </Space>
        }
      >
        {!selectedGameId ? <Alert type="warning" content="请先在顶部选择游戏。" /> : null}
        {selectedGameId && !adminToken.trim() ? (
          <Alert type="warning" content="请先在顶部配置 Admin Token，才能读取和保存属性。" />
        ) : null}
        {loadError ? <Alert type="error" content={loadError} className="workspace-alert" /> : null}
        {notice ? <Alert type="success" content={notice} className="workspace-alert" /> : null}

        <div
          aria-label="属性查询"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(220px, 1fr) minmax(160px, 220px) auto',
            gap: 12,
            alignItems: 'end',
            marginBottom: 16
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span>关键词</span>
            <Input
              aria-label="关键词"
              value={keywordDraft}
              maxLength={100}
              allowClear
              placeholder="按稳定标识或属性名称查询"
              onChange={setKeywordDraft}
              onPressEnter={applyQuery}
            />
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span>状态筛选</span>
            <div role="group" aria-label="状态筛选">
              <Radio.Group
                type="button"
                size="small"
                value={statusDraft}
                onChange={(value) => {
                  if (value === '' || value === 'ENABLED' || value === 'DISABLED') {
                    setStatusDraft(value);
                  }
                }}
              >
                <Radio value="">全部</Radio>
                <Radio value="ENABLED">启用</Radio>
                <Radio value="DISABLED">停用</Radio>
              </Radio.Group>
            </div>
          </div>
          <Space>
            <Button type="primary" onClick={applyQuery} disabled={!selectedGameId || !adminToken.trim()}>
              查询
            </Button>
            <Button onClick={resetQuery}>重置</Button>
          </Space>
        </div>

        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          共 {total} 条属性
        </Typography.Text>
        <Table
          className="data-table-shell"
          loading={loading}
          columns={columns}
          data={attributes}
          pagination={false}
          rowKey={(record: Attribute) => record.attributeKey}
          scroll={{ x: 1190 }}
          onRow={(record: Attribute) => ({
            onClick: () => setSelectedAttributeKey(record.attributeKey)
          })}
          noDataElement={
            <EmptyState
              title="暂无属性，可以新增第一条属性"
              description="属性列表为空时，点击“新增属性”开始录入。"
            />
          }
        />
      </Panel>

      <AttributeEditorModal
        visible={editor !== null}
        mode={editor?.mode ?? 'view'}
        attribute={editor?.attribute ?? null}
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        onClose={() => setEditor(null)}
        onSaved={handleSaved}
        onDirtyChange={onDirtyChange}
      />

      <Modal
        title={statusChangeTarget?.nextStatus === 'ENABLED' ? '启用属性' : '停用属性'}
        visible={statusChangeTarget !== null}
        okText={statusChangeTarget?.nextStatus === 'ENABLED' ? '启用' : '停用'}
        cancelText="取消"
        okButtonProps={{
          status: statusChangeTarget?.nextStatus === 'ENABLED' ? 'success' : 'danger'
        }}
        confirmLoading={Boolean(statusUpdatingKey)}
        onCancel={() => {
          if (statusUpdatingKey) {
            return;
          }
          setStatusChangeTarget(null);
          setStatusUpdateError(null);
        }}
        onOk={() => confirmStatusChange()}
      >
        {statusUpdateError ? <Alert type="error" content={statusUpdateError} /> : null}
        {statusChangeTarget
          ? `确定${statusChangeTarget.nextStatus === 'DISABLED' ? '停用' : '启用'}属性「${statusChangeTarget.attribute.name}」吗？`
          : null}
      </Modal>
    </div>
  );
}
