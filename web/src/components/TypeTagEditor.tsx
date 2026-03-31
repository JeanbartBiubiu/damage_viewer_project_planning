import { Button, Select, Space, Tag, Typography } from '@arco-design/web-react';
import { useMemo, useState } from 'react';
import type { TypeDefinition } from '../types/api';

type TypeTagEditorProps = {
  definitions: TypeDefinition[];
  persistedTypeIds: number[];
  value: number[];
  onChange: (value: number[]) => void;
  disabled?: boolean;
};

export function TypeTagEditor({ definitions, persistedTypeIds, value, onChange, disabled = false }: TypeTagEditorProps) {
  const [pendingTypeId, setPendingTypeId] = useState<number | undefined>();
  const persistedSet = useMemo(() => new Set(persistedTypeIds), [persistedTypeIds]);
  const selectedSet = useMemo(() => new Set(value), [value]);

  const selectedTypes = useMemo(
    () => definitions.filter((definition) => selectedSet.has(definition.typeId)),
    [definitions, selectedSet]
  );
  const addableTypes = useMemo(
    () => definitions.filter((definition) => !selectedSet.has(definition.typeId)),
    [definitions, selectedSet]
  );

  const addType = () => {
    if (!pendingTypeId || selectedSet.has(pendingTypeId)) {
      return;
    }
    onChange([...value, pendingTypeId].sort((left, right) => left - right));
    setPendingTypeId(undefined);
  };

  const removeDraftType = (typeId: number) => {
    if (persistedSet.has(typeId)) {
      return;
    }
    onChange(value.filter((current) => current !== typeId));
  };

  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <Space wrap>
        <div style={{ minWidth: 240 }}>
          <Select
            showSearch
            allowClear
            placeholder="选择要添加的类型"
            value={pendingTypeId}
            disabled={disabled || addableTypes.length === 0}
            options={addableTypes.map((type) => ({
              label: `${type.name ?? '未命名类型'} / ${type.typeId}`,
              value: type.typeId
            }))}
            onChange={(nextValue) => setPendingTypeId(typeof nextValue === 'number' ? nextValue : undefined)}
            filterOption={(inputValue, option) => {
              const optionData = option as { value?: unknown; label?: unknown } | undefined;
              const searchText = `${String(optionData?.value ?? '')} ${String(optionData?.label ?? '')}`.toLowerCase();
              return searchText.includes(inputValue.trim().toLowerCase());
            }}
          />
        </div>
        <Button type="primary" onClick={addType} disabled={disabled || !pendingTypeId}>
          添加类型
        </Button>
      </Space>

      <Space wrap>
        {selectedTypes.length > 0 ? (
          selectedTypes.map((type) => {
            const persisted = persistedSet.has(type.typeId);
            return (
              <Tag
                key={type.typeId}
                closable={!persisted && !disabled}
                onClose={(event) => {
                  event.preventDefault();
                  removeDraftType(type.typeId);
                }}
                color={persisted ? 'arcoblue' : 'green'}
              >
                {type.name ?? '未命名类型'} / {type.typeId}
                {persisted ? '' : '（新）'}
              </Tag>
            );
          })
        ) : (
          <Typography.Text type="secondary">当前未挂载任何类型。</Typography.Text>
        )}
      </Space>

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        已保存的类型标签当前只读，不支持移除；本次新增但尚未保存的标签可以撤回。
      </Typography.Text>
    </Space>
  );
}
