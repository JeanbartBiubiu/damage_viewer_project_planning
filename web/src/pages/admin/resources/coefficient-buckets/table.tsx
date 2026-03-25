import { Button, Space, Table, Typography } from '@arco-design/web-react';
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

      <Table
        className="data-table-shell"
        loading={loading}
        columns={getCoefficientBucketsColumns({ onView, onEdit })}
        data={records}
        pagination={false}
        rowKey="bucketKey"
        scroll={{ x: 1280 }}
      />
    </Space>
  );
}
