import { Button, Space, Tag, Typography } from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import type { StatusActionControlRulesRecord } from './types';

type StatusActionControlRulesTableActions = {
  onView: (record: StatusActionControlRulesRecord) => void;
  onEdit: (record: StatusActionControlRulesRecord) => void;
};

export function getStatusActionControlRulesColumns({ onView, onEdit }: StatusActionControlRulesTableActions): TableColumnProps<StatusActionControlRulesRecord>[] {
  return [
    {
      title: '规则 ID',
      dataIndex: 'ruleId',
      width: 260,
      render: (_, record) => <Typography.Text code>{record.ruleId}</Typography.Text>
    },
    {
      title: '规则类型',
      dataIndex: 'ruleKind',
      width: 140,
      render: (_, record) => <Tag>{record.ruleKind}</Tag>
    },
    {
      title: '状态类型 ID',
      dataIndex: 'statusTypeId',
      width: 150,
      render: (_, record) => record.statusTypeId ?? '—'
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 120,
      render: (_, record) => record.priority ?? '—'
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
