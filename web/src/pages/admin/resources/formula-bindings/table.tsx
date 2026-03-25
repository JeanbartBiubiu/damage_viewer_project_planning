import { Button, Space, Table, Typography } from '@arco-design/web-react';
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

      <Table
        className="data-table-shell"
        loading={loading}
        columns={getFormulaBindingsColumns({ onView, onEdit })}
        data={records}
        pagination={false}
        rowKey={(record) => `${record.targetCategory}|${record.targetId}|${record.bindingKey}`}
        scroll={{ x: 1080 }}
      />
    </Space>
  );
}
