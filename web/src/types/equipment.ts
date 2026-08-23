export type Equipment = {
  gameId: string;
  equipmentKey: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EquipmentListResponse = {
  items: Equipment[];
  total: number;
};

export type EquipmentListQuery = {
  keyword?: string;
};

export type CreateEquipmentRequest = {
  equipmentKey: string;
  name: string;
  description: string | null;
};

export type UpdateEquipmentRequest = {
  name: string;
  description: string | null;
};

export type EquipmentAttributeValues = Record<string, number>;

export type EquipmentAttributes = {
  equipmentKey: string;
  attributeValues: EquipmentAttributeValues;
};

export type UpdateEquipmentAttributesRequest = {
  attributeValues: EquipmentAttributeValues;
};

export type EquipmentFieldIssue = {
  field: string;
  code: string;
  message: string;
};
