import { Button, Space, Tag, Typography } from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { normalizeDamageTypeValue } from '../shared/damageTypes';
import type { FormulaProfilesRecord } from './types';

type FormulaProfilesTableActions = {
  onView: (record: FormulaProfilesRecord) => void;
  onEdit: (record: FormulaProfilesRecord) => void;
  damageTypeLabelMap: Map<string, string>;
};

export function getFormulaProfilesColumns({ onView, onEdit, damageTypeLabelMap }: FormulaProfilesTableActions): TableColumnProps<FormulaProfilesRecord>[] {
  return [
    {
      title: '公式 ID',
      dataIndex: 'formulaId',
      width: 280,
      render: (_, record) => <Typography.Text code>{record.formulaId}</Typography.Text>
    },
    {
      title: '公式类型',
      dataIndex: 'formulaType',
      width: 140,
      render: (_, record) => <Tag>{record.formulaType ?? '—'}</Tag>
    },
    {
      title: '伤害类型',
      dataIndex: 'params',
      width: 180,
      render: (_, record) => {
        if (record.formulaType !== 'damage') {
          return '—';
        }
        const damageTypeId = normalizeDamageTypeValue(record.params?.damageTypeId);
        if (!damageTypeId) {
          return '—';
        }
        return damageTypeLabelMap.get(damageTypeId) ?? damageTypeId;
      }
    },
    {
      title: '公式种类',
      dataIndex: 'formulaKind',
      width: 140,
      render: (_, record) => record.formulaKind ?? '—'
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
