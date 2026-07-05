import { Button, Form, Input, Space } from '@arco-design/web-react';
import { TypeFilter } from '../../../../components/TypeFilter';
import type { TypeDefinition } from '../../../../types/api';
import type { HeroesSearchData } from './types';

type HeroesSearchProps = {
  typeDefinitions: TypeDefinition[];
  searchData: HeroesSearchData;
  onFieldChange: <K extends keyof HeroesSearchData>(field: K, value: HeroesSearchData[K]) => void;
  onSearch: () => void;
  onReset: () => void;
};

export function HeroesSearch({ typeDefinitions, searchData, onFieldChange, onSearch, onReset }: HeroesSearchProps) {
  return (
    <Form layout="inline" className="crud-search-form">
      <Form.Item label="英雄 ID">
        <Input value={searchData.heroId} onChange={(value) => onFieldChange('heroId', value)} onPressEnter={onSearch} placeholder="请输入英雄 ID" />
      </Form.Item>
      <Form.Item label="名称">
        <Input value={searchData.name} onChange={(value) => onFieldChange('name', value)} onPressEnter={onSearch} placeholder="请输入名称" />
      </Form.Item>
      <Form.Item label="称号">
        <Input value={searchData.title} onChange={(value) => onFieldChange('title', value)} onPressEnter={onSearch} placeholder="请输入称号" />
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
