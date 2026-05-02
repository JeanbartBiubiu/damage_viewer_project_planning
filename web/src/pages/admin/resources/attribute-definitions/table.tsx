import { Button, Space, Table, Typography } from '@arco-design/web-react';
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

      <Table
        className="data-table-shell"
        loading={loading}
        columns={getAttributeDefinitionsColumns({
          onView,
          onEdit,
          onToggleGrowth,
          resolveImageSrc,
          isGrowthAttribute,
          canToggleGrowth: !actionsDisabled && growthTypeAvailable,
          togglingAttrKey
        })}
        data={records}
        pagination={false}
        rowKey="attrKey"
        scroll={{ x: 1360 }}
      />
    </Space>
  );
}
