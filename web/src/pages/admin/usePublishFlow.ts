import { useState } from 'react';
import { getErrorMessage, getItems, getSkills, publishVersion } from '../../services/apiClient';
import { loadPublishedBundleSnapshot } from '../../services/bundleSnapshot';
import {
  buildPublishedContractDiagnostics,
  type PublishedContractDiagnostic
} from '../../engine/tinygoV2DpsAdapter';
import type { CurrentVersion, GameDataBundle, LoadState, VersionPublishResponse } from '../../types/api';

type UsePublishFlowArgs = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onDataPublished?: () => void;
};

type UsePublishFlowResult = {
  versionCodeDraft: string;
  releaseDateDraft: string;
  versionState: LoadState;
  versionError: string | null;
  versionSuccess: string | null;
  publishedVersion: VersionPublishResponse | null;
  publishedCurrentVersion: CurrentVersion | null;
  publishedBundleMeta: GameDataBundle['meta'] | null;
  publishedContractDiagnostics: PublishedContractDiagnostic[];
  setVersionCodeDraft: (value: string) => void;
  setReleaseDateDraft: (value: string) => void;
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
  const [versionState, setVersionState] = useState<LoadState>('idle');
  const [versionError, setVersionError] = useState<string | null>(null);
  const [versionSuccess, setVersionSuccess] = useState<string | null>(null);
  const [publishedVersion, setPublishedVersion] = useState<VersionPublishResponse | null>(null);
  const [publishedCurrentVersion, setPublishedCurrentVersion] = useState<CurrentVersion | null>(null);
  const [publishedBundleMeta, setPublishedBundleMeta] = useState<GameDataBundle['meta'] | null>(null);
  const [publishedContractDiagnostics, setPublishedContractDiagnostics] = useState<PublishedContractDiagnostic[]>([]);

  async function handlePublishVersion() {
    if (!selectedGameId || !token) {
      return;
    }

    const versionCode = versionCodeDraft.trim();
    if (!versionCode) {
      setVersionState('error');
      setVersionError('发布 versionCode 不能为空。');
      setVersionSuccess(null);
      return;
    }

    setVersionState('loading');
    setVersionError(null);
    setVersionSuccess(null);
    setPublishedContractDiagnostics([]);

    try {
      const [itemsResult, skillsResult] = await Promise.all([
        getItems(apiBaseUrl, selectedGameId, token),
        getSkills(apiBaseUrl, selectedGameId, token)
      ]);
      const diagnostics = buildPublishedContractDiagnostics(itemsResult.data.items, skillsResult.data.skills);
      setPublishedContractDiagnostics(diagnostics);
      const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
      if (blockingDiagnostics.length > 0) {
        setVersionState('error');
        setVersionError(`发布前契约检查发现 ${blockingDiagnostics.length} 个 error 级问题，已阻止发布。`);
        return;
      }

      const publishResult = await publishVersion(apiBaseUrl, selectedGameId, token, {
        versionCode,
        releaseDate: releaseDateDraft.trim() || undefined
      });
      const snapshot = await loadPublishedBundleSnapshot(apiBaseUrl, selectedGameId);

      setPublishedVersion(publishResult.data);
      setPublishedCurrentVersion(snapshot.currentVersion);
      setPublishedBundleMeta(snapshot.bundle.meta);
      setVersionState('success');
      setVersionSuccess(`版本 ${publishResult.data.versionCode} 已发布，current version 与 bundle 快照已刷新。`);
      onDataPublished?.();
    } catch (error) {
      setVersionState('error');
      setVersionError(getErrorMessage(error));
    }
  }

  return {
    versionCodeDraft,
    releaseDateDraft,
    versionState,
    versionError,
    versionSuccess,
    publishedVersion,
    publishedCurrentVersion,
    publishedBundleMeta,
    publishedContractDiagnostics,
    setVersionCodeDraft,
    setReleaseDateDraft,
    handlePublishVersion
  };
}
