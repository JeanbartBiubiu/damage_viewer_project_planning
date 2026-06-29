import { Button, Skeleton, Space, Table, Typography } from '@arco-design/web-react';
import { EmptyState } from '../../../../components/EmptyState';
import type { StatusDefinition } from '../../../../types/api';
import {
  getControlStateProfileColumns,
  getStatusAttributeModifierColumns,
  getStatusDefinitionColumns,
  getStatusModifierGroupColumns,
  getStatusPeriodicHpEffectColumns
} from './columns';
import { RESOURCE_LABELS } from './constants';
import { recordContains, statusAttributeModifierKey, statusModifierGroupKey, statusPeriodicHpEffectKey } from './transforms';
import type { CreateResource, OpenRecordModal, StatusResourceId, StatusSnapshot, StatusRecordState } from './types';

type TablePropsBase = {
  snapshot: StatusSnapshot;
  recordsState: StatusRecordState;
  actionsDisabled: boolean;
  onCreate: CreateResource;
  openRecordModal: OpenRecordModal;
};

function TableToolbar({ resourceId, actionsDisabled, onCreate }: { resourceId: StatusResourceId; actionsDisabled: boolean; onCreate: CreateResource }) {
  return (
    <div className="crud-toolbar">
      <div className="crud-toolbar-copy">
        <Typography.Title heading={6} style={{ margin: 0 }}>
          {RESOURCE_LABELS[resourceId]}列表
        </Typography.Title>
        <Typography.Text type="secondary">当前接口不提供删除能力；保存会覆盖同主键资源。</Typography.Text>
      </div>
      <Button type="primary" disabled={actionsDisabled} onClick={() => onCreate(resourceId)}>
        新增
      </Button>
    </div>
  );
}

export function StatusDefinitionsTable({
  snapshot,
  statusFilter,
  searchText,
  recordsState,
  actionsDisabled,
  onCreate,
  openRecordModal
}: TablePropsBase & { statusFilter: string | undefined; searchText: string }) {
  const resourceId: StatusResourceId = 'statusDefinitions';
  const records = snapshot.statusDefinitions.filter(
    (record) => (!statusFilter || record.statusId === statusFilter) && recordContains(record, searchText)
  );
  const columns = getStatusDefinitionColumns({
    onView: (record) => openRecordModal(resourceId, 'view', record),
    onEdit: (record) => openRecordModal(resourceId, 'edit', record)
  });
  const scrollX = columns.reduce((sum, col) => sum + Number(col.width ?? 0), 0);
  const showSkeleton = recordsState === 'loading' && snapshot.statusDefinitions.length === 0;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <TableToolbar resourceId={resourceId} actionsDisabled={actionsDisabled} onCreate={onCreate} />
      {showSkeleton ? (
        <Skeleton text={{ rows: 5, width: ['100%', '60%', '40%', '80%', '50%'] }} animation />
      ) : (
        <Table
          className="data-table-shell"
          loading={recordsState === 'loading'}
          pagination={false}
          rowKey="statusId"
          data={records}
          scroll={{ x: scrollX }}
          columns={columns}
          noDataElement={<EmptyState title="暂无状态定义数据" description="点击右上角「新增」按钮创建第一个状态定义。" />}
        />
      )}
    </Space>
  );
}

export function ControlStateProfilesTable({
  snapshot,
  selectedStatus,
  searchText,
  recordsState,
  actionsDisabled,
  onCreate,
  openRecordModal
}: TablePropsBase & { selectedStatus: StatusDefinition | undefined; searchText: string }) {
  const resourceId: StatusResourceId = 'controlStateProfiles';
  const records = snapshot.controlStateProfiles.filter((record) => {
    if (selectedStatus?.controlProfileId && record.controlProfileId !== selectedStatus.controlProfileId) {
      return false;
    }
    return recordContains(record, searchText);
  });
  const columns = getControlStateProfileColumns({
    onView: (record) => openRecordModal(resourceId, 'view', record),
    onEdit: (record) => openRecordModal(resourceId, 'edit', record)
  });
  const scrollX = columns.reduce((sum, col) => sum + Number(col.width ?? 0), 0);
  const showSkeleton = recordsState === 'loading' && snapshot.controlStateProfiles.length === 0;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <TableToolbar resourceId={resourceId} actionsDisabled={actionsDisabled} onCreate={onCreate} />
      {showSkeleton ? (
        <Skeleton text={{ rows: 5, width: ['100%', '60%', '40%', '80%', '50%'] }} animation />
      ) : (
        <Table
          className="data-table-shell"
          loading={recordsState === 'loading'}
          pagination={false}
          rowKey="controlProfileId"
          data={records}
          scroll={{ x: scrollX }}
          columns={columns}
          noDataElement={<EmptyState title="暂无控制语义数据" description="点击右上角「新增」按钮创建第一个控制语义。" />}
        />
      )}
    </Space>
  );
}

export function StatusModifierGroupsTable({
  snapshot,
  statusFilter,
  searchText,
  recordsState,
  actionsDisabled,
  onCreate,
  openRecordModal
}: TablePropsBase & { statusFilter: string | undefined; searchText: string }) {
  const resourceId: StatusResourceId = 'statusModifierGroups';
  const records = snapshot.statusModifierGroups.filter(
    (record) => (!statusFilter || record.statusId === statusFilter) && recordContains(record, searchText)
  );
  const columns = getStatusModifierGroupColumns({
    onView: (record) => openRecordModal(resourceId, 'view', record),
    onEdit: (record) => openRecordModal(resourceId, 'edit', record)
  });
  const scrollX = columns.reduce((sum, col) => sum + Number(col.width ?? 0), 0);
  const showSkeleton = recordsState === 'loading' && snapshot.statusModifierGroups.length === 0;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <TableToolbar resourceId={resourceId} actionsDisabled={actionsDisabled} onCreate={onCreate} />
      {showSkeleton ? (
        <Skeleton text={{ rows: 5, width: ['100%', '60%', '40%', '80%', '50%'] }} animation />
      ) : (
        <Table
          className="data-table-shell"
          loading={recordsState === 'loading'}
          pagination={false}
          rowKey={statusModifierGroupKey}
          data={records}
          scroll={{ x: scrollX }}
          columns={columns}
          noDataElement={<EmptyState title="暂无效果组数据" description="点击右上角「新增」按钮创建第一个效果组。" />}
        />
      )}
    </Space>
  );
}

export function StatusAttributeModifiersTable({
  snapshot,
  statusFilter,
  searchText,
  recordsState,
  actionsDisabled,
  onCreate,
  openRecordModal
}: TablePropsBase & { statusFilter: string | undefined; searchText: string }) {
  const resourceId: StatusResourceId = 'statusAttributeModifiers';
  const records = snapshot.statusAttributeModifiers.filter(
    (record) => (!statusFilter || record.statusId === statusFilter) && recordContains(record, searchText)
  );
  const columns = getStatusAttributeModifierColumns({
    onView: (record) => openRecordModal(resourceId, 'view', record),
    onEdit: (record) => openRecordModal(resourceId, 'edit', record)
  });
  const scrollX = columns.reduce((sum, col) => sum + Number(col.width ?? 0), 0);
  const showSkeleton = recordsState === 'loading' && snapshot.statusAttributeModifiers.length === 0;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <TableToolbar resourceId={resourceId} actionsDisabled={actionsDisabled} onCreate={onCreate} />
      {showSkeleton ? (
        <Skeleton text={{ rows: 5, width: ['100%', '60%', '40%', '80%', '50%'] }} animation />
      ) : (
        <Table
          className="data-table-shell"
          loading={recordsState === 'loading'}
          pagination={false}
          rowKey={statusAttributeModifierKey}
          data={records}
          scroll={{ x: scrollX }}
          columns={columns}
          noDataElement={<EmptyState title="暂无属性修饰数据" description="点击右上角「新增」按钮创建第一个属性修饰。" />}
        />
      )}
    </Space>
  );
}

export function StatusPeriodicHpEffectsTable({
  snapshot,
  statusFilter,
  searchText,
  recordsState,
  actionsDisabled,
  onCreate,
  openRecordModal
}: TablePropsBase & { statusFilter: string | undefined; searchText: string }) {
  const resourceId: StatusResourceId = 'statusPeriodicHpEffects';
  const records = snapshot.statusPeriodicHpEffects.filter(
    (record) => (!statusFilter || record.statusId === statusFilter) && recordContains(record, searchText)
  );
  const columns = getStatusPeriodicHpEffectColumns({
    onView: (record) => openRecordModal(resourceId, 'view', record),
    onEdit: (record) => openRecordModal(resourceId, 'edit', record)
  });
  const scrollX = columns.reduce((sum, col) => sum + Number(col.width ?? 0), 0);
  const showSkeleton = recordsState === 'loading' && snapshot.statusPeriodicHpEffects.length === 0;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <TableToolbar resourceId={resourceId} actionsDisabled={actionsDisabled} onCreate={onCreate} />
      {showSkeleton ? (
        <Skeleton text={{ rows: 5, width: ['100%', '60%', '40%', '80%', '50%'] }} animation />
      ) : (
        <Table
          className="data-table-shell"
          loading={recordsState === 'loading'}
          pagination={false}
          rowKey={statusPeriodicHpEffectKey}
          data={records}
          scroll={{ x: scrollX }}
          columns={columns}
          noDataElement={<EmptyState title="暂无周期生命效果数据" description="点击右上角「新增」按钮创建第一个周期生命效果。" />}
        />
      )}
    </Space>
  );
}
