import { Button, Empty, InputNumber, Space, Typography } from '@arco-design/web-react';
import { AttributeKeySelector } from '../AttributeKeySelector';
import type { AttributeDefinition } from '../../types/api';
import type { HeroStatsByLevelRow } from './heroStats';
import { createLevelArray } from './heroStats';

type StatsByLevelEditorProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  definitions?: AttributeDefinition[];
  rows: HeroStatsByLevelRow[];
  disabled?: boolean;
  onChange: (rows: HeroStatsByLevelRow[]) => void;
};

const LEVELS = Array.from({ length: 18 }, (_, index) => index + 1);

export function StatsByLevelEditor({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  definitions,
  rows,
  disabled = false,
  onChange
}: StatsByLevelEditorProps) {
  const addRow = () => {
    const excludedKeys = rows.map((row) => row.attrKey);
    const nextAttrKey = definitions?.find((definition) => !excludedKeys.includes(definition.attrKey))?.attrKey ?? '';
    onChange([...rows, { attrKey: nextAttrKey, values: createLevelArray() }]);
  };

  const updateAttrKey = (index: number, attrKey: string) => {
    onChange(rows.map((row, currentIndex) => (currentIndex === index ? { ...row, attrKey } : row)));
  };

  const updateLevelValue = (rowIndex: number, levelIndex: number, value: number) => {
    onChange(
      rows.map((row, currentIndex) => {
        if (currentIndex !== rowIndex) {
          return row;
        }
        const nextValues = [...row.values];
        nextValues[levelIndex] = value;
        return { ...row, values: nextValues };
      })
    );
  };

  const removeRow = (index: number) => {
    onChange(rows.filter((_, currentIndex) => currentIndex !== index));
  };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Typography.Text bold>每级属性快照</Typography.Text>
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
            录入 1~18 级的绝对值快照，保存为 “属性 `{'>'}` 数组” 结构。
          </Typography.Text>
        </div>
        <Button size="small" type="primary" onClick={addRow} disabled={disabled}>
          添加属性
        </Button>
      </div>

      {rows.length === 0 ? (
        <Empty description="暂无成长数据，点击“添加属性”开始录入。" />
      ) : (
        rows.map((row, rowIndex) => (
          <div key={`${row.attrKey || 'empty'}-${rowIndex}`} style={{ border: '1px solid var(--color-border-2)', borderRadius: 8, padding: 12 }}>
            <Space align="start" style={{ width: '100%', marginBottom: 12 }}>
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
                  onChange={(value) => updateAttrKey(rowIndex, typeof value === 'string' ? value : '')}
                />
              </div>
              <Button status="danger" onClick={() => removeRow(rowIndex)} disabled={disabled}>
                删除属性
              </Button>
            </Space>

            <div style={{ overflowX: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(18, minmax(96px, 1fr))', gap: 8, minWidth: 1800 }}>
                {LEVELS.map((level, levelIndex) => (
                  <div key={level}>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                      Lv{level}
                    </Typography.Text>
                    <InputNumber
                      style={{ width: '100%' }}
                      value={row.values[levelIndex] ?? 0}
                      disabled={disabled}
                      onChange={(value) => updateLevelValue(rowIndex, levelIndex, Number(value ?? 0))}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))
      )}
    </Space>
  );
}