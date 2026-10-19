import type { CompileRequest, DoneResult, ResourceChangeRecord, RunRequest } from '../types/genericEngine';

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
function fail(path: string, reason: string): never { throw new Error(`${path}: ${reason}`); }
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '需要对象');
  return value as Record<string, unknown>;
}
function exact(value: unknown, required: readonly string[], path: string, optional: readonly string[] = []) {
  const row = object(value, path);
  if (required.some(key => !own(row, key)) || Object.keys(row).some(key => !required.includes(key) && !optional.includes(key))) fail(path, '字段缺失或包含未知字段');
  return row;
}
function number(value: unknown, path: string, signed = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !signed && value < 0) fail(path, '需要有限合法数值');
  return value;
}
function count(value: unknown, path: string) { const n = number(value, path); if (!Number.isSafeInteger(n)) fail(path, '需要安全非负整数'); return n; }
function text(value: unknown, path: string) { if (typeof value !== 'string' || !value) fail(path, '需要非空字符串'); return value; }
const recordingKeys = ['resourceChangeRecordCount', 'returnedResourceChangeRecords', 'droppedResourceChangeRecords', 'resourceChangeRecordsTruncated'] as const;
const sideKeys = ['currentIncrease', 'currentDecrease', 'maxIncrease', 'maxDecrease', 'finalMax'] as const;

/** 只解释显式预算，不往旧请求写入缺省字段。 */
export function assertResourceRecordBudget(request: RunRequest): void {
  if (request.recordBudget && own(request.recordBudget, 'maxResourceChangeRecords')) {
    const value = count(request.recordBudget.maxResourceChangeRecords, 'recordBudget.maxResourceChangeRecords');
    if (value > 10000) fail('recordBudget.maxResourceChangeRecords', '上限为10000');
  }
}

export function hasResourceMaxAuthorization(compile: CompileRequest): boolean {
  return compile.sharedProviders?.some(provider => provider.modifiers?.some(modifier => modifier.kind === 'resource_max')) === true;
}

/** 新输出必须成套出现；旧输出不增添任何缺省。这里只解析形状，真实授权随后按编译输入核对。 */
export function assertResourceChangeOutputShape(done: DoneResult): boolean {
  const present = own(done, 'resourceChangeRecords') || own(done, 'resourceChangeSummary')
    || !!done.recording && recordingKeys.some(key => own(done.recording!, key));
  const healthRows = [...(done.damageRecords ?? []), ...(done.healingRecords ?? [])];
  if (done.attackRecords?.some(row => own(row, 'healthOrder'))) fail('attackRecords.healthOrder', '攻击记录不携带生命事实顺序');
  if (!present) {
    if (healthRows.some(row => own(row, 'healthOrder'))) fail('healthOrder', '无资源授权输出不能携带生命顺序');
    return false;
  }
  if (!own(done, 'resourceChangeRecords') || !own(done, 'resourceChangeSummary') || !done.recording
    || recordingKeys.some(key => !own(done.recording!, key))) fail('resourceChange', '资源明细、累计和记录统计必须成套出现');
  const summary = exact(done.resourceChangeSummary, ['changeCount', 'source', 'target'], 'resourceChangeSummary');
  count(summary.changeCount, 'resourceChangeSummary.changeCount');
  for (const side of ['source', 'target'] as const) {
    const row = exact(summary[side], sideKeys, `resourceChangeSummary.${side}`);
    for (const key of sideKeys) number(row[key], `resourceChangeSummary.${side}.${key}`);
  }
  for (const key of recordingKeys.slice(0, 3)) count(done.recording[key], `recording.${key}`);
  if (typeof done.recording.resourceChangeRecordsTruncated !== 'boolean') fail('recording.resourceChangeRecordsTruncated', '需要布尔值');
  if (!Array.isArray(done.resourceChangeRecords)) fail('resourceChangeRecords', '需要数组');
  for (const [index, value] of done.resourceChangeRecords.entries()) {
    const path = `resourceChangeRecords[${index}]`;
    const row = exact(value, ['healthOrder', 'timeMs', 'target', 'resourceKey', 'currentBefore', 'currentAfter', 'currentDelta', 'maxBefore', 'maxAfter', 'maxDelta', 'contributors'], path);
    if (count(row.healthOrder, `${path}.healthOrder`) === 0 || count(row.timeMs, `${path}.timeMs`) > done.summary.durationMs
      || !['source', 'target'].includes(String(row.target)) || row.resourceKey !== 'hp') fail(path, '资源身份、时刻或顺序非法');
    for (const key of ['currentBefore', 'currentAfter', 'maxBefore', 'maxAfter']) number(row[key], `${path}.${key}`);
    for (const key of ['currentDelta', 'maxDelta']) number(row[key], `${path}.${key}`, true);
    const record = value as ResourceChangeRecord;
    if (!close(record.currentAfter - record.currentBefore, record.currentDelta) || !close(record.maxAfter - record.maxBefore, record.maxDelta)
      || record.currentBefore > record.maxBefore || record.currentAfter > record.maxAfter || record.currentDelta === 0 && record.maxDelta === 0
      || !close(record.currentAfter, record.currentBefore === 0 ? 0 : Math.min(record.maxAfter, record.currentBefore + Math.max(0, record.maxDelta)))) fail(path, '资源前后值、净差或生命夹取策略不一致');
    if (!Array.isArray(row.contributors) || !row.contributors.length) fail(`${path}.contributors`, '需要真实变更贡献项');
    for (const [i, contributor] of row.contributors.entries()) {
      const p = `${path}.contributors[${i}]`;
      const entry = exact(contributor, ['source', 'providerRef', 'definitionRef', 'modifierKey', 'reason'], p, ['useRef']);
      if (!['source', 'target'].includes(String(entry.source)) || !['apply', 'refresh', 'remove', 'expire'].includes(String(entry.reason))) fail(p, '贡献来源或原因非法');
      for (const key of ['providerRef', 'definitionRef', 'modifierKey']) text(entry[key], `${p}.${key}`);
      if (own(entry, 'useRef')) text(entry.useRef, `${p}.useRef`);
    }
  }
  const orders = new Set<number>();
  for (const rows of [done.damageRecords ?? [], done.healingRecords ?? [], done.resourceChangeRecords]) {
    let previous = 0, time = -1;
    for (const row of rows) {
      const order = count(row.healthOrder, 'healthOrder');
      if (!order || order <= previous || orders.has(order) || !Number.isSafeInteger(row.timeMs) || row.timeMs < time || row.timeMs > done.summary.durationMs) fail('healthOrder', '生命事实顺序缺失、重复或逆序');
      orders.add(order); previous = order; time = row.timeMs;
    }
  }
  return true;
}

/** 明细预算不影响可靠累计；汇总也独立核对Current和Max两条守恒。 */
export function inspectResourceChangeContract(compile: CompileRequest, request: RunRequest, done: DoneResult): string[] {
  const issues: string[] = [];
  const check = (ok: boolean, reason: string) => { if (!ok) issues.push(`资源生命账: ${reason}`); };
  try {
    assertResourceRecordBudget(request);
    const present = assertResourceChangeOutputShape(done);
    check(present === hasResourceMaxAuthorization(compile), '新输出必须与本编译会话的resource_max授权一致');
    if (!present) return issues;
    const summary = done.resourceChangeSummary!, recording = done.recording!, rows = done.resourceChangeRecords!;
    const anyChange = (['source', 'target'] as const).some(side => sideKeys.slice(0, 4).some(key => summary[side][key] > 0));
    check((summary.changeCount > 0) === anyChange, '实际变更次数与独立增减累计矛盾');
    const budget = request.recordBudget?.maxResourceChangeRecords ?? 1000;
    const retained = Math.min(summary.changeCount, budget), summaryOnly = request.outputMode === 'summary';
    check(recording.resourceChangeRecordCount === summary.changeCount && recording.returnedResourceChangeRecords === rows.length
      && rows.length === (summaryOnly ? 0 : retained) && recording.droppedResourceChangeRecords === summary.changeCount - retained
      && recording.resourceChangeRecordsTruncated === (summary.changeCount > budget), '资源累计次数、预算与返回前缀不一致');
    for (const side of ['source', 'target'] as const) {
      const initial = request.initialSnapshot.combatants.find(row => row.key === side)?.attributes.hp;
      const final = done.finalSnapshot.combatants.find(row => row.key === side)?.attributes.hp;
      if (!initial || !final) fail(side, '缺少真实生命属性');
      const totals = summary[side];
      check(close(initial.current - done.summary[`${side}HpLoss`]! + (done.summary[`${side}VampHealing`] ?? 0) + (done.summary[`${side}DirectHealing`] ?? 0)
        + totals.currentIncrease - totals.currentDecrease, final.current), `${side}当前生命独立累计不守恒`);
      check(close(initial.max + totals.maxIncrease - totals.maxDecrease, final.max) && close(totals.finalMax, final.max)
        && close(final.current, done.summary[`${side}FinalHp`]) && close(final.resolved, final.current) && final.current <= final.max, `${side}上限累计或最终生命不守恒`);
      const sums = { currentIncrease: 0, currentDecrease: 0, maxIncrease: 0, maxDecrease: 0 };
      for (const row of rows.filter(row => row.target === side)) {
        sums.currentIncrease += Math.max(0, row.currentDelta); sums.currentDecrease += Math.max(0, -row.currentDelta);
        sums.maxIncrease += Math.max(0, row.maxDelta); sums.maxDecrease += Math.max(0, -row.maxDelta);
      }
      for (const key of Object.keys(sums) as (keyof typeof sums)[]) check(sums[key] <= totals[key] || close(sums[key], totals[key]), `${side}保留资源明细超过累计${key}`);
      if (!summaryOnly && !recording.resourceChangeRecordsTruncated) for (const key of Object.keys(sums) as (keyof typeof sums)[]) check(close(sums[key], totals[key]), `${side}完整资源明细与累计${key}不一致`);
    }
    const instances = new Map<string, { source: string; definitionRef: string }>();
    for (const row of rows) for (const contributor of row.contributors) {
      const definitions = compile.sharedProviders?.filter(provider => provider.providerKey === contributor.definitionRef) ?? [];
      const modifiers = definitions[0]?.modifiers?.filter(modifier => modifier.modifierKey === contributor.modifierKey && modifier.kind === 'resource_max'
        && modifier.target === 'self.attr.hp' && modifier.currentValuePolicy === 'grant_positive_delta_clamp') ?? [];
      check(definitions.length === 1 && modifiers.length === 1 && row.target === contributor.source, '贡献项缺少实际编译生命上限修正或拥有者不一致');
      const identity = instances.get(contributor.providerRef);
      check(!identity || identity.source === contributor.source && identity.definitionRef === contributor.definitionRef, '同一实际供值身份不能跨拥有者或定义');
      instances.set(contributor.providerRef, { source: contributor.source, definitionRef: contributor.definitionRef });
      const mounts = done.finalSnapshot.combatants.flatMap(actor => actor.providers.filter(provider => provider.providerRef === contributor.providerRef).map(provider => ({ actor, provider })));
      check(mounts.length === 0 || mounts.length === 1 && mounts[0]!.actor.key === contributor.source && mounts[0]!.provider.definitionRef === contributor.definitionRef,
        '尚存供值实例与贡献身份不一致');
      if (contributor.useRef) check(done.finalSnapshot.processInstances?.some(process => process.useKey === contributor.useRef && process.owner === contributor.source) === true,
        '贡献使用身份不属于实际来源过程');
    }
  } catch (error) { issues.push(error instanceof Error ? error.message : String(error)); }
  return issues;
}
