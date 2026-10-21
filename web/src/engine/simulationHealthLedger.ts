import type { CompileRequest, DoneResult, RunRequest } from '../types/genericEngine';
import { inspectEmpoweredAttackFacts } from './empoweredAttackContract';
import { inspectResourceChangeContract } from './resourceChangeContract';
import type { HealingEvidenceOrder } from './ordinaryHealingContract';

const close = (first: number, second: number) => Math.abs(first - second) <= 1e-9 * Math.max(1, Math.abs(first), Math.abs(second));

export function inspectSimulationHealthLedger(compile: CompileRequest, request: RunRequest, done: DoneResult, evidenceOrder?: HealingEvidenceOrder): string[] {
  const issues: string[] = [...inspectEmpoweredAttackFacts(compile, request, done), ...inspectResourceChangeContract(compile, request, done)];
  const hp = { source: request.initialSnapshot.combatants.find(actor => actor.key === 'source')!.attributes.hp!.current,
    target: request.initialSnapshot.combatants.find(actor => actor.key === 'target')!.attributes.hp!.current };
  const damages = done.damageRecords ?? [];
  const healing = done.healingRecords ?? [];
  const check = (condition: boolean, message: string) => { if (!condition) issues.push(`生命账: ${message}`); };
  if (request.outputMode === 'summary') return issues;
  if (done.resourceChangeSummary) {
    if (issues.length) return issues;
    const maxima = { source: request.initialSnapshot.combatants.find(actor => actor.key === 'source')!.attributes.hp!.max,
      target: request.initialSnapshot.combatants.find(actor => actor.key === 'target')!.attributes.hp!.max };
    const streams = [damages, healing, done.resourceChangeRecords!];
    const truncated = [done.recording?.damageRecordsTruncated, done.recording?.healingRecordsTruncated, done.recording?.resourceChangeRecordsTruncated];
    const positions = [0, 0, 0];
    const checkpoints = new Map<string, typeof hp>();
    const aliases = new Map<string, { useRef: string; timeMs: number }>();
    for (const process of done.finalSnapshot.processInstances ?? []) if (process.empoweredAttack && process.lastExecutionAtMs !== null) {
      aliases.set(process.useKey, { useRef: process.empoweredAttack.useRef, timeMs: process.lastExecutionAtMs });
    }
    let previousTime = 0;
    while (positions.some((position, i) => position < streams[i]!.length)) {
      // 已丢失某类后续事实时只能验证共同已知的前缀，不能拼造其后的账。
      if (positions.some((position, i) => position === streams[i]!.length && truncated[i])) break;
      let selected = -1, order = Infinity;
      for (let i = 0; i < streams.length; i++) {
        const next = streams[i]![positions[i]!] as { healthOrder: number } | undefined;
        if (next && next.healthOrder < order) { selected = i; order = next.healthOrder; }
      }
      if (selected < 0) break;
      const row = streams[selected]![positions[selected]!]!;
      check(row.timeMs >= previousTime, '统一生命顺序与时刻逆序'); previousTime = row.timeMs;
      if (selected === 2) {
        const resource = done.resourceChangeRecords![positions[2]!]!;
        check(close(resource.currentBefore, hp[resource.target]) && close(resource.maxBefore, maxima[resource.target]), '资源前后生命或上限不能连接');
        hp[resource.target] = resource.currentAfter; maxima[resource.target] = resource.maxAfter;
      } else if (selected === 0) {
        const damage = damages[positions[0]!]!;
        if (damage.source !== 'source' && damage.source !== 'target' || damage.target !== 'source' && damage.target !== 'target') { check(false, '伤害双方身份非法'); break; }
        check(typeof damage.sourceHpBefore === 'number' && typeof damage.sourceHpAfter === 'number' && close(damage.sourceHpBefore, hp[damage.source])
          && close(damage.hpBefore, hp[damage.target]), '伤害与来源吸血生命不能连接');
        hp[damage.target] = damage.hpAfter; hp[damage.source] = damage.sourceHpAfter!;
      } else {
        const heal = healing[positions[1]!]!;
        if (heal.target !== 'source' && heal.target !== 'target') { check(false, '治疗对象身份非法'); break; }
        check(close(heal.hpBefore, hp[heal.target]), '直接治疗生命不能连接'); hp[heal.target] = heal.hpAfter;
      }
      for (const side of ['source', 'target'] as const) check(Number.isFinite(hp[side]) && hp[side] >= 0 && hp[side] <= maxima[side], '事实结算后生命超过当时上限');
      if ('useRef' in row && typeof row.useRef === 'string' && row.useRef) {
        checkpoints.set(row.useRef, { ...hp });
        const association = aliases.get(row.useRef);
        if (association?.timeMs === row.timeMs) checkpoints.set(association.useRef, { ...hp });
      }
      positions[selected] = positions[selected]! + 1;
    }
    if (!truncated.some(Boolean)) {
      for (const side of ['source', 'target'] as const) check(close(hp[side], done.summary[`${side}FinalHp`])
        && close(maxima[side], done.resourceChangeSummary[side].finalMax), '完整生命与上限事实链不等于最终累计');
      for (const attack of done.attackRecords ?? []) {
        const checkpoint = checkpoints.get(attack.useRef);
        if (checkpoint) check(close(checkpoint.source, attack.sourceHpAfter) && close(checkpoint.target, attack.targetHpAfter), '逐刀同步尾部生命与统一生命事实不一致');
      }
    }
    return issues;
  }
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
  let unknownSameTimeOrder = false;
  while (damageIndex < damages.length || healingIndex < healing.length) {
    if (damageIndex === damages.length && done.recording?.damageRecordsTruncated
      || healingIndex === healing.length && done.recording?.healingRecordsTruncated) break;
    const damage = damages[damageIndex];
    const heal = healing[healingIndex];
    const time = Math.min(damage?.timeMs ?? Infinity, heal?.timeMs ?? Infinity);
    const damageMatches = damage?.timeMs === time && knownSide(damage.source) && knownSide(damage.target)
      && typeof damage.sourceHpBefore === 'number' && close(damage.sourceHpBefore, hp[damage.source]) && close(damage.hpBefore, hp[damage.target]);
    const healMatches = heal?.timeMs === time && knownSide(heal.target) && close(heal.hpBefore, hp[heal.target]);
    let healFirst = false;
    if (evidenceOrder && damageMatches && healMatches) {
      const damageOrder = evidenceOrder.damage[damageIndex], healOrder = evidenceOrder.healing[healingIndex];
      if (damageOrder === undefined || healOrder === undefined) {
        if (evidenceOrder.truncated) unknownSameTimeOrder = true;
        else check(false, '同刻零变化歧义缺少真实完整证据顺序');
        break;
      }
      healFirst = healOrder < damageOrder;
    }
    if (damageMatches && damage && !healFirst) {
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
  if (!done.recording?.damageRecordsTruncated && !done.recording?.healingRecordsTruncated && !unknownSameTimeOrder) {
    check(damageIndex === damages.length && healingIndex === healing.length
      && close(hp.source, done.summary.sourceFinalHp) && close(hp.target, done.summary.targetFinalHp), '完整实际生命链与最终汇总不一致');
    for (const attack of done.attackRecords ?? []) {
      const checkpoint = checkpoints.get(attack.useRef);
      if (checkpoint) check(close(checkpoint.source, attack.sourceHpAfter) && close(checkpoint.target, attack.targetHpAfter), '逐刀同步尾部生命与原使用事实不一致');
    }
  }
  return issues;
}
