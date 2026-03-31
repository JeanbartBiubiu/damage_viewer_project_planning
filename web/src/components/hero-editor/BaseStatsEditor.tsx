import { Button, Empty, InputNumber, Space, Typography } from '@arco-design/web-react';
import { AttributeKeySelector } from '../AttributeKeySelector';
import type { HeroBaseStatRow } from './heroStats';
import type { AttributeDefinition } from '../../types/api';

type BaseStatsEditorProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  definitions?: AttributeDefinition[];
  rows: HeroBaseStatRow[];
  disabled?: boolean;
  onChange: (rows: HeroBaseStatRow[]) => void;
};

export function BaseStatsEditor({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  definitions,
  rows,
  disabled = false,
  onChange
}: BaseStatsEditorProps) {
  const addRow = () => {
    const excludedKeys = rows.map((row) => row.attrKey);
    const nextAttrKey = definitions?.find((definition) => !excludedKeys.includes(definition.attrKey))?.attrKey ?? '';
    onChange([...rows, { attrKey: nextAttrKey, value: 0 }]);
  };

  const updateRow = (index: number, patch: Partial<HeroBaseStatRow>) => {
    onChange(rows.map((row, currentIndex) => (currentIndex === index ? { ...row, ...patch } : row)));
  };

  const removeRow = (index: number) => {
    onChange(rows.filter((_, currentIndex) => currentIndex !== index));
  };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography.Text bold>基础属性</Typography.Text>
        <Button size="small" type="primary" onClick={addRow} disabled={disabled}>
          添加属性
        </Button>
      </div>

      {rows.length === 0 ? (
        <Empty description="暂无基础属性，点击“添加属性”开始录入。" />
      ) : (
        rows.map((row, index) => (
          <Space key={`${row.attrKey || 'empty'}-${index}`} align="start" style={{ width: '100%' }}>
            <div style={{ minWidth: 280, flex: '0 0 280px' }}>
              <AttributeKeySelector
                apiBaseUrl={apiBaseUrl}
                gameId={selectedGameId}
                token={adminToken}
                definitions={definitions}
                mode="single"
                valueMode="attrKey"
                value={row.attrKey}
                disabled={disabled}
                excludeAttrKeys={rows.map((item) => item.attrKey).filter((attrKey) => attrKey && attrKey !== row.attrKey)}
                placeholder="选择属性"
                showMetaText={false}
                onChange={(value) => updateRow(index, { attrKey: typeof value === 'string' ? value : '' })}
              />
            </div>
            <InputNumber
              style={{ width: 180 }}
              value={row.value}
              disabled={disabled}
              onChange={(value) => updateRow(index, { value: Number(value ?? 0) })}
            />
            <Button status="danger" onClick={() => removeRow(index)} disabled={disabled}>
              删除
            </Button>
          </Space>
        ))
      )}
    </Space>
  );
}