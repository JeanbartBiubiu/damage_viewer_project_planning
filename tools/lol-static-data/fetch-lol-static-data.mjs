import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_OUTPUT_ROOT = path.resolve(
  process.cwd(),
  '文档记录',
  '详细设计',
  '最小验证',
  '数据',
  'lol_竞技场静态文本快照',
);

const DEFAULT_LOCALES = [
  { ddragon: 'en_US', arena: 'en_us' },
  { ddragon: 'zh_CN', arena: 'zh_cn' },
];

function parseArgs(argv) {
  const args = {
    outputRoot: DEFAULT_OUTPUT_ROOT,
    locales: DEFAULT_LOCALES,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--output-root') {
      args.outputRoot = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === '--locales') {
      const localePairs = argv[i + 1]
        .split(',')
        .map((pair) => pair.trim())
        .filter(Boolean)
        .map((pair) => {
          const [ddragon, arena] = pair.split(':');
          if (!ddragon || !arena) {
            throw new Error(`Invalid locale pair: ${pair}. Expected ddragon:arena.`);
          }
          return { ddragon, arena };
        });
      args.locales = localePairs;
      i += 1;
    }
  }

  return args;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'damage-viewer-project-planning/1.0',
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText} for ${url}`);
  }
  return response.json();
}

async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

async function writeJson(filePath, payload) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function countChampionEntries(championFull) {
  return Object.keys(championFull.data ?? {}).length;
}

function countItemEntries(itemData) {
  return Object.keys(itemData.data ?? {}).length;
}

function countRunes(runesData) {
  return (runesData ?? []).flatMap((tree) =>
    (tree.slots ?? []).flatMap((slot) => slot.runes ?? []),
  ).length;
}

function countAugments(arenaData) {
  return Array.isArray(arenaData.augments) ? arenaData.augments.length : 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fetchedAt = new Date().toISOString();
  const versionsUrl = 'https://ddragon.leagueoflegends.com/api/versions.json';
  const languagesUrl = 'https://ddragon.leagueoflegends.com/cdn/languages.json';

  const versions = await fetchJson(versionsUrl);
  const latestVersion = versions[0];
  const languages = await fetchJson(languagesUrl);

  const manifest = {
    fetchedAt,
    sources: {
      dataDragon: {
        versionsUrl,
        languagesUrl,
        version: latestVersion,
      },
      communityDragon: {
        arenaBaseUrl: 'https://raw.communitydragon.org/latest/cdragon/arena',
      },
    },
    locales: [],
  };

  await ensureDir(args.outputRoot);
  await writeJson(path.join(args.outputRoot, 'versions.json'), versions);
  await writeJson(path.join(args.outputRoot, 'languages.json'), languages);

  for (const locale of args.locales) {
    const ddragonBase = `https://ddragon.leagueoflegends.com/cdn/${latestVersion}/data/${locale.ddragon}`;
    const arenaUrl = `https://raw.communitydragon.org/latest/cdragon/arena/${locale.arena}.json`;

    const [championFull, itemData, runesData, arenaData] = await Promise.all([
      fetchJson(`${ddragonBase}/championFull.json`),
      fetchJson(`${ddragonBase}/item.json`),
      fetchJson(`${ddragonBase}/runesReforged.json`),
      fetchJson(arenaUrl),
    ]);

    const ddragonDir = path.join(args.outputRoot, 'ddragon', latestVersion, locale.ddragon);
    const arenaDir = path.join(args.outputRoot, 'communitydragon', 'latest', locale.arena);

    await writeJson(path.join(ddragonDir, 'championFull.json'), championFull);
    await writeJson(path.join(ddragonDir, 'item.json'), itemData);
    await writeJson(path.join(ddragonDir, 'runesReforged.json'), runesData);
    await writeJson(path.join(arenaDir, 'arena.json'), arenaData);

    manifest.locales.push({
      ddragonLocale: locale.ddragon,
      arenaLocale: locale.arena,
      files: {
        championFull: {
          url: `${ddragonBase}/championFull.json`,
          count: countChampionEntries(championFull),
          output: path.relative(args.outputRoot, path.join(ddragonDir, 'championFull.json')),
        },
        item: {
          url: `${ddragonBase}/item.json`,
          count: countItemEntries(itemData),
          output: path.relative(args.outputRoot, path.join(ddragonDir, 'item.json')),
        },
        runesReforged: {
          url: `${ddragonBase}/runesReforged.json`,
          count: countRunes(runesData),
          output: path.relative(args.outputRoot, path.join(ddragonDir, 'runesReforged.json')),
        },
        arenaAugments: {
          url: arenaUrl,
          count: countAugments(arenaData),
          output: path.relative(args.outputRoot, path.join(arenaDir, 'arena.json')),
        },
      },
    });
  }

  await writeJson(path.join(args.outputRoot, 'manifest.json'), manifest);

  const summary = {
    fetchedAt,
    dataDragonVersion: latestVersion,
    locales: manifest.locales.map((locale) => ({
      ddragonLocale: locale.ddragonLocale,
      arenaLocale: locale.arenaLocale,
      champions: locale.files.championFull.count,
      items: locale.files.item.count,
      runes: locale.files.runesReforged.count,
      arenaAugments: locale.files.arenaAugments.count,
    })),
  };
  await writeJson(path.join(args.outputRoot, 'summary.json'), summary);

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
