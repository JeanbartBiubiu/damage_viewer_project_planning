import { Button, Form, Input, Space } from '@arco-design/web-react';
import type { TypesSearchData } from './types';

type TypesSearchProps = {
  searchData: TypesSearchData;
  onFieldChange: <K extends keyof TypesSearchData>(field: K, value: TypesSearchData[K]) => void;
  onSearch: () => void;
  onReset: () => void;
};

export function TypesSearch({ searchData, onFieldChange, onSearch, onReset }: TypesSearchProps) {
  return (
    <Form layout="inline" className="crud-search-form">
      <Form.Item label="typeId">
        <Input value={searchData.typeId} onChange={(value) => onFieldChange('typeId', value)} placeholder="请输入 typeId" />
      </Form.Item>
      <Form.Item label="名称">
        <Input value={searchData.name} onChange={(value) => onFieldChange('name', value)} placeholder="请输入名称" />
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
