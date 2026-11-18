import type { Attribute } from '../../types/attribute';
import type { BasicAttackPlan, CompileRequest, GenericRules, NamedFormula, ProviderDefinition, SkillHitCandidate } from '../../types/genericEngine';
import type { SkillConfiguration } from '../../types/skillConfiguration';
import type { SimulationSkillSource } from '../../types/simulationSnapshot';
import type { PermanentNumericConsumer } from '../simulationPermanentResults';
import type { changedAttributes } from '../simulationCalculationRules';
import type { BasicAttackContribution } from '../basicAttackContributionContract';
import type { BasicAttackCooldownReduction } from '../basicAttackCooldownReduction';
import type { PendingCommittedTotalRefund } from '../committedTotalCooldownRefund';

export type SimulationSourceSide = 'source' | 'target';
type Side = SimulationSourceSide;

export type SimulationCoverage = { authorPath: string; compiledPath: string; note?: string };
export type OperationOrigin = {
  abilityRef: string; operationRef: string; skillKey: string; effectKey: string; resultKey: string; compiledPaths: string[];
  providerDefinitionRef?: string;
};
export type BasicAttackBinding = Omit<BasicAttackPlan, 'planKey' | 'attackSpeedInputMax' | 'attackSpeedAttributeKey'> & { attackSpeedAttributeKey: string | null };
export type SimulationAttributeRequirement = {
  side: 'source' | 'target'; attribute: Attribute; storedValue: number | undefined
};

/** 来源准备交给通用编译的身份、执行配置及来源专属常驻贡献。 */
export type TriggeredSourceDescription = {
  side: Side;
  kind: 'item' | 'character' | 'build';
  stableId: string;
  providerRef: string;
  definitionRef: string;
  path: string;
  equipmentKey?: string;
  skills: Array<{
    skillKey: string;
    skillLevel: number;
    path: string;
    configuration: SkillConfiguration;
    allowedRootKeys?: readonly string[];
    sceneInitialValues?: Readonly<Record<string, number>>;
    permanentModifier?: (result: SkillConfiguration['effects'][number]['results'][number], path: string, onNumericConsumed?: PermanentNumericConsumer) =>
      NonNullable<ProviderDefinition['modifiers']>[number];
  }>;
};

/** 单次通用触发编译的完整结果；集合不跨调用共享。 */
export type TriggeredSourceAssembly = {
  providers: ProviderDefinition[];
  mounts: Array<{ side: Side; providerRef: string; definitionRef: string }>;
  types: CompileRequest['typeCatalog']['types'];
  formulas: NamedFormula[];
  rules: GenericRules;
  operationOrigins: OperationOrigin[];
  coverage: SimulationCoverage[];
  required: Record<Side, Set<string>>;
  selectedSkills: Set<string>;
  changedAttributes: ReturnType<typeof changedAttributes>;
  compiledSources: Array<{ side: Side; providerRef: string; definitionRef: string; skillKey: string }>;
  passiveHitContributions?: Array<{ sourceSkillKey: string; authorSkillKey: string; candidate: SkillHitCandidate;
    lowerings?: BasicAttackContribution['lowerings'] }>;
  basicAttackContributions?: BasicAttackContribution[];
  basicAttackCooldownReductions?: BasicAttackCooldownReduction[];
  committedTotalRefunds?: PendingCommittedTotalRefund[];
};

export type SimulationSkillOriginTrace = SimulationSkillSource & {
  side: Side; providerRef?: string; definitionRef?: string;
};
