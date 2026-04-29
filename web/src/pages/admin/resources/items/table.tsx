import { Button, Space, Table, Typography } from '@arco-design/web-react';
import { getItemsColumns } from './columns';
import type { ItemsRecord } from './types';

type ItemsTableProps = {
  loading: boolean;
  records: ItemsRecord[];
  actionsDisabled: boolean;
  onView: (record: ItemsRecord) => void;
  onEdit: (record: ItemsRecord) => void;
  resolveImageSrc: (record: ItemsRecord) => string | null;
  onCreate: () => void;
  onRefresh: () => void;
};

export function ItemsTable({ loading, records, actionsDisabled, onView, onEdit, resolveImageSrc, onCreate, onRefresh }: ItemsTableProps) {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div className="crud-toolbar">
        <div className="crud-toolbar-copy">
          <Typography.Title heading={6} style={{ margin: 0 }}>
            装备列表
          </Typography.Title>
          <Typography.Text type="secondary">展示全部装备数据，不分页。</Typography.Text>
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
        columns={getItemsColumns({ onView, onEdit, resolveImageSrc })}
        data={records}
        pagination={false}
        rowKey="itemId"
        scroll={{ x: 980 }}
      />
    </Space>
  );
}
