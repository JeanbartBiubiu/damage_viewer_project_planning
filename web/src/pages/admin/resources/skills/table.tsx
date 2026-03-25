import { Button, Space, Table, Typography } from '@arco-design/web-react';
import { getSkillsColumns } from './columns';
import type { SkillsRecord } from './types';

type SkillsTableProps = {
  loading: boolean;
  records: SkillsRecord[];
  actionsDisabled: boolean;
  onView: (record: SkillsRecord) => void;
  onEdit: (record: SkillsRecord) => void;
  onCreate: () => void;
  onRefresh: () => void;
};

export function SkillsTable({ loading, records, actionsDisabled, onView, onEdit, onCreate, onRefresh }: SkillsTableProps) {
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

      <Table
        className="data-table-shell"
        loading={loading}
        columns={getSkillsColumns({ onView, onEdit })}
        data={records}
        pagination={false}
        rowKey="skillId"
        scroll={{ x: 1180 }}
      />
    </Space>
  );
}
