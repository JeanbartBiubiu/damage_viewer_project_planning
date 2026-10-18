import type { ContinuousAttackView } from './continuousAttackPresentation';
import type { AutomaticSelection, AutomaticSkillView } from './automaticSkillPresentation';

const archiveFields = ['taskKind', 'adapterVersion', 'snapshot', 'snapshotDigest', 'attributeInputs', 'initialHealth', 'equipmentAssumptions', 'mechanicStateInputs', 'sceneParameterInputs', 'ignoredCastCosts',
  'attackSpeedAdmission', 'compileRequest', 'runRequest', 'runInputHash', 'coverage', 'operationOrigins', 'equipmentOrigins', 'skillOrigins', 'wasm',
  'formulaPreflight', 'compileResult', 'runResult', 'releaseResult', 'assessment', 'outcome', 'cleanup', 'failurePhase', 'error'] as const;
const forbiddenField = /^(?:__proto__|prototype|constructor|headers?|requests?|responses?|connection|apiBaseUrl|baseUrl|adminToken|authorization|proxyAuthorization|cookies?|password|passwd|secret|apiKey|api_key|accessToken|refreshToken|bearerToken|token|controller|client|worker|localStorage|sessionStorage)$/i;
const forbiddenSuffix = /(?:password|secret|token|apiKey)$/i;
function safeErrorText(value: string) {
  return value.replace(/\bBearer\s+[^\s,;"']+/gi, '鉴权信息已隐藏')
    .replace(/(?:https?:\/\/)[^\s]+/gi, '连接地址已隐藏')
    .replace(/(?:authorization|adminToken|cookie|password|secret|api[_-]?key|access[_-]?token|token)\s*[:=]\s*[^\s,;]+/gi, '敏感信息已隐藏');
}
function safeBusiness(value: unknown, errorText = false): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return errorText ? safeErrorText(value) : value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(item => safeBusiness(item, errorText));
  if (typeof value !== 'object') return null;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !forbiddenField.test(key) && !forbiddenSuffix.test(key))
    .map(([key, item]) => [key, safeBusiness(item, errorText || key === 'error' || key === 'message')]));
}
export function buildContinuousAttackArchive(input: unknown, view: ContinuousAttackView) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('缺少冻结运行档案。');
  const source = input as Record<string, unknown>;
  const selectedAttack = view.selectedAttack ? { planKey: view.selectedAttack.planKey, attackIndex: view.selectedAttack.attackIndex, useRef: view.selectedAttack.useRef } : null;
  return { ...Object.fromEntries(archiveFields.map(key => [key, safeBusiness(source[key], key === 'error')])), displayDefinitionVersion: 1,
    view: { breakdownMode: view.breakdownMode, amountMetric: view.amountMetric, timeRangeMs: [...view.timeRangeMs], dpsMode: view.dpsMode, visibleCurves: [...view.visibleCurves],
      sourceKeys: [...view.sourceKeys], damageTypes: [...view.damageTypes], attackIndex: view.attackIndex,
      selectedAttack, selectedDamageId: view.selectedDamageId } };
}

export function buildSkillActionArchive(input: unknown, timeRangeMs: [number, number]) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('缺少冻结主动运行档案。');
  const source = input as Record<string, unknown>;
  return { ...Object.fromEntries(archiveFields.map(key => [key, safeBusiness(source[key], key === 'error')])),
    displayDefinitionVersion: 1, view: { timeRangeMs: [...timeRangeMs] } };
}

function automaticSelectionView(value: AutomaticSelection | null): AutomaticSelection | null {
  if (!value) return null;
  switch (value.kind) {
    case 'automatic': return { kind: 'automatic', sequence: value.sequence };
    case 'use': return { kind: 'use', useRef: value.useRef };
    case 'attack': return { kind: 'attack', planKey: value.planKey, attackIndex: value.attackIndex, useRef: value.useRef };
    case 'damage': return { kind: 'damage', damageId: value.damageId };
    case 'healing': return { kind: 'healing', recordIndex: value.recordIndex };
  }
}
export function buildAutomaticSkillArchive(input: unknown, view: AutomaticSkillView) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('缺少冻结自动运行档案。');
  const source = input as Record<string, unknown>;
  return { ...Object.fromEntries(archiveFields.map(key => [key, safeBusiness(source[key], key === 'error')])),
    displayDefinitionVersion: 2, view: { timeRangeMs: [...view.timeRangeMs], dpsMode: view.dpsMode,
      visibleCurves: [...view.visibleCurves], breakdownMode: view.breakdownMode, amountMetric: view.amountMetric,
      sourceKeys: [...view.sourceKeys], damageTypes: [...view.damageTypes], selection: automaticSelectionView(view.selection) } };
}

export type SkillActionCsvKind = 'skillAction' | 'skillUse' | 'healing' | 'damage' | 'attack' | 'mechanic';
export function buildSkillActionCsv(kind: SkillActionCsvKind, rows: ReadonlyArray<object>, inputHash: string | null,
  timeRangeMs: [number, number], recording: unknown) {
  const fields: Record<SkillActionCsvKind, string[]> = {
    skillAction: ['instructionKey', 'parentInstructionKey', 'requestedAtMs', 'actualAtMs', 'action', 'source', 'target', 'skillKey', 'bindingKey', 'providerRef', 'providerDefinitionRef', 'outcome', 'reason', 'useRef'],
    skillUse: ['instructionKey', 'timeMs', 'kind', 'source', 'target', 'skillKey', 'providerRef', 'processKey', 'stepKey', 'stepVersion', 'executionIndex', 'useRef', 'hitRef', 'reason'],
    healing: ['timeMs', 'source', 'target', 'abilityRef', 'operationRef', 'useRef', 'instructionKey', 'rawAmount', 'healingAfterDone', 'healingAfterModifiers', 'actualHealing', 'overheal', 'hpBefore', 'hpAfter'],
    damage: ['damageId', 'attackIndex', 'timeMs', 'instructionKey', 'useRef', 'hitRef', 'owner', 'source', 'target', 'abilityRef', 'operationRef', 'operationPath', 'providerDefinitionRef', 'castInstanceId', 'damageType', 'rawAmount', 'postDefenseDamage', 'shieldAbsorbed', 'actualHpLoss', 'overkillDamage', 'hpBefore', 'hpAfter', 'sourceHpBefore', 'sourceHpAfter'],
    attack: ['planKey', 'attackIndex', 'useRef', 'source', 'target', 'skillKey', 'startAtMs', 'hitAtMs', 'readyAtMs', 'finalReadyAtMs', 'mechanicReadyAtMs', 'actionReadyAtMs', 'nextStartAtMs', 'attackSpeed', 'postDefenseDamage', 'actualHpLoss', 'sourceHpAfter', 'targetHpAfter', 'completed'],
    mechanic: ['timeMs', 'kind', 'owner', 'providerRef', 'providerDefinitionRef', 'skillKey', 'stateKey', 'beforeValue', 'afterValue', 'operationRef', 'useRef', 'readyAtMs']
  };
  const metadata = [inputHash, '仅原生已返回事实；不恢复截断记录', ...timeRangeMs, recording];
  return '\uFEFF' + [['运行条件摘要', '导出范围', '起点毫秒', '终点毫秒', '独立记录统计', ...fields[kind]].map(csvCell).join(','),
    ...rows.map(row => [...metadata, ...fields[kind].map(field => (row as Record<string, unknown>)[field])].map(csvCell).join(','))].join('\r\n');
}
export type ContinuousCsvKind = 'breakdown' | 'attack' | 'damage' | 'series';
export type ContinuousCsvContext = {
  runInputHash: string | null; view: ContinuousAttackView; executionComplete: boolean;
  attackRecordsTruncated: boolean; damageRecordsTruncated: boolean; seriesDownsampled: boolean;
};
const metadataColumns = ['运行条件摘要', '表格种类', '导出范围', '生效筛选', '可见起点（毫秒）', '可见终点（毫秒）',
  '来源筛选', '伤害类型筛选', '刀号筛选', '计算完整', '攻击记录截断', '伤害记录截断', '序列降采样'];
const amountColumns = [['postDefenseDamage', '造成伤害'], ['shieldAbsorbed', '护盾吸收'], ['actualHpLoss', '实际扣血'], ['overkillDamage', '过量伤害']];
const sourceColumns = [['owner', '拥有者'], ['source', '伤害方'], ['target', '受伤方'], ['abilityRef', '能力标识'], ['operationRef', '作者结果'], ['damageType', '伤害类型'], ['providerDefinitionRef', '有期来源定义']];
const csvColumns: Record<ContinuousCsvKind, string[][]> = {
  breakdown: [...sourceColumns, ['damageCount', '结算笔数'], ...amountColumns],
  attack: [['planKey', '计划标识'], ['attackIndex', '刀号'], ['useRef', '使用身份'], ['source', '攻击方'], ['target', '目标'],
    ['skillKey', '技能标识'], ['startAtMs', '开始（毫秒）'], ['hitAtMs', '命中（毫秒）'], ['readyAtMs', '就绪（毫秒）'],
    ['finalReadyAtMs', '普通攻击最终就绪（毫秒）'], ['mechanicReadyAtMs', '机制就绪（毫秒）'], ['actionReadyAtMs', '行动就绪贡献（毫秒）'], ['nextStartAtMs', '下一刀（毫秒）'], ['attackSpeed', '攻速'], ['postDefenseDamage', '造成伤害'], ['actualHpLoss', '实际扣血'],
    ['sourceHpAfter', '攻击方尾部生命'], ['targetHpAfter', '目标尾部生命'], ['completed', '尾部完成']],
  damage: [['damageId', '伤害编号'], ['attackIndex', '刀号'], ['useRef', '使用身份'], ['instructionKey', '指令标识'], ['hitRef', '命中身份'], ['timeMs', '时刻（毫秒）'],
    ...sourceColumns, ['providerActivatedAtMs', '周期激活时点（毫秒）'], ['castInstanceId', '施放实例'], ['operationPath', '编译路径'], ['rawAmount', '防御前输入金额'], ...amountColumns,
    ['hpBefore', '受伤方生命之前'], ['hpAfter', '受伤方生命之后'], ['sourceHpBefore', '伤害来源生命之前'],
    ['sourceHpAfter', '伤害来源生命之后'], ['vampHealing', '本笔实际吸血入账']],
  series: [['timeMs', '时刻（毫秒）'], ['sourceHp', 'A生命'], ['targetHp', 'B生命'], ['sourceDamageDealt', 'A累计造成伤害'],
    ['targetDamageDealt', 'B累计造成伤害'], ['sourceCumulativeDps', 'A累计平均伤害率'], ['targetCumulativeDps', 'B累计平均伤害率'],
    ['sourceWindowDps', 'A窗口伤害率'], ['targetWindowDps', 'B窗口伤害率']]
};
function csvCell(value: unknown) {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (typeof value !== 'number' && (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function buildContinuousCsv(kind: ContinuousCsvKind, rows: ReadonlyArray<Record<string, unknown>>, context: ContinuousCsvContext) {
  const scope = { breakdown: '整次运行完整分类的当前筛选', attack: '已返回攻击记录的当前筛选',
    damage: '已返回伤害记录的当前筛选', series: '原生采样点的当前时间区间' }[kind];
  const applied = { breakdown: '来源、伤害类型；不按时间或刀号拆分', attack: '时间区间、刀号；不按来源或类型拆分',
    damage: '时间区间、来源、伤害类型、刀号', series: '时间区间；不按来源、类型或刀号拆分' }[kind];
  const metadata: unknown[] = [context.runInputHash, kind, scope, applied, ...context.view.timeRangeMs,
    context.view.sourceKeys, context.view.damageTypes, context.view.attackIndex, context.executionComplete,
    context.attackRecordsTruncated, context.damageRecordsTruncated, context.seriesDownsampled];
  const columns = csvColumns[kind];
  const values = (row: Record<string, unknown>) => columns.map(column => {
    if (column[0] !== 'vampHealing') return row[column[0]!];
    const before = row.sourceHpBefore; const after = row.sourceHpAfter;
    return typeof before === 'number' && Number.isFinite(before) && before >= 0
      && typeof after === 'number' && Number.isFinite(after) && after >= before ? after - before : null;
  });
  return '﻿' + [metadataColumns.concat(columns.map(column => column[1]!)).map(csvCell).join(','),
    ...rows.map(row => metadata.concat(values(row)).map(csvCell).join(','))].join('\r\n');
}
