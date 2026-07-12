/** Server-forbidden fields rejected recursively on Admin combat-data PUT bodies. */
export const FORBIDDEN_ADMIN_PAYLOAD_KEYS = new Set(
  [
    'changeRevision',
    'change_revision',
    'currentRevision',
    'current_revision',
    'publishedRevision',
    'published_revision',
    'versionId',
    'version_id',
    'versionCode',
    'version_code',
    'startVersionId',
    'start_version_id',
    'endVersionId',
    'end_version_id',
    'isCurrent',
    'is_current',
    'dataHash',
    'data_hash',
    'updatedAt',
    'updated_at'
  ].map((key) => key.toLowerCase())
);

export class AdminPayloadError extends Error {
  path: string;

  constructor(message: string, path: string) {
    super(message);
    this.name = 'AdminPayloadError';
    this.path = path;
  }
}

/**
 * Recursively strip forbidden server/version metadata from an Admin PUT body.
 * JSONB fields (expression/extend/payload) stay as objects — never stringified.
 */
export function sanitizeAdminPayload<T>(input: T, path = '$'): T {
  if (input === null || input === undefined) {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item, index) => sanitizeAdminPayload(item, `${path}[${index}]`)) as T;
  }

  if (typeof input !== 'object') {
    return input;
  }

  const source = input as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (FORBIDDEN_ADMIN_PAYLOAD_KEYS.has(key.toLowerCase())) {
      continue;
    }
    result[key] = sanitizeAdminPayload(value, `${path}.${key}`);
  }

  return result as T;
}

export const EFFECT_STEP_DETAIL_KEYS = [
  'damageDetail',
  'healDetail',
  'resourceDetail',
  'attributeDetail',
  'shieldDetail',
  'providerDetail',
  'eventDetail',
  'abilityControlDetail',
  'stateDetail'
] as const;

export type EffectStepDetailKey = (typeof EFFECT_STEP_DETAIL_KEYS)[number];

/**
 * Ensure an effect-step PUT body has exactly one detail key.
 * When switching operation family, callers should pass only the active detail.
 */
export function assertExactlyOneEffectDetail(
  body: Record<string, unknown>
): EffectStepDetailKey {
  const present = EFFECT_STEP_DETAIL_KEYS.filter((key) => {
    const value = body[key];
    return value !== undefined && value !== null;
  });

  if (present.length === 0) {
    throw new AdminPayloadError(
      'effect-step PUT requires exactly one detail key; found 0',
      'detail'
    );
  }

  if (present.length > 1) {
    throw new AdminPayloadError(
      `effect-step PUT requires exactly one detail key; found ${present.length}: ${present.join(', ')}`,
      'detail'
    );
  }

  return present[0];
}

/** Build a clean effect-step PUT body keeping only the selected detail family. */
export function buildEffectStepPutBody(
  common: Record<string, unknown>,
  detailKey: EffectStepDetailKey,
  detail: Record<string, unknown>
): Record<string, unknown> {
  const cleanedCommon = sanitizeAdminPayload(common);
  const cleanedDetail = sanitizeAdminPayload(detail);
  const body: Record<string, unknown> = { ...cleanedCommon, [detailKey]: cleanedDetail };
  assertExactlyOneEffectDetail(body);
  return body;
}
