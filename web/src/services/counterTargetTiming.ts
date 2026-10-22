import { isNumericValue } from '../types/numericValue';
import type { CounterTargetTiming } from '../types/skillInternalState';

const keyPattern = /^[a-z][a-z0-9_]{0,63}$/;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Only the declared union is accepted; semantic process/number closure is checked with the complete skill. */
export function isCounterTargetTiming(value: unknown): value is CounterTargetTiming {
  if (!record(value) || typeof value.processKey !== 'string' || !keyPattern.test(value.processKey)) return false;
  if (value.kind === 'EXPIRY_PAYLOAD') return Object.keys(value).length === 2
    && Object.keys(value).every(key => ['kind', 'processKey'].includes(key));
  return value.kind === 'PHASED_TICK' && Object.keys(value).length === 4
    && Object.keys(value).every(key => ['kind', 'processKey', 'intervalValue', 'phasePolicy'].includes(key))
    && value.phasePolicy === 'PRESERVE_ON_EXTEND' && isNumericValue(value.intervalValue)
    && (value.intervalValue.kind !== 'FIXED' || Number.isSafeInteger(value.intervalValue.value) && value.intervalValue.value > 0);
}
