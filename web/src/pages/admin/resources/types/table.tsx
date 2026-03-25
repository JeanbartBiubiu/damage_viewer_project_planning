import { Button, Space, Table, Typography } from '@arco-design/web-react';
import { getTypesColumns } from './columns';
import type { TypesRecord } from './types';

type TypesTableProps = {
  loading: boolean;
  records: TypesRecord[];
  actionsDisabled: boolean;
  onView: (record: TypesRecord) => void;
  onEdit: (record: TypesRecord) => void;
  onCreate: () => void;
  onRefresh: () => void;
};

export function TypesTable({ loading, records, actionsDisabled, onView, onEdit, onCreate, onRefresh }: TypesTableProps) {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div className="crud-toolbar">
        <div className="crud-toolbar-copy">
          <Typography.Title heading={6} style={{ margin: 0 }}>
            类型定义列表
          </Typography.Title>
          <Typography.Text type="secondary">展示全部类型定义，不分页。</Typography.Text>
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
        columns={getTypesColumns({ onView, onEdit })}
        data={records}
        pagination={false}
        rowKey="typeId"
        scroll={{ x: 960 }}
      />
    </Space>
  );
}
