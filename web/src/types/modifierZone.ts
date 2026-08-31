export type ModifierZoneStatus = 'ENABLED' | 'DISABLED';
export type ModifierZoneDomain = 'ATTRIBUTE' | 'DAMAGE' | 'HEALING';
export type ModifierZoneCalculationMode = 'FLAT_ADD' | 'RATIO_ADD';
export type ModifierZoneApplicationStage =
  | 'ATTRIBUTE_FLAT'
  | 'ATTRIBUTE_PERCENT'
  | 'DAMAGE_PRE_DEFENSE'
  | 'DAMAGE_POST_DEFENSE'
  | 'HEALING_RESULT';

export type ModifierZone = {
  gameId: string;
  modifierZoneKey: string;
  name: string;
  domain: ModifierZoneDomain;
  calculationMode: ModifierZoneCalculationMode;
  applicationStage: ModifierZoneApplicationStage;
  description: string | null;
  status: ModifierZoneStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type ModifierZoneListResponse = { items: ModifierZone[]; total: number };

export type ModifierZoneListQuery = {
  keyword?: string;
  domain?: ModifierZoneDomain;
  status?: ModifierZoneStatus;
};

export type CreateModifierZoneRequest = {
  modifierZoneKey: string;
  name: string;
  domain: ModifierZoneDomain;
  calculationMode: ModifierZoneCalculationMode;
  applicationStage: ModifierZoneApplicationStage;
  description: string | null;
  status: ModifierZoneStatus;
  sortOrder: number;
};

export type UpdateModifierZoneRequest = Omit<CreateModifierZoneRequest, 'modifierZoneKey'>;
