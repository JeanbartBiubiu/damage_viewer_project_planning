import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildSummary,
  normalizeItem,
  parseItemDataModule,
} from './lua-ast-to-json.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WIKI_API_URL =
  'https://wiki.leagueoflegends.com/en-us/api.php?action=query&prop=revisions&rvprop=ids|timestamp|content&rvslots=main&titles=Module:ItemData/data&format=json&origin=*';
const WIKI_PARSE_URL = 'https://wiki.leagueoflegends.com/en-us/api.php';
const MODULE_TITLE = 'Module:ItemData/data';
const MODULE_SOURCE_URL =
  'https://wiki.leagueoflegends.com/en-us/Module:ItemData/data';

const DEFAULT_OUTPUT_ROOT = path.resolve(
  process.cwd(),
  '\u6570\u636e\u53c2\u8003',
  'lol-wiki-current-items',
);

const OUTPUT_FILES = {
  rawLua: 'current-items.raw.lua',
  normalized: 'current-items.normalized.json',
  summary: 'current-items.summary.json',
  manifest: 'manifest.json',
  tooltips: 'current-items.tooltips.json',
};

function parseArgs(argv) {
  const args = {
    outputRoot: DEFAULT_OUTPUT_ROOT,
    renderTooltips: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--output-root') {
      args.outputRoot = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--render-tooltips') {
      args.renderTooltips = true;
    }
  }

  return args;
}

async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

async function writeText(filePath, content) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, content, 'utf8');
}

async function writeJson(filePath, payload) {
  await writeText(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      'User-Agent': 'damage-wasm-dev/lol-wiki-current-items/1.0',
      Accept: 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText} for ${url}`);
  }

  return response.json();
}

function sha256(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function getRevisionPayload(apiResponse) {
  const pages = apiResponse?.query?.pages;
  if (!pages) {
    throw new Error('MediaWiki API response missing query.pages.');
  }

  const page = Object.values(pages)[0];
  if (!page || page.missing !== undefined) {
    throw new Error(`MediaWiki page not found: ${MODULE_TITLE}`);
  }

  const revision = page.revisions?.[0];
  const content = revision?.slots?.main?.['*'];
  if (!revision || typeof content !== 'string') {
    throw new Error(`MediaWiki revision content missing for ${MODULE_TITLE}.`);
  }

  return {
    pageid: page.pageid,
    revid: revision.revid,
    timestamp: revision.timestamp,
    content,
  };
}

async function fetchCurrentModule() {
  const apiResponse = await fetchJson(WIKI_API_URL);
  return getRevisionPayload(apiResponse);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function renderTooltip(itemName) {
  const url = new URL(WIKI_PARSE_URL);
  url.searchParams.set('action', 'parse');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  url.searchParams.set('contentmodel', 'wikitext');
  url.searchParams.set('text', `{{Tooltip/Item|item=${itemName}|game=lol}}`);

  const response = await fetchJson(url.toString());
  const html = response?.parse?.text?.['*'];
  if (typeof html !== 'string') {
    throw new Error(`Tooltip parse failed for item: ${itemName}`);
  }

  return {
    item: itemName,
    html,
  };
}

async function renderTooltipsForItems(itemNames) {
  const concurrency = 4;
  const delayMs = 150;
  const results = [];
  let cursor = 0;

  async function worker() {
    while (cursor < itemNames.length) {
      const index = cursor;
      cursor += 1;
      const itemName = itemNames[index];
      results[index] = await renderTooltip(itemName);
      if (index + 1 < itemNames.length) {
        await sleep(delayMs);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

async function writeFailureReview(outputRoot, error) {
  const reviewPath = path.join(__dirname, 'review.md');
  const message = [
    '# LoL Wiki current items fetch review',
    '',
    `Timestamp: ${new Date().toISOString()}`,
    `Output root: ${outputRoot}`,
    '',
    '## Error',
    '',
    '```text',
    error.stack || String(error),
    '```',
    '',
  ].join('\n');
  await writeText(reviewPath, message);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fetchedAt = new Date().toISOString();

  try {
    const revision = await fetchCurrentModule();
    const luaContent = revision.content;

    const { items: parsedItems, unsupported, inheritedFields } =
      await parseItemDataModule(luaContent);
    const items = parsedItems.map((item) => normalizeItem(item));
    const summary = buildSummary(items, unsupported, inheritedFields);
    const contentSha256 = sha256(luaContent);

    const normalized = {
      currentOnly: true,
      fetchedAt,
      items,
      removedIncluded: false,
      revision: {
        pageid: revision.pageid,
        revid: revision.revid,
        timestamp: revision.timestamp,
        title: MODULE_TITLE,
      },
      source: {
        apiUrl: WIKI_API_URL,
        moduleUrl: MODULE_SOURCE_URL,
        title: MODULE_TITLE,
      },
    };

    const manifest = {
      apiTitle: MODULE_TITLE,
      apiUrl: WIKI_API_URL,
      contentSha256,
      currentOnly: true,
      fetchedAt,
      outputFiles: [
        OUTPUT_FILES.rawLua,
        OUTPUT_FILES.normalized,
        OUTPUT_FILES.summary,
        OUTPUT_FILES.manifest,
      ],
      removedIncluded: false,
      revid: revision.revid,
      sourceUrl: MODULE_SOURCE_URL,
      timestamp: revision.timestamp,
    };

    await ensureDir(args.outputRoot);
    await writeText(path.join(args.outputRoot, OUTPUT_FILES.rawLua), luaContent);
    await writeJson(path.join(args.outputRoot, OUTPUT_FILES.normalized), normalized);
    await writeJson(path.join(args.outputRoot, OUTPUT_FILES.summary), summary);
    await writeJson(path.join(args.outputRoot, OUTPUT_FILES.manifest), manifest);

    if (args.renderTooltips) {
      const tooltipItems = await renderTooltipsForItems(items.map((item) => item.name));
      const tooltips = {
        currentOnly: true,
        fetchedAt,
        items: tooltipItems,
        removedIncluded: false,
        revision: normalized.revision,
        source: normalized.source,
      };
      await writeJson(path.join(args.outputRoot, OUTPUT_FILES.tooltips), tooltips);
      manifest.outputFiles.push(OUTPUT_FILES.tooltips);
      await writeJson(path.join(args.outputRoot, OUTPUT_FILES.manifest), manifest);
    }

    console.log(
      JSON.stringify(
        {
          currentOnly: true,
          count: summary.count,
          fetchedAt,
          outputRoot: args.outputRoot,
          removedIncluded: false,
          revid: revision.revid,
          unsupportedCount: summary.unsupportedCount,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await writeFailureReview(args.outputRoot, error);
    throw error;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
