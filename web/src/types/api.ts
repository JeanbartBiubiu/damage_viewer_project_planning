export type LoadState = 'idle' | 'loading' | 'success' | 'error';

export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

export type JsonObject = {
  [key: string]: JsonValue | undefined;
};

export type ApiErrorResponse = {
  error?: {
    code?: string;
    message?: string;
    details?: JsonObject;
  };
};

export type GameSummary = {
  gameId: string;
  gameName: string;
  gameImgUrl?: string;
  progressionSchema?: GameProgressionSchema;
};

export type GameProgressionSchema = {
  progressionKind: 'LEVEL' | 'STAR';
  stageMin: number;
  stageMax: number;
  stageLabel: string;
  requireAllStages: boolean;
};

export type CurrentVersion = {
  gameId: string;
  versionCode: string;
  releaseDate?: string;
  publishedAt?: string;
  updatedAt: string;
  /** @deprecated 仅用于兼容未迁移页面。 */
  versionId: number;
  /** @deprecated 仅用于兼容未迁移页面。 */
  dataHash: string;
};

export type OwnerCategory = {
  ownerType: string;
  name?: string;
  description?: string;
  updatedAt: string;
};

export type ImageAsset = {
  uri: string;
  imageBase64: string;
  updatedAt: string;
};

export type ImageCollectionResponse = {
  gameId: string;
  images: ImageAsset[];
};

export type OwnerCategoryResponse = {
  gameId: string;
  ownerCategories: OwnerCategory[];
};

export type AttributeDefinition = {
  attrKey: string;
  attrName?: string;
  attrType?: string;
  defaultValue?: number;
  order?: number;
  sortOrder?: number;
  valueKind?: 'scalar' | 'ratio' | 'rate' | 'flag';
  rateTargetAttrKey?: string;
  [key: string]: unknown;
};

export type CoefficientBucket = {
  bucketKey: string;
  resolutionDomain: string;
  stageKey: string;
  targetAttrKey?: string;
  aggregationMode: string;
  provisional?: boolean;
  name?: string;
  description?: string;
  editorHint?: JsonObject;
  bucketConfig?: JsonObject;
  [key: string]: unknown;
};

export type TypeDefinition = {
  typeId: number;
  name?: string;
  description?: string;
  reservedTypeId?: number;
  [key: string]: unknown;
};

export type TypeRelation = {
  typeId: number;
  targetCategory: string;
  targetId: string;
  extend?: JsonObject;
  [key: string]: unknown;
};

export type StatusActionControlRule = {
  ruleId: string;
  statusTypeId: number;
  ruleKind: string;
  actionTypeIds: number[];
  actionMatchTypeIds: number[];
  interruptPhaseTypeIds: number[];
  priority?: number;
  description?: string;
  extend?: JsonObject;
  [key: string]: unknown;
};

export type StatusDefinition = {
  statusId: string;
  name?: string;
  description?: string;
  statusKind?: string;
  statusTypeId?: number;
  controlProfileId?: string;
  stackGroupKey?: string;
  sourceScope?: string;
  stackMode?: string;
  maxStacks?: number;
  maxInstances?: number;
  durationMode?: string;
  durationMs?: number;
  durationFormulaId?: string;
  defaultMagnitudeFormulaId?: string;
  snapshotPolicy?: string;
  isDispellable?: boolean;
  cleansePriority?: number;
  extend?: JsonObject;
  [key: string]: unknown;
};

export type ControlStateProfile = {
  controlProfileId: string;
  name?: string;
  description?: string;
  controlKind?: string;
  movementLockMode?: string;
  castLockMode?: string;
  attackLockMode?: string;
  inputOverrideMode?: string;
  displacementKind?: string;
  blocksControlInput?: boolean;
  grantsUnstoppable?: boolean;
  breaksOnDamage?: boolean;
  tenacityReducible?: boolean;
  priority?: number;
  extend?: JsonObject;
  [key: string]: unknown;
};

export type StatusModifierGroup = {
  statusId: string;
  groupKey: string;
  groupName?: string;
  phaseKey?: string;
  snapshotPolicy?: string;
  intervalMs?: number;
  maxTicks?: number;
  priority?: number;
  extend?: JsonObject;
  [key: string]: unknown;
};

export type StatusAttributeModifier = {
  statusId: string;
  groupKey: string;
  modifierId: string;
  attrKey?: string;
  modifierMode?: string;
  value?: number;
  formulaId?: string;
  bucketKey?: string;
  perStack?: boolean;
  priority?: number;
  extend?: JsonObject;
  [key: string]: unknown;
};

export type StatusPeriodicHpEffect = {
  statusId: string;
  groupKey: string;
  effectId: string;
  effectKind?: string;
  tickFormulaId?: string;
  damageType?: string;
  canCrit?: boolean;
  critChanceSource?: 'none' | 'attacker_crit_chance' | 'fixed';
  critChance?: number;
  critMultiplier?: number;
  affectedByHealModifier?: boolean;
  perStack?: boolean;
  extend?: JsonObject;
  [key: string]: unknown;
};

export type Hero = {
  heroId: string;
  name?: string;
  title?: string;
  avatarUrl?: string;
  baseStats?: Record<string, number>;
  statsByLevel?: JsonObject;
  [key: string]: unknown;
};

export type Item = {
  itemId: string;
  name?: string;
  goldCost?: number;
  iconUrl?: string;
  statModifiers: ItemStatModifier[];
  skillRefs?: string[];
  recipeIds?: string[];
  [key: string]: unknown;
};

export type ItemStatModifier = {
  attrKey: string;
  value: number;
};

export type Skill = {
  skillId: string;
  ownerType: string | null;
  ownerId: string | null;
  skillKey?: string;
  name?: string;
  description?: string;
  resourceCosts?: JsonValue[];
  cooldowns?: JsonValue[];
  params?: JsonObject;
  timingProfile?: JsonObject;
  mechanicsConfig?: JsonObject;
  [key: string]: unknown;
};

export type FormulaProfile = {
  formulaId: string;
  formulaType?: string;
  formulaKind?: string;
  params?: JsonObject;
  description?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

export type FormulaBinding = {
  targetCategory: string;
  targetId: string;
  bindingKey: string;
  formulaId: string;
  overrideParams?: JsonObject;
  updatedAt?: string;
  [key: string]: unknown;
};

export type SkillMount = {
  targetCategory: string;
  targetId: string;
  skillId: string;
  enabled: boolean;
  extend?: JsonObject;
  updatedAt?: string;
  [key: string]: unknown;
};

export type VersionPublishPayload = {
  versionCode: string;
  releaseDate?: string;
};

export type VersionPublishResponse = {
  gameId: string;
  versionCode: string;
  releaseDate?: string;
  publishedAt?: string;
  updatedAt: string;
  /** @deprecated 仅用于兼容未迁移页面。 */
  versionId: number;
  /** @deprecated 仅用于兼容未迁移页面。 */
  dataHash: string;
};

export type BundleMeta = {
  gameId: string;
  versionCode: string;
  releaseDate?: string;
  publishedAt?: string;
  generatedAt: string;
  /** @deprecated 仅用于兼容未迁移页面。 */
  versionId: number;
  /** @deprecated 仅用于兼容未迁移页面。 */
  dataHash: string;
};

export type GameDataBundle = {
  meta: BundleMeta;
  attributeDefinitions: AttributeDefinition[];
  coefficientBuckets: CoefficientBucket[];
  types: TypeDefinition[];
  typeRelations: TypeRelation[];
  statusActionControlRules: StatusActionControlRule[];
  statusDefinitions?: StatusDefinition[];
  controlStateProfiles?: ControlStateProfile[];
  statusModifierGroups?: StatusModifierGroup[];
  statusAttributeModifiers?: StatusAttributeModifier[];
  statusPeriodicHpEffects?: StatusPeriodicHpEffect[];
  heroes: Hero[];
  skills: Skill[];
  items: Item[];
  formulaProfiles?: FormulaProfile[];
  formulaBindings?: FormulaBinding[];
  skillMounts?: SkillMount[];
  dictionaries?: JsonObject;
  /** 编译后的 benchmark 数据，供 Wasm 引擎消费 */
  benchmark?: import('../engine/benchmarkTypes').BenchmarkBundle;
};

export type FormulaProfilesResponse = {
  gameId: string;
  formulaProfiles: FormulaProfile[];
};

export type HeroesResponse = {
  gameId: string;
  heroes: Hero[];
};

export type SkillsResponse = {
  gameId: string;
  skills: Skill[];
};

export type ItemsResponse = {
  gameId: string;
  items: Item[];
};

export type AttributeDefinitionsResponse = {
  gameId: string;
  attributeDefinitions: AttributeDefinition[];
};

export type TypesResponse = {
  gameId: string;
  types: TypeDefinition[];
};

export type TypeRelationsResponse = {
  gameId: string;
  typeRelations: TypeRelation[];
};

export type TypeRelationReplaceItem = {
  typeId: number;
  extend?: JsonObject;
};

export type TypeRelationReplacePayload = {
  relations: TypeRelationReplaceItem[];
};

export type TypeRelationsByTargetResponse = {
  gameId: string;
  targetCategory: string;
  targetId: string;
  typeRelations: TypeRelation[];
};

export type FormulaBindingsResponse = {
  gameId: string;
  formulaBindings: FormulaBinding[];
};

export type SkillMountsResponse = {
  gameId: string;
  skillMounts: SkillMount[];
};

export type CoefficientBucketsResponse = {
  gameId: string;
  coefficientBuckets: CoefficientBucket[];
};

export type StatusActionControlRulesResponse = {
  gameId: string;
  statusActionControlRules: StatusActionControlRule[];
};

export type StatusDefinitionsResponse = {
  gameId: string;
  statusDefinitions: StatusDefinition[];
};

export type ControlStateProfilesResponse = {
  gameId: string;
  controlStateProfiles: ControlStateProfile[];
};

export type StatusModifierGroupsResponse = {
  gameId: string;
  statusModifierGroups: StatusModifierGroup[];
};

export type StatusAttributeModifiersResponse = {
  gameId: string;
  statusAttributeModifiers: StatusAttributeModifier[];
};

export type StatusPeriodicHpEffectsResponse = {
  gameId: string;
  statusPeriodicHpEffects: StatusPeriodicHpEffect[];
};
