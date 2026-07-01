import { Button, Skeleton, Space, Table, Typography } from '@arco-design/web-react';
import { EmptyState } from '../../../../components/EmptyState';
import { getFormulaProfilesColumns } from './columns';
import type { FormulaProfilesRecord } from './types';

type FormulaProfilesTableProps = {
  loading: boolean;
  records: FormulaProfilesRecord[];
  damageTypeLabelMap: Map<string, string>;
  actionsDisabled: boolean;
  onView: (record: FormulaProfilesRecord) => void;
  onEdit: (record: FormulaProfilesRecord) => void;
  onCreate: () => void;
  onRefresh: () => void;
};

export function FormulaProfilesTable({
  loading,
  records,
  damageTypeLabelMap,
  actionsDisabled,
  onView,
  onEdit,
  onCreate,
  onRefresh
}: FormulaProfilesTableProps) {
  const columns = getFormulaProfilesColumns({ onView, onEdit, damageTypeLabelMap });
  const scrollX = columns.reduce((sum, col) => sum + Number(col.width ?? 0), 0);
  const showSkeleton = loading && records.length === 0;

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

      {showSkeleton ? (
        <Skeleton text={{ rows: 5, width: ['100%', '60%', '40%', '80%', '50%'] }} animation />
      ) : (
        <Table
          className="data-table-shell"
          loading={loading}
          columns={columns}
          data={records}
          pagination={false}
          rowKey="formulaId"
          scroll={{ x: scrollX }}
          noDataElement={<EmptyState title="暂无公式档案数据" description="点击右上角「新增」按钮创建第一个公式档案。" />}
        />
      )}
    </Space>
  );
}
