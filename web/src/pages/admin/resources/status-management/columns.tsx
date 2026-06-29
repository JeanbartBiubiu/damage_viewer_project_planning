import { Button, Space, Tag, Typography } from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import type {
  ControlStateProfile,
  StatusAttributeModifier,
  StatusDefinition,
  StatusModifierGroup,
  StatusPeriodicHpEffect
} from '../../../../types/api';
import { formatStatusPeriodicHpEffectCrit } from './transforms';

type RecordActions<R> = {
  onView: (record: R) => void;
  onEdit: (record: R) => void;
};

function renderRowActions<R>(record: R, actions: RecordActions<R>) {
  return (
    <Space>
      <Button size="mini" onClick={() => actions.onView(record)}>
        查看
      </Button>
      <Button type="primary" size="mini" onClick={() => actions.onEdit(record)}>
        编辑
      </Button>
    </Space>
  );
}

export function getStatusDefinitionColumns(actions: RecordActions<StatusDefinition>): TableColumnProps<StatusDefinition>[] {
  return [
    {
      title: '状态 ID',
      dataIndex: 'statusId',
      width: 220,
      render: (_, record) => <Typography.Text code>{record.statusId}</Typography.Text>
    },
    { title: '名称', dataIndex: 'name', width: 180 },
    {
      title: '类别',
      dataIndex: 'statusKind',
      width: 120,
      render: (_, record) => <Tag>{record.statusKind}</Tag>
    },
    {
      title: '状态类型',
      dataIndex: 'statusTypeId',
      width: 120,
      render: (_, record) => record.statusTypeId ?? '—'
    },
    {
      title: '控制语义',
      dataIndex: 'controlProfileId',
      width: 180,
      render: (_, record) => record.controlProfileId ?? '—'
    },
    { title: '叠层组', dataIndex: 'stackGroupKey', width: 180 },
    { title: '叠层策略', dataIndex: 'stackMode', width: 160 },
    {
      title: '时长',
      dataIndex: 'durationMode',
      width: 180,
      render: (_, record) =>
        record.durationMode === 'permanent' ? 'permanent' : record.durationMs ? `${record.durationMs}ms` : record.durationFormulaId ?? '—'
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 160,
      align: 'center',
      render: (_, record) => renderRowActions(record, actions)
    }
  ];
}

export function getControlStateProfileColumns(actions: RecordActions<ControlStateProfile>): TableColumnProps<ControlStateProfile>[] {
  return [
    {
      title: '控制语义 ID',
      dataIndex: 'controlProfileId',
      width: 220,
      render: (_, record) => <Typography.Text code>{record.controlProfileId}</Typography.Text>
    },
    { title: '名称', dataIndex: 'name', width: 180 },
    {
      title: '控制类型',
      dataIndex: 'controlKind',
      width: 140,
      render: (_, record) => <Tag>{record.controlKind}</Tag>
    },
    { title: '移动锁定', dataIndex: 'movementLockMode', width: 150 },
    { title: '施法锁定', dataIndex: 'castLockMode', width: 170 },
    { title: '普攻锁定', dataIndex: 'attackLockMode', width: 170 },
    { title: '输入接管', dataIndex: 'inputOverrideMode', width: 170 },
    { title: '优先级', dataIndex: 'priority', width: 100 },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 160,
      align: 'center',
      render: (_, record) => renderRowActions(record, actions)
    }
  ];
}

export function getStatusModifierGroupColumns(actions: RecordActions<StatusModifierGroup>): TableColumnProps<StatusModifierGroup>[] {
  return [
    {
      title: '状态 ID',
      dataIndex: 'statusId',
      width: 220,
      render: (_, record) => <Typography.Text code>{record.statusId}</Typography.Text>
    },
    { title: '组 Key', dataIndex: 'groupKey', width: 180 },
    {
      title: '组名',
      dataIndex: 'groupName',
      width: 180,
      render: (_, record) => record.groupName ?? '—'
    },
    {
      title: '阶段',
      dataIndex: 'phaseKey',
      width: 140,
      render: (_, record) => <Tag>{record.phaseKey}</Tag>
    },
    { title: '快照策略', dataIndex: 'snapshotPolicy', width: 140 },
    {
      title: '间隔',
      dataIndex: 'intervalMs',
      width: 120,
      render: (_, record) => (record.intervalMs ? `${record.intervalMs}ms` : '—')
    },
    { title: '优先级', dataIndex: 'priority', width: 100 },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 160,
      align: 'center',
      render: (_, record) => renderRowActions(record, actions)
    }
  ];
}

export function getStatusAttributeModifierColumns(
  actions: RecordActions<StatusAttributeModifier>
): TableColumnProps<StatusAttributeModifier>[] {
  return [
    {
      title: '状态 ID',
      dataIndex: 'statusId',
      width: 200,
      render: (_, record) => <Typography.Text code>{record.statusId}</Typography.Text>
    },
    { title: '组 Key', dataIndex: 'groupKey', width: 160 },
    { title: '修饰 ID', dataIndex: 'modifierId', width: 180 },
    { title: '属性 Key', dataIndex: 'attrKey', width: 160 },
    {
      title: '修饰模式',
      dataIndex: 'modifierMode',
      width: 130,
      render: (_, record) => <Tag>{record.modifierMode}</Tag>
    },
    {
      title: '值/公式',
      dataIndex: 'value',
      width: 180,
      render: (_, record) => record.value ?? record.formulaId ?? '—'
    },
    {
      title: '桶 Key',
      dataIndex: 'bucketKey',
      width: 180,
      render: (_, record) => record.bucketKey ?? '—'
    },
    { title: '优先级', dataIndex: 'priority', width: 100 },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 160,
      align: 'center',
      render: (_, record) => renderRowActions(record, actions)
    }
  ];
}

export function getStatusPeriodicHpEffectColumns(
  actions: RecordActions<StatusPeriodicHpEffect>
): TableColumnProps<StatusPeriodicHpEffect>[] {
  return [
    {
      title: '状态 ID',
      dataIndex: 'statusId',
      width: 200,
      render: (_, record) => <Typography.Text code>{record.statusId}</Typography.Text>
    },
    { title: '组 Key', dataIndex: 'groupKey', width: 160 },
    { title: '效果 ID', dataIndex: 'effectId', width: 180 },
    {
      title: '类型',
      dataIndex: 'effectKind',
      width: 120,
      render: (_, record) => <Tag>{record.effectKind}</Tag>
    },
    { title: 'Tick 公式', dataIndex: 'tickFormulaId', width: 220 },
    {
      title: '伤害/治疗',
      dataIndex: 'damageType',
      width: 160,
      render: (_, record) =>
        record.effectKind === 'damage' ? record.damageType ?? '—' : record.affectedByHealModifier ? '受治疗修正' : '原始治疗'
    },
    {
      title: '暴击',
      key: 'crit',
      width: 220,
      render: (_, record) => formatStatusPeriodicHpEffectCrit(record)
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 160,
      align: 'center',
      render: (_, record) => renderRowActions(record, actions)
    }
  ];
}
