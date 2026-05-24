import { Button, Space, Table, Typography } from '@arco-design/web-react';
import { getSkillMountsColumns } from './columns';
import { skillMountRowKey, type SkillMountsRecord } from './types';

type SkillMountsTableProps = {
  loading: boolean;
  records: SkillMountsRecord[];
  actionsDisabled: boolean;
  onView: (record: SkillMountsRecord) => void;
  onEdit: (record: SkillMountsRecord) => void;
  onCreate: () => void;
  onRefresh: () => void;
};

export function SkillMountsTable({
  loading,
  records,
  actionsDisabled,
  onView,
  onEdit,
  onCreate,
  onRefresh
}: SkillMountsTableProps) {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div className="crud-toolbar">
        <div className="crud-toolbar-copy">
          <Typography.Title heading={6} style={{ margin: 0 }}>
            技能挂载列表
          </Typography.Title>
          <Typography.Text type="secondary">自然键为 targetCategory + targetId + skillId；表格右上角保留新增按钮。</Typography.Text>
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
        columns={getSkillMountsColumns({ onView, onEdit })}
        data={records}
        pagination={false}
        rowKey={skillMountRowKey}
        scroll={{ x: 980 }}
      />
    </Space>
  );
}
