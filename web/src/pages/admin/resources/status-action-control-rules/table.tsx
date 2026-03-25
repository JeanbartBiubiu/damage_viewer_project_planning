import { Button, Space, Table, Typography } from '@arco-design/web-react';
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

      <Table
        className="data-table-shell"
        loading={loading}
        columns={getStatusActionControlRulesColumns({ onView, onEdit })}
        data={records}
        pagination={false}
        rowKey="ruleId"
        scroll={{ x: 1180 }}
      />
    </Space>
  );
}
