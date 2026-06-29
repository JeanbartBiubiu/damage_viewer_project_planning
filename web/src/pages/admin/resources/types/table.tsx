import { Button, Skeleton, Space, Table, Typography } from '@arco-design/web-react';
import { EmptyState } from '../../../../components/EmptyState';
import { getTypesColumns } from './columns';
import type { TypesRecord } from './types';

type TypesTableProps = {
  loading: boolean;
  records: TypesRecord[];
  actionsDisabled: boolean;
  onView: (record: TypesRecord) => void;
  onEdit: (record: TypesRecord) => void;
  onCreate: () => void;
  onRefresh: () => void;
};

export function TypesTable({ loading, records, actionsDisabled, onView, onEdit, onCreate, onRefresh }: TypesTableProps) {
  const columns = getTypesColumns({ onView, onEdit });
  const scrollX = columns.reduce((sum, col) => sum + Number(col.width ?? 0), 0);
  const showSkeleton = loading && records.length === 0;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div className="crud-toolbar">
        <div className="crud-toolbar-copy">
          <Typography.Title heading={6} style={{ margin: 0 }}>
            类型定义列表
          </Typography.Title>
          <Typography.Text type="secondary">展示全部类型定义，不分页。</Typography.Text>
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
          rowKey="typeId"
          scroll={{ x: scrollX }}
          noDataElement={<EmptyState title="暂无类型定义数据" description="点击右上角「新增」按钮创建第一个类型定义。" />}
        />
      )}
    </Space>
  );
}
