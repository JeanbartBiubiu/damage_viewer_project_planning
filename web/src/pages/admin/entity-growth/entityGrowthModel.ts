import type {
  EntityAttribute,
  EntityAttributeStage,
  EntityBatchPutBody,
  EntityResource,
  EntityResourceStage,
  ProgressionSchema
} from '../../../types/combatData';

/** LoL entity-editor contract mirrored by the backend `:batch` endpoint. */
export const ENTITY_GROWTH_STAGE_MIN = 1;
export const ENTITY_GROWTH_STAGE_MAX = 18;
export const ENTITY_GROWTH_STAGE_COUNT = ENTITY_GROWTH_STAGE_MAX - ENTITY_GROWTH_STAGE_MIN + 1;

export type EntityGrowthSchemaGate =
  | { ok: true }
  | { ok: false; reason: string };

export type AttributeStageDraft = {
  stage: number;
  /** Null means missing / empty in the work area. */
  value: number | null;
};

export type AttributeCurveDraft = {
  attrKey: string;
  baseValue: number | null;
  stages: AttributeStageDraft[];
};

export type ResourceStageDraft = {
  stage: number;
  initialValue: number | null;
  maxValue: number | null;
};

export type ResourceCurveDraft = {
  resourceKey: string;
  initialValue: number | null;
  maxValue: number | null;
  stages: ResourceStageDraft[];
};

export type LabelledOption = {
  value: string;
  label: string;
};

/** Require LEVEL with stages exactly 1..18; never invent defaults. */
export function evaluateEntityGrowthSchema(
  schema: ProgressionSchema | null | undefined
): EntityGrowthSchemaGate {
  if (!schema) {
    return {
      ok: false,
      reason: '未加载到 progression schema。本页仅支持 LEVEL 1..18，请先配置成长 Schema。'
    };
  }

  if (
    schema.progressionKind !== 'LEVEL' ||
    schema.stageMin !== ENTITY_GROWTH_STAGE_MIN ||
    schema.stageMax !== ENTITY_GROWTH_STAGE_MAX
  ) {
    return {
      ok: false,
      reason: `当前 progression schema 为 ${schema.progressionKind} ${schema.stageMin}..${schema.stageMax}，本页仅支持 LEVEL 1..18。`
    };
  }

  return { ok: true };
}

export function formatStableLabel(stableId: string, displayName?: string | null): string {
  const name = displayName?.trim();
  return name ? `${stableId} / ${name}` : stableId;
}

export function buildLabelledOptions(
  items: Array<{ id: string; displayName?: string | null }>
): LabelledOption[] {
  return items
    .map((item) => ({
      value: item.id,
      label: formatStableLabel(item.id, item.displayName)
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
}

function emptyAttributeStages(): AttributeStageDraft[] {
  const stages: AttributeStageDraft[] = [];
  for (let stage = ENTITY_GROWTH_STAGE_MIN; stage <= ENTITY_GROWTH_STAGE_MAX; stage += 1) {
    stages.push({ stage, value: null });
  }
  return stages;
}

function emptyResourceStages(): ResourceStageDraft[] {
  const stages: ResourceStageDraft[] = [];
  for (let stage = ENTITY_GROWTH_STAGE_MIN; stage <= ENTITY_GROWTH_STAGE_MAX; stage += 1) {
    stages.push({ stage, initialValue: null, maxValue: null });
  }
  return stages;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Materialize a full 1..18 attribute curve from scoped server rows (missing cells stay null). */
export function materializeAttributeCurve(
  attrKey: string,
  base: EntityAttribute | undefined,
  stageRows: EntityAttributeStage[]
): AttributeCurveDraft {
  const byStage = new Map<number, number>();
  for (const row of stageRows) {
    if (row.attrKey !== attrKey) {
      continue;
    }
    if (
      row.stage >= ENTITY_GROWTH_STAGE_MIN &&
      row.stage <= ENTITY_GROWTH_STAGE_MAX &&
      isFiniteNumber(row.value)
    ) {
      byStage.set(row.stage, row.value);
    }
  }

  const stages = emptyAttributeStages().map((cell) => ({
    stage: cell.stage,
    value: byStage.has(cell.stage) ? (byStage.get(cell.stage) as number) : null
  }));

  return {
    attrKey,
    baseValue: base && isFiniteNumber(base.baseValue) ? base.baseValue : null,
    stages
  };
}

/** Materialize a full 1..18 resource curve from scoped server rows (missing cells stay null). */
export function materializeResourceCurve(
  resourceKey: string,
  base: EntityResource | undefined,
  stageRows: EntityResourceStage[]
): ResourceCurveDraft {
  const byStage = new Map<number, { initialValue: number; maxValue: number }>();
  for (const row of stageRows) {
    if (row.resourceKey !== resourceKey) {
      continue;
    }
    if (
      row.stage >= ENTITY_GROWTH_STAGE_MIN &&
      row.stage <= ENTITY_GROWTH_STAGE_MAX &&
      isFiniteNumber(row.initialValue) &&
      isFiniteNumber(row.maxValue)
    ) {
      byStage.set(row.stage, { initialValue: row.initialValue, maxValue: row.maxValue });
    }
  }

  const stages = emptyResourceStages().map((cell) => {
    const found = byStage.get(cell.stage);
    return {
      stage: cell.stage,
      initialValue: found ? found.initialValue : null,
      maxValue: found ? found.maxValue : null
    };
  });

  return {
    resourceKey,
    initialValue: base && isFiniteNumber(base.initialValue) ? base.initialValue : null,
    maxValue: base && isFiniteNumber(base.maxValue) ? base.maxValue : null,
    stages
  };
}

export function countFilledAttributeStages(curve: AttributeCurveDraft): number {
  return curve.stages.filter((cell) => isFiniteNumber(cell.value)).length;
}

export function countFilledResourceStages(curve: ResourceCurveDraft): number {
  return curve.stages.filter(
    (cell) => isFiniteNumber(cell.initialValue) && isFiniteNumber(cell.maxValue)
  ).length;
}

export function isAttributeCurveComplete(curve: AttributeCurveDraft): boolean {
  if (!isFiniteNumber(curve.baseValue)) {
    return false;
  }
  if (curve.stages.length !== ENTITY_GROWTH_STAGE_COUNT) {
    return false;
  }
  const seen = new Set<number>();
  for (const cell of curve.stages) {
    if (
      cell.stage < ENTITY_GROWTH_STAGE_MIN ||
      cell.stage > ENTITY_GROWTH_STAGE_MAX ||
      seen.has(cell.stage) ||
      !isFiniteNumber(cell.value)
    ) {
      return false;
    }
    seen.add(cell.stage);
  }
  return seen.size === ENTITY_GROWTH_STAGE_COUNT;
}

export function isResourceCurveComplete(curve: ResourceCurveDraft): boolean {
  if (!isFiniteNumber(curve.initialValue) || !isFiniteNumber(curve.maxValue)) {
    return false;
  }
  if (curve.stages.length !== ENTITY_GROWTH_STAGE_COUNT) {
    return false;
  }
  const seen = new Set<number>();
  for (const cell of curve.stages) {
    if (
      cell.stage < ENTITY_GROWTH_STAGE_MIN ||
      cell.stage > ENTITY_GROWTH_STAGE_MAX ||
      seen.has(cell.stage) ||
      !isFiniteNumber(cell.initialValue) ||
      !isFiniteNumber(cell.maxValue)
    ) {
      return false;
    }
    seen.add(cell.stage);
  }
  return seen.size === ENTITY_GROWTH_STAGE_COUNT;
}

export type EntityDisplayMeta = {
  displayName: string;
  description?: string;
  /**
   * May be present on a loaded entity row. Entity Growth does not edit bindings in Rev4;
   * batch builders must omit imageUri even when this is set.
   */
  imageUri?: string | null;
};

/** Production assertion: growth batch bodies never carry imageUri. */
export function assertEntityGrowthBatchOmitsImageUri(body: EntityBatchPutBody): void {
  if (Object.prototype.hasOwnProperty.call(body, 'imageUri')) {
    throw new Error('Entity Growth batch must omit imageUri (this page does not own binding edits).');
  }
}

/**
 * Build one attribute-curve aggregate request. Returns null when the curve is incomplete.
 * Does not include resources, providerMounts, or imageUri (omitted = untouched).
 */
export function buildAttributeCurveBatchBody(
  expectedCurrentRevision: number,
  meta: EntityDisplayMeta,
  curve: AttributeCurveDraft
): EntityBatchPutBody | null {
  if (!isAttributeCurveComplete(curve) || !isFiniteNumber(curve.baseValue)) {
    return null;
  }

  const body: EntityBatchPutBody = {
    expectedCurrentRevision,
    displayName: meta.displayName,
    attributes: [
      {
        attrKey: curve.attrKey,
        baseValue: curve.baseValue,
        stages: curve.stages.map((cell) => ({
          stage: cell.stage,
          value: cell.value as number
        }))
      }
    ]
  };

  if (meta.description !== undefined) {
    body.description = meta.description;
  }

  // Intentionally ignore meta.imageUri — growth page does not own binding edits.
  assertEntityGrowthBatchOmitsImageUri(body);
  return body;
}

/**
 * Build one resource-curve aggregate request. Returns null when the curve is incomplete.
 * Does not include attributes, providerMounts, or imageUri (omitted = untouched).
 */
export function buildResourceCurveBatchBody(
  expectedCurrentRevision: number,
  meta: EntityDisplayMeta,
  curve: ResourceCurveDraft
): EntityBatchPutBody | null {
  if (
    !isResourceCurveComplete(curve) ||
    !isFiniteNumber(curve.initialValue) ||
    !isFiniteNumber(curve.maxValue)
  ) {
    return null;
  }

  const body: EntityBatchPutBody = {
    expectedCurrentRevision,
    displayName: meta.displayName,
    resources: [
      {
        resourceKey: curve.resourceKey,
        initialValue: curve.initialValue,
        maxValue: curve.maxValue,
        stages: curve.stages.map((cell) => ({
          stage: cell.stage,
          initialValue: cell.initialValue as number,
          maxValue: cell.maxValue as number
        }))
      }
    ]
  };

  if (meta.description !== undefined) {
    body.description = meta.description;
  }

  assertEntityGrowthBatchOmitsImageUri(body);
  return body;
}

/** Parse a numeric input field; empty → null; invalid → null with invalid flag via NaN check at call site. */
export function parseNumericInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function isNumericInputValid(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) {
    return false;
  }
  return Number.isFinite(Number(trimmed));
}
