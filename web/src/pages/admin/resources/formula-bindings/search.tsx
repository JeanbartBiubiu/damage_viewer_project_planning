import { Button, Form, Input, Select, Space } from '@arco-design/web-react';
import { FORMULA_BINDING_TARGET_CATEGORY_OPTIONS } from './constants';
import type { FormulaBindingsSearchData } from './types';

type FormulaBindingsSearchProps = {
  searchData: FormulaBindingsSearchData;
  onFieldChange: <K extends keyof FormulaBindingsSearchData>(field: K, value: FormulaBindingsSearchData[K]) => void;
  onSearch: () => void;
  onReset: () => void;
};

export function FormulaBindingsSearch({ searchData, onFieldChange, onSearch, onReset }: FormulaBindingsSearchProps) {
  return (
    <Form layout="inline" className="crud-search-form">
      <Form.Item label="目标分类">
        <Select
          allowClear
          value={searchData.targetCategory || undefined}
          onChange={(value) => onFieldChange('targetCategory', value ?? '')}
          placeholder="全部"
          style={{ width: 180 }}
        >
          {FORMULA_BINDING_TARGET_CATEGORY_OPTIONS.map((option) => (
            <Select.Option key={option.value} value={option.value}>
              {option.label}
            </Select.Option>
          ))}
        </Select>
      </Form.Item>
      <Form.Item label="目标 ID">
        <Input value={searchData.targetId} onChange={(value) => onFieldChange('targetId', value)} placeholder="请输入 targetId" />
      </Form.Item>
      <Form.Item label="bindingKey">
        <Input value={searchData.bindingKey} onChange={(value) => onFieldChange('bindingKey', value)} placeholder="请输入 bindingKey" />
      </Form.Item>
      <Form.Item label="公式 ID">
        <Input value={searchData.formulaId} onChange={(value) => onFieldChange('formulaId', value)} placeholder="请输入 formulaId" />
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
