import { Button, Space, Table, Typography } from '@arco-design/web-react';
import { getHeroesColumns } from './columns';
import type { HeroesRecord } from './types';

type HeroesTableProps = {
  loading: boolean;
  records: HeroesRecord[];
  actionsDisabled: boolean;
  onView: (record: HeroesRecord) => void;
  onEdit: (record: HeroesRecord) => void;
  onCreate: () => void;
  onRefresh: () => void;
};

export function HeroesTable({ loading, records, actionsDisabled, onView, onEdit, onCreate, onRefresh }: HeroesTableProps) {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div className="crud-toolbar">
        <div className="crud-toolbar-copy">
          <Typography.Title heading={6} style={{ margin: 0 }}>
            英雄列表
          </Typography.Title>
          <Typography.Text type="secondary">展示全部英雄数据，不分页。</Typography.Text>
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
        columns={getHeroesColumns({ onView, onEdit })}
        data={records}
        pagination={false}
        rowKey="heroId"
        scroll={{ x: 980 }}
      />
    </Space>
  );
}
