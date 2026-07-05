/**
 * Convert Data Dragon champion JSON files into DB seed candidates.
 *
 * Reads individual champion files from 数据参考/champion/*.json and produces:
 *   - heroes seed (baseStats, statsByLevel)
 *   - skills seed (passive + Q/W/E/R per champion, with parsed tooltip data)
 *   - classification per ability (ready_to_encode / needs_manual_baseline / out_of_scope)
 *
 * Output:
 *   数据参考/ddragon-champions/champion-seed-candidate.json
 *   数据参考/ddragon-champions/champion-seed-summary.json
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_CHAMPION_DIR = path.resolve(REPO_ROOT, '数据参考', 'champion');
const DEFAULT_OUTPUT_DIR = path.resolve(REPO_ROOT, '数据参考', 'ddragon-champions');

const SCHEMA_VERSION = 'ddragon_champion_seed.v1';
const VERSION_CODE = 'ddragon_champions_16_9_1';
const DDRAGON_VERSION = '16.9.1';

const OUTPUT_SEED = 'champion-seed-candidate.json';
const OUTPUT_SUMMARY = 'champion-seed-summary.json';

const SPELL_SLOTS = ['Q', 'W', 'E', 'R'];

// ── Stats mapping ──────────────────────────────────────────────────────────

const STATS_MAP = [
  { ddragon: 'hp', dbKey: 'hp', isGrowth: false },
  { ddragon: 'hpperlevel', dbKey: 'hp_growth', isGrowth: true },
  { ddragon: 'mp', dbKey: 'mana', isGrowth: false },
  { ddragon: 'mpperlevel', dbKey: 'mana_growth', isGrowth: true },
  { ddragon: 'movespeed', dbKey: 'move_speed', isGrowth: false },
  { ddragon: 'armor', dbKey: 'armor', isGrowth: false },
  { ddragon: 'armorperlevel', dbKey: 'armor_growth', isGrowth: true },
  { ddragon: 'spellblock', dbKey: 'magic_resist', isGrowth: false },
  { ddragon: 'spellblockperlevel', dbKey: 'magic_resist_growth', isGrowth: true },
  { ddragon: 'attackrange', dbKey: 'attack_range', isGrowth: false },
  { ddragon: 'hpregen', dbKey: 'hp_regen', isGrowth: false },
  { ddragon: 'hpregenperlevel', dbKey: 'hp_regen_growth', isGrowth: true },
  { ddragon: 'mpregen', dbKey: 'mana_regen', isGrowth: false },
  { ddragon: 'mpregenperlevel', dbKey: 'mana_regen_growth', isGrowth: true },
  { ddragon: 'crit', dbKey: 'crit_chance', isGrowth: false },
  { ddragon: 'critperlevel', dbKey: 'crit_chance_growth', isGrowth: true },
  { ddragon: 'attackdamage', dbKey: 'ad', isGrowth: false },
  { ddragon: 'attackdamageperlevel', dbKey: 'ad_growth', isGrowth: true },
  { ddragon: 'attackspeedperlevel', dbKey: 'attack_speed_growth', isGrowth: true },
  { ddragon: 'attackspeed', dbKey: 'attack_speed', isGrowth: false },
];

const STATS_BY_LEVEL_KEYS = [
  'hp',
  'armor',
  'magic_resist',
  'hp_regen',
  'mana_regen',
  'ad',
  'attack_speed_growth',
];

const MAX_LEVEL = 18;

function mapBaseStats(ddragonStats) {
  const base = {
    hp: 0,
    ad: 0,
    ap: 0,
    mana: 0,
    armor: 0,
    magic_resist: 0,
    move_speed: 0,
    attack_range: 0,
    attack_speed: 0,
    attack_speed_growth: 0,
    hp_regen: 0,
    mana_regen: 0,
    crit_chance: 0,
    crit_damage: 1.75,
    ability_haste: 0,
    magic_pen_flat: 0,
    magic_pen_percent: 0,
    armor_pen_flat: 0,
    armor_pen_percent: 0,
    life_steal: 0,
    omnivamp: 0,
    heal_shield_power: 0,
    energy: 0,
    energy_regen: 0,
    pv: 0,
  };
  for (const { ddragon, dbKey } of STATS_MAP) {
    if (ddragonStats[ddragon] != null) {
      base[dbKey] = ddragonStats[ddragon];
    }
  }
  // attack_speed_growth from Data Dragon is a percentage (e.g., 3.3 means 3.3%)
  if (ddragonStats.attackspeedperlevel != null) {
    base.attack_speed_growth = ddragonStats.attackspeedperlevel / 100;
  }
  return base;
}

function computeStatsByLevel(ddragonStats) {
  const result = {};
  for (const dbKey of STATS_BY_LEVEL_KEYS) {
    const mapping = STATS_MAP.find((m) => m.dbKey === dbKey || m.dbKey === `${dbKey}_growth`);
    const growthKey = STATS_MAP.find((m) => m.dbKey === `${dbKey}_growth`)?.ddragon;
    if (!growthKey) continue;
    const growth = ddragonStats[growthKey] ?? 0;
    // Level 1 = 0 bonus, Level N = (N-1) * growth
    result[dbKey] = Array.from({ length: MAX_LEVEL }, (_, i) => {
      const val = i * growth;
      // Round to avoid floating point noise
      return Math.round(val * 10000) / 10000;
    });
  }
  return result;
}

// ── Tooltip parsing ────────────────────────────────────────────────────────

const DAMAGE_TAG_RE = /<(physicalDamage|magicDamage|trueDamage)>(.*?)<\/\1>/gs;
const SPELL_PASSIVE_RE = /<spellPassive>(.*?)<\/spellPassive>/is;
const STATUS_RE = /<status>(.*?)<\/status>/gs;
const KEYWORD_RE = /<keyword(?:Major|Minor)>(.*?)<\/keyword(?:Major|Minor)>/gs;
const RULES_RE = /<rules>(.*?)<\/rules>/gs;
const VAR_PLACEHOLDER_RE = /\{\{\s*(\w+)\s*\}\}/g;
const HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/g;

function stripHtml(text) {
  if (!text) return '';
  return text
    .replace(HTML_TAG_RE, '')
    .replace(/\{\{\s*spellmodifierdescriptionappend\s*\}\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDamageInstances(tooltip) {
  if (!tooltip) return [];
  const instances = [];
  let match;
  const re = new RegExp(DAMAGE_TAG_RE.source, 'gs');
  while ((match = re.exec(tooltip)) !== null) {
    const tag = match[1]; // physicalDamage, magicDamage, trueDamage
    const content = match[2];
    const damageType = tag.replace('Damage', '').toLowerCase(); // physical, magic, true
    const plainContent = stripHtml(content);
    const vars = [...content.matchAll(VAR_PLACEHOLDER_RE)].map((m) => m[1]);
    // Try to extract numeric amounts
    const numbers = extractNumbers(plainContent);
    // Check for percent HP scaling
    const pctHpMatch = plainContent.match(
      /(\d+(?:\.\d+)?)%\s*(?:of\s+)?(?:目标)?(?:当前|最大|已损)?(?:生命值|health|hp)/i,
    );
    instances.push({
      damageType,
      rawContent: content,
      plainContent,
      variables: vars,
      numbers,
      hasPercentHp: !!pctHpMatch,
      percentHpValue: pctHpMatch ? Number(pctHpMatch[1]) : null,
    });
  }
  return instances;
}

function extractNumbers(text) {
  return [...text.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
}

function parseTooltip(tooltip, vars = [], effect = []) {
  const damageInstances = extractDamageInstances(tooltip);
  const isPassive = SPELL_PASSIVE_RE.test(tooltip);
  const plainText = stripHtml(tooltip);
  const statuses = [...tooltip.matchAll(STATUS_RE)].map((m) => stripHtml(m[1]));
  const keywords = [...tooltip.matchAll(KEYWORD_RE)].map((m) => stripHtml(m[1]));
  const allVars = [...tooltip.matchAll(VAR_PLACEHOLDER_RE)].map((m) => m[1]);

  // Map effect array values to variable names where possible
  const effectValues = {};
  if (Array.isArray(effect)) {
    for (let i = 1; i < effect.length; i++) {
      if (effect[i] && Array.isArray(effect[i])) {
        effectValues[`e${i}`] = effect[i];
      }
    }
  }

  // Map vars array
  const varsMap = {};
  for (const v of vars) {
    if (v.key) {
      varsMap[v.key] = {
        link: v.link ?? null,
        coeff: v.coeff ?? null,
      };
    }
  }

  return {
    damageInstances,
    isPassive,
    plainText,
    statuses,
    keywords,
    variables: allVars,
    effectValues,
    varsMap,
  };
}

// ── Ability classification ────────────────────────────────────────────────

function classifyAbility(slot, parsed) {
  const { damageInstances, isPassive, plainText } = parsed;
  const lower = plainText.toLowerCase();

  // Check for DPS-relevant patterns
  const hasOnHit = /on.?hit|on hit|每.*次|every.*third|every.*3rd|third.*attack/i.test(lower);
  const hasDamage = damageInstances.length > 0;
  const hasAttackSpeed = /attack speed|攻击速度/i.test(lower);
  const hasAdBuff = /bonus.*ad|attack damage.*bonus|额外.*攻击力/i.test(lower);
  const hasPercentHp = damageInstances.some((d) => d.hasPercentHp);

  // Out of scope patterns
  const isCcOnly = /stun|root|slow|knockup|knockback|charm|fear|taunt|sleep|suppression|晕|击退|击飞|魅惑|恐惧|嘲讽/i.test(lower) && !hasDamage;
  const isMobilityOnly = /dash|blink|leap|jump|位移|翻滚|冲刺/i.test(lower) && !hasDamage;
  const isHealShieldOnly = /heal|shield|治疗|护盾/i.test(lower) && !hasDamage;
  const isUtilityOnly = /vision|reveal|stealth|invisible|视野|隐身/i.test(lower) && !hasDamage;

  if (isCcOnly || isMobilityOnly || isHealShieldOnly || isUtilityOnly) {
    return {
      bucket: 'out_of_scope_for_single_target_dps',
      reason: isCcOnly ? 'cc_only' : isMobilityOnly ? 'mobility_only' : isHealShieldOnly ? 'heal_shield_only' : 'utility_only',
    };
  }

  if (hasOnHit && hasDamage) {
    return {
      bucket: 'ready_to_encode',
      reason: 'on_hit_damage',
    };
  }

  if (hasPercentHp) {
    return {
      bucket: 'ready_to_encode',
      reason: 'percent_hp_damage',
    };
  }

  if (isPassive && hasDamage) {
    // Passive with damage but not on-hit pattern
    const hasResolvedNumbers = damageInstances.some((d) => d.numbers.length > 0);
    if (hasResolvedNumbers) {
      return {
        bucket: 'ready_to_encode',
        reason: 'passive_damage_with_values',
      };
    }
    return {
      bucket: 'needs_manual_baseline',
      reason: 'passive_damage_no_values',
    };
  }

  if (hasDamage) {
    // Active ability with damage
    const hasResolvedNumbers = damageInstances.some((d) => d.numbers.length > 0);
    if (hasResolvedNumbers) {
      return {
        bucket: 'needs_manual_baseline',
        reason: 'active_damage_needs_rotation_model',
      };
    }
    return {
      bucket: 'needs_manual_baseline',
      reason: 'active_damage_no_values',
    };
  }

  if (hasAttackSpeed || hasAdBuff) {
    return {
      bucket: 'needs_manual_baseline',
      reason: 'buff_needs_values',
    };
  }

  return {
    bucket: 'out_of_scope_for_single_target_dps',
    reason: 'no_dps_relevant_pattern',
  };
}

// ── Seed builders ──────────────────────────────────────────────────────────

function buildHeroSeed(championId, champion) {
  const stats = champion.stats ?? {};
  return {
    heroId: championId,
    name: champion.name ?? championId,
    title: champion.title ?? '',
    avatarUrl: `champion/${championId}`,
    baseStats: mapBaseStats(stats),
    statsByLevel: computeStatsByLevel(stats),
    source: {
      dataSource: 'ddragon',
      version: DDRAGON_VERSION,
      championKey: champion.key ?? null,
      tags: champion.tags ?? [],
      partype: champion.partype ?? null,
    },
  };
}

function buildSkillSeed(championId, champion, ability, slot, slotLabel) {
  const tooltip = ability.tooltip ?? ability.description ?? '';
  const vars = ability.vars ?? [];
  const effect = ability.effect ?? [];
  const parsed = parseTooltip(tooltip, vars, effect);
  const classification = classifyAbility(slotLabel, parsed);

  const skillId = `champion_${championId}_${slotLabel}`;
  const name = ability.name ?? `${slotLabel} ability`;

  // Build resource costs
  const resourceCosts = {};
  if (ability.cost && Array.isArray(ability.cost) && ability.cost.some((c) => c > 0)) {
    const partype = champion.partype ?? '法力';
    const resourceKey = partype.includes('法力') ? 'mana' : partype.includes('能量') ? 'energy' : 'none';
    if (resourceKey !== 'none') {
      resourceCosts[resourceKey] = ability.cost;
    }
  }

  // Build cooldowns
  const cooldowns = ability.cooldown && Array.isArray(ability.cooldown) ? ability.cooldown : [];

  // Build params with parsed tooltip data
  const params = {
    slot: slotLabel,
    maxrank: ability.maxrank ?? 1,
    classification: classification.bucket,
    classificationReason: classification.reason,
    isPassive: parsed.isPassive,
    ddragonSpellId: ability.id ?? null,
    damageInstances: parsed.damageInstances.map((d) => ({
      damageType: d.damageType,
      plainContent: d.plainContent,
      variables: d.variables,
      numbers: d.numbers,
      hasPercentHp: d.hasPercentHp,
      percentHpValue: d.percentHpValue,
    })),
    variables: parsed.variables,
    effectValues: parsed.effectValues,
    varsMap: parsed.varsMap,
    statuses: parsed.statuses,
    keywords: parsed.keywords,
    candidateOnly: true,
    conversionRule: SCHEMA_VERSION,
  };

  // Build mechanicsConfig
  const mechanicsConfig = {
    version: 1,
    triggers: [],
    dpsPassiveEffects: [],
  };

  // For ready_to_encode passives with on-hit damage, build dpsPassiveEffects
  if (classification.bucket === 'ready_to_encode' && parsed.isPassive) {
    const triggerKind = /每.*第.*次|every.*third|every.*3rd|third.*attack/i.test(parsed.plainText)
      ? 'every_n_basic_attack_hit'
      : 'on_basic_attack_hit';

    mechanicsConfig.triggers.push({
      triggerId: `${championId}_${slotLabel}_${triggerKind}`,
      triggerKind,
    });

    for (const dmg of parsed.damageInstances) {
      const operation = {
        kind: 'damage',
        damageType: dmg.damageType,
        source: `${championId}_${slotLabel}_damage`,
        evidenceKey: `champion_${championId}_${slotLabel}_${dmg.damageType}`,
      };
      if (dmg.hasPercentHp && dmg.percentHpValue) {
        operation.targetAttr = 'max_hp';
        operation.targetAttrRatio = dmg.percentHpValue / 100;
      } else if (dmg.numbers.length > 0) {
        operation.amount = dmg.numbers[0];
      }
      mechanicsConfig.dpsPassiveEffects.push({
        passiveId: skillId,
        effectId: `${skillId}_effect`,
        sourceCategory: 'hero_passive',
        sourceType: 'hero',
        sourceId: championId,
        triggerId: `${championId}_${slotLabel}_${triggerKind}`,
        ownerRole: 'attacker',
        operations: [operation],
        triggerKind,
        procScope: 'real_basic_attack_only',
      });
    }
  }

  return {
    skillId,
    ownerType: 'hero',
    ownerId: championId,
    skillKey: slotLabel,
    name,
    description: parsed.plainText.slice(0, 500),
    resourceCosts: Object.keys(resourceCosts).length > 0 ? resourceCosts : null,
    cooldowns: cooldowns.length > 0 ? cooldowns : null,
    params,
    mechanicsConfig,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    championDir: DEFAULT_CHAMPION_DIR,
    outputDir: DEFAULT_OUTPUT_DIR,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--champion-dir') {
      args.championDir = path.resolve(argv[i + 1]);
      i += 1;
    } else if (argv[i] === '--output-dir') {
      args.outputDir = path.resolve(argv[i + 1]);
      i += 1;
    }
  }
  return args;
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
  const files = (await readdir(args.championDir))
    .filter((f) => f.endsWith('.json'))
    .sort();

  const heroes = [];
  const skills = [];
  const bucketCounts = {};
  const reasonCounts = {};
  const championSummaries = [];

  for (const file of files) {
    const filePath = path.join(args.championDir, file);
    const data = await readJson(filePath);
    const championId = Object.keys(data.data ?? {})[0];
    if (!championId) continue;
    const champion = data.data[championId];

    // Build hero
    heroes.push(buildHeroSeed(championId, champion));

    // Build passive skill
    if (champion.passive) {
      const passiveSkill = buildSkillSeed(championId, champion, champion.passive, 'passive', 'P');
      skills.push(passiveSkill);
      bucketCounts[passiveSkill.params.classification] = (bucketCounts[passiveSkill.params.classification] ?? 0) + 1;
      reasonCounts[passiveSkill.params.classificationReason] = (reasonCounts[passiveSkill.params.classificationReason] ?? 0) + 1;
    }

    // Build Q/W/E/R skills
    if (Array.isArray(champion.spells)) {
      for (let i = 0; i < Math.min(champion.spells.length, 4); i++) {
        const slotLabel = SPELL_SLOTS[i];
        const skill = buildSkillSeed(championId, champion, champion.spells[i], champion.spells[i], slotLabel);
        skills.push(skill);
        bucketCounts[skill.params.classification] = (bucketCounts[skill.params.classification] ?? 0) + 1;
        reasonCounts[skill.params.classificationReason] = (reasonCounts[skill.params.classificationReason] ?? 0) + 1;
      }
    }

    // Champion summary
    const champSkills = skills.filter((s) => s.ownerId === championId);
    const readyCount = champSkills.filter((s) => s.params.classification === 'ready_to_encode').length;
    championSummaries.push({
      championId,
      name: champion.name,
      tags: champion.tags ?? [],
      totalAbilities: champSkills.length,
      readyToEncode: readyCount,
      buckets: champSkills.reduce((acc, s) => {
        acc[s.params.classification] = (acc[s.params.classification] ?? 0) + 1;
        return acc;
      }, {}),
    });
  }

  const seed = {
    gameId: 'lol',
    versionCode: VERSION_CODE,
    source: {
      dataSource: 'ddragon',
      version: DDRAGON_VERSION,
      championCount: heroes.length,
      generatedAt: new Date().toISOString(),
    },
    ownerCategories: [
      { ownerType: 'hero', name: '英雄' },
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
    heroes,
    typeRelations: [],
    scenarios: [],
    skills,
    items: [],
  };

  const marksmanChampions = championSummaries.filter((c) =>
    c.tags.includes('Marksman'),
  );

  const summary = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: {
      dataSource: 'ddragon',
      version: DDRAGON_VERSION,
      championCount: heroes.length,
    },
    counts: {
      heroes: heroes.length,
      skills: skills.length,
      passiveCount: skills.filter((s) => s.skillKey === 'P').length,
      spellCount: skills.filter((s) => SPELL_SLOTS.includes(s.skillKey)).length,
    },
    bucketCounts,
    reasonCounts,
    marksmanChampionCount: marksmanChampions.length,
    marksmanReadyToEncode: marksmanChampions.reduce(
      (sum, c) => sum + c.readyToEncode,
      0,
    ),
    topReadyChampions: championSummaries
      .filter((c) => c.readyToEncode > 0)
      .sort((a, b) => b.readyToEncode - a.readyToEncode)
      .slice(0, 20)
      .map((c) => ({
        championId: c.championId,
        name: c.name,
        tags: c.tags,
        readyToEncode: c.readyToEncode,
        buckets: c.buckets,
      })),
    outputFiles: [OUTPUT_SUMMARY, OUTPUT_SEED],
  };

  await writeJson(path.join(args.outputDir, OUTPUT_SEED), seed);
  await writeJson(path.join(args.outputDir, OUTPUT_SUMMARY), summary);

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
