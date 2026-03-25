import { Button, Form, Input, Space } from '@arco-design/web-react';
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
      <Form.Item label="typeId">
        <Input value={searchData.typeId} onChange={(value) => onFieldChange('typeId', value)} placeholder="请输入 typeId" />
      </Form.Item>
      <Form.Item label="targetCategory">
        <Input
          value={searchData.targetCategory}
          onChange={(value) => onFieldChange('targetCategory', value)}
          placeholder="请输入 targetCategory"
        />
      </Form.Item>
      <Form.Item label="targetId">
        <Input value={searchData.targetId} onChange={(value) => onFieldChange('targetId', value)} placeholder="请输入 targetId" />
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
