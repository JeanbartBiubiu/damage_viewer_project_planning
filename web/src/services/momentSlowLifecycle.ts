import { isNumericValue } from '../types/numericValue';

/** 当前时点普通减速只授权同来源与目标的有限单层刷新实例。数值依赖由编译入口核定。 */
export function momentSlowLifecycleIssue(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'lifecycle';
  const life = value as Record<string, unknown>;
  if (!isNumericValue(life.durationValue) || life.durationValue.kind === 'FIXED'
    && (!Number.isSafeInteger(life.durationValue.value) || life.durationValue.value <= 0)) return 'durationValue';
  for (const key of ['maxStacksValue', 'applicationStacksValue'] as const) {
    const amount = life[key];
    if (!isNumericValue(amount) || amount.kind === 'FIXED' && amount.value !== 1) return key;
  }
  for (const [key, expected] of Object.entries({ instanceScope: 'SOURCE_TARGET', reapplicationStackMode: 'KEEP',
    reapplicationDurationMode: 'REFRESH_ALL', expiryMode: 'ALL_AT_ONCE', periodicIntervalValue: null, firstPeriodicExecution: null })) {
    if (life[key] !== expected) return key;
  }
  return life.endWhenShieldEndsResultKey != null ? 'endWhenShieldEndsResultKey' : null;
}
