export type DamageTypeStatus = 'ENABLED' | 'DISABLED';

export type DamageType = {
  gameId: string;
  damageTypeKey: string;
  name: string;
  description: string | null;
  status: DamageTypeStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type DamageTypeListResponse = {
  items: DamageType[];
  total: number;
};

export type DamageTypeListQuery = {
  keyword?: string;
  status?: DamageTypeStatus;
};

export type CreateDamageTypeRequest = {
  damageTypeKey: string;
  name: string;
  description: string | null;
  status: DamageTypeStatus;
  sortOrder: number;
};

export type UpdateDamageTypeRequest = Omit<CreateDamageTypeRequest, 'damageTypeKey'>;
