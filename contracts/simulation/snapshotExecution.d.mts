/** 只校验后端给定的执行闭包事实，不重新遍历依赖。 */
export function snapshotExecutionSkillKeys(
  snapshot: unknown,
  invalid?: (path: string, message: string) => never
): string[];
