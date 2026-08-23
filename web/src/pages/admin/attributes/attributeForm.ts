import type {
  Attribute,
  AttributeStatus,
  AttributeValueType,
  CreateAttributeRequest,
  UpdateAttributeRequest
} from '../../../types/attribute';

export type AttributeEditorMode = 'create' | 'view' | 'edit';

export type AttributeFormField =
  | 'attributeKey'
  | 'name'
  | 'valueType'
  | 'minValue'
  | 'maxValue'
  | 'description'
  | 'status'
  | 'sortOrder';

export type AttributeFormDraft = {
  attributeKey: string;
  name: string;
  valueType: AttributeValueType;
  minValue: string;
  maxValue: string;
  description: string;
  status: AttributeStatus;
  sortOrder: string;
};

export type AttributeFieldErrors = Partial<Record<AttributeFormField, string>>;

export type NormalizedAttributeForm = CreateAttributeRequest;

export type AttributeFormValidation =
  | { ok: true; normalized: NormalizedAttributeForm }
  | { ok: false; fieldErrors: AttributeFieldErrors };

export type MappedAttributeFieldIssues = {
  fieldErrors: AttributeFieldErrors;
  unmappedMessages: string[];
};

export const ATTRIBUTE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

const ATTRIBUTE_FORM_FIELDS = new Set<AttributeFormField>([
  'attributeKey',
  'name',
  'valueType',
  'minValue',
  'maxValue',
  'description',
  'status',
  'sortOrder'
]);

export function createEmptyAttributeDraft(): AttributeFormDraft {
  return {
    attributeKey: '',
    name: '',
    valueType: 'DECIMAL',
    minValue: '',
    maxValue: '',
    description: '',
    status: 'ENABLED',
    sortOrder: '0'
  };
}

export function attributeToDraft(attribute: Attribute): AttributeFormDraft {
  return {
    attributeKey: attribute.attributeKey,
    name: attribute.name,
    valueType: attribute.valueType,
    minValue: attribute.minValue === null ? '' : String(attribute.minValue),
    maxValue: attribute.maxValue === null ? '' : String(attribute.maxValue),
    description: attribute.description ?? '',
    status: attribute.status,
    sortOrder: String(attribute.sortOrder)
  };
}

export function isAttributeDraftDirty(
  draft: AttributeFormDraft,
  baseline: AttributeFormDraft
): boolean {
  return (Object.keys(draft) as AttributeFormField[]).some(
    (field) => draft[field] !== baseline[field]
  );
}

function parseOptionalNumber(
  raw: string,
  field: 'minValue' | 'maxValue',
  errors: AttributeFieldErrors
): number | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    errors[field] = '请输入有效数值。';
    return null;
  }
  return value;
}

export function validateAttributeDraft(
  draft: AttributeFormDraft,
  mode: AttributeEditorMode
): AttributeFormValidation {
  const fieldErrors: AttributeFieldErrors = {};
  const attributeKey = draft.attributeKey.trim();
  const name = draft.name.trim();
  const description = draft.description.trim();

  if (!attributeKey) {
    fieldErrors.attributeKey = '稳定标识不能为空。';
  } else if (!ATTRIBUTE_KEY_PATTERN.test(attributeKey)) {
    fieldErrors.attributeKey = '须以小写字母开头，且只能包含小写字母、数字和下划线，最长 64 位。';
  }

  if (!name) {
    fieldErrors.name = '属性名称不能为空。';
  } else if (name.length > 100) {
    fieldErrors.name = '属性名称不能超过 100 个字符。';
  }

  if (draft.valueType !== 'DECIMAL' && draft.valueType !== 'INTEGER') {
    fieldErrors.valueType = '请选择有效的数值类型。';
  }

  const minValue = parseOptionalNumber(draft.minValue, 'minValue', fieldErrors);
  const maxValue = parseOptionalNumber(draft.maxValue, 'maxValue', fieldErrors);
  if (
    fieldErrors.minValue === undefined &&
    fieldErrors.maxValue === undefined &&
    minValue !== null &&
    maxValue !== null &&
    minValue > maxValue
  ) {
    fieldErrors.maxValue = '最大值不能小于最小值。';
  }

  if (description.length > 2000) {
    fieldErrors.description = '说明不能超过 2000 个字符。';
  }

  if (draft.status !== 'ENABLED' && draft.status !== 'DISABLED') {
    fieldErrors.status = '请选择有效状态。';
  }

  const sortOrderRaw = draft.sortOrder.trim();
  const sortOrder = Number(sortOrderRaw);
  if (!sortOrderRaw) {
    fieldErrors.sortOrder = '排序不能为空。';
  } else if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    fieldErrors.sortOrder = '排序必须是大于等于 0 的整数。';
  }

  if (mode === 'view') {
    return {
      ok: true,
      normalized: {
        attributeKey,
        name,
        valueType: draft.valueType,
        minValue,
        maxValue,
        description: description || null,
        status: draft.status,
        sortOrder: Number.isInteger(sortOrder) && sortOrder >= 0 ? sortOrder : 0
      }
    };
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    normalized: {
      attributeKey,
      name,
      valueType: draft.valueType,
      minValue,
      maxValue,
      description: description || null,
      status: draft.status,
      sortOrder
    }
  };
}

export function buildCreateAttributeRequest(
  normalized: NormalizedAttributeForm
): CreateAttributeRequest {
  return { ...normalized };
}

export function buildUpdateAttributeRequest(
  normalized: NormalizedAttributeForm
): UpdateAttributeRequest {
  const { attributeKey: _attributeKey, ...request } = normalized;
  return request;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function mapAttributeFieldIssues(details: unknown): MappedAttributeFieldIssues {
  const fieldErrors: AttributeFieldErrors = {};
  const unmappedMessages: string[] = [];
  if (!isRecord(details) || !Array.isArray(details.fieldIssues)) {
    return { fieldErrors, unmappedMessages };
  }

  for (const rawIssue of details.fieldIssues) {
    if (!isRecord(rawIssue)) {
      continue;
    }
    const field = typeof rawIssue.field === 'string' ? rawIssue.field : '';
    const message = typeof rawIssue.message === 'string' && rawIssue.message.trim()
      ? rawIssue.message.trim()
      : '字段值不合法。';
    if (ATTRIBUTE_FORM_FIELDS.has(field as AttributeFormField)) {
      fieldErrors[field as AttributeFormField] = message;
    } else {
      unmappedMessages.push(message);
    }
  }
  return { fieldErrors, unmappedMessages };
}
