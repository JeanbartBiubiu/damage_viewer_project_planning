import { Button, Skeleton, Space, Table, Typography } from '@arco-design/web-react';
import { EmptyState } from '../../../../components/EmptyState';
import { getStatusActionControlRulesColumns } from './columns';
import type { StatusActionControlRulesRecord } from './types';

type StatusActionControlRulesTableProps = {
  loading: boolean;
  records: StatusActionControlRulesRecord[];
  actionsDisabled: boolean;
  onView: (record: StatusActionControlRulesRecord) => void;
  onEdit: (record: StatusActionControlRulesRecord) => void;
  onCreate: () => void;
  onRefresh: () => void;
};

export function StatusActionControlRulesTable({
  loading,
  records,
  actionsDisabled,
  onView,
  onEdit,
  onCreate,
  onRefresh
}: StatusActionControlRulesTableProps) {
  const columns = getStatusActionControlRulesColumns({ onView, onEdit });
  const scrollX = columns.reduce((sum, col) => sum + Number(col.width ?? 0), 0);
  const showSkeleton = loading && records.length === 0;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div className="crud-toolbar">
        <div className="crud-toolbar-copy">
          <Typography.Title heading={6} style={{ margin: 0 }}>
            状态动作规则列表
          </Typography.Title>
          <Typography.Text type="secondary">查看、编辑入口固定在最右操作列，新增按钮位于表格右上角。</Typography.Text>
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
          rowKey="ruleId"
          scroll={{ x: scrollX }}
          noDataElement={<EmptyState title="暂无状态动作控制规则数据" description="点击右上角「新增」按钮创建第一条规则。" />}
        />
      )}
    </Space>
  );
}
