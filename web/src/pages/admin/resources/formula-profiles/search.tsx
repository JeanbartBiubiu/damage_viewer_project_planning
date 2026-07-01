import { Button, Form, Input, Select, Space } from '@arco-design/web-react';
import { FORMULA_PROFILE_KIND_OPTIONS, FORMULA_PROFILE_TYPE_OPTIONS } from './constants';
import type { FormulaProfilesSearchData } from './types';

type FormulaProfilesSearchProps = {
  searchData: FormulaProfilesSearchData;
  onFieldChange: <K extends keyof FormulaProfilesSearchData>(field: K, value: FormulaProfilesSearchData[K]) => void;
  onSearch: () => void;
  onReset: () => void;
};

export function FormulaProfilesSearch({ searchData, onFieldChange, onSearch, onReset }: FormulaProfilesSearchProps) {
  return (
    <Form layout="inline" className="crud-search-form">
      <Form.Item label="公式 ID">
        <Input value={searchData.formulaId} onChange={(value) => onFieldChange('formulaId', value)} placeholder="请输入公式 ID" />
      </Form.Item>
      <Form.Item label="公式类型">
        <Select
          allowClear
          value={searchData.formulaType || undefined}
          onChange={(value) => onFieldChange('formulaType', value ?? '')}
          placeholder="全部"
          options={FORMULA_PROFILE_TYPE_OPTIONS}
          style={{ width: 180 }}
        />
      </Form.Item>
      <Form.Item label="公式种类">
        <Select
          allowClear
          value={searchData.formulaKind || undefined}
          onChange={(value) => onFieldChange('formulaKind', value ?? '')}
          placeholder="全部"
          options={FORMULA_PROFILE_KIND_OPTIONS}
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
