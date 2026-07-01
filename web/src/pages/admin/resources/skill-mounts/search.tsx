import { Button, Form, Input, Select, Space } from '@arco-design/web-react';
import { SKILL_MOUNT_TARGET_CATEGORY_OPTIONS } from './constants';
import type { SkillMountsSearchData } from './types';

type SkillMountsSearchProps = {
  searchData: SkillMountsSearchData;
  onFieldChange: <K extends keyof SkillMountsSearchData>(field: K, value: SkillMountsSearchData[K]) => void;
  onSearch: () => void;
  onReset: () => void;
};

export function SkillMountsSearch({ searchData, onFieldChange, onSearch, onReset }: SkillMountsSearchProps) {
  return (
    <Form layout="inline" className="crud-search-form">
      <Form.Item label="目标分类">
        <Select
          allowClear
          value={searchData.targetCategory || undefined}
          onChange={(value) => onFieldChange('targetCategory', value ?? '')}
          placeholder="全部"
          options={SKILL_MOUNT_TARGET_CATEGORY_OPTIONS}
          style={{ width: 180 }}
        />
      </Form.Item>
      <Form.Item label="目标 ID">
        <Input value={searchData.targetId} onChange={(value) => onFieldChange('targetId', value)} placeholder="请输入目标 ID" />
      </Form.Item>
      <Form.Item label="技能 ID">
        <Input value={searchData.skillId} onChange={(value) => onFieldChange('skillId', value)} placeholder="请输入技能 ID" />
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
