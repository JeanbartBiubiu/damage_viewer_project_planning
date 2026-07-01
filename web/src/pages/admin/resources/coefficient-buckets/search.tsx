import { Button, Form, Input, Select, Space } from '@arco-design/web-react';
import {
  COEFFICIENT_BUCKET_AGGREGATION_MODE_OPTIONS,
  COEFFICIENT_BUCKET_RESOLUTION_DOMAIN_OPTIONS
} from './constants';
import type { CoefficientBucketsSearchData } from './types';

type CoefficientBucketsSearchProps = {
  searchData: CoefficientBucketsSearchData;
  onFieldChange: <K extends keyof CoefficientBucketsSearchData>(field: K, value: CoefficientBucketsSearchData[K]) => void;
  onSearch: () => void;
  onReset: () => void;
};

export function CoefficientBucketsSearch({
  searchData,
  onFieldChange,
  onSearch,
  onReset
}: CoefficientBucketsSearchProps) {
  return (
    <Form layout="inline" className="crud-search-form">
      <Form.Item label="桶键">
        <Input value={searchData.bucketKey} onChange={(value) => onFieldChange('bucketKey', value)} placeholder="请输入桶键" />
      </Form.Item>
      <Form.Item label="作用域">
        <Select
          allowClear
          value={searchData.resolutionDomain || undefined}
          onChange={(value) => onFieldChange('resolutionDomain', value ?? '')}
          placeholder="全部"
          options={COEFFICIENT_BUCKET_RESOLUTION_DOMAIN_OPTIONS}
          style={{ width: 180 }}
        />
      </Form.Item>
      <Form.Item label="阶段键">
        <Input value={searchData.stageKey} onChange={(value) => onFieldChange('stageKey', value)} placeholder="请输入阶段键" />
      </Form.Item>
      <Form.Item label="聚合方式">
        <Select
          allowClear
          value={searchData.aggregationMode || undefined}
          onChange={(value) => onFieldChange('aggregationMode', value ?? '')}
          placeholder="全部"
          options={COEFFICIENT_BUCKET_AGGREGATION_MODE_OPTIONS}
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
