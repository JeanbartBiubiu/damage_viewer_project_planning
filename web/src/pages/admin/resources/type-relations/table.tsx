import { Button, Skeleton, Space, Table, Typography } from '@arco-design/web-react';
import { EmptyState } from '../../../../components/EmptyState';
import { getTypeRelationsColumns } from './columns';
import type { TypeRelationsRecord } from './types';

type TypeRelationsTableProps = {
  loading: boolean;
  records: TypeRelationsRecord[];
  actionsDisabled: boolean;
  onView: (record: TypeRelationsRecord) => void;
  onEdit: (record: TypeRelationsRecord) => void;
  onDelete: (record: TypeRelationsRecord) => void;
  onCreate: () => void;
  onRefresh: () => void;
};

export function TypeRelationsTable({
  loading,
  records,
  actionsDisabled,
  onView,
  onEdit,
  onDelete,
  onCreate,
  onRefresh
}: TypeRelationsTableProps) {
  const columns = getTypeRelationsColumns({ onView, onEdit, onDelete, deleteDisabled: actionsDisabled });
  const scrollX = columns.reduce((sum, col) => sum + Number(col.width ?? 0), 0);
  const showSkeleton = loading && records.length === 0;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div className="crud-toolbar">
        <div className="crud-toolbar-copy">
          <Typography.Title heading={6} style={{ margin: 0 }}>
            类型挂载列表
          </Typography.Title>
          <Typography.Text type="secondary">展示全部类型挂载关系，不分页。</Typography.Text>
        </div>

        <Space>
          <Button onClick={onRefresh} disabled={actionsDisabled}>
            刷新
          </Button>
          <Button type="primary" onClick={onCreate} disabled={actionsDisabled}>
            新增
          </Button>
        </Space>
      </div>

      {showSkeleton ? (
        <Skeleton text={{ rows: 5, width: ['100%', '60%', '40%', '80%', '50%'] }} animation />
      ) : (
        <Table
          className="data-table-shell"
          loading={loading}
          columns={columns}
          data={records}
          pagination={false}
          rowKey={(record) => `${record.typeId}|${record.targetCategory}|${record.targetId}`}
          scroll={{ x: scrollX }}
          noDataElement={<EmptyState title="暂无类型挂载数据" description="点击右上角「新增」按钮创建第一条类型挂载。" />}
        />
      )}
    </Space>
  );
}
