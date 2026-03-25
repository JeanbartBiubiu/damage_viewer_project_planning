import { Button, Space, Tag, Typography } from '@arco-design/web-react';
import type { AttributeDefinitionsRecord } from './types';

type AttributeDefinitionsTableActions = {
  onView: (record: AttributeDefinitionsRecord) => void;
  onEdit: (record: AttributeDefinitionsRecord) => void;
};

export function getAttributeDefinitionsColumns({ onView, onEdit }: AttributeDefinitionsTableActions) {
  return [
    {
      title: 'attrKey',
      dataIndex: 'attrKey',
      width: 220,
      render: (_: unknown, record: AttributeDefinitionsRecord) => <Typography.Text code>{record.attrKey}</Typography.Text>
    },
    {
      title: '属性名称',
      dataIndex: 'attrName',
      width: 180,
      render: (_: unknown, record: AttributeDefinitionsRecord) => record.attrName ?? '--'
    },
    {
      title: '属性类型',
      dataIndex: 'attrType',
      width: 140,
      render: (_: unknown, record: AttributeDefinitionsRecord) => record.attrType ?? '--'
    },
    {
      title: '默认值',
      dataIndex: 'defaultValue',
      width: 120,
      render: (_: unknown, record: AttributeDefinitionsRecord) => record.defaultValue ?? '--'
    },
    {
      title: 'valueKind',
      dataIndex: 'valueKind',
      width: 120,
      render: (_: unknown, record: AttributeDefinitionsRecord) => <Tag>{record.valueKind ?? '--'}</Tag>
    },
    {
      title: '操作',
      fixed: 'right' as const,
      width: 160,
      align: 'center' as const,
      render: (_: unknown, record: AttributeDefinitionsRecord) => (
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
