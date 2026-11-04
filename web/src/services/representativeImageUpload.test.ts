import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, getErrorMessage, type ApiResult } from './apiClient';
import { createImage, getImage, updateImage } from './imageClient';
import { upsertManagedImage } from './imageCache';
import { setRepresentativeImageVerified } from './imageRelationClient';
import { createRepresentativeImageUploadDraft, RepresentativeImageUploadFailure, uploadAndUseRepresentativeImage, type RepresentativeImageUploadContext, type RepresentativeImageUploadDraft } from './representativeImageUpload';
import type { ManagedImage } from '../types/image';
import type { PreparedResourceImage } from './resourceImage';

vi.mock('./imageClient', () => ({ createImage: vi.fn(), getImage: vi.fn(), updateImage: vi.fn() }));
vi.mock('./imageCache', () => ({ upsertManagedImage: vi.fn() }));
vi.mock('./imageRelationClient', () => ({ setRepresentativeImageVerified: vi.fn() }));

const PREPARED: PreparedResourceImage = { imageBase64: 'data:image/png;base64,AQID', mimeType: 'image/png', byteSize: 3, width: 32, height: 32, sourceWidth: 32, sourceHeight: 32, transformed: false };
const CONTEXT: RepresentativeImageUploadContext = { apiBaseUrl: 'http://localhost:8080', gameId: 'game', target: { kind: 'skillEffect', key: 'effect', name: '技能效果', skillKey: 'parent-skill' } };

function result<T>(data: T): ApiResult<T> { return { data, status: 200, etag: null }; }
function managed(draft: RepresentativeImageUploadDraft): ManagedImage {
  return { gameId: CONTEXT.gameId, imageKey: draft.imageKey, name: draft.name, description: null, imageBase64: draft.prepared.imageBase64, mimeType: draft.prepared.mimeType, byteSize: draft.prepared.byteSize, width: draft.prepared.width, height: draft.prepared.height, enabled: true, createdAt: '2026-09-06T00:00:00Z', updatedAt: '2026-09-06T00:00:00Z' };
}

beforeEach(() => {
  vi.resetAllMocks();
  let sequence = 0;
  vi.stubGlobal('crypto', { randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}` });
  vi.mocked(upsertManagedImage).mockResolvedValue({ count: 1, enabledCount: 1, latestUpdate: null });
  vi.mocked(setRepresentativeImageVerified).mockImplementation(async (_base, _game, _target, imageKey) => result({ image: { imageKey, name: '代表图片', enabled: true } }));
});
afterEach(() => vi.unstubAllGlobals());

describe('automatic representative image upload', () => {
  it.each(['upload', 'relation'] as const)('已处理的401只显示全局登录提示，并保留%s阶段和文件状态', async phase => {
    const draft = createRepresentativeImageUploadDraft('角色', 'fixture.png', PREPARED);
    const error = new ApiRequestError('会话失效', 401, 'AUTH.INVALID_CREDENTIALS'); error.handledByLoginPrompt = true;
    if (phase === 'upload') vi.mocked(createImage).mockRejectedValue(error);
    else {
      vi.mocked(createImage).mockResolvedValue(result(managed(draft)));
      vi.mocked(setRepresentativeImageVerified).mockRejectedValue(error);
    }
    const failure = await uploadAndUseRepresentativeImage(CONTEXT, draft, () => true).catch(cause => cause as RepresentativeImageUploadFailure);
    expect(failure).toBeInstanceOf(RepresentativeImageUploadFailure);
    expect(failure).toMatchObject({ phase, originalError: error, handledByLoginPrompt: true });
    expect(getErrorMessage(failure)).toBe(''); expect(failure.draft.prepared).toBe(PREPARED);
    expect(failure.draft.uploaded?.imageKey ?? null).toBe(phase === 'relation' ? draft.imageKey : null);
    expect(createImage).toHaveBeenCalledTimes(1); expect(setRepresentativeImageVerified).toHaveBeenCalledTimes(phase === 'relation' ? 1 : 0);
    expect(getImage).not.toHaveBeenCalled(); expect(upsertManagedImage).not.toHaveBeenCalled();
  });
  it('generates different valid keys and unique names for repeated uploads to the same object', () => {
    const first = createRepresentativeImageUploadDraft('角色名称'.repeat(30), 'first.png', PREPARED);
    const second = createRepresentativeImageUploadDraft('角色名称'.repeat(30), 'second.png', PREPARED);
    expect(first.imageKey).toMatch(/^image_[0-9a-f-]{36}$/);
    expect(first.imageKey).not.toBe(second.imageKey);
    expect(first.name).not.toBe(second.name);
    expect(first.name.length).toBeLessThanOrEqual(100);
    expect(second.name.length).toBeLessThanOrEqual(100);
    expect(first.name).toContain('代表图片_');
    expect(first.prepared).toBe(PREPARED);
  });

  it('uploads once, assigns the exact effect and updates the game cache without changing a shared image', async () => {
    const draft = createRepresentativeImageUploadDraft('技能效果', 'portrait.png', PREPARED);
    const image = managed(draft);
    vi.mocked(createImage).mockResolvedValue(result(image));
    const saved = await uploadAndUseRepresentativeImage(CONTEXT, draft, () => true);
    expect(createImage).toHaveBeenCalledWith(CONTEXT.apiBaseUrl, CONTEXT.gameId, { imageKey: draft.imageKey, name: draft.name, description: null, imageBase64: PREPARED.imageBase64 });
    expect(setRepresentativeImageVerified).toHaveBeenCalledWith(CONTEXT.apiBaseUrl, CONTEXT.gameId, CONTEXT.target, draft.imageKey);
    expect(upsertManagedImage).toHaveBeenCalledWith(image);
    expect(saved?.image.imageKey).toBe(draft.imageKey);
    expect(saved?.cacheWarning).toBeNull();
    expect(updateImage).not.toHaveBeenCalled();
  });

  it('retains a failed upload draft and retries with the same key and name', async () => {
    const draft = createRepresentativeImageUploadDraft('角色', 'portrait.png', PREPARED);
    vi.mocked(createImage).mockRejectedValueOnce(new ApiRequestError('图片内容校验失败', 400, '400.VALIDATION_FAILED')).mockResolvedValueOnce(result(managed(draft)));
    const failed = await uploadAndUseRepresentativeImage(CONTEXT, draft, () => true).catch((error) => error as RepresentativeImageUploadFailure);
    expect(failed).toBeInstanceOf(RepresentativeImageUploadFailure);
    expect(failed.draft).toMatchObject({ imageKey: draft.imageKey, name: draft.name, prepared: PREPARED, uploaded: null, uploadUncertain: false });
    expect(getImage).not.toHaveBeenCalled();
    await uploadAndUseRepresentativeImage(CONTEXT, failed.draft, () => true);
    expect(vi.mocked(createImage).mock.calls[0][3]).toEqual(vi.mocked(createImage).mock.calls[1][3]);
  });

  it.each([400, 404, 409])('keeps the uploaded image after relation HTTP %s and retries only the association', async (status) => {
    const draft = createRepresentativeImageUploadDraft('角色', 'portrait.png', PREPARED);
    const image = managed(draft);
    vi.mocked(createImage).mockResolvedValue(result(image));
    vi.mocked(setRepresentativeImageVerified).mockRejectedValueOnce(new ApiRequestError('设置失败', status, `${status}.VALIDATION_FAILED`));
    const failed = await uploadAndUseRepresentativeImage(CONTEXT, draft, () => true).catch((error) => error as RepresentativeImageUploadFailure);
    expect(failed).toBeInstanceOf(RepresentativeImageUploadFailure);
    expect(failed.phase).toBe('relation');
    expect(failed.message).toContain('图片已上传，尚未设为代表图片');
    expect(failed.draft.uploaded).toEqual(image);
    expect(upsertManagedImage).not.toHaveBeenCalled();
    await uploadAndUseRepresentativeImage(CONTEXT, failed.draft, () => true);
    expect(createImage).toHaveBeenCalledTimes(1);
    expect(setRepresentativeImageVerified).toHaveBeenCalledTimes(2);
    expect(getImage).not.toHaveBeenCalled();
  });

  it('recovers an ambiguous POST by reading the exact same key and matching image content', async () => {
    const draft = createRepresentativeImageUploadDraft('角色', 'portrait.png', PREPARED);
    vi.mocked(createImage).mockRejectedValue(new TypeError('Failed to fetch'));
    vi.mocked(getImage).mockResolvedValue(result(managed(draft)));
    const saved = await uploadAndUseRepresentativeImage(CONTEXT, draft, () => true);
    expect(getImage).toHaveBeenCalledWith(CONTEXT.apiBaseUrl, CONTEXT.gameId, draft.imageKey);
    expect(createImage).toHaveBeenCalledTimes(1);
    expect(saved?.image.imageKey).toBe(draft.imageKey);
  });

  it('retries uncertain recovery before considering another POST', async () => {
    const draft = createRepresentativeImageUploadDraft('角色', 'portrait.png', PREPARED);
    vi.mocked(createImage).mockRejectedValue(new TypeError('Failed to fetch'));
    vi.mocked(getImage).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(result(managed(draft)));
    const failed = await uploadAndUseRepresentativeImage(CONTEXT, draft, () => true).catch((error) => error as RepresentativeImageUploadFailure);
    expect(failed.draft.uploadUncertain).toBe(true);
    await uploadAndUseRepresentativeImage(CONTEXT, failed.draft, () => true);
    expect(createImage).toHaveBeenCalledTimes(1);
    expect(getImage).toHaveBeenCalledTimes(2);
  });

  it('permits retrying the same POST only after recovery confirms that key is absent', async () => {
    const draft = createRepresentativeImageUploadDraft('角色', 'portrait.png', PREPARED);
    vi.mocked(createImage).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(result(managed(draft)));
    vi.mocked(getImage).mockRejectedValue(new ApiRequestError('图片不存在', 404, '404.IMAGE_NOT_FOUND'));
    const failed = await uploadAndUseRepresentativeImage(CONTEXT, draft, () => true).catch((error) => error as RepresentativeImageUploadFailure);
    expect(failed.draft.uploadUncertain).toBe(false);
    await uploadAndUseRepresentativeImage(CONTEXT, failed.draft, () => true);
    expect(createImage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createImage).mock.calls[0][3]).toEqual(vi.mocked(createImage).mock.calls[1][3]);
  });

  it('never associates a recovered record whose content differs from the file draft', async () => {
    const draft = createRepresentativeImageUploadDraft('角色', 'portrait.png', PREPARED);
    vi.mocked(createImage).mockRejectedValue(new TypeError('Failed to fetch'));
    vi.mocked(getImage).mockResolvedValue(result({ ...managed(draft), imageBase64: 'data:image/png;base64,BAUG' }));
    await expect(uploadAndUseRepresentativeImage(CONTEXT, draft, () => true)).rejects.toMatchObject({ phase: 'upload', originalError: { code: '409.UPLOADED_IMAGE_MISMATCH' } });
    expect(setRepresentativeImageVerified).not.toHaveBeenCalled();
  });

  it('retains the uploaded draft if the association response identifies another image', async () => {
    const draft = createRepresentativeImageUploadDraft('角色', 'portrait.png', PREPARED);
    vi.mocked(createImage).mockResolvedValue(result(managed(draft)));
    vi.mocked(setRepresentativeImageVerified).mockResolvedValue(result({ image: { imageKey: 'another', name: '另一图片', enabled: true } }));
    await expect(uploadAndUseRepresentativeImage(CONTEXT, draft, () => true)).rejects.toMatchObject({ phase: 'relation', draft: { uploaded: { imageKey: draft.imageKey } } });
    expect(upsertManagedImage).not.toHaveBeenCalled();
  });

  it('reports cache failure separately after a successful association and keeps a usable preview', async () => {
    const draft = createRepresentativeImageUploadDraft('角色', 'portrait.png', PREPARED);
    vi.mocked(createImage).mockResolvedValue(result(managed(draft)));
    vi.mocked(upsertManagedImage).mockRejectedValue(new Error('cache unavailable'));
    const saved = await uploadAndUseRepresentativeImage(CONTEXT, draft, () => true);
    expect(saved?.cacheWarning).toContain('代表图片已保存');
    expect(saved?.uploaded.imageBase64).toBe(PREPARED.imageBase64);
    expect(setRepresentativeImageVerified).toHaveBeenCalledTimes(1);
  });

  it('does not start an association when the upload completes after the context has changed', async () => {
    const draft = createRepresentativeImageUploadDraft('角色', 'portrait.png', PREPARED);
    let current = true;
    vi.mocked(createImage).mockImplementation(async () => { current = false; return result(managed(draft)); });
    expect(await uploadAndUseRepresentativeImage(CONTEXT, draft, () => current)).toBeNull();
    expect(setRepresentativeImageVerified).not.toHaveBeenCalled();
    expect(upsertManagedImage).not.toHaveBeenCalled();
  });

  it('suppresses cache work and completion after a late association result in a different context', async () => {
    const draft = createRepresentativeImageUploadDraft('角色', 'portrait.png', PREPARED);
    let current = true;
    vi.mocked(createImage).mockResolvedValue(result(managed(draft)));
    vi.mocked(setRepresentativeImageVerified).mockImplementation(async () => { current = false; return result({ image: { imageKey: draft.imageKey, name: draft.name, enabled: true } }); });
    expect(await uploadAndUseRepresentativeImage(CONTEXT, draft, () => current)).toBeNull();
    expect(upsertManagedImage).not.toHaveBeenCalled();
  });
});
