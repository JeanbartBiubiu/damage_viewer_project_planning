import { Button, Form, Input, InputNumber, Select, Space } from '@arco-design/web-react';
import { TARGET_CATEGORY_OPTIONS } from './constants';
import type { TypeRelationsSearchData } from './types';

type TypeRelationsSearchProps = {
  searchData: TypeRelationsSearchData;
  onFieldChange: <K extends keyof TypeRelationsSearchData>(field: K, value: TypeRelationsSearchData[K]) => void;
  onSearch: () => void;
  onReset: () => void;
};

export function TypeRelationsSearch({ searchData, onFieldChange, onSearch, onReset }: TypeRelationsSearchProps) {
  return (
    <Form layout="inline" className="crud-search-form">
      <Form.Item label="类型 ID">
        <InputNumber
          value={searchData.typeId.trim() === '' ? undefined : Number(searchData.typeId)}
          min={0}
          onChange={(value) => onFieldChange('typeId', value !== undefined && value !== null ? String(value) : '')}
          placeholder="请输入类型 ID"
          style={{ width: 180 }}
        />
      </Form.Item>
      <Form.Item label="目标类别">
        <Select
          allowClear
          value={searchData.targetCategory || undefined}
          onChange={(value) => onFieldChange('targetCategory', value ?? '')}
          placeholder="请选择目标类别"
          options={TARGET_CATEGORY_OPTIONS}
          style={{ width: 180 }}
        />
      </Form.Item>
      <Form.Item label="目标 ID">
        <Input value={searchData.targetId} onChange={(value) => onFieldChange('targetId', value)} placeholder="请输入目标 ID" />
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
