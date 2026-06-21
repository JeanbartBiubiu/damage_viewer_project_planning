import type {
  CoefficientBucket,
  FormulaBinding,
  FormulaProfile,
  JsonObject,
  StatusActionControlRule
} from '../../types/api';

export type AdminResourceKind = 'formulaProfiles' | 'formulaBindings' | 'coefficientBuckets' | 'statusActionControlRules';

export type AdminResourceNavigationItem = {
  id: AdminResourceKind;
  hashSegment: string;
  label: string;
  summary: string;
};

export type AdminSnapshot = {
  coefficientBuckets: CoefficientBucket[];
  statusActionControlRules: StatusActionControlRule[];
  formulaProfiles: FormulaProfile[];
  formulaBindings: FormulaBinding[];
};

export type AdminResourceRecordMap = {
  formulaProfiles: FormulaProfile;
  formulaBindings: FormulaBinding;
  coefficientBuckets: CoefficientBucket;
  statusActionControlRules: StatusActionControlRule;
};

export type AdminResourceRecord = AdminResourceRecordMap[AdminResourceKind];

export type AdminResourceRow = {
  key: string;
  primary: string;
  secondary: string;
  tertiary: string;
  quaternary: string;
  note: string;
};

export type AdminFieldKind = 'text' | 'number' | 'json' | 'textarea' | 'select';

export type AdminFieldOption = {
  label: string;
  value: string;
};

export type AdminCreateFieldDefinition = {
  field: string;
  label: string;
  placeholder?: string;
  kind: AdminFieldKind;
  helper?: string;
  options?: AdminFieldOption[];
  rows?: number;
};

export type AdminCreateDraftMap = {
  formulaProfiles: {
    formulaId: string;
    formulaType: string;
    formulaKind: string;
    description: string;
    paramsText: string;
  };
  formulaBindings: {
    targetCategory: string;
    targetId: string;
    bindingKey: string;
    formulaId: string;
    overrideParamsText: string;
  };
  coefficientBuckets: {
    bucketKey: string;
    resolutionDomain: string;
    stageKey: string;
    targetAttrKey: string;
    aggregationMode: string;
    description: string;
    editorHintText: string;
    bucketConfigText: string;
  };
  statusActionControlRules: {
    ruleId: string;
    statusTypeId: string;
    ruleKind: string;
    actionTypeIdsText: string;
    actionMatchTypeIdsText: string;
    interruptPhaseTypeIdsText: string;
    priority: string;
    description: string;
    extendText: string;
  };
};

export type AdminResourceDefinition<TKind extends AdminResourceKind = AdminResourceKind> = {
  kind: TKind;
  hashSegment: string;
  label: string;
  summary: string;
  description: string;
  listColumns: string[];
  createFields: AdminCreateFieldDefinition[];
  createDraft: () => AdminCreateDraftMap[TKind];
  buildRows: (snapshot: AdminSnapshot) => AdminResourceRow[];
  getRecordKey: (record: AdminResourceRecordMap[TKind]) => string;
  buildCreateKey: (draft: AdminCreateDraftMap[TKind]) => string | null;
  buildCreatePayload: (draft: AdminCreateDraftMap[TKind]) => JsonObject;
};

type AdminResourceDefinitionMap = {
  formulaProfiles: AdminResourceDefinition<'formulaProfiles'>;
  formulaBindings: AdminResourceDefinition<'formulaBindings'>;
  coefficientBuckets: AdminResourceDefinition<'coefficientBuckets'>;
  statusActionControlRules: AdminResourceDefinition<'statusActionControlRules'>;
};

export const adminResourceKinds: AdminResourceKind[] = [
  'formulaProfiles',
  'formulaBindings',
  'coefficientBuckets',
  'statusActionControlRules'
];

export const adminResourceNavigationItems: AdminResourceNavigationItem[] = [
  {
    id: 'formulaProfiles' as const,
    hashSegment: 'formula-profiles',
    label: '公式档案',
    summary: '管理伤害计算使用的公式定义'
  },
  {
    id: 'formulaBindings' as const,
    hashSegment: 'formula-bindings',
    label: '公式绑定',
    summary: '把公式挂到目标类别、目标 ID 和 bindingKey'
  },
  {
    id: 'coefficientBuckets' as const,
    hashSegment: 'coefficient-buckets',
    label: '乘区桶',
    summary: '维护属性域与伤害域的聚合桶'
  },
  {
    id: 'statusActionControlRules' as const,
    hashSegment: 'status-action-control-rules',
    label: '状态动作规则',
    summary: '维护禁用、打断与动作限制'
  }
];

export const adminResourceHashMap: Record<string, AdminResourceKind> = {
  'formula-profiles': 'formulaProfiles',
  'formula-bindings': 'formulaBindings',
  'coefficient-buckets': 'coefficientBuckets',
  'status-action-control-rules': 'statusActionControlRules'
};

const emptyJsonObject: JsonObject = {};

function parseJsonObject(text: string): JsonObject {
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('需要提供 JSON 对象。');
  }

  return parsed as JsonObject;
}

function parseJsonNumberArray(text: string): number[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('需要提供 JSON 数组。');
  }

  return parsed.map((value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      throw new Error('数组里的值必须是数字。');
    }
    return numeric;
  });
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function encodeFormulaBindingKey(targetCategory: string, targetId: string, bindingKey: string): string {
  return `${targetCategory}|${targetId}|${bindingKey}`;
}

function decodeFormulaBindingKey(value: string) {
  const [targetCategory = '', targetId = '', bindingKey = ''] = value.split('|');
  return { targetCategory, targetId, bindingKey };
}

function createResourceRows<TRecord extends AdminResourceRecord>(
  records: TRecord[],
  pickKey: (record: TRecord) => string,
  pickPrimary: (record: TRecord) => string,
  pickSecondary: (record: TRecord) => string,
  pickTertiary: (record: TRecord) => string,
  pickQuaternary: (record: TRecord) => string,
  pickNote: (record: TRecord) => string
): AdminResourceRow[] {
  return records.map((record) => ({
    key: pickKey(record),
    primary: pickPrimary(record),
    secondary: pickSecondary(record),
    tertiary: pickTertiary(record),
    quaternary: pickQuaternary(record),
    note: pickNote(record)
  }));
}

const formulaProfileDefinition: AdminResourceDefinition<'formulaProfiles'> = {
  kind: 'formulaProfiles',
  hashSegment: 'formula-profiles',
  label: '公式档案',
  summary: '资源驱动的公式定义编辑页',
  description: '管理公式定义本身、公式类型、公式种类和序列化参数。',
  listColumns: ['formulaId', 'formulaType', 'formulaKind', 'updatedAt'],
  createFields: [
    { field: 'formulaId', label: '公式 ID', kind: 'text', placeholder: 'damage.skill.katarina.r.base' },
    { field: 'formulaType', label: '公式类型', kind: 'text', placeholder: 'damage' },
    { field: 'formulaKind', label: '公式种类', kind: 'text', placeholder: 'base' },
    { field: 'description', label: '描述', kind: 'textarea', placeholder: '可选说明', rows: 3 },
    {
      field: 'paramsText',
      label: '参数',
      kind: 'json',
      placeholder: '{\n  "base": 1\n}',
      helper: '高级场景仍可直接编辑 JSON payload。'
    }
  ],
  createDraft: () => ({
    formulaId: '',
    formulaType: '',
    formulaKind: '',
    description: '',
    paramsText: stringifyJson({})
  }),
  buildRows: (snapshot) =>
    createResourceRows(
      snapshot.formulaProfiles,
      (record) => record.formulaId,
      (record) => record.formulaId,
      (record) => record.formulaType ?? '--',
      (record) => record.formulaKind ?? '--',
      (record) => record.updatedAt ?? '--',
      (record) => record.description ?? ''
    ),
  getRecordKey: (record) => record.formulaId,
  buildCreateKey: (draft) => draft.formulaId.trim() || null,
  buildCreatePayload: (draft) => ({
    formulaId: draft.formulaId.trim(),
    formulaType: draft.formulaType.trim(),
    formulaKind: draft.formulaKind.trim(),
    description: draft.description.trim(),
    params: parseJsonObject(draft.paramsText)
  })
};

const formulaBindingDefinition: AdminResourceDefinition<'formulaBindings'> = {
  kind: 'formulaBindings',
  hashSegment: 'formula-bindings',
  label: '公式绑定',
  summary: '把公式绑定到目标类别、目标 ID 和 bindingKey',
  description: '把公式挂到目标实体上，并按需提供 override params。',
  listColumns: ['bindingKey', 'target', 'formulaId', 'updatedAt'],
  createFields: [
    { field: 'targetCategory', label: '目标类别', kind: 'text', placeholder: 'skill' },
    { field: 'targetId', label: '目标 ID', kind: 'text', placeholder: 'skill_katarina_r' },
    { field: 'bindingKey', label: '绑定 Key', kind: 'text', placeholder: 'damage.base' },
    { field: 'formulaId', label: '公式 ID', kind: 'text', placeholder: 'damage.skill.katarina.r.base' },
    {
      field: 'overrideParamsText',
      label: '覆盖参数',
      kind: 'json',
      placeholder: '{\n  "coefficient": 1.2\n}',
      helper: '可选的 override params；无额外参数时可保留 {}。'
    }
  ],
  createDraft: () => ({
    targetCategory: '',
    targetId: '',
    bindingKey: '',
    formulaId: '',
    overrideParamsText: stringifyJson({})
  }),
  buildRows: (snapshot) =>
    createResourceRows(
      snapshot.formulaBindings,
      (record) => encodeFormulaBindingKey(record.targetCategory, record.targetId, record.bindingKey),
      (record) => record.bindingKey,
      (record) => `${record.targetCategory}:${record.targetId}`,
      (record) => record.formulaId,
      (record) => record.updatedAt ?? '--',
      (record) => (record.overrideParams ? '含 overrideParams' : '无 overrideParams')
    ),
  getRecordKey: (record) => encodeFormulaBindingKey(record.targetCategory, record.targetId, record.bindingKey),
  buildCreateKey: (draft) => {
    const targetCategory = draft.targetCategory.trim();
    const targetId = draft.targetId.trim();
    const bindingKey = draft.bindingKey.trim();
    if (!targetCategory || !targetId || !bindingKey) {
      return null;
    }
    return encodeFormulaBindingKey(targetCategory, targetId, bindingKey);
  },
  buildCreatePayload: (draft) => ({
    targetCategory: draft.targetCategory.trim(),
    targetId: draft.targetId.trim(),
    bindingKey: draft.bindingKey.trim(),
    formulaId: draft.formulaId.trim(),
    overrideParams: parseJsonObject(draft.overrideParamsText)
  })
};

const coefficientBucketDefinition: AdminResourceDefinition<'coefficientBuckets'> = {
  kind: 'coefficientBuckets',
  hashSegment: 'coefficient-buckets',
  label: '乘区桶',
  summary: '维护属性域与伤害域的聚合桶',
  description: '维护计算和调优链路依赖的聚合桶配置。',
  listColumns: ['bucketKey', 'domain', 'stageKey', 'aggregation'],
  createFields: [
    { field: 'bucketKey', label: '乘区 Key', kind: 'text', placeholder: 'magic_damage.percent_bonus' },
    {
      field: 'resolutionDomain',
      label: '分辨域',
      kind: 'select',
      placeholder: 'attribute',
      options: [
        { label: '属性', value: 'attribute' },
        { label: '伤害', value: 'damage' },
        { label: '全局', value: 'global' }
      ]
    },
    { field: 'stageKey', label: '阶段 Key', kind: 'text', placeholder: 'percent_bonus' },
    { field: 'targetAttrKey', label: '目标属性 Key', kind: 'text', placeholder: 'move_speed' },
    {
      field: 'aggregationMode',
      label: '聚合模式',
      kind: 'select',
      placeholder: 'add',
      options: [
        { label: '加法', value: 'add' },
        { label: '乘法', value: 'multiply' },
        { label: '最大值', value: 'max' },
        { label: '最小值', value: 'min' }
      ]
    },
    { field: 'description', label: '描述', kind: 'textarea', placeholder: '可选说明', rows: 3 },
    {
      field: 'editorHintText',
      label: '编辑器提示',
      kind: 'json',
      placeholder: '{\n  "hint": "Optional editor hint"\n}',
      helper: '可选的编辑提示 JSON。'
    },
    {
      field: 'bucketConfigText',
      label: '乘区配置',
      kind: 'json',
      placeholder: '{\n  "threshold": 1\n}',
      helper: '复杂场景下可填写额外配置 JSON。'
    }
  ],
  createDraft: () => ({
    bucketKey: '',
    resolutionDomain: 'attribute',
    stageKey: '',
    targetAttrKey: '',
    aggregationMode: 'add',
    description: '',
    editorHintText: stringifyJson({}),
    bucketConfigText: stringifyJson({})
  }),
  buildRows: (snapshot) =>
    createResourceRows(
      snapshot.coefficientBuckets,
      (record) => record.bucketKey,
      (record) => record.bucketKey,
      (record) => record.resolutionDomain ?? '--',
      (record) => record.stageKey ?? '--',
      (record) => record.aggregationMode ?? '--',
      (record) => record.targetAttrKey ?? record.description ?? ''
    ),
  getRecordKey: (record) => record.bucketKey,
  buildCreateKey: (draft) => draft.bucketKey.trim() || null,
  buildCreatePayload: (draft) => {
    const editorHint = parseJsonObject(draft.editorHintText);
    const bucketConfig = parseJsonObject(draft.bucketConfigText);

    return {
      bucketKey: draft.bucketKey.trim(),
      resolutionDomain: draft.resolutionDomain.trim(),
      stageKey: draft.stageKey.trim(),
      targetAttrKey: draft.targetAttrKey.trim(),
      aggregationMode: draft.aggregationMode.trim(),
      description: draft.description.trim(),
      ...(Object.keys(editorHint).length > 0 ? { editorHint } : emptyJsonObject),
      ...(Object.keys(bucketConfig).length > 0 ? { bucketConfig } : emptyJsonObject)
    };
  }
};

const statusActionControlRuleDefinition: AdminResourceDefinition<'statusActionControlRules'> = {
  kind: 'statusActionControlRules',
  hashSegment: 'status-action-control-rules',
  label: '状态动作规则',
  summary: '维护禁用、打断和动作限制',
  description: '维护状态与动作约束相关的控制规则。',
  listColumns: ['ruleId', 'ruleKind', 'statusTypeId', 'priority'],
  createFields: [
    { field: 'ruleId', label: '规则 ID', kind: 'text', placeholder: 'status_stun_forbid_cast' },
    { field: 'statusTypeId', label: '状态类型 ID', kind: 'number', placeholder: '50020' },
    {
      field: 'ruleKind',
      label: '规则种类',
      kind: 'select',
      options: [
        { label: '禁用', value: 'forbid' },
        { label: '打断', value: 'interrupt' },
        { label: '限制', value: 'limit' }
      ],
      placeholder: 'forbid'
    },
    { field: 'priority', label: '优先级', kind: 'number', placeholder: '100' },
    {
      field: 'actionTypeIdsText',
      label: '动作类型 ID',
      kind: 'json',
      placeholder: '[50101, 50102]',
      helper: '动作类型 ID 的 JSON 数组。'
    },
    {
      field: 'actionMatchTypeIdsText',
      label: '动作匹配类型 ID',
      kind: 'json',
      placeholder: '[]',
      helper: '动作匹配类型 ID 的 JSON 数组。'
    },
    {
      field: 'interruptPhaseTypeIdsText',
      label: '打断阶段类型 ID',
      kind: 'json',
      placeholder: '[]',
      helper: '打断阶段类型 ID 的 JSON 数组。'
    },
    { field: 'description', label: '描述', kind: 'textarea', placeholder: '可选说明', rows: 3 },
    {
      field: 'extendText',
      label: '扩展',
      kind: 'json',
      placeholder: '{\n  "note": "Optional extension"\n}',
      helper: '可选扩展字段 JSON。'
    }
  ],
  createDraft: () => ({
    ruleId: '',
    statusTypeId: '0',
    ruleKind: 'forbid',
    actionTypeIdsText: stringifyJson([]),
    actionMatchTypeIdsText: stringifyJson([]),
    interruptPhaseTypeIdsText: stringifyJson([]),
    priority: '100',
    description: '',
    extendText: stringifyJson({})
  }),
  buildRows: (snapshot) =>
    createResourceRows(
      snapshot.statusActionControlRules,
      (record) => record.ruleId,
      (record) => record.ruleId,
      (record) => record.ruleKind ?? '--',
      (record) => String(record.statusTypeId ?? '--'),
      (record) => String(record.priority ?? '--'),
      (record) => record.description ?? ''
    ),
  getRecordKey: (record) => record.ruleId,
  buildCreateKey: (draft) => draft.ruleId.trim() || null,
  buildCreatePayload: (draft) => ({
    ruleId: draft.ruleId.trim(),
    statusTypeId: Number(draft.statusTypeId),
    ruleKind: draft.ruleKind.trim(),
    actionTypeIds: parseJsonNumberArray(draft.actionTypeIdsText),
    actionMatchTypeIds: parseJsonNumberArray(draft.actionMatchTypeIdsText),
    interruptPhaseTypeIds: parseJsonNumberArray(draft.interruptPhaseTypeIdsText),
    priority: Number(draft.priority),
    description: draft.description.trim(),
    extend: parseJsonObject(draft.extendText)
  })
};

export const adminResourceDefinitions: AdminResourceDefinitionMap = {
  formulaProfiles: formulaProfileDefinition,
  formulaBindings: formulaBindingDefinition,
  coefficientBuckets: coefficientBucketDefinition,
  statusActionControlRules: statusActionControlRuleDefinition
};

export const EMPTY_ADMIN_SNAPSHOT: AdminSnapshot = {
  coefficientBuckets: [],
  statusActionControlRules: [],
  formulaProfiles: [],
  formulaBindings: []
};

export function getAdminResourceDefinition<TKind extends AdminResourceKind>(kind: TKind): AdminResourceDefinition<TKind> {
  return adminResourceDefinitions[kind] as unknown as AdminResourceDefinition<TKind>;
}

export function getAdminResourceLabel(kind: AdminResourceKind): string {
  return adminResourceDefinitions[kind].label;
}

export function getAdminResourceDescription(kind: AdminResourceKind): string {
  return adminResourceDefinitions[kind].description;
}

export function getAdminResourceSummary(kind: AdminResourceKind): string {
  return adminResourceDefinitions[kind].summary;
}

export function getAdminResourceRows(snapshot: AdminSnapshot, kind: AdminResourceKind): AdminResourceRow[] {
  return adminResourceDefinitions[kind].buildRows(snapshot);
}

export function getAdminResourceKey(kind: AdminResourceKind, record: AdminResourceRecord): string {
  return adminResourceDefinitions[kind].getRecordKey(record as never);
}

export function getAdminResourceCreateFields(kind: AdminResourceKind): AdminCreateFieldDefinition[] {
  return adminResourceDefinitions[kind].createFields;
}

export function createAdminCreateDraft(kind: AdminResourceKind): AdminCreateDraftMap[AdminResourceKind] {
  return adminResourceDefinitions[kind].createDraft() as AdminCreateDraftMap[AdminResourceKind];
}

export function resolveAdminResourceCreateKey(kind: AdminResourceKind, draft: AdminCreateDraftMap[AdminResourceKind]): string | null {
  return adminResourceDefinitions[kind].buildCreateKey(draft as never);
}

export function buildAdminResourceCreatePayload(kind: AdminResourceKind, draft: AdminCreateDraftMap[AdminResourceKind]): JsonObject {
  return adminResourceDefinitions[kind].buildCreatePayload(draft as never);
}

export function formatAdminResourceSelectedKey(kind: AdminResourceKind, key: string): string {
  if (kind !== 'formulaBindings') {
    return key;
  }

  const decoded = decodeFormulaBindingKey(key);
  return `${decoded.targetCategory}:${decoded.targetId} / ${decoded.bindingKey}`;
}
