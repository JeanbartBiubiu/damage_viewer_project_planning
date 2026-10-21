import type { CompileRequest, DoneResult, RunRequest } from '../../src/types/genericEngine';
import { inspectPermanentHealthInitialization } from '../../src/engine/permanentHealthInitialization';
import { inspectEmpoweredAttackFacts } from '../../src/engine/empoweredAttackContract';
import type { ProjectedEmpoweredConsumption, ProjectedEmpoweredWindow, ProjectedInitialization } from './mechanismCase';

export function projectInitializations(compile: CompileRequest, request: RunRequest, done: DoneResult): ProjectedInitialization[] {
  const checked = inspectPermanentHealthInitialization(compile, request, done);
  if (checked.issues.length || checked.identityGaps.length) throw new Error('initializations: ' + [...checked.issues, ...checked.identityGaps].join(';'));
  return done.evidence.items.filter(fact => fact.kind === 'resource_max_initialized').flatMap(fact => {
    const data = fact.data!;
    return (data.contributions as Array<Record<string, unknown>>).map(row => ({ timeMs: fact.timeMs, resourceKey: data.resourceKey,
      anchorMax: data.anchorMax, permanentIncrease: data.permanentIncrease, max: data.max, current: data.current, ...row } as ProjectedInitialization));
  }).sort((a, b) => a.owner.localeCompare(b.owner) || a.opPath.localeCompare(b.opPath));
}

export function projectEmpoweredWindows(compile: CompileRequest, request: RunRequest, done: DoneResult): {
  empoweredWindows: ProjectedEmpoweredWindow[]; empoweredConsumptions: ProjectedEmpoweredConsumption[];
} {
  const issues = inspectEmpoweredAttackFacts(compile, request, done);
  if (issues.length) throw new Error('empoweredWindows: ' + issues.join(';'));
  const processes = (done.finalSnapshot.processInstances ?? []).filter(process => process.empoweredAttackWindow)
    .sort((a, b) => a.startedAtMs - b.startedAtMs || a.useKey.localeCompare(b.useKey));
  return {
    empoweredWindows: processes.map(process => ({ owner: process.owner, providerRef: process.providerRef, skillKey: process.skillKey,
      processKey: process.processKey, useRef: process.useKey, startedAtMs: process.startedAtMs, expiresAtMs: process.expiresAtMs!,
      finishedAtMs: process.finishedAtMs, status: process.status, maximumAttackCount: process.empoweredAttackWindow!.maximumAttackCount,
      consumptionCount: process.empoweredAttackWindow!.consumptionCount, pendingHitCount: process.empoweredAttackWindow!.pendingHitCount })),
    empoweredConsumptions: processes.flatMap(process => process.empoweredAttackWindow!.consumptions.map(row => ({ owner: process.owner,
      skillKey: process.skillKey, activationUseRef: process.useKey, ...row })))
  };
}
