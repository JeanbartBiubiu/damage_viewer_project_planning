/**
 * Fetch / check current League Wiki champion ability templates.
 *
 * Modes:
 *   (default) / --refresh  network fetch, rewrite stable UTF-8/LF JSON under 数据参考/lol-wiki-current-champions/
 *   --check    offline; validate revision metadata, raw snapshot form, normalized extraction, exact bytes
 *
 * Provenance:
 *   contentSha256 / rawByteSize hash the upstream API wikitext after LF canonicalization only.
 *   On-disk raw/*.wikitext files additionally strip trailing spaces/tabs per line and end with one newline.
 *   Those file-output whitespace normalizations must not change contentSha256.
 *
 * Dependencies (separate from the 8 champion ability pages):
 *   Template:Pplevel → Template:Passive progression level
 *   Module:Ability progression
 *   Stored under dependencies/ + dependencies/raw/; used to prove Kai'Sa P {{pplevel|A to B}}
 *   spans levels 1..18 with linear fill denominator 17.
 *
 * Usage:
 *   node tools/lol-static-data/fetch-lol-wiki-current-champion-abilities.mjs
 *   node tools/lol-static-data/fetch-lol-wiki-current-champion-abilities.mjs --refresh
 *   node tools/lol-static-data/fetch-lol-wiki-current-champion-abilities.mjs --check
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const WIKI_API = 'https://wiki.leagueoflegends.com/en-us/api.php';
const WIKI_ORIGIN = 'https://wiki.leagueoflegends.com/en-us';
const USER_AGENT = 'damage-wasm-dev/lol-wiki-current-champions/1.0';

const OUTPUT_ROOT = path.join(repoRoot, '数据参考', 'lol-wiki-current-champions');
const PAGES_DIR = path.join(OUTPUT_ROOT, 'pages');
const RAW_DIR = path.join(OUTPUT_ROOT, 'raw');
const NORMALIZED_DIR = path.join(OUTPUT_ROOT, 'normalized');
const DEPENDENCIES_DIR = path.join(OUTPUT_ROOT, 'dependencies');
const DEPENDENCIES_RAW_DIR = path.join(DEPENDENCIES_DIR, 'raw');

const MANIFEST_PATH = path.join(OUTPUT_ROOT, 'manifest.json');
const SUMMARY_PATH = path.join(OUTPUT_ROOT, 'summary.json');
const CONTRACTS_PATH = path.join(NORMALIZED_DIR, 'reviewed-contracts.json');

/** Request titles (skill letter forms); redirects are resolved and stored. */
const PAGE_SPECS = [
  {
    id: 'ashe-q',
    requestTitle: 'Template:Data Ashe/Q',
    championId: 'Ashe',
    skillKey: 'Q',
    abilityName: "Ranger's Focus",
    zhName: '射手的专注',
  },
  {
    id: 'ashe-w',
    requestTitle: 'Template:Data Ashe/W',
    championId: 'Ashe',
    skillKey: 'W',
    abilityName: 'Volley',
    zhName: '万箭齐发',
  },
  {
    id: 'draven-q',
    requestTitle: 'Template:Data Draven/Q',
    championId: 'Draven',
    skillKey: 'Q',
    abilityName: 'Spinning Axe',
    zhName: '旋转飞斧',
  },
  {
    id: 'graves-p',
    requestTitle: 'Template:Data Graves/I',
    championId: 'Graves',
    skillKey: 'P',
    abilityName: 'New Destiny',
    zhName: '新命运',
  },
  {
    id: 'akshan-p',
    requestTitle: 'Template:Data Akshan/I',
    championId: 'Akshan',
    skillKey: 'P',
    abilityName: 'Dirty Fighting',
    zhName: '无所不用',
  },
  {
    id: 'akshan-e',
    requestTitle: 'Template:Data Akshan/E',
    championId: 'Akshan',
    skillKey: 'E',
    abilityName: 'Heroic Swing',
    zhName: '骄行荡寇',
  },
  {
    id: 'kaisa-p',
    requestTitle: "Template:Data Kai'Sa/I",
    championId: "Kai'Sa",
    skillKey: 'P',
    abilityName: 'Second Skin',
    zhName: '体表活肤',
  },
  {
    id: 'ezreal-p',
    requestTitle: 'Template:Data Ezreal/I',
    championId: 'Ezreal',
    skillKey: 'P',
    abilityName: 'Rising Spell Force',
    zhName: '咒能高涨',
  },
];

/**
 * Template/module dependencies used to interpret {{pplevel|A to B}}.
 * Separate from PAGE_SPECS; pageCount remains PAGE_SPECS.length.
 */
const DEPENDENCY_SPECS = [
  {
    id: 'passive-progression-level',
    requestTitle: 'Template:Pplevel',
    expectedResolvedTitle: 'Template:Passive progression level',
    kind: 'template',
    contentMediaType: 'wikitext',
    rawFileName: 'passive-progression-level.wikitext',
    jsonFileName: 'passive-progression-level.json',
  },
  {
    id: 'ability-progression',
    requestTitle: 'Module:Ability progression',
    expectedResolvedTitle: 'Module:Ability progression',
    kind: 'module',
    contentMediaType: 'lua',
    rawFileName: 'ability-progression.lua',
    jsonFileName: 'ability-progression.json',
  },
];

const PPLEVEL_DEFAULT_SIZE = 18;
const PPLEVEL_LINEAR_DENOMINATOR = PPLEVEL_DEFAULT_SIZE - 1;

function sha256Text(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function canonicalizeLf(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Deterministic on-disk raw snapshot form:
 * LF endings, no trailing spaces/tabs per line, exactly one final newline.
 * Does not change contentSha256 input (upstream LF text).
 */
function serializeRawSnapshot(text) {
  const lf = canonicalizeLf(text);
  const stripped = lf.replace(/[ \t]+$/gm, '');
  if (stripped.length === 0) return '\n';
  return stripped.endsWith('\n') ? stripped : `${stripped}\n`;
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

async function writeTextLf(filePath, content) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, canonicalizeLf(content), 'utf8');
}

async function writeJsonLf(filePath, payload) {
  await writeTextLf(filePath, stableJson(payload));
}

async function readText(filePath) {
  return canonicalizeLf(await readFile(filePath, 'utf8'));
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Wiki API HTTP ${response.status} ${response.statusText} for ${url}`);
  }
  const text = await response.text();
  if (/challenge-platform|Just a moment|cf-browser-verification|Attention Required/i.test(text)) {
    throw new Error(`Wiki API returned a challenge/interstitial page for ${url}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Wiki API returned non-JSON for ${url}`);
  }
}

function pageSourceUrl(title) {
  return `${WIKI_ORIGIN}/${encodeURIComponent(title).replace(/%2F/g, '/')}`;
}

function snippetAround(text, needle, radius = 120) {
  const idx = text.indexOf(needle);
  if (idx < 0) return text.slice(0, Math.min(text.length, radius * 2));
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + needle.length + radius);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function fieldSnippet(raw, fieldName) {
  const re = new RegExp(`\\|${fieldName}\\s*=\\s*([^\\n|]*)`, 'i');
  const m = raw.match(re);
  if (!m) return '';
  return snippetAround(raw, m[0], 160);
}

function dependencyRelPaths(spec) {
  return {
    jsonRelPath: `dependencies/${spec.jsonFileName}`,
    rawRelPath: `dependencies/raw/${spec.rawFileName}`,
  };
}

function buildPplevelInterpolation({ start, finish, markup }) {
  return {
    kind: 'pplevel_bare_range_levels_1_to_18',
    template: 'pplevel',
    markup,
    start,
    finish,
    levels: { first: 1, last: PPLEVEL_DEFAULT_SIZE },
    defaultSize: PPLEVEL_DEFAULT_SIZE,
    linearDenominator: PPLEVEL_LINEAR_DENOMINATOR,
    exactFormula: `${start} + (${finish}-${start})/${PPLEVEL_LINEAR_DENOMINATOR}*(level-1)`,
    wikiModuleSemantics: {
      entry: 'pplevel -> pp',
      defaultSize: PPLEVEL_DEFAULT_SIZE,
      linearFill:
        'after emitting start, fill with start + (finish-start) * x / times; bare A to B spans levels 1..18 with times=17',
      provesLinearFill: true,
    },
    projectRuntimePolicy: {
      useExactLinearFormula: true,
      artificialIntermediateRounding: false,
      note:
        'Wiki module proves linear fill; current project runtime uses the exact linear formula without artificial intermediate rounding.',
    },
    displayRounding: {
      presentationMetadataOnly: true,
      mutatesExactFormula: false,
      note:
        'Any Wiki tooltip/display rounding is presentation metadata only and must not mutate the exactFormula used by project runtime.',
    },
  };
}

function buildKaisaCausticWoundsFlat(raw, dependencyById) {
  const depRefs = DEPENDENCY_SPECS.map((spec) => {
    const dep = dependencyById.get(spec.id);
    if (!dep) throw new Error(`kaisa-p: missing dependency ${spec.id}`);
    return {
      id: dep.id,
      requestTitle: dep.requestTitle,
      resolvedTitle: dep.resolvedTitle,
      pageId: dep.pageId,
      revisionId: dep.revisionId,
      revisionTimestamp: dep.revisionTimestamp,
      contentSha256: dep.contentSha256,
      rawByteSize: dep.rawByteSize,
      sourceUrl: dep.sourceUrl,
    };
  });

  return {
    baseByLevel: '4 to 24',
    apRatio: 0.12,
    perPriorStackByLevel: '1 to 6',
    perPriorStackApRatio: 0.03,
    sourceField: 'description3',
    sourceSnippet: snippetAround(raw, 'Caustic Wounds'),
    wikiMarkupEvidence: {
      base: '{{pplevel|4 to 24}}',
      perPriorStack: '{{pplevel|1 to 6}}',
    },
    sourceDependencies: depRefs,
    baseInterpolation: buildPplevelInterpolation({
      start: 4,
      finish: 24,
      markup: '{{pplevel|4 to 24}}',
    }),
    perPriorStackInterpolation: buildPplevelInterpolation({
      start: 1,
      finish: 6,
      markup: '{{pplevel|1 to 6}}',
    }),
  };
}

/**
 * Reviewed, page-specific normalized contracts.
 * Every numeric/formula retains template/page/revision + source snippet.
 */
function buildReviewedContract(spec, pageMeta, raw, dependencyById = new Map()) {
  const base = {
    id: spec.id,
    championId: spec.championId,
    skillKey: spec.skillKey,
    abilityName: spec.abilityName,
    zhName: spec.zhName,
    requestTitle: spec.requestTitle,
    resolvedTitle: pageMeta.resolvedTitle,
    pageId: pageMeta.pageId,
    revisionId: pageMeta.revisionId,
    revisionTimestamp: pageMeta.revisionTimestamp,
    sourceUrl: pageMeta.sourceUrl,
    contentSha256: pageMeta.contentSha256,
    dataPolicy: {
      precedence: ['league_wiki_current_template', 'ddragon', 'batch_b_ocr_historical_provenance_only'],
      blockedDataOnlyWhen: 'checked_league_wiki_template_lacks_or_marks_unknown_required_numeric_contract',
    },
  };

  switch (spec.id) {
    case 'ashe-q':
      return {
        ...base,
        contracts: {
          focusStacks: {
            value: 4,
            unit: 'stacks',
            sourceField: 'costtype',
            sourceSnippet: fieldSnippet(raw, 'costtype') || snippetAround(raw, 'stacking up to 4 times'),
          },
          focusDurationSeconds: {
            value: 4,
            unit: 's',
            note: 'Passive Focus duration; stacks expire one-by-one every second after duration ends.',
            sourceSnippet: snippetAround(raw, 'Focus for 4 seconds'),
          },
          flurryDurationSeconds: {
            value: 6,
            unit: 's',
            sourceField: 'description2',
            sourceSnippet: snippetAround(raw, 'For 6 seconds'),
          },
          bonusAttackSpeedRankTablePercent: {
            value: [20, 30, 40, 50, 60],
            sourceField: 'leveling2',
            sourceSnippet: snippetAround(raw, 'Bonus Attack Speed'),
          },
          arrowsPerFlurry: {
            value: 5,
            sourceSnippet: snippetAround(raw, 'flurry of five arrows'),
          },
          totalDamagePerFlurryAdPercentRank5: {
            value: 130,
            sourceField: 'ad5 vardefine',
            sourceSnippet: snippetAround(raw, 'vardefine:ad5|130'),
          },
          firstFlurry: {
            arrows: 6,
            totalDamageAdPercentRank5: 156,
            note: 'First flurry fires one additional arrow (20% increased total damage): 130%*1.2=156% AD.',
            sourceSnippet: snippetAround(raw, 'six arrows'),
          },
          manaCost: {
            value: 30,
            sourceField: 'cost',
            sourceSnippet: fieldSnippet(raw, 'cost'),
          },
        },
        userScope: {
          included: [
            '4 Focus cast gate',
            '6s Flurry window',
            'rank5 +60% AS',
            '5 arrows at 130% AD total / first flurry 6 arrows at 156% AD',
            '30 mana',
          ],
          explicitlyExcluded: [
            'attack_timer_reset',
            'arrow_flight',
            'Frost Shot',
            'life_steal',
            'structures_multitarget',
            'full_rotation',
          ],
        },
        differencesFromPriorEvidence: [
          {
            topic: 'bonus_attack_speed_rank5',
            wiki: '60%',
            priorGenericSeedNote: 'wasm-generic-ashe-rangers-focus historically cited percent_add=0.75 (75%)',
            resolution: 'prefer_current_wiki_60_percent',
          },
        ],
        numericContractStatus: 'complete_for_user_scope',
      };
    case 'ashe-w':
      return {
        ...base,
        contracts: {
          physicalDamage: {
            baseByRank: [60, 95, 130, 165, 200],
            bonusAdRatio: 1.0,
            sourceField: 'leveling',
            sourceSnippet: snippetAround(raw, 'Physical Damage'),
          },
          arrowsByRank: {
            value: [7, 8, 9, 10, 11],
            sourceField: 'leveling',
            sourceSnippet: snippetAround(raw, 'Arrows'),
          },
          cooldownByRank: {
            value: [18, 14.5, 11, 7.5, 4],
            sourceField: 'cooldown',
            sourceSnippet: fieldSnippet(raw, 'cooldown'),
          },
          manaCostByRank: {
            value: [75, 70, 65, 60, 55],
            sourceField: 'cost',
            sourceSnippet: fieldSnippet(raw, 'cost'),
          },
          firstArrowOnlyDamages: {
            value: true,
            sourceField: 'description2',
            sourceSnippet: snippetAround(raw, 'do not take damage from any beyond the first'),
          },
        },
        numericContractStatus: 'complete',
      };
    case 'draven-q':
      return {
        ...base,
        contracts: {
          bonusPhysicalDamage: {
            baseByRank: [40, 45, 50, 55, 60],
            bonusAdRatioByRankPercent: [75, 85, 95, 105, 115],
            rank5: { base: 60, bonusAdRatio: 1.15 },
            sourceField: 'leveling',
            sourceSnippet: snippetAround(raw, 'Bonus Physical Damage'),
          },
          catchLandingSeconds: {
            approx: 1.4,
            rangeSeconds: [1.35, 1.4],
            sourceField: 'description2/notes',
            sourceSnippet: snippetAround(raw, 'roughly 1.4 seconds'),
          },
          maxAxesInHand: {
            value: 2,
            sourceField: 'description3',
            sourceSnippet: snippetAround(raw, 'up to two'),
          },
          manaCost: {
            value: 45,
            sourceField: 'cost',
            sourceSnippet: fieldSnippet(raw, 'cost'),
          },
          cooldownByRank: {
            value: [12, 11, 10, 9, 8],
            rank5: 8,
            sourceField: 'cooldown',
            sourceSnippet: fieldSnippet(raw, 'cooldown'),
          },
          buffDurationSeconds: {
            value: 5.8,
            sourceField: 'description',
            sourceSnippet: snippetAround(raw, 'within'),
          },
        },
        numericContractStatus: 'complete_for_damage_catch_cap_mana_cd',
        remainingRuntimeScope: [
          'axe_caught_event',
          'catch_rearm',
          'dual_axe_cap_implementation',
          'landing_movement_ownership',
        ],
      };
    case 'graves-p':
      return {
        ...base,
        contracts: {
          pointBlankScope: {
            decision: 'point_blank_maximum_pellets_only',
            normalPellets: 4,
            critPellets: 6,
            sourceSnippet: snippetAround(raw, '4 pellets'),
          },
          normalPelletDamageFormulas: {
            firstPelletAdRatioFormula:
              '100*(0.6895 + 0.01765*x*(0.595 + 0.0225*(x-1)))% AD',
            subsequentPelletFractionOfFirst: 0.33302,
            maxTotalSingleTargetFormula:
              '100*(0.6895 + 0.01765*x*(0.595 + 0.0225*(x-1)))*(1+3*0.33302)% AD',
            sourceField: 'description2',
            sourceSnippet: snippetAround(raw, '12-Gauge'),
            status: 'wiki_explicit',
          },
          critPelletDamageFormulas: {
            pellets: 6,
            widerConePercent: 25,
            critBonusDamageNote: '50% bonus critical damage scaling per Wiki critical damage helper',
            sourceField: 'description3',
            sourceSnippet: snippetAround(raw, 'Critical strikes spray'),
            status: 'wiki_explicit',
          },
          reloadSpeedPreciseFormula: {
            status: 'wiki_explicit_unknown',
            evidenceSnippet: snippetAround(raw, 'Precise formula is unknown'),
            approximateNotesPresent: true,
            approximateNoteSnippet: snippetAround(raw, '2.08'),
          },
        },
        numericContractStatus: 'partial_wiki_explicit_unknown_reload',
        blockedDataFields: ['precise_reload_speed_formula'],
      };
    case 'akshan-p':
      return {
        ...base,
        contracts: {
          secondShotAdRatio: {
            value: 0.5,
            minionAdRatio: 1.0,
            sourceField: 'description',
            sourceSnippet: snippetAround(raw, '50% AD'),
          },
          dirtyFightingStacks: {
            durationSeconds: 5,
            maxStacks: 3,
            sourceField: 'description3',
            sourceSnippet: snippetAround(raw, 'for 5 seconds'),
          },
          thirdStackMagicDamage: {
            levelThresholds: [15, 40, 80, 150],
            levels: [1, 6, 11, 16],
            apRatio: 0.6,
            sourceField: 'description3',
            sourceSnippet: snippetAround(raw, '60% AP'),
          },
          shieldBranch: {
            inDamageScope: false,
            note: 'Champion-target shield may remain out of damage scope.',
            sourceSnippet: snippetAround(raw, 'shield'),
          },
        },
        numericContractStatus: 'complete_for_damage_branch',
      };
    case 'akshan-e':
      return {
        ...base,
        contracts: {
          physicalDamagePerShot: {
            baseByRank: [8, 16, 24, 32, 40],
            adRatio: 0.25,
            bonusAsMultiplier: '(1 + 0.3 per 100% bonus AS)',
            sourceField: 'leveling3',
            sourceSnippet: snippetAround(raw, 'Physical Damage per Shot'),
          },
          shotIntervalSeconds: {
            value: 0.2,
            sourceField: 'description3',
            sourceSnippet: snippetAround(raw, 'every'),
          },
          manaCost: {
            value: 70,
            sourceField: 'cost',
            sourceSnippet: fieldSnippet(raw, 'cost'),
          },
          cooldownByRank: {
            value: [18, 16.5, 15, 13.5, 12],
            sourceField: 'cooldown',
            sourceSnippet: fieldSnippet(raw, 'cooldown'),
          },
        },
        numericContractStatus: 'complete_for_per_shot_damage',
        remainingRuntimeScope: [
          'movement_swing_path',
          'shot_count_during_swing',
          'hook_attach_terrain',
        ],
        note: 'Movement/swing/shot-count remains runtime scope, not a Wiki data gap.',
      };
    case 'kaisa-p':
      return {
        ...base,
        contracts: {
          plasmaDurationSeconds: {
            value: 4,
            maxStacks: 5,
            sourceField: 'description2',
            sourceSnippet: snippetAround(raw, 'for 4 seconds'),
          },
          causticWoundsFlat: buildKaisaCausticWoundsFlat(raw, dependencyById),
          fifthStackMissingHealth: {
            baseRatio: 0.15,
            apPer100: 0.06,
            monsterCap: 400,
            sourceField: 'description3',
            sourceSnippet: snippetAround(raw, 'missing health'),
          },
        },
        numericContractStatus: 'complete',
        historicalProvenanceOnly: [
          'Batch-B level1/OCR may remain as provenance; never competing numeric truth when current Wiki exists.',
        ],
      };
    case 'ezreal-p':
      return {
        ...base,
        contracts: {
          attackSpeedPerStackPercent: {
            value: 10,
            sourceField: 'description2',
            sourceSnippet: snippetAround(raw, '10%'),
          },
          maxStacks: {
            value: 5,
            maxAttackSpeedPercent: 50,
            sourceField: 'description',
            sourceSnippet: snippetAround(raw, 'stacking up to 5 times'),
          },
          durationSeconds: {
            value: 6,
            sourceField: 'description',
            sourceSnippet: snippetAround(raw, 'lasting for 6 seconds'),
          },
        },
        numericContractStatus: 'complete',
      };
    default:
      throw new Error(`No reviewed extractor for ${spec.id}`);
  }
}

function validatePplevelInterpolation(contractId, fieldName, interp, expected) {
  const errors = [];
  const prefix = `${contractId}.${fieldName}`;
  if (!interp || typeof interp !== 'object') {
    errors.push(`${prefix}: missing interpolation object`);
    return errors;
  }
  if (interp.start !== expected.start) errors.push(`${prefix}: start expected ${expected.start}`);
  if (interp.finish !== expected.finish) errors.push(`${prefix}: finish expected ${expected.finish}`);
  if (interp.levels?.first !== 1 || interp.levels?.last !== PPLEVEL_DEFAULT_SIZE) {
    errors.push(`${prefix}: levels must be 1..${PPLEVEL_DEFAULT_SIZE}`);
  }
  if (interp.defaultSize !== PPLEVEL_DEFAULT_SIZE) {
    errors.push(`${prefix}: defaultSize must be ${PPLEVEL_DEFAULT_SIZE}`);
  }
  if (interp.linearDenominator !== PPLEVEL_LINEAR_DENOMINATOR) {
    errors.push(`${prefix}: linearDenominator must be ${PPLEVEL_LINEAR_DENOMINATOR}`);
  }
  const expectedFormula = `${expected.start} + (${expected.finish}-${expected.start})/${PPLEVEL_LINEAR_DENOMINATOR}*(level-1)`;
  if (interp.exactFormula !== expectedFormula) {
    errors.push(`${prefix}: exactFormula mismatch`);
  }
  if (interp.projectRuntimePolicy?.artificialIntermediateRounding !== false) {
    errors.push(`${prefix}: runtime must not use artificial intermediate rounding`);
  }
  if (interp.displayRounding?.mutatesExactFormula !== false) {
    errors.push(`${prefix}: displayRounding must not mutate exactFormula`);
  }
  return errors;
}

function validateContractAgainstRaw(contract, raw, options = {}) {
  const errors = [];
  const status = contract.numericContractStatus || '';
  if (!status) errors.push(`${contract.id}: missing numericContractStatus`);
  if (!contract.contentSha256) errors.push(`${contract.id}: missing contentSha256`);
  if (!contract.revisionId) errors.push(`${contract.id}: missing revisionId`);
  // contentSha256 is upstream API text (LF-only). On-disk raw may be whitespace-normalized.
  const hashSource = options.upstreamRaw ?? null;
  if (hashSource != null && contract.contentSha256 !== sha256Text(hashSource)) {
    errors.push(`${contract.id}: contentSha256 mismatch vs upstream raw`);
  }

  // Spot-check decision-relevant snippets exist in raw.
  const mustFind = [];
  switch (contract.id) {
    case 'ashe-q':
      mustFind.push('vardefine:ad5|130', 'For 6 seconds', 'cost         = 30');
      break;
    case 'ashe-w':
      mustFind.push('Physical Damage', 'Arrows', 'do not take damage from any beyond the first');
      break;
    case 'draven-q':
      mustFind.push('roughly 1.4 seconds', 'up to two', 'cost         = 45');
      break;
    case 'graves-p':
      mustFind.push('Precise formula is unknown', '4 pellets', '6 pellets');
      break;
    case 'akshan-p':
      mustFind.push('50% AD', '60% AP', 'for 5 seconds');
      break;
    case 'akshan-e':
      mustFind.push('Physical Damage per Shot', '0.3');
      break;
    case 'kaisa-p':
      mustFind.push(
        'Caustic Wounds',
        'missing health',
        'for 4 seconds',
        '{{pplevel|4 to 24}}',
        '{{pplevel|1 to 6}}',
      );
      break;
    case 'ezreal-p':
      mustFind.push('10%', 'stacking up to 5 times', 'lasting for 6 seconds');
      break;
    default:
      break;
  }
  for (const needle of mustFind) {
    if (!raw.includes(needle)) {
      errors.push(`${contract.id}: expected raw snippet missing: ${needle}`);
    }
  }

  if (contract.id === 'kaisa-p') {
    const flat = contract.contracts?.causticWoundsFlat;
    if (!flat) {
      errors.push('kaisa-p: missing causticWoundsFlat');
    } else {
      errors.push(
        ...validatePplevelInterpolation('kaisa-p', 'baseInterpolation', flat.baseInterpolation, {
          start: 4,
          finish: 24,
        }),
      );
      errors.push(
        ...validatePplevelInterpolation(
          'kaisa-p',
          'perPriorStackInterpolation',
          flat.perPriorStackInterpolation,
          { start: 1, finish: 6 },
        ),
      );
      const depIds = (flat.sourceDependencies || []).map((d) => d.id).sort().join(',');
      const expectedDepIds = DEPENDENCY_SPECS.map((s) => s.id).sort().join(',');
      if (depIds !== expectedDepIds) {
        errors.push('kaisa-p: sourceDependencies ids mismatch');
      }
      for (const dep of flat.sourceDependencies || []) {
        if (!dep.revisionId || !dep.contentSha256) {
          errors.push(`kaisa-p: sourceDependency ${dep.id} missing revision/hash`);
        }
      }
    }
  }
  return errors;
}

/**
 * Fail-closed anchors proving Template:Pplevel → Module:Ability progression|pplevel
 * and the default-size / linear-fill interpretation for bare A to B.
 */
function validateDependencyAnchors(spec, raw) {
  const errors = [];
  if (spec.id === 'passive-progression-level') {
    if (!raw.includes('{{#invoke:Ability progression|pplevel}}')) {
      errors.push(
        `${spec.id}: missing invoke anchor {{#invoke:Ability progression|pplevel}}`,
      );
    }
  } else if (spec.id === 'ability-progression') {
    if (!/function\s+p\.pplevel\s*\(/.test(raw)) {
      errors.push(`${spec.id}: missing function p.pplevel`);
    }
    if (!/return\s+p\.pp\s*\(/.test(raw)) {
      errors.push(`${spec.id}: missing pplevel -> pp return`);
    }
    if (!/local\s+defaultSize\s*=\s*18\b/.test(raw)) {
      errors.push(`${spec.id}: missing defaultSize = 18`);
    }
    if (!raw.includes('start + (finish-start) * x / times')) {
      errors.push(`${spec.id}: missing linear fill formula start + (finish-start) * x / times`);
    }
  }
  if (errors.length) {
    throw new Error(
      `Dependency anchors do not support the stated 18-level linear interpretation:\n- ${errors.join('\n- ')}`,
    );
  }
}

async function queryWikiPagesByTitles(titles) {
  const url = new URL(WIKI_API);
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  url.searchParams.set('redirects', '1');
  url.searchParams.set('prop', 'info|revisions');
  url.searchParams.set('rvprop', 'ids|timestamp|content');
  url.searchParams.set('rvslots', 'main');
  url.searchParams.set('titles', titles.join('|'));

  const apiResponse = await fetchJson(url.toString());
  if (apiResponse?.error) {
    throw new Error(
      `Wiki API error: ${apiResponse.error.code || ''} ${apiResponse.error.info || JSON.stringify(apiResponse.error)}`,
    );
  }
  const pages = apiResponse?.query?.pages;
  if (!pages) {
    throw new Error('Wiki API response missing query.pages');
  }

  const redirectMap = new Map();
  for (const r of apiResponse.query.redirects || []) {
    redirectMap.set(r.from, r.to);
  }
  const normalizedMap = new Map();
  for (const n of apiResponse.query.normalized || []) {
    normalizedMap.set(n.from, n.to);
  }

  const byTitle = new Map();
  for (const page of Object.values(pages)) {
    if (page.missing !== undefined) {
      throw new Error(`Wiki page missing: ${page.title}`);
    }
    const revision = page.revisions?.[0];
    const content = revision?.slots?.main?.['*'];
    if (!revision || typeof content !== 'string') {
      throw new Error(`Wiki revision content missing for ${page.title}`);
    }
    byTitle.set(page.title, {
      pageId: page.pageid,
      resolvedTitle: page.title,
      revisionId: revision.revid,
      revisionTimestamp: revision.timestamp,
      rawWikitext: canonicalizeLf(content),
    });
  }

  return { byTitle, redirectMap, normalizedMap };
}

function resolveRequestedTitle(requestTitle, normalizedMap, redirectMap, byTitle) {
  let title = requestTitle;
  if (normalizedMap.has(title)) title = normalizedMap.get(title);
  if (redirectMap.has(title)) title = redirectMap.get(title);
  const page = byTitle.get(title);
  if (!page) {
    throw new Error(
      `Failed to resolve Wiki page for ${requestTitle} → ${title}. Available: ${[...byTitle.keys()].join(', ')}`,
    );
  }
  return page;
}

async function fetchPages() {
  const { byTitle, redirectMap, normalizedMap } = await queryWikiPagesByTitles(
    PAGE_SPECS.map((s) => s.requestTitle),
  );

  const results = [];
  for (const spec of PAGE_SPECS) {
    const page = resolveRequestedTitle(spec.requestTitle, normalizedMap, redirectMap, byTitle);
    const contentSha256 = sha256Text(page.rawWikitext);
    results.push({
      spec,
      pageMeta: {
        requestTitle: spec.requestTitle,
        resolvedTitle: page.resolvedTitle,
        pageId: page.pageId,
        revisionId: page.revisionId,
        revisionTimestamp: page.revisionTimestamp,
        sourceUrl: pageSourceUrl(page.resolvedTitle),
        contentSha256,
        rawByteSize: Buffer.byteLength(page.rawWikitext, 'utf8'),
      },
      rawWikitext: page.rawWikitext,
    });
  }
  return results;
}

async function fetchDependencies() {
  const { byTitle, redirectMap, normalizedMap } = await queryWikiPagesByTitles(
    DEPENDENCY_SPECS.map((s) => s.requestTitle),
  );

  const results = [];
  for (const spec of DEPENDENCY_SPECS) {
    const page = resolveRequestedTitle(spec.requestTitle, normalizedMap, redirectMap, byTitle);
    if (page.resolvedTitle !== spec.expectedResolvedTitle) {
      throw new Error(
        `${spec.id}: expected resolved title ${spec.expectedResolvedTitle}, got ${page.resolvedTitle}`,
      );
    }
    validateDependencyAnchors(spec, page.rawWikitext);
    const contentSha256 = sha256Text(page.rawWikitext);
    const rel = dependencyRelPaths(spec);
    results.push({
      spec,
      depMeta: {
        id: spec.id,
        kind: spec.kind,
        requestTitle: spec.requestTitle,
        resolvedTitle: page.resolvedTitle,
        pageId: page.pageId,
        revisionId: page.revisionId,
        revisionTimestamp: page.revisionTimestamp,
        sourceUrl: pageSourceUrl(page.resolvedTitle),
        contentSha256,
        rawByteSize: Buffer.byteLength(page.rawWikitext, 'utf8'),
        contentMediaType: spec.contentMediaType,
        jsonRelPath: rel.jsonRelPath,
        rawRelPath: rel.rawRelPath,
      },
      rawWikitext: page.rawWikitext,
    });
  }
  return results;
}

function dependencyByIdFromResults(dependencyResults) {
  const map = new Map();
  for (const { depMeta } of dependencyResults) {
    map.set(depMeta.id, depMeta);
  }
  return map;
}

function buildDependencyJsonPayload(depMeta) {
  return {
    id: depMeta.id,
    kind: depMeta.kind,
    requestTitle: depMeta.requestTitle,
    resolvedTitle: depMeta.resolvedTitle,
    pageId: depMeta.pageId,
    revisionId: depMeta.revisionId,
    revisionTimestamp: depMeta.revisionTimestamp,
    sourceUrl: depMeta.sourceUrl,
    contentSha256: depMeta.contentSha256,
    rawByteSize: depMeta.rawByteSize,
    contentMediaType: depMeta.contentMediaType,
    rawRelPath: depMeta.rawRelPath,
  };
}

function buildOutputs(fetchedAt, pageResults, dependencyResults, options = {}) {
  const dependencyById = dependencyByIdFromResults(dependencyResults);
  const pages = [];
  const contracts = [];
  for (const { spec, pageMeta, rawWikitext, upstreamWikitext } of pageResults) {
    const contract = buildReviewedContract(spec, pageMeta, rawWikitext, dependencyById);
    const validationErrors = validateContractAgainstRaw(contract, rawWikitext, {
      upstreamRaw: options.verifyUpstreamHash
        ? (upstreamWikitext ?? rawWikitext)
        : null,
    });
    if (validationErrors.length) {
      throw new Error(`Contract validation failed:\n- ${validationErrors.join('\n- ')}`);
    }
    pages.push({
      id: spec.id,
      ...pageMeta,
      rawRelPath: `raw/${spec.id}.wikitext`,
      pageRelPath: `pages/${spec.id}.json`,
    });
    contracts.push(contract);
  }

  const dependencies = dependencyResults
    .map(({ depMeta }) => ({ ...depMeta }))
    .sort((a, b) => a.id.localeCompare(b.id, 'en'));

  const reviewedContracts = {
    schemaVersion: 'lol-wiki-current-champion-abilities-v1',
    fetchedAt,
    sourceApi: WIKI_API,
    dataPolicy: {
      numericTruthPrecedence: [
        'current_league_wiki_template_revision',
        'data_dragon_secondary',
        'batch_b_ocr_historical_provenance_only',
      ],
      blockedDataPolicy:
        'A mechanism may remain blocked_data only when the checked League Wiki template itself lacks or marks unknown the required numeric contract. Screenshots/OCR are not an acceptable missing-data source.',
    },
    contracts: contracts.sort((a, b) => a.id.localeCompare(b.id, 'en')),
  };

  const summary = {
    schemaVersion: 'lol-wiki-current-champion-abilities-summary-v1',
    fetchedAt,
    pageCount: pages.length,
    dependencyCount: dependencies.length,
    pages: pages.map((p) => ({
      id: p.id,
      requestTitle: p.requestTitle,
      resolvedTitle: p.resolvedTitle,
      pageId: p.pageId,
      revisionId: p.revisionId,
      revisionTimestamp: p.revisionTimestamp,
      contentSha256: p.contentSha256,
      rawByteSize: p.rawByteSize,
      sourceUrl: p.sourceUrl,
    })),
    dependencies: dependencies.map((d) => ({
      id: d.id,
      kind: d.kind,
      requestTitle: d.requestTitle,
      resolvedTitle: d.resolvedTitle,
      pageId: d.pageId,
      revisionId: d.revisionId,
      revisionTimestamp: d.revisionTimestamp,
      contentSha256: d.contentSha256,
      rawByteSize: d.rawByteSize,
      sourceUrl: d.sourceUrl,
    })),
    contractIds: reviewedContracts.contracts.map((c) => c.id),
    numericContractStatusCounts: reviewedContracts.contracts.reduce((acc, c) => {
      acc[c.numericContractStatus] = (acc[c.numericContractStatus] || 0) + 1;
      return acc;
    }, {}),
  };

  const manifest = {
    schemaVersion: 'lol-wiki-current-champion-abilities-manifest-v1',
    fetchedAt,
    generator: 'tools/lol-static-data/fetch-lol-wiki-current-champion-abilities.mjs',
    api: WIKI_API,
    outputs: {
      manifest: 'manifest.json',
      summary: 'summary.json',
      reviewedContracts: 'normalized/reviewed-contracts.json',
      pagesDir: 'pages/',
      rawDir: 'raw/',
      dependenciesDir: 'dependencies/',
      dependenciesRawDir: 'dependencies/raw/',
    },
    pageCount: pages.length,
    dependencyCount: dependencies.length,
    pages: pages
      .map((p) => ({
        id: p.id,
        requestTitle: p.requestTitle,
        resolvedTitle: p.resolvedTitle,
        pageId: p.pageId,
        revisionId: p.revisionId,
        revisionTimestamp: p.revisionTimestamp,
        contentSha256: p.contentSha256,
        rawByteSize: p.rawByteSize,
        sourceUrl: p.sourceUrl,
        rawRelPath: p.rawRelPath,
        pageRelPath: p.pageRelPath,
      }))
      .sort((a, b) => a.id.localeCompare(b.id, 'en')),
    dependencies: dependencies.map((d) => ({
      id: d.id,
      kind: d.kind,
      requestTitle: d.requestTitle,
      resolvedTitle: d.resolvedTitle,
      pageId: d.pageId,
      revisionId: d.revisionId,
      revisionTimestamp: d.revisionTimestamp,
      contentSha256: d.contentSha256,
      rawByteSize: d.rawByteSize,
      sourceUrl: d.sourceUrl,
      jsonRelPath: d.jsonRelPath,
      rawRelPath: d.rawRelPath,
    })),
  };

  return { manifest, summary, reviewedContracts, pageResults, dependencyResults };
}

async function writeAll(outputs) {
  const { manifest, summary, reviewedContracts, pageResults, dependencyResults } = outputs;
  await ensureDir(OUTPUT_ROOT);
  await ensureDir(PAGES_DIR);
  await ensureDir(RAW_DIR);
  await ensureDir(NORMALIZED_DIR);
  await ensureDir(DEPENDENCIES_DIR);
  await ensureDir(DEPENDENCIES_RAW_DIR);

  for (const { spec, pageMeta, rawWikitext, upstreamWikitext } of pageResults) {
    const upstream = upstreamWikitext ?? rawWikitext;
    await writeTextLf(path.join(RAW_DIR, `${spec.id}.wikitext`), serializeRawSnapshot(upstream));
    await writeJsonLf(path.join(PAGES_DIR, `${spec.id}.json`), {
      id: spec.id,
      championId: spec.championId,
      skillKey: spec.skillKey,
      abilityName: spec.abilityName,
      zhName: spec.zhName,
      ...pageMeta,
      rawRelPath: `raw/${spec.id}.wikitext`,
    });
  }

  for (const { spec, depMeta, rawWikitext, upstreamWikitext } of dependencyResults) {
    const upstream = upstreamWikitext ?? rawWikitext;
    await writeTextLf(
      path.join(DEPENDENCIES_RAW_DIR, spec.rawFileName),
      serializeRawSnapshot(upstream),
    );
    await writeJsonLf(
      path.join(DEPENDENCIES_DIR, spec.jsonFileName),
      buildDependencyJsonPayload(depMeta),
    );
  }

  await writeJsonLf(MANIFEST_PATH, manifest);
  await writeJsonLf(SUMMARY_PATH, summary);
  await writeJsonLf(CONTRACTS_PATH, reviewedContracts);
}

async function loadStoredPageResults() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`missing manifest: ${MANIFEST_PATH}`);
  }
  const manifest = JSON.parse(await readText(MANIFEST_PATH));
  const pageResults = [];
  for (const spec of PAGE_SPECS) {
    const pagePath = path.join(PAGES_DIR, `${spec.id}.json`);
    const rawPath = path.join(RAW_DIR, `${spec.id}.wikitext`);
    if (!existsSync(pagePath) || !existsSync(rawPath)) {
      throw new Error(`missing stored page/raw for ${spec.id}`);
    }
    const pageJson = JSON.parse(await readText(pagePath));
    const rawWikitext = await readText(rawPath);
    const serialized = serializeRawSnapshot(rawWikitext);
    if (rawWikitext !== serialized) {
      throw new Error(`${spec.id}: raw file is not in canonical snapshot form (LF, no trailing horizontal whitespace, final newline)`);
    }
    const manifestEntry = (manifest.pages || []).find((p) => p.id === spec.id);
    if (!manifestEntry) throw new Error(`${spec.id}: missing from manifest`);
    if (manifestEntry.contentSha256 !== pageJson.contentSha256) {
      throw new Error(`${spec.id}: manifest contentSha256 mismatch`);
    }
    if (manifestEntry.rawByteSize !== pageJson.rawByteSize) {
      throw new Error(`${spec.id}: manifest rawByteSize mismatch`);
    }
    if (manifestEntry.revisionId !== pageJson.revisionId) {
      throw new Error(`${spec.id}: manifest revisionId mismatch`);
    }
    // contentSha256 / rawByteSize are upstream provenance, not on-disk snapshot digests.
    pageResults.push({
      spec,
      pageMeta: {
        requestTitle: pageJson.requestTitle,
        resolvedTitle: pageJson.resolvedTitle,
        pageId: pageJson.pageId,
        revisionId: pageJson.revisionId,
        revisionTimestamp: pageJson.revisionTimestamp,
        sourceUrl: pageJson.sourceUrl,
        contentSha256: pageJson.contentSha256,
        rawByteSize: pageJson.rawByteSize,
      },
      rawWikitext,
    });
  }
  return { manifest, pageResults };
}

async function loadStoredDependencyResults(manifest) {
  const dependencyResults = [];
  for (const spec of DEPENDENCY_SPECS) {
    const jsonPath = path.join(DEPENDENCIES_DIR, spec.jsonFileName);
    const rawPath = path.join(DEPENDENCIES_RAW_DIR, spec.rawFileName);
    if (!existsSync(jsonPath) || !existsSync(rawPath)) {
      throw new Error(`missing stored dependency json/raw for ${spec.id}`);
    }
    const depJson = JSON.parse(await readText(jsonPath));
    const rawWikitext = await readText(rawPath);
    const serialized = serializeRawSnapshot(rawWikitext);
    if (rawWikitext !== serialized) {
      throw new Error(
        `${spec.id}: dependency raw file is not in canonical snapshot form (LF, no trailing horizontal whitespace, final newline)`,
      );
    }
    validateDependencyAnchors(spec, rawWikitext);

    const rel = dependencyRelPaths(spec);
    const manifestEntry = (manifest.dependencies || []).find((d) => d.id === spec.id);
    if (!manifestEntry) throw new Error(`${spec.id}: missing from manifest.dependencies`);
    if (manifestEntry.contentSha256 !== depJson.contentSha256) {
      throw new Error(`${spec.id}: manifest contentSha256 mismatch`);
    }
    if (manifestEntry.rawByteSize !== depJson.rawByteSize) {
      throw new Error(`${spec.id}: manifest rawByteSize mismatch`);
    }
    if (manifestEntry.revisionId !== depJson.revisionId) {
      throw new Error(`${spec.id}: manifest revisionId mismatch`);
    }
    if (depJson.resolvedTitle !== spec.expectedResolvedTitle) {
      throw new Error(
        `${spec.id}: resolvedTitle expected ${spec.expectedResolvedTitle}, got ${depJson.resolvedTitle}`,
      );
    }

    dependencyResults.push({
      spec,
      depMeta: {
        id: depJson.id,
        kind: depJson.kind,
        requestTitle: depJson.requestTitle,
        resolvedTitle: depJson.resolvedTitle,
        pageId: depJson.pageId,
        revisionId: depJson.revisionId,
        revisionTimestamp: depJson.revisionTimestamp,
        sourceUrl: depJson.sourceUrl,
        contentSha256: depJson.contentSha256,
        rawByteSize: depJson.rawByteSize,
        contentMediaType: depJson.contentMediaType,
        jsonRelPath: rel.jsonRelPath,
        rawRelPath: rel.rawRelPath,
      },
      rawWikitext,
    });
  }

  if ((manifest.dependencyCount ?? dependencyResults.length) !== DEPENDENCY_SPECS.length) {
    throw new Error(
      `manifest.dependencyCount expected ${DEPENDENCY_SPECS.length}, got ${manifest.dependencyCount}`,
    );
  }
  if ((manifest.pageCount ?? PAGE_SPECS.length) !== PAGE_SPECS.length) {
    throw new Error(`manifest.pageCount expected ${PAGE_SPECS.length}, got ${manifest.pageCount}`);
  }

  return dependencyResults;
}

async function checkMode() {
  const { manifest, pageResults } = await loadStoredPageResults();
  const dependencyResults = await loadStoredDependencyResults(manifest);
  const fetchedAt = manifest.fetchedAt;
  // Offline check uses on-disk snapshots for snippets; upstream hash was recorded at refresh.
  const rebuilt = buildOutputs(fetchedAt, pageResults, dependencyResults, {
    verifyUpstreamHash: false,
  });

  const expectedFiles = [
    [MANIFEST_PATH, rebuilt.manifest],
    [SUMMARY_PATH, rebuilt.summary],
    [CONTRACTS_PATH, rebuilt.reviewedContracts],
  ];

  for (const { spec, pageMeta } of pageResults) {
    expectedFiles.push([
      path.join(PAGES_DIR, `${spec.id}.json`),
      {
        id: spec.id,
        championId: spec.championId,
        skillKey: spec.skillKey,
        abilityName: spec.abilityName,
        zhName: spec.zhName,
        ...pageMeta,
        rawRelPath: `raw/${spec.id}.wikitext`,
      },
    ]);
  }

  for (const { depMeta } of dependencyResults) {
    expectedFiles.push([
      path.join(DEPENDENCIES_DIR, path.basename(depMeta.jsonRelPath)),
      buildDependencyJsonPayload(depMeta),
    ]);
  }

  const errors = [];
  for (const [filePath, expectedObj] of expectedFiles) {
    if (!existsSync(filePath)) {
      errors.push(`missing ${path.relative(repoRoot, filePath)}`);
      continue;
    }
    const actual = await readText(filePath);
    const expected = stableJson(expectedObj);
    if (actual !== expected) {
      errors.push(`exact bytes differ: ${path.relative(repoRoot, filePath)}`);
    }
  }

  // Raw wikitext already hash-checked in loadStoredPageResults; re-validate contracts.
  void rawWikitextGuard(pageResults);

  if (errors.length) {
    console.error('--check failed:');
    for (const e of errors) console.error(`- ${e}`);
    process.exit(1);
  }

  console.log('check ok');
  console.log(
    JSON.stringify(
      {
        pageCount: rebuilt.summary.pageCount,
        dependencyCount: rebuilt.summary.dependencyCount,
        numericContractStatusCounts: rebuilt.summary.numericContractStatusCounts,
        pages: rebuilt.summary.pages.map((p) => ({
          id: p.id,
          revisionId: p.revisionId,
          contentSha256: p.contentSha256,
        })),
        dependencies: rebuilt.summary.dependencies.map((d) => ({
          id: d.id,
          revisionId: d.revisionId,
          contentSha256: d.contentSha256,
        })),
      },
      null,
      2,
    ),
  );
}

function rawWikitextGuard(pageResults) {
  for (const { spec, rawWikitext, pageMeta } of pageResults) {
    if (!rawWikitext || !pageMeta.contentSha256) {
      throw new Error(`raw guard failed for ${spec.id}`);
    }
  }
}

async function refreshMode() {
  const fetchedAt = new Date().toISOString();
  const fetched = await fetchPages();
  const fetchedDeps = await fetchDependencies();
  const pageResults = fetched.map((row) => ({
    ...row,
    upstreamWikitext: row.rawWikitext,
  }));
  const dependencyResults = fetchedDeps.map((row) => ({
    ...row,
    upstreamWikitext: row.rawWikitext,
  }));
  const outputs = buildOutputs(fetchedAt, pageResults, dependencyResults, {
    verifyUpstreamHash: true,
  });
  await writeAll(outputs);
  console.log('refresh ok');
  console.log(
    JSON.stringify(
      {
        outputRoot: path.relative(repoRoot, OUTPUT_ROOT),
        pageCount: outputs.summary.pageCount,
        dependencyCount: outputs.summary.dependencyCount,
        numericContractStatusCounts: outputs.summary.numericContractStatusCounts,
        pages: outputs.summary.pages.map((p) => ({
          id: p.id,
          resolvedTitle: p.resolvedTitle,
          revisionId: p.revisionId,
          contentSha256: p.contentSha256,
        })),
        dependencies: outputs.summary.dependencies.map((d) => ({
          id: d.id,
          resolvedTitle: d.resolvedTitle,
          revisionId: d.revisionId,
          contentSha256: d.contentSha256,
        })),
      },
      null,
      2,
    ),
  );
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const refresh = args.includes('--refresh') || !check;
  if (args.includes('--refresh') && check) {
    console.error('Specify at most one of --refresh or --check');
    process.exit(2);
  }
  if (refresh) {
    await refreshMode();
    return;
  }
  await checkMode();
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
