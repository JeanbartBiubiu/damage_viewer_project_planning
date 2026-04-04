import type { TypeDefinition } from '../../../../types/api';

export type TypesRecord = TypeDefinition;

export type TypesSearchData = {
  typeId: string;
  name: string;
};

export type TypesFormData = {
  typeId: string;
  name: string;
  description: string;
  reservedTypeId: string;
  parentTypeIds: string[];
};
