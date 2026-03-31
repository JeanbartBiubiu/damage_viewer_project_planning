import { Button, Form, Input, Space } from '@arco-design/web-react';
import { TypeFilter } from '../../../../components/TypeFilter';
import type { TypeDefinition } from '../../../../types/api';
import type { SkillsSearchData } from './types';

type SkillsSearchProps = {
  typeDefinitions: TypeDefinition[];
  searchData: SkillsSearchData;
  onFieldChange: <K extends keyof SkillsSearchData>(field: K, value: SkillsSearchData[K]) => void;
  onSearch: () => void;
  onReset: () => void;
};

export function SkillsSearch({ typeDefinitions, searchData, onFieldChange, onSearch, onReset }: SkillsSearchProps) {
  return (
    <Form layout="inline" className="crud-search-form">
      <Form.Item label="skillId">
        <Input value={searchData.skillId} onChange={(value) => onFieldChange('skillId', value)} placeholder="请输入 skillId" />
      </Form.Item>
      <Form.Item label="ownerType">
        <Input value={searchData.ownerType} onChange={(value) => onFieldChange('ownerType', value)} placeholder="请输入 ownerType" />
      </Form.Item>
      <Form.Item label="ownerId">
        <Input value={searchData.ownerId} onChange={(value) => onFieldChange('ownerId', value)} placeholder="请输入 ownerId" />
      </Form.Item>
      <Form.Item label="skillKey">
        <Input value={searchData.skillKey} onChange={(value) => onFieldChange('skillKey', value)} placeholder="请输入 skillKey" />
      </Form.Item>
      <Form.Item label="名称">
        <Input value={searchData.name} onChange={(value) => onFieldChange('name', value)} placeholder="请输入名称" />
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
