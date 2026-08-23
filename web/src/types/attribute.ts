export type AttributeValueType = 'DECIMAL' | 'INTEGER';

export type AttributeStatus = 'ENABLED' | 'DISABLED';

export type Attribute = {
  gameId: string;
  attributeKey: string;
  name: string;
  valueType: AttributeValueType;
  minValue: number | null;
  maxValue: number | null;
  description: string | null;
  status: AttributeStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type AttributeListResponse = {
  items: Attribute[];
  total: number;
};

export type AttributeListQuery = {
  keyword?: string;
  status?: AttributeStatus;
};

export type CreateAttributeRequest = {
  attributeKey: string;
  name: string;
  valueType: AttributeValueType;
  minValue: number | null;
  maxValue: number | null;
  description: string | null;
  status: AttributeStatus;
  sortOrder: number;
};

export type UpdateAttributeRequest = Omit<CreateAttributeRequest, 'attributeKey'>;

export type AttributeFieldIssue = {
  field: string;
  code: string;
  message: string;
};
