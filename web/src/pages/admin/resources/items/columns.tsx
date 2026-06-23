import { Button, Space, Typography } from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { ResourceImageThumb } from '../../../../components/ResourceImageThumb';
import type { ItemsRecord } from './types';

type ItemsTableActions = {
  onView: (record: ItemsRecord) => void;
  onEdit: (record: ItemsRecord) => void;
  resolveImageSrc: (record: ItemsRecord) => string | null;
};

export function getItemsColumns({ onView, onEdit, resolveImageSrc }: ItemsTableActions): TableColumnProps<ItemsRecord>[] {
  return [
    {
      title: '图标',
      dataIndex: 'itemId',
      width: 84,
      render: (_, record) => <ResourceImageThumb src={resolveImageSrc(record)} alt={record.name ?? record.itemId} size={36} />
    },
    {
      title: '装备 ID',
      dataIndex: 'itemId',
      width: 220,
      render: (_, record) => <Typography.Text code>{record.itemId}</Typography.Text>
    },
    {
      title: '名称',
      dataIndex: 'name',
      width: 180,
      render: (_, record) => record.name ?? '--'
    },
    {
      title: '金币成本',
      dataIndex: 'goldCost',
      width: 120,
      render: (_, record) => record.goldCost ?? '--'
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
