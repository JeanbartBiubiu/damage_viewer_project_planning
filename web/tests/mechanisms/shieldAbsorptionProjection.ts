import type { CompileRequest, DoneResult, RunRequest } from '../../src/types/genericEngine';
import type { ProjectedShieldAbsorption, ProjectedShieldWait } from './mechanismCase';

const own = (row: object, key: string) => Object.prototype.hasOwnProperty.call(row, key);
function fail(message: string): never { throw new Error(`shieldAbsorptions: ${message}`); }
function number(value: unknown, key: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(`${key}缺少有限非负事实`);
  return value;
}
function text(value: unknown, key: string, empty = false) {
  if (typeof value !== 'string' || !empty && !value.trim()) fail(`${key}缺少真实身份`);
  return value;
}
function agrees(left: number, right: number) { return Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(right)); }

/** 校验完整逐盾行及真实damageId；不从总吸收量分配，也不以耗尽后的活跃实例补身份。 */
export function projectShieldAbsorptions(compile: CompileRequest, request: RunRequest, done: DoneResult): ProjectedShieldAbsorption[] {
  const reads = JSON.stringify(compile).includes('event.damage.linked_shield[');
  const events = done.evidence.items.filter(item => item.kind === 'emitted_event' && item.ref === 'event/damage_taken');
  if (!reads) {
    if (events.some(item => item.data && (own(item.data, 'shieldAbsorptions') || own(item.data, 'damageId')))) fail('没有新读取的会话不应新增采集字段');
    return [];
  }
  if (done.evidence.truncated || done.recording?.damageRecordsTruncated) fail('逐笔受伤证据或伤害记录被截断');
  const seen = new Set<number>();
  const previous = new Map<string, { lifecycleProviderRef: string; definitionRef: string; source: string; owner: string; remainingAfter: number }>();
  const linkedInstances = new Map<string, string>();
  const rows: ProjectedShieldAbsorption[] = [];
  for (const item of events) {
    const data = item.data;
    if (!data || !Array.isArray(data.shieldAbsorptions)) fail('缺少明确采集完成的逐盾列表');
    const damageId = number(data.damageId, 'damageId');
    if (!Number.isSafeInteger(damageId) || seen.has(damageId)) fail('伤害身份非法或重复');
    seen.add(damageId);
    const damage = done.damageRecords?.filter(row => row.damageId === damageId);
    if (damage?.length !== 1) fail('受伤事件没有唯一原伤害记录');
    const actual = damage[0]!;
    if (actual.timeMs !== item.timeMs || actual.source !== data.source || actual.target !== data.target
      || actual.operationRef !== data.operationRef || actual.useRef !== data.useRef
      || !agrees(actual.shieldAbsorbed, number(data.shieldAbsorbed, 'shieldAbsorbed'))
      || !agrees(actual.actualHpLoss, number(data.actualHpLoss, 'actualHpLoss'))) fail('受伤事件与真实伤害身份或金额不一致');
    let total = 0;
    const shieldRefs = new Set<string>();
    for (const value of data.shieldAbsorptions) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail('逐盾行不是完整对象');
      const row = value as Record<string, unknown>;
      const fields = ['shieldRef', 'definitionRef', 'lifecycleProviderRef', 'source', 'owner', 'remainingBefore', 'remainingAfter', 'absorbed'];
      if (Object.keys(row).length !== fields.length || Object.keys(row).some(key => !fields.includes(key))) fail('逐盾行字段不完整');
      const shieldRef = text(row.shieldRef, 'shieldRef'), definitionRef = text(row.definitionRef, 'definitionRef', true);
      const lifecycleProviderRef = text(row.lifecycleProviderRef, 'lifecycleProviderRef', true);
      const source = text(row.source, 'source'), owner = text(row.owner, 'owner');
      if (owner !== actual.target || !['source', 'target'].includes(source) || shieldRefs.has(shieldRef)) fail('逐盾拥有者、来源或唯一身份不符');
      shieldRefs.add(shieldRef);
      const remainingBefore = number(row.remainingBefore, 'remainingBefore'), remainingAfter = number(row.remainingAfter, 'remainingAfter');
      const absorbed = number(row.absorbed, 'absorbed');
      if (absorbed <= 0 || !agrees(remainingBefore - remainingAfter, absorbed)) fail('逐盾前后值与正吸收额不守恒');
      const last = previous.get(shieldRef);
      if (last && (last.lifecycleProviderRef !== lifecycleProviderRef || last.definitionRef !== definitionRef
        || last.source !== source || last.owner !== owner || !agrees(last.remainingAfter, remainingBefore))) fail('同一实际盾的身份或余量不连续');
      previous.set(shieldRef, { lifecycleProviderRef, definitionRef, source, owner, remainingAfter });
      if (definitionRef || lifecycleProviderRef) {
        const definitions = compile.sharedProviders?.filter(provider => provider.linkedShieldDefinitionRef === definitionRef);
        if (!lifecycleProviderRef || definitions?.length !== 1) fail('关联盾缺少唯一完整编译定义');
        if (linkedInstances.has(lifecycleProviderRef) && linkedInstances.get(lifecycleProviderRef) !== shieldRef) fail('同一关联实例被伪造为两面实际盾');
        linkedInstances.set(lifecycleProviderRef, shieldRef);
        if (done.evidence.items.some(evidence => ['provider_expire', 'provider_remove'].includes(evidence.kind)
          && evidence.timeMs < item.timeMs
          && (evidence.ref === lifecycleProviderRef || evidence.data?.providerRef === lifecycleProviderRef))) fail('原关联实例在本笔伤害之前已经失效');
        const applied = done.evidence.items.some(evidence => evidence.kind === 'provider_apply' && evidence.timeMs <= item.timeMs
          && evidence.data?.providerRef === lifecycleProviderRef && evidence.data.definitionRef === definitions[0]!.providerKey
          && evidence.data.owner === owner && evidence.data.source === source);
        const initialActor = request.initialSnapshot.combatants.find(actor => actor.key === owner);
        const initial = initialActor?.providers.some(provider =>
          provider.providerRef === lifecycleProviderRef && provider.definitionRef === definitions[0]!.providerKey
          && provider.source === source && provider.owner === owner) && initialActor.shields.some(value => {
            if (!value || typeof value !== 'object') return false;
            const shield = value as Record<string, unknown>;
            const provider = initialActor.providers.find(provider => provider.providerRef === lifecycleProviderRef)!;
            const validExpiry = shield.expireAt === null || Number.isSafeInteger(shield.expireAt) && Number(shield.expireAt) > item.timeMs;
            return validExpiry && shield.expireAt === provider.expireAt
              && typeof shield.remaining === 'number' && Number.isFinite(shield.remaining) && shield.remaining > 0
              && (last !== undefined || agrees(shield.remaining, remainingBefore))
              && shield.shieldRef === shieldRef && shield.definitionRef === definitionRef
              && shield.lifecycleProviderRef === lifecycleProviderRef && shield.owner === owner && shield.source === source;
          });
        if (!applied && !initial) fail('吸收行的真实关联实例缺少创建或实际存活事实');
      }
      total += absorbed;
      rows.push({ timeMs: item.timeMs, damageId, damageSource: actual.source, damageTarget: actual.target,
        shieldRef, definitionRef, lifecycleProviderRef, source, owner, remainingBefore, remainingAfter, absorbed });
    }
    if (!agrees(total, actual.shieldAbsorbed)) fail('全部逐盾行合计与本笔总吸收不符');
  }
  if (seen.size !== (done.damageRecords?.length ?? 0)) fail('有真实伤害缺少逐笔受伤采集事实');
  return rows;
}

/** 新吸收读取会话中，直接读取完整最终等待状态与原到期时刻；不按终值反推起计。 */
export function projectShieldWaits(compile: CompileRequest, done: DoneResult): ProjectedShieldWait[] {
  if (!JSON.stringify(compile).includes('event.damage.linked_shield[')) return [];
  return done.finalSnapshot.combatants.flatMap(actor => actor.providers.flatMap(provider => {
    const definition = compile.sharedProviders?.find(row => row.providerKey === provider.definitionRef);
    return Object.entries(definition?.initialStateSchema ?? {}).flatMap(([stateKey, field]) => {
      if (typeof field === 'number' || !field.onExpire?.length) return [];
      if (provider.owner !== actor.key || provider.source !== actor.key
        || !compile.combatants.find(row => row.key === actor.key)?.providers.some(mount =>
          mount.providerRef === provider.providerRef && mount.definitionRef === provider.definitionRef)) fail('最终等待不是本方实际静态父挂载');
      const raw = actor.providerState[provider.providerRef];
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('最终等待状态缺少真实挂载状态包');
      const bag = raw as Record<string, unknown>, state = bag.state, expiry = bag.expireAt;
      if (!state || typeof state !== 'object' || Array.isArray(state)
        || !expiry || typeof expiry !== 'object' || Array.isArray(expiry)) fail('最终等待缺少状态或期限对象');
      const value = number((state as Record<string, unknown>)[stateKey], 'finalWait.value');
      const expires = (expiry as Record<string, unknown>)[stateKey];
      // 原快照协议只输出正到期时刻，键省略明确表示无活动期限。
      const expireAt = expires === undefined ? null : number(expires, 'finalWait.expireAt');
      if (!Number.isSafeInteger(value) || value !== 0 && value !== 1
        || expireAt !== null && (!Number.isSafeInteger(expireAt) || expireAt <= done.finalSnapshot.timeMs)
        || (value === 0) !== (expireAt === null)) fail('最终等待值与活动期限不一致');
      return [{ owner: actor.key, source: provider.source, definitionRef: provider.definitionRef, stateKey, value, expireAt }];
    });
  })).sort((a, b) => a.owner.localeCompare(b.owner) || a.definitionRef.localeCompare(b.definitionRef) || a.stateKey.localeCompare(b.stateKey));
}
