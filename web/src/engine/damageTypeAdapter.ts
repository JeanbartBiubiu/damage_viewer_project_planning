/** 保留作者伤害原键；目录用 domain:"damage" 明确使用点。 */
export function runtimeDamageType(key: string, path: string, fail: (path: string, message: string) => never): string {
  if (typeof key !== 'string' || !key) return fail(path, '需要明确的伤害类型原键');
  return key;
}
