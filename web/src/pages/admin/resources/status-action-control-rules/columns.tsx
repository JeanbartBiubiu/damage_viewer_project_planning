import { Button, Space, Tag, Typography } from '@arco-design/web-react';
import type { StatusActionControlRulesRecord } from './types';

type StatusActionControlRulesTableActions = {
  onView: (record: StatusActionControlRulesRecord) => void;
  onEdit: (record: StatusActionControlRulesRecord) => void;
};

export function getStatusActionControlRulesColumns({ onView, onEdit }: StatusActionControlRulesTableActions) {
  return [
    {
      title: 'ruleId',
      dataIndex: 'ruleId',
      width: 260,
      render: (_: unknown, record: StatusActionControlRulesRecord) => <Typography.Text code>{record.ruleId}</Typography.Text>
    },
    {
      title: 'ruleKind',
      dataIndex: 'ruleKind',
      width: 140,
      render: (_: unknown, record: StatusActionControlRulesRecord) => <Tag>{record.ruleKind}</Tag>
    },
    {
      title: 'statusTypeId',
      dataIndex: 'statusTypeId',
      width: 150,
      render: (_: unknown, record: StatusActionControlRulesRecord) => record.statusTypeId
    },
    {
      title: 'priority',
      dataIndex: 'priority',
      width: 120,
      render: (_: unknown, record: StatusActionControlRulesRecord) => record.priority ?? '--'
    },
    {
      title: '说明',
      dataIndex: 'description',
      ellipsis: true,
      render: (_: unknown, record: StatusActionControlRulesRecord) => record.description ?? '--'
    },
    {
      title: '操作',
      fixed: 'right' as const,
      width: 160,
      align: 'center' as const,
      render: (_: unknown, record: StatusActionControlRulesRecord) => (
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
