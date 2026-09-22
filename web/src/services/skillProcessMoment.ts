import type {
  SkillProcessFailureReason,
  SkillProcessMoment,
  SkillProcessMomentType
} from '../types/skillProcess';

export const SKILL_PROCESS_FAILURE_REASONS = [
  'CONTROLLED',
  'SOURCE_DIED',
  'TARGET_UNTARGETABLE',
  'ACTIVE_CANCELLED',
  'EVENT_ABORTED'
] as const satisfies readonly SkillProcessFailureReason[];

const PROCESS_MOMENT_TYPES = new Set<SkillProcessMomentType>([
  'PROCESS_START',
  'PROCESS_COMPLETE',
  'PROCESS_FAILURE',
  'STEP_START',
  'STEP_EXECUTION',
  'STEP_COMPLETE',
  'STEP_TIMEOUT'
]);

const FAILURE_REASONS = new Set<string>(SKILL_PROCESS_FAILURE_REASONS);
const MOMENT_KEYS = new Set(['momentType', 'stepKey', 'failureReason']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseSkillProcessMoment(
  value: unknown,
  path: string,
  protocolError: (path: string) => never
): SkillProcessMoment {
  if (!isRecord(value)) protocolError(path);
  if (Object.keys(value).some((key) => !MOMENT_KEYS.has(key))) protocolError(path);
  if (typeof value.momentType !== 'string' || !PROCESS_MOMENT_TYPES.has(value.momentType as SkillProcessMomentType)) {
    protocolError(`${path}.momentType`);
  }
  const momentType = value.momentType as SkillProcessMomentType;
  let failureReason: SkillProcessFailureReason | null = null;
  if ('failureReason' in value && value.failureReason !== null && value.failureReason !== undefined) {
    if (typeof value.failureReason !== 'string' || !FAILURE_REASONS.has(value.failureReason)) {
      protocolError(`${path}.failureReason`);
    }
    failureReason = value.failureReason as SkillProcessFailureReason;
  }
  if (failureReason !== null && momentType !== 'PROCESS_FAILURE') {
    protocolError(`${path}.failureReason`);
  }
  if (momentType === 'PROCESS_START' || momentType === 'PROCESS_COMPLETE' || momentType === 'PROCESS_FAILURE') {
    if (value.stepKey !== null && value.stepKey !== undefined) protocolError(`${path}.stepKey`);
    return { momentType, stepKey: null, failureReason };
  }
  if (typeof value.stepKey !== 'string') protocolError(`${path}.stepKey`);
  return { momentType, stepKey: value.stepKey, failureReason: null };
}
