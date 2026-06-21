import { Button, Space, Typography } from '@arco-design/web-react';
import { ResourceImageThumb } from '../../../../components/ResourceImageThumb';
import type { HeroesRecord } from './types';

type HeroesTableActions = {
  onView: (record: HeroesRecord) => void;
  onEdit: (record: HeroesRecord) => void;
  resolveImageSrc: (record: HeroesRecord) => string | null;
};

export function getHeroesColumns({ onView, onEdit, resolveImageSrc }: HeroesTableActions) {
  return [
    {
      title: '英雄 ID',
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
      dataIndex: 'heroId',
      width: 120,
      render: (_: unknown, record: HeroesRecord) => <ResourceImageThumb src={resolveImageSrc(record)} alt={record.name ?? record.heroId} size={36} />
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
