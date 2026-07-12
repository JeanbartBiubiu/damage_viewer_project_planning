import { useState } from 'react';
import { getCurrentVersion, getErrorMessage, publishVersion } from '../../services/apiClient';
import { getCombatDataState } from '../../services/combatDataClient';
import type { CurrentVersion, LoadState, VersionPublishResponse } from '../../types/api';
import type { CombatDataState } from '../../types/combatData';

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
  publishedCombatDataState: CombatDataState | null;
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
  const [publishedCombatDataState, setPublishedCombatDataState] = useState<CombatDataState | null>(null);

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

    try {
      const publishResult = await publishVersion(apiBaseUrl, selectedGameId, token, {
        versionCode,
        releaseDate: releaseDateDraft.trim() || undefined
      });

      const [currentResult, combatStateResult] = await Promise.all([
        getCurrentVersion(apiBaseUrl, selectedGameId),
        getCombatDataState(apiBaseUrl, selectedGameId)
      ]);

      setPublishedVersion(publishResult.data);
      setPublishedCurrentVersion(currentResult.data);
      setPublishedCombatDataState(combatStateResult.data.data);
      setVersionState('success');

      const changeRevision =
        publishResult.data.changeRevision ?? currentResult.data.changeRevision ?? combatStateResult.data.data.publishedRevision;
      setVersionSuccess(
        `版本 ${publishResult.data.versionCode} 已发布（changeRevision=${changeRevision ?? '—'}），current 与 combat-data 状态已刷新。`
      );
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
    publishedCombatDataState,
    setVersionCodeDraft,
    setReleaseDateDraft,
    handlePublishVersion
  };
}
