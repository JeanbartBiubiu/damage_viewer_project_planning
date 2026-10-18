import type { CompileRequest, DoneResult, RunRequest } from '../types/genericEngine';
import { inspectEmpoweredAttackFacts } from './empoweredAttackContract';

const close = (first: number, second: number) => Math.abs(first - second) <= 1e-9 * Math.max(1, Math.abs(first), Math.abs(second));

export function inspectSimulationHealthLedger(compile: CompileRequest, request: RunRequest, done: DoneResult): string[] {
  const issues: string[] = inspectEmpoweredAttackFacts(compile, request, done);
  const hp = { source: request.initialSnapshot.combatants.find(actor => actor.key === 'source')!.attributes.hp!.current,
    target: request.initialSnapshot.combatants.find(actor => actor.key === 'target')!.attributes.hp!.current };
  const damages = done.damageRecords ?? [];
  const healing = done.healingRecords ?? [];
  const check = (condition: boolean, message: string) => { if (!condition) issues.push(`生命账: ${message}`); };
  const knownSide = (side: string): side is keyof typeof hp => side === 'source' || side === 'target';
  const checkpoints = new Map<string, typeof hp>();
  const attackAliases = new Map<string, { useRef: string; timeMs: number }>();
  // 只有完整编译绑定和消费事实核对后才建立显式使用关系；同毫秒本身不构成归属。
  if (!issues.length) for (const process of done.finalSnapshot.processInstances ?? []) if (process.empoweredAttack && process.lastExecutionAtMs !== null) {
    attackAliases.set(process.useKey, { useRef: process.empoweredAttack.useRef, timeMs: process.lastExecutionAtMs });
  }
  const checkpoint = (useRef: string | null | undefined, timeMs: number) => {
    if (!useRef) return;
    checkpoints.set(useRef, { ...hp });
    const association = attackAliases.get(useRef);
    if (association?.timeMs === timeMs) checkpoints.set(association.useRef, { ...hp });
  };
  for (const records of [damages, healing]) records.forEach((row, index) => {
    check(Number.isSafeInteger(row.timeMs) && row.timeMs >= 0 && row.timeMs <= done.summary.durationMs
      && (index === 0 || row.timeMs >= records[index - 1]!.timeMs), '实际记录时刻非法或逆序');
  });
  let damageIndex = 0;
  let healingIndex = 0;
  let previousTime = 0;
  while (damageIndex < damages.length || healingIndex < healing.length) {
    if (damageIndex === damages.length && done.recording?.damageRecordsTruncated
      || healingIndex === healing.length && done.recording?.healingRecordsTruncated) break;
    const damage = damages[damageIndex];
    const heal = healing[healingIndex];
    const time = Math.min(damage?.timeMs ?? Infinity, heal?.timeMs ?? Infinity);
    const damageMatches = damage?.timeMs === time && knownSide(damage.source) && knownSide(damage.target)
      && typeof damage.sourceHpBefore === 'number' && close(damage.sourceHpBefore, hp[damage.source]) && close(damage.hpBefore, hp[damage.target]);
    const healMatches = heal?.timeMs === time && knownSide(heal.target) && close(heal.hpBefore, hp[heal.target]);
    if (damageMatches && damage) {
      const source = damage.source as keyof typeof hp;
      const target = damage.target as keyof typeof hp;
      if (typeof damage.sourceHpAfter !== 'number') { check(false, '缺少实际伤害后来源生命'); break; }
      hp[target] = damage.hpAfter;
      hp[source] = damage.sourceHpAfter;
      checkpoint(damage.useRef, damage.timeMs);
      damageIndex++;
    } else if (healMatches && heal) {
      hp[heal.target as keyof typeof hp] = heal.hpAfter;
      checkpoint(heal.useRef, heal.timeMs);
      healingIndex++;
    } else { check(false, '伤害、吸血与直接治疗的真实前后生命不能连接'); break; }
    check(time >= previousTime, '合并生命账时刻逆序');
    previousTime = time;
  }
  if (!done.recording?.damageRecordsTruncated && !done.recording?.healingRecordsTruncated) {
    check(damageIndex === damages.length && healingIndex === healing.length
      && close(hp.source, done.summary.sourceFinalHp) && close(hp.target, done.summary.targetFinalHp), '完整实际生命链与最终汇总不一致');
    for (const attack of done.attackRecords ?? []) {
      const checkpoint = checkpoints.get(attack.useRef);
      if (checkpoint) check(close(checkpoint.source, attack.sourceHpAfter) && close(checkpoint.target, attack.targetHpAfter), '逐刀同步尾部生命与原使用事实不一致');
    }
  }
  return issues;
}
