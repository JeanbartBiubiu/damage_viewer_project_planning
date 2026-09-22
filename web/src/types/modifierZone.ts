export type ModifierZoneStatus = 'ENABLED' | 'DISABLED';
export type ModifierZoneDomain = 'ATTRIBUTE' | 'DAMAGE' | 'HEALING' | 'SHIELD';
export type ModifierZoneCalculationMode = 'FLAT_ADD' | 'RATIO_ADD' | 'RATIO_MAX';
export type ModifierZoneApplicationStage =
  | 'ATTRIBUTE_FLAT'
  | 'ATTRIBUTE_PERCENT'
  | 'DAMAGE_PRE_DEFENSE'
  | 'DAMAGE_POST_DEFENSE'
  | 'HEALING_RESULT'
  | 'SHIELD_RESULT';

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

export function allowedModifierZoneCalculationModes(
  domain: ModifierZoneDomain | ''
): ModifierZoneCalculationMode[] {
  if (domain === 'ATTRIBUTE') return ['FLAT_ADD', 'RATIO_ADD'];
  if (domain === 'HEALING') return ['RATIO_ADD', 'RATIO_MAX'];
  if (domain === 'DAMAGE' || domain === 'SHIELD') return ['RATIO_ADD'];
  return [];
}

export function allowedModifierZoneApplicationStages(
  domain: ModifierZoneDomain | '',
  mode: ModifierZoneCalculationMode | ''
): ModifierZoneApplicationStage[] {
  if (domain === 'ATTRIBUTE' && mode === 'FLAT_ADD') return ['ATTRIBUTE_FLAT'];
  if (domain === 'ATTRIBUTE' && mode === 'RATIO_ADD') return ['ATTRIBUTE_PERCENT'];
  if (domain === 'DAMAGE' && mode === 'RATIO_ADD') {
    return ['DAMAGE_PRE_DEFENSE', 'DAMAGE_POST_DEFENSE'];
  }
  if (domain === 'HEALING' && (mode === 'RATIO_ADD' || mode === 'RATIO_MAX')) return ['HEALING_RESULT'];
  if (domain === 'SHIELD' && mode === 'RATIO_ADD') return ['SHIELD_RESULT'];
  return [];
}

export function isLegalModifierZoneCombination(
  domain: ModifierZoneDomain | '',
  mode: ModifierZoneCalculationMode | '',
  stage: ModifierZoneApplicationStage | ''
): boolean {
  return domain !== '' && mode !== '' && stage !== ''
    && allowedModifierZoneApplicationStages(domain, mode).includes(stage);
}
