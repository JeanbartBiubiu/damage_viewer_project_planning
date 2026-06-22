import { Button, Skeleton, Space, Table, Typography } from '@arco-design/web-react';
import { EmptyState } from '../../../../components/EmptyState';
import { getAttributeDefinitionsColumns } from './columns';
import type { AttributeDefinitionsRecord } from './types';

type AttributeDefinitionsTableProps = {
  loading: boolean;
  records: AttributeDefinitionsRecord[];
  actionsDisabled: boolean;
  onView: (record: AttributeDefinitionsRecord) => void;
  onEdit: (record: AttributeDefinitionsRecord) => void;
  onToggleGrowth: (record: AttributeDefinitionsRecord) => void;
  isGrowthAttribute: (record: AttributeDefinitionsRecord) => boolean;
  growthTypeAvailable: boolean;
  togglingAttrKey: string | null;
  resolveImageSrc: (record: AttributeDefinitionsRecord) => string | null;
  onCreate: () => void;
  onRefresh: () => void;
};

export function AttributeDefinitionsTable({
  loading,
  records,
  actionsDisabled,
  onView,
  onEdit,
  onToggleGrowth,
  isGrowthAttribute,
  growthTypeAvailable,
  togglingAttrKey,
  resolveImageSrc,
  onCreate,
  onRefresh
}: AttributeDefinitionsTableProps) {
  const columns = getAttributeDefinitionsColumns({
    onView,
    onEdit,
    onToggleGrowth,
    resolveImageSrc,
    isGrowthAttribute,
    canToggleGrowth: !actionsDisabled && growthTypeAvailable,
    togglingAttrKey
  });
  const scrollX = columns.reduce((sum, col) => sum + (col.width ?? 0), 0);
  const showSkeleton = loading && records.length === 0;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div className="crud-toolbar">
        <div className="crud-toolbar-copy">
          <Typography.Title heading={6} style={{ margin: 0 }}>
            属性定义列表
          </Typography.Title>
          <Typography.Text type="secondary">保留全量表格，新增按钮固定在表格工具栏右侧。</Typography.Text>
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
          rowKey="attrKey"
          scroll={{ x: scrollX }}
          noDataElement={<EmptyState title="暂无属性数据" description="点击右上角「新增」按钮创建第一个属性定义。" />}
        />
      )}
    </Space>
  );
}
