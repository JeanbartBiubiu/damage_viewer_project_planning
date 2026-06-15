import type { JsonObject, Skill } from '../../../../types/api';

export type ItemSkillRefsValidationInput = {
  currentItemId: string;
  skillRefs: string[];
  skills: Skill[];
  skillsLoaded: boolean;
  skillsLoading: boolean;
  skillsLoadError: string | null;
};

export type ItemSkillRefsValidationIssue = {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  skillId?: string;
};

export type ItemSkillRefSummaryStatus =
  | 'ok'
  | 'unchecked'
  | 'blank'
  | 'missing'
  | 'wrong_owner_type'
  | 'wrong_owner_id';

export type ItemSkillRefSummary = {
  skillId: string;
  index: number;
  name?: string;
  ownerType: string | null;
  ownerId: string | null;
  status: ItemSkillRefSummaryStatus;
  passiveCount: number;
  ownerRoleDistribution: Record<string, number>;
  triggerCategorySummary: string[];
  operationKindSummary: string[];
};

export type ItemSkillRefsValidationResult = {
  errors: ItemSkillRefsValidationIssue[];
  warnings: ItemSkillRefsValidationIssue[];
  summaries: ItemSkillRefSummary[];
  hasBlockingErrors: boolean;
};

const ON_HIT_TRIGGER_KINDS = new Set([
  'on_hit',
  'on_basic_attack_hit',
  'on_damage_dealt',
  'on_spell_hit'
]);

const PASSIVE_CATEGORY_LABELS: Record<string, string> = {
  'on-hit': 'on-hit',
  'every-N': 'every-N',
  energized: 'energized',
  spellblade: 'spellblade',
  'phantom-hit': 'phantom-hit'
};

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readDpsPassiveEffects(skill: Skill | undefined): unknown[] {
  if (!skill) {
    return [];
  }
  const mechanicsConfig = skill.mechanicsConfig;
  if (!isPlainObject(mechanicsConfig)) {
    return [];
  }
  const raw = mechanicsConfig.dpsPassiveEffects ?? mechanicsConfig.dpsPassiveEffect;
  if (Array.isArray(raw)) {
    return raw;
  }
  if (isPlainObject(raw)) {
    return [raw];
  }
  return [];
}

function hasOperationKind(passive: JsonObject, kindPrefix: string): boolean {
  const operations = passive.operations;
  if (!Array.isArray(operations)) {
    return false;
  }
  return operations.some((operation) => isPlainObject(operation) && asText(operation.kind).startsWith(kindPrefix));
}

function inferPassiveCategories(passive: JsonObject): string[] {
  const categories = new Set<string>();
  const triggerKind = asText(passive.triggerKind);
  const trigger = isPlainObject(passive.trigger) ? passive.trigger : null;
  const triggerEvent = asText(trigger?.event) || triggerKind;

  if (triggerKind === 'next_basic_attack_after_state' || triggerEvent === 'next_basic_attack_after_state') {
    categories.add('spellblade');
  }
  if (hasOperationKind(passive, 'next_attack_state_consume')) {
    categories.add('spellblade');
  }
  if (triggerKind === 'energized_charge_and_consume' || hasOperationKind(passive, 'energized_charge')) {
    categories.add('energized');
  }
  if (hasOperationKind(passive, 'phantom_hit_on_hit_repeat')) {
    categories.add('phantom-hit');
  }
  if (triggerKind === 'every_n_basic_attack_hit' || passive.everyN !== undefined) {
    categories.add('every-N');
  }
  if (ON_HIT_TRIGGER_KINDS.has(triggerEvent) || ON_HIT_TRIGGER_KINDS.has(triggerKind)) {
    categories.add('on-hit');
  }

  return [...categories];
}

function summarizeOwnerRoleDistribution(passives: unknown[]): Record<string, number> {
  const distribution: Record<string, number> = {};
  passives.forEach((passive) => {
    if (!isPlainObject(passive)) {
      return;
    }
    const ownerRole = asText(passive.ownerRole) || '(missing)';
    distribution[ownerRole] = (distribution[ownerRole] ?? 0) + 1;
  });
  return distribution;
}

function summarizeTriggerCategories(passives: unknown[]): string[] {
  const categories = new Set<string>();
  passives.forEach((passive) => {
    if (!isPlainObject(passive)) {
      return;
    }
    inferPassiveCategories(passive).forEach((category) => categories.add(category));
  });
  return [...categories].map((category) => PASSIVE_CATEGORY_LABELS[category] ?? category);
}

function summarizeOperationKinds(passives: unknown[]): string[] {
  const kinds = new Set<string>();
  passives.forEach((passive) => {
    if (!isPlainObject(passive)) {
      return;
    }
    const operations = passive.operations;
    if (!Array.isArray(operations)) {
      return;
    }
    operations.forEach((operation) => {
      if (!isPlainObject(operation)) {
        return;
      }
      const kind = asText(operation.kind);
      if (kind) {
        kinds.add(kind);
      }
    });
  });
  return [...kinds].sort();
}

function resolveRefStatus(
  skillRef: string,
  currentItemId: string,
  skill: Skill | undefined,
  skillsLoaded: boolean
): ItemSkillRefSummaryStatus {
  if (!skillRef.trim()) {
    return 'blank';
  }
  if (!skillsLoaded) {
    return 'unchecked';
  }
  if (!skill) {
    return 'missing';
  }
  if (skill.ownerType !== 'item') {
    return 'wrong_owner_type';
  }
  if (skill.ownerId !== currentItemId) {
    return 'wrong_owner_id';
  }
  return 'ok';
}

function pushIssue(
  issues: ItemSkillRefsValidationIssue[],
  severity: 'error' | 'warning',
  code: string,
  message: string,
  skillId?: string
) {
  issues.push({ severity, code, message, skillId });
}

function issueDedupeKey(issue: ItemSkillRefsValidationIssue): string {
  return `${issue.code}:${issue.skillId ?? ''}:${issue.message}`;
}

function dedupeIssues(
  issues: ItemSkillRefsValidationIssue[],
  preserveAllForCodes: ReadonlySet<string>
): ItemSkillRefsValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    if (preserveAllForCodes.has(issue.code)) {
      return true;
    }
    const key = issueDedupeKey(issue);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function validateItemSkillRefs(input: ItemSkillRefsValidationInput): ItemSkillRefsValidationResult {
  const errors: ItemSkillRefsValidationIssue[] = [];
  const warnings: ItemSkillRefsValidationIssue[] = [];
  const summaries: ItemSkillRefSummary[] = [];
  const currentItemId = input.currentItemId.trim();
  const skillById = new Map(input.skills.map((skill) => [skill.skillId, skill]));
  const seenSkillIds = new Map<string, number>();
  const categoryToSkillIds = new Map<string, Set<string>>();

  if (!currentItemId && input.skillRefs.length > 0) {
    pushIssue(
      errors,
      'error',
      'itemId_blank_with_skillRefs',
      'itemId 为空时不能保存非空 skillRefs。'
    );
  }

  const hasNonBlankRefs = input.skillRefs.some((skillRef) => skillRef.trim());
  if (hasNonBlankRefs && !input.skillsLoading) {
    if (input.skillsLoadError) {
      pushIssue(
        warnings,
        'warning',
        'skills_load_failed',
        `技能列表加载失败，缺失/归属校验不完整：${input.skillsLoadError}`
      );
    } else if (!input.skillsLoaded) {
      pushIssue(
        warnings,
        'warning',
        'skills_load_incomplete',
        '技能列表未成功加载，缺失/归属校验不完整。'
      );
    }
  }

  input.skillRefs.forEach((skillRef, index) => {
    const trimmedRef = skillRef.trim();
    const skill = trimmedRef ? skillById.get(trimmedRef) : undefined;
    const isDuplicateRef = Boolean(trimmedRef && seenSkillIds.has(trimmedRef));

    if (!trimmedRef) {
      pushIssue(
        errors,
        'error',
        'skillRefs_blank_entry',
        `skillRefs[${index}] 为空字符串。`,
        skillRef
      );
    } else if (isDuplicateRef) {
      pushIssue(
        errors,
        'error',
        'skillRefs_duplicate',
        `skillRefs 包含重复 skillId：${trimmedRef}。`,
        trimmedRef
      );
    } else {
      seenSkillIds.set(trimmedRef, index);
    }

    if (input.skillsLoaded && trimmedRef && !isDuplicateRef) {
      if (!skill) {
        pushIssue(
          errors,
          'error',
          'skillRef_unknown_skill',
          `引用的 skill 不存在：${trimmedRef}。`,
          trimmedRef
        );
      } else if (skill.ownerType !== 'item') {
        pushIssue(
          errors,
          'error',
          'skillRef_ownerType_mismatch',
          `skill ${trimmedRef} 的 ownerType=${skill.ownerType ?? 'undefined'}，期望 item。`,
          trimmedRef
        );
      } else if (skill.ownerId !== currentItemId) {
        pushIssue(
          errors,
          'error',
          'skillRef_ownerId_mismatch',
          `skill ${trimmedRef} 归属 item ${skill.ownerId ?? 'undefined'}，与当前 itemId=${currentItemId || '(empty)'} 不一致。`,
          trimmedRef
        );
      }
    }

    const passives = readDpsPassiveEffects(skill);
    const mechanicsConfig = skill?.mechanicsConfig;
    const hasMalformedPassives = Boolean(
      skill
      && isPlainObject(mechanicsConfig)
      && 'dpsPassiveEffects' in mechanicsConfig
      && mechanicsConfig.dpsPassiveEffects !== undefined
      && !Array.isArray(mechanicsConfig.dpsPassiveEffects)
    );
    const hasMissingPassiveArray = Boolean(
      skill
      && (!isPlainObject(mechanicsConfig)
        || !Array.isArray(mechanicsConfig.dpsPassiveEffects)
        || mechanicsConfig.dpsPassiveEffects.length === 0)
    );

    if (trimmedRef && skill && !isDuplicateRef && resolveRefStatus(trimmedRef, currentItemId, skill, input.skillsLoaded) === 'ok') {
      if (hasMalformedPassives) {
        pushIssue(
          warnings,
          'warning',
          'skillRef_passive_shape_malformed',
          `skill ${trimmedRef} 的 dpsPassiveEffects 结构异常（应为数组）。`,
          trimmedRef
        );
      } else if (hasMissingPassiveArray) {
        pushIssue(
          warnings,
          'warning',
          'skillRef_passive_missing',
          `skill ${trimmedRef} 没有 dpsPassiveEffects 或数组为空。`,
          trimmedRef
        );
      } else {
        passives.forEach((passive, passiveIndex) => {
          if (!isPlainObject(passive)) {
            pushIssue(
              warnings,
              'warning',
              'skillRef_passive_shape_malformed',
              `skill ${trimmedRef} 的 dpsPassiveEffects[${passiveIndex}] 不是对象。`,
              trimmedRef
            );
            return;
          }

          const ownerRole = asText(passive.ownerRole);
          if (!ownerRole) {
            pushIssue(
              warnings,
              'warning',
              'skillRef_passive_ownerRole_missing',
              `skill ${trimmedRef} 的 dpsPassiveEffects[${passiveIndex}] 缺少 ownerRole。`,
              trimmedRef
            );
          } else if (ownerRole === 'target') {
            pushIssue(
              warnings,
              'warning',
              'skillRef_passive_ownerRole_target',
              `skill ${trimmedRef} 的 dpsPassiveEffects[${passiveIndex}] ownerRole=target，攻击方装备通常不会执行。`,
              trimmedRef
            );
          }

          inferPassiveCategories(passive).forEach((category) => {
            const skillIds = categoryToSkillIds.get(category) ?? new Set<string>();
            skillIds.add(trimmedRef);
            categoryToSkillIds.set(category, skillIds);
          });
        });
      }
    }

    summaries.push({
      skillId: skillRef,
      index,
      name: skill?.name,
      ownerType: skill?.ownerType ?? null,
      ownerId: skill?.ownerId ?? null,
      status: resolveRefStatus(skillRef, currentItemId, skill, input.skillsLoaded),
      passiveCount: passives.length,
      ownerRoleDistribution: summarizeOwnerRoleDistribution(passives),
      triggerCategorySummary: summarizeTriggerCategories(passives),
      operationKindSummary: summarizeOperationKinds(passives)
    });
  });

  categoryToSkillIds.forEach((skillIds, category) => {
    if (skillIds.size < 2) {
      return;
    }
    const label = PASSIVE_CATEGORY_LABELS[category] ?? category;
    pushIssue(
      warnings,
      'warning',
      'skillRefs_duplicate_category',
      `多个 skillRefs 疑似同类触发/机制：${label}（${[...skillIds].join('、')}）。`,
    );
  });

  const preserveDuplicateErrors = new Set(['skillRefs_duplicate']);
  const dedupedErrors = dedupeIssues(errors, preserveDuplicateErrors);
  const dedupedWarnings = dedupeIssues(warnings, preserveDuplicateErrors);

  return {
    errors: dedupedErrors,
    warnings: dedupedWarnings,
    summaries,
    hasBlockingErrors: dedupedErrors.length > 0
  };
}

export function formatItemSkillRefSummaryStatus(status: ItemSkillRefSummaryStatus): string {
  switch (status) {
    case 'ok':
      return 'ok';
    case 'unchecked':
      return '未校验';
    case 'blank':
      return 'blank';
    case 'missing':
      return 'missing';
    case 'wrong_owner_type':
      return 'ownerType mismatch';
    case 'wrong_owner_id':
      return 'ownerId mismatch';
    default:
      return status;
  }
}
