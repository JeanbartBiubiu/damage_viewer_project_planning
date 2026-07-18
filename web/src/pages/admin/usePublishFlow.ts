import { useState } from 'react';
import { getCurrentVersion, getErrorMessage, publishVersion } from '../../services/apiClient';
import { getCombatDataState } from '../../services/combatDataClient';
import type { CurrentVersion, LoadState, VersionPublishResponse } from '../../types/api';
import type { CombatDataState } from '../../types/combatData';
import {
  buildPublishSuccessMessage,
  buildVerificationWarningMessage,
  classifyCombatDataSettled,
  classifyCurrentVersionSettled,
  resolvePublishPrerequisite,
  resolvePublishVerificationStatus
} from './versionPublishModel';

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
  verificationWarning: string | null;
  publishDisabled: boolean;
  publishDisabledReason: string | null;
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
  const [versionCodeDraft, setVersionCodeDraft] = useState('');
  const [releaseDateDraft, setReleaseDateDraft] = useState('');
  const [versionState, setVersionState] = useState<LoadState>('idle');
  const [versionError, setVersionError] = useState<string | null>(null);
  const [versionSuccess, setVersionSuccess] = useState<string | null>(null);
  const [verificationWarning, setVerificationWarning] = useState<string | null>(null);
  const [publishedVersion, setPublishedVersion] = useState<VersionPublishResponse | null>(null);
  const [publishedCurrentVersion, setPublishedCurrentVersion] = useState<CurrentVersion | null>(null);
  const [publishedCombatDataState, setPublishedCombatDataState] = useState<CombatDataState | null>(null);

  const prerequisite = resolvePublishPrerequisite(selectedGameId, adminToken, versionCodeDraft);
  const publishDisabled = !prerequisite.ok || versionState === 'loading';
  const publishDisabledReason = prerequisite.ok ? null : prerequisite.reason;

  async function handlePublishVersion() {
    const gate = resolvePublishPrerequisite(selectedGameId, adminToken, versionCodeDraft);
    if (!gate.ok) {
      setVersionState('error');
      setVersionError(gate.reason);
      setVersionSuccess(null);
      setVerificationWarning(null);
      return;
    }

    const gameId = selectedGameId!;
    const token = adminToken.trim();
    const versionCode = versionCodeDraft.trim();

    setVersionState('loading');
    setVersionError(null);
    setVersionSuccess(null);
    setVerificationWarning(null);

    try {
      const publishResult = await publishVersion(apiBaseUrl, gameId, token, {
        versionCode,
        releaseDate: releaseDateDraft.trim() || undefined
      });

      // Retain POST success immediately; verification failures must not erase it.
      setPublishedVersion(publishResult.data);

      const [currentResult, combatStateResult] = await Promise.allSettled([
        getCurrentVersion(apiBaseUrl, gameId),
        getCombatDataState(apiBaseUrl, gameId)
      ]);

      const currentObservation = classifyCurrentVersionSettled(currentResult);
      const combatObservation = classifyCombatDataSettled(combatStateResult);
      const verification = resolvePublishVerificationStatus(currentObservation, combatObservation);

      if (currentObservation.status === 'available') {
        setPublishedCurrentVersion(currentObservation.version);
      }

      if (combatObservation.status === 'available') {
        setPublishedCombatDataState(combatObservation.state);
      }

      const changeRevision =
        publishResult.data.changeRevision ??
        (currentObservation.status === 'available' ? currentObservation.version.changeRevision : undefined) ??
        (combatObservation.status === 'available' ? combatObservation.state.publishedRevision : undefined);

      setVersionState('success');
      setVersionSuccess(
        buildPublishSuccessMessage({
          versionCode: publishResult.data.versionCode,
          changeRevision,
          verification
        })
      );

      if (verification === 'warning') {
        setVerificationWarning(buildVerificationWarningMessage(currentObservation, combatObservation));
      } else {
        setVerificationWarning(null);
      }

      onDataPublished?.();
    } catch (error) {
      setVersionState('error');
      setVersionError(getErrorMessage(error));
      setVersionSuccess(null);
      setVerificationWarning(null);
    }
  }

  return {
    versionCodeDraft,
    releaseDateDraft,
    versionState,
    versionError,
    versionSuccess,
    verificationWarning,
    publishDisabled,
    publishDisabledReason,
    publishedVersion,
    publishedCurrentVersion,
    publishedCombatDataState,
    setVersionCodeDraft,
    setReleaseDateDraft,
    handlePublishVersion
  };
}
