import type { TypeRelation } from '../../../../types/api';

export type TypeRelationsRecord = TypeRelation;

export type TypeRelationsSearchData = {
  typeId: string;
  targetCategory: string;
  targetId: string;
};

export type TypeRelationsFormData = {
  typeId: string;
  targetCategory: string;
  targetId: string;
  extendText: string;
};
