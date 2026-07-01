import { Button, Skeleton, Space, Table, Typography } from '@arco-design/web-react';
import { EmptyState } from '../../../../components/EmptyState';
import { getCoefficientBucketsColumns } from './columns';
import type { CoefficientBucketsRecord } from './types';

type CoefficientBucketsTableProps = {
  loading: boolean;
  records: CoefficientBucketsRecord[];
  actionsDisabled: boolean;
  onView: (record: CoefficientBucketsRecord) => void;
  onEdit: (record: CoefficientBucketsRecord) => void;
  onCreate: () => void;
  onRefresh: () => void;
};

export function CoefficientBucketsTable({
  loading,
  records,
  actionsDisabled,
  onView,
  onEdit,
  onCreate,
  onRefresh
}: CoefficientBucketsTableProps) {
  const columns = getCoefficientBucketsColumns({ onView, onEdit });
  const scrollX = columns.reduce((sum, col) => sum + Number(col.width ?? 0), 0);
  const showSkeleton = loading && records.length === 0;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div className="crud-toolbar">
        <div className="crud-toolbar-copy">
          <Typography.Title heading={6} style={{ margin: 0 }}>
            乘区桶列表
          </Typography.Title>
          <Typography.Text type="secondary">保留全量表格，新增按钮固定放在表格工具栏右侧。</Typography.Text>
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
          rowKey="bucketKey"
          scroll={{ x: scrollX }}
          noDataElement={<EmptyState title="暂无乘区桶数据" description="点击右上角「新增」按钮创建第一个乘区桶。" />}
        />
      )}
    </Space>
  );
}
