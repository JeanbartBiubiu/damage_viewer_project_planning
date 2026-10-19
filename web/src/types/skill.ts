export type SkillStatus = 'ENABLED' | 'DISABLED';

export type Skill = {
  gameId: string;
  skillKey: string;
  name: string;
  description: string | null;
  maxLevel: number;
  status: SkillStatus;
  sortOrder: number;
  skillCategoryKeys: string[];
  createdAt: string;
  updatedAt: string;
};

export type SkillListResponse = {
  items: Skill[];
  total: number;
};

export type SkillListQuery = {
  keyword?: string;
  status?: SkillStatus;
};

export type CreateSkillRequest = {
  skillKey: string;
  name: string;
  description: string | null;
  maxLevel: number;
  status: SkillStatus;
  sortOrder: number;
  skillCategoryKeys: string[];
};

export type UpdateSkillRequest = Omit<CreateSkillRequest, 'skillKey'>;
