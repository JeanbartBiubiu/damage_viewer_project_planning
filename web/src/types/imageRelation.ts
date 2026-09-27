export type ImageRelationTarget = {
  kind: 'game' | 'character' | 'attribute' | 'equipment' | 'skill' | 'skillEffect' | 'status' | 'buildOption' | 'buildGroup';
  key: string;
  name: string;
  skillKey?: string;
  systemKey?: string;
};

export type RepresentativeImage = { imageKey: string; name: string; enabled: boolean };
export type RepresentativeImageResponse = { image: RepresentativeImage | null };
export type ImageOption = { imageKey: string; name: string };
export type ImageOptionsResponse = { items: ImageOption[]; total: number };
export type ImageSourceStatus = 'ENABLED' | 'DISABLED';

export type ImageUsages = {
  imageKey: string;
  games: Array<{ gameId: string; gameName: string }>;
  characters: Array<{ characterKey: string; characterName: string }>;
  attributes: Array<{ attributeKey: string; attributeName: string; attributeStatus: ImageSourceStatus }>;
  equipment: Array<{ equipmentKey: string; equipmentName: string }>;
  buildOptions: Array<{ systemKey: string; optionKey: string; optionName: string }>;
  buildGroups: Array<{ systemKey: string; groupKey: string; groupName: string }>;
  skills: Array<{ skillKey: string; skillName: string; skillStatus: ImageSourceStatus }>;
  skillEffects: Array<{ skillKey: string; skillName: string; effectKey: string; effectName: string }>;
  statuses: Array<{ statusKey: string; statusName: string; statusStatus: ImageSourceStatus }>;
};
