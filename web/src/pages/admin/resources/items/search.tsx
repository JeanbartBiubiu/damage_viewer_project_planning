import { Button, Form, Input, Space } from '@arco-design/web-react';
import type { ItemsSearchData } from './types';

type ItemsSearchProps = {
  searchData: ItemsSearchData;
  onFieldChange: <K extends keyof ItemsSearchData>(field: K, value: ItemsSearchData[K]) => void;
  onSearch: () => void;
  onReset: () => void;
};

export function ItemsSearch({ searchData, onFieldChange, onSearch, onReset }: ItemsSearchProps) {
  return (
    <Form layout="inline" className="crud-search-form">
      <Form.Item label="itemId">
        <Input value={searchData.itemId} onChange={(value) => onFieldChange('itemId', value)} placeholder="请输入 itemId" />
      </Form.Item>
      <Form.Item label="名称">
        <Input value={searchData.name} onChange={(value) => onFieldChange('name', value)} placeholder="请输入名称" />
      </Form.Item>
      <Form.Item label="goldCost">
        <Input value={searchData.goldCost} onChange={(value) => onFieldChange('goldCost', value)} placeholder="请输入 goldCost" />
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
