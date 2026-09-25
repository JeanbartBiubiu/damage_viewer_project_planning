/** 当前管理目录与原生伤害结算种类的边界转换，不改写作者数据。 */
export function runtimeDamageType(
  key: string,
  path: string,
  fail: (path: string, message: string) => never
): string {
  switch (key) {
    case 'physics': return 'damage/physical';
    case 'magic': return 'damage/magic';
    case 'real': return 'damage/true';
    default: return fail(path, `管理伤害类型 ${key} 尚无受支持的运行时对应关系`);
  }
}
