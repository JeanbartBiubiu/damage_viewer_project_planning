import { ApiRequestError, getErrorMessage } from '../../services/apiClient';
import type { CurrentVersion } from '../../types/api';
import type { CombatDataState } from '../../types/combatData';

/** Current-version observation after an inspect or post-publish refresh. */
export type CurrentVersionObservation =
  | { status: 'available'; version: CurrentVersion }
  | { status: 'no-current' }
  | { status: 'failure'; message: string };

/** Combat-data state observation; kept independent of current-version outcome. */
export type CombatDataObservation =
  | { status: 'available'; state: CombatDataState }
  | { status: 'failure'; message: string };

/** Page-level inspect presentation driven by game selection + current-version observation. */
export type InspectPageStatus = 'no-game' | 'loading' | 'no-current' | 'current-available' | 'inspect-failure';

export type PublishPrerequisiteCode = 'no-game' | 'no-token' | 'empty-version-code';

export type PublishPrerequisite =
  | { ok: true }
  | { ok: false; code: PublishPrerequisiteCode; reason: string };

export type PublishVerificationStatus = 'verified' | 'warning';

const PREREQUISITE_REASONS: Record<PublishPrerequisiteCode, string> = {
  'no-game': '请先选择游戏后再发布版本。',
  'no-token': '请先填写 Admin Token 后再发布版本。',
  'empty-version-code': '发布 versionCode 不能为空。'
};

/**
 * Classify a rejected/settled current-version error.
 * ApiRequestError status 404 → no-current; every other failure → inspect failure.
 */
export function classifyCurrentVersionError(error: unknown): CurrentVersionObservation {
  if (error instanceof ApiRequestError && error.status === 404) {
    return { status: 'no-current' };
  }

  return { status: 'failure', message: getErrorMessage(error) };
}

export function classifyCurrentVersionSettled(
  result: PromiseSettledResult<{ data: CurrentVersion }>
): CurrentVersionObservation {
  if (result.status === 'fulfilled') {
    return { status: 'available', version: result.value.data };
  }

  return classifyCurrentVersionError(result.reason);
}

export function classifyCombatDataSettled(
  result: PromiseSettledResult<{ data: { data: CombatDataState } }>
): CombatDataObservation {
  if (result.status === 'fulfilled') {
    return { status: 'available', state: result.value.data.data };
  }

  return { status: 'failure', message: getErrorMessage(result.reason) };
}

export function resolveInspectPageStatus(args: {
  selectedGameId: string | null;
  loading: boolean;
  currentObservation: CurrentVersionObservation | null;
}): InspectPageStatus {
  if (!args.selectedGameId) {
    return 'no-game';
  }

  if (args.loading || args.currentObservation == null) {
    return 'loading';
  }

  switch (args.currentObservation.status) {
    case 'no-current':
      return 'no-current';
    case 'available':
      return 'current-available';
    case 'failure':
      return 'inspect-failure';
  }
}

export function resolvePublishPrerequisite(
  selectedGameId: string | null,
  adminToken: string,
  versionCodeDraft: string
): PublishPrerequisite {
  if (!selectedGameId) {
    return { ok: false, code: 'no-game', reason: PREREQUISITE_REASONS['no-game'] };
  }

  if (!adminToken.trim()) {
    return { ok: false, code: 'no-token', reason: PREREQUISITE_REASONS['no-token'] };
  }

  if (!versionCodeDraft.trim()) {
    return { ok: false, code: 'empty-version-code', reason: PREREQUISITE_REASONS['empty-version-code'] };
  }

  return { ok: true };
}

export function resolvePublishVerificationStatus(
  currentObservation: CurrentVersionObservation,
  combatObservation: CombatDataObservation
): PublishVerificationStatus {
  if (currentObservation.status === 'available' && combatObservation.status === 'available') {
    return 'verified';
  }

  return 'warning';
}

export function buildPublishSuccessMessage(args: {
  versionCode: string;
  changeRevision: number | null | undefined;
  verification: PublishVerificationStatus;
}): string {
  const revisionPart =
    args.changeRevision != null ? `（changeRevision=${args.changeRevision}）` : '';

  if (args.verification === 'verified') {
    return `版本 ${args.versionCode} 已发布${revisionPart}，current 与 combat-data 状态已刷新。`;
  }

  return `版本 ${args.versionCode} 已发布${revisionPart}。`;
}

export function buildVerificationWarningMessage(
  currentObservation: CurrentVersionObservation,
  combatObservation: CombatDataObservation
): string {
  const parts: string[] = [];

  if (currentObservation.status === 'failure') {
    parts.push(`current version：${currentObservation.message}`);
  } else if (currentObservation.status === 'no-current') {
    parts.push('current version：发布后仍未读到当前版本（404）。');
  }

  if (combatObservation.status === 'failure') {
    parts.push(`combat-data state：${combatObservation.message}`);
  }

  const detail = parts.length > 0 ? parts.join('；') : '未能完成 current / combat-data 回读。';
  return `发布已成功，但核验刷新未完成：${detail} 可点击「刷新当前状态」重试核验。`;
}

export function inspectStatusMessage(status: InspectPageStatus, failureMessage?: string | null): string | null {
  switch (status) {
    case 'no-game':
      return '请先选择游戏，再查看当前版本与 combat-data 状态。';
    case 'loading':
      return '正在读取当前版本与 combat-data 状态…';
    case 'no-current':
      return '当前游戏尚无已发布版本（current version 为 404）。可直接填写 versionCode 进行首次发布。';
    case 'current-available':
      return null;
    case 'inspect-failure':
      return failureMessage ? `读取当前版本失败：${failureMessage}` : '读取当前版本失败。';
  }
}
