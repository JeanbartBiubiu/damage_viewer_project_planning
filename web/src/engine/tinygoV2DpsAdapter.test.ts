import type { GameDataBundle, Item, JsonObject, Skill } from '../types/api';
import {
  LEGACY_DPS_SKILL_REF_OPTIONS,
  STRICT_DPS_SKILL_REF_OPTIONS,
  buildPublishedContractDiagnostics,
  buildExecuteEvidenceFromCurveResult,
  buildPassiveCooldownEvidenceFromCurveResult,
  isPublishedContractCandidateItem,
  readSkillDpsPassiveEffects,
  type EquipmentSkillRefDiagnostic,
  type V2DpsCurveResult,
  resolveItemSkillRefs
} from './tinygoV2DpsAdapter';

declare const process: {
  argv: string[];
  exit(code?: number): never;
};

type PassiveShape = {
  passiveId: string;
  ownerRole?: string;
  triggerKind?: string;
  internalCooldownMs?: number;
  operations?: Array<Record<string, unknown>>;
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function diagnosticCodes(diagnostics: EquipmentSkillRefDiagnostic[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

function hasDiagnosticCode(diagnostics: EquipmentSkillRefDiagnostic[], code: string): boolean {
  return diagnostics.some((diagnostic) => diagnostic.code === code);
}

function createMinimalBundle(items: Item[], skills: Skill[]): GameDataBundle {
  return {
    meta: {
      gameId: 'contract-test',
      versionCode: 'v0',
      generatedAt: '2026-06-13T00:00:00.000Z',
      versionId: 0,
      dataHash: 'test'
    },
    attributeDefinitions: [],
    coefficientBuckets: [],
    types: [],
    typeRelations: [],
    statusActionControlRules: [],
    heroes: [],
    skills,
    items
  };
}

function makeItem(
  itemId: string,
  options: {
    name?: string;
    skillRefs?: string[];
    omitSkillRefs?: boolean;
  } = {}
): Item {
  const item: Item = {
    itemId,
    name: options.name,
    statModifiers: []
  };
  if (!options.omitSkillRefs) {
    item.skillRefs = options.skillRefs ?? [];
  }
  return item;
}

function makeSkill(
  skillId: string,
  ownerId: string,
  options: {
    name?: string;
    ownerType?: string | null;
    passives?: PassiveShape[];
    mechanicsConfig?: JsonObject;
  } = {}
): Skill {
  const passives = options.passives ?? [];
  const mechanicsConfig = options.mechanicsConfig ?? (passives.length > 0
    ? { dpsPassiveEffects: passives as unknown as JsonObject[] }
    : undefined);
  return {
    skillId,
    ownerType: options.ownerType === undefined ? 'item' : options.ownerType,
    ownerId,
    name: options.name,
    mechanicsConfig
  };
}

function testEmptyRefsStrict(): void {
  const item = makeItem('item_a', { name: 'Boots', skillRefs: [] });
  const skill = makeSkill('skill_a', 'item_a', {
    name: 'On Hit',
    passives: [{ passiveId: 'p1', triggerKind: 'on_hit' }]
  });
  const bundle = createMinimalBundle([item], [skill]);
  const result = resolveItemSkillRefs(bundle, item, 'attacker', STRICT_DPS_SKILL_REF_OPTIONS);

  assert(result.linkedSkillIds.size === 0, 'empty skillRefs must not link passives under STRICT');
  assert(hasDiagnosticCode(result.diagnostics, 'skillRefs_empty'), 'empty skillRefs must emit skillRefs_empty');
}

function testMissingRefsStrict(): void {
  const item = makeItem('item_a', { name: 'Boots', omitSkillRefs: true });
  const skill = makeSkill('skill_a', 'item_a', {
    passives: [{ passiveId: 'p1', triggerKind: 'on_hit' }]
  });
  const bundle = createMinimalBundle([item], [skill]);
  const result = resolveItemSkillRefs(bundle, item, 'attacker', STRICT_DPS_SKILL_REF_OPTIONS);

  assert(result.linkedSkillIds.size === 0, 'missing skillRefs must not link passives under STRICT');
  assert(hasDiagnosticCode(result.diagnostics, 'skillRefs_missing'), 'missing skillRefs must emit skillRefs_missing');
}

function testUnknownRef(): void {
  const item = makeItem('item_a', { skillRefs: ['missing_skill'] });
  const bundle = createMinimalBundle([item], []);
  const result = resolveItemSkillRefs(bundle, item, 'attacker', STRICT_DPS_SKILL_REF_OPTIONS);

  assert(result.linkedSkillIds.size === 0, 'unknown skill ref must not link');
  assert(hasDiagnosticCode(result.diagnostics, 'skillRef_unknown_skill'), 'unknown ref must emit skillRef_unknown_skill');
  const unknown = result.diagnostics.find((diagnostic) => diagnostic.code === 'skillRef_unknown_skill');
  assert(unknown?.skillId === 'missing_skill', 'unknown ref diagnostic must retain skillId');
  assert(unknown?.skillName === undefined, 'unknown ref diagnostic must not invent skillName');
}

function testOwnerTypeMismatch(): void {
  const item = makeItem('item_a', { skillRefs: ['hero_skill'] });
  const skill = makeSkill('hero_skill', 'hero_1', { ownerType: 'hero' });
  const bundle = createMinimalBundle([item], [skill]);
  const result = resolveItemSkillRefs(bundle, item, 'attacker', STRICT_DPS_SKILL_REF_OPTIONS);

  assert(result.linkedSkillIds.size === 0, 'wrong ownerType must not link');
  assert(hasDiagnosticCode(result.diagnostics, 'skillRef_ownerType_mismatch'), 'wrong ownerType must emit mismatch diagnostic');
}

function testOwnerIdMismatch(): void {
  const item = makeItem('item_a', { skillRefs: ['skill_b'] });
  const skill = makeSkill('skill_b', 'item_b');
  const bundle = createMinimalBundle([item, makeItem('item_b')], [skill]);
  const result = resolveItemSkillRefs(bundle, item, 'attacker', STRICT_DPS_SKILL_REF_OPTIONS);

  assert(result.linkedSkillIds.size === 0, 'wrong ownerId must not link');
  assert(hasDiagnosticCode(result.diagnostics, 'skillRef_ownerId_mismatch'), 'wrong ownerId must emit mismatch diagnostic');
}

function testDuplicateRefs(): void {
  const item = makeItem('item_a', { skillRefs: ['skill_a', 'skill_a'] });
  const skill = makeSkill('skill_a', 'item_a', {
    passives: [{ passiveId: 'p1', triggerKind: 'on_hit' }]
  });
  const bundle = createMinimalBundle([item], [skill]);
  const result = resolveItemSkillRefs(bundle, item, 'attacker', STRICT_DPS_SKILL_REF_OPTIONS);

  assert(result.linkedSkillIds.size === 1, 'duplicate refs must dedupe linked skills');
  assert(result.linkedSkillIds.has('skill_a'), 'duplicate refs must still link the unique skill');
  assert(hasDiagnosticCode(result.diagnostics, 'skillRefs_duplicate'), 'duplicate refs must emit duplicate diagnostic');
}

function testAttackerCorrectReference(): void {
  const item = makeItem('item_a', { name: 'Trinity', skillRefs: ['skill_a'] });
  const skill = makeSkill('skill_a', 'item_a', {
    name: 'Spellblade',
    passives: [{ passiveId: 'p1', ownerRole: 'attacker', triggerKind: 'on_hit' }]
  });
  const bundle = createMinimalBundle([item], [skill]);
  const result = resolveItemSkillRefs(bundle, item, 'attacker', STRICT_DPS_SKILL_REF_OPTIONS);

  assert(result.linkedSkillIds.has('skill_a'), 'valid attacker ref must link skill');
  assert(!hasDiagnosticCode(result.diagnostics, 'skillRef_ownerRole_mismatch'), 'attacker passive must not emit ownerRole mismatch');
}

function testAttackerReferencesTargetPassive(): void {
  const item = makeItem('item_a', { skillRefs: ['skill_a'] });
  const skill = makeSkill('skill_a', 'item_a', {
    passives: [{ passiveId: 'p1', ownerRole: 'target', triggerKind: 'on_hit' }]
  });
  const bundle = createMinimalBundle([item], [skill]);
  const result = resolveItemSkillRefs(bundle, item, 'attacker', STRICT_DPS_SKILL_REF_OPTIONS);

  assert(result.linkedSkillIds.has('skill_a'), 'skill ref validation should still link the skill');
  assert(hasDiagnosticCode(result.diagnostics, 'skillRef_ownerRole_mismatch'), 'attacker must not silently accept target-only passive');
}

function testTargetCorrectReference(): void {
  const item = makeItem('item_a', { skillRefs: ['skill_a'] });
  const skill = makeSkill('skill_a', 'item_a', {
    passives: [{ passiveId: 'p1', ownerRole: 'target', triggerKind: 'on_hit' }]
  });
  const bundle = createMinimalBundle([item], [skill]);
  const result = resolveItemSkillRefs(bundle, item, 'target', STRICT_DPS_SKILL_REF_OPTIONS);

  assert(result.linkedSkillIds.has('skill_a'), 'target ref must link skill');
  assert(!hasDiagnosticCode(result.diagnostics, 'skillRef_ownerRole_mismatch'), 'target ownerRole=target passive must not mismatch');
}

function testTargetReferencesAttackerOrMissingOwnerRole(): void {
  const itemAttackerRole = makeItem('item_a', { skillRefs: ['skill_attacker'] });
  const itemMissingRole = makeItem('item_b', { skillRefs: ['skill_missing'] });
  const skillAttacker = makeSkill('skill_attacker', 'item_a', {
    passives: [{ passiveId: 'p1', ownerRole: 'attacker', triggerKind: 'on_hit' }]
  });
  const skillMissing = makeSkill('skill_missing', 'item_b', {
    passives: [{ passiveId: 'p2', triggerKind: 'on_hit' }]
  });
  const bundle = createMinimalBundle(
    [itemAttackerRole, itemMissingRole],
    [skillAttacker, skillMissing]
  );

  const attackerRoleResult = resolveItemSkillRefs(bundle, itemAttackerRole, 'target', STRICT_DPS_SKILL_REF_OPTIONS);
  assert(attackerRoleResult.linkedSkillIds.has('skill_attacker'), 'target audience still links referenced skill');
  assert(
    hasDiagnosticCode(attackerRoleResult.diagnostics, 'skillRef_ownerRole_mismatch'),
    'target must reject attacker ownerRole passive'
  );

  const missingRoleResult = resolveItemSkillRefs(bundle, itemMissingRole, 'target', STRICT_DPS_SKILL_REF_OPTIONS);
  assert(missingRoleResult.linkedSkillIds.has('skill_missing'), 'target audience still links referenced skill');
  assert(
    hasDiagnosticCode(missingRoleResult.diagnostics, 'skillRef_ownerRole_mismatch'),
    'target must reject missing ownerRole passive'
  );
}

function testLegacyFallbackEmitsWarningWithoutChangingStrictSemantics(): void {
  const item = makeItem('item_a', { skillRefs: [] });
  const skill = makeSkill('skill_a', 'item_a', {
    passives: [{ passiveId: 'p1', triggerKind: 'on_hit' }]
  });
  const bundle = createMinimalBundle([item], [skill]);

  const strict = resolveItemSkillRefs(bundle, item, 'attacker', STRICT_DPS_SKILL_REF_OPTIONS);
  assert(strict.linkedSkillIds.size === 0, 'STRICT must remain non-matching for empty refs');
  assert(!hasDiagnosticCode(strict.diagnostics, 'skillRef_legacy_match_all'), 'STRICT must not emit legacy fallback');

  const legacy = resolveItemSkillRefs(bundle, item, 'attacker', LEGACY_DPS_SKILL_REF_OPTIONS);
  assert(legacy.linkedSkillIds.has('skill_a'), 'LEGACY may match all item-owned skills for migration');
  assert(hasDiagnosticCode(legacy.diagnostics, 'skillRef_legacy_match_all'), 'LEGACY must emit legacy fallback warning');
  assert(
    diagnosticCodes(legacy.diagnostics).includes('skillRefs_empty'),
    'LEGACY must still surface empty refs diagnostic'
  );
}

function testPublishedUnknownSkillIsError(): void {
  const item = makeItem('item_a', { skillRefs: ['missing_skill'] });
  const diagnostics = buildPublishedContractDiagnostics([item], []);
  assert(
    diagnostics.some((diagnostic) => diagnostic.code === 'skillRef_unknown_skill' && diagnostic.severity === 'error'),
    'unknown skill must be publish error'
  );
}

function testPublishedOwnerTypeMismatchIsError(): void {
  const item = makeItem('item_a', { skillRefs: ['hero_skill'] });
  const skill = makeSkill('hero_skill', 'hero_1', { ownerType: 'hero' });
  const diagnostics = buildPublishedContractDiagnostics([item], [skill]);
  assert(
    diagnostics.some((diagnostic) => diagnostic.code === 'skillRef_ownerType_mismatch' && diagnostic.severity === 'error'),
    'ownerType mismatch must be publish error'
  );
}

function testPublishedOwnerIdMismatchIsError(): void {
  const item = makeItem('item_a', { skillRefs: ['skill_b'] });
  const skill = makeSkill('skill_b', 'item_b');
  const diagnostics = buildPublishedContractDiagnostics([item, makeItem('item_b')], [skill]);
  assert(
    diagnostics.some((diagnostic) => diagnostic.code === 'skillRef_ownerId_mismatch' && diagnostic.severity === 'error'),
    'ownerId mismatch must be publish error'
  );
}

function testPublishedDuplicateRefsAreWarning(): void {
  const item = makeItem('item_a', { skillRefs: ['skill_a', 'skill_a'] });
  const skill = makeSkill('skill_a', 'item_a', {
    passives: [{ passiveId: 'p1', triggerKind: 'on_hit' }]
  });
  const diagnostics = buildPublishedContractDiagnostics([item], [skill]);
  const duplicateWarnings = diagnostics.filter((diagnostic) => diagnostic.code === 'skillRefs_duplicate');
  assert(duplicateWarnings.length > 0, 'duplicate refs must emit warning');
  const resolved = resolveItemSkillRefs(createMinimalBundle([item], [skill]), item, 'attacker', STRICT_DPS_SKILL_REF_OPTIONS);
  assert(resolved.linkedSkillIds.size === 1, 'duplicate refs must still link unique skill');
}

function testPublishedValidItemOwnedSkillHasNoError(): void {
  const item = makeItem('item_a', { skillRefs: ['skill_a'] });
  const skill = makeSkill('skill_a', 'item_a', {
    passives: [{ passiveId: 'p1', ownerRole: 'attacker', triggerKind: 'on_hit' }]
  });
  const diagnostics = buildPublishedContractDiagnostics([item], [skill]);
  assert(!diagnostics.some((diagnostic) => diagnostic.severity === 'error'), 'valid item-owned skill must not error');
}

function testPublishedMissingRefsEmitsWarningNotError(): void {
  const item = makeItem('item_a', { name: 'Boots', omitSkillRefs: true });
  const skill = makeSkill('skill_a', 'item_a', {
    name: 'On Hit',
    passives: [{ passiveId: 'p1', ownerRole: 'attacker', triggerKind: 'on_hit' }]
  });
  const diagnostics = buildPublishedContractDiagnostics([item], [skill]);
  const missing = diagnostics.filter((diagnostic) => diagnostic.code === 'skillRefs_missing');
  assert(missing.length > 0, 'missing skillRefs must emit visible skillRefs_missing diagnostic');
  assert(
    missing.every((diagnostic) => diagnostic.severity === 'warning'),
    'missing skillRefs must be warning in published preflight'
  );
  assert(!diagnostics.some((diagnostic) => diagnostic.severity === 'error'), 'missing skillRefs must not error');
}

function testPublishedEmptyRefsEmitsInfoNotError(): void {
  const item = makeItem('item_a', { name: 'Boots', skillRefs: [] });
  const skill = makeSkill('skill_a', 'item_a', {
    name: 'On Hit',
    passives: [{ passiveId: 'p1', ownerRole: 'attacker', triggerKind: 'on_hit' }]
  });
  const diagnostics = buildPublishedContractDiagnostics([item], [skill]);
  const empty = diagnostics.filter((diagnostic) => diagnostic.code === 'skillRefs_empty');
  assert(empty.length > 0, 'empty skillRefs must emit visible skillRefs_empty diagnostic');
  assert(
    empty.every((diagnostic) => diagnostic.severity === 'info'),
    'empty skillRefs must be info in published preflight'
  );
  assert(!diagnostics.some((diagnostic) => diagnostic.severity === 'error'), 'empty skillRefs must not error');
}

function testPublishedMixedAttackerAndTargetPassivesDoNotError(): void {
  const item = makeItem('item_a', { name: 'Mixed Gear', skillRefs: ['skill_attacker', 'skill_target'] });
  const skillAttacker = makeSkill('skill_attacker', 'item_a', {
    name: 'Attacker Passive',
    passives: [{ passiveId: 'p_attacker', ownerRole: 'attacker', triggerKind: 'on_hit' }]
  });
  const skillTarget = makeSkill('skill_target', 'item_a', {
    name: 'Target Passive',
    passives: [{ passiveId: 'p_target', ownerRole: 'target', triggerKind: 'on_hit' }]
  });
  const diagnostics = buildPublishedContractDiagnostics([item], [skillAttacker, skillTarget]);
  assert(!diagnostics.some((diagnostic) => diagnostic.severity === 'error'), 'mixed attacker/target passives must not publish-error');
  const ownerRoleMismatches = diagnostics.filter((diagnostic) => diagnostic.code === 'skillRef_ownerRole_mismatch');
  if (ownerRoleMismatches.length > 0) {
    assert(
      ownerRoleMismatches.every((diagnostic) => diagnostic.severity === 'warning'),
      'ownerRole mismatch must downgrade to warning in published preflight'
    );
  }
}

function testPublishedDpsPassiveEffectsNotArrayIsError(): void {
  const item = makeItem('item_a', { omitSkillRefs: true });
  const skill = makeSkill('skill_a', 'item_a', {
    mechanicsConfig: {
      dpsPassiveEffects: { passiveId: 'p1' }
    }
  });
  const diagnostics = buildPublishedContractDiagnostics([item], [skill]);
  assert(
    diagnostics.some((diagnostic) => diagnostic.code === 'dpsPassiveEffects_not_array' && diagnostic.severity === 'error'),
    'non-array dpsPassiveEffects must be publish error'
  );
}

function testPublishedCandidateFilteringSkipsIrrelevantItems(): void {
  const irrelevant = makeItem('boots', { omitSkillRefs: true });
  const diagnostics = buildPublishedContractDiagnostics([irrelevant], []);
  assert(diagnostics.length === 0, 'irrelevant item without refs or DPS mechanics must not emit diagnostics');
  assert(!isPublishedContractCandidateItem(irrelevant, []), 'irrelevant item must not be candidate');
}

function testPreserveExecuteThresholdOperationShape(): void {
  const skill = makeSkill('collector_skill', 'collector', {
    passives: [{
      passiveId: 'execute_p',
      ownerRole: 'attacker',
      triggerKind: 'on_hit',
      operations: [{
        kind: 'execute_threshold',
        source: 'collector_execute',
        thresholdType: 'current_hp_ratio',
        thresholdValue: 0.05,
        checkTiming: 'after_damage',
        targetRole: 'target'
      }]
    }]
  });
  const effects = readSkillDpsPassiveEffects(skill);
  assert(effects.length === 1, 'execute_threshold skill must expose one passive effect');
  const operation = effects[0]?.operations?.[0];
  assert(operation?.kind === 'execute_threshold', 'operation kind must be preserved');
  assert(operation?.thresholdType === 'current_hp_ratio', 'thresholdType must be preserved');
  assert(operation?.thresholdValue === 0.05, 'thresholdValue must be preserved');
  assert(operation?.checkTiming === 'after_damage', 'checkTiming must be preserved');
  assert(operation?.source === 'collector_execute', 'source must be preserved');
}

function testExecuteEvidenceFromCurveResult(): void {
  const result = {
    curveId: 'curve_a',
    status: 'ok',
    stopReason: 'execute_threshold',
    effectBreakdown: [
      {
        kind: 'execute_threshold',
        source: 'collector_execute',
        message: 'thresholdType=current_hp_ratio thresholdValue=0.05 hpBeforeCheck=140 maxHp=1000 triggered=true currentHpRatio=0.14'
      },
      {
        kind: 'execute_threshold',
        source: 'collector_execute',
        message: 'thresholdType=current_hp_ratio thresholdValue=0.05 hpBeforeCheck=600 maxHp=1000 triggered=false currentHpRatio=0.6'
      }
    ]
  } as V2DpsCurveResult;
  const evidence = buildExecuteEvidenceFromCurveResult(result);
  assert(evidence.count === 2, 'execute evidence must count all execute_threshold entries');
  assert(evidence.triggeredCount === 1, 'execute evidence must count triggered entries');
  assert(evidence.sources.includes('collector_execute'), 'execute evidence must list sources');
  assert(evidence.stopReason === 'execute_threshold', 'execute stopReason must be preserved');
}

function testPreserveInternalCooldownMsShape(): void {
  const skill = makeSkill('proc_skill', 'item_proc', {
    passives: [{
      passiveId: 'item_example_proc',
      ownerRole: 'attacker',
      triggerKind: 'on_basic_attack_hit',
      internalCooldownMs: 1000,
      operations: [{
        kind: 'damage',
        source: 'item_example_proc',
        damageType: 'magic',
        amount: 45
      }]
    }]
  });
  const effects = readSkillDpsPassiveEffects(skill);
  assert(effects.length === 1, 'internalCooldownMs skill must expose one passive effect');
  assert(effects[0]?.internalCooldownMs === 1000, 'internalCooldownMs must be preserved on passive');
  const operation = effects[0]?.operations?.[0];
  assert(operation?.kind === 'damage', 'operation kind must be preserved');
}

function testPassiveCooldownEvidenceFromCurveResult(): void {
  const result = {
    curveId: 'curve_a',
    status: 'ok',
    effectBreakdown: [
      {
        kind: 'passive_cooldown',
        source: 'item_example_proc',
        timeMs: 0,
        message: 'passive cooldown started',
        passiveCooldown: {
          passiveKey: 'item_example_proc',
          internalCooldownMs: 1000,
          nextReadyAtMs: 1000,
          triggered: true
        }
      },
      {
        kind: 'passive_cooldown',
        source: 'item_example_proc',
        timeMs: 500,
        message: 'passive cooldown skipped',
        passiveCooldown: {
          passiveKey: 'item_example_proc',
          internalCooldownMs: 1000,
          readyAtMs: 1000,
          skipped: true
        }
      }
    ]
  } as V2DpsCurveResult;
  const evidence = buildPassiveCooldownEvidenceFromCurveResult(result);
  assert(evidence.count === 2, 'passive cooldown evidence must count all passive_cooldown entries');
  assert(evidence.triggeredCount === 1, 'passive cooldown evidence must count triggered entries');
  assert(evidence.skippedCount === 1, 'passive cooldown evidence must count skipped entries');
  assert(evidence.sources.includes('item_example_proc'), 'passive cooldown evidence must list sources');
  assert(evidence.entries[0]?.triggered === true, 'triggered entry must preserve triggered flag');
  assert(evidence.entries[1]?.skipped === true, 'skipped entry must preserve skipped flag');
}

const CONTRACT_TESTS: Array<{ name: string; run: () => void }> = [
  { name: 'empty refs (STRICT)', run: testEmptyRefsStrict },
  { name: 'missing refs (STRICT)', run: testMissingRefsStrict },
  { name: 'unknown ref', run: testUnknownRef },
  { name: 'ownerType mismatch', run: testOwnerTypeMismatch },
  { name: 'ownerId mismatch', run: testOwnerIdMismatch },
  { name: 'duplicate refs', run: testDuplicateRefs },
  { name: 'attacker correct reference', run: testAttackerCorrectReference },
  { name: 'attacker references target passive', run: testAttackerReferencesTargetPassive },
  { name: 'target correct reference', run: testTargetCorrectReference },
  { name: 'target references attacker/missing ownerRole', run: testTargetReferencesAttackerOrMissingOwnerRole },
  { name: 'legacy fallback warning', run: testLegacyFallbackEmitsWarningWithoutChangingStrictSemantics },
  { name: 'published unknown skill', run: testPublishedUnknownSkillIsError },
  { name: 'published ownerType mismatch', run: testPublishedOwnerTypeMismatchIsError },
  { name: 'published ownerId mismatch', run: testPublishedOwnerIdMismatchIsError },
  { name: 'published duplicate refs', run: testPublishedDuplicateRefsAreWarning },
  { name: 'published valid item-owned skill', run: testPublishedValidItemOwnedSkillHasNoError },
  { name: 'published missing refs warning', run: testPublishedMissingRefsEmitsWarningNotError },
  { name: 'published empty refs info', run: testPublishedEmptyRefsEmitsInfoNotError },
  { name: 'published mixed attacker/target passives', run: testPublishedMixedAttackerAndTargetPassivesDoNotError },
  { name: 'published dpsPassiveEffects not array', run: testPublishedDpsPassiveEffectsNotArrayIsError },
  { name: 'published candidate filtering', run: testPublishedCandidateFilteringSkipsIrrelevantItems },
  { name: 'preserve execute_threshold operation shape', run: testPreserveExecuteThresholdOperationShape },
  { name: 'execute evidence from curve result', run: testExecuteEvidenceFromCurveResult },
  { name: 'preserve internalCooldownMs passive shape', run: testPreserveInternalCooldownMsShape },
  { name: 'passive cooldown evidence from curve result', run: testPassiveCooldownEvidenceFromCurveResult }
];

export function runTinygoV2DpsAdapterContractTests(): { passed: number; failed: Array<{ name: string; error: string }> } {
  const failed: Array<{ name: string; error: string }> = [];
  for (const test of CONTRACT_TESTS) {
    try {
      test.run();
    } catch (error) {
      failed.push({
        name: test.name,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return { passed: CONTRACT_TESTS.length - failed.length, failed };
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('tinygoV2DpsAdapter.test.ts');
if (invokedDirectly) {
  const result = runTinygoV2DpsAdapterContractTests();
  if (result.failed.length > 0) {
    for (const failure of result.failed) {
      console.error(`FAIL ${failure.name}: ${failure.error}`);
    }
    process.exit(1);
  }
  console.log(`tinygoV2DpsAdapter contract tests passed (${result.passed}/${CONTRACT_TESTS.length})`);
}
