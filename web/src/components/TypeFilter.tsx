import { Select, Typography } from '@arco-design/web-react';
import type { TypeDefinition } from '../types/api';

type TypeFilterProps = {
  definitions: TypeDefinition[];
  value: number[];
  onChange: (value: number[]) => void;
  disabled?: boolean;
  placeholder?: string;
  helperText?: string;
};

export function TypeFilter({
  definitions,
  value,
  onChange,
  disabled = false,
  placeholder = '按类型筛选',
  helperText
}: TypeFilterProps) {
  return (
    <div style={{ minWidth: 260 }}>
      <Select
        mode="multiple"
        showSearch
        allowClear
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        maxTagCount={3}
        options={definitions.map((type) => ({
          label: `${type.name ?? '未命名类型'} · ${type.typeId}`,
          value: type.typeId
        }))}
        onChange={(nextValue) => onChange(Array.isArray(nextValue) ? nextValue.map((item) => Number(item)) : [])}
        filterOption={(inputValue, option) => {
          const searchText = `${String(option?.value ?? '')} ${String(option?.label ?? '')}`.toLowerCase();
          return searchText.includes(inputValue.trim().toLowerCase());
        }}
      />
      {helperText ? (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
          {helperText}
        </Typography.Text>
      ) : null}
    </div>
  );
}