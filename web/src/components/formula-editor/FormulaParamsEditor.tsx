import { Alert, Button, Collapse, Empty, Input, InputNumber, Select, Space, Typography } from '@arco-design/web-react';
import { useMemo } from 'react';
import { AttributeKeySelector } from '../AttributeKeySelector';
import { compileFormulaText, compileVarsToExprMap, type VarDefinition } from '../../engine/formulaCompiler';
import { stringifyJson } from '../../pages/admin/resources/shared/json';
import {
  buildFormulaParamVarObject,
  createEmptyFormulaConstantRow,
  createEmptyFormulaParamVarRow,
  parseFormulaParams,
  stringifyFormulaParams,
  type FormulaConstantRow,
  type FormulaParamVarRow,
  type FormulaVarKind
} from './formulaModels';

type FormulaParamsEditorProps = {
  title: string;
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  value: string;
  disabled?: boolean;
  showPreview?: boolean;
  onChange: (value: string) => void;
};

const VAR_KIND_OPTIONS: Array<{ label: string; value: FormulaVarKind }> = [
  { label: '固定值', value: 'const' },
  { label: '等级表', value: 'table' },
  { label: '属性缩放', value: 'scaled_attr' },
  { label: '公式', value: 'formula' },
  { label: '映射属性缩放', value: 'mapping_scaled_attr' }
];

export function FormulaParamsEditor({
  title,
  apiBaseUrl,
  selectedGameId,
  adminToken,
  value,
  disabled = false,
  showPreview = true,
  onChange
}: FormulaParamsEditorProps) {
  const state = useMemo(() => {
    try {
      return { ...parseFormulaParams(value, title), error: null as string | null };
    } catch (error) {
      return {
        root: {},
        formulaText: '',
        vars: [],
        constants: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }, [title, value]);

  const variableOptions = useMemo(
    () =>
      state.vars
        .map((row) => row.key.trim())
        .filter(Boolean)
        .map((key) => ({
          label: key,
          value: key
        })),
    [state.vars]
  );

  const preview = useMemo(() => {
    if (!showPreview || state.error || !state.formulaText.trim()) {
      return { error: null as string | null, astText: '' };
    }

    try {
      const previewVars: Record<string, VarDefinition> = {};
      state.vars.forEach((row) => {
        const key = row.key.trim();
        if (!key) {
          return;
        }
        previewVars[key] = buildPreviewVarDefinition(row);
      });

      state.constants.forEach((row) => {
        const key = row.key.trim();
        if (!key || previewVars[key]) {
          return;
        }
        const numeric = Number(row.valueText.trim());
        if (Number.isFinite(numeric)) {
          previewVars[key] = { kind: 'const', value: numeric };
        }
      });

      const exprMap = compileVarsToExprMap(previewVars, {
        skillLevel: 1,
        championLevel: 1
      });
      const expr = compileFormulaText(state.formulaText, undefined, exprMap);
      return { error: null as string | null, astText: stringifyJson(expr) };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        astText: ''
      };
    }
  }, [showPreview, state.constants, state.error, state.formulaText, state.vars]);

  const applyChange = (nextFormulaText: string, nextVars: FormulaParamVarRow[], nextConstants: FormulaConstantRow[]) => {
    onChange(stringifyFormulaParams(state.root, nextFormulaText, nextVars, nextConstants));
  };

  const updateFormulaText = (nextFormulaText: string) => {
    if (state.error) {
      return;
    }
    applyChange(nextFormulaText, state.vars, state.constants);
  };

  const addConstant = () => {
    if (state.error) {
      return;
    }
    applyChange(
      state.formulaText,
      state.vars,
      [...state.constants, createEmptyFormulaConstantRow(state.constants.map((row) => row.key))]
    );
  };

  const updateConstant = (index: number, patch: Partial<FormulaConstantRow>) => {
    if (state.error) {
      return;
    }
    applyChange(
      state.formulaText,
      state.vars,
      state.constants.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row))
    );
  };

  const removeConstant = (index: number) => {
    if (state.error) {
      return;
    }
    applyChange(
      state.formulaText,
      state.vars,
      state.constants.filter((_, rowIndex) => rowIndex !== index)
    );
  };

  const addVar = (kind: FormulaVarKind = 'const') => {
    if (state.error) {
      return;
    }
    applyChange(
      state.formulaText,
      [...state.vars, createEmptyFormulaParamVarRow(kind, state.vars.map((row) => row.key))],
      state.constants
    );
  };

  const updateVar = (index: number, patch: Partial<FormulaParamVarRow>) => {
    if (state.error) {
      return;
    }
    applyChange(
      state.formulaText,
      state.vars.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
      state.constants
    );
  };

  const updateVarKind = (index: number, kind: FormulaVarKind) => {
    if (state.error) {
      return;
    }
    const current = state.vars[index];
    const nextRow = createEmptyFormulaParamVarRow(kind, state.vars.map((row) => row.key));
    applyChange(
      state.formulaText,
      state.vars.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...nextRow,
              raw: current.raw,
              key: current.key,
              label: current.label
            }
          : row
      ),
      state.constants
    );
  };

  const removeVar = (index: number) => {
    if (state.error) {
      return;
    }
    applyChange(
      state.formulaText,
      state.vars.filter((_, rowIndex) => rowIndex !== index),
      state.constants
    );
  };

  const updateTableValues = (index: number, rawValue: string) => {
    updateVar(index, {
      values: rawValue
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => Number(entry))
        .filter((entry) => Number.isFinite(entry))
    });
  };

  const addMappingEntry = (index: number) => {
    const row = state.vars[index];
    updateVar(index, {
      mappingValues: [...row.mappingValues, { key: '', value: 0 }]
    });
  };

  const updateMappingEntry = (varIndex: number, mappingIndex: number, patch: { key?: string; value?: number }) => {
    const row = state.vars[varIndex];
    updateVar(varIndex, {
      mappingValues: row.mappingValues.map((entry, entryIndex) =>
        entryIndex === mappingIndex ? { ...entry, ...patch } : entry
      )
    });
  };

  const removeMappingEntry = (varIndex: number, mappingIndex: number) => {
    const row = state.vars[varIndex];
    updateVar(varIndex, {
      mappingValues: row.mappingValues.filter((_, entryIndex) => entryIndex !== mappingIndex)
    });
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {state.error ? <Alert type="error" content={`${title} 解析失败：${state.error}`} /> : null}

      <div>
        <Typography.Text bold>{title}</Typography.Text>
        <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
          结构化编辑会回写到同一个 JSON 对象，并保留未知字段 passthrough。
        </Typography.Text>
      </div>

      <div>
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
          公式（formulaText）
        </Typography.Text>
        <Input.TextArea
          value={state.formulaText}
          disabled={disabled || !!state.error}
          autoSize={{ minRows: 2, maxRows: 4 }}
          onChange={updateFormulaText}
          placeholder="base_damage + ap_ratio"
        />
      </div>

      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Typography.Text bold>变量</Typography.Text>
            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
              主路径对应 `params.vars`。
            </Typography.Text>
          </div>
          <Button size="small" type="primary" disabled={disabled || !!state.error} onClick={() => addVar()}>
            添加变量
          </Button>
        </div>

        {state.vars.length === 0 ? (
          <Empty description="暂无变量。" />
        ) : (
          state.vars.map((row, index) => (
            <div key={`${row.key || 'var'}-${index}`} style={{ border: '1px solid var(--color-border-2)', borderRadius: 8, padding: 12 }}>
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <div className="crud-form-grid">
                  <div>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                      键名（key）
                    </Typography.Text>
                    <Input
                      value={row.key}
                      disabled={disabled || !!state.error}
                      onChange={(nextValue) => updateVar(index, { key: nextValue })}
                      placeholder="base_damage"
                    />
                  </div>
                  <div>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                      显示名（label）
                    </Typography.Text>
                    <Input
                      value={row.label}
                      disabled={disabled || !!state.error}
                      onChange={(nextValue) => updateVar(index, { label: nextValue })}
                      placeholder="基础伤害"
                    />
                  </div>
                  <div>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                      变量类型（kind）
                    </Typography.Text>
                    <Select
                      value={row.kind}
                      disabled={disabled || !!state.error}
                      options={VAR_KIND_OPTIONS}
                      onChange={(nextValue) => updateVarKind(index, nextValue as FormulaVarKind)}
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
                      disabled={disabled || !!state.error}
                      onChange={(nextValue) => updateVar(index, { value: nextValue == null ? undefined : Number(nextValue) })}
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
                        disabled={disabled || !!state.error}
                        options={[
                          { label: '技能等级', value: 'skillLevel' },
                          { label: '英雄等级', value: 'championLevel' }
                        ]}
                        onChange={(nextValue) =>
                          updateVar(index, { by: nextValue === 'championLevel' ? 'championLevel' : 'skillLevel' })
                        }
                      />
                    </div>
                    <div>
                      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                        数值列表
                      </Typography.Text>
                      <Input
                        value={row.values.join(', ')}
                        disabled={disabled || !!state.error}
                        onChange={(nextValue) => updateTableValues(index, nextValue)}
                        placeholder="80, 115, 150, 185, 220"
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
                        disabled={disabled || !!state.error}
                        onChange={(nextValue) => updateVar(index, { attr: typeof nextValue === 'string' ? nextValue : '' })}
                      />
                    </div>
                    <div style={{ maxWidth: 220 }}>
                      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                        系数（coefficient）
                      </Typography.Text>
                      <InputNumber
                        style={{ width: '100%' }}
                        value={row.coefficient}
                        disabled={disabled || !!state.error}
                        onChange={(nextValue) => updateVar(index, { coefficient: nextValue == null ? undefined : Number(nextValue) })}
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
                        disabled={disabled || !!state.error}
                        onChange={(nextValue) => updateVar(index, { formulaText: nextValue })}
                        placeholder="base_damage + ap_ratio"
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
                        disabled={disabled || !!state.error}
                        options={variableOptions.filter((option) => option.value !== row.key.trim())}
                        onChange={(nextValue) =>
                          updateVar(index, {
                            formulaVars: Array.isArray(nextValue) ? nextValue.map(String) : []
                          })
                        }
                      />
                    </div>
                  </>
                ) : null}

                {row.kind === 'mapping_scaled_attr' ? (
                  <>
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
                          disabled={disabled || !!state.error}
                          onChange={(nextValue) => updateVar(index, { attr: typeof nextValue === 'string' ? nextValue : '' })}
                        />
                      </div>
                      <div>
                        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                          选择器（selector）
                        </Typography.Text>
                        <Input
                          value={row.selector}
                          disabled={disabled || !!state.error}
                          onChange={(nextValue) => updateVar(index, { selector: nextValue })}
                          placeholder="self.profession"
                        />
                      </div>
                      <div style={{ maxWidth: 220 }}>
                        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                          兜底系数
                        </Typography.Text>
                        <InputNumber
                          style={{ width: '100%' }}
                          value={row.coefficient}
                          disabled={disabled || !!state.error}
                          onChange={(nextValue) => updateVar(index, { coefficient: nextValue == null ? undefined : Number(nextValue) })}
                        />
                      </div>
                    </div>

                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          映射值
                        </Typography.Text>
                        <Button size="mini" disabled={disabled || !!state.error} onClick={() => addMappingEntry(index)}>
                          添加映射
                        </Button>
                      </div>

                      {row.mappingValues.length === 0 ? (
                        <Empty description="暂无映射项。" />
                      ) : (
                        row.mappingValues.map((entry, mappingIndex) => (
                          <div key={`${entry.key || 'mapping'}-${mappingIndex}`} className="crud-form-grid">
                            <Input
                              value={entry.key}
                              disabled={disabled || !!state.error}
                              onChange={(nextValue) => updateMappingEntry(index, mappingIndex, { key: nextValue })}
                              placeholder="melee"
                            />
                            <InputNumber
                              style={{ width: '100%' }}
                              value={entry.value}
                              disabled={disabled || !!state.error}
                              onChange={(nextValue) =>
                                updateMappingEntry(index, mappingIndex, {
                                  value: nextValue == null ? 0 : Number(nextValue)
                                })
                              }
                            />
                            <Button
                              status="danger"
                              disabled={disabled || !!state.error}
                              onClick={() => removeMappingEntry(index, mappingIndex)}
                            >
                              删除
                            </Button>
                          </div>
                        ))
                      )}
                    </Space>
                  </>
                ) : null}

                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                    原始行预览
                  </Typography.Text>
                  <Input.TextArea
                    value={stringifyJson(buildFormulaParamVarObject(row))}
                    disabled
                    autoSize={{ minRows: 3, maxRows: 6 }}
                    className="admin-json-input"
                  />
                </div>

                <div>
                  <Button status="danger" disabled={disabled || !!state.error} onClick={() => removeVar(index)}>
                    删除变量
                  </Button>
                </div>
              </Space>
            </div>
          ))
        )}
      </Space>

      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Typography.Text bold>常量</Typography.Text>
            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
              存放在 `constants` 下，并在原始 JSON 中保留。
            </Typography.Text>
          </div>
          <Button size="small" type="primary" disabled={disabled || !!state.error} onClick={addConstant}>
            添加常量
          </Button>
        </div>

        {state.constants.length === 0 ? (
          <Empty description="暂无常量。" />
        ) : (
          state.constants.map((row, index) => (
            <div key={`${row.key || 'constant'}-${index}`} className="crud-form-grid">
              <Input
                value={row.key}
                disabled={disabled || !!state.error}
                onChange={(nextValue) => updateConstant(index, { key: nextValue })}
                placeholder="crit_cap"
              />
              <Input
                value={row.valueText}
                disabled={disabled || !!state.error}
                onChange={(nextValue) => updateConstant(index, { valueText: nextValue })}
                placeholder="100"
              />
              <Button status="danger" disabled={disabled || !!state.error} onClick={() => removeConstant(index)}>
                删除
              </Button>
            </div>
          ))
        )}
      </Space>

      {showPreview ? (
        <div>
          <Typography.Text bold>编译预览</Typography.Text>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
            使用当前变量通过 `formulaCompiler.ts` 预编译 `formulaText`。
          </Typography.Text>
          {preview.error ? <Alert type="error" content={preview.error} style={{ marginBottom: 8 }} /> : null}
          <Input.TextArea
            value={preview.astText}
            disabled
            autoSize={{ minRows: 6, maxRows: 12 }}
            placeholder={state.formulaText.trim() ? '这里会显示编译后的 AST 预览。' : '请输入 formulaText 以预览编译结果。'}
            className="admin-json-input"
          />
        </div>
      ) : null}

      <Collapse defaultActiveKey={[]}>
        <Collapse.Item name="advanced-json" header="高级 JSON">
          <Input.TextArea
            value={value}
            disabled={disabled}
            autoSize={{ minRows: 8, maxRows: 16 }}
            onChange={onChange}
            placeholder="{\n  \n}"
            className="admin-json-input"
          />
        </Collapse.Item>
      </Collapse>
    </Space>
  );
}

function buildPreviewVarDefinition(row: FormulaParamVarRow): VarDefinition {
  if (row.kind === 'const') {
    return {
      kind: 'const',
      value: row.value ?? 0
    };
  }

  if (row.kind === 'table') {
    return {
      kind: 'table',
      by: row.by,
      values: row.values
    };
  }

  if (row.kind === 'scaled_attr') {
    return {
      kind: 'scaled_attr',
      attr: row.attr,
      coefficient: row.coefficient ?? 1
    };
  }

  if (row.kind === 'formula') {
    return {
      kind: 'formula',
      formulaText: row.formulaText,
      formulaVars: row.formulaVars
    };
  }

  return {
    kind: 'mapping_scaled_attr',
    selector: row.selector,
    attr: row.attr,
    coefficient: row.coefficient ?? 1,
    values: Object.fromEntries(
      row.mappingValues
        .map((entry) => [entry.key.trim(), entry.value] as const)
        .filter(([key]) => Boolean(key))
    )
  } as unknown as VarDefinition;
}
