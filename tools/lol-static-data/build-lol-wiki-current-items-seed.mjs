/**
 * Build DB/seed candidate bundles from lol-wiki current-items db-candidates.
 * Does not fetch network data and does not import into DB.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const DEFAULT_DATA_ROOT = path.resolve(REPO_ROOT, '数据参考', 'lol-wiki-current-items');

const INPUT_CANDIDATES = 'current-items.db-candidates.json';
const INPUT_SUMMARY = 'current-items.db-candidates.summary.json';
const INPUT_REVIEW_QUEUE = 'current-items.ai-review-queue.jsonl';

const OUTPUT_BASE_SEED = 'current-items.base-items.seed-candidate.json';
const OUTPUT_SKILLS_SEED = 'current-items.high-confidence-skills.seed-candidate.json';
const OUTPUT_REVIEW_OVERRIDES = 'current-items.seed-review-overrides.template.json';
const OUTPUT_SUMMARY = 'current-items.seed-candidates.summary.json';

const SCHEMA_VERSION = 'lol_wiki_current_items_seed_candidates.v1';
const DEFAULT_VERSION_CODE_PREFIX = 'wiki_current_items_';

const RAW_ATTR_KEYS = new Set([
  'mr',
  'lifesteal_pct',
  'omnivamp_pct',
  'armor_pen_pct',
  'magic_pen_pct',
  'movement_speed_flat',
  'health_regen',
  'heal_shield_power_pct',
  'tenacity_pct',
  'crit_damage_pct',
  'lethality',
]);

const ATTR_KEY_CANONICAL_MAP = {
  mr: 'magic_resist',
  lifesteal_pct: 'life_steal',
  omnivamp_pct: 'omnivamp',
  armor_pen_pct: 'armor_pen_percent',
  magic_pen_pct: 'magic_pen_percent',
  movement_speed_flat: 'ms_f',
  health_regen: 'hp_regen',
  heal_shield_power_pct: 'heal_shield_power',
  tenacity_pct: 'tenacity',
  crit_damage_pct: 'crit_damage',
  lethality: 'armor_pen_flat',
};

const ATTR_DEFINITION_CATALOG = {
  ad: { attrName: '攻击力', valueKind: 'scalar' },
  ap: { attrName: '法术强度', valueKind: 'scalar' },
  hp: { attrName: '生命值', valueKind: 'scalar' },
  mana: { attrName: '法力值', valueKind: 'scalar' },
  armor: { attrName: '护甲', valueKind: 'scalar' },
  magic_resist: { attrName: '魔法抗性', valueKind: 'scalar' },
  ability_haste: { attrName: '技能极速', valueKind: 'scalar' },
  attack_speed: { attrName: '攻击速度', valueKind: 'scalar' },
  crit_chance: { attrName: '暴击几率', valueKind: 'scalar' },
  crit_damage: { attrName: '暴击伤害', valueKind: 'scalar' },
  life_steal: { attrName: '生命偷取', valueKind: 'scalar' },
  omnivamp: { attrName: '全能吸血', valueKind: 'scalar' },
  armor_pen_flat: { attrName: '固定护甲穿透', valueKind: 'scalar' },
  magic_pen_flat: { attrName: '固定魔法穿透', valueKind: 'scalar' },
  armor_pen_percent: { attrName: '百分比护甲穿透', valueKind: 'scalar' },
  magic_pen_percent: { attrName: '百分比魔法穿透', valueKind: 'scalar' },
  ms_pct: { attrName: '百分比移动速度', valueKind: 'scalar' },
  ms_f: { attrName: '固定移动速度', valueKind: 'scalar' },
  tenacity: { attrName: '韧性', valueKind: 'scalar' },
  heal_shield_power: { attrName: '治疗与护盾强度', valueKind: 'scalar' },
  hp_regen: { attrName: '生命回复', valueKind: 'rate', rateTargetAttrKey: 'hp' },
  mana_regen: { attrName: '法力回复', valueKind: 'rate', rateTargetAttrKey: 'mana' },
  gold_per_10: { attrName: '每10秒金币', valueKind: 'scalar' },
};

const EMPTY_SEED_ARRAYS = {
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
};

function parseArgs(argv) {
  const args = {
    inputRoot: DEFAULT_DATA_ROOT,
    outputRoot: DEFAULT_DATA_ROOT,
    versionCodePrefix: DEFAULT_VERSION_CODE_PREFIX,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--input-root') {
      args.inputRoot = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--output-root') {
      args.outputRoot = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--version-code-prefix') {
      args.versionCodePrefix = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

function canonicalizeAttrKey(attrKey) {
  return ATTR_KEY_CANONICAL_MAP[attrKey] ?? attrKey;
}

function canonicalizeStatModifiers(statModifiers) {
  const aggregated = new Map();

  for (const modifier of statModifiers ?? []) {
    const canonicalKey = canonicalizeAttrKey(modifier.attrKey);
    const contribution = {
      sourceAttrKey: modifier.attrKey,
      sourceStatKey: modifier.sourceStatKey ?? null,
      sourceValue: modifier.sourceValue ?? modifier.value,
      value: modifier.value,
      mode: modifier.mode ?? null,
    };

    const existing = aggregated.get(canonicalKey);
    if (existing) {
      existing.value += modifier.value;
      existing.contributions.push(contribution);
    } else {
      aggregated.set(canonicalKey, {
        value: modifier.value,
        contributions: [contribution],
      });
    }
  }

  const statModifiersOut = [...aggregated.entries()].map(([attrKey, entry]) => ({
    attrKey,
    value: entry.value,
  }));

  const statModifierSources = [...aggregated.entries()]
    .filter(([, entry]) => entry.contributions.length > 1)
    .map(([canonicalAttrKey, entry]) => ({
      canonicalAttrKey,
      contributions: entry.contributions,
    }));

  const remappedSources = [...aggregated.entries()]
    .filter(([canonicalAttrKey, entry]) => {
      if (entry.contributions.length !== 1) {
        return false;
      }
      return entry.contributions[0].sourceAttrKey !== canonicalAttrKey;
    })
    .map(([canonicalAttrKey, entry]) => ({
      canonicalAttrKey,
      contributions: entry.contributions,
    }));

  return {
    statModifiers: statModifiersOut,
    statModifierSources: [...statModifierSources, ...remappedSources],
  };
}

function buildAttributeDefinitions(usedAttrKeys) {
  return [...usedAttrKeys]
    .sort()
    .map((attrKey) => {
      const catalog = ATTR_DEFINITION_CATALOG[attrKey];
      if (!catalog) {
        throw new Error(`Missing attribute definition catalog entry for attrKey=${attrKey}`);
      }
      const definition = {
        attrKey,
        attrName: catalog.attrName,
        attrType: 'number',
        defaultValue: 0,
        valueKind: catalog.valueKind,
      };
      if (catalog.rateTargetAttrKey) {
        definition.rateTargetAttrKey = catalog.rateTargetAttrKey;
      }
      return definition;
    });
}

function filterRecipeIds(recipeItemIds, itemIdSet) {
  return (recipeItemIds ?? []).filter((recipeId) => itemIdSet.has(String(recipeId)));
}

function buildItemSource(candidate, statModifierSources) {
  const source = {
    dataSource: 'lol-wiki-current-items',
    sourceItemId: candidate.sourceItemId,
    sourceKey: candidate.sourceKey,
    importEligibility: candidate.importEligibility ?? null,
    modes: candidate.modes ?? null,
    tags: candidate.tags ?? [],
  };

  if (candidate.collisionGroup != null) {
    source.collisionGroup = candidate.collisionGroup;
  }

  if (statModifierSources.length > 0) {
    source.statModifierSources = statModifierSources;
  }

  return source;
}

function buildSeedItem(candidate, itemIdSet, skillRefs = []) {
  const { statModifiers, statModifierSources } = canonicalizeStatModifiers(candidate.statModifiers);
  const itemId = String(candidate.dbItemId);

  return {
    itemId,
    name: candidate.name,
    goldCost: candidate.goldCost ?? candidate.buy ?? 0,
    iconUrl: `item_${itemId}`,
    skillRefs: [...skillRefs],
    recipeIds: filterRecipeIds(candidate.recipeItemIds, itemIdSet),
    statModifiers,
    source: buildItemSource(candidate, statModifierSources),
  };
}

function cleanSkillForSeed(skill) {
  const { confidence, reasons, ...seedSkill } = structuredClone(skill);
  return seedSkill;
}

function buildOwnerCategories() {
  return [{ ownerType: 'item', name: '装备' }];
}

function buildSourceMetadata(candidates, candidatesSummary, extra = {}) {
  return {
    candidatesFile: INPUT_CANDIDATES,
    candidatesSummaryFile: INPUT_SUMMARY,
    reviewQueueFile: INPUT_REVIEW_QUEUE,
    manifest: candidates.source?.manifest ?? candidatesSummary.source?.manifest ?? null,
    normalizedMeta: candidates.source?.normalizedMeta ?? candidatesSummary.source?.normalizedMeta ?? null,
    generatedAt: new Date().toISOString(),
    ...extra,
  };
}

function buildReviewOverride(entry) {
  const guess = entry.currentGuess ?? null;
  const recordedNotSimulated = Array.isArray(guess?.recordedNotSimulated)
    ? guess.recordedNotSimulated
    : [];

  return {
    itemName: entry.itemName,
    dbItemId: entry.dbItemId ?? null,
    sourceItemId: entry.sourceItemId ?? null,
    sourceKey: entry.sourceKey ?? null,
    slot: entry.slot ?? null,
    effectName: entry.effectName ?? null,
    confidence: guess?.confidence ?? null,
    triggerKind: guess?.triggerKind ?? null,
    blockedReason: guess?.blockedReason ?? null,
    recordedNotSimulated,
    decision: 'pending',
  };
}

function versionCodeFor(prefix, suffix, revid) {
  const normalizedPrefix = prefix.endsWith('_') ? prefix : `${prefix}_`;
  return `${normalizedPrefix}${suffix}_${revid}`;
}

async function readJson(filePath) {
  const text = await readFile(filePath, 'utf8');
  return JSON.parse(text);
}

async function readJsonl(filePath) {
  const text = await readFile(filePath, 'utf8');
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function collectUsedAttrKeys(items) {
  const used = new Set();
  for (const item of items) {
    for (const modifier of item.statModifiers ?? []) {
      used.add(modifier.attrKey);
    }
  }
  return used;
}

function countCanonicalAttrKeys(items) {
  const counts = {};
  for (const item of items) {
    for (const modifier of item.statModifiers ?? []) {
      counts[modifier.attrKey] = (counts[modifier.attrKey] ?? 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

export function buildSeedCandidates(candidates, candidatesSummary, reviewQueue, options = {}) {
  const versionCodePrefix = options.versionCodePrefix ?? DEFAULT_VERSION_CODE_PREFIX;
  const revid = candidates.source?.manifest?.revid ?? candidatesSummary.source?.manifest?.revid ?? 'unknown';

  const itemIdSet = new Set(candidates.items.map((item) => String(item.dbItemId)));
  const highConfidenceSkills = (candidates.skills ?? []).map(cleanSkillForSeed);
  const highConfidenceSkillIds = new Set(highConfidenceSkills.map((skill) => skill.skillId));
  const highConfidenceOwnerIds = new Set(highConfidenceSkills.map((skill) => String(skill.ownerId)));

  const baseItems = candidates.items.map((candidate) => buildSeedItem(candidate, itemIdSet, []));
  const usedAttrKeys = collectUsedAttrKeys(baseItems);
  const attributeDefinitions = buildAttributeDefinitions(usedAttrKeys);

  const baseSeed = {
    gameId: 'lol',
    versionCode: versionCodeFor(versionCodePrefix, 'base', revid),
    source: buildSourceMetadata(candidates, candidatesSummary, {
      rule: 'All 333 current wiki items as base item seed candidates; skills deferred to review or follow-up skill seed.',
      candidateOnly: true,
      itemCount: baseItems.length,
      skillCount: 0,
    }),
    ownerCategories: buildOwnerCategories(),
    attributeDefinitions,
    ...EMPTY_SEED_ARRAYS,
    skills: [],
    items: baseItems,
  };

  const skillOwnerItems = candidates.items
    .filter((candidate) => highConfidenceOwnerIds.has(String(candidate.dbItemId)))
    .map((candidate) => {
      const skillRefs = (candidate.skillRefCandidates ?? []).filter((skillId) =>
        highConfidenceSkillIds.has(skillId),
      );
      return buildSeedItem(candidate, itemIdSet, skillRefs);
    });

  const skillsSeed = {
    gameId: 'lol',
    versionCode: versionCodeFor(versionCodePrefix, 'skills', revid),
    source: buildSourceMetadata(candidates, candidatesSummary, {
      rule: 'Follow-up high-confidence wiki item passive seed; requires base item seed import first.',
      candidateOnly: true,
      dependsOn: OUTPUT_BASE_SEED,
      dependsOnVersionCode: baseSeed.versionCode,
      skillCount: highConfidenceSkills.length,
      skillOwnerItemCount: skillOwnerItems.length,
    }),
    ownerCategories: buildOwnerCategories(),
    attributeDefinitions: [],
    ...EMPTY_SEED_ARRAYS,
    skills: highConfidenceSkills,
    items: skillOwnerItems,
  };

  const reviewOverrides = reviewQueue.map(buildReviewOverride);

  const reviewTemplate = {
    schemaVersion: `${SCHEMA_VERSION}.review_overrides`,
    generatedAt: new Date().toISOString(),
    source: buildSourceMetadata(candidates, candidatesSummary, {
      rule: 'Pending human/AI review overrides for wiki item passives and actives; do not auto-promote into skill seed.',
    }),
    overrides: reviewOverrides,
  };

  const summary = {
    schemaVersion: `${SCHEMA_VERSION}.summary`,
    generatedAt: new Date().toISOString(),
    source: {
      candidatesFile: INPUT_CANDIDATES,
      candidatesSummaryFile: INPUT_SUMMARY,
      reviewQueueFile: INPUT_REVIEW_QUEUE,
      manifest: candidates.source?.manifest ?? candidatesSummary.source?.manifest ?? null,
      normalizedMeta: candidates.source?.normalizedMeta ?? candidatesSummary.source?.normalizedMeta ?? null,
    },
    counts: {
      baseItemCount: baseItems.length,
      baseAttributeDefinitionCount: attributeDefinitions.length,
      skillSeedCount: highConfidenceSkills.length,
      skillOwnerItemCount: skillOwnerItems.length,
      reviewOverridePendingCount: reviewOverrides.length,
      rejectedOrSkippedCount: 0,
    },
    highConfidenceSkillIds: highConfidenceSkills.map((skill) => skill.skillId).sort(),
    highConfidenceOwnerItemIds: [...highConfidenceOwnerIds].sort(),
    canonicalAttrKeyCounts: countCanonicalAttrKeys(baseItems),
    versionCodes: {
      baseItems: baseSeed.versionCode,
      highConfidenceSkills: skillsSeed.versionCode,
    },
    outputFiles: [
      OUTPUT_BASE_SEED,
      OUTPUT_SKILLS_SEED,
      OUTPUT_REVIEW_OVERRIDES,
      OUTPUT_SUMMARY,
    ],
  };

  return {
    baseSeed,
    skillsSeed,
    reviewTemplate,
    summary,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const candidatesPath = path.join(args.inputRoot, INPUT_CANDIDATES);
  const candidatesSummaryPath = path.join(args.inputRoot, INPUT_SUMMARY);
  const reviewQueuePath = path.join(args.inputRoot, INPUT_REVIEW_QUEUE);

  const candidates = await readJson(candidatesPath);
  const candidatesSummary = await readJson(candidatesSummaryPath);
  const reviewQueue = await readJsonl(reviewQueuePath);

  if (!Array.isArray(candidates.items)) {
    throw new Error(`Missing items in candidates file: ${candidatesPath}`);
  }

  const result = buildSeedCandidates(candidates, candidatesSummary, reviewQueue, {
    versionCodePrefix: args.versionCodePrefix,
  });

  await writeJson(path.join(args.outputRoot, OUTPUT_BASE_SEED), result.baseSeed);
  await writeJson(path.join(args.outputRoot, OUTPUT_SKILLS_SEED), result.skillsSeed);
  await writeJson(path.join(args.outputRoot, OUTPUT_REVIEW_OVERRIDES), result.reviewTemplate);
  await writeJson(path.join(args.outputRoot, OUTPUT_SUMMARY), result.summary);

  console.log(
    JSON.stringify(
      {
        outputRoot: args.outputRoot,
        baseItemCount: result.summary.counts.baseItemCount,
        skillSeedCount: result.summary.counts.skillSeedCount,
        reviewOverridePendingCount: result.summary.counts.reviewOverridePendingCount,
        outputFiles: result.summary.outputFiles,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
