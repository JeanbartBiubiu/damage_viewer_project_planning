import { Button, Skeleton, Space, Table, Typography } from '@arco-design/web-react';
import { EmptyState } from '../../../../components/EmptyState';
import { getFormulaBindingsColumns } from './columns';
import type { FormulaBindingsRecord } from './types';

type FormulaBindingsTableProps = {
  loading: boolean;
  records: FormulaBindingsRecord[];
  actionsDisabled: boolean;
  onView: (record: FormulaBindingsRecord) => void;
  onEdit: (record: FormulaBindingsRecord) => void;
  onCreate: () => void;
  onRefresh: () => void;
};

export function FormulaBindingsTable({
  loading,
  records,
  actionsDisabled,
  onView,
  onEdit,
  onCreate,
  onRefresh
}: FormulaBindingsTableProps) {
  const columns = getFormulaBindingsColumns({ onView, onEdit });
  const scrollX = columns.reduce((sum, col) => sum + Number(col.width ?? 0), 0);
  const showSkeleton = loading && records.length === 0;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div className="crud-toolbar">
        <div className="crud-toolbar-copy">
          <Typography.Title heading={6} style={{ margin: 0 }}>
            公式绑定列表
          </Typography.Title>
          <Typography.Text type="secondary">表格右上角保留新增按钮，操作列固定在最右侧。</Typography.Text>
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
          rowKey={(record) => `${record.targetCategory}|${record.targetId}|${record.bindingKey}`}
          scroll={{ x: scrollX }}
          noDataElement={<EmptyState title="暂无公式绑定数据" description="点击右上角「新增」按钮创建第一条公式绑定。" />}
        />
      )}
    </Space>
  );
}
