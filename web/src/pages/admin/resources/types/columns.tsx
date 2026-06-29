import { Button, Space, Typography } from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import type { TypesRecord } from './types';

type TypesTableActions = {
  onView: (record: TypesRecord) => void;
  onEdit: (record: TypesRecord) => void;
};

export function getTypesColumns({ onView, onEdit }: TypesTableActions): TableColumnProps<TypesRecord>[] {
  return [
    {
      title: '类型 ID',
      dataIndex: 'typeId',
      width: 140,
      render: (_, record) => <Typography.Text code>{record.typeId}</Typography.Text>
    },
    {
      title: '名称',
      dataIndex: 'name',
      width: 180,
      render: (_, record) => record.name ?? '—'
    },
    {
      title: '描述',
      dataIndex: 'description',
      width: 240,
      ellipsis: true,
      render: (_, record) => record.description ?? '—'
    },
    {
      title: '保留类型 ID',
      dataIndex: 'reservedTypeId',
      width: 160,
      render: (_, record) => record.reservedTypeId ?? '—'
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
