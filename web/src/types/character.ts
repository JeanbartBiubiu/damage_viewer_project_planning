export type Character = {
  gameId: string;
  characterKey: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CharacterListResponse = {
  items: Character[];
  total: number;
};

export type CharacterListQuery = {
  keyword?: string;
};

export type CreateCharacterRequest = {
  characterKey: string;
  name: string;
  description: string | null;
};

export type UpdateCharacterRequest = {
  name: string;
  description: string | null;
};

export type LevelConfig = {
  gameId: string;
  minLevel: number;
  maxLevel: number;
};

export type UpdateLevelConfigRequest = {
  minLevel: number;
  maxLevel: number;
};

export type CharacterLevelValues = Record<string, Record<string, number>>;

export type CharacterAttributes = {
  characterKey: string;
  minLevel: number;
  maxLevel: number;
  levelValues: CharacterLevelValues;
};

export type UpdateCharacterAttributesRequest = {
  levelValues: CharacterLevelValues;
};

export type CharacterFieldIssue = {
  field: string;
  code: string;
  message: string;
};
