import { Button, Space, Tag, Typography } from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { COEFFICIENT_BUCKET_AGGREGATION_MODE_OPTIONS, COEFFICIENT_BUCKET_RESOLUTION_DOMAIN_OPTIONS } from './constants';
import type { CoefficientBucketsRecord } from './types';

type CoefficientBucketsTableActions = {
  onView: (record: CoefficientBucketsRecord) => void;
  onEdit: (record: CoefficientBucketsRecord) => void;
};

const RESOLUTION_DOMAIN_LABELS = new Map(COEFFICIENT_BUCKET_RESOLUTION_DOMAIN_OPTIONS.map((option) => [option.value, option.label]));
const AGGREGATION_MODE_LABELS = new Map(COEFFICIENT_BUCKET_AGGREGATION_MODE_OPTIONS.map((option) => [option.value, option.label]));

export function getCoefficientBucketsColumns({ onView, onEdit }: CoefficientBucketsTableActions): TableColumnProps<CoefficientBucketsRecord>[] {
  return [
    {
      title: '桶键',
      dataIndex: 'bucketKey',
      width: 260,
      render: (_, record) => <Typography.Text code>{record.bucketKey}</Typography.Text>
    },
    {
      title: '作用域',
      dataIndex: 'resolutionDomain',
      width: 140,
      render: (_, record) => <Tag>{RESOLUTION_DOMAIN_LABELS.get(record.resolutionDomain) ?? record.resolutionDomain}</Tag>
    },
    {
      title: '阶段键',
      dataIndex: 'stageKey',
      width: 160,
      render: (_, record) => record.stageKey ?? '—'
    },
    {
      title: '目标属性',
      dataIndex: 'targetAttrKey',
      width: 180,
      render: (_, record) => record.targetAttrKey ?? '—'
    },
    {
      title: '聚合方式',
      dataIndex: 'aggregationMode',
      width: 140,
      render: (_, record) => AGGREGATION_MODE_LABELS.get(record.aggregationMode) ?? record.aggregationMode
    },
    {
      title: '说明',
      dataIndex: 'description',
      width: 240,
      ellipsis: true,
      render: (_, record) => record.description ?? '—'
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
