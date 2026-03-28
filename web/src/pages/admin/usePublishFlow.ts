import { useState } from 'react';
import { createVersion, getErrorMessage, publishVersion } from '../../services/apiClient';
import { loadPublishedBundleSnapshot } from '../../services/bundleSnapshot';
import type { CurrentVersion, GameDataBundle, LoadState, VersionCreateResponse, VersionPublishResponse } from '../../types/api';

type UsePublishFlowArgs = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onDataPublished?: () => void;
};

type UsePublishFlowResult = {
  versionCodeDraft: string;
  releaseDateDraft: string;
  publishVersionIdDraft: string;
  versionState: LoadState;
  versionError: string | null;
  versionSuccess: string | null;
  createdVersion: VersionCreateResponse | null;
  publishedVersion: VersionPublishResponse | null;
  publishedCurrentVersion: CurrentVersion | null;
  publishedBundleMeta: GameDataBundle['meta'] | null;
  setVersionCodeDraft: (value: string) => void;
  setReleaseDateDraft: (value: string) => void;
  setPublishVersionIdDraft: (value: string) => void;
  handleCreateVersion: () => Promise<void>;
  handlePublishVersion: () => Promise<void>;
};

export function usePublishFlow({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  onDataPublished
}: UsePublishFlowArgs): UsePublishFlowResult {
  const token = adminToken.trim();
  const [versionCodeDraft, setVersionCodeDraft] = useState('');
  const [releaseDateDraft, setReleaseDateDraft] = useState('');
  const [publishVersionIdDraft, setPublishVersionIdDraft] = useState('');
  const [versionState, setVersionState] = useState<LoadState>('idle');
  const [versionError, setVersionError] = useState<string | null>(null);
  const [versionSuccess, setVersionSuccess] = useState<string | null>(null);
  const [createdVersion, setCreatedVersion] = useState<VersionCreateResponse | null>(null);
  const [publishedVersion, setPublishedVersion] = useState<VersionPublishResponse | null>(null);
  const [publishedCurrentVersion, setPublishedCurrentVersion] = useState<CurrentVersion | null>(null);
  const [publishedBundleMeta, setPublishedBundleMeta] = useState<GameDataBundle['meta'] | null>(null);

  async function handleCreateVersion() {
    if (!selectedGameId || !token) {
      return;
    }

    setVersionState('loading');
    setVersionError(null);
    setVersionSuccess(null);

    try {
      const result = await createVersion(apiBaseUrl, selectedGameId, token, {
        versionCode: versionCodeDraft.trim(),
        releaseDate: releaseDateDraft.trim() || undefined
      });
      setCreatedVersion(result.data);
      setPublishVersionIdDraft(String(result.data.versionId));
      setVersionState('success');
      setVersionSuccess(`版本 ${result.data.versionCode} 已创建，versionId=${result.data.versionId}。`);
    } catch (error) {
      setVersionState('error');
      setVersionError(getErrorMessage(error));
    }
  }

  async function handlePublishVersion() {
    if (!selectedGameId || !token) {
      return;
    }

    const versionId = Number(publishVersionIdDraft);
    if (!Number.isFinite(versionId) || versionId <= 0) {
      setVersionState('error');
      setVersionError('发布 versionId 必须是正整数。');
      setVersionSuccess(null);
      return;
    }

    setVersionState('loading');
    setVersionError(null);
    setVersionSuccess(null);

    try {
      const publishResult = await publishVersion(apiBaseUrl, selectedGameId, versionId, token);
      const snapshot = await loadPublishedBundleSnapshot(apiBaseUrl, selectedGameId);

      setPublishedVersion(publishResult.data);
      setPublishedCurrentVersion(snapshot.currentVersion);
      setPublishedBundleMeta(snapshot.bundle.meta);
      setVersionState('success');
      setVersionSuccess(`版本 ${publishResult.data.versionCode} 已发布，current version 与 bundle 已刷新。`);
      onDataPublished?.();
    } catch (error) {
      setVersionState('error');
      setVersionError(getErrorMessage(error));
    }
  }

  return {
    versionCodeDraft,
    releaseDateDraft,
    publishVersionIdDraft,
    versionState,
    versionError,
    versionSuccess,
    createdVersion,
    publishedVersion,
    publishedCurrentVersion,
    publishedBundleMeta,
    setVersionCodeDraft,
    setReleaseDateDraft,
    setPublishVersionIdDraft,
    handleCreateVersion,
    handlePublishVersion
  };
}
