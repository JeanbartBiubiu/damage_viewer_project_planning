import { Button, Space, Table, Typography } from '@arco-design/web-react';
import { getTypeRelationsColumns } from './columns';
import type { TypeRelationsRecord } from './types';

type TypeRelationsTableProps = {
  loading: boolean;
  records: TypeRelationsRecord[];
  actionsDisabled: boolean;
  onView: (record: TypeRelationsRecord) => void;
  onEdit: (record: TypeRelationsRecord) => void;
  onCreate: () => void;
  onRefresh: () => void;
};

export function TypeRelationsTable({
  loading,
  records,
  actionsDisabled,
  onView,
  onEdit,
  onCreate,
  onRefresh
}: TypeRelationsTableProps) {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div className="crud-toolbar">
        <div className="crud-toolbar-copy">
          <Typography.Title heading={6} style={{ margin: 0 }}>
            类型挂载列表
          </Typography.Title>
          <Typography.Text type="secondary">展示全部类型挂载关系，不分页。</Typography.Text>
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
        columns={getTypeRelationsColumns({ onView, onEdit })}
        data={records}
        pagination={false}
        rowKey={(record) => `${record.typeId}|${record.targetCategory}|${record.targetId}`}
        scroll={{ x: 960 }}
      />
    </Space>
  );
}
