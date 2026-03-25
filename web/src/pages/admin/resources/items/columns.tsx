import { Button, Space, Typography } from '@arco-design/web-react';
import type { ItemsRecord } from './types';

type ItemsTableActions = {
  onView: (record: ItemsRecord) => void;
  onEdit: (record: ItemsRecord) => void;
};

export function getItemsColumns({ onView, onEdit }: ItemsTableActions) {
  return [
    {
      title: 'itemId',
      dataIndex: 'itemId',
      width: 220,
      render: (_: unknown, record: ItemsRecord) => <Typography.Text code>{record.itemId}</Typography.Text>
    },
    {
      title: '名称',
      dataIndex: 'name',
      width: 180,
      render: (_: unknown, record: ItemsRecord) => record.name ?? '--'
    },
    {
      title: 'goldCost',
      dataIndex: 'goldCost',
      width: 120,
      render: (_: unknown, record: ItemsRecord) => record.goldCost ?? '--'
    },
    {
      title: '图标',
      dataIndex: 'iconUrl',
      width: 120,
      render: (_: unknown, record: ItemsRecord) =>
        record.iconUrl ? (
          <img
            src={record.iconUrl}
            alt={record.name ?? record.itemId}
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
      render: (_: unknown, record: ItemsRecord) => (
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
