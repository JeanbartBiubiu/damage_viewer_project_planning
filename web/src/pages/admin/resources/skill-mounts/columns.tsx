import { Button, Space, Tag, Typography } from '@arco-design/web-react';
import type { SkillMountsRecord } from './types';

type SkillMountsTableActions = {
  onView: (record: SkillMountsRecord) => void;
  onEdit: (record: SkillMountsRecord) => void;
};

export function getSkillMountsColumns({ onView, onEdit }: SkillMountsTableActions) {
  return [
    {
      title: '目标分类',
      dataIndex: 'targetCategory',
      width: 120,
      render: (_: unknown, record: SkillMountsRecord) => <Tag>{record.targetCategory}</Tag>
    },
    {
      title: '目标 ID',
      dataIndex: 'targetId',
      width: 220,
      render: (_: unknown, record: SkillMountsRecord) => <Typography.Text code>{record.targetId}</Typography.Text>
    },
    {
      title: '技能 ID',
      dataIndex: 'skillId',
      width: 280,
      render: (_: unknown, record: SkillMountsRecord) => <Typography.Text code>{record.skillId}</Typography.Text>
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 80,
      render: (_: unknown, record: SkillMountsRecord) => (record.enabled === false ? <Tag color="gray">否</Tag> : <Tag color="green">是</Tag>)
    },
    {
      title: '操作',
      fixed: 'right' as const,
      width: 160,
      align: 'center' as const,
      render: (_: unknown, record: SkillMountsRecord) => (
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
