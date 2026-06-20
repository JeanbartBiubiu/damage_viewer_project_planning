/**
 * Convert League Wiki current-only item snapshot into reviewable DB/seed candidates.
 * Does not import into DB and does not claim every passive is runtime-ready.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const DEFAULT_DATA_ROOT = path.resolve(REPO_ROOT, '数据参考', 'lol-wiki-current-items');

const INPUT_FILE = 'current-items.normalized.json';
const MANIFEST_FILE = 'manifest.json';
const OUTPUT_CANDIDATES = 'current-items.db-candidates.json';
const OUTPUT_SUMMARY = 'current-items.db-candidates.summary.json';
const OUTPUT_REVIEW_QUEUE = 'current-items.ai-review-queue.jsonl';

const SCHEMA_VERSION = 'lol_wiki_current_items_db_candidates.v1';
const INHERITED_PREFIX = '=>';
const EFFECT_SLOTS = ['pass', 'pass2', 'pass3', 'pass4', 'act', 'consume'];

const OFFENSIVE_TRIGGER_KINDS = new Set([
  'on_basic_attack_hit',
  'next_basic_attack_after_state',
  'energized_charge_and_consume',
  'every_n_basic_attack_hit',
]);

const CONSERVATIVE_HIGH_CONFIDENCE_BLOCKERS = [
  { pattern: /\ball(?:y|ied)\b/i, reason: 'ally_or_allied_targeting_clause' },
  { pattern: /\bteammate/i, reason: 'teammate_targeting_clause' },
  {
    pattern: /\bheals?\b|\bhealed\b|\bhealing\b|\bregenerat(?:e|es|ed|ing)\b/i,
    reason: 'heal_clause',
  },
  { pattern: /\bshield(?:ing)?\b/i, reason: 'shield_clause' },
  { pattern: /\banother champion\b/i, reason: 'another_champion_clause' },
  { pattern: /\bsupport quest\b/i, reason: 'support_quest_clause' },
  { pattern: /\bwhen struck\b/i, reason: 'when_struck_incoming_clause' },
  { pattern: /\bwhen hit\b/i, reason: 'when_hit_incoming_clause' },
  { pattern: /\btaking damage\b/i, reason: 'taking_damage_clause' },
  { pattern: /\bdamage taken\b/i, reason: 'damage_taken_clause' },
  { pattern: /\bto the attacker\b/i, reason: 'retaliation_to_attacker_clause' },
  { pattern: /\bagainst\s+(?:\[\[)?minions?\b/i, reason: 'minion_only_clause' },
  { pattern: /\bminion-?only\b/i, reason: 'minion_only_clause' },
  { pattern: /\bmonsters?-?only\b/i, reason: 'monster_only_clause' },
  { pattern: /\bshop phase\b/i, reason: 'shop_phase_clause' },
  { pattern: /\bfree voucher\b/i, reason: 'free_voucher_clause' },
  { pattern: /\bturret\b/i, reason: 'turret_clause' },
  { pattern: /\btower\b/i, reason: 'tower_clause' },
  { pattern: /\bexcluding yourself\b/i, reason: 'ally_buff_excluding_self_clause' },
];

const STAT_MAPPINGS = {
  ad: { attrKey: 'ad', mode: 'flat' },
  ap: { attrKey: 'ap', mode: 'flat' },
  hp: { attrKey: 'hp', mode: 'flat' },
  mana: { attrKey: 'mana', mode: 'flat' },
  armor: { attrKey: 'armor', mode: 'flat' },
  mr: { attrKey: 'mr', mode: 'flat' },
  ah: { attrKey: 'ability_haste', mode: 'flat' },
  as: { attrKey: 'attack_speed', mode: 'percent', divisor: 100 },
  crit: { attrKey: 'crit_chance', mode: 'percent', divisor: 100 },
  ms: { attrKey: 'ms_pct', mode: 'percent', divisor: 100 },
  msflat: { attrKey: 'movement_speed_flat', mode: 'flat' },
  lifesteal: { attrKey: 'lifesteal_pct', mode: 'percent', divisor: 100 },
  omnivamp: { attrKey: 'omnivamp_pct', mode: 'percent', divisor: 100 },
  lethality: { attrKey: 'lethality', mode: 'flat' },
  mpenflat: { attrKey: 'magic_pen_flat', mode: 'flat' },
  armpen: { attrKey: 'armor_pen_pct', mode: 'percent', divisor: 100 },
  mpen: { attrKey: 'magic_pen_pct', mode: 'percent', divisor: 100 },
  hp5: { attrKey: 'health_regen', mode: 'flat' },
  hp5flat: { attrKey: 'health_regen', mode: 'flat' },
  mp5: { attrKey: 'mana_regen', mode: 'flat' },
  gp10: { attrKey: 'gold_per_10', mode: 'flat' },
  hsp: { attrKey: 'heal_shield_power_pct', mode: 'percent', divisor: 100 },
  tenacity: { attrKey: 'tenacity_pct', mode: 'percent', divisor: 100 },
  critdamage: { attrKey: 'crit_damage_pct', mode: 'percent', divisor: 100 },
};

function parseArgs(argv) {
  const args = {
    inputRoot: DEFAULT_DATA_ROOT,
    outputRoot: DEFAULT_DATA_ROOT,
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
    }
  }

  return args;
}

function slugify(name) {
  return String(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'item';
}

function isInheritedString(value) {
  return typeof value === 'string' && value.startsWith(INHERITED_PREFIX);
}

function inheritedTarget(value) {
  return value.slice(INHERITED_PREFIX.length).trim();
}

function getAtPath(value, pathParts) {
  let current = value;
  for (const part of pathParts) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function setAtPath(target, pathParts, nextValue) {
  if (pathParts.length === 0) {
    return nextValue;
  }
  const [head, ...rest] = pathParts;
  const clone = Array.isArray(target) ? [...target] : { ...(target ?? {}) };
  clone[head] = rest.length === 0 ? nextValue : setAtPath(clone[head], rest, nextValue);
  return clone;
}

function collectInheritedPaths(value, prefix, paths) {
  if (isInheritedString(value)) {
    paths.push(prefix);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectInheritedPaths(entry, `${prefix}[${index}]`, paths);
    });
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      const next = prefix ? `${prefix}.${key}` : key;
      collectInheritedPaths(nested, next, paths);
    }
  }
}

function pathPartsFromString(pathString) {
  return pathString.split('.').filter(Boolean);
}

function buildNameMap(items) {
  const map = new Map();
  for (const item of items) {
    map.set(item.name, item);
  }
  return map;
}

function buildIdGroups(items) {
  const groups = new Map();
  for (const item of items) {
    const sourceItemId = item.id == null ? null : String(item.id);
    const key = sourceItemId ?? '__missing_id__';
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(item);
  }
  return groups;
}

function resolveFieldValue(item, pathParts, nameMap, context) {
  const rawValue = getAtPath(item, pathParts);
  if (!isInheritedString(rawValue)) {
    return { value: rawValue, inheritedRefs: [], errors: [] };
  }

  const inheritedRefs = [];
  const errors = [];
  const visited = new Set();
  const value = resolveInheritedChain(
    item.name,
    pathParts,
    rawValue,
    nameMap,
    visited,
    inheritedRefs,
    errors,
  );
  return { value, inheritedRefs, errors };
}

function resolveInheritedChain(
  startItemName,
  pathParts,
  currentRef,
  nameMap,
  visited,
  inheritedRefs,
  errors,
) {
  if (!isInheritedString(currentRef)) {
    return currentRef;
  }

  const targetName = inheritedTarget(currentRef);
  const visitKey = `${startItemName}:${pathParts.join('.')}:${targetName}`;
  if (visited.has(visitKey)) {
    errors.push({
      kind: 'inheritance_cycle',
      itemName: startItemName,
      fieldPath: pathParts.join('.'),
      inheritedRef: currentRef,
      targetName,
    });
    return currentRef;
  }
  visited.add(visitKey);

  const targetItem = nameMap.get(targetName);
  if (!targetItem) {
    errors.push({
      kind: 'unresolved_inheritance',
      itemName: startItemName,
      fieldPath: pathParts.join('.'),
      inheritedRef: currentRef,
      targetName,
    });
    visited.delete(visitKey);
    return currentRef;
  }

  inheritedRefs.push({
    itemName: startItemName,
    fieldPath: pathParts.join('.'),
    inheritedRef: currentRef,
    resolvedFrom: targetName,
  });

  const nextRaw = getAtPath(targetItem, pathParts);
  const resolved = resolveInheritedChain(
    startItemName,
    pathParts,
    nextRaw,
    nameMap,
    visited,
    inheritedRefs,
    errors,
  );
  visited.delete(visitKey);
  return resolved;
}

function buildEffectiveItem(item, nameMap) {
  const inheritedPaths = [];
  collectInheritedPaths(item, 'item', inheritedPaths);
  const normalizedPaths = inheritedPaths
    .map((entry) => entry.replace(/^item\./, ''))
    .filter((entry) => entry && entry !== 'item');

  const inheritedRefs = [];
  const errors = [];
  let effective = { ...item };

  for (const fieldPath of normalizedPaths) {
    const parts = pathPartsFromString(fieldPath);
    const { value, inheritedRefs: refs, errors: fieldErrors } = resolveFieldValue(
      item,
      parts,
      nameMap,
      {},
    );
    effective = setAtPath(effective, parts, value);
    inheritedRefs.push(...refs);
    errors.push(...fieldErrors);
  }

  return { effective, inheritedRefs: canonicalizeInheritedRefs(inheritedRefs), errors };
}

function canonicalizeInheritedFieldPath(fieldPath) {
  return String(fieldPath).replace(/^raw\./, '');
}

function canonicalizeInheritedRefs(refs) {
  const seen = new Set();
  const result = [];
  for (const ref of refs) {
    const fieldPath = canonicalizeInheritedFieldPath(ref.fieldPath);
    const key = `${ref.itemName}|${fieldPath}|${ref.inheritedRef}|${ref.resolvedFrom}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ ...ref, fieldPath });
  }
  return result;
}

function getGuessSourceEffects(guess, effectCandidates) {
  const slots = new Set();
  if (guess.sourceSlot) {
    slots.add(guess.sourceSlot);
  }
  if (guess.relatedEffectSlots) {
    for (const slot of guess.relatedEffectSlots) {
      slots.add(slot);
    }
  }
  if (slots.size === 0) {
    return effectCandidates;
  }
  return effectCandidates.filter((effect) => slots.has(effect.slot));
}

function downgradeOffensiveGuess(guess, reason) {
  const recordedNotSimulated = [...(guess.recordedNotSimulated ?? [])];
  if (!recordedNotSimulated.includes(reason)) {
    recordedNotSimulated.push(reason);
  }
  return {
    ...guess,
    confidence: 'medium',
    blockedReason:
      `downgraded_from_high: ${reason}; not modeled as ownerRole=attacker single_attacker_dps`,
    recordedNotSimulated,
  };
}

function applyConservativeHighConfidenceGuard(guess, effectCandidates) {
  if (!OFFENSIVE_TRIGGER_KINDS.has(guess.triggerKind) || guess.confidence !== 'high') {
    return guess;
  }

  const sourceEffects = getGuessSourceEffects(guess, effectCandidates);
  const combinedText = sourceEffects
    .map((effect) => `${effect.name ?? ''} ${effect.plainText ?? ''} ${effect.rawMarkup ?? ''}`)
    .join(' ');

  if (sourceEffects.some((effect) => effect.slot === 'consume')) {
    return downgradeOffensiveGuess(guess, 'consume_slot_not_single_attacker_dps');
  }

  if (guess.triggerKind === 'energized_charge_and_consume') {
    if (!guess.chargeGainPerBasicAttack || guess.chargeGainPerBasicAttack <= 0) {
      return downgradeOffensiveGuess(guess, 'charge_gain_per_basic_attack_not_extracted');
    }
  }

  for (const blocker of CONSERVATIVE_HIGH_CONFIDENCE_BLOCKERS) {
    if (blocker.pattern.test(combinedText)) {
      return downgradeOffensiveGuess(guess, blocker.reason);
    }
  }

  return guess;
}

function applyConservativeDpsGuards(guesses, effectCandidates) {
  return guesses.map((guess) => applyConservativeHighConfidenceGuard(guess, effectCandidates));
}

function mapStats(stats) {
  const statModifiers = [];
  const unmappedStats = {};

  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
    return { statModifiers, unmappedStats };
  }

  for (const [wikiKey, rawValue] of Object.entries(stats)) {
    if (isInheritedString(rawValue)) {
      unmappedStats[wikiKey] = rawValue;
      continue;
    }
    if (typeof rawValue !== 'number' || Number.isNaN(rawValue)) {
      unmappedStats[wikiKey] = rawValue;
      continue;
    }

    const mapping = STAT_MAPPINGS[wikiKey];
    if (!mapping) {
      unmappedStats[wikiKey] = rawValue;
      continue;
    }

    const value =
      mapping.mode === 'percent' ? rawValue / (mapping.divisor ?? 100) : rawValue;
    statModifiers.push({
      attrKey: mapping.attrKey,
      mode: mapping.mode,
      value,
      sourceStatKey: wikiKey,
      sourceValue: rawValue,
    });
  }

  return { statModifiers, unmappedStats };
}

function parseTemplateParams(paramsText) {
  const params = [];
  let depth = 0;
  let current = '';
  for (const ch of paramsText) {
    if (ch === '{' && paramsText.includes('{{')) {
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === '}' && depth > 0) {
      depth -= 1;
      current += ch;
      continue;
    }
    if (ch === '|' && depth === 0) {
      params.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.length > 0) {
    params.push(current);
  }
  return params;
}

function renderWikiMarkup(rawMarkup) {
  if (typeof rawMarkup !== 'string' || rawMarkup.length === 0) {
    return {
      plainText: '',
      templates: [],
      wikiLinks: [],
    };
  }

  const templates = [];
  const wikiLinks = [];
  let text = rawMarkup;

  text = text.replace(/\[\[([^[\]]+)\]\]/g, (_match, inner) => {
    const parts = inner.split('|');
    const target = parts[0].trim();
    const label = (parts[1] ?? parts[0]).trim();
    wikiLinks.push({ target, label });
    return label;
  });

  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/'''''(.+?)'''''/g, '$1');
  text = text.replace(/'''(.+?)'''/g, '$1');
  text = text.replace(/''(.+?)''/g, '$1');

  let guard = 0;
  while (text.includes('{{') && guard < 200) {
    guard += 1;
    const start = text.lastIndexOf('{{');
    const end = text.indexOf('}}', start);
    if (start === -1 || end === -1) {
      break;
    }
    const inner = text.slice(start + 2, end);
    const params = parseTemplateParams(inner);
    const templateName = (params.shift() ?? '').trim();
    const renderedParams = params.map((entry) => renderWikiMarkup(entry).plainText).join('; ');
    templates.push({
      name: templateName,
      raw: `{{${inner}}}`,
      params,
      rendered: renderedParams,
    });
    const replacement = renderedParams
      ? `${templateName}(${renderedParams})`
      : templateName;
    text = `${text.slice(0, start)}${replacement}${text.slice(end + 2)}`;
  }

  text = text.replace(/\s+/g, ' ').trim();
  return { plainText: text, templates, wikiLinks };
}

function normalizeEffectSlot(slot, value) {
  if (value == null) {
    return null;
  }
  if (isInheritedString(value)) {
    const rendered = renderWikiMarkup(value);
    return {
      slot,
      inheritedRef: value,
      rawMarkup: value,
      plainText: rendered.plainText,
      templates: rendered.templates,
      wikiLinks: rendered.wikiLinks,
    };
  }
  if (typeof value === 'string') {
    const rendered = renderWikiMarkup(value);
    return {
      slot,
      rawMarkup: value,
      plainText: rendered.plainText,
      templates: rendered.templates,
      wikiLinks: rendered.wikiLinks,
    };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return {
      slot,
      rawMarkup: String(value),
      plainText: String(value),
      templates: [],
      wikiLinks: [],
      parseWarning: 'unexpected_effect_shape',
    };
  }

  const description = value.description ?? '';
  const rendered = renderWikiMarkup(description);
  return {
    slot,
    name: value.name ?? null,
    unique: value.unique ?? null,
    rawMarkup: description,
    plainText: rendered.plainText,
    templates: rendered.templates,
    wikiLinks: rendered.wikiLinks,
    cooldown: value.cd ?? value.cooldown ?? null,
    range: value.range ?? null,
    charges: value.charges ?? null,
    recharge: value.recharge ?? null,
    rawFields: value,
  };
}

function extractNumbers(text) {
  return [...text.matchAll(/(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
}

function guessOnHitDamage(plainText, rawMarkup = '') {
  const combined = `${plainText} ${rawMarkup}`;
  const lower = combined.toLowerCase();
  if (!/on-hit|on hit|\[\[on-hit\]\]/.test(lower) && !/basic attacks? deal/.test(lower)) {
    return null;
  }

  const nestedMarkup = rawMarkup.match(
    /\{\{as\|(\d+)\s*\{\{as\|\(\+\s*(\d+(?:\.\d+)?)%\s*AP\)\}\}[^|]*\|[^}]*\}\}/i,
  );
  if (nestedMarkup) {
    return {
      confidence: 'high',
      triggerKind: 'on_basic_attack_hit',
      reasons: ['basic_attack_on_hit_damage_pattern'],
      operations: [
        {
          kind: 'damage',
          damageType: 'magic',
          amount: Number(nestedMarkup[1]),
          attackerAttr: 'ap',
          attackerAttrRead: 'resolved',
          attackerAttrRatio: Number(nestedMarkup[2]) / 100,
        },
      ],
      recordedNotSimulated: [],
    };
  }

  const flatMagic = combined.match(
    /(\d+)\s*(?:\(\+\s*(\d+(?:\.\d+)?)%\s*AP\))?\s*(?:bonus\s+)?(magic|physical|true)\s+damage/i,
  );
  if (flatMagic) {
    const amount = Number(flatMagic[1]);
    const apRatio = flatMagic[2] ? Number(flatMagic[2]) / 100 : null;
    const damageType = flatMagic[3].toLowerCase();
    return {
      confidence: apRatio == null ? 'high' : 'high',
      triggerKind: 'on_basic_attack_hit',
      reasons: ['basic_attack_on_hit_damage_pattern'],
      operations: [
        {
          kind: 'damage',
          damageType,
          amount,
          ...(apRatio != null
            ? { attackerAttr: 'ap', attackerAttrRead: 'resolved', attackerAttrRatio: apRatio }
            : {}),
        },
      ],
      recordedNotSimulated: [],
    };
  }

  const generic = combined.match(
    /basic attacks? deal\s+(\d+(?:\.\d+)?)\s+bonus\s+(magic|physical|true)\s+damage/i,
  );
  if (generic) {
    return {
      confidence: 'high',
      triggerKind: 'on_basic_attack_hit',
      reasons: ['basic_attack_bonus_damage_pattern'],
      operations: [
        {
          kind: 'damage',
          damageType: generic[2].toLowerCase(),
          amount: Number(generic[1]),
        },
      ],
      recordedNotSimulated: [],
    };
  }

  return null;
}

function guessEveryNBasicAttack(plainText) {
  const lower = plainText.toLowerCase();
  const everyThird =
    /every third|3rd basic attack|third basic attack|at 2 stacks,\s*next basic attack/i.test(
      lower,
    );
  if (!everyThird) {
    return null;
  }

  const numbers = extractNumbers(plainText);
  const damageMatch = plainText.match(/(\d+(?:\.\d+)?)\s+(?:bonus\s+)?(magic|physical|true)\s+damage/i);
  return {
    confidence: damageMatch ? 'medium' : 'low',
    triggerKind: 'every_n_basic_attack_hit',
    reasons: ['every_n_basic_attack_pattern'],
    everyN: 3,
    operations: damageMatch
      ? [
          {
            kind: 'damage',
            damageType: damageMatch[2].toLowerCase(),
            amount: Number(damageMatch[1]),
          },
        ]
      : [],
    recordedNotSimulated: damageMatch ? [] : ['damage_amount_not_extracted'],
  };
}

function guessSpellblade(plainText, item) {
  const lower = plainText.toLowerCase();
  if (!/after using an ability|spellblade|next basic attack within/.test(lower)) {
    return null;
  }

  const baseAdRatioMatch = plainText.match(/(\d+(?:\.\d+)?)%\s*(?:'base'|base)\s*AD/i);
  const apRatioMatch = plainText.match(/\(\+\s*(\d+(?:\.\d+)?)%\s*AP\)/i);
  const attackSpeedMatch = plainText.match(/(\d+(?:\.\d+)?)%\s*bonus\s*attack speed/i);
  const stateId = `item_${item.dbItemId}_spellblade_ready`;

  return {
    confidence: baseAdRatioMatch && apRatioMatch ? 'high' : 'medium',
    triggerKind: 'next_basic_attack_after_state',
    reasons: ['spellblade_next_attack_after_ability_pattern'],
    requiresScenarioStateId: stateId,
    dpsScenarioStates: [
      {
        stateId,
        sourceType: 'item_passive',
        sourceId: item.dbItemId,
        activation: 'assumed_spell_cast_before_start',
        stacks: 1,
        startTimeMs: 0,
        durationMs: 0,
      },
    ],
    operations: [
      ...(baseAdRatioMatch
        ? [
            {
              kind: 'damage',
              damageType: 'magic',
              attackerAttr: 'ad',
              attackerAttrRead: 'base',
              attackerAttrRatio: Number(baseAdRatioMatch[1]) / 100,
            },
          ]
        : []),
      ...(apRatioMatch
        ? [
            {
              kind: 'damage',
              damageType: 'magic',
              attackerAttr: 'ap',
              attackerAttrRead: 'resolved',
              attackerAttrRatio: Number(apRatioMatch[1]) / 100,
            },
          ]
        : []),
    ],
    recordedNotSimulated: attackSpeedMatch
      ? [`temporary_attack_speed_${attackSpeedMatch[1]}_percent`]
      : ['spell_cast_timing_not_modeled'],
    assumptions: ['assumes_spell_cast_before_dps_window'],
  };
}

const MULTI_TARGET_ENERGIZED_CLAUSE_PATTERNS = [
  { pattern: /\bbounces?\b/i, reason: 'chain_bounce_clause' },
  { pattern: /\bchain lightning\b/i, reason: 'chain_lightning_clause' },
  { pattern: /\bclosest target\b/i, reason: 'closest_target_clause' },
  { pattern: /\brepeating\b/i, reason: 'repeating_target_clause' },
  { pattern: /\bsecondary targets?\b/i, reason: 'secondary_targets_clause' },
  { pattern: /\badditional targets?\b/i, reason: 'additional_targets_clause' },
  {
    pattern: /applies\s+(?:tip\()?on-hit(?:\))?\s+effects?\s+to\s+secondary/i,
    reason: 'secondary_on_hit_clause',
  },
];

function combinedEffectText(effectCandidates, slots = null) {
  const selected =
    slots == null
      ? effectCandidates
      : effectCandidates.filter((effect) => slots.includes(effect.slot));
  return selected
    .map((effect) => `${effect.name ?? ''} ${effect.plainText ?? ''} ${effect.rawMarkup ?? ''}`)
    .join(' ');
}

function extractChargeGainPerBasicAttack(effectCandidates) {
  const combined = combinedEffectText(effectCandidates);

  const totalPerAttack = combined.match(
    /total of\s+(\d+)\s+(?:bonus\s+)?(?:Energize\s+)?stacks per (?:basic )?attack/i,
  );
  if (totalPerAttack) {
    return Number(totalPerAttack[1]);
  }

  const stacksPerAttack = combined.match(
    /(\d+)\s+(?:bonus\s+)?(?:Energize\s+)?stacks per (?:basic )?attack/i,
  );
  if (stacksPerAttack) {
    return Number(stacksPerAttack[1]);
  }

  const generateAndTotal = combined.match(
    /basic attacks? generate\s+(\d+)\s+bonus.*?for a total of\s+(\d+)/i,
  );
  if (generateAndTotal) {
    return Number(generateAndTotal[2]);
  }

  return null;
}

function detectMultiTargetClauses(combinedText) {
  const recordedNotSimulated = [];
  for (const clause of MULTI_TARGET_ENERGIZED_CLAUSE_PATTERNS) {
    if (clause.pattern.test(combinedText)) {
      recordedNotSimulated.push(clause.reason);
    }
  }
  return recordedNotSimulated;
}

function guessEnergized(item, effectCandidates) {
  const chargeEffect = effectCandidates.find(
    (effect) =>
      /energiz/i.test(effect.name ?? '') ||
      /energiz/i.test(effect.plainText) ||
      /energiz/i.test(effect.rawMarkup ?? ''),
  );
  const consumeEffect = effectCandidates.find(
    (effect) =>
      (/energiz/i.test(effect.plainText) || /energiz/i.test(effect.rawMarkup ?? '')) &&
      /on-hit|bonus.*magic damage|bonus.*physical damage/i.test(effect.plainText),
  );

  if (!chargeEffect && !consumeEffect) {
    return null;
  }

  const relatedEffectSlots = [chargeEffect?.slot, consumeEffect?.slot].filter(Boolean);
  const relatedText = combinedEffectText(effectCandidates, relatedEffectSlots);
  const allEffectText = combinedEffectText(effectCandidates);
  const text = consumeEffect?.plainText ?? chargeEffect?.plainText ?? '';
  const bonusDamage = text.match(/(\d+)\s+bonus\s+(magic|physical|true)\s+damage/i);
  const chargeKey = `item_${item.dbItemId}_energized`;
  const chargeGainPerBasicAttack = extractChargeGainPerBasicAttack(effectCandidates);

  const recordedNotSimulated = detectMultiTargetClauses(allEffectText);
  if (/bonus.*range/i.test(relatedText)) {
    recordedNotSimulated.push('bonus_attack_range');
  }
  if (/moving and basic attacking generates|movement/i.test(allEffectText)) {
    recordedNotSimulated.push('movement_charge_gain');
  }

  let confidence = bonusDamage ? 'high' : 'medium';
  let blockedReason;
  if (
    confidence === 'high' &&
    (chargeGainPerBasicAttack == null || chargeGainPerBasicAttack <= 0)
  ) {
    confidence = 'medium';
    blockedReason =
      'downgraded_from_high: charge_gain_per_basic_attack_not_extracted; not modeled as ownerRole=attacker single_attacker_dps';
    recordedNotSimulated.push('charge_gain_per_basic_attack_not_extracted');
  }

  return {
    confidence,
    triggerKind: 'energized_charge_and_consume',
    reasons: ['energized_charge_and_consume_pattern'],
    chargeKey,
    chargeThreshold: 100,
    chargeCap: 100,
    ...(chargeGainPerBasicAttack != null && chargeGainPerBasicAttack > 0
      ? { chargeGainPerBasicAttack }
      : {}),
    consumeChargeOnTrigger: true,
    chargeReadyPolicy: 'next_basic_attack_after_threshold_reached',
    operations: bonusDamage
      ? [
          {
            kind: 'damage',
            damageType: bonusDamage[2].toLowerCase(),
            amount: Number(bonusDamage[1]),
          },
        ]
      : [],
    recordedNotSimulated: [...new Set(recordedNotSimulated)],
    relatedEffectSlots,
    assumptions: ['assumes_charge_at_threshold_before_dps_window'],
    ...(blockedReason ? { blockedReason } : {}),
    dpsScenarioStates: [
      {
        stateId: chargeKey,
        sourceType: 'item_passive',
        sourceId: item.dbItemId,
        activation: 'assumed_charge_before_start',
        stacks: 100,
        startTimeMs: 0,
        durationMs: 0,
      },
    ],
  };
}

function guessCritDamageReduction(plainText) {
  if (!/critical strike|critical strikes|crit/i.test(plainText)) {
    return null;
  }
  if (!/reduc/i.test(plainText)) {
    return null;
  }
  const pct = plainText.match(/(\d+(?:\.\d+)?)%/);
  return {
    confidence: 'low',
    triggerKind: 'incoming_damage_modifier',
    reasons: ['crit_damage_reduction_pattern'],
    blockedReason:
      'incoming crit damage reduction is not modeled in single_attacker_dps without target crit assumptions',
    recordedNotSimulated: pct ? [`crit_damage_reduction_${pct[1]}_percent`] : ['crit_damage_reduction'],
  };
}

function guessDpsForItem(item, effectCandidates) {
  const guesses = [];
  const blocked = [];

  const energized = guessEnergized(item, effectCandidates);
  if (energized) {
    guesses.push(energized);
  }

  for (const effect of effectCandidates) {
    const plainText = effect.plainText ?? '';
    if (!plainText) {
      continue;
    }

    if (energized?.relatedEffectSlots?.includes(effect.slot)) {
      continue;
    }

    const critReduction = guessCritDamageReduction(plainText);
    if (critReduction) {
      blocked.push({
        itemName: item.name,
        dbItemId: item.dbItemId,
        slot: effect.slot,
        effectName: effect.name,
        ...critReduction,
      });
      continue;
    }

    const spellblade = guessSpellblade(plainText, item);
    if (spellblade) {
      guesses.push({ ...spellblade, sourceSlot: effect.slot, sourceEffectName: effect.name });
      continue;
    }

    const everyN = guessEveryNBasicAttack(plainText);
    if (everyN) {
      guesses.push({ ...everyN, sourceSlot: effect.slot, sourceEffectName: effect.name });
      continue;
    }

    const onHit = guessOnHitDamage(plainText, effect.rawMarkup ?? '');
    if (onHit) {
      guesses.push({ ...onHit, sourceSlot: effect.slot, sourceEffectName: effect.name });
    }
  }

  return { guesses, blocked };
}

function computeImportEligibility(item, effective) {
  const excludedReasons = [];
  const types = Array.isArray(effective.type)
    ? effective.type
    : effective.type
      ? [effective.type]
      : [];
  const typeSet = new Set(types.map((entry) => String(entry)));
  const modes = effective.modes && typeof effective.modes === 'object' ? effective.modes : {};
  const tags = Array.isArray(effective.tags) ? effective.tags : [];

  if (typeSet.has('Minion') || typeSet.has('Turret')) {
    excludedReasons.push('non_player_item_type');
  }
  if (typeSet.has('Distributed') && !typeSet.has('Legendary') && !typeSet.has('Epic')) {
    excludedReasons.push('distributed_or_granted_item');
  }
  if (typeSet.has('Consumable') || typeSet.has('Potion') || typeSet.has('Trinket')) {
    excludedReasons.push('consumable_or_trinket');
  }
  if (effective.champion && Array.isArray(effective.champion) && effective.champion.length > 0) {
    excludedReasons.push('champion_locked_item');
  }
  if (effective.req && /requires/i.test(String(effective.req))) {
    excludedReasons.push('purchase_requirement_locked');
  }

  const isClassicSrCandidate = modes['classic sr 5v5'] === true;
  const hasOnHitTag = tags.some((tag) => /onhit|onattack/i.test(tag));
  const hasDamageEffect = (effective.effects &&
    Object.values(effective.effects).some((entry) => {
      if (!entry || typeof entry !== 'object') {
        return false;
      }
      const text = entry.description ?? '';
      return /damage|on-hit|spellblade|energiz|basic attack/i.test(text);
    })) ?? false;

  const menu = effective.menu && typeof effective.menu === 'object' ? effective.menu : {};
  const isDpsCandidate =
    isClassicSrCandidate &&
    excludedReasons.length === 0 &&
    (hasOnHitTag || hasDamageEffect || menu['onhit effects'] === true);

  return {
    isCurrent: true,
    isPlayerFacingCandidate: excludedReasons.length === 0,
    isClassicSrCandidate,
    isDpsCandidate,
    excludedReasons,
  };
}

function buildDbItemId(item, idGroups) {
  const sourceItemId = item.id == null ? null : String(item.id);
  const sourceKey = slugify(item.name);
  if (sourceItemId == null) {
    return { sourceItemId: null, sourceKey, dbItemId: `name__${sourceKey}`, collisionGroup: null };
  }

  const group = idGroups.get(sourceItemId) ?? [];
  if (group.length <= 1) {
    return { sourceItemId, sourceKey, dbItemId: sourceItemId, collisionGroup: null };
  }

  return {
    sourceItemId,
    sourceKey,
    dbItemId: `${sourceItemId}__${sourceKey}`,
    collisionGroup: {
      sourceItemId,
      memberNames: group.map((entry) => entry.name),
      resolution: 'stable_slug_suffix',
    },
  };
}

function resolveRecipeIds(recipeNames, nameToDbId) {
  const recipeItemIds = [];
  const unresolvedRecipeNames = [];
  for (const recipeName of recipeNames ?? []) {
    const dbItemId = nameToDbId.get(recipeName);
    if (dbItemId) {
      recipeItemIds.push(dbItemId);
    } else {
      unresolvedRecipeNames.push(recipeName);
    }
  }
  return { recipeItemIds, unresolvedRecipeNames };
}

function canonicalItemIdForEvidence(item) {
  if (item.sourceItemId != null) {
    return String(item.sourceItemId);
  }
  const dbItemId = String(item.dbItemId ?? '');
  return dbItemId.includes('__') ? dbItemId.split('__')[0] : dbItemId;
}

function operationSemanticSuffix(operation) {
  const parts = [operation.kind ?? 'operation'];
  if (operation.kind === 'damage') {
    if (operation.damageType) {
      parts.push(operation.damageType);
    }
    if (operation.attackerAttr) {
      parts.push(operation.attackerAttr);
    }
    if (operation.attackerAttrRead) {
      parts.push(operation.attackerAttrRead);
    }
    if (operation.amount != null) {
      parts.push(String(operation.amount));
    }
  } else if (operation.attrKey) {
    parts.push(operation.attrKey);
  }
  return parts.join('_');
}

function passiveEffectLabel(item, guess) {
  if (guess.sourceEffectName) {
    return slugify(guess.sourceEffectName);
  }
  if (guess.triggerKind === 'energized_charge_and_consume') {
    return 'energized';
  }
  return slugify(guess.triggerKind);
}

function buildDeterministicOperationSource(item, guess, operation, index) {
  const itemSlug = item.sourceKey ?? slugify(item.name);
  const effectSlug = passiveEffectLabel(item, guess);
  const semantic = operationSemanticSuffix(operation);
  return `${itemSlug}_${effectSlug}_${semantic}_${index}`;
}

function buildDeterministicOperationEvidenceKey(item, guess, operation, index) {
  const itemId = canonicalItemIdForEvidence(item);
  const effectSlug = passiveEffectLabel(item, guess);
  const semantic = operationSemanticSuffix(operation);
  return `item_${itemId}_${effectSlug}_${semantic}_${index}`;
}

function normalizePassiveOperations(item, guess, operations) {
  return (operations ?? []).map((operation, index) => {
    const normalized = { ...operation };
    if (!normalized.source) {
      normalized.source = buildDeterministicOperationSource(item, guess, operation, index);
    }
    if (!normalized.evidenceKey) {
      normalized.evidenceKey = buildDeterministicOperationEvidenceKey(
        item,
        guess,
        operation,
        index,
      );
    }
    return normalized;
  });
}

function buildSkillCandidate(item, guess) {
  if (guess.confidence !== 'high') {
    return null;
  }
  const skillKey = guess.triggerKind.replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
  const skillId = `item_${item.dbItemId}_${skillKey}_wiki_candidate`;
  return {
    skillId,
    ownerType: 'item',
    ownerId: item.dbItemId,
    skillKey: `p_${skillKey}`,
    name: `${item.name} ${guess.sourceEffectName ?? guess.triggerKind} wiki DPS candidate`,
    description: `Wiki current-items converter candidate from ${item.name}; confidence=${guess.confidence}.`,
    confidence: guess.confidence,
    reasons: guess.reasons,
    params: {
      triggerKind: guess.triggerKind,
      sourceItemName: item.name,
      sourceSlot: guess.sourceSlot ?? null,
      recordedNotSimulated: guess.recordedNotSimulated ?? [],
      assumptions: guess.assumptions ?? [],
    },
    mechanicsConfig: {
      version: 1,
      triggers: [
        {
          triggerId: `${skillId}_trigger`,
          triggerKind: guess.triggerKind,
        },
      ],
      ...(guess.dpsScenarioStates ? { dpsScenarioStates: guess.dpsScenarioStates } : {}),
      dpsPassiveEffects: [
        {
          passiveId: skillId,
          effectId: `${skillId}_effect`,
          sourceCategory: 'item_passive',
          sourceType: 'item',
          sourceId: skillId,
          triggerId: `${skillId}_trigger`,
          ownerRole: 'attacker',
          triggerKind: guess.triggerKind,
          ...(guess.chargeKey ? { chargeKey: guess.chargeKey } : {}),
          ...(guess.chargeThreshold != null ? { chargeThreshold: guess.chargeThreshold } : {}),
          ...(guess.chargeCap != null ? { chargeCap: guess.chargeCap } : {}),
          ...(guess.chargeGainPerBasicAttack != null
            ? { chargeGainPerBasicAttack: guess.chargeGainPerBasicAttack }
            : {}),
          ...(guess.consumeChargeOnTrigger != null
            ? { consumeChargeOnTrigger: guess.consumeChargeOnTrigger }
            : {}),
          ...(guess.chargeReadyPolicy
            ? { chargeReadyPolicy: guess.chargeReadyPolicy }
            : {}),
          procScope: guess.procScope ?? 'real_basic_attack_only',
          ...(guess.requiresScenarioStateId
            ? { requiresScenarioStateId: guess.requiresScenarioStateId }
            : {}),
          operations: normalizePassiveOperations(item, guess, guess.operations),
        },
      ],
    },
  };
}

function findRelatedGuessForEffect(item, effect, highConfidenceBySlot) {
  const bySourceSlot = item.dpsGuesses.find((guess) => guess.sourceSlot === effect.slot);
  if (bySourceSlot) {
    return bySourceSlot;
  }

  const byHighConfidenceSlot = highConfidenceBySlot.get(effect.slot);
  if (byHighConfidenceSlot) {
    return byHighConfidenceSlot;
  }

  return (
    item.dpsGuesses.find((guess) => guess.relatedEffectSlots?.includes(effect.slot)) ?? null
  );
}

function buildReviewRecord(item, effect, guess, options = {}) {
  return {
    schemaVersion: 'lol_wiki_current_items_ai_review.v1',
    itemName: item.name,
    dbItemId: item.dbItemId,
    sourceItemId: item.sourceItemId,
    sourceKey: item.sourceKey,
    slot: effect.slot,
    effectName: effect.name ?? null,
    plainText: effect.plainText,
    rawMarkup: effect.rawMarkup,
    templates: effect.templates ?? [],
    heuristicTags: item.tags ?? [],
    importEligibility: item.importEligibility,
    runtimeReadyCandidate: options.runtimeReadyCandidate === true,
    currentGuess: guess ?? null,
    prompt: [
      'Convert this League Wiki item passive/active text into a Damage Viewer dpsPassiveEffects candidate.',
      `Item: ${item.name} (${item.dbItemId})`,
      `Slot: ${effect.slot}${effect.name ? ` / ${effect.name}` : ''}`,
      `Plain text: ${effect.plainText}`,
      'Requirements:',
      '- Only encode single_attacker_dps-supported portions.',
      '- Put unsupported clauses into recordedNotSimulated or blockedPassive.',
      '- Do not claim runtime-ready without evidence.',
      guess
        ? `- Existing heuristic guess: ${JSON.stringify(guess)}`
        : '- No high-confidence heuristic guess yet.',
    ].join('\n'),
  };
}

function buildHeuristicTags(effect) {
  const text = `${effect.name ?? ''} ${effect.plainText}`.toLowerCase();
  const tags = [];
  if (/on-hit|on hit/.test(text)) tags.push('on_hit');
  if (/energiz/.test(text)) tags.push('energized');
  if (/spellblade|after using an ability/.test(text)) tags.push('spellblade');
  if (/every third|3rd basic/.test(text)) tags.push('every_n_basic_attack');
  if (/critical strike|crit/.test(text)) tags.push('crit_related');
  if (/shield|heal/.test(text)) tags.push('sustain');
  if (/slow|immobil|stun|root/.test(text)) tags.push('crowd_control');
  if (effect.slot === 'act') tags.push('active');
  if (effect.slot === 'consume') tags.push('consume');
  return tags;
}

function convertItems(normalized, manifest) {
  const nameMap = buildNameMap(normalized.items);
  const idGroups = buildIdGroups(normalized.items);

  const unresolved = [];
  const items = [];
  const skills = [];
  const blockedPassives = [];
  const aiReviewQueue = [];

  for (const sourceItem of normalized.items) {
    const identity = buildDbItemId(sourceItem, idGroups);
    const { effective, inheritedRefs, errors } = buildEffectiveItem(sourceItem, nameMap);
    unresolved.push(...errors);

    const rawItem = {
      name: sourceItem.name,
      id: sourceItem.id ?? null,
      tier: sourceItem.tier ?? null,
      type: sourceItem.type ?? null,
      modes: sourceItem.modes ?? null,
      menu: sourceItem.menu ?? null,
      tags: sourceItem.tags ?? null,
      stats: sourceItem.stats ?? null,
      effects: sourceItem.effects ?? null,
      recipe: sourceItem.recipe ?? null,
      buy: sourceItem.buy ?? null,
    };

    const effectiveFields = {
      name: effective.name,
      tier: effective.tier ?? null,
      type: effective.type ?? null,
      modes: effective.modes ?? null,
      menu: effective.menu ?? null,
      tags: effective.tags ?? null,
      stats: effective.stats ?? null,
      effects: effective.effects ?? null,
      recipe: effective.recipe ?? null,
      buy: effective.buy ?? null,
    };

    const { statModifiers, unmappedStats } = mapStats(effectiveFields.stats);
    const importEligibility = computeImportEligibility(
      { ...identity, tags: effectiveFields.tags },
      effectiveFields,
    );

    const effectCandidates = [];
    const effects = effectiveFields.effects ?? {};
    for (const slot of EFFECT_SLOTS) {
      if (!(slot in effects)) {
        continue;
      }
      const candidate = normalizeEffectSlot(slot, effects[slot]);
      if (candidate) {
        candidate.heuristicTags = buildHeuristicTags(candidate);
        effectCandidates.push(candidate);
      }
    }

    const item = {
      name: sourceItem.name,
      dbItemId: identity.dbItemId,
      sourceItemId: identity.sourceItemId,
      sourceKey: identity.sourceKey,
      collisionGroup: identity.collisionGroup,
      tier: effectiveFields.tier,
      type: effectiveFields.type ?? null,
      modes: effectiveFields.modes ?? null,
      menu: effectiveFields.menu ?? null,
      tags: effectiveFields.tags ?? [],
      goldCost: typeof effectiveFields.buy === 'number' ? effectiveFields.buy : null,
      buy: effectiveFields.buy ?? null,
      recipeNames: Array.isArray(effectiveFields.recipe) ? effectiveFields.recipe : [],
      recipeItemIds: [],
      unresolvedRecipeNames: [],
      statModifiers,
      unmappedStats,
      effectCandidates,
      importEligibility,
      inheritedRefs,
      rawItem,
      effectiveItem: effectiveFields,
      dpsGuesses: [],
      skillRefCandidates: [],
      recordedNotSimulated: [],
    };

    items.push(item);
  }

  const nameToDbId = new Map(items.map((item) => [item.name, item.dbItemId]));
  for (const item of items) {
    const { recipeItemIds, unresolvedRecipeNames } = resolveRecipeIds(
      item.recipeNames,
      nameToDbId,
    );
    item.recipeItemIds = recipeItemIds;
    item.unresolvedRecipeNames = unresolvedRecipeNames;
    if (unresolvedRecipeNames.length > 0) {
      unresolved.push({
        kind: 'unresolved_recipe_name',
        itemName: item.name,
        recipeNames: unresolvedRecipeNames,
      });
    }
  }

  for (const item of items) {
    const { guesses, blocked } = guessDpsForItem(item, item.effectCandidates);
    item.dpsGuesses = applyConservativeDpsGuards(guesses, item.effectCandidates);
    blockedPassives.push(...blocked);

    const highConfidenceBySlot = new Map();
    for (const guess of item.dpsGuesses) {
      if (guess.confidence === 'high') {
        const skill = buildSkillCandidate(item, guess);
        if (skill) {
          skills.push(skill);
          item.skillRefCandidates.push(skill.skillId);
          if (guess.sourceSlot) {
            highConfidenceBySlot.set(guess.sourceSlot, guess);
          }
          if (guess.relatedEffectSlots) {
            for (const slot of guess.relatedEffectSlots) {
              highConfidenceBySlot.set(slot, guess);
            }
          }
        }
      }
      item.recordedNotSimulated.push(...(guess.recordedNotSimulated ?? []));
    }
    item.recordedNotSimulated = [...new Set(item.recordedNotSimulated)];

    for (const effect of item.effectCandidates) {
      const relatedGuess = findRelatedGuessForEffect(item, effect, highConfidenceBySlot);
      const isRuntimeReady = relatedGuess?.confidence === 'high';
      const needsPartialRuntimeReview =
        isRuntimeReady &&
        ((relatedGuess?.recordedNotSimulated?.length ?? 0) > 0 ||
          (relatedGuess?.assumptions?.length ?? 0) > 0);
      if (!isRuntimeReady || needsPartialRuntimeReview) {
        aiReviewQueue.push(
          buildReviewRecord(item, effect, relatedGuess, {
            runtimeReadyCandidate: needsPartialRuntimeReview,
          }),
        );
      }
    }
  }

  const summary = {
    itemCount: items.length,
    skillCandidateCount: skills.length,
    blockedPassiveCount: blockedPassives.length,
    aiReviewQueueCount: aiReviewQueue.length,
    unresolvedCount: unresolved.length,
    collisionGroupCount: items.filter((item) => item.collisionGroup).length,
    importEligible: {
      playerFacing: items.filter((item) => item.importEligibility.isPlayerFacingCandidate).length,
      classicSr: items.filter((item) => item.importEligibility.isClassicSrCandidate).length,
      dps: items.filter((item) => item.importEligibility.isDpsCandidate).length,
    },
    effectSlotCounts: Object.fromEntries(
      EFFECT_SLOTS.map((slot) => [
        slot,
        items.filter((item) => item.effectCandidates.some((effect) => effect.slot === slot)).length,
      ]),
    ),
    highConfidenceGuessesByTrigger: highConfidenceGuessesByTrigger(items),
    inheritedFieldResolutionCount: items.reduce(
      (sum, item) => sum + item.inheritedRefs.length,
      0,
    ),
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: {
      inputFile: INPUT_FILE,
      manifest: manifest ?? null,
      normalizedMeta: {
        currentOnly: normalized.currentOnly ?? null,
        fetchedAt: normalized.fetchedAt ?? null,
      },
    },
    summary,
    items,
    skills,
    blockedPassives,
    unresolved,
    aiReviewQueue,
  };
}

function highConfidenceGuessesByTrigger(items) {
  const counts = {};
  for (const item of items) {
    for (const guess of item.dpsGuesses) {
      if (guess.confidence !== 'high') {
        continue;
      }
      counts[guess.triggerKind] = (counts[guess.triggerKind] ?? 0) + 1;
    }
  }
  return counts;
}

async function readJsonIfExists(filePath) {
  try {
    const text = await readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function writeJsonl(filePath, records) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const body = records.map((record) => JSON.stringify(record)).join('\n');
  await writeFile(filePath, body.length > 0 ? `${body}\n` : '', 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.join(args.inputRoot, INPUT_FILE);
  const manifestPath = path.join(args.inputRoot, MANIFEST_FILE);

  const normalized = await readJsonIfExists(inputPath);
  if (!normalized || !Array.isArray(normalized.items)) {
    throw new Error(`Missing or invalid normalized input: ${inputPath}`);
  }
  const manifest = await readJsonIfExists(manifestPath);

  const result = convertItems(normalized, manifest);

  const candidatesPath = path.join(args.outputRoot, OUTPUT_CANDIDATES);
  const summaryPath = path.join(args.outputRoot, OUTPUT_SUMMARY);
  const reviewQueuePath = path.join(args.outputRoot, OUTPUT_REVIEW_QUEUE);

  const { aiReviewQueue, ...bundle } = result;
  await writeJson(candidatesPath, bundle);
  await writeJson(summaryPath, {
    schemaVersion: `${SCHEMA_VERSION}.summary`,
    generatedAt: result.generatedAt,
    source: result.source,
    summary: result.summary,
    outputFiles: [OUTPUT_CANDIDATES, OUTPUT_SUMMARY, OUTPUT_REVIEW_QUEUE],
  });
  await writeJsonl(reviewQueuePath, aiReviewQueue);

  console.log(
    JSON.stringify(
      {
        ok: true,
        inputRoot: args.inputRoot,
        outputRoot: args.outputRoot,
        itemCount: result.summary.itemCount,
        skillCandidateCount: result.summary.skillCandidateCount,
        aiReviewQueueCount: result.summary.aiReviewQueueCount,
        unresolvedCount: result.summary.unresolvedCount,
        outputFiles: [OUTPUT_CANDIDATES, OUTPUT_SUMMARY, OUTPUT_REVIEW_QUEUE],
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

export {
  convertItems,
  renderWikiMarkup,
  mapStats,
  buildEffectiveItem,
  guessDpsForItem,
  applyConservativeDpsGuards,
  canonicalizeInheritedRefs,
  extractChargeGainPerBasicAttack,
  detectMultiTargetClauses,
};
