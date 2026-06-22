import { Button, Skeleton, Space, Table, Typography } from '@arco-design/web-react';
import { EmptyState } from '../../../../components/EmptyState';
import { getHeroesColumns } from './columns';
import type { HeroesRecord } from './types';

type HeroesTableProps = {
  loading: boolean;
  records: HeroesRecord[];
  actionsDisabled: boolean;
  onView: (record: HeroesRecord) => void;
  onEdit: (record: HeroesRecord) => void;
  resolveImageSrc: (record: HeroesRecord) => string | null;
  onCreate: () => void;
  onRefresh: () => void;
};

export function HeroesTable({ loading, records, actionsDisabled, onView, onEdit, resolveImageSrc, onCreate, onRefresh }: HeroesTableProps) {
  const columns = getHeroesColumns({ onView, onEdit, resolveImageSrc });
  const scrollX = columns.reduce((sum, col) => sum + (col.width ?? 0), 0);
  const showSkeleton = loading && records.length === 0;

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

      {showSkeleton ? (
        <Skeleton text={{ rows: 5, width: ['100%', '60%', '40%', '80%', '50%'] }} animation />
      ) : (
        <Table
          className="data-table-shell"
          loading={loading}
          columns={columns}
          data={records}
          pagination={false}
          rowKey="heroId"
          scroll={{ x: scrollX }}
          noDataElement={<EmptyState title="暂无英雄数据" description="点击右上角「新增」按钮创建第一个英雄。" />}
        />
      )}
    </Space>
  );
}
