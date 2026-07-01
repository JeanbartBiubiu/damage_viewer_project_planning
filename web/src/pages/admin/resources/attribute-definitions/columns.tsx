import { Button, Space, Tag, Typography } from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { ResourceImageThumb } from '../../../../components/ResourceImageThumb';
import { resolveAttributeOrder, formatAttributeBoundsLabel, getAttributeValueKindLabel } from './constants';
import type { AttributeDefinitionsRecord } from './types';

type AttributeDefinitionsTableActions = {
  onView: (record: AttributeDefinitionsRecord) => void;
  onEdit: (record: AttributeDefinitionsRecord) => void;
  onToggleGrowth: (record: AttributeDefinitionsRecord) => void;
  resolveImageSrc: (record: AttributeDefinitionsRecord) => string | null;
  isGrowthAttribute: (record: AttributeDefinitionsRecord) => boolean;
  canToggleGrowth: boolean;
  togglingAttrKey: string | null;
};

export function getAttributeDefinitionsColumns({
  onView,
  onEdit,
  onToggleGrowth,
  resolveImageSrc,
  isGrowthAttribute,
  canToggleGrowth,
  togglingAttrKey
}: AttributeDefinitionsTableActions): TableColumnProps<AttributeDefinitionsRecord>[] {
  return [
    {
      title: '图片',
      key: 'image',
      width: 84,
      render: (_, record) => (
        <ResourceImageThumb src={resolveImageSrc(record)} alt={record.attrName ?? record.attrKey} size={36} />
      )
    },
    {
      title: '属性 Key',
      dataIndex: 'attrKey',
      width: 220,
      sorter: (a, b) => a.attrKey.localeCompare(b.attrKey),
      render: (_, record) => <Typography.Text code>{record.attrKey}</Typography.Text>
    },
    {
      title: '属性名称',
      dataIndex: 'attrName',
      width: 180,
      sorter: (a, b) => (a.attrName ?? '').localeCompare(b.attrName ?? ''),
      render: (_, record) => record.attrName ?? '—'
    },
    {
      title: '属性类型',
      dataIndex: 'attrType',
      width: 140,
      render: (_, record) => record.attrType ?? 'number'
    },
    {
      title: '默认值',
      dataIndex: 'defaultValue',
      width: 120,
      render: (_, record) => record.defaultValue ?? '—'
    },
    {
      title: '排序',
      dataIndex: 'order',
      width: 100,
      sorter: (a, b) => (resolveAttributeOrder(a) ?? 0) - (resolveAttributeOrder(b) ?? 0),
      render: (_, record) => resolveAttributeOrder(record) ?? '—'
    },
    {
      title: '取值语义',
      dataIndex: 'valueKind',
      width: 120,
      render: (_, record) => <Tag>{getAttributeValueKindLabel(record.valueKind)}</Tag>
    },
    {
      title: '比率目标',
      dataIndex: 'rateTargetAttrKey',
      width: 180,
      render: (_, record) =>
        record.valueKind === 'rate' ? (record.rateTargetAttrKey ?? '—') : '—'
    },
    {
      title: '取值范围',
      key: 'bounds',
      width: 160,
      render: (_, record) => (
        <Typography.Text className="wasm-code-token">{formatAttributeBoundsLabel(record)}</Typography.Text>
      )
    },
    {
      title: '成长属性',
      key: 'growth',
      width: 120,
      render: (_, record) => (
        <Tag color={isGrowthAttribute(record) ? 'green' : 'gray'}>{isGrowthAttribute(record) ? '是' : '否'}</Tag>
      )
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 250,
      align: 'center',
      render: (_, record) => (
        <Space>
          <Button size="mini" onClick={() => onView(record)}>
            查看
          </Button>
          <Button type="primary" size="mini" onClick={() => onEdit(record)}>
            编辑
          </Button>
          <Button
            size="mini"
            status={isGrowthAttribute(record) ? 'warning' : 'success'}
            loading={togglingAttrKey === record.attrKey}
            disabled={!canToggleGrowth}
            onClick={() => onToggleGrowth(record)}
          >
            {isGrowthAttribute(record) ? '设为非成长' : '设为成长'}
          </Button>
        </Space>
      )
    }
  ];
}
