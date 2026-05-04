import { Form, Radio, Select, Space, Typography } from '@arco-design/web-react';
import { useEffect, useMemo, useState } from 'react';
import type { AttributeDefinition } from '../types/api';
import {
  loadAttributeDefinitions,
  type AttributeDefinitionsSource
} from '../services/attributeDefinitions';

export type AttributeSelectorMode = 'single' | 'multiple';
export type AttributeValueMode = 'attrKey' | 'scopedRef';
export type AttributeSide = 'self' | 'enemy';
export type AttributeSubType = 'base' | 'bonus' | 'total' | 'current' | 'max';

export type AttributeKeySelectorProps = {
  apiBaseUrl?: string;
  gameId: string | null;
  token?: string;
  definitions?: AttributeDefinition[];
  mode?: AttributeSelectorMode;
  valueMode?: AttributeValueMode;
  value?: string | string[];
  defaultValue?: string | string[];
  onChange?: (value: string | string[] | undefined) => void;
  disabled?: boolean;
  allowClear?: boolean;
  placeholder?: string;
  valueKindFilter?: Array<AttributeDefinition['valueKind']>;
  includeAttrKeys?: string[];
  excludeAttrKeys?: string[];
  showSide?: boolean;
  showSubType?: boolean;
  defaultSide?: AttributeSide;
  defaultSubType?: AttributeSubType;
  sideOptions?: AttributeSide[];
  subTypeOptions?: AttributeSubType[];
  size?: 'mini' | 'small' | 'default' | 'large';
  formatScopedRef?: (value: { side: AttributeSide; attrKey: string; subType?: AttributeSubType }) => string;
  helperText?: string;
  showMetaText?: boolean;
};

type ParsedScopedRef = {
  side?: AttributeSide;
  attrKey: string;
  subType?: AttributeSubType;
};

const DEFAULT_SIDE_OPTIONS: AttributeSide[] = ['self', 'enemy'];
const DEFAULT_SUBTYPE_OPTIONS: AttributeSubType[] = ['total', 'base', 'bonus', 'current', 'max'];

function defaultFormatScopedRef({ side, attrKey, subType }: { side: AttributeSide; attrKey: string; subType?: AttributeSubType }) {
  return subType && subType !== 'total' ? `${side}.${attrKey}.${subType}` : `${side}.${attrKey}`;
}

function normalizeValue(value: string | string[] | undefined, mode: AttributeSelectorMode): string[] {
  if (Array.isArray(value)) {
    return value.filter((item) => String(item).trim()).map((item) => String(item));
  }
  if (typeof value === 'string' && value.trim()) {
    return mode === 'multiple' ? [value] : [value];
  }
  return [];
}

function parseScopedRef(value: string): ParsedScopedRef {
  const trimmed = value.trim();
  if (!trimmed) {
    return { attrKey: '' };
  }

  const segments = trimmed.split('.').filter(Boolean);
  if (segments.length === 1) {
    return { attrKey: segments[0] };
  }

  const [maybeSide, ...rest] = segments;
  const side = maybeSide === 'self' || maybeSide === 'enemy' ? maybeSide : undefined;
  const tail = side ? rest : segments;
  if (tail.length === 0) {
    return { side, attrKey: '' };
  }

  const last = tail[tail.length - 1];
  if (isAttributeSubType(last)) {
    return {
      side,
      attrKey: tail.slice(0, -1).join('.'),
      subType: last
    };
  }

  return {
    side,
    attrKey: tail.join('.')
  };
}

function isAttributeSubType(value: string): value is AttributeSubType {
  return ['base', 'bonus', 'total', 'current', 'max'].includes(value);
}

export function AttributeKeySelector({
  apiBaseUrl,
  gameId,
  token,
  definitions,
  mode = 'single',
  valueMode = 'attrKey',
  value,
  defaultValue,
  onChange,
  disabled = false,
  allowClear = true,
  placeholder = '请选择属性',
  valueKindFilter,
  includeAttrKeys,
  excludeAttrKeys,
  showSide = valueMode === 'scopedRef',
  showSubType = valueMode === 'scopedRef',
  defaultSide = 'self',
  defaultSubType = 'total',
  sideOptions = DEFAULT_SIDE_OPTIONS,
  subTypeOptions = DEFAULT_SUBTYPE_OPTIONS,
  size = 'default',
  formatScopedRef = defaultFormatScopedRef,
  helperText,
  showMetaText = true
}: AttributeKeySelectorProps) {
  const [optionsState, setOptionsState] = useState<'idle' | 'loading' | 'ready' | 'error'>(definitions ? 'ready' : 'idle');
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [loadedDefinitions, setLoadedDefinitions] = useState<AttributeDefinition[]>(definitions ?? []);
  const [source, setSource] = useState<AttributeDefinitionsSource>(definitions ? 'provided' : 'bundle');
  const controlledValue = value ?? defaultValue;
  const normalizedValues = useMemo(() => normalizeValue(controlledValue, mode), [controlledValue, mode]);
  const parsedValues = useMemo<ParsedScopedRef[]>(
    () => (valueMode === 'scopedRef' ? normalizedValues.map(parseScopedRef) : normalizedValues.map((item) => ({ attrKey: item }))),
    [normalizedValues, valueMode]
  );
  const selectedAttrKeys = useMemo(
    () => parsedValues.map((item) => item.attrKey).filter(Boolean),
    [parsedValues]
  );

  const [side, setSide] = useState<AttributeSide>(parsedValues[0]?.side ?? defaultSide);
  const [subType, setSubType] = useState<AttributeSubType>(parsedValues[0]?.subType ?? defaultSubType);

  useEffect(() => {
    if (definitions) {
      return;
    }
    if (!gameId) {
      setLoadedDefinitions([]);
      setOptionsState('idle');
      setOptionsError(null);
    }
  }, [definitions, gameId]);

  useEffect(() => {
    if (!definitions) {
      return;
    }
    setLoadedDefinitions(definitions);
    setOptionsState('ready');
    setOptionsError(null);
    setSource('provided');
  }, [definitions]);

  useEffect(() => {
    if (valueMode !== 'scopedRef') {
      return;
    }
    const first = parsedValues[0];
    if (first?.side && sideOptions.includes(first.side)) {
      setSide(first.side);
    }
    if (first?.subType && subTypeOptions.includes(first.subType)) {
      setSubType(first.subType);
    }
  }, [parsedValues, sideOptions, subTypeOptions, valueMode]);

  useEffect(() => {
    if (definitions || !gameId || !apiBaseUrl) {
      return;
    }

    let cancelled = false;
    setOptionsState('loading');
    setOptionsError(null);

    loadAttributeDefinitions({
      apiBaseUrl,
      gameId,
      token
    })
      .then((result) => {
        if (cancelled) {
          return;
        }
        setLoadedDefinitions(result.definitions);
        setSource(result.source);
        setOptionsState('ready');
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setOptionsState('error');
        setOptionsError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, definitions, gameId, token]);

  const availableDefinitions = useMemo(() => {
    const includeSet = includeAttrKeys?.length ? new Set(includeAttrKeys) : null;
    const excludeSet = excludeAttrKeys?.length ? new Set(excludeAttrKeys) : null;
    const valueKindSet = valueKindFilter?.length ? new Set(valueKindFilter) : null;
    const deduped = new Map<string, AttributeDefinition>();
    for (const definition of loadedDefinitions) {
      const attrKey = String(definition.attrKey ?? '').trim();
      if (!attrKey) {
        continue;
      }
      if (includeSet && !includeSet.has(attrKey)) {
        continue;
      }
      if (excludeSet && excludeSet.has(attrKey) && !selectedAttrKeys.includes(attrKey)) {
        continue;
      }
      if (valueKindSet && !valueKindSet.has(definition.valueKind)) {
        continue;
      }
      if (deduped.has(attrKey)) {
        continue;
      }
      deduped.set(attrKey, attrKey === definition.attrKey ? definition : { ...definition, attrKey });
    }
    return Array.from(deduped.values());
  }, [excludeAttrKeys, includeAttrKeys, loadedDefinitions, selectedAttrKeys, valueKindFilter]);

  const selectValue = mode === 'multiple' ? selectedAttrKeys : selectedAttrKeys[0];
  const selectOptions = useMemo(
    () =>
      availableDefinitions.map((definition) => ({
        label: buildOptionLabel(definition),
        value: definition.attrKey
      })),
    [availableDefinitions]
  );

  const emitChange = (
    nextValue: string | string[] | undefined,
    nextSide: AttributeSide = side,
    nextSubType: AttributeSubType = subType
  ) => {
    if (!onChange) {
      return;
    }

    const nextAttrKeys = normalizeValue(nextValue, mode);
    if (nextAttrKeys.length === 0) {
      onChange(mode === 'multiple' ? [] : undefined);
      return;
    }

    if (valueMode === 'attrKey') {
      onChange(mode === 'multiple' ? nextAttrKeys : nextAttrKeys[0]);
      return;
    }

    const scopedValues = nextAttrKeys.map((attrKey) =>
      formatScopedRef({
        side: nextSide,
        attrKey,
        subType: showSubType ? nextSubType : undefined
      })
    );
    onChange(mode === 'multiple' ? scopedValues : scopedValues[0]);
  };

  const handleSelectChange = (nextValue: string | string[] | undefined) => {
    emitChange(nextValue);
  };

  const handleSideChange = (nextSide: string) => {
    const normalizedSide = nextSide as AttributeSide;
    setSide(normalizedSide);
    if (valueMode === 'scopedRef' && selectedAttrKeys.length > 0) {
      emitChange(mode === 'multiple' ? selectedAttrKeys : selectedAttrKeys[0], normalizedSide, subType);
    }
  };

  const handleSubTypeChange = (nextSubType: string) => {
    const normalizedSubType = nextSubType as AttributeSubType;
    setSubType(normalizedSubType);
    if (valueMode === 'scopedRef' && selectedAttrKeys.length > 0) {
      emitChange(mode === 'multiple' ? selectedAttrKeys : selectedAttrKeys[0], side, normalizedSubType);
    }
  };

  const isDisabled = disabled || !gameId || (!definitions && !apiBaseUrl) || optionsState === 'loading';

  return (
    <div>
      {(showSide || showSubType) && valueMode === 'scopedRef' ? (
        <Space size={8} wrap style={{ marginBottom: 8 }}>
          {showSide ? (
            <Radio.Group type="button" size="small" value={side} onChange={handleSideChange} disabled={disabled}>
              {sideOptions.map((option) => (
                <Radio key={option} value={option}>
                  {option === 'self' ? '自身' : '敌方'}
                </Radio>
              ))}
            </Radio.Group>
          ) : null}

          {showSubType ? (
            <Select
              size="small"
              style={{ minWidth: 128 }}
              value={subType}
              onChange={handleSubTypeChange}
              disabled={disabled}
            >
              {subTypeOptions.map((option) => (
                <Select.Option key={option} value={option}>
                  {getSubTypeLabel(option)}
                </Select.Option>
              ))}
            </Select>
          ) : null}
        </Space>
      ) : null}

      <Select
        mode={mode === 'multiple' ? 'multiple' : undefined}
        value={selectValue}
        onChange={handleSelectChange}
        options={selectOptions}
        showSearch
        allowClear={allowClear}
        disabled={isDisabled}
        placeholder={placeholder}
        loading={optionsState === 'loading'}
        size={size}
        maxTagCount={mode === 'multiple' ? 3 : undefined}
        filterOption={(inputValue, option) => {
          const optionData = option as { value?: unknown; label?: unknown } | undefined;
          const searchText = `${String(optionData?.value ?? '')} ${String(optionData?.label ?? '')}`.toLowerCase();
          return searchText.includes(inputValue.trim().toLowerCase());
        }}
      />

      {optionsError ? (
        <Form.Item style={{ marginTop: 6, marginBottom: 0 }}>
          <Typography.Text type="error" style={{ fontSize: 12 }}>
            属性列表加载失败：{optionsError}
          </Typography.Text>
        </Form.Item>
      ) : showMetaText && (helperText !== undefined || optionsState === 'ready') ? (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
          {helperText !== undefined
            ? helperText
            : `属性来源：${source === 'provided' ? '当前上下文' : source === 'admin' ? 'Admin 实时数据' : '已发布 bundle'}`}
        </Typography.Text>
      ) : null}
    </div>
  );
}

function buildOptionLabel(definition: AttributeDefinition) {
  const labelParts = [definition.attrName?.trim(), definition.attrKey, definition.valueKind].filter(Boolean);
  return labelParts.join(' · ');
}

function getSubTypeLabel(subType: AttributeSubType) {
  switch (subType) {
    case 'base':
      return '基础值';
    case 'bonus':
      return '额外值';
    case 'current':
      return '当前值';
    case 'max':
      return '最大值';
    case 'total':
    default:
      return '总值';
  }
}
