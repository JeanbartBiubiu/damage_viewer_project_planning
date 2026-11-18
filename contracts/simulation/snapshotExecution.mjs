const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** 校验服务声明的静态执行闭包；不从完整定义、计划或引用重新推断执行资格。 */
export function snapshotExecutionSkillKeys(snapshot, invalid = (path, message) => {
  throw new Error(`${path}: ${message}`);
}) {
  if (!record(snapshot) || !Array.isArray(snapshot.executionSkillKeys)) {
    return invalid('executionSkillKeys', '必须提供执行闭包技能数组');
  }
  if (!Array.isArray(snapshot.skillConfigurations)) return invalid('skillConfigurations', '缺少完整配置列表');
  const configurations = new Map();
  for (const [index, configuration] of snapshot.skillConfigurations.entries()) {
    const key = configuration?.skill?.skillKey;
    if (typeof key !== 'string' || !KEY.test(key) || configurations.has(key)) {
      return invalid(`skillConfigurations[${index}].skill.skillKey`, '技能标识缺失、非法或重复');
    }
    configurations.set(key, configuration);
  }
  const sources = [];
  for (const side of ['source', 'target']) {
    if (!record(snapshot[side]) || !Array.isArray(snapshot[side].skillSources)) {
      return invalid(`${side}.skillSources`, '缺少实际来源列表');
    }
    sources.push(...snapshot[side].skillSources);
  }
  let previous = null;
  for (const [index, key] of snapshot.executionSkillKeys.entries()) {
    const path = `executionSkillKeys[${index}]`;
    if (typeof key !== 'string' || !KEY.test(key)) return invalid(path, '执行技能标识非法');
    if (previous !== null && previous >= key) return invalid(path, '执行技能必须按标识排序且不能重复');
    if (!configurations.has(key)) return invalid(path, '执行技能不在完整配置中');
    if (configurations.get(key).skill.status !== 'ENABLED' || !sources.some(source => record(source)
      && source.skillKey === key && source.skillStatus === 'ENABLED' && source.enabled === true
      && source.inactiveReason === null && (source.skillLevel === null
        || Number.isSafeInteger(source.skillLevel) && source.skillLevel > 0))) {
      return invalid(path, '执行技能缺少已启用且无停用原因的真实来源');
    }
    previous = key;
  }
  return [...snapshot.executionSkillKeys];
}
