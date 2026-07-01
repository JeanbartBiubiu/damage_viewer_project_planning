import { Button, Space, Typography } from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { ResourceImageThumb } from '../../../../components/ResourceImageThumb';
import type { HeroesRecord } from './types';

type HeroesTableActions = {
  onView: (record: HeroesRecord) => void;
  onEdit: (record: HeroesRecord) => void;
  resolveImageSrc: (record: HeroesRecord) => string | null;
};

export function getHeroesColumns({ onView, onEdit, resolveImageSrc }: HeroesTableActions): TableColumnProps<HeroesRecord>[] {
  return [
    {
      title: '头像',
      dataIndex: 'heroId',
      width: 84,
      render: (_, record) => <ResourceImageThumb src={resolveImageSrc(record)} alt={record.name ?? record.heroId} size={36} />
    },
    {
      title: '英雄 ID',
      dataIndex: 'heroId',
      width: 220,
      sorter: (a, b) => a.heroId.localeCompare(b.heroId),
      render: (_, record) => <Typography.Text code>{record.heroId}</Typography.Text>
    },
    {
      title: '名称',
      dataIndex: 'name',
      width: 180,
      sorter: (a, b) => (a.name ?? '').localeCompare(b.name ?? ''),
      render: (_, record) => record.name ?? '—'
    },
    {
      title: '称号',
      dataIndex: 'title',
      width: 180,
      sorter: (a, b) => (a.title ?? '').localeCompare(b.title ?? ''),
      render: (_, record) => record.title ?? '—'
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
