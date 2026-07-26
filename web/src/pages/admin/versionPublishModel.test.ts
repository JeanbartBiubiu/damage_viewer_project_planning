import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../services/apiClient';
import type { CurrentVersion } from '../../types/api';
import type { CombatDataState } from '../../types/combatData';
import {
  buildPublishSuccessMessage,
  buildVerificationWarningMessage,
  classifyCombatDataSettled,
  classifyCurrentVersionError,
  classifyCurrentVersionSettled,
  resolveInspectPageStatus,
  resolvePublishPrerequisite,
  resolvePublishVerificationStatus
} from './versionPublishModel';

const sampleVersion: CurrentVersion = {
  gameId: 'demo',
  versionCode: '14.1',
  releaseDate: '2026-03-23',
  changeRevision: 4,
  publishedAt: '2026-03-23T10:00:00Z'
};

const sampleCombatState: CombatDataState = {
  gameId: 'demo',
  currentRevision: 4,
  publishedRevision: 4,
  updatedAt: '2026-03-23T10:00:00Z'
};

describe('classifyCurrentVersionError / Settled', () => {
  it('classifies ApiRequestError status 404 as no-current', () => {
    const error = new ApiRequestError('Not found', 404, '404.NOT_FOUND');
    expect(classifyCurrentVersionError(error)).toEqual({ status: 'no-current' });
  });

  it('classifies non-404 ApiRequestError as inspect failure', () => {
    const error = new ApiRequestError('Server exploded', 500, '500.INTERNAL');
    expect(classifyCurrentVersionError(error)).toEqual({
      status: 'failure',
      message: '500.INTERNAL: Server exploded'
    });
  });

  it('classifies non-ApiRequestError as inspect failure', () => {
    expect(classifyCurrentVersionError(new Error('network down'))).toEqual({
      status: 'failure',
      message: 'network down'
    });
  });

  it('maps fulfilled settled result to available', () => {
    const settled: PromiseFulfilledResult<{ data: CurrentVersion }> = {
      status: 'fulfilled',
      value: { data: sampleVersion }
    };
    expect(classifyCurrentVersionSettled(settled)).toEqual({
      status: 'available',
      version: sampleVersion
    });
  });

  it('maps rejected 404 settled result to no-current, not failure', () => {
    const settled: PromiseRejectedResult = {
      status: 'rejected',
      reason: new ApiRequestError('missing', 404, '404.NOT_FOUND')
    };
    expect(classifyCurrentVersionSettled(settled)).toEqual({ status: 'no-current' });
  });

  it('maps rejected non-404 settled result to failure', () => {
    const settled: PromiseRejectedResult = {
      status: 'rejected',
      reason: new ApiRequestError('bad gateway', 502, '502.BAD_GATEWAY')
    };
    expect(classifyCurrentVersionSettled(settled)).toEqual({
      status: 'failure',
      message: '502.BAD_GATEWAY: bad gateway'
    });
  });
});

describe('resolvePublishPrerequisite', () => {
  it('returns no-game when selectedGameId is missing', () => {
    expect(resolvePublishPrerequisite(null, 'token', '14.1')).toEqual({
      ok: false,
      code: 'no-game',
      reason: '请先选择游戏后再发布版本。'
    });
  });

  it('returns no-token when admin token is blank', () => {
    expect(resolvePublishPrerequisite('demo', '   ', '14.1')).toEqual({
      ok: false,
      code: 'no-token',
      reason: '请先填写 Admin Token 后再发布版本。'
    });
  });

  it('returns empty-version-code when versionCode is blank', () => {
    expect(resolvePublishPrerequisite('demo', 'token', '  ')).toEqual({
      ok: false,
      code: 'empty-version-code',
      reason: '发布 versionCode 不能为空。'
    });
  });

  it('returns ok when game, token, and versionCode are present', () => {
    expect(resolvePublishPrerequisite('demo', 'token', '14.1')).toEqual({ ok: true });
  });
});

describe('publish success vs verification warning', () => {
  it('marks both successful refreshes as verified publish success', () => {
    const current = classifyCurrentVersionSettled({
      status: 'fulfilled',
      value: { data: sampleVersion }
    });
    const combat = classifyCombatDataSettled({
      status: 'fulfilled',
      value: { data: { data: sampleCombatState } }
    });

    expect(resolvePublishVerificationStatus(current, combat)).toBe('verified');
    expect(
      buildPublishSuccessMessage({
        versionCode: '14.1',
        changeRevision: 4,
        verification: 'verified'
      })
    ).toBe('版本 14.1 已发布（changeRevision=4），current 与 combat-data 状态已刷新。');
  });

  it('keeps publish success with verification warning when refresh fails', () => {
    const current = classifyCurrentVersionSettled({
      status: 'rejected',
      reason: new ApiRequestError('timeout', 504, '504.GATEWAY_TIMEOUT')
    });
    const combat = classifyCombatDataSettled({
      status: 'fulfilled',
      value: { data: { data: sampleCombatState } }
    });

    expect(resolvePublishVerificationStatus(current, combat)).toBe('warning');
    expect(
      buildPublishSuccessMessage({
        versionCode: '14.1',
        changeRevision: 4,
        verification: 'warning'
      })
    ).toBe('版本 14.1 已发布（changeRevision=4）。');
    expect(buildVerificationWarningMessage(current, combat)).toContain('发布已成功，但核验刷新未完成');
    expect(buildVerificationWarningMessage(current, combat)).toContain('504.GATEWAY_TIMEOUT');
  });

  it('treats POST failure as a separate path from verification warning copy', () => {
    const postFailure = '401.UNAUTHORIZED: invalid token';
    const verificationWarning = buildVerificationWarningMessage(
      { status: 'failure', message: 'network' },
      { status: 'failure', message: 'network' }
    );

    expect(verificationWarning).not.toBe(postFailure);
    expect(verificationWarning.startsWith('发布已成功')).toBe(true);
    expect(postFailure.includes('已成功')).toBe(false);
  });
});

describe('resolveInspectPageStatus', () => {
  it('returns no-game when game is missing', () => {
    expect(
      resolveInspectPageStatus({
        selectedGameId: null,
        loading: false,
        currentObservation: null
      })
    ).toBe('no-game');
  });

  it('returns loading while observation is pending', () => {
    expect(
      resolveInspectPageStatus({
        selectedGameId: 'demo',
        loading: true,
        currentObservation: null
      })
    ).toBe('loading');
  });

  it('returns no-current for 404 classification', () => {
    expect(
      resolveInspectPageStatus({
        selectedGameId: 'demo',
        loading: false,
        currentObservation: { status: 'no-current' }
      })
    ).toBe('no-current');
  });

  it('returns current-available when version is present', () => {
    expect(
      resolveInspectPageStatus({
        selectedGameId: 'demo',
        loading: false,
        currentObservation: { status: 'available', version: sampleVersion }
      })
    ).toBe('current-available');
  });

  it('returns inspect-failure for non-404 current-version errors', () => {
    expect(
      resolveInspectPageStatus({
        selectedGameId: 'demo',
        loading: false,
        currentObservation: { status: 'failure', message: 'boom' }
      })
    ).toBe('inspect-failure');
  });
});
