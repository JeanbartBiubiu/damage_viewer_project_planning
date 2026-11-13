/** 仅投影已通过生产结果准入的过程；原始输出保持原样，不生成数值预期。 */
export function passiveProcessObservations(compile, done) {
  const declared = compile.sharedProviders?.some(provider => provider.processes?.some(process => process.entryKind === 'SKILL_HIT_PASSIVE'));
  if (!declared) return [];
  const processes = done.finalSnapshot?.processInstances;
  if (!Array.isArray(processes)) throw new Error('已声明被动过程的结果缺少实际过程快照。');
  return processes.filter(process => process.passiveOrigin !== undefined).slice().sort((a, b) => {
    for (const field of ['owner', 'providerRef', 'processKey']) {
      if (a[field] !== b[field]) return a[field] < b[field] ? -1 : 1;
    }
    return a.startedAtMs - b.startedAtMs || (a.useKey < b.useKey ? -1 : a.useKey > b.useKey ? 1 : 0);
  });
}
