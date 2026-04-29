import { Button, Space, Tag, Typography } from '@arco-design/web-react';
import { ResourceImageThumb } from '../../../../components/ResourceImageThumb';
import type { AttributeDefinitionsRecord } from './types';

type AttributeDefinitionsTableActions = {
  onView: (record: AttributeDefinitionsRecord) => void;
  onEdit: (record: AttributeDefinitionsRecord) => void;
  resolveImageSrc: (record: AttributeDefinitionsRecord) => string | null;
};

export function getAttributeDefinitionsColumns({ onView, onEdit, resolveImageSrc }: AttributeDefinitionsTableActions) {
  return [
    {
      title: '图片',
      width: 84,
      render: (_: unknown, record: AttributeDefinitionsRecord) => (
        <ResourceImageThumb src={resolveImageSrc(record)} alt={record.attrName ?? record.attrKey} size={36} />
      )
    },
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
      render: (_: unknown, record: AttributeDefinitionsRecord) => record.attrType ?? 'number'
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
