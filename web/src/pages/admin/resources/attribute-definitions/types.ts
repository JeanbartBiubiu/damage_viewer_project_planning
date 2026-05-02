import type { AttributeDefinition } from '../../../../types/api';

export type AttributeDefinitionsRecord = AttributeDefinition;

export type AttributeDefinitionsSearchData = {
  attrKey: string;
  attrName: string;
  attrType: string;
  valueKind: string;
};

export type AttributeDefinitionsFormData = {
  attrKey: string;
  attrName: string;
  attrType: string;
  defaultValue: string;
  order: string;
  valueKind: string;
  rateTargetAttrKey: string;
};
