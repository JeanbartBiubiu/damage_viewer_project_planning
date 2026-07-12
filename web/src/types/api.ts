export type LoadState = 'idle' | 'loading' | 'success' | 'error';

export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

export type JsonObject = {
  [key: string]: JsonValue | undefined;
};

export type ApiErrorResponse = {
  error?: {
    code?: string;
    message?: string;
    details?: JsonObject;
  };
};

export type GameSummary = {
  gameId: string;
  gameName: string;
  gameImgUrl?: string;
  progressionSchema?: GameProgressionSchema;
};

export type GameProgressionSchema = {
  progressionKind: 'LEVEL' | 'STAR' | string;
  stageMin: number;
  stageMax: number;
  stageLabel: string;
  requireAllStages: boolean;
};

export type CurrentVersion = {
  gameId: string;
  versionCode: string;
  releaseDate?: string;
  publishedAt?: string;
  updatedAt?: string;
  changeRevision?: number;
};

export type ImageAsset = {
  uri: string;
  imageBase64: string;
  updatedAt: string;
};

export type ImageCollectionResponse = {
  gameId: string;
  images: ImageAsset[];
};

export type VersionPublishPayload = {
  versionCode: string;
  releaseDate?: string;
};

export type VersionPublishResponse = {
  gameId: string;
  versionCode: string;
  releaseDate?: string;
  publishedAt?: string;
  updatedAt?: string;
  changeRevision?: number;
};
