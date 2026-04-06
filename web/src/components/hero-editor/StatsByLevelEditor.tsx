import { Button, Empty, InputNumber, Space, Typography } from '@arco-design/web-react';
import { useMemo } from 'react';
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
  stageMin?: number;
  stageMax?: number;
  stageLabel?: string;
  disabled?: boolean;
  onChange: (rows: HeroStatsByLevelRow[]) => void;
};

export function StatsByLevelEditor({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  definitions,
  rows,
  stageMin = 1,
  stageMax = 18,
  stageLabel = 'Lv',
  disabled = false,
  onChange
}: StatsByLevelEditorProps) {
  const normalizedStageMin = Number.isFinite(stageMin) ? Math.max(1, Math.floor(stageMin)) : 1;
  const normalizedStageMax = Number.isFinite(stageMax)
    ? Math.max(normalizedStageMin, Math.floor(stageMax))
    : 18;
  const stageCount = normalizedStageMax - normalizedStageMin + 1;
  const stages = useMemo(
    () => Array.from({ length: stageCount }, (_, index) => normalizedStageMin + index),
    [normalizedStageMin, stageCount]
  );
  const columnTemplate = `repeat(${stageCount}, minmax(96px, 1fr))`;

  const addRow = () => {
    const excludedKeys = rows.map((row) => row.attrKey);
    const nextAttrKey = definitions?.find((definition) => !excludedKeys.includes(definition.attrKey))?.attrKey ?? '';
    onChange([...rows, { attrKey: nextAttrKey, values: createLevelArray(stageCount) }]);
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
            录入 {normalizedStageMin}~{normalizedStageMax} 阶段的绝对值快照，保存为 “属性 `{'>'}` 数组” 结构。
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
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: columnTemplate,
                  gap: 8,
                  minWidth: Math.max(stageCount * 108, 720)
                }}
              >
                {stages.map((stage, stageIndex) => (
                  <div key={stage}>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                      {stageLabel}{stage}
                    </Typography.Text>
                    <InputNumber
                      style={{ width: '100%' }}
                      value={row.values[stageIndex] ?? 0}
                      disabled={disabled}
                      onChange={(value) => updateLevelValue(rowIndex, stageIndex, Number(value ?? 0))}
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
