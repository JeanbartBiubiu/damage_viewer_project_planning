import type { CompileRequest, DoneResult, RunRequest } from '../types/genericEngine';

/** 只核对原生实际额度事实与已装配声明，不从冷却或伤害反造使用量。 */
export function inspectCumulativeRefundBudgets(compile: CompileRequest, request: RunRequest, done: DoneResult): string[] {
  const issues: string[] = [], declared = new Map<string, number>();
  if (request.initialSnapshot?.useAmountBudgets?.length) issues.push('initialSnapshot.useAmountBudgets: 累计退款不支持导入额度');
  const rows: unknown = done.finalSnapshot?.useAmountBudgets;
  if (rows === undefined || Array.isArray(rows) && !rows.length) return issues;
  if (!Array.isArray(rows)) return [...issues,'finalSnapshot.useAmountBudgets: 需要真实数组'];
  const identity = (owner: unknown, provider: unknown, group: unknown, subject: unknown) => JSON.stringify([owner,provider,group,subject]);
  for (const actor of compile.combatants) for (const mount of actor.providers) {
    const provider = compile.sharedProviders?.find(row=>row.providerKey===mount.definitionRef);
    for (const ability of provider?.abilities ?? []) for (const operation of ability.listenerSpec?.operations ?? []) {
      if (operation.cumulativeLimit) declared.set(identity(actor.key,mount.providerRef,operation.cumulativeLimit.groupKey,operation.abilityRef),operation.cumulativeLimit.maxRatio);
    }
  }
  if (rows.length + (done.finalSnapshot.useTriggerLedger?.length ?? 0) > 1024) issues.push('useAmountBudgets: 超出共同额度容量');
  const seen = new Set<string>();
  for (const [index,value] of rows.entries()) {
    const path=`finalSnapshot.useAmountBudgets[${index}]`;
    if (!value || typeof value!=='object' || Array.isArray(value)) { issues.push(path+': 额度事实形状不完整'); continue; }
    const row=value as Record<string,unknown>;
    const fields=['owner','providerRef','groupKey','scope','useSource','useSkillKey','useKey','target','subjectRef','maxValue','usedValue'];
    if (Object.keys(row).length!==fields.length || fields.some(key=>!Object.prototype.hasOwnProperty.call(row,key))
      || ['owner','useSource','target'].some(key=>!['source','target'].includes(String(row[key]))) || row.scope!=='provider_target'
      || ['providerRef','groupKey','useSkillKey','useKey','subjectRef'].some(key=>typeof row[key]!=='string'||!(row[key] as string).trim())
      || typeof row.maxValue!=='number'||!Number.isFinite(row.maxValue)||row.maxValue<=0||row.maxValue>1
      || typeof row.usedValue!=='number'||!Number.isFinite(row.usedValue)||row.usedValue<=0||row.usedValue>row.maxValue) {
      issues.push(path+': 需要完整原使用、目标、真实能力及合法已用比例');continue;
    }
    const key=identity(row.owner,row.providerRef,row.groupKey,row.subjectRef);
    if (declared.get(key)!==row.maxValue) issues.push(path+': 额度与实际挂载声明不匹配');
    const use=JSON.stringify([key,row.useSource,row.useKey,row.target]);
    if(seen.has(use))issues.push(path+': 额度身份重复');seen.add(use);
    if(!done.finalSnapshot.processInstances?.some(process=>process.owner===row.useSource&&process.skillKey===row.useSkillKey&&process.useKey===row.useKey)) {
      issues.push(path+': 缺少实际原过程使用身份');
    }
  }
  return issues;
}
