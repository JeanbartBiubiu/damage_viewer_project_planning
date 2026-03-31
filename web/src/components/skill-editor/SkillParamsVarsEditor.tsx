import { Button, Empty, Input, InputNumber, Select, Space, Typography } from '@arco-design/web-react';
import { AttributeKeySelector } from '../AttributeKeySelector';
import type { SkillParamVarKind, SkillParamVarRow } from './skillModels';
import { createEmptyParamVarRow } from './skillModels';

type SkillParamsVarsEditorProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  rows: SkillParamVarRow[];
  disabled?: boolean;
  onChange: (rows: SkillParamVarRow[]) => void;
};

const PARAM_KIND_OPTIONS: Array<{ label: string; value: SkillParamVarKind }> = [
  { label: '固定值', value: 'const' },
  { label: '等级表', value: 'table' },
  { label: '属性缩放', value: 'scaled_attr' },
  { label: '公式', value: 'formula' },
  { label: '映射属性缩放', value: 'mapping_scaled_attr' }
];

export function SkillParamsVarsEditor({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  rows,
  disabled = false,
  onChange
}: SkillParamsVarsEditorProps) {
  const addRow = () => {
    onChange([...rows, createEmptyParamVarRow('const', rows.map((row) => row.key))]);
  };

  const updateRow = (index: number, patch: Partial<SkillParamVarRow>) => {
    onChange(rows.map((row, currentIndex) => (currentIndex === index ? { ...row, ...patch } : row)));
  };

  const removeRow = (index: number) => {
    onChange(rows.filter((_, currentIndex) => currentIndex !== index));
  };

  const updateKind = (index: number, kind: SkillParamVarKind) => {
    const current = rows[index];
    onChange(
      rows.map((row, currentIndex) => {
        if (currentIndex !== index) {
          return row;
        }
        const next = createEmptyParamVarRow(kind);
        return {
          ...next,
          raw: current.raw,
          key: current.key,
          label: current.label,
          fallbackText: current.fallbackText
        };
      })
    );
  };

  const variableOptions = rows
    .map((row) => row.key.trim())
    .filter(Boolean)
    .map((key) => ({
      label: key,
      value: key
    }));

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Typography.Text bold>参数变量</Typography.Text>
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
            主编辑路径对齐 `params.vars`。等级表、属性缩放和公式都在这里录入。
          </Typography.Text>
        </div>
        <Button size="small" type="primary" onClick={addRow} disabled={disabled}>
          添加变量
        </Button>
      </div>

      {rows.length === 0 ? (
        <Empty description="暂无变量，可添加基础值、等级表、属性缩放或公式变量。" />
      ) : (
        rows.map((row, index) => (
          <div key={`${row.key || 'var'}-${index}`} style={{ border: '1px solid var(--color-border-2)', borderRadius: 8, padding: 12 }}>
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <div className="crud-form-grid">
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                    键名（key）
                  </Typography.Text>
                  <Input value={row.key} disabled={disabled} onChange={(value) => updateRow(index, { key: value })} placeholder="例如 base_damage" />
                </div>
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                    显示名（label）
                  </Typography.Text>
                  <Input value={row.label} disabled={disabled} onChange={(value) => updateRow(index, { label: value })} placeholder="例如 基础伤害" />
                </div>
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                    变量类型（kind）
                  </Typography.Text>
                  <Select
                    value={row.kind}
                    disabled={disabled}
                    options={PARAM_KIND_OPTIONS}
                    onChange={(value) => updateKind(index, value as SkillParamVarKind)}
                  />
                </div>
              </div>

              {row.kind === 'const' ? (
                <div style={{ maxWidth: 240 }}>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                    数值（value）
                  </Typography.Text>
                  <InputNumber
                    style={{ width: '100%' }}
                    value={row.value}
                    disabled={disabled}
                    onChange={(value) => updateRow(index, { value: value == null ? undefined : Number(value) })}
                  />
                </div>
              ) : null}

              {row.kind === 'table' ? (
                <div className="crud-form-grid">
                  <div>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                      维度（by）
                    </Typography.Text>
                    <Select
                      value={row.by}
                      disabled={disabled}
                      options={[
                        { label: '技能等级', value: 'skillLevel' },
                        { label: '英雄等级', value: 'championLevel' }
                      ]}
                      onChange={(value) => updateRow(index, { by: String(value ?? 'skillLevel') })}
                    />
                  </div>
                  <div>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                      数值列表（逗号分隔）
                    </Typography.Text>
                    <Input
                      value={row.values.join(', ')}
                      disabled={disabled}
                      onChange={(value) =>
                        updateRow(index, {
                          values: value
                            .split(',')
                            .map((entry) => entry.trim())
                            .filter(Boolean)
                            .map((entry) => Number(entry))
                            .filter((entry) => Number.isFinite(entry))
                        })
                      }
                      placeholder="例如：0, 115, 150, 185, 220"
                    />
                  </div>
                </div>
              ) : null}

              {row.kind === 'scaled_attr' ? (
                <div className="crud-form-grid">
                  <div>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                      属性引用（attr）
                    </Typography.Text>
                    <AttributeKeySelector
                      apiBaseUrl={apiBaseUrl}
                      gameId={selectedGameId}
                      token={adminToken}
                      valueMode="scopedRef"
                      value={row.attr}
                      disabled={disabled}
                      placeholder="选择属性引用"
                      onChange={(value) => updateRow(index, { attr: typeof value === 'string' ? value : '' })}
                    />
                  </div>
                  <div style={{ maxWidth: 220 }}>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                      系数（coefficient）
                    </Typography.Text>
                    <InputNumber
                      style={{ width: '100%' }}
                      value={row.coefficient}
                      disabled={disabled}
                      onChange={(value) => updateRow(index, { coefficient: value == null ? undefined : Number(value) })}
                    />
                  </div>
                </div>
              ) : null}

              {row.kind === 'formula' ? (
                <>
                  <div>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                      公式（formulaText）
                    </Typography.Text>
                    <Input
                      value={row.formulaText}
                      disabled={disabled}
                      onChange={(value) => updateRow(index, { formulaText: value })}
                      placeholder="例如 base_damage + ap_ratio"
                    />
                  </div>
                  <div>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                      引用变量（formulaVars）
                    </Typography.Text>
                    <Select
                      mode="multiple"
                      showSearch
                      allowClear
                      value={row.formulaVars}
                      disabled={disabled}
                      options={variableOptions.filter((option) => option.value !== row.key.trim())}
                      onChange={(value) => updateRow(index, { formulaVars: Array.isArray(value) ? value.map(String) : [] })}
                    />
                  </div>
                </>
              ) : null}

              {row.kind === 'mapping_scaled_attr' ? (
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                    映射属性缩放 JSON
                  </Typography.Text>
                  <Input.TextArea
                    value={row.fallbackText}
                    disabled={disabled}
                    autoSize={{ minRows: 6, maxRows: 12 }}
                    onChange={(value) => updateRow(index, { fallbackText: value })}
                    className="admin-json-input"
                  />
                </div>
              ) : null}

              <div>
                <Button status="danger" onClick={() => removeRow(index)} disabled={disabled}>
                  删除变量
                </Button>
              </div>
            </Space>
          </div>
        ))
      )}
    </Space>
  );
}
