export type AuthoringCheckSkill = {
  skillKey: string;
  name: string | null;
  status: string | null;
  maxLevel: number | null;
  sortOrder: number;
  effectCount: number;
  processCount: number;
  triggerRuleCount: number;
};

export type AuthoringCheckReference = {
  sourceSkillKey: string;
  sourceType: string;
  sourceKey: string;
  fieldPath: string;
  targetType: string;
  targetSkillKey: string | null;
  targetKey: string;
  targetSubKey: string | null;
};

export type AuthoringCheckIssue = {
  code: string;
  severity: 'ERROR' | 'REVIEW';
  message: string;
  skillKey: string | null;
  objectType: string;
  objectKey: string;
  fieldPath: string;
};

export type CharacterAuthoringCheck = {
  gameId: string;
  characterKey: string;
  characterName: string;
  checkedAt: string;
  conclusions: { structure: 'NO_ERRORS' | 'HAS_ERRORS'; mechanics: 'NOT_CHECKED'; runtime: 'NOT_RUN' };
  summary: { attachedSkillCount: number; configuredAttributeCount: number; errorCount: number; reviewCount: number };
  skills: AuthoringCheckSkill[];
  references: AuthoringCheckReference[];
  issues: AuthoringCheckIssue[];
};
