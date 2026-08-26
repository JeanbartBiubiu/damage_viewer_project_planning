export type SkillCategoryStatus = 'ENABLED' | 'DISABLED';

export type SkillCategory = {
  gameId: string;
  skillCategoryKey: string;
  name: string;
  description: string | null;
  status: SkillCategoryStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type SkillCategoryListResponse = {
  items: SkillCategory[];
  total: number;
};

export type SkillCategoryListQuery = {
  keyword?: string;
  status?: SkillCategoryStatus;
};

export type CreateSkillCategoryRequest = {
  skillCategoryKey: string;
  name: string;
  description: string | null;
  status: SkillCategoryStatus;
  sortOrder: number;
};

export type UpdateSkillCategoryRequest = Omit<CreateSkillCategoryRequest, 'skillCategoryKey'>;
