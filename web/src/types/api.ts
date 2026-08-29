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
  gameImgUrl: string | null;
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
