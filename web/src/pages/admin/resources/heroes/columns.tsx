import { Button, Space, Typography } from '@arco-design/web-react';
import type { HeroesRecord } from './types';

type HeroesTableActions = {
  onView: (record: HeroesRecord) => void;
  onEdit: (record: HeroesRecord) => void;
};

export function getHeroesColumns({ onView, onEdit }: HeroesTableActions) {
  return [
    {
      title: 'heroId',
      dataIndex: 'heroId',
      width: 220,
      render: (_: unknown, record: HeroesRecord) => <Typography.Text code>{record.heroId}</Typography.Text>
    },
    {
      title: '名称',
      dataIndex: 'name',
      width: 180,
      render: (_: unknown, record: HeroesRecord) => record.name ?? '--'
    },
    {
      title: '称号',
      dataIndex: 'title',
      width: 180,
      render: (_: unknown, record: HeroesRecord) => record.title ?? '--'
    },
    {
      title: '头像',
      dataIndex: 'avatarUrl',
      width: 120,
      render: (_: unknown, record: HeroesRecord) =>
        record.avatarUrl ? (
          <img
            src={record.avatarUrl}
            alt={record.name ?? record.heroId}
            style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover' }}
          />
        ) : (
          '--'
        )
    },
    {
      title: '操作',
      fixed: 'right' as const,
      width: 160,
      align: 'center' as const,
      render: (_: unknown, record: HeroesRecord) => (
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
