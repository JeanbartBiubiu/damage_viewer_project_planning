export type ManagedImage = {
  gameId: string;
  imageKey: string;
  name: string;
  description: string | null;
  imageBase64: string;
  mimeType: 'image/png' | 'image/jpeg';
  byteSize: number;
  width: number;
  height: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateImageRequest = {
  imageKey: string;
  name: string;
  description: string | null;
  imageBase64: string;
};

export type UpdateImageRequest = {
  name: string;
  description: string | null;
  enabled: boolean;
  imageBase64?: string;
};

export type PublicImage = {
  imageKey: string;
  enabled: boolean;
  imageBase64: string | null;
  updatedAt: string;
};

export type PublicImageListResponse = {
  gameId: string;
  images: PublicImage[];
};

export type ImageFieldIssue = {
  field: string;
  code: string;
  message: string;
};
