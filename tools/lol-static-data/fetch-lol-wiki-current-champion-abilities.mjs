/**
 * Fetch / check current League Wiki champion ability templates.
 *
 * Routing source (identity only, never regenerated here):
 *   数据参考/lol-wiki-current-champions/identity-manifest.json
 *
 * Modes:
 *   --refresh  ONLY network-writing mode: fetch all identity-manifest entries + DEPENDENCY_SPECS
 *   --check    fully offline validation; must NOT fetch or write
 *   (default)  exits with usage; explicit --refresh required (breaking change from old default)
 *
 * Provenance:
 *   contentSha256 / rawByteSize hash upstream API wikitext after LF canonicalization only.
 *   On-disk raw/*.wikitext additionally strip trailing spaces/tabs per line and end with one newline.
 *   Those file-output whitespace normalizations must not change contentSha256.
 *
 * Output layout:
 *   raw/{pageId}.wikitext
 *   pages/{pageId}.json
 *   normalized/generic/{pageId}.json
 *   normalized/reviewed-contracts.json  (8 reviewed pages only)
 *
 * Dependencies (separate from champion ability pages):
 *   Template:Pplevel → Template:Passive progression level
 *   Module:Ability progression
 *
 * Usage:
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
const USER_AGENT = 'damage-wasm-dev/lol-wiki-current-champions/2.0';
const WIKI_BATCH_SIZE = 45;

const OUTPUT_ROOT = path.join(repoRoot, '数据参考', 'lol-wiki-current-champions');
const PAGES_DIR = path.join(OUTPUT_ROOT, 'pages');
const RAW_DIR = path.join(OUTPUT_ROOT, 'raw');
const NORMALIZED_DIR = path.join(OUTPUT_ROOT, 'normalized');
const GENERIC_DIR = path.join(NORMALIZED_DIR, 'generic');
const DEPENDENCIES_DIR = path.join(OUTPUT_ROOT, 'dependencies');
const DEPENDENCIES_RAW_DIR = path.join(DEPENDENCIES_DIR, 'raw');

const IDENTITY_MANIFEST_PATH = path.join(OUTPUT_ROOT, 'identity-manifest.json');
const MANIFEST_PATH = path.join(OUTPUT_ROOT, 'manifest.json');
const SUMMARY_PATH = path.join(OUTPUT_ROOT, 'summary.json');
const CONTRACTS_PATH = path.join(NORMALIZED_DIR, 'reviewed-contracts.json');

/** pageId values with hand-reviewed numeric extractors; mapped from old PAGE_SPECS. */
const REVIEWED_PAGE_IDS = new Set([
  'ashe-q',
  'ashe-w',
  'draven-q',
  'graves-p',
  'akshan-p',
  'akshan-e',
  'kaisa-p',
  'ezreal-p',
]);

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

const TRACKED_FIELD_PATTERNS = [
  /^description\d*$/i,
  /^leveling\d*$/i,
  /^cooldown$/i,
  /^cost$/i,
  /^costtype$/i,
  /^damagetype$/i,
  /^notes$/i,
];

const DATA_POLICY = {
  numericTruthPrecedence: ['current_league_wiki_template_revision'],
  ddragonProvenanceOnly: true,
  blockedDataPolicy:
    'DDragon is provenance at most, NEVER current numeric truth. A mechanism may remain blocked_data only when the checked League Wiki template itself lacks or marks unknown the required numeric contract.',
};

function sha256Text(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function canonicalizeLf(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

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

function deriveAbilityName(resolvedTitle) {
  const m = String(resolvedTitle).match(/^Template:Data [^/]+\/(.+)$/);
  return m ? m[1] : resolvedTitle;
}

function entryToSpec(entry, resolvedTitle) {
  return {
    id: entry.pageId,
    championId: entry.wikiChampionTitle,
    skillKey: entry.skillKey,
    abilityName: deriveAbilityName(resolvedTitle),
    zhName: entry.zhDisplayName,
    requestTitle: entry.requestTitle,
  };
}

function validateIdentityManifest(identityManifest, { rejectDuplicates = false } = {}) {
  const errors = [];
  const entries = identityManifest.entries || [];
  if (identityManifest.entryCount !== entries.length) {
    errors.push(
      `identity-manifest entryCount ${identityManifest.entryCount} != entries.length ${entries.length}`,
    );
  }
  const keys = new Set();
  const titles = new Set();
  const required = [
    'candidateKey',
    'ownerId',
    'wikiChampionTitle',
    'skillKey',
    'requestTitle',
    'zhDisplayName',
    'pageId',
  ];
  for (const entry of entries) {
    for (const field of required) {
      if (entry[field] == null || entry[field] === '') {
        errors.push(`${entry.pageId || entry.candidateKey || '?'}: missing ${field}`);
      }
    }
    if (keys.has(entry.candidateKey)) {
      errors.push(`duplicate candidateKey: ${entry.candidateKey}`);
    }
    if (titles.has(entry.requestTitle)) {
      errors.push(`duplicate requestTitle: ${entry.requestTitle} (${entry.candidateKey})`);
    }
    keys.add(entry.candidateKey);
    titles.add(entry.requestTitle);
  }
  const sorted = [...entries].sort((a, b) => a.candidateKey.localeCompare(b.candidateKey, 'en'));
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].candidateKey !== sorted[i].candidateKey) {
      errors.push('identity-manifest entries are not sorted by candidateKey');
      break;
    }
  }
  if (rejectDuplicates && errors.length) {
    throw new Error(`identity-manifest validation failed:\n- ${errors.join('\n- ')}`);
  }
  return errors;
}

async function loadIdentityManifest(options = {}) {
  if (!existsSync(IDENTITY_MANIFEST_PATH)) {
    throw new Error(`missing identity manifest: ${IDENTITY_MANIFEST_PATH}`);
  }
  const identityManifest = JSON.parse(await readText(IDENTITY_MANIFEST_PATH));
  validateIdentityManifest(identityManifest, options);
  return identityManifest;
}

function scanDepthAt(text, start, end) {
  let templateDepth = 0;
  let bracketDepth = 0;
  for (let i = start; i < end; i++) {
    const two = text.slice(i, i + 2);
    if (two === '{{') {
      templateDepth++;
      i++;
      continue;
    }
    if (two === '}}') {
      templateDepth--;
      i++;
      continue;
    }
    if (two === '[[') {
      bracketDepth++;
      i++;
      continue;
    }
    if (two === ']]') {
      bracketDepth--;
      i++;
      continue;
    }
  }
  return { templateDepth, bracketDepth };
}

function findFirstAbilityFieldIndex(raw) {
  const re = /\|(?:champion|skill|description)\d*\s*=/i;
  const m = re.exec(raw);
  return m ? m.index : -1;
}

function findMainTemplateContentStart(raw) {
  const fieldIdx = findFirstAbilityFieldIndex(raw);
  if (fieldIdx < 0) return 0;

  let pos = fieldIdx;
  while (pos > 0) {
    const open = raw.lastIndexOf('{{', pos - 1);
    if (open < 0) break;
    const { templateDepth, bracketDepth } = scanDepthAt(raw, open + 2, fieldIdx);
    if (templateDepth === 1 && bracketDepth === 0) {
      return open + 2;
    }
    pos = open;
  }
  return fieldIdx;
}

function findMainTemplateContentEnd(raw, contentStart) {
  const anchorDepth = scanDepthAt(raw, 0, contentStart);
  let templateDepth = anchorDepth.templateDepth;
  let bracketDepth = anchorDepth.bracketDepth;
  for (let i = contentStart; i < raw.length; i++) {
    const two = raw.slice(i, i + 2);
    if (two === '{{') {
      templateDepth++;
      i++;
      continue;
    }
    if (two === '}}') {
      if (templateDepth === 0) return i;
      templateDepth--;
      i++;
      continue;
    }
    if (two === '[[') {
      bracketDepth++;
      i++;
      continue;
    }
    if (two === ']]') {
      bracketDepth--;
      i++;
      continue;
    }
  }
  return raw.length;
}

/**
 * Parse top-level |field = values from the main ability-data template body.
 * Handles nested {{...}} and [[...]] without flattening values.
 */
function parseTopLevelTemplateFields(raw) {
  const contentStart = findMainTemplateContentStart(raw);
  const contentEnd = findMainTemplateContentEnd(raw, contentStart);
  const body = raw.slice(contentStart, contentEnd);

  const anchorDepth = scanDepthAt(raw, 0, contentStart);
  const fields = {};
  let templateDepth = anchorDepth.templateDepth;
  let bracketDepth = anchorDepth.bracketDepth;
  let currentField = null;
  let valueStart = -1;

  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === '{{') {
      templateDepth++;
      i++;
      continue;
    }
    if (two === '}}') {
      templateDepth--;
      i++;
      continue;
    }
    if (two === '[[') {
      bracketDepth++;
      i++;
      continue;
    }
    if (two === ']]') {
      bracketDepth--;
      i++;
      continue;
    }

    if (
      templateDepth === anchorDepth.templateDepth &&
      bracketDepth === anchorDepth.bracketDepth &&
      body[i] === '|'
    ) {
      const rest = body.slice(i);
      const named = rest.match(/^\|([^=\|\[{}\n]+?)\s*=\s*/);
      if (named) {
        if (currentField != null) {
          fields[currentField] = body.slice(valueStart, i);
        }
        currentField = named[1].trim();
        valueStart = i + named[0].length;
        i = valueStart - 1;
        continue;
      }
    }
  }

  if (currentField != null && valueStart >= 0) {
    fields[currentField] = body.slice(valueStart);
  }

  return fields;
}

function isTrackedFieldName(name) {
  return TRACKED_FIELD_PATTERNS.some((re) => re.test(name));
}

function buildGenericNormalized(entry, pageMeta, raw) {
  const parsedFields = parseTopLevelTemplateFields(raw);
  const fields = {};
  const fieldPresence = {};

  for (const [name, value] of Object.entries(parsedFields)) {
    if (isTrackedFieldName(name)) {
      fields[name] = value;
      fieldPresence[name] = true;
    }
  }

  for (const pattern of TRACKED_FIELD_PATTERNS) {
    if (pattern.source.startsWith('^description') || pattern.source.startsWith('^leveling')) {
      continue;
    }
    const canonical = pattern.source.replace(/^\^|\$$/g, '').replace(/\\s\*$/, '').replace(/\\d\*/g, '');
    const found = Object.keys(parsedFields).find((k) => k.toLowerCase() === canonical.toLowerCase());
    if (found) {
      if (!(found in fields)) fields[found] = parsedFields[found];
      fieldPresence[found] = true;
    } else if (!Object.keys(fieldPresence).some((k) => k.toLowerCase() === canonical.toLowerCase())) {
      fieldPresence[canonical.toLowerCase()] = false;
    }
  }

  const hasReviewed = REVIEWED_PAGE_IDS.has(entry.pageId);

  return {
    schemaVersion: 'lol-wiki-ability-generic-v1',
    pageId: entry.pageId,
    candidateKey: entry.candidateKey,
    ownerId: entry.ownerId,
    wikiChampionTitle: entry.wikiChampionTitle,
    skillKey: entry.skillKey,
    requestTitle: entry.requestTitle,
    zhDisplayName: entry.zhDisplayName,
    resolvedTitle: pageMeta.resolvedTitle,
    wikiPageId: pageMeta.pageId,
    revisionId: pageMeta.revisionId,
    revisionTimestamp: pageMeta.revisionTimestamp,
    sourceUrl: pageMeta.sourceUrl,
    contentSha256: pageMeta.contentSha256,
    rawByteSize: pageMeta.rawByteSize,
    fields,
    fieldPresence,
    numericContractStatus: hasReviewed ? 'reviewed_contract_separate' : 'generic_source_fields_only',
    dataPolicy: DATA_POLICY,
  };
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
      precedence: ['current_league_wiki_template_revision'],
      ddragonProvenanceOnly: true,
      blockedDataOnlyWhen:
        'checked_league_wiki_template_lacks_or_marks_unknown_required_numeric_contract',
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
  const hashSource = options.upstreamRaw ?? null;
  if (hashSource != null && contract.contentSha256 !== sha256Text(hashSource)) {
    errors.push(`${contract.id}: contentSha256 mismatch vs upstream raw`);
  }

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
      errors.push(
        `${contract.id}: Wiki revision changed reviewed contract — expected raw snippet missing: ${needle}`,
      );
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
      throw new Error(`Wiki page missing: ${page.title} (request batch titles: ${titles.join(', ')})`);
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

async function fetchIdentityPages(entries) {
  const results = [];
  for (let i = 0; i < entries.length; i += WIKI_BATCH_SIZE) {
    const batch = entries.slice(i, i + WIKI_BATCH_SIZE);
    const { byTitle, redirectMap, normalizedMap } = await queryWikiPagesByTitles(
      batch.map((e) => e.requestTitle),
    );
    for (const entry of batch) {
      const page = resolveRequestedTitle(entry.requestTitle, normalizedMap, redirectMap, byTitle);
      const contentSha256 = sha256Text(page.rawWikitext);
      results.push({
        entry,
        pageMeta: {
          requestTitle: entry.requestTitle,
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

function buildPageJsonPayload(entry, pageMeta) {
  return {
    id: entry.pageId,
    candidateKey: entry.candidateKey,
    ownerId: entry.ownerId,
    wikiChampionTitle: entry.wikiChampionTitle,
    skillKey: entry.skillKey,
    requestTitle: entry.requestTitle,
    zhDisplayName: entry.zhDisplayName,
    resolvedTitle: pageMeta.resolvedTitle,
    pageId: pageMeta.pageId,
    revisionId: pageMeta.revisionId,
    revisionTimestamp: pageMeta.revisionTimestamp,
    sourceUrl: pageMeta.sourceUrl,
    contentSha256: pageMeta.contentSha256,
    rawByteSize: pageMeta.rawByteSize,
    rawRelPath: `raw/${entry.pageId}.wikitext`,
    genericRelPath: `normalized/generic/${entry.pageId}.json`,
  };
}

function buildOutputs(fetchedAt, identityEntries, pageResults, dependencyResults, options = {}) {
  const dependencyById = dependencyByIdFromResults(dependencyResults);
  const pages = [];
  const contracts = [];
  const genericRecords = [];

  for (const { entry, pageMeta, rawWikitext, upstreamWikitext } of pageResults) {
    const generic = buildGenericNormalized(entry, pageMeta, rawWikitext);
    genericRecords.push({ entry, generic });

    if (REVIEWED_PAGE_IDS.has(entry.pageId)) {
      const spec = entryToSpec(entry, pageMeta.resolvedTitle);
      const contract = buildReviewedContract(spec, pageMeta, rawWikitext, dependencyById);
      const validationErrors = validateContractAgainstRaw(contract, rawWikitext, {
        upstreamRaw: options.verifyUpstreamHash ? (upstreamWikitext ?? rawWikitext) : null,
      });
      if (validationErrors.length) {
        throw new Error(
          `Reviewed contract validation failed for ${entry.pageId} — STOP, do not invent numbers:\n- ${validationErrors.join('\n- ')}`,
        );
      }
      contracts.push(contract);
    }

    pages.push({
      id: entry.pageId,
      candidateKey: entry.candidateKey,
      ownerId: entry.ownerId,
      wikiChampionTitle: entry.wikiChampionTitle,
      skillKey: entry.skillKey,
      requestTitle: pageMeta.requestTitle,
      resolvedTitle: pageMeta.resolvedTitle,
      pageId: pageMeta.pageId,
      revisionId: pageMeta.revisionId,
      revisionTimestamp: pageMeta.revisionTimestamp,
      contentSha256: pageMeta.contentSha256,
      rawByteSize: pageMeta.rawByteSize,
      sourceUrl: pageMeta.sourceUrl,
      rawRelPath: `raw/${entry.pageId}.wikitext`,
      pageRelPath: `pages/${entry.pageId}.json`,
      genericRelPath: `normalized/generic/${entry.pageId}.json`,
    });
  }

  if (pageResults.length !== identityEntries.length) {
    throw new Error(
      `pageResults.length ${pageResults.length} != identityEntries.length ${identityEntries.length}`,
    );
  }

  const dependencies = dependencyResults
    .map(({ depMeta }) => ({ ...depMeta }))
    .sort((a, b) => a.id.localeCompare(b.id, 'en'));

  const reviewedContracts = {
    schemaVersion: 'lol-wiki-current-champion-abilities-v2',
    fetchedAt,
    sourceApi: WIKI_API,
    dataPolicy: DATA_POLICY,
    contracts: contracts.sort((a, b) => a.id.localeCompare(b.id, 'en')),
  };

  const summary = {
    schemaVersion: 'lol-wiki-current-champion-abilities-summary-v2',
    fetchedAt,
    identityEntryCount: identityEntries.length,
    pageCount: pages.length,
    reviewedContractCount: contracts.length,
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
    })),
    reviewedContractIds: reviewedContracts.contracts.map((c) => c.id),
    numericContractStatusCounts: reviewedContracts.contracts.reduce((acc, c) => {
      acc[c.numericContractStatus] = (acc[c.numericContractStatus] || 0) + 1;
      return acc;
    }, {}),
  };

  const manifest = {
    schemaVersion: 'lol-wiki-current-champion-abilities-manifest-v2',
    fetchedAt,
    generator: 'tools/lol-static-data/fetch-lol-wiki-current-champion-abilities.mjs',
    api: WIKI_API,
    identityManifest: 'identity-manifest.json',
    identityEntryCount: identityEntries.length,
    outputs: {
      identityManifest: 'identity-manifest.json',
      manifest: 'manifest.json',
      summary: 'summary.json',
      reviewedContracts: 'normalized/reviewed-contracts.json',
      genericDir: 'normalized/generic/',
      pagesDir: 'pages/',
      rawDir: 'raw/',
      dependenciesDir: 'dependencies/',
      dependenciesRawDir: 'dependencies/raw/',
    },
    pageCount: pages.length,
    reviewedContractCount: contracts.length,
    dependencyCount: dependencies.length,
    pages: pages
      .map((p) => ({
        id: p.id,
        candidateKey: p.candidateKey,
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
        genericRelPath: p.genericRelPath,
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

  return { manifest, summary, reviewedContracts, genericRecords, pageResults, dependencyResults };
}

async function writeAll(outputs) {
  const { manifest, summary, reviewedContracts, genericRecords, pageResults, dependencyResults } =
    outputs;
  await ensureDir(OUTPUT_ROOT);
  await ensureDir(PAGES_DIR);
  await ensureDir(RAW_DIR);
  await ensureDir(NORMALIZED_DIR);
  await ensureDir(GENERIC_DIR);
  await ensureDir(DEPENDENCIES_DIR);
  await ensureDir(DEPENDENCIES_RAW_DIR);

  for (const { entry, pageMeta, rawWikitext, upstreamWikitext } of pageResults) {
    const upstream = upstreamWikitext ?? rawWikitext;
    await writeTextLf(path.join(RAW_DIR, `${entry.pageId}.wikitext`), serializeRawSnapshot(upstream));
    await writeJsonLf(path.join(PAGES_DIR, `${entry.pageId}.json`), buildPageJsonPayload(entry, pageMeta));
  }

  for (const { entry, generic } of genericRecords) {
    await writeJsonLf(path.join(GENERIC_DIR, `${entry.pageId}.json`), generic);
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

async function loadStoredPageResults(identityEntries, manifest) {
  const manifestById = new Map((manifest.pages || []).map((p) => [p.id, p]));
  const pageResults = [];

  for (const entry of identityEntries) {
    const manifestEntry = manifestById.get(entry.pageId);
    if (!manifestEntry) {
      throw new Error(`${entry.pageId}: in identity-manifest but missing from manifest.pages`);
    }
    const pagePath = path.join(PAGES_DIR, `${entry.pageId}.json`);
    const rawPath = path.join(RAW_DIR, `${entry.pageId}.wikitext`);
    const genericPath = path.join(GENERIC_DIR, `${entry.pageId}.json`);
    if (!existsSync(pagePath) || !existsSync(rawPath) || !existsSync(genericPath)) {
      throw new Error(`missing stored page/raw/generic for ${entry.pageId}`);
    }
    const pageJson = JSON.parse(await readText(pagePath));
    const rawWikitext = await readText(rawPath);
    const serialized = serializeRawSnapshot(rawWikitext);
    if (rawWikitext !== serialized) {
      throw new Error(
        `${entry.pageId}: raw file is not in canonical snapshot form (LF, no trailing horizontal whitespace, final newline)`,
      );
    }
    if (manifestEntry.contentSha256 !== pageJson.contentSha256) {
      throw new Error(`${entry.pageId}: manifest contentSha256 mismatch vs page json`);
    }
    if (manifestEntry.rawByteSize !== pageJson.rawByteSize) {
      throw new Error(`${entry.pageId}: manifest rawByteSize mismatch vs page json`);
    }
    if (manifestEntry.revisionId !== pageJson.revisionId) {
      throw new Error(`${entry.pageId}: manifest revisionId mismatch vs page json`);
    }
    if (manifestEntry.revisionTimestamp !== pageJson.revisionTimestamp) {
      throw new Error(`${entry.pageId}: manifest revisionTimestamp mismatch vs page json`);
    }
    pageResults.push({
      entry,
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

  return pageResults;
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

  return dependencyResults;
}

async function checkMode() {
  const identityManifest = await loadIdentityManifest({ rejectDuplicates: true });
  const identityEntries = identityManifest.entries;
  const identityErrors = validateIdentityManifest(identityManifest);
  if (identityErrors.length) {
    throw new Error(`identity-manifest invalid:\n- ${identityErrors.join('\n- ')}`);
  }

  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`missing manifest: ${MANIFEST_PATH}`);
  }
  const manifest = JSON.parse(await readText(MANIFEST_PATH));
  if (manifest.identityEntryCount !== identityEntries.length) {
    throw new Error(
      `manifest.identityEntryCount ${manifest.identityEntryCount} != identity entries ${identityEntries.length}`,
    );
  }
  if (manifest.pageCount !== identityEntries.length) {
    throw new Error(`manifest.pageCount ${manifest.pageCount} != identity entries ${identityEntries.length}`);
  }

  const pageResults = await loadStoredPageResults(identityEntries, manifest);
  const dependencyResults = await loadStoredDependencyResults(manifest);
  const fetchedAt = manifest.fetchedAt;
  const rebuilt = buildOutputs(fetchedAt, identityEntries, pageResults, dependencyResults, {
    verifyUpstreamHash: false,
  });

  const expectedFiles = [
    [MANIFEST_PATH, rebuilt.manifest],
    [SUMMARY_PATH, rebuilt.summary],
    [CONTRACTS_PATH, rebuilt.reviewedContracts],
  ];

  for (const { entry, pageMeta } of pageResults) {
    expectedFiles.push([
      path.join(PAGES_DIR, `${entry.pageId}.json`),
      buildPageJsonPayload(entry, pageMeta),
    ]);
  }

  for (const { entry, generic } of rebuilt.genericRecords) {
    expectedFiles.push([path.join(GENERIC_DIR, `${entry.pageId}.json`), generic]);
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

  if (errors.length) {
    console.error('--check failed:');
    for (const e of errors) console.error(`- ${e}`);
    process.exit(1);
  }

  console.log('check ok');
  console.log(
    JSON.stringify(
      {
        identityEntryCount: identityEntries.length,
        pageCount: rebuilt.summary.pageCount,
        reviewedContractCount: rebuilt.summary.reviewedContractCount,
        dependencyCount: rebuilt.summary.dependencyCount,
        numericContractStatusCounts: rebuilt.summary.numericContractStatusCounts,
      },
      null,
      2,
    ),
  );
}

async function refreshMode() {
  const identityManifest = await loadIdentityManifest({ rejectDuplicates: true });
  const identityEntries = identityManifest.entries;
  const fetchedAt = new Date().toISOString();

  const fetched = await fetchIdentityPages(identityEntries);
  const fetchedDeps = await fetchDependencies();
  const pageResults = fetched.map((row) => {
    const upstreamWikitext = row.rawWikitext;
    return {
      ...row,
      rawWikitext: serializeRawSnapshot(upstreamWikitext),
      upstreamWikitext,
    };
  });
  const dependencyResults = fetchedDeps.map((row) => {
    const upstreamWikitext = row.rawWikitext;
    return {
      ...row,
      rawWikitext: serializeRawSnapshot(upstreamWikitext),
      upstreamWikitext,
    };
  });
  const outputs = buildOutputs(fetchedAt, identityEntries, pageResults, dependencyResults, {
    verifyUpstreamHash: true,
  });
  await writeAll(outputs);
  console.log('refresh ok');
  console.log(
    JSON.stringify(
      {
        outputRoot: path.relative(repoRoot, OUTPUT_ROOT),
        identityEntryCount: identityEntries.length,
        pageCount: outputs.summary.pageCount,
        reviewedContractCount: outputs.summary.reviewedContractCount,
        dependencyCount: outputs.summary.dependencyCount,
        numericContractStatusCounts: outputs.summary.numericContractStatusCounts,
      },
      null,
      2,
    ),
  );
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const refresh = args.includes('--refresh');
  if (check && refresh) {
    console.error('Specify at most one of --refresh or --check');
    process.exit(2);
  }
  if (!check && !refresh) {
    console.error('Usage: node tools/lol-static-data/fetch-lol-wiki-current-champion-abilities.mjs --refresh|--check');
    console.error('Default no longer refreshes; pass --refresh explicitly.');
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
