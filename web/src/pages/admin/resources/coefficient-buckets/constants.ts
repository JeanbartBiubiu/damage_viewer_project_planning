import type { CoefficientBucketsFormData, CoefficientBucketsSearchData } from './types';

export const COEFFICIENT_BUCKET_RESOLUTION_DOMAIN_OPTIONS = [
  { label: 'attribute', value: 'attribute' },
  { label: 'damage', value: 'damage' },
  { label: 'global', value: 'global' }
];

export const COEFFICIENT_BUCKET_AGGREGATION_MODE_OPTIONS = [
  { label: 'add', value: 'add' },
  { label: 'multiply', value: 'multiply' },
  { label: 'max', value: 'max' },
  { label: 'min', value: 'min' }
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
