import type { AbilityDefinition, CompileRequest, OperationDefinition, RunRequest } from '../types/genericEngine';
import type { Skill } from '../types/skill';
import type { CharacterSkillRelation } from '../types/skillRelation';
import type { SkillEffectResult } from '../types/skillEffect';
import { adaptHitProgram, type HitProgramBinding } from './hitAdapter';
import {
  inventoryDamageOperations, type InventoriedOperation, type InventoryReference
} from './damageSourceInventory';

type Owner = 'source' | 'target';
type ReviewedDamageResult = Extract<SkillEffectResult, { resultType: 'DAMAGE' }>;

export type OrdinaryDamageSourceReview = {
  reviewKey: string;
  gameId: string;
  characterKey: string;
  skillKey: string;
  ruleKey: string;
  actionKey: string;
  effectKey: string;
  resultKey: string;
  damageTypeKey: string;
  deliveryKind: 'SKILL' | 'BASIC_ATTACK';
  originKind: 'DIRECT';
  classification: 'ORDINARY_DIRECT';
  rationale: string;
  evidenceRefs: string[];
  reviewedResult: ReviewedDamageResult;
};

export type OrdinaryDamageSourceCatalog = {
  catalogKey: string;
  gameId: string;
  scope: string;
  reviews: OrdinaryDamageSourceReview[];
};

export type OrdinaryDamageSourceBinding = {
  reviewKey: string;
  owner: Owner;
  providerRef: string;
  hitBinding: HitProgramBinding;
  skill: Skill;
  relation: CharacterSkillRelation;
};

export type OrdinaryDamageSourceAuditInput = {
  gameId: string;
  combatants: Record<Owner, { characterKey: string }>;
  catalog: OrdinaryDamageSourceCatalog;
  sources: OrdinaryDamageSourceBinding[];
};

export type OrdinaryDamageSourceAuditFact = {
  catalogKey: string;
  reviewKey: string;
  classification: 'ORDINARY_DIRECT';
  gameId: string;
  owner: Owner;
  characterKey: string;
  providerRef: string;
  providerKey: string;
  abilityKey: string;
  skillKey: string;
  ruleKey: string;
  actionKey: string;
  effectKey: string;
  resultKey: string;
  candidateKey: string;
  damageTypeKey: string;
  deliveryKind: 'SKILL' | 'BASIC_ATTACK';
  originKind: 'DIRECT';
  operationPath: string;
  operation: OperationDefinition;
  reviewedResult: ReviewedDamageResult;
  driverEntryKeys: string[];
};

export type OrdinaryDamageSourceAudit = {
  gameId: string;
  catalogKey: string;
  facts: OrdinaryDamageSourceAuditFact[];
  repeatOperations: InventoriedOperation[];
  references: InventoryReference[];
};

export type OrdinaryDamageSourceAuditErrorCode =
  | 'invalid_input'
  | 'catalog_mismatch'
  | 'authored_mismatch'
  | 'compiled_mismatch'
  | 'ownership_mismatch'
  | 'unreviewed_damage'
  | 'unverified_reference'
  | 'independent_execution';

export class OrdinaryDamageSourceAuditError extends Error {
  constructor(
    readonly code: OrdinaryDamageSourceAuditErrorCode,
    readonly path: string,
    message: string
  ) {
    super(`${path}: ${message}`);
    this.name = 'OrdinaryDamageSourceAuditError';
  }
}

function fail(code: OrdinaryDamageSourceAuditErrorCode, path: string, message: string): never {
  throw new OrdinaryDamageSourceAuditError(code, path, message);
}

function same(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, normalize(entry)]));
    }
    return value;
  };
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function key(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('invalid_input', path, '需要非空标识');
  }
  return value as string;
}

function exactlyOne<T>(rows: readonly T[], match: (row: T) => boolean, path: string): T {
  const matches = rows.filter(match);
  if (matches.length !== 1) fail('invalid_input', path, `需要恰好一项，当前为 ${matches.length} 项`);
  return matches[0]!;
}

function checkHashes(request: CompileRequest, run: RunRequest): void {
  if (request.schemaVersion !== run.schemaVersion
    || request.schemaHash !== run.schemaHash
    || request.schemaHash !== run.initialSnapshot.schemaHash
    || request.rulesHash !== run.rulesHash
    || request.rulesHash !== run.expectedRulesHash
    || request.rulesHash !== run.initialSnapshot.rulesHash) {
    fail('invalid_input', 'runRequest.rulesHash', '编译请求、运行请求与初始快照摘要不一致');
  }
}

function checkActorShape(request: CompileRequest, run: RunRequest, input: OrdinaryDamageSourceAuditInput): void {
  for (const [path, rows] of [
    ['combatants', request.combatants],
    ['initialSnapshot.combatants', run.initialSnapshot.combatants]
  ] as const) {
    if (!Array.isArray(rows) || rows.length !== 2
      || rows.filter((actor) => actor.key === 'source').length !== 1
      || rows.filter((actor) => actor.key === 'target').length !== 1) {
      fail('invalid_input', path, '本入口需要且仅需要 source、target 两个运行对象');
    }
  }
  key(input.combatants.source?.characterKey, 'sources.combatants.source.characterKey');
  key(input.combatants.target?.characterKey, 'sources.combatants.target.characterKey');
}

function checkCatalog(input: OrdinaryDamageSourceAuditInput): Map<string, OrdinaryDamageSourceReview> {
  key(input.gameId, 'sources.gameId');
  if (!input.catalog || input.catalog.gameId !== input.gameId || !Array.isArray(input.catalog.reviews)) {
    fail('catalog_mismatch', 'sources.catalog', '来源目录游戏或行结构不匹配');
  }
  key(input.catalog.catalogKey, 'sources.catalog.catalogKey');
  const reviews = new Map<string, OrdinaryDamageSourceReview>();
  for (const [index, review] of input.catalog.reviews.entries()) {
    const path = `sources.catalog.reviews[${index}]`;
    const reviewKey = key(review.reviewKey, `${path}.reviewKey`);
    if (reviews.has(reviewKey)) fail('catalog_mismatch', `${path}.reviewKey`, '来源目录标识重复');
    if (review.gameId !== input.gameId || review.classification !== 'ORDINARY_DIRECT'
      || review.originKind !== 'DIRECT' || review.reviewedResult?.resultType !== 'DAMAGE'
      || review.reviewedResult.target !== 'TARGET'
      || review.reviewedResult.detail.damageTypeKey !== review.damageTypeKey
      || review.reviewedResult.detail.deliveryKind !== review.deliveryKind
      || review.reviewedResult.detail.originKind !== review.originKind) {
      fail('catalog_mismatch', path, '来源目录的已核语义与完整结果不一致');
    }
    reviews.set(reviewKey, review);
  }
  return reviews;
}

function checkAuthored(
  source: OrdinaryDamageSourceBinding,
  review: OrdinaryDamageSourceReview,
  input: OrdinaryDamageSourceAuditInput,
  path: string
): void {
  const { authored } = source.hitBinding;
  if (source.skill.gameId !== input.gameId || source.skill.skillKey !== review.skillKey
    || source.skill.status !== 'ENABLED'
    || source.relation.gameId !== input.gameId
    || source.relation.characterKey !== review.characterKey
    || source.relation.skillKey !== review.skillKey
    || source.relation.skillStatus !== 'ENABLED'
    || authored.gameId !== input.gameId || authored.skillKey !== review.skillKey
    || authored.skillLevel > source.skill.maxLevel
    || !same([...(authored.skillCategoryKeys ?? [])].sort(), [...source.skill.skillCategoryKeys].sort())) {
    fail('authored_mismatch', path, '技能主体、角色关联、等级或技能分类与已核来源不一致');
  }
  if (authored.identity.source.category !== 'CHAMPION'
    || authored.identity.source.hostility !== 'SELF'
    || authored.identity.target.category !== 'CHAMPION'
    || authored.identity.target.hostility !== 'ENEMY') {
    fail('authored_mismatch', `${path}.hitBinding.authored.identity`, '缺少明确的英雄施放者与敌方英雄目标事实');
  }
  const rulePath = `${path}.hitBinding.authored.rules.${review.ruleKey}`;
  const rule = exactlyOne(authored.rules, (item) => item.ruleKey === review.ruleKey, rulePath);
  if (rule.eventSource.eventType !== (review.deliveryKind === 'BASIC_ATTACK' ? 'BASIC_ATTACK_HIT' : 'SKILL_HIT')) {
    fail('authored_mismatch', `${rulePath}.eventSource.eventType`, '命中事件与已核产生方式不一致');
  }
  const actionPath = `${rulePath}.actions.${review.actionKey}`;
  const action = exactlyOne(rule.actions, (item) => item.actionKey === review.actionKey, actionPath);
  if (action.actionType !== 'EXECUTE_EFFECT' || action.detail.effectKey !== review.effectKey) {
    fail('authored_mismatch', actionPath, '已核动作未执行指定效果');
  }
  const effectPath = `${path}.hitBinding.authored.effects.${review.effectKey}`;
  const effect = exactlyOne(authored.effects, (item) => item.effectKey === review.effectKey, effectPath);
  const resultPath = `${effectPath}.results.${review.resultKey}`;
  const result = exactlyOne(effect.results, (item) => item.resultKey === review.resultKey, resultPath);
  if (!same(result, review.reviewedResult)) {
    fail('authored_mismatch', resultPath, '实际完整结果与冻结核定正文不一致');
  }
}

function checkDependencies(
  request: CompileRequest,
  run: RunRequest,
  source: OrdinaryDamageSourceBinding,
  adapted: ReturnType<typeof adaptHitProgram>,
  ability: AbilityDefinition,
  path: string
): void {
  for (const [name, value] of Object.entries(adapted.params)) {
    if (ability.params?.[name] !== value) {
      fail('compiled_mismatch', `${path}.params.${name}`, '最终能力参数与完整命中转换不一致');
    }
  }
  for (const formula of adapted.formulas) {
    const matches = (request.formulas ?? []).filter((item) => item.key === formula.key);
    if (matches.length !== 1 || !same(matches[0]!.expression, formula.expression)) {
      fail('compiled_mismatch', `formulas[${JSON.stringify(formula.key)}]`, '最终具名公式与完整命中转换不一致');
    }
  }
  for (const entry of adapted.typeEntries) {
    const matches = request.typeCatalog.types.filter((item) => item.key === entry.key);
    if (matches.length !== 1 || matches[0]!.domain !== entry.domain) {
      fail('compiled_mismatch', `typeCatalog.types[${JSON.stringify(entry.key)}]`, '最终类型目录缺失或类型域冲突');
    }
  }
  if (!adapted.vampRules?.length || !same(request.rules.vampRules, adapted.vampRules)) {
    fail('compiled_mismatch', 'rules.vampRules', '最终游戏吸血规则与完整命中转换不一致');
  }
  for (const type of adapted.abilityTypes) {
    if (!ability.types?.includes(type)) {
      fail('compiled_mismatch', `${path}.types`, `最终能力缺少类型 ${type}`);
    }
  }
  const expectedAbilityTypes = [...new Set([
    ...adapted.abilityTypes.filter((type) => type.startsWith('ability/')),
    ...(adapted.resolveKind === 'basic_attack' ? ['ability/basic_attack'] : [])
  ])].sort();
  const actualAbilityTypes = ability.types?.filter((type) => type.startsWith('ability/')).sort();
  if (!actualAbilityTypes || !same(actualAbilityTypes, expectedAbilityTypes)) {
    fail('compiled_mismatch', `${path}.types`, '最终能力分类与完整命中转换不一致');
  }
  for (const provider of adapted.providers) {
    const matches = (request.sharedProviders ?? []).filter((item) => item.providerKey === provider.providerKey);
    if (matches.length !== 1 || !same(matches[0], provider)) {
      fail('compiled_mismatch', `sharedProviders[${JSON.stringify(provider.providerKey)}]`, '命中附属供值器定义被改写');
    }
  }
  for (const actorKey of ['source', 'target'] as const) {
    const compileActor = request.combatants.find((item) => item.key === actorKey)!;
    const runActor = run.initialSnapshot.combatants.find((item) => item.key === actorKey)!;
    for (const attribute of adapted.requiredAttributes) {
      for (const [actorPath, actor] of [
        [`combatants[${JSON.stringify(actorKey)}]`, compileActor],
        [`initialSnapshot.combatants[${JSON.stringify(actorKey)}]`, runActor]
      ] as const) {
        const slot = actor.attributes[attribute];
        if (!slot || !(['base', 'current', 'max', 'resolved'] as const).every((name) => Number.isFinite(slot[name]))) {
          fail('compiled_mismatch', `${actorPath}.attributes.${attribute}`, '缺少明确的有限属性值');
        }
      }
    }
  }
  if (source.hitBinding.authored.skillKey !== adapted.skillHit.skillKey) {
    fail('compiled_mismatch', path, '命中计划技能标识不一致');
  }
}

function mountKey(owner: Owner, providerRef: string, definitionRef: string): string {
  return JSON.stringify([owner, providerRef, definitionRef]);
}

function abilityIdentity(owner: Owner, providerRef: string, ability: string): string {
  return JSON.stringify([owner, providerRef, ability]);
}

function abilityPair(providerRef: string, ability: string): string {
  return JSON.stringify([providerRef, ability]);
}

function parseAbilityRef(ref: string): {
  selector: Owner | 'self' | 'opponent'; providerRef: string; ability: string
} | null {
  const match = /^(source|target|self|opponent)\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$/.exec(ref);
  return match ? {
    selector: match[1] as Owner | 'self' | 'opponent',
    providerRef: match[2]!, ability: match[3]!
  } : null;
}

function other(owner: Owner): Owner {
  return owner === 'source' ? 'target' : 'source';
}

function resolvedOwner(selector: Owner | 'self' | 'opponent', driverSource: Owner): Owner {
  return selector === 'self' ? driverSource : selector === 'opponent' ? other(driverSource) : selector;
}

/**
 * 只核对已人工冻结的目录与当前完整编译/运行输入，不生成资格标签。
 * 来源目录本身及作者详情的可信读取由调用方负责。
 */
export function auditAuthoredOrdinaryDamageSources(
  request: CompileRequest,
  run: RunRequest,
  input: OrdinaryDamageSourceAuditInput
): OrdinaryDamageSourceAudit {
  checkHashes(request, run);
  checkActorShape(request, run, input);
  const reviews = checkCatalog(input);
  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    fail('invalid_input', 'sources.sources', '需要至少一条已核来源绑定');
  }
  const inventory = inventoryDamageOperations(request);
  if (inventory.executeThresholdOperations.length) {
    fail('independent_execution', inventory.executeThresholdOperations[0]!.path,
      '独立处决不是已核普通直接伤害');
  }
  const claims = new Map<string, OrdinaryDamageSourceAuditFact>();
  const mounted = new Set<string>();
  const approvedAbilities = new Set<string>();
  const approvedPairs = new Set<string>();
  const duplicateBindings = new Set<string>();
  const driverCounts = new Map<OrdinaryDamageSourceBinding, string[]>();

  for (const [index, source] of input.sources.entries()) {
    const path = `sources.sources[${index}]`;
    const allowed = ['reviewKey', 'owner', 'providerRef', 'hitBinding', 'skill', 'relation'];
    for (const extra of Object.keys(source)) {
      if (!allowed.includes(extra)) fail('invalid_input', `${path}.${extra}`, '来源绑定只能引用已核目录');
    }
    const reviewKey = key(source.reviewKey, `${path}.reviewKey`);
    const review = reviews.get(reviewKey);
    if (!review) fail('catalog_mismatch', `${path}.reviewKey`, '未在已核来源目录中找到标识');
    if (source.owner !== 'source' && source.owner !== 'target') {
      fail('invalid_input', `${path}.owner`, '运行拥有者必须是 source 或 target');
    }
    const providerRef = key(source.providerRef, `${path}.providerRef`);
    const definitionRef = key(source.hitBinding?.hitProviderKey, `${path}.hitBinding.hitProviderKey`);
    const abilityKey = key(source.hitBinding?.hitAbilityKey, `${path}.hitBinding.hitAbilityKey`);
    const bindingIdentity = JSON.stringify([reviewKey, source.owner, providerRef, definitionRef, abilityKey]);
    if (duplicateBindings.has(bindingIdentity)) fail('invalid_input', path, '相同来源绑定重复');
    duplicateBindings.add(bindingIdentity);
    if (input.combatants[source.owner].characterKey !== review.characterKey) {
      fail('ownership_mismatch', `sources.combatants.${source.owner}.characterKey`, '运行人物与已核来源所属人物不同');
    }
    checkAuthored(source, review, input, path);
    const providerPath = `sharedProviders[${JSON.stringify(definitionRef)}]`;
    const provider = exactlyOne(request.sharedProviders ?? [],
      (item) => item.providerKey === definitionRef, providerPath);
    const abilityPath = `${providerPath}.abilities[${JSON.stringify(abilityKey)}]`;
    const ability = exactlyOne(provider.abilities ?? [],
      (item) => item.abilityKey === abilityKey, abilityPath);
    if (ability.kind !== 'active') fail('compiled_mismatch', `${abilityPath}.kind`, '命中能力必须是主动单次入口');
    if (ability.castOrigin !== undefined && ability.castOrigin !== 'champion') {
      fail('compiled_mismatch', `${abilityPath}.castOrigin`, '正式角色技能只接受缺省或 champion 施放来源');
    }
    const adapted = adaptHitProgram(source.hitBinding.authored);
    const expectedOperation: OperationDefinition = {
      operation: 'resolve_skill_hit', target: 'target', skillHit: adapted.skillHit
    };
    if (!same(ability.operations, [expectedOperation])) {
      fail('compiled_mismatch', `${abilityPath}.operations`, '最终命中候选与完整作者组成重编结果不一致');
    }
    if (ability.skillKey !== undefined && ability.skillKey !== review.skillKey) {
      fail('compiled_mismatch', `${abilityPath}.skillKey`, '最终能力技能标识与来源不一致');
    }
    checkDependencies(request, run, source, adapted, ability, abilityPath);
    const expectedCandidateKey = `${review.ruleKey}:${review.actionKey}:${review.resultKey}`;
    const candidate = exactlyOne(adapted.skillHit.candidates,
      (item) => item.candidateKey === expectedCandidateKey
        && item.effectOccurrenceKey === `${review.ruleKey}:${review.actionKey}`
        && item.effectKey === review.effectKey && item.resultKey === review.resultKey,
      `${abilityPath}.operations[0].skillHit.candidates[${JSON.stringify(expectedCandidateKey)}]`);
    const expectedDamage = candidate.operations.filter((operation) => operation.operation === 'damage');
    if (expectedDamage.length !== 1 || candidate.semantic.resultType !== 'DAMAGE') {
      fail('compiled_mismatch', `${abilityPath}.operations[0].skillHit.candidates[${JSON.stringify(expectedCandidateKey)}]`,
        '已核结果必须且只能编译为一笔直接伤害');
    }
    const matches = inventory.damageOperations.filter((entry) => entry.providerKey === definitionRef
      && entry.abilityKey === abilityKey && entry.container === 'skill_hit_candidate'
      && entry.skillHit?.candidateKey === expectedCandidateKey
      && entry.skillHit.effectKey === review.effectKey
      && entry.skillHit.resultKey === review.resultKey
      && entry.skillHit.skillKey === review.skillKey);
    if (matches.length !== 1 || !same(matches[0]!.operation, expectedDamage[0])) {
      fail('compiled_mismatch', `${abilityPath}.operations[0].skillHit.candidates[${JSON.stringify(expectedCandidateKey)}]`,
        '最终伤害操作与已核候选不一致或不唯一');
    }
    const entry = matches[0]!;
    if (claims.has(entry.path)) fail('catalog_mismatch', entry.path, '同一伤害操作被多条来源重复认领');
    const ownerActor = request.combatants.find((actor) => actor.key === source.owner)!;
    const ownerSnapshot = run.initialSnapshot.combatants.find((actor) => actor.key === source.owner)!;
    const compileMountPath = `combatants[${JSON.stringify(source.owner)}].providers[${JSON.stringify(providerRef)}]`;
    const snapshotMountPath = `initialSnapshot.combatants[${JSON.stringify(source.owner)}].providers[${JSON.stringify(providerRef)}]`;
    const compileMount = exactlyOne(ownerActor.providers,
      (mount) => mount.providerRef === providerRef, compileMountPath);
    const snapshotMount = exactlyOne(ownerSnapshot.providers,
      (mount) => mount.providerRef === providerRef, snapshotMountPath);
    if (compileMount.definitionRef !== definitionRef) {
      fail('ownership_mismatch', `${compileMountPath}.definitionRef`, '编译挂载指向其他产伤定义');
    }
    if (snapshotMount.definitionRef !== definitionRef
      || snapshotMount.owner !== source.owner || snapshotMount.source !== source.owner) {
      fail('ownership_mismatch', snapshotMountPath, '初始快照挂载的定义、拥有者或来源不一致');
    }
    const mountIdentity = mountKey(source.owner, providerRef, definitionRef);
    // 同一挂载可以承载多个分别核定的结果；同一操作路径仍只能认领一次。
    mounted.add(mountIdentity);
    approvedAbilities.add(abilityIdentity(source.owner, providerRef, abilityKey));
    approvedPairs.add(abilityPair(providerRef, abilityKey));
    driverCounts.set(source, []);
    claims.set(entry.path, {
      catalogKey: input.catalog.catalogKey, reviewKey, classification: review.classification,
      gameId: input.gameId, owner: source.owner, characterKey: review.characterKey,
      providerRef, providerKey: definitionRef, abilityKey, skillKey: review.skillKey,
      ruleKey: review.ruleKey, actionKey: review.actionKey,
      effectKey: review.effectKey, resultKey: review.resultKey,
      candidateKey: expectedCandidateKey, damageTypeKey: review.damageTypeKey,
      deliveryKind: review.deliveryKind, originKind: review.originKind,
      operationPath: entry.path, operation: structuredClone(entry.operation),
      reviewedResult: structuredClone(review.reviewedResult), driverEntryKeys: []
    });
  }

  for (const entry of inventory.damageOperations) {
    if (!claims.has(entry.path)) fail('unreviewed_damage', entry.path, '存在未被已核来源逐项覆盖的伤害操作');
  }
  const producingProviders = new Set(inventory.damageOperations
    .map((entry) => entry.providerKey).filter((value): value is string => value !== null));
  for (const owner of ['source', 'target'] as const) {
    const actor = request.combatants.find((item) => item.key === owner)!;
    const snapshot = run.initialSnapshot.combatants.find((item) => item.key === owner)!;
    for (const [path, mounts] of [
      [`combatants[${JSON.stringify(owner)}].providers`, actor.providers],
      [`initialSnapshot.combatants[${JSON.stringify(owner)}].providers`, snapshot.providers]
    ] as const) {
      for (const [index, mount] of mounts.entries()) {
        if (!producingProviders.has(mount.definitionRef)) continue;
        if (!mounted.has(mountKey(owner, mount.providerRef, mount.definitionRef))) {
          fail('ownership_mismatch', `${path}[${index}]`, '产伤定义被其他对象或实例复用，缺少对应核定绑定');
        }
        if ('owner' in mount && (mount.owner !== owner || mount.source !== owner)) {
          fail('ownership_mismatch', `${path}[${index}]`, '产伤实例的实际拥有者或来源与运行人物不同');
        }
      }
    }
  }
  for (const reference of inventory.references) {
    if (reference.kind === 'apply_provider_definition' && producingProviders.has(reference.value)) {
      fail('unverified_reference', reference.path, '动态应用产伤定义缺少实例级来源核对');
    }
    const parsed = reference.kind === 'listener_ability' ? parseAbilityRef(reference.value) : null;
    if (parsed && approvedPairs.has(abilityPair(parsed.providerRef, parsed.ability))) {
      fail('unverified_reference', reference.path, '监听器再次触发已核产伤能力，缺少独立入口核定');
    }
  }
  if (!Array.isArray(run.driverPlan.entries)) {
    fail('invalid_input', 'driverPlan.entries', '需要明确的驱动条目');
  }
  for (const [index, driver] of run.driverPlan.entries.entries()) {
    const parsed = parseAbilityRef(driver.abilityRef);
    if (!parsed || !approvedPairs.has(abilityPair(parsed.providerRef, parsed.ability))) continue;
    const owner = resolvedOwner(parsed.selector, driver.source);
    if (!approvedAbilities.has(abilityIdentity(owner, parsed.providerRef, parsed.ability))
      || driver.source !== owner) {
      fail('ownership_mismatch', `driverPlan.entries[${index}].source`,
        '产伤能力驱动与已核拥有者不一致');
    }
    if (driver.target !== other(owner)) {
      fail('ownership_mismatch', `driverPlan.entries[${index}].target`,
        '本入口产伤目标必须是另一名实际敌方英雄');
    }
    for (const source of input.sources) {
      if (source.owner === owner && source.providerRef === parsed.providerRef
        && source.hitBinding.hitAbilityKey === parsed.ability) {
        driverCounts.get(source)!.push(driver.entryKey);
      }
    }
  }
  for (const source of input.sources) {
    const drivers = driverCounts.get(source)!;
    if (!drivers.length) {
      fail('ownership_mismatch', `sources.sources[${input.sources.indexOf(source)}].hitBinding`,
        '已核产伤能力没有明确的同归属驱动入口');
    }
    for (const fact of claims.values()) {
      if (fact.reviewKey === source.reviewKey && fact.owner === source.owner
        && fact.providerRef === source.providerRef) {
        fact.driverEntryKeys = [...drivers].sort();
      }
    }
  }
  return {
    gameId: input.gameId, catalogKey: input.catalog.catalogKey,
    facts: [...claims.values()].sort((a, b) => a.operationPath.localeCompare(b.operationPath)),
    repeatOperations: [...inventory.repeatOperations].sort((a, b) => a.path.localeCompare(b.path)),
    references: [...inventory.references].sort((a, b) => a.path.localeCompare(b.path))
  };
}
