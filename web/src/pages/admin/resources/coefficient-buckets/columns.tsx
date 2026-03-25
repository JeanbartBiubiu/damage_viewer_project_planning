import { Button, Space, Tag, Typography } from '@arco-design/web-react';
import type { CoefficientBucketsRecord } from './types';

type CoefficientBucketsTableActions = {
  onView: (record: CoefficientBucketsRecord) => void;
  onEdit: (record: CoefficientBucketsRecord) => void;
};

export function getCoefficientBucketsColumns({ onView, onEdit }: CoefficientBucketsTableActions) {
  return [
    {
      title: 'bucketKey',
      dataIndex: 'bucketKey',
      width: 260,
      render: (_: unknown, record: CoefficientBucketsRecord) => <Typography.Text code>{record.bucketKey}</Typography.Text>
    },
    {
      title: '作用域',
      dataIndex: 'resolutionDomain',
      width: 140,
      render: (_: unknown, record: CoefficientBucketsRecord) => <Tag>{record.resolutionDomain}</Tag>
    },
    {
      title: 'stageKey',
      dataIndex: 'stageKey',
      width: 160,
      render: (_: unknown, record: CoefficientBucketsRecord) => record.stageKey
    },
    {
      title: 'targetAttrKey',
      dataIndex: 'targetAttrKey',
      width: 180,
      render: (_: unknown, record: CoefficientBucketsRecord) => record.targetAttrKey ?? '--'
    },
    {
      title: '聚合方式',
      dataIndex: 'aggregationMode',
      width: 140,
      render: (_: unknown, record: CoefficientBucketsRecord) => record.aggregationMode
    },
    {
      title: '说明',
      dataIndex: 'description',
      ellipsis: true,
      render: (_: unknown, record: CoefficientBucketsRecord) => record.description ?? '--'
    },
    {
      title: '操作',
      fixed: 'right' as const,
      width: 160,
      align: 'center' as const,
      render: (_: unknown, record: CoefficientBucketsRecord) => (
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
