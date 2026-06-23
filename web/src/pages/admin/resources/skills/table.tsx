import { Button, Skeleton, Space, Table, Typography } from '@arco-design/web-react';
import { EmptyState } from '../../../../components/EmptyState';
import { getSkillsColumns } from './columns';
import type { SkillsRecord } from './types';

type SkillsTableProps = {
  loading: boolean;
  records: SkillsRecord[];
  actionsDisabled: boolean;
  onView: (record: SkillsRecord) => void;
  onEdit: (record: SkillsRecord) => void;
  resolveImageSrc: (record: SkillsRecord) => string | null;
  onCreate: () => void;
  onRefresh: () => void;
};

export function SkillsTable({ loading, records, actionsDisabled, onView, onEdit, resolveImageSrc, onCreate, onRefresh }: SkillsTableProps) {
  const columns = getSkillsColumns({ onView, onEdit, resolveImageSrc });
  const scrollX = columns.reduce((sum, col) => sum + Number(col.width ?? 0), 0);
  const showSkeleton = loading && records.length === 0;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div className="crud-toolbar">
        <div className="crud-toolbar-copy">
          <Typography.Title heading={6} style={{ margin: 0 }}>
            技能列表
          </Typography.Title>
          <Typography.Text type="secondary">展示全部技能数据，不分页。</Typography.Text>
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
          rowKey="skillId"
          scroll={{ x: scrollX }}
          noDataElement={<EmptyState title="暂无技能数据" description="点击右上角「新增」按钮创建第一个技能。" />}
        />
      )}
    </Space>
  );
}
