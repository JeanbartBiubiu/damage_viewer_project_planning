import { Button, Form, Input, Select, Space } from '@arco-design/web-react';
import { ATTRIBUTE_VALUE_KIND_OPTIONS } from './constants';
import type { AttributeDefinitionsSearchData } from './types';

type AttributeDefinitionsSearchProps = {
  searchData: AttributeDefinitionsSearchData;
  onFieldChange: <K extends keyof AttributeDefinitionsSearchData>(field: K, value: AttributeDefinitionsSearchData[K]) => void;
  onSearch: () => void;
  onReset: () => void;
};

export function AttributeDefinitionsSearch({
  searchData,
  onFieldChange,
  onSearch,
  onReset
}: AttributeDefinitionsSearchProps) {
  return (
    <Form layout="inline" className="crud-search-form">
      <Form.Item label="attrKey">
        <Input value={searchData.attrKey} onChange={(value) => onFieldChange('attrKey', value)} placeholder="请输入 attrKey" />
      </Form.Item>
      <Form.Item label="属性名称">
        <Input value={searchData.attrName} onChange={(value) => onFieldChange('attrName', value)} placeholder="请输入属性名称" />
      </Form.Item>
      <Form.Item label="属性类型">
        <Input value={searchData.attrType} onChange={(value) => onFieldChange('attrType', value)} placeholder="请输入属性类型" />
      </Form.Item>
      <Form.Item label="valueKind">
        <Select
          allowClear
          value={searchData.valueKind || undefined}
          onChange={(value) => onFieldChange('valueKind', value ?? '')}
          placeholder="全部"
          style={{ width: 180 }}
        >
          {ATTRIBUTE_VALUE_KIND_OPTIONS.map((option) => (
            <Select.Option key={option.value} value={option.value}>
              {option.label}
            </Select.Option>
          ))}
        </Select>
      </Form.Item>
      <Form.Item>
        <Space>
          <Button type="primary" onClick={onSearch}>
            查询
          </Button>
          <Button onClick={onReset}>重置</Button>
        </Space>
      </Form.Item>
    </Form>
  );
}
