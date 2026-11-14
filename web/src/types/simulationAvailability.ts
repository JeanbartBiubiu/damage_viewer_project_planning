export type SimulationAvailabilityStatus = 'READY' | 'CONFIGURATION_INCOMPLETE' | 'ENGINE_UNSUPPORTED'
  | 'UNVERIFIED' | 'OUT_OF_SCOPE';

export type SimulationAvailabilityIssue = {
  code: string;
  skillKey: string | null;
  fieldPath: string | null;
  message: string;
};

export type SimulationAvailabilityRequiredCoverage = {
  scenario: 'one-way-combat-analysis-v1';
  sides: ['source', 'target'];
  /** 当前配置准入的合法范围；实际验证样本由正式证明及其证据维护。 */
  characterLevels: number[];
  skills: { skillKey: string; levels: number[] }[];
  levelValidation: 'representative-cases';
  allRequiredSourcesEnabled: true;
  sourceActiveStartedAndCompleted: true;
  relevantPassivesTriggered: true;
  equipmentMode: 'none' | 'single-item';
};

export type SimulationAvailabilityVerification = {
  wasmSha256: string;
  adapterVersion: string;
  externalDigest: string;
  requiredCoverage: SimulationAvailabilityRequiredCoverage | null;
  matched: boolean;
  evidenceRefs: string[];
};

export type SimulationAvailabilityEntry = {
  key: string;
  status: SimulationAvailabilityStatus;
  contentDigest: string;
  issues: SimulationAvailabilityIssue[];
  excludedSkillSources: { skillKey: string; reason: string }[];
  verification: SimulationAvailabilityVerification;
};

export type SimulationAvailabilityResponse = {
  gameId: string;
  profile: 'combat-analysis-v1';
  digestVersion: 'simulation-availability-v1';
  scopeDigest: string;
  sharedDigest: string;
  characters: SimulationAvailabilityEntry[];
  equipment: SimulationAvailabilityEntry[];
};
