import { Button, Space, Typography } from '@arco-design/web-react';
import type { SkillsRecord } from './types';

type SkillsTableActions = {
  onView: (record: SkillsRecord) => void;
  onEdit: (record: SkillsRecord) => void;
};

export function getSkillsColumns({ onView, onEdit }: SkillsTableActions) {
  return [
    {
      title: 'skillId',
      dataIndex: 'skillId',
      width: 220,
      render: (_: unknown, record: SkillsRecord) => <Typography.Text code>{record.skillId}</Typography.Text>
    },
    {
      title: 'ownerType',
      dataIndex: 'ownerType',
      width: 140,
      render: (_: unknown, record: SkillsRecord) => record.ownerType
    },
    {
      title: 'ownerId',
      dataIndex: 'ownerId',
      width: 220,
      render: (_: unknown, record: SkillsRecord) => record.ownerId
    },
    {
      title: 'skillKey',
      dataIndex: 'skillKey',
      width: 120,
      render: (_: unknown, record: SkillsRecord) => record.skillKey ?? '--'
    },
    {
      title: '名称',
      dataIndex: 'name',
      ellipsis: true,
      render: (_: unknown, record: SkillsRecord) => record.name ?? '--'
    },
    {
      title: '操作',
      fixed: 'right' as const,
      width: 160,
      align: 'center' as const,
      render: (_: unknown, record: SkillsRecord) => (
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
