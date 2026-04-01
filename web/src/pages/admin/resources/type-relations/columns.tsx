import { Button, Popconfirm, Space, Typography } from '@arco-design/web-react';
import type { TypeRelationsRecord } from './types';

type TypeRelationsTableActions = {
  onView: (record: TypeRelationsRecord) => void;
  onEdit: (record: TypeRelationsRecord) => void;
  onDelete: (record: TypeRelationsRecord) => void;
  deleteDisabled: boolean;
};

export function getTypeRelationsColumns({ onView, onEdit, onDelete, deleteDisabled }: TypeRelationsTableActions) {
  return [
    {
      title: 'typeId',
      dataIndex: 'typeId',
      width: 140,
      render: (_: unknown, record: TypeRelationsRecord) => <Typography.Text code>{record.typeId}</Typography.Text>
    },
    {
      title: 'targetCategory',
      dataIndex: 'targetCategory',
      width: 180,
      render: (_: unknown, record: TypeRelationsRecord) => record.targetCategory
    },
    {
      title: 'targetId',
      dataIndex: 'targetId',
      ellipsis: true,
      render: (_: unknown, record: TypeRelationsRecord) => record.targetId
    },
    {
      title: '操作',
      fixed: 'right' as const,
      width: 230,
      align: 'center' as const,
      render: (_: unknown, record: TypeRelationsRecord) => (
        <Space>
          <Button size="mini" onClick={() => onView(record)}>
            查看
          </Button>
          <Button type="primary" size="mini" onClick={() => onEdit(record)}>
            编辑
          </Button>
          <Popconfirm title="确认删除这条类型挂载吗？" onOk={() => onDelete(record)} disabled={deleteDisabled}>
            <Button status="danger" size="mini" disabled={deleteDisabled}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];
}
