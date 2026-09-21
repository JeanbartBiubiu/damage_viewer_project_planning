import { ApiRequestError } from '../../../services/apiClient';
import { isStatusKind, type StatusKind } from '../../../types/status';
import type {
  CreateStatusRequest,
  GameStatus,
  StatusRecordStatus,
  UpdateStatusRequest
} from '../../../types/status';

export type StatusDraft = {
  statusKind: StatusKind | '';
  statusKey: string;
  name: string;
  description: string;
  sortOrder: string;
};

export type StatusDraftField = keyof StatusDraft;

export type StatusDraftErrors = Partial<Record<StatusDraftField, string>>;

export type NormalizedStatusForm = {
  statusKind: StatusKind;
  statusKey: string;
  name: string;
  description: string | null;
  sortOrder: number;
};

export type StatusFormValidation =
  | { ok: true; normalized: NormalizedStatusForm }
  | { ok: false; fieldErrors: StatusDraftErrors };

export type MappedStatusFieldIssues = {
  fieldErrors: StatusDraftErrors;
  unmappedMessages: string[];
};

export const STATUS_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

const STATUS_DRAFT_FIELDS = new Set<StatusDraftField>([
  'statusKind',
  'statusKey',
  'name',
  'description',
  'sortOrder'
]);

export function createEmptyStatusDraft(): StatusDraft {
  return {
    statusKind: '',
    statusKey: '',
    name: '',
    description: '',
    sortOrder: '0'
  };
}

export function statusToDraft(status: GameStatus): StatusDraft {
  return {
    statusKind: status.statusKind,
    statusKey: status.statusKey,
    name: status.name,
    description: status.description ?? '',
    sortOrder: String(status.sortOrder)
  };
}

export function validateStatusDraft(
  draft: StatusDraft,
  includeKey: boolean
): StatusFormValidation {
  const fieldErrors: StatusDraftErrors = {};
  const statusKey = draft.statusKey.trim();
  const name = draft.name.trim();
  const description = draft.description.trim();
  if (!isStatusKind(draft.statusKind)) {
    fieldErrors.statusKind = '请选择状态种类';
  }

  if (includeKey) {
    if (!statusKey) {
      fieldErrors.statusKey = '状态标识不能为空';
    } else if (!STATUS_KEY_PATTERN.test(statusKey)) {
      fieldErrors.statusKey = '小写字母开头，只能包含小写字母、数字和下划线';
    }
  }

  if (!name) {
    fieldErrors.name = '状态名称不能为空';
  } else if (name.length > 100) {
    fieldErrors.name = '状态名称不能超过100个字符';
  }

  if (description.length > 2000) {
    fieldErrors.description = '说明不能超过2000个字符';
  }

  const sortOrderRaw = draft.sortOrder.trim();
  const sortOrder = Number(sortOrderRaw);
  if (!sortOrderRaw) {
    fieldErrors.sortOrder = '排序不能为空';
  } else if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    fieldErrors.sortOrder = '排序必须是大于等于0的整数';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    normalized: {
      statusKind: draft.statusKind as StatusKind,
      statusKey,
      name,
      description: description || null,
      sortOrder
    }
  };
}

export function buildCreateStatusRequest(
  normalized: NormalizedStatusForm
): CreateStatusRequest {
  return {
    statusKind: normalized.statusKind,
    statusKey: normalized.statusKey,
    name: normalized.name,
    description: normalized.description,
    status: 'ENABLED',
    sortOrder: normalized.sortOrder
  };
}

export function buildUpdateStatusRequest(
  normalized: NormalizedStatusForm,
  status: StatusRecordStatus
): UpdateStatusRequest {
  return {
    statusKind: normalized.statusKind,
    name: normalized.name,
    description: normalized.description,
    status,
    sortOrder: normalized.sortOrder
  };
}

export function mapStatusFieldIssues(source: unknown): MappedStatusFieldIssues {
  const fieldErrors: StatusDraftErrors = {};
  const unmappedMessages: string[] = [];
  const details = source instanceof ApiRequestError ? source.details : source;
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
    if (STATUS_DRAFT_FIELDS.has(field as StatusDraftField)) {
      fieldErrors[field as StatusDraftField] = message;
    } else if (message) {
      unmappedMessages.push(message);
    }
  }

  return { fieldErrors, unmappedMessages };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
