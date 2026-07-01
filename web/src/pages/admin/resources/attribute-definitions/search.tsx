import { Button, Form, Input, Select, Space } from '@arco-design/web-react';
import { ATTRIBUTE_VALUE_KIND_OPTIONS } from './constants';
import type { AttributeDefinitionsSearchData } from './types';

const ATTRIBUTE_TYPE_OPTIONS = [
  { label: '全部', value: '' },
  { label: 'number', value: 'number' }
];

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
      <Form.Item label="属性 Key">
        <Input value={searchData.attrKey} onChange={(value) => onFieldChange('attrKey', value)} onPressEnter={onSearch} placeholder="请输入属性 Key" />
      </Form.Item>
      <Form.Item label="属性名称">
        <Input value={searchData.attrName} onChange={(value) => onFieldChange('attrName', value)} onPressEnter={onSearch} placeholder="请输入属性名称" />
      </Form.Item>
      <Form.Item label="属性类型">
        <Select
          allowClear
          value={searchData.attrType || undefined}
          onChange={(value) => onFieldChange('attrType', value ?? '')}
          placeholder="全部"
          options={ATTRIBUTE_TYPE_OPTIONS}
          style={{ width: 180 }}
        />
      </Form.Item>
      <Form.Item label="取值语义">
        <Select
          allowClear
          value={searchData.valueKind || undefined}
          onChange={(value) => onFieldChange('valueKind', value ?? '')}
          placeholder="全部"
          options={ATTRIBUTE_VALUE_KIND_OPTIONS}
          style={{ width: 180 }}
        />
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
