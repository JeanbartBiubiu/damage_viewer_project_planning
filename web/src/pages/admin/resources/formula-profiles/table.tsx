import { Button, Space, Table, Typography } from '@arco-design/web-react';
import { getFormulaProfilesColumns } from './columns';
import type { FormulaProfilesRecord } from './types';

type FormulaProfilesTableProps = {
  loading: boolean;
  records: FormulaProfilesRecord[];
  actionsDisabled: boolean;
  onView: (record: FormulaProfilesRecord) => void;
  onEdit: (record: FormulaProfilesRecord) => void;
  onCreate: () => void;
  onRefresh: () => void;
};

export function FormulaProfilesTable({
  loading,
  records,
  actionsDisabled,
  onView,
  onEdit,
  onCreate,
  onRefresh
}: FormulaProfilesTableProps) {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div className="crud-toolbar">
        <div className="crud-toolbar-copy">
          <Typography.Title heading={6} style={{ margin: 0 }}>
            公式档案列表
          </Typography.Title>
          <Typography.Text type="secondary">直接展示当前游戏下的全部公式档案，不分页。</Typography.Text>
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
        columns={getFormulaProfilesColumns({ onView, onEdit })}
        data={records}
        pagination={false}
        rowKey="formulaId"
        scroll={{ x: 960 }}
      />
    </Space>
  );
}
