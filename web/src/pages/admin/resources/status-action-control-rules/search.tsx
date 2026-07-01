import { Button, Form, Input, Select, Space } from '@arco-design/web-react';
import { STATUS_ACTION_CONTROL_RULE_KIND_OPTIONS } from './constants';
import type { StatusActionControlRulesSearchData } from './types';

type StatusActionControlRulesSearchProps = {
  searchData: StatusActionControlRulesSearchData;
  onFieldChange: <K extends keyof StatusActionControlRulesSearchData>(
    field: K,
    value: StatusActionControlRulesSearchData[K]
  ) => void;
  onSearch: () => void;
  onReset: () => void;
};

export function StatusActionControlRulesSearch({
  searchData,
  onFieldChange,
  onSearch,
  onReset
}: StatusActionControlRulesSearchProps) {
  return (
    <Form layout="inline" className="crud-search-form">
      <Form.Item label="规则 ID">
        <Input value={searchData.ruleId} onChange={(value) => onFieldChange('ruleId', value)} placeholder="请输入规则 ID" />
      </Form.Item>
      <Form.Item label="状态类型 ID">
        <Input
          value={searchData.statusTypeId}
          onChange={(value) => onFieldChange('statusTypeId', value)}
          placeholder="请输入状态类型 ID"
        />
      </Form.Item>
      <Form.Item label="规则类型">
        <Select
          allowClear
          value={searchData.ruleKind || undefined}
          onChange={(value) => onFieldChange('ruleKind', value ?? '')}
          placeholder="全部"
          options={STATUS_ACTION_CONTROL_RULE_KIND_OPTIONS}
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
