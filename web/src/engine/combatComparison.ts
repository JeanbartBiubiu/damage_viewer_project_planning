import { simulationSkillSourceIdentity } from '../services/simulationSkillSourceIdentity';
import type { DamageBreakdown, DoneResult, RunRequest, RunSummary } from '../types/genericEngine';
import type { SimulationAvailabilityEntry, SimulationAvailabilityResponse } from '../types/simulationAvailability';
import type { SimulationSelection, SimulationSkillOrigin, SimulationSkillSetting, SimulationSnapshot } from '../types/simulationSnapshot';
import { automaticOrigin } from './automaticSkillPresentation';
import { projectFrozenRunArchive, sanitizeArchiveBusiness } from './continuousAttackArchive';
import type { OperationOrigin, SimulationSkillOriginTrace } from './simulation/model';

export type CombatEquipmentPlan = {
  keys: string[];
  settings: SimulationSkillSetting[];
  aura: Record<string, boolean>;
};

type PlanSide = 'A' | 'B';

function projectEquipmentPlan(keys: readonly string[], ownerOf: (key: string) => CombatEquipmentPlan | undefined): CombatEquipmentPlan {
  const settings: SimulationSkillSetting[] = [];
  const auraEntries: [string, boolean][] = [];
  for (const key of keys) {
    const owner = ownerOf(key);
    if (!owner) continue;
    settings.push(...owner.settings.filter(row => row.origin.kind === 'EQUIPMENT' && row.origin.equipmentKey === key));
    if (Object.prototype.hasOwnProperty.call(owner.aura, key)) auraEntries.push([key, owner.aura[key]]);
  }
  return { keys: [...keys], settings, aura: Object.fromEntries(auraEntries) };
}

/** 方案 B 的生效装备设置。共有装备直接读取方案 A 的设置。 */
export function mergePlanEquipment(a: CombatEquipmentPlan, b: CombatEquipmentPlan): CombatEquipmentPlan {
  const aKeys = new Set(a.keys);
  return projectEquipmentPlan(b.keys, key => aKeys.has(key) ? a : b);
}

/** 返回两个设置槽，方案 B 的槽仅保留自身独有装备的设置。 */
export function transferEquipmentSettingsOnChange(a: CombatEquipmentPlan, b: CombatEquipmentPlan, side: PlanSide,
  keys: readonly string[]): { a: CombatEquipmentPlan; b: CombatEquipmentPlan } {
  const nextAKeys = side === 'A' ? keys : a.keys;
  const nextBKeys = side === 'B' ? keys : b.keys;
  const originalA = new Set(a.keys);
  const originalB = new Set(b.keys);
  const nextA = new Set(nextAKeys);
  const previousOwner = (key: string) => originalA.has(key) ? a : originalB.has(key) ? b : undefined;
  return {
    a: side === 'A' ? projectEquipmentPlan(nextAKeys, previousOwner) : a,
    b: projectEquipmentPlan(nextBKeys, key => !nextA.has(key) && originalB.has(key) ? previousOwner(key) : undefined)
  };
}

export function validateEquipmentComparisonDiff(aKeys: readonly string[], bKeys: readonly string[]) {
  const onlyInA = aKeys.filter(key => !bKeys.includes(key));
  const onlyInB = bKeys.filter(key => !aKeys.includes(key));
  return { onlyInA, onlyInB, valid: onlyInA.length <= 1 && onlyInB.length <= 1 };
}

function isInputRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** 输入应为冻结时使用的同形数据，数组顺序属于输入的一部分。 */
export function matchesFrozenPlanInput(effectiveInput: unknown, frozenInput: unknown): boolean {
  if (effectiveInput === frozenInput) return true;
  if (Array.isArray(effectiveInput)) {
    return Array.isArray(frozenInput) && effectiveInput.length === frozenInput.length
      && effectiveInput.every((value, index) => matchesFrozenPlanInput(value, frozenInput[index]));
  }
  if (!isInputRecord(effectiveInput) || !isInputRecord(frozenInput)) return false;
  const keys = Object.keys(effectiveInput);
  return keys.length === Object.keys(frozenInput).length && keys.every(key =>
    Object.prototype.hasOwnProperty.call(frozenInput, key) && matchesFrozenPlanInput(effectiveInput[key], frozenInput[key]));
}

type AvailabilitySelection = Pick<SimulationSelection, 'sourceCharacterKey' | 'targetCharacterKey'> & {
  sourceEquipmentKeys: readonly string[];
  targetEquipmentKeys: readonly string[];
};
type AvailabilityObjectDigest = { key: string; contentDigest: string; externalDigest: string };
export type CombatComparisonAvailability = Pick<SimulationAvailabilityResponse, 'gameId' | 'scopeDigest' | 'sharedDigest'> & {
  characters: AvailabilityObjectDigest[];
  equipment: AvailabilityObjectDigest[];
};

function selectedAvailabilityDigests(entries: SimulationAvailabilityEntry[], keys: readonly string[]): AvailabilityObjectDigest[] | null {
  const result: AvailabilityObjectDigest[] = [];
  for (const key of [...new Set(keys)].sort()) {
    const entry = entries.find(row => row.key === key);
    if (!entry?.contentDigest || !entry.verification.externalDigest) return null;
    result.push({ key, contentDigest: entry.contentDigest, externalDigest: entry.verification.externalDigest });
  }
  return result;
}

export function captureComparisonAvailability(availability: SimulationAvailabilityResponse | null, selection: AvailabilitySelection): CombatComparisonAvailability | null {
  if (!availability) return null;
  const characters = selectedAvailabilityDigests(availability.characters, [selection.sourceCharacterKey, selection.targetCharacterKey]);
  const equipment = selectedAvailabilityDigests(availability.equipment, [...selection.sourceEquipmentKeys, ...selection.targetEquipmentKeys]);
  if (!characters || !equipment) return null;
  return { gameId: availability.gameId, scopeDigest: availability.scopeDigest, sharedDigest: availability.sharedDigest, characters, equipment };
}

function commonSelection(selection: SimulationSelection, exclusiveEquipment: ReadonlySet<string>) {
  const { sourceEquipmentKeys: _sourceEquipmentKeys, sourceSkillSettings, ...common } = selection;
  return { ...common, sourceSkillSettings: sourceSkillSettings.filter(setting =>
    setting.origin.kind !== 'EQUIPMENT' || !exclusiveEquipment.has(setting.origin.equipmentKey)) };
}

function commonCombatant(combatant: SimulationSnapshot['source'], exclusiveEquipment: ReadonlySet<string>) {
  const { selectedEquipment, skillSources, ...common } = combatant;
  return { ...common,
    selectedEquipment: selectedEquipment.filter(item => !exclusiveEquipment.has(item.equipment.equipmentKey)),
    // 装备可能提供新事件，使共同来源的执行闭包变化。基线比较来源设置和作者定义。
    skillSources: skillSources.filter(row => row.origin.kind !== 'EQUIPMENT' || !exclusiveEquipment.has(row.origin.equipmentKey))
      .map(({ origin, skillKey, enabled, skillLevel, skillStatus }) => ({ origin, skillKey, enabled, skillLevel, skillStatus }))
  };
}

function intersectionAgrees<T>(a: readonly T[], b: readonly T[], keyOf: (row: T) => string,
  agrees: (left: T, right: T) => boolean = matchesFrozenPlanInput): boolean {
  const byKey = new Map(b.map(row => [keyOf(row), row]));
  return a.every(row => {
    const other = byKey.get(keyOf(row));
    return other === undefined || agrees(row, other);
  });
}

export function verifyCommonComparisonBaseline(snapshotA: SimulationSnapshot, snapshotB: SimulationSnapshot): boolean {
  const { onlyInA, onlyInB } = validateEquipmentComparisonDiff(snapshotA.selection.sourceEquipmentKeys, snapshotB.selection.sourceEquipmentKeys);
  const exclusiveA = new Set(onlyInA);
  const exclusiveB = new Set(onlyInB);
  const a = snapshotA.catalogs;
  const b = snapshotB.catalogs;
  const sharedTargetEquipment = new Set<string>();
  return snapshotA.gameId === snapshotB.gameId
    && matchesFrozenPlanInput(commonSelection(snapshotA.selection, exclusiveA), commonSelection(snapshotB.selection, exclusiveB))
    && matchesFrozenPlanInput(commonCombatant(snapshotA.source, exclusiveA), commonCombatant(snapshotB.source, exclusiveB))
    && matchesFrozenPlanInput(commonCombatant(snapshotA.target, sharedTargetEquipment), commonCombatant(snapshotB.target, sharedTargetEquipment))
    && matchesFrozenPlanInput(a.levelConfig, b.levelConfig)
    && matchesFrozenPlanInput(a.vampRules, b.vampRules)
    && matchesFrozenPlanInput(a.calculationRules, b.calculationRules)
    && intersectionAgrees(snapshotA.skillConfigurations, snapshotB.skillConfigurations, row => row.skill.skillKey,
      (left, right) => left.baseDigest === right.baseDigest)
    && intersectionAgrees(a.attributes, b.attributes, row => row.attributeKey)
    && intersectionAgrees(a.skillCategories, b.skillCategories, row => row.skillCategoryKey)
    && intersectionAgrees(a.damageTypes, b.damageTypes, row => row.type.damageTypeKey)
    && intersectionAgrees(a.modifierZones, b.modifierZones, row => row.modifierZoneKey)
    && intersectionAgrees(a.statuses, b.statuses, row => row.statusKey);
}

/** 两类冻结运行档案提供的比较事实。档案导出沿用原有业务字段投影。 */
export type CombatComparisonArchive = {
  taskKind: 'automatic_skill' | 'continuous_attack';
  snapshot: SimulationSnapshot;
  wasm: { sha256: string };
  adapterVersion: string;
  outcome: 'passed' | 'failed' | 'cancelled';
  cleanup: 'released' | 'not_needed' | 'worker_destroyed' | 'release_failed';
  assessment: { complete: boolean; factsValid: boolean; seriesIssues?: readonly string[] } | null;
  runRequest: RunRequest | null;
  runResult: DoneResult | null;
  operationOrigins: OperationOrigin[];
  skillOrigins: SimulationSkillOriginTrace[];
};

export type CombatComparisonStopCategory = 'incomplete' | 'both_full_duration' | 'target_killed' | 'early_stop_non_kill';
type MetricKey = 'sourceDamageDealt' | 'targetHpLoss' | 'targetFinalHp' | 'targetShieldAbsorbed' | 'sourceShieldAbsorbed'
  | 'sourceDirectHealing' | 'sourceVampHealing' | 'averageDps' | 'targetKilledAtMs';

export type CombatComparisonMetric = {
  key: MetricKey;
  label: string;
  a: number | null;
  b: number | null;
  delta: number | null;
  relativeDelta: number | null;
  reason?: string;
};

export type CombatComparisonSource = {
  kind: 'paired' | 'only_a' | 'only_b' | 'unpaired';
  key: string;
  label: string;
  amountA: number | null;
  amountB: number | null;
  delta: number | null;
  relativeDelta: number | null;
  countA: number | null;
  countB: number | null;
  reason?: string;
};

export type CombatComparisonAssessment = {
  stopCategory: CombatComparisonStopCategory;
  metrics: CombatComparisonMetric[];
  sources: CombatComparisonSource[];
  detailsTruncated: boolean;
};

function completedExecution(archive: CombatComparisonArchive) {
  const summary = archive.runResult?.summary;
  if (archive.outcome !== 'passed' || archive.cleanup !== 'released' || archive.assessment?.complete !== true
    || archive.assessment.factsValid !== true || (archive.assessment.seriesIssues?.length ?? 0) > 0
    || summary?.execution?.complete !== true || summary.stopReason === 'budget_exceeded') return null;
  return { summary, execution: summary.execution };
}

function stopCategory(a: CombatComparisonArchive, b: CombatComparisonArchive): CombatComparisonStopCategory {
  const left = completedExecution(a);
  const right = completedExecution(b);
  if (!left || !right || a.wasm.sha256 !== b.wasm.sha256 || a.adapterVersion !== b.adapterVersion
    || left.execution.requestedDurationMs !== right.execution.requestedDurationMs) return 'incomplete';
  if (left.execution.targetKilled || right.execution.targetKilled) return 'target_killed';
  const reachedEnd = (run: typeof left) => run.summary.stopReason === 'duration_reached'
    && run.summary.durationMs === run.execution.requestedDurationMs;
  return reachedEnd(left) && reachedEnd(right) ? 'both_full_duration' : 'early_stop_non_kill';
}

function differences(a: number | null, b: number | null, comparable: boolean, relative = true) {
  const delta = comparable && a !== null && b !== null ? b - a : null;
  return { delta, relativeDelta: relative && delta !== null && a !== null && a > 0 ? delta / a : null };
}

function absorbedShield(summary: RunSummary | undefined, target: 'source' | 'target'): number | null {
  return summary?.damageBreakdown?.reduce((sum, row) =>
    row.target === target && row.source === (target === 'target' ? 'source' : 'target') ? sum + row.shieldAbsorbed : sum, 0) ?? null;
}

function averageDps(summary: RunSummary | undefined): number | null {
  return summary && summary.durationMs > 0 ? summary.sourceDamageDealt / (summary.durationMs / 1000) : null;
}

function killTime(summary: RunSummary | undefined): number | null {
  return summary?.execution?.targetKilled ? summary.execution.targetKilledAtMs : null;
}

function compareMetrics(a: RunSummary | undefined, b: RunSummary | undefined, comparable: boolean): CombatComparisonMetric[] {
  const metric = (key: MetricKey, label: string, left: number | null, right: number | null,
    compare = comparable, relative = true, reason?: string): CombatComparisonMetric => {
    const delta = differences(left, right, compare, relative);
    const note = reason ?? (relative && delta.delta !== null && left === 0 ? '不适用（基准为 0）' : undefined);
    return { key, label, a: left, b: right, ...delta, ...(note ? { reason: note } : {}) };
  };
  const metrics = [
    metric('sourceDamageDealt', '攻击方造成伤害', a?.sourceDamageDealt ?? null, b?.sourceDamageDealt ?? null),
    metric('targetHpLoss', '目标实际扣血', a?.targetHpLoss ?? null, b?.targetHpLoss ?? null),
    metric('targetFinalHp', '目标最终剩余生命', a?.targetFinalHp ?? null, b?.targetFinalHp ?? null),
    metric('targetShieldAbsorbed', '目标护盾吸收', absorbedShield(a, 'target'), absorbedShield(b, 'target'))
  ];
  const sourceShieldA = absorbedShield(a, 'source');
  const sourceShieldB = absorbedShield(b, 'source');
  if ((sourceShieldA ?? 0) > 0 || (sourceShieldB ?? 0) > 0) {
    metrics.push(metric('sourceShieldAbsorbed', '攻击方护盾吸收', sourceShieldA, sourceShieldB));
  }
  metrics.push(
    metric('sourceDirectHealing', '攻击方直接治疗', a?.sourceDirectHealing ?? null, b?.sourceDirectHealing ?? null),
    metric('sourceVampHealing', '攻击方实际吸血', a?.sourceVampHealing ?? null, b?.sourceVampHealing ?? null)
  );
  const durationA = a?.durationMs;
  const durationB = b?.durationMs;
  const samePositiveDuration = durationA !== undefined && durationA === durationB && durationA > 0;
  let dpsReason: string | undefined;
  if (comparable) {
    if (durationA === 0 || durationB === 0) dpsReason = '0 毫秒停止，平均 DPS 不适用';
    else if (durationA !== durationB) dpsReason = '停止时刻不同，不按不同分母比较全场平均 DPS';
  }
  metrics.push(
    metric('averageDps', '攻击方全场平均 DPS', averageDps(a), averageDps(b), comparable && samePositiveDuration, true, dpsReason),
    metric('targetKilledAtMs', '目标击杀时刻', killTime(a), killTime(b), comparable, false)
  );
  return metrics;
}

function hasTruncatedDetails(archive: CombatComparisonArchive): boolean {
  const result = archive.runResult;
  return archive.runRequest?.outputMode === 'summary' || result?.outputMode === 'summary' || result?.automaticSkillRecording?.truncated === true
    || Object.entries(result?.recording ?? {}).some(([key, value]) => key.endsWith('Truncated') && value === true);
}

type ResolvedBreakdown = {
  row: DamageBreakdown;
  operation: OperationOrigin | null;
  key: string | null;
  label: string;
  reason?: string;
};

const basicAttackMount = 'selected_basic_attack';
const mountPattern = /^(?:source|target)\.provider\[([^\]]+)\]\.ability\[/;

function damageSkillOrigin(archive: CombatComparisonArchive, row: DamageBreakdown, operation: OperationOrigin): SimulationSkillOrigin | null {
  const mount = mountPattern.exec(row.abilityRef)?.[1];
  if (mount === basicAttackMount && operation.skillKey === archive.snapshot.selection.basicAttackSkillKey
    && (row.owner === 'source' || row.owner === 'target')) {
    return { kind: 'CHARACTER', characterKey: archive.snapshot[row.owner].character.characterKey };
  }
  const enabled = archive.skillOrigins.filter(trace => trace.side === row.owner && trace.skillKey === operation.skillKey && trace.enabled);
  // 合并进普攻的附伤分类可能累计多个构筑槽位，只有唯一启用来源可还原。
  if (mount === basicAttackMount) return enabled.length === 1 ? enabled[0].origin : null;
  const exact = enabled.filter(trace => (mount !== undefined && trace.providerRef === mount)
    || (row.providerDefinitionRef !== undefined && trace.definitionRef === row.providerDefinitionRef));
  return exact.length === 1 ? exact[0].origin : null;
}

function breakdownLabel(snapshot: SimulationSnapshot, row: DamageBreakdown, operation: OperationOrigin | null, origin: SimulationSkillOrigin | null): string {
  const actor = row.owner === 'source' || row.owner === 'target' ? snapshot[row.owner] : null;
  let originLabel: string | undefined;
  if (origin?.kind === 'CHARACTER') originLabel = actor?.character.name ?? origin.characterKey;
  if (origin?.kind === 'EQUIPMENT') {
    originLabel = actor?.selectedEquipment.find(item => item.equipment.equipmentKey === origin.equipmentKey)?.equipment.name ?? origin.equipmentKey;
  }
  if (origin?.kind === 'BUILD_OPTION') {
    const option = actor?.selectedBuilds.find(build => build.definition.system.systemKey === origin.systemKey)?.definition.options
      .find(item => item.optionKey === origin.optionKey);
    originLabel = `${option?.name ?? origin.optionKey}（${origin.slotKey}）`;
  }
  const skill = operation && snapshot.skillConfigurations.find(row => row.skill.skillKey === operation.skillKey);
  const effect = operation && skill && skill.effects.find(row => row.effectKey === operation.effectKey);
  const result = operation && effect && effect.results.find(row => row.resultKey === operation.resultKey);
  const type = snapshot.catalogs.damageTypes.find(item => item.type.damageTypeKey === row.damageType)?.type.name ?? row.damageType;
  const sideLabel = (side: string) => side === 'source' ? '攻击方' : side === 'target' ? '目标' : side;
  return [`${sideLabel(row.source)} → ${sideLabel(row.target)}`, originLabel, skill ? skill.skill.name : operation?.skillKey,
    result ? result.name : operation?.resultKey ?? row.operationRef, type].filter(Boolean).join(' · ');
}

function resolveBreakdowns(archive: CombatComparisonArchive): ResolvedBreakdown[] {
  const keyCounts = new Map<string, number>();
  const rows = (archive.runResult?.summary.damageBreakdown ?? []).map(row => {
    const { origin: operation, issue } = automaticOrigin(archive.operationOrigins, row);
    const origin = operation && damageSkillOrigin(archive, row, operation);
    const key = operation && origin ? JSON.stringify([row.owner, row.source, row.target,
      simulationSkillSourceIdentity(origin, operation.skillKey), operation.effectKey, operation.resultKey, row.damageType]) : null;
    if (key !== null) keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    return { row, operation, key, label: breakdownLabel(archive.snapshot, row, operation, origin),
      ...(key === null ? { reason: issue ?? '冻结来源无法唯一还原，保留该行的结算合计。' } : {}) };
  });
  return rows.map(entry => entry.key !== null && (keyCounts.get(entry.key) ?? 0) > 1
    ? { ...entry, key: null, reason: '同一作者来源对应多条分类行，分别列出。' } : entry);
}

function potentiallyMatches(known: ResolvedBreakdown, unresolved: ResolvedBreakdown, skillKeys: ReadonlySet<string>): boolean {
  const a = known.row;
  const b = unresolved.row;
  if (a.owner !== b.owner || a.source !== b.source || a.target !== b.target || a.damageType !== b.damageType) return false;
  if (a.operationRef === b.operationRef) return true;
  if (!known.operation) return false;
  return unresolved.operation ? known.operation.skillKey === unresolved.operation.skillKey : skillKeys.has(known.operation.skillKey);
}

function unpairedSource(entry: ResolvedBreakdown, side: PlanSide, index: number, reason: string | undefined): CombatComparisonSource {
  const { row, label } = entry;
  return { kind: 'unpaired', key: `unpaired_${side}_${index}`, label,
    amountA: side === 'A' ? row.postDefenseDamage : null, amountB: side === 'B' ? row.postDefenseDamage : null,
    countA: side === 'A' ? row.damageCount : null, countB: side === 'B' ? row.damageCount : null,
    delta: null, relativeDelta: null, ...(reason ? { reason } : {}) };
}

function comparableSource(key: string, label: string, a: DamageBreakdown | undefined, b: DamageBreakdown | undefined): CombatComparisonSource {
  const amountA = a?.postDefenseDamage ?? 0;
  const amountB = b?.postDefenseDamage ?? 0;
  return { kind: !a ? 'only_b' : !b ? 'only_a' : 'paired', key, label, amountA, amountB,
    countA: a?.damageCount ?? 0, countB: b?.damageCount ?? 0, ...differences(amountA, amountB, true) };
}

function compareDamageBreakdowns(a: CombatComparisonArchive, b: CombatComparisonArchive, comparable: boolean): CombatComparisonSource[] {
  const left = resolveBreakdowns(a);
  const right = resolveBreakdowns(b);
  if (!comparable) {
    const reason = '计算未完整完成或结果核对未通过，仅供排错。';
    return [...left.map((entry, index) => unpairedSource(entry, 'A', index, reason)),
      ...right.map((entry, index) => unpairedSource(entry, 'B', index, reason))];
  }
  const pairedRight = new Map(right.map(entry => [entry.key, entry]));
  const matched = new Set<string>();
  const unresolvedA = left.filter(entry => entry.key === null);
  const unresolvedB = right.filter(entry => entry.key === null);
  const skillKeysA = new Set(a.snapshot.skillConfigurations.map(row => row.skill.skillKey));
  const skillKeysB = new Set(b.snapshot.skillConfigurations.map(row => row.skill.skillKey));
  const possibleMatchReason = '另一方案存在可能对应的未还原来源，双方独立列出。';
  const sources = left.map((entry, index) => {
    if (entry.key === null) return unpairedSource(entry, 'A', index, entry.reason);
    const other = pairedRight.get(entry.key);
    if (other) {
      matched.add(entry.key);
      return comparableSource(entry.key, entry.label, entry.row, other.row);
    }
    if (unresolvedB.some(row => potentiallyMatches(entry, row, skillKeysB))) return unpairedSource(entry, 'A', index, possibleMatchReason);
    return comparableSource(entry.key, entry.label, entry.row, undefined);
  });
  for (const [index, entry] of right.entries()) {
    if (entry.key === null) sources.push(unpairedSource(entry, 'B', index, entry.reason));
    else if (!matched.has(entry.key)) {
      if (unresolvedA.some(row => potentiallyMatches(entry, row, skillKeysA))) sources.push(unpairedSource(entry, 'B', index, possibleMatchReason));
      else sources.push(comparableSource(entry.key, entry.label, undefined, entry.row));
    }
  }
  return sources;
}

export function assessCombatComparison(a: CombatComparisonArchive, b: CombatComparisonArchive): CombatComparisonAssessment {
  const category = stopCategory(a, b);
  const comparable = category !== 'incomplete';
  return {
    stopCategory: category,
    metrics: compareMetrics(a.runResult?.summary, b.runResult?.summary, comparable),
    sources: compareDamageBreakdowns(a, b, comparable),
    detailsTruncated: hasTruncatedDetails(a) || hasTruncatedDetails(b)
  };
}

export function buildCombatComparisonArchive(a: CombatComparisonArchive, b: CombatComparisonArchive, assessment: CombatComparisonAssessment) {
  return { taskKind: 'combat_comparison', displayDefinitionVersion: 1,
    a: projectFrozenRunArchive(a), b: projectFrozenRunArchive(b), assessment: sanitizeArchiveBusiness(assessment) };
}
