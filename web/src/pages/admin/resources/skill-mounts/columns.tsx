import { Button, Space, Tag, Typography } from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { SKILL_MOUNT_TARGET_CATEGORY_OPTIONS } from './constants';
import type { SkillMountsRecord } from './types';

type SkillMountsTableActions = {
  onView: (record: SkillMountsRecord) => void;
  onEdit: (record: SkillMountsRecord) => void;
};

const TARGET_CATEGORY_LABELS = new Map(SKILL_MOUNT_TARGET_CATEGORY_OPTIONS.map((option) => [option.value, option.label]));

export function getSkillMountsColumns({ onView, onEdit }: SkillMountsTableActions): TableColumnProps<SkillMountsRecord>[] {
  return [
    {
      title: '目标分类',
      dataIndex: 'targetCategory',
      width: 120,
      render: (_, record) => <Tag>{TARGET_CATEGORY_LABELS.get(record.targetCategory) ?? record.targetCategory}</Tag>
    },
    {
      title: '目标 ID',
      dataIndex: 'targetId',
      width: 220,
      render: (_, record) => <Typography.Text code>{record.targetId}</Typography.Text>
    },
    {
      title: '技能 ID',
      dataIndex: 'skillId',
      width: 280,
      render: (_, record) => <Typography.Text code>{record.skillId}</Typography.Text>
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 80,
      render: (_, record) => (record.enabled === false ? <Tag color="gray">否</Tag> : <Tag color="green">是</Tag>)
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 160,
      align: 'center',
      render: (_, record) => (
        <Space>
          <Button size="mini" onClick={() => onView(record)}>
            查看
          </Button>
          <Button type="primary" size="mini" onClick={() => onEdit(record)}>
            编辑
          </Button>
        </Space>
      )
    }
  ];
}
