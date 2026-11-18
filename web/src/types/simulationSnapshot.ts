import type { Attribute } from './attribute';
import type { Character, CharacterAttributes, LevelConfig } from './character';
import type { DamageType } from './damageType';
import type { DamageTypeFormulaDetail } from './damageTypeFormula';
import type { GameVampRulesResponse } from './gameVamp';
import type { ModifierZone } from './modifierZone';
import type { SkillCategory } from './skillCategory';
import type { SkillConfiguration } from './skillConfiguration';
import type { CharacterSkillRelation, EquipmentSkillRelation } from './skillRelation';
import type { Equipment, EquipmentAttributes } from './equipment';
import type { GameStatus } from './status';
import type { BuildConfiguration, BuildDefinition } from './build';
import type { SkillStatus } from './skill';

export type { BuildConfiguration, BuildDefinition } from './build';

export type SimulationSkillOrigin =
  | { kind: 'CHARACTER'; characterKey: string }
  | { kind: 'EQUIPMENT'; equipmentKey: string }
  | { kind: 'BUILD_OPTION'; systemKey: string; roleKey: string; groupKey: string; slotKey: string; optionKey: string };

export type SimulationSkillSetting = {
  origin: SimulationSkillOrigin;
  skillKey: string;
  enabled: boolean;
  skillLevel?: number;
};

export type SimulationSkillInactiveReason = 'GLOBAL_DISABLED' | 'SCENE_DISABLED' | 'UNLEARNED'
  | 'NO_AUTONOMOUS_ATTACK' | 'ACTIVE_DEFERRED' | 'NO_REACHABLE_EVENT' | 'CONFIGURATION_INCOMPLETE' | 'LEVEL_REQUIRED';

export type SimulationSkillSource = {
  origin: SimulationSkillOrigin;
  skillKey: string;
  skillName: string;
  skillStatus: SkillStatus;
  enabled: boolean;
  skillLevel: number | null;
  enabledRuleKeys: string[];
  inactiveReason: SimulationSkillInactiveReason | null;
};

export type SimulationSelectedBuild = { definition: BuildDefinition; configuration: BuildConfiguration };

export type SimulationSkillPhase = 'INITIAL' | 'CHARGE_RELEASE' | 'RECAST' | 'CANCEL';

export type SimulationPlannedSkill = {
  origin: Extract<SimulationSkillOrigin, { kind: 'CHARACTER' }>;
  skillKey: string;
  skillLevel: number;
  phaseKinds: SimulationSkillPhase[];
};

export type SimulationSelection = {
  sourceCharacterKey: string;
  sourceLevel: number;
  targetCharacterKey: string;
  targetLevel: number;
  basicAttackSkillKey: string | null;
  basicAttackLevel: number | null;
  plannedSkills: SimulationPlannedSkill[];
  sourceEquipmentKeys: string[];
  targetEquipmentKeys: string[];
  sourceBuildConfigurations: BuildConfiguration[];
  targetBuildConfigurations: BuildConfiguration[];
  sourceSkillSettings: SimulationSkillSetting[];
  targetSkillSettings: SimulationSkillSetting[];
};

export type SimulationSelectedEquipment = {
  equipment: Equipment;
  attributes: EquipmentAttributes;
  attachedSkills: EquipmentSkillRelation[];
};

export type SimulationCombatant = {
  character: Character;
  attributes: CharacterAttributes;
  selectedLevelValues: Record<string, number>;
  attachedSkills: CharacterSkillRelation[];
  selectedEquipment: SimulationSelectedEquipment[];
  selectedBuilds: SimulationSelectedBuild[];
  skillSources: SimulationSkillSource[];
};

export type SimulationReference = {
  sourceSkillKey: string;
  sourceType: string;
  sourceKey: string;
  fieldPath: string;
  targetType: string;
  targetSkillKey: string;
  targetKey: string;
  targetSubKey: string;
};

export type SimulationSnapshot = {
  gameId: string;
  selection: SimulationSelection;
  source: SimulationCombatant;
  target: SimulationCombatant;
  skillConfigurations: SkillConfiguration[];
  /** 后端静态执行闭包；只读定义不授予维护候选覆盖。 */
  executionSkillKeys: string[];
  catalogs: {
    levelConfig: LevelConfig;
    attributes: Attribute[];
    skillCategories: SkillCategory[];
    damageTypes: Array<{ type: DamageType; formula: DamageTypeFormulaDetail }>;
    modifierZones: ModifierZone[];
    statuses: GameStatus[];
    vampRules: GameVampRulesResponse;
    calculationRules: import('./gameCalculationRules').GameCalculationRulesResponse;
  };
  references: SimulationReference[];
  snapshotDigest: string;
  readAt: string;
};

/** 只补本次场景需要且角色等级表未保存的属性；不写入角色或覆写固有值。 */
export type SimulationAttributeInputs = {
  source: Record<string, number>;
  target: Record<string, number>;
};

export type SimulationInitialHealth = { source: number; target: number };
/** 仅本场可达恢复资源的明确当前值；容量仍由真实角色等级属性与装备提供。 */
export type SimulationInitialResourceInput = { side: 'source' | 'target'; resourceKey: string; current: number };

export type SimulationMechanicStateInput = {
  side: 'source' | 'target'; origin: SimulationSkillOrigin; skillKey: string; stateKey: string; value: number;
};

export type SimulationEquipmentAssumption = {
  owner: 'source' | 'target'; equipmentKey: string; target: 'source' | 'target'; inRange: boolean;
};
