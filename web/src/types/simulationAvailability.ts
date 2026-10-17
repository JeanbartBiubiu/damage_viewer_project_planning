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
  characterLevels: number[];
  skills: { skillKey: string; levels: number[] }[];
  levelValidation: 'each-declared-level';
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
