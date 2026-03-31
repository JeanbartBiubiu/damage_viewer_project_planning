import { Select, Typography } from '@arco-design/web-react';
import { useMemo } from 'react';
import type { TypeDefinition } from '../types/api';

type BaseTypeIdSelectorProps = {
  definitions: TypeDefinition[];
  disabled?: boolean;
  placeholder?: string;
  helperText?: string;
  allowClear?: boolean;
};

type SingleTypeIdSelectorProps = BaseTypeIdSelectorProps & {
  mode?: 'single';
  value: number | undefined;
  onChange: (value: number | undefined) => void;
};

type MultipleTypeIdSelectorProps = BaseTypeIdSelectorProps & {
  mode: 'multiple';
  value: number[];
  onChange: (value: number[]) => void;
};

type TypeIdSelectorProps = SingleTypeIdSelectorProps | MultipleTypeIdSelectorProps;

export function TypeIdSelector(props: TypeIdSelectorProps) {
  const {
    definitions,
    disabled = false,
    placeholder = props.mode === 'multiple' ? '请选择一个或多个类型' : '请选择类型',
    helperText,
    allowClear = true
  } = props;

  const selectedIds = props.mode === 'multiple' ? props.value : props.value != null ? [props.value] : [];

  const options = useMemo(() => {
    const baseOptions = definitions.map((type) => ({
      label: `${type.name ?? '未命名类型'} / ${type.typeId}`,
      value: type.typeId
    }));
    const knownIds = new Set(baseOptions.map((option) => option.value));
    const extraOptions = selectedIds
      .filter((typeId) => !knownIds.has(typeId))
      .map((typeId) => ({
        label: `未收录类型 / ${typeId}`,
        value: typeId
      }));
    return [...baseOptions, ...extraOptions];
  }, [definitions, selectedIds]);

  return (
    <div style={{ minWidth: 260 }}>
      <Select
        mode={props.mode === 'multiple' ? 'multiple' : undefined}
        showSearch
        allowClear={allowClear}
        value={props.mode === 'multiple' ? props.value : props.value}
        disabled={disabled}
        placeholder={placeholder}
        maxTagCount={props.mode === 'multiple' ? 3 : undefined}
        options={options}
        onChange={(nextValue) => {
          if (props.mode === 'multiple') {
            props.onChange(Array.isArray(nextValue) ? nextValue.map((item) => Number(item)) : []);
            return;
          }

          props.onChange(typeof nextValue === 'number' ? nextValue : nextValue != null ? Number(nextValue) : undefined);
        }}
        filterOption={(inputValue, option) => {
          const optionData = option as { value?: unknown; label?: unknown } | undefined;
          const searchText = `${String(optionData?.value ?? '')} ${String(optionData?.label ?? '')}`.toLowerCase();
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
