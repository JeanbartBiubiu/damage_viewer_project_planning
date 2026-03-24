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
};

export type CurrentVersion = {
  gameId: string;
  versionId: number;
  versionCode: string;
  dataHash: string;
  updatedAt: string;
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
  statsModifier?: JsonObject;
  skillRefs?: string[];
  recipeIds?: string[];
  [key: string]: unknown;
};

export type Skill = {
  skillId: string;
  ownerType: string;
  ownerId: string;
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

export type VersionCreatePayload = {
  versionCode: string;
  releaseDate?: string;
};

export type VersionCreateResponse = {
  gameId: string;
  versionId: number;
  versionCode: string;
};

export type VersionPublishResponse = {
  gameId: string;
  versionId: number;
  versionCode: string;
  dataHash: string;
};

export type BundleMeta = {
  gameId: string;
  versionId: number;
  versionCode: string;
  dataHash: string;
  generatedAt: string;
};

export type GameDataBundle = {
  meta: BundleMeta;
  attributeDefinitions: AttributeDefinition[];
  coefficientBuckets: CoefficientBucket[];
  types: TypeDefinition[];
  typeRelations: TypeRelation[];
  statusActionControlRules: StatusActionControlRule[];
  heroes: Hero[];
  skills: Skill[];
  items: Item[];
  formulaProfiles?: FormulaProfile[];
  formulaBindings?: FormulaBinding[];
  dictionaries?: JsonObject;
};

export type FormulaProfilesResponse = {
  gameId: string;
  formulaProfiles: FormulaProfile[];
};

export type FormulaBindingsResponse = {
  gameId: string;
  formulaBindings: FormulaBinding[];
};

export type CoefficientBucketsResponse = {
  gameId: string;
  coefficientBuckets: CoefficientBucket[];
};

export type StatusActionControlRulesResponse = {
  gameId: string;
  statusActionControlRules: StatusActionControlRule[];
};
