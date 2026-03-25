import type { CoefficientBucket } from '../../../../types/api';

export type CoefficientBucketsRecord = CoefficientBucket;

export type CoefficientBucketsSearchData = {
  bucketKey: string;
  resolutionDomain: string;
  stageKey: string;
  aggregationMode: string;
};

export type CoefficientBucketsFormData = {
  bucketKey: string;
  resolutionDomain: string;
  stageKey: string;
  targetAttrKey: string;
  aggregationMode: string;
  description: string;
  editorHintText: string;
  bucketConfigText: string;
};
