import { Button, Form, Input, InputNumber, Space } from '@arco-design/web-react';
import { TypeFilter } from '../../../../components/TypeFilter';
import type { TypeDefinition } from '../../../../types/api';
import type { ItemsSearchData } from './types';

type ItemsSearchProps = {
  typeDefinitions: TypeDefinition[];
  searchData: ItemsSearchData;
  onFieldChange: <K extends keyof ItemsSearchData>(field: K, value: ItemsSearchData[K]) => void;
  onSearch: () => void;
  onReset: () => void;
};

export function ItemsSearch({ typeDefinitions, searchData, onFieldChange, onSearch, onReset }: ItemsSearchProps) {
  const goldCostNumber = searchData.goldCost.trim() === '' ? undefined : Number(searchData.goldCost);

  return (
    <Form layout="inline" className="crud-search-form">
      <Form.Item label="装备 ID">
        <Input value={searchData.itemId} onChange={(value) => onFieldChange('itemId', value)} placeholder="请输入装备 ID" />
      </Form.Item>
      <Form.Item label="名称">
        <Input value={searchData.name} onChange={(value) => onFieldChange('name', value)} placeholder="请输入名称" />
      </Form.Item>
      <Form.Item label="金币成本">
        <InputNumber
          style={{ width: '100%' }}
          min={0}
          value={Number.isFinite(goldCostNumber) ? goldCostNumber : undefined}
          onChange={(value) => onFieldChange('goldCost', value === undefined || value === null ? '' : String(value))}
          placeholder="请输入金币成本"
        />
      </Form.Item>
      <Form.Item label="类型">
        <TypeFilter definitions={typeDefinitions} value={searchData.typeIds} onChange={(value) => onFieldChange('typeIds', value)} />
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
