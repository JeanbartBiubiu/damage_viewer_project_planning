/**
 * Classify AI review queue entries from the wiki item pipeline into
 * actionable buckets and extract additional skill candidates.
 *
 * Buckets:
 *   ready_to_encode              – DPS-relevant, extractable with existing operations
 *   needs_runtime_extension      – DPS-relevant but requires new runtime operations
 *   out_of_scope_for_single_target_dps – non-DPS (healing, shielding, CC, gold, etc.)
 *   needs_manual_baseline        – damage values not reliably extractable from text
 *
 * Output:
 *   current-items.classified-summary.json
 *   current-items.classified.seed-candidate.json
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_DATA_ROOT = path.resolve(REPO_ROOT, '数据参考', 'lol-wiki-current-items');

const INPUT_REVIEW_QUEUE = 'current-items.ai-review-queue.jsonl';
const INPUT_CANDIDATES_SUMMARY = 'current-items.db-candidates.summary.json';
const OUTPUT_SUMMARY = 'current-items.classified-summary.json';
const OUTPUT_SEED = 'current-items.classified.seed-candidate.json';

const SCHEMA_VERSION = 'lol_wiki_review_queue_classified.v1';
const VERSION_CODE_PREFIX = 'wiki_review_queue_classified';

// ── Extended DPS pattern matchers ──────────────────────────────────────────

const DAMAGE_TYPE_KEYWORDS = {
  physical: /physical damage/i,
  magic: /magic damage/i,
  true: /true damage/i,
};

function extractDamageType(text) {
  for (const [type, re] of Object.entries(DAMAGE_TYPE_KEYWORDS)) {
    if (re.test(text)) return type;
  }
  return null;
}

function extractNumbers(text) {
  return [...text.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
}

/**
 * DoT / aura damage – "Deal X magic damage every second" or "nearby enemies
 * take X magic damage per second"
 */
function guessDotDamage(plainText) {
  const lower = plainText.toLowerCase();
  if (!/every second|per second|each second|\/s\b|over 3 seconds|burn/i.test(lower)) {
    return null;
  }
  const dmgMatch = plainText.match(
    /(\d+(?:\.\d+)?)\s*(?:bonus\s+)?(magic|physical|true)\s+damage/i,
  );
  if (!dmgMatch) return null;
  return {
    confidence: 'medium',
    triggerKind: 'periodic_dot',
    reasons: ['dot_aura_pattern'],
    operations: [
      {
        kind: 'damage',
        damageType: dmgMatch[2].toLowerCase(),
        amount: Number(dmgMatch[1]),
      },
    ],
    recordedNotSimulated: ['dot_interval_and_duration_not_modeled'],
  };
}

/**
 * Percent HP damage – "deals X% of target's current/maximum/missing health"
 * Must be in a damage-dealing context, not shield/heal scaling.
 */
function guessPercentHpDamage(plainText) {
  const lower = plainText.toLowerCase();
  if (!/current health|maximum health|max health|missing health/i.test(lower)) {
    return null;
  }
  // Exclude shield/heal/absorb contexts – "bonus health" usually scales shields, not damage
  if (/shield|heal|absorb|grant|restore/i.test(lower)) {
    return null;
  }
  // Require a damage-dealing verb context
  if (!/deal|deals|dealing|inflict|cause.*damage|damage to/i.test(lower)) {
    return null;
  }
  const pctMatch = plainText.match(
    /(\d+(?:\.\d+)?)%\s*(?:of\s+)?(?:target's\s+)?(?:current|maximum|max|missing)\s+(?:health|hp)/i,
  );
  if (!pctMatch) return null;
  const hpKind = lower.match(/(current|maximum|max|missing)\s+health/)?.[1] ?? 'current';
  return {
    confidence: 'medium',
    triggerKind: 'on_basic_attack_hit',
    reasons: ['percent_hp_damage_pattern'],
    operations: [
      {
        kind: 'damage',
        damageType: extractDamageType(plainText) ?? 'physical',
        targetAttr: hpKind === 'maximum' ? 'max_hp' : hpKind === 'missing' ? 'missing_hp' : 'current_hp',
        targetAttrRatio: Number(pctMatch[1]) / 100,
      },
    ],
    recordedNotSimulated: [],
  };
}

/**
 * Execute threshold – "if the target is below X% health, execute them"
 */
function guessExecuteThreshold(plainText) {
  const lower = plainText.toLowerCase();
  if (!/execute|kill|slay|put down/i.test(lower)) return null;
  const thresholdMatch = plainText.match(
    /below\s+(\d+(?:\.\d+)?)%\s*(?:health|hp)/i,
  );
  if (!thresholdMatch) return null;
  return {
    confidence: 'medium',
    triggerKind: 'on_basic_attack_hit',
    reasons: ['execute_threshold_pattern'],
    operations: [
      {
        kind: 'execute_threshold',
        thresholdType: 'target_hp_pct',
        thresholdValue: Number(thresholdMatch[1]),
        checkTiming: 'before_damage',
      },
    ],
    recordedNotSimulated: ['execute_damage_amount_not_specified'],
  };
}

/**
 * Armor shred – "applies a stack of Carve, reducing armor by X%"
 */
function guessArmorShred(plainText) {
  const lower = plainText.toLowerCase();
  if (!/armor (?:reduc|shred|pen)|reduce.*armor|carve|shred/i.test(lower)) {
    return null;
  }
  const stackMatch = plainText.match(
    /(\d+(?:\.\d+)?)%\s*(?:bonus\s+)?armor(?:\s+reduction)?/i,
  );
  const flatMatch = plainText.match(
    /(\d+)\s*(?:bonus\s+)?armor(?:\s+reduction)?/i,
  );
  const maxStacksMatch = plainText.match(/stacking up to\s+(\d+)/i);
  if (!stackMatch && !flatMatch) return null;
  return {
    confidence: 'low',
    triggerKind: 'on_basic_attack_hit',
    reasons: ['armor_shred_pattern'],
    operations: [
      {
        kind: 'damage_modifier',
        targetAttr: 'armor',
        mode: stackMatch ? 'percent' : 'flat',
        value: stackMatch ? -Number(stackMatch[1]) / 100 : -Number(flatMatch[1]),
        ...(maxStacksMatch ? { maxStacks: Number(maxStacksMatch[1]) } : {}),
      },
    ],
    recordedNotSimulated: ['stack_accumulation_timing_not_modeled'],
  };
}

/**
 * Damage reduction – "Reduces all incoming damage by X%"
 */
function guessDamageReduction(plainText) {
  const lower = plainText.toLowerCase();
  if (!/reduce.*incoming|incoming.*damage.*reduc|damage taken.*reduc/i.test(lower)) {
    return null;
  }
  const pctMatch = plainText.match(/(\d+(?:\.\d+)?)%/);
  if (!pctMatch) return null;
  return {
    confidence: 'medium',
    triggerKind: 'incoming_damage_modifier',
    reasons: ['damage_reduction_pattern'],
    operations: [
      {
        kind: 'damage_modifier',
        targetAttr: 'incoming_damage',
        mode: 'percent',
        value: -Number(pctMatch[1]) / 100,
      },
    ],
    recordedNotSimulated: ['target_side_passive_not_attacker_side'],
  };
}

/**
 * Aura damage amplification – "enemies receive X% increased magic damage"
 */
function guessDamageAmplification(plainText) {
  const lower = plainText.toLowerCase();
  if (!/increased.*damage|damage.*increased|amplif/i.test(lower)) {
    return null;
  }
  const pctMatch = plainText.match(
    /(\d+(?:\.\d+)?)%\s*increased\s+(magic|physical|true)?\s*damage/i,
  );
  if (!pctMatch) return null;
  return {
    confidence: 'low',
    triggerKind: 'aura_damage_amp',
    reasons: ['damage_amplification_pattern'],
    operations: [
      {
        kind: 'damage_modifier',
        targetAttr: pctMatch[2] ? `${pctMatch[2].toLowerCase()}_damage_taken` : 'damage_taken',
        mode: 'percent',
        value: Number(pctMatch[1]) / 100,
      },
    ],
    recordedNotSimulated: ['aura_range_and_targeting_not_modeled'],
  };
}

/**
 * On-attack damage (not on-hit, but triggers on attack action)
 */
function guessOnAttackDamage(plainText) {
  const lower = plainText.toLowerCase();
  if (!/on attack|attacking|basic attack/i.test(lower)) return null;
  if (/on-hit|on hit/.test(lower)) return null; // already handled by existing heuristic
  // Exclude non-damage contexts
  if (/shield|heal|absorb|grant.*health|restore/i.test(lower)) return null;
  const dmgMatch = plainText.match(
    /(\d+(?:\.\d+)?)\s*(?:bonus\s+)?(magic|physical|true)\s+damage/i,
  );
  if (!dmgMatch) return null;
  return {
    confidence: 'low',
    triggerKind: 'on_basic_attack_hit',
    reasons: ['on_attack_damage_pattern'],
    operations: [
      {
        kind: 'damage',
        damageType: dmgMatch[2].toLowerCase(),
        amount: Number(dmgMatch[1]),
      },
    ],
    recordedNotSimulated: ['trigger_timing_approximated_as_on_hit'],
  };
}

/**
 * Life steal / omnivamp from passive text
 */
function guessLifeSteal(plainText) {
  const lower = plainText.toLowerCase();
  if (!/life ?steal|omnivamp|vampir/i.test(lower)) return null;
  // Exclude if the text is about shielding or healing others
  if (/shield|heal.*all|heal.*ally/i.test(lower)) return null;
  const pctMatch = plainText.match(/(\d+(?:\.\d+)?)%/);
  if (!pctMatch) return null;
  return {
    confidence: 'low',
    triggerKind: 'on_basic_attack_hit',
    reasons: ['lifesteal_pattern'],
    operations: [
      {
        kind: 'damage_modifier',
        source: 'lifesteal_heal',
        targetAttr: 'heal_on_hit',
        mode: 'percent_of_damage_dealt',
        value: Number(pctMatch[1]) / 100,
      },
    ],
    recordedNotSimulated: ['heal_not_directly_part_of_dps_curve'],
  };
}

const EXTENDED_GUESSERS = [
  guessDotDamage,
  guessPercentHpDamage,
  guessExecuteThreshold,
  guessArmorShred,
  guessDamageReduction,
  guessDamageAmplification,
  guessOnAttackDamage,
  guessLifeSteal,
];

// ── Out-of-scope classifiers ───────────────────────────────────────────────

const OUT_OF_SCOPE_PATTERNS = [
  { pattern: /\bheal|healing|heals?\b/i, reason: 'heal_effect' },
  { pattern: /\bshield|shielding\b/i, reason: 'shield_effect' },
  { pattern: /\bstun|root|slow|knockup|knockback|charm|fear|taunt|sleep|suppression\b/i, reason: 'cc_effect' },
  { pattern: /\bgold\b/i, reason: 'gold_effect' },
  { pattern: /\bvision|reveal|stealth|invisible\b/i, reason: 'vision_effect' },
  { pattern: /\bmove ?speed|movement speed\b/i, reason: 'movement_effect' },
  { pattern: /\bcooldown\b/i, reason: 'cooldown_effect' },
  { pattern: /\bmana\b/i, reason: 'mana_effect' },
  { pattern: /\bminion|monster|jungle\b/i, reason: 'pve_only' },
  { pattern: /\bturret|tower\b/i, reason: 'turret_effect' },
  { pattern: /\bshop|voucher|reroll\b/i, reason: 'arena_meta' },
  { pattern: /\bally|allied|teammate\b/i, reason: 'ally_targeting' },
  { pattern: /\bward\b/i, reason: 'ward_effect' },
];

function classifyOutOfScope(plainText) {
  const lower = plainText.toLowerCase();
  for (const { pattern, reason } of OUT_OF_SCOPE_PATTERNS) {
    if (pattern.test(lower)) {
      // Check if there's also a damage component
      if (/damage|on-hit|attack/i.test(lower)) {
        return null; // Mixed – might be DPS-relevant
      }
      return reason;
    }
  }
  return null;
}

// ── Classification logic ───────────────────────────────────────────────────

function classifyEntry(entry) {
  const isDps = entry.importEligibility?.isDpsCandidate ?? false;
  const plainText = entry.plainText ?? '';

  if (!isDps) {
    return {
      bucket: 'out_of_scope_for_single_target_dps',
      reason: entry.importEligibility?.excludedReasons?.[0] ?? 'not_dps_candidate',
      extendedGuess: null,
    };
  }

  // Check existing guess first
  if (entry.currentGuess && entry.currentGuess.confidence === 'high') {
    return {
      bucket: 'ready_to_encode',
      reason: 'existing_high_confidence_guess',
      extendedGuess: entry.currentGuess,
    };
  }

  // Apply extended guessers
  for (const guesser of EXTENDED_GUESSERS) {
    const guess = guesser(plainText);
    if (guess) {
      // Determine bucket based on guess quality
      if (guess.confidence === 'medium' && guess.operations.length > 0) {
        const hasUnsupportedOp = guess.operations.some(
          (op) =>
            op.kind === 'damage_modifier' &&
            (op.targetAttr === 'incoming_damage' || op.targetAttr?.includes('damage_taken')),
        );
        if (hasUnsupportedOp) {
          return {
            bucket: 'needs_runtime_extension',
            reason: 'target_side_modifier_not_in_single_attacker_dps',
            extendedGuess: guess,
          };
        }
        return {
          bucket: 'ready_to_encode',
          reason: guess.reasons[0],
          extendedGuess: guess,
        };
      }
      if (guess.confidence === 'low') {
        return {
          bucket: 'needs_manual_baseline',
          reason: guess.reasons[0],
          extendedGuess: guess,
        };
      }
    }
  }

  // Check if out of scope
  const oosReason = classifyOutOfScope(plainText);
  if (oosReason) {
    return {
      bucket: 'out_of_scope_for_single_target_dps',
      reason: oosReason,
      extendedGuess: null,
    };
  }

  // DPS candidate but no pattern matched
  return {
    bucket: 'needs_manual_baseline',
    reason: 'no_pattern_matched',
    extendedGuess: null,
  };
}

// ── Skill candidate builder ────────────────────────────────────────────────

function slugify(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

function buildSkillCandidate(entry, guess) {
  const itemSlug = entry.sourceKey ?? slugify(entry.itemName);
  const effectSlug = slugify(entry.effectName ?? guess.triggerKind);
  const skillId = `item_${entry.dbItemId}_${effectSlug}_review_queue`;

  const operations = (guess.operations ?? []).map((op, i) => ({
    ...op,
    source: `${itemSlug}_${effectSlug}_${op.kind}_${i}`,
    evidenceKey: `item_${entry.dbItemId}_${effectSlug}_${op.kind}_${i}`,
  }));

  return {
    skillId,
    ownerType: 'item',
    ownerId: String(entry.dbItemId),
    skillKey: `${entry.slot}_${effectSlug}`,
    name: `${entry.itemName} ${entry.effectName ?? guess.triggerKind} review queue candidate`,
    description: `Review queue classified candidate. Bucket: ready_to_encode. Source: ${plainTextSnippet(entry.plainText)}`,
    params: {
      triggerKind: guess.triggerKind,
      sourceItemName: entry.itemName,
      reviewKey: `${entry.dbItemId}|${entry.sourceItemId}|${entry.sourceKey}|${entry.slot}|${entry.effectName ?? ''}`,
      recordedNotSimulated: guess.recordedNotSimulated ?? [],
      assumptions: guess.assumptions ?? [],
      candidateOnly: true,
      conversionRule: SCHEMA_VERSION,
    },
    mechanicsConfig: {
      version: 1,
      triggers: [{ triggerId: `${itemSlug}_${guess.triggerKind}`, triggerKind: guess.triggerKind }],
      dpsPassiveEffects: [
        {
          passiveId: skillId,
          effectId: `${skillId}_effect`,
          sourceCategory: 'item_passive',
          sourceType: 'item',
          sourceId: skillId,
          triggerId: `${itemSlug}_${guess.triggerKind}`,
          ownerRole: 'attacker',
          operations,
          triggerKind: guess.triggerKind,
          procScope: 'real_basic_attack_only',
        },
      ],
    },
  };
}

function plainTextSnippet(text) {
  return String(text ?? '').slice(0, 200);
}

// ── Main ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    inputRoot: DEFAULT_DATA_ROOT,
    outputRoot: DEFAULT_DATA_ROOT,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--input-root') {
      args.inputRoot = path.resolve(argv[i + 1]);
      i += 1;
    } else if (argv[i] === '--output-root') {
      args.outputRoot = path.resolve(argv[i + 1]);
      i += 1;
    }
  }
  return args;
}

async function readJsonl(filePath) {
  const text = await readFile(filePath, 'utf8');
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const reviewQueuePath = path.join(args.inputRoot, INPUT_REVIEW_QUEUE);
  const candidatesSummaryPath = path.join(args.inputRoot, INPUT_CANDIDATES_SUMMARY);

  const reviewQueue = await readJsonl(reviewQueuePath);
  const candidatesSummary = await readJson(candidatesSummaryPath);
  const revid = candidatesSummary.source?.manifest?.revid ?? 'unknown';
  const versionCode = `${VERSION_CODE_PREFIX}_${revid}`;

  const classified = reviewQueue.map((entry) => ({
    ...entry,
    classification: classifyEntry(entry),
  }));

  const bucketCounts = {};
  const reasonCounts = {};
  const readyToEncode = [];
  const needsRuntimeExtension = [];
  const needsManualBaseline = [];
  const outOfScope = [];

  for (const entry of classified) {
    const { bucket, reason } = entry.classification;
    bucketCounts[bucket] = (bucketCounts[bucket] ?? 0) + 1;
    reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;

    switch (bucket) {
      case 'ready_to_encode':
        readyToEncode.push(entry);
        break;
      case 'needs_runtime_extension':
        needsRuntimeExtension.push(entry);
        break;
      case 'needs_manual_baseline':
        needsManualBaseline.push(entry);
        break;
      case 'out_of_scope_for_single_target_dps':
        outOfScope.push(entry);
        break;
    }
  }

  // Build skill candidates from ready_to_encode
  const skills = [];
  const skillOwnerItemIds = new Set();
  for (const entry of readyToEncode) {
    const guess = entry.classification.extendedGuess;
    if (!guess || !guess.operations?.length) continue;
    // Skip if it's just a damage modifier without damage operations
    const hasDamageOp = guess.operations.some((op) => op.kind === 'damage' || op.kind === 'execute_threshold');
    if (!hasDamageOp) continue;
    const skill = buildSkillCandidate(entry, guess);
    skills.push(skill);
    skillOwnerItemIds.add(String(entry.dbItemId));
  }

  // Build items with skill_refs for the seed
  const items = [...skillOwnerItemIds].map((itemId) => {
    const entry = readyToEncode.find((e) => String(e.dbItemId) === itemId);
    const itemSkills = skills.filter((s) => s.ownerId === itemId);
    return {
      itemId,
      name: entry?.itemName ?? itemId,
      iconUrl: `item_${itemId}`,
      skillRefs: itemSkills.map((s) => s.skillId),
      source: {
        dataSource: 'lol-wiki-current-items-review-queue',
        sourceItemId: entry?.sourceItemId ?? itemId,
        sourceKey: entry?.sourceKey ?? '',
        importEligibility: entry?.importEligibility ?? null,
        classifiedBucket: 'ready_to_encode',
        conversionRule: SCHEMA_VERSION,
      },
    };
  });

  const seed = {
    gameId: 'lol',
    versionCode,
    source: {
      reviewQueueFile: INPUT_REVIEW_QUEUE,
      candidatesSummaryFile: INPUT_CANDIDATES_SUMMARY,
      manifest: candidatesSummary.source?.manifest ?? null,
      generatedAt: new Date().toISOString(),
    },
    ownerCategories: [
      { ownerType: 'item', name: '装备' },
    ],
    attributeDefinitions: [],
    types: [],
    formulaProfiles: [],
    formulaBindings: [],
    controlStateProfiles: [],
    statusDefinitions: [],
    statusModifierGroups: [],
    statusAttributeModifiers: [],
    statusPeriodicHpEffects: [],
    heroes: [],
    typeRelations: [],
    scenarios: [],
    skills,
    items,
  };

  const summary = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: {
      reviewQueueFile: INPUT_REVIEW_QUEUE,
      revid,
      totalEntries: reviewQueue.length,
    },
    bucketCounts,
    reasonCounts,
    skillCandidateCount: skills.length,
    itemWithSkillCount: items.length,
    needsRuntimeExtensionCount: needsRuntimeExtension.length,
    needsManualBaselineCount: needsManualBaseline.length,
    outOfScopeCount: outOfScope.length,
    readyToEncodeItems: [...skillOwnerItemIds].sort(),
    outputFiles: [OUTPUT_SUMMARY, OUTPUT_SEED],
  };

  await writeJson(path.join(args.outputRoot, OUTPUT_SUMMARY), summary);
  await writeJson(path.join(args.outputRoot, OUTPUT_SEED), seed);

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
