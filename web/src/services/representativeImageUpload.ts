import { ApiRequestError, getErrorMessage } from './apiClient';
import { createImage, getImage } from './imageClient';
import { upsertManagedImage } from './imageCache';
import { setRepresentativeImage } from './imageRelationClient';
import type { PreparedResourceImage } from './resourceImage';
import type { ManagedImage } from '../types/image';
import type { ImageRelationTarget, RepresentativeImage } from '../types/imageRelation';

export type RepresentativeImageUploadDraft = {
  imageKey: string;
  name: string;
  fileName: string;
  prepared: PreparedResourceImage;
  uploaded: ManagedImage | null;
  uploadUncertain: boolean;
};

export type RepresentativeImageUploadContext = {
  apiBaseUrl: string;
  gameId: string;
  target: ImageRelationTarget;
  token: string;
};

export type RepresentativeImageUploadResult = {
  image: RepresentativeImage;
  uploaded: ManagedImage;
  cacheWarning: string | null;
};

export class RepresentativeImageUploadFailure extends Error {
  constructor(
    public draft: RepresentativeImageUploadDraft,
    public phase: 'upload' | 'relation',
    public originalError: unknown
  ) {
    super(phase === 'relation'
      ? `图片已上传，尚未设为代表图片，请点击“上传并使用”重试。${getErrorMessage(originalError)}`
      : `图片上传未完成，已保留所选文件，请重试。${getErrorMessage(originalError)}`);
    this.name = 'RepresentativeImageUploadFailure';
  }
}

export function createRepresentativeImageUploadDraft(targetName: string, fileName: string, prepared: PreparedResourceImage): RepresentativeImageUploadDraft {
  const id = crypto.randomUUID();
  const suffix = `代表图片_${id}`;
  const sourceName = targetName.trim() || '对象';
  // 名称在同游戏内唯一；完整随机后缀与本次文件草稿固定，替换不会撞上旧图片名称。
  const prefix = sourceName.slice(0, 100 - suffix.length).replace(/[\uD800-\uDBFF]$/, '');
  return { imageKey: `image_${id}`, name: `${prefix}${suffix}`, fileName, prepared, uploaded: null, uploadUncertain: false };
}

function matchesDraft(image: ManagedImage, gameId: string, draft: RepresentativeImageUploadDraft): boolean {
  return image.gameId === gameId && image.imageKey === draft.imageKey && image.name === draft.name
    && image.imageBase64 === draft.prepared.imageBase64 && image.mimeType === draft.prepared.mimeType
    && image.width === draft.prepared.width && image.height === draft.prepared.height
    && image.byteSize === draft.prepared.byteSize;
}

function assertMatchingImage(image: ManagedImage, gameId: string, draft: RepresentativeImageUploadDraft): void {
  if (!matchesDraft(image, gameId, draft)) {
    throw new ApiRequestError('读取到的图片与所选文件不一致，请重新选择文件。', 409, '409.UPLOADED_IMAGE_MISMATCH');
  }
}

function uncertainUpload(error: unknown): boolean {
  return !(error instanceof ApiRequestError) || error.status >= 500 || error.status === 409;
}

async function recoverImage(context: RepresentativeImageUploadContext, draft: RepresentativeImageUploadDraft): Promise<ManagedImage | null> {
  try {
    const result = await getImage(context.apiBaseUrl, context.gameId, draft.imageKey, context.token);
    assertMatchingImage(result.data, context.gameId, draft);
    return result.data;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404 && error.code === '404.IMAGE_NOT_FOUND') return null;
    throw error;
  }
}

export async function uploadAndUseRepresentativeImage(
  context: RepresentativeImageUploadContext,
  draft: RepresentativeImageUploadDraft,
  isCurrent: () => boolean
): Promise<RepresentativeImageUploadResult | null> {
  let next = { ...draft };
  if (!isCurrent()) return null;
  try {
    if (next.uploaded) assertMatchingImage(next.uploaded, context.gameId, next);
    if (!next.uploaded && next.uploadUncertain) {
      const recovered = await recoverImage(context, next);
      if (!isCurrent()) return null;
      next = { ...next, uploaded: recovered, uploadUncertain: false };
    }
    if (!next.uploaded) {
      next = { ...next, uploadUncertain: true };
      try {
        const result = await createImage(context.apiBaseUrl, context.gameId, context.token, {
          imageKey: next.imageKey, name: next.name, description: null, imageBase64: next.prepared.imageBase64
        });
        if (!isCurrent()) return null;
        assertMatchingImage(result.data, context.gameId, next);
        next = { ...next, uploaded: result.data, uploadUncertain: false };
      } catch (error) {
        if (!isCurrent()) return null;
        if (!uncertainUpload(error)) {
          next = { ...next, uploadUncertain: false };
          throw error;
        }
        const recovered = await recoverImage(context, next);
        if (!isCurrent()) return null;
        next = { ...next, uploaded: recovered, uploadUncertain: false };
        if (!recovered) throw error;
      }
    }
  } catch (error) {
    if (!isCurrent()) return null;
    throw new RepresentativeImageUploadFailure(next, 'upload', error);
  }
  if (!isCurrent() || !next.uploaded) return null;
  const uploaded = next.uploaded;
  let image: RepresentativeImage;
  try {
    const result = await setRepresentativeImage(context.apiBaseUrl, context.gameId, context.target, context.token, uploaded.imageKey);
    if (!isCurrent()) return null;
    if (!result.data.image || result.data.image.imageKey !== uploaded.imageKey) {
      throw new ApiRequestError('代表图片保存响应不完整，请重试。', 502, '502.IMAGE_RELATION_RESPONSE_INVALID');
    }
    image = result.data.image;
  } catch (error) {
    if (!isCurrent()) return null;
    throw new RepresentativeImageUploadFailure(next, 'relation', error);
  }
  let cacheWarning: string | null = null;
  const savedImage = { ...uploaded, enabled: image.enabled };
  try {
    await upsertManagedImage(savedImage);
  } catch {
    cacheWarning = '代表图片已保存，但本地图片缓存更新失败。当前预览仍可查看，稍后可在图片管理刷新缓存。';
  }
  if (!isCurrent()) return null;
  return { image, uploaded: savedImage, cacheWarning };
}
