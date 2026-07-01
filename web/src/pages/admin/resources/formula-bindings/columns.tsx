import { Button, Space, Tag, Typography } from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import type { FormulaBindingsRecord } from './types';

type FormulaBindingsTableActions = {
  onView: (record: FormulaBindingsRecord) => void;
  onEdit: (record: FormulaBindingsRecord) => void;
};

export function getFormulaBindingsColumns({ onView, onEdit }: FormulaBindingsTableActions): TableColumnProps<FormulaBindingsRecord>[] {
  return [
    {
      title: '绑定键',
      dataIndex: 'bindingKey',
      width: 220,
      render: (_, record) => <Typography.Text code>{record.bindingKey}</Typography.Text>
    },
    {
      title: '目标分类',
      dataIndex: 'targetCategory',
      width: 140,
      render: (_, record) => <Tag>{record.targetCategory}</Tag>
    },
    {
      title: '目标 ID',
      dataIndex: 'targetId',
      width: 220,
      render: (_, record) => record.targetId
    },
    {
      title: '公式 ID',
      dataIndex: 'formulaId',
      width: 260,
      render: (_, record) => record.formulaId
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
