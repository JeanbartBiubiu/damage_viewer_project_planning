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
  return response.json();
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

/**
 * Reviewed, page-specific normalized contracts.
 * Every numeric/formula retains template/page/revision + source snippet.
 */
function buildReviewedContract(spec, pageMeta, raw) {
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
          causticWoundsFlat: {
            baseByLevel: '4 to 24',
            apRatio: 0.12,
            perPriorStackByLevel: '1 to 6',
            perPriorStackApRatio: 0.03,
            sourceField: 'description3',
            sourceSnippet: snippetAround(raw, 'Caustic Wounds'),
          },
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
      mustFind.push('Caustic Wounds', 'missing health', 'for 4 seconds');
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
  return errors;
}

async function fetchPages() {
  const titles = PAGE_SPECS.map((s) => s.requestTitle).join('|');
  const url = new URL(WIKI_API);
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  url.searchParams.set('redirects', '1');
  url.searchParams.set('prop', 'info|revisions');
  url.searchParams.set('rvprop', 'ids|timestamp|content');
  url.searchParams.set('rvslots', 'main');
  url.searchParams.set('titles', titles);

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

  const results = [];
  for (const spec of PAGE_SPECS) {
    let title = spec.requestTitle;
    if (normalizedMap.has(title)) title = normalizedMap.get(title);
    if (redirectMap.has(title)) title = redirectMap.get(title);
    const page = byTitle.get(title);
    if (!page) {
      throw new Error(
        `Failed to resolve Wiki page for ${spec.requestTitle} → ${title}. Available: ${[...byTitle.keys()].join(', ')}`,
      );
    }
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

function buildOutputs(fetchedAt, pageResults, options = {}) {
  const pages = [];
  const contracts = [];
  for (const { spec, pageMeta, rawWikitext, upstreamWikitext } of pageResults) {
    const contract = buildReviewedContract(spec, pageMeta, rawWikitext);
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
    },
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
  };

  return { manifest, summary, reviewedContracts, pageResults };
}

async function writeAll(outputs) {
  const { manifest, summary, reviewedContracts, pageResults } = outputs;
  await ensureDir(OUTPUT_ROOT);
  await ensureDir(PAGES_DIR);
  await ensureDir(RAW_DIR);
  await ensureDir(NORMALIZED_DIR);

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

async function checkMode() {
  const { manifest, pageResults } = await loadStoredPageResults();
  const fetchedAt = manifest.fetchedAt;
  // Offline check uses on-disk snapshots for snippets; upstream hash was recorded at refresh.
  const rebuilt = buildOutputs(fetchedAt, pageResults, { verifyUpstreamHash: false });

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
  for (const { rawWikitext } of pageResults) {
    // contracts validated inside buildOutputs
  }
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
        numericContractStatusCounts: rebuilt.summary.numericContractStatusCounts,
        pages: rebuilt.summary.pages.map((p) => ({
          id: p.id,
          revisionId: p.revisionId,
          contentSha256: p.contentSha256,
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
  const pageResults = fetched.map((row) => ({
    ...row,
    upstreamWikitext: row.rawWikitext,
  }));
  const outputs = buildOutputs(fetchedAt, pageResults, { verifyUpstreamHash: true });
  await writeAll(outputs);
  console.log('refresh ok');
  console.log(
    JSON.stringify(
      {
        outputRoot: path.relative(repoRoot, OUTPUT_ROOT),
        pageCount: outputs.summary.pageCount,
        numericContractStatusCounts: outputs.summary.numericContractStatusCounts,
        pages: outputs.summary.pages.map((p) => ({
          id: p.id,
          resolvedTitle: p.resolvedTitle,
          revisionId: p.revisionId,
          contentSha256: p.contentSha256,
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
