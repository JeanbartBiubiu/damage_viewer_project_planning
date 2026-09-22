import { describe, expect, it } from 'vitest';
import { parseSkillProcessMoment } from './skillProcessMoment';

function protocolError(path: string): never {
  throw new Error(path);
}

describe('过程时点协议', () => {
  it('缺字段可读为不限原因，外来字段与非法枚举仍拒绝', () => {
    expect(parseSkillProcessMoment(
      { momentType: 'PROCESS_FAILURE', stepKey: null },
      'moment',
      protocolError
    )).toEqual({ momentType: 'PROCESS_FAILURE', stepKey: null, failureReason: null });
    expect(parseSkillProcessMoment(
      { momentType: 'PROCESS_START', stepKey: null, failureReason: null },
      'moment',
      protocolError
    )).toEqual({ momentType: 'PROCESS_START', stepKey: null, failureReason: null });
    expect(() => parseSkillProcessMoment(
      { momentType: 'PROCESS_FAILURE', stepKey: null, failureReason: 'UNKNOWN' },
      'moment',
      protocolError
    )).toThrow('moment.failureReason');
    expect(() => parseSkillProcessMoment(
      { momentType: 'PROCESS_START', stepKey: null, extra: true },
      'moment',
      protocolError
    )).toThrow('moment');
    expect(() => parseSkillProcessMoment(
      { momentType: 'PROCESS_START', stepKey: null, failureReason: 'CONTROLLED' },
      'moment',
      protocolError
    )).toThrow('moment.failureReason');
    expect(() => parseSkillProcessMoment(
      { momentType: 'NOT_A_MOMENT', stepKey: null },
      'moment',
      protocolError
    )).toThrow('moment.momentType');
  });
});
