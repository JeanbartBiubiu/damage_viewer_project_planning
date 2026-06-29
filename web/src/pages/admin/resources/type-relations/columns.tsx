import { Button, Popconfirm, Space, Typography } from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { TARGET_CATEGORY_OPTIONS } from './constants';
import type { TypeRelationsRecord } from './types';

type TypeRelationsTableActions = {
  onView: (record: TypeRelationsRecord) => void;
  onEdit: (record: TypeRelationsRecord) => void;
  onDelete: (record: TypeRelationsRecord) => void;
  deleteDisabled: boolean;
};

const TARGET_CATEGORY_LABELS = new Map(TARGET_CATEGORY_OPTIONS.map((option) => [option.value, option.label]));

export function getTypeRelationsColumns({ onView, onEdit, onDelete, deleteDisabled }: TypeRelationsTableActions): TableColumnProps<TypeRelationsRecord>[] {
  return [
    {
      title: '类型 ID',
      dataIndex: 'typeId',
      width: 140,
      render: (_, record) => <Typography.Text code>{record.typeId}</Typography.Text>
    },
    {
      title: '目标类别',
      dataIndex: 'targetCategory',
      width: 180,
      render: (_, record) => TARGET_CATEGORY_LABELS.get(record.targetCategory) ?? record.targetCategory
    },
    {
      title: '目标 ID',
      dataIndex: 'targetId',
      width: 280,
      ellipsis: true,
      render: (_, record) => record.targetId
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 230,
      align: 'center',
      render: (_, record) => (
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
