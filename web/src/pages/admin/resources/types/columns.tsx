import { Button, Space, Typography } from '@arco-design/web-react';
import type { TypesRecord } from './types';

type TypesTableActions = {
  onView: (record: TypesRecord) => void;
  onEdit: (record: TypesRecord) => void;
};

export function getTypesColumns({ onView, onEdit }: TypesTableActions) {
  return [
    {
      title: 'typeId',
      dataIndex: 'typeId',
      width: 140,
      render: (_: unknown, record: TypesRecord) => <Typography.Text code>{record.typeId}</Typography.Text>
    },
    {
      title: '名称',
      dataIndex: 'name',
      width: 180,
      render: (_: unknown, record: TypesRecord) => record.name ?? '--'
    },
    {
      title: '描述',
      dataIndex: 'description',
      ellipsis: true,
      render: (_: unknown, record: TypesRecord) => record.description ?? '--'
    },
    {
      title: 'reservedTypeId',
      dataIndex: 'reservedTypeId',
      width: 160,
      render: (_: unknown, record: TypesRecord) => record.reservedTypeId ?? '--'
    },
    {
      title: '操作',
      fixed: 'right' as const,
      width: 160,
      align: 'center' as const,
      render: (_: unknown, record: TypesRecord) => (
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
