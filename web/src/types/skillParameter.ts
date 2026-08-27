export type SkillParameterValueType = 'INTEGER' | 'DECIMAL';

export type SkillParameterValueMode =
  | 'FIXED'
  | 'SKILL_LEVEL'
  | 'CHARACTER_LEVEL'
  | 'RUNTIME_INPUT';

export type SkillParameter = {
  gameId: string;
  skillKey: string;
  parameterKey: string;
  name: string;
  valueType: SkillParameterValueType;
  valueMode: SkillParameterValueMode;
  fixedValue: number | null;
  levelValues: Record<string, number> | null;
  description: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateSkillParameterRequest = {
  parameterKey: string;
  name: string;
  valueType: SkillParameterValueType;
  valueMode: SkillParameterValueMode;
  fixedValue: number | null;
  levelValues: Record<string, number> | null;
  description: string | null;
  sortOrder: number;
};

export type UpdateSkillParameterRequest = Omit<CreateSkillParameterRequest, 'parameterKey'>;
