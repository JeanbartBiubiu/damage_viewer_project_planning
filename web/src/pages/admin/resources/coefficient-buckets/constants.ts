import type { CoefficientBucketsFormData, CoefficientBucketsSearchData } from './types';

export const COEFFICIENT_BUCKET_RESOLUTION_DOMAIN_OPTIONS = [
  { label: '属性', value: 'attribute' },
  { label: '生命变化', value: 'hp_change' }
];

export const COEFFICIENT_BUCKET_AGGREGATION_MODE_OPTIONS = [
  { label: '累加', value: 'add' },
  { label: '相乘', value: 'multiply' },
  { label: '取最大', value: 'pick_max' },
  { label: '直接设定', value: 'set_final' }
];

export function createCoefficientBucketsSearchData(): CoefficientBucketsSearchData {
  return {
    bucketKey: '',
    resolutionDomain: '',
    stageKey: '',
    aggregationMode: ''
  };
}

export function createCoefficientBucketsFormData(): CoefficientBucketsFormData {
  return {
    bucketKey: '',
    resolutionDomain: 'attribute',
    stageKey: '',
    targetAttrKey: '',
    aggregationMode: 'add',
    description: '',
    editorHintText: '{\n  \n}',
    bucketConfigText: '{\n  \n}'
  };
}
