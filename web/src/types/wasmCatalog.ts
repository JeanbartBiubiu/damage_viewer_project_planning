import type {
  AbilityDefinition,
  AttributeSlot,
  CompileSettings,
  EmptyP0Rules,
  NamedFormula,
  ProviderDefinition,
  ResourceSlot,
  TypeCatalog
} from './genericEngine';

export type WasmCatalogSchemaVersion = 'generic-p0';

export type WasmCatalogMeta = {
  gameId: string;
  versionCode: string;
  publishedAt: string;
  generatedAt: string;
  schemaVersion: WasmCatalogSchemaVersion;
  schemaHash: `sha256:${string}` | string;
  rulesHash: `sha256:${string}` | string;
};

export type CombatantProviderMount = {
  providerRef: string;
  definitionRef: string;
  initialState?: Record<string, unknown>;
  initialAbilityState?: Record<string, unknown>;
};

export type CombatantTemplate = {
  templateKey: string;
  displayName?: string;
  types?: string[];
  tags?: string[];
  attributes: Record<string, AttributeSlot>;
  resources: Record<string, ResourceSlot>;
  providers: CombatantProviderMount[];
};

export type WasmCatalogV1 = {
  meta: WasmCatalogMeta;
  typeCatalog: TypeCatalog;
  combatantTemplates: CombatantTemplate[];
  sharedProviders: ProviderDefinition[];
  rules: EmptyP0Rules;
  formulas: NamedFormula[];
  settings: CompileSettings;
};

export type GenericScenarioSelection = {
  sourceTemplateKey: string;
  targetTemplateKey: string;
};

export type AttributeOverride = {
  base?: number;
  current?: number;
  max?: number;
};

export type ResourceOverride = {
  current?: number;
  max?: number;
};

export type CombatantNumericOverrides = {
  attributes?: Record<string, AttributeOverride>;
  resources?: Record<string, ResourceOverride>;
};

export type GenericScenarioOverrides = {
  source?: CombatantNumericOverrides;
  target?: CombatantNumericOverrides;
};

export type GenericAbilityOption = {
  abilityKey: string;
  abilityRef: string;
  providerRef: string;
  definitionRef: string;
  providerKey: string;
  displayName: string;
  kind: AbilityDefinition['kind'];
  selectable: boolean;
};
