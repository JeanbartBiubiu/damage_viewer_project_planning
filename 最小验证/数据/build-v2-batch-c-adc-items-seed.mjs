import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_ITEM_JSON = 'C:/project/damage_wasm_dev/数据参考/item.json';
const DEFAULT_OUTPUT = 'C:/project/damage_backend_dev/最小验证/V2-Batch-C-adc-items.seed.json';
const DEFAULT_BUNDLE_URL = 'http://localhost:8080/api/games/lol/versions/current';

const TYPE_ID_ADC_COMPLETED_ITEM = 62002;
const VERSION_CODE = 'v2_batch_c_adc_items_001';

const statKeyToAttrKey = new Map([
  ['FlatPhysicalDamageMod', 'ad'],
  ['FlatMagicDamageMod', 'ap'],
  ['FlatHPPoolMod', 'hp'],
  ['FlatMPPoolMod', 'mana'],
  ['FlatArmorMod', 'armor'],
  ['FlatSpellBlockMod', 'magic_resist'],
  ['FlatCritChanceMod', 'crit_chance'],
  ['PercentCritChanceMod', 'crit_chance'],
  ['PercentAttackSpeedMod', 'attack_speed'],
  ['PercentLifeStealMod', 'life_steal'],
  ['FlatMovementSpeedMod', 'ms_f'],
  ['PercentMovementSpeedMod', 'ms_pct'],
]);

const attrDefinitions = [
  attr('ad', '攻击力'),
  attr('ap', '法术强度'),
  attr('hp', '生命值'),
  attr('mana', '法力值'),
  attr('armor', '护甲'),
  attr('magic_resist', '魔法抗性'),
  attr('ability_haste', '技能极速'),
  attr('attack_speed', '攻击速度'),
  attr('crit_chance', '暴击几率'),
  attr('crit_damage', '暴击伤害'),
  attr('life_steal', '生命偷取'),
  attr('omnivamp', '全能吸血'),
  attr('armor_pen_flat', '固定护甲穿透'),
  attr('armor_pen_percent', '百分比护甲穿透'),
  attr('magic_pen_flat', '固定魔法穿透'),
  attr('magic_pen_percent', '百分比魔法穿透'),
  attr('ms_f', '固定移动速度'),
  attr('ms_pct', '百分比移动速度'),
  attr('heal_shield_power', '治疗与护盾强度'),
  attr('tenacity', '韧性'),
  attr('hp_regen', '生命回复', 'rate', 'hp'),
  attr('mana_regen', '法力回复', 'rate', 'mana'),
];

const knownBootIds = new Set([
  '1001',
  '3005',
  '3006',
  '3008',
  '3009',
  '3010',
  '3020',
  '3047',
  '3111',
  '3117',
  '3158',
  '3172',
]);

const adcPrimaryAttrs = new Set([
  'ad',
  'attack_speed',
  'crit_chance',
  'crit_damage',
  'life_steal',
  'omnivamp',
  'armor_pen_flat',
  'armor_pen_percent',
]);

function attr(attrKey, attrName, valueKind = 'scalar', rateTargetAttrKey = undefined) {
  const result = {
    attrKey,
    attrName,
    attrType: 'number',
    defaultValue: 0,
    valueKind,
  };
  if (rateTargetAttrKey) {
    result.rateTargetAttrKey = rateTargetAttrKey;
  }
  return result;
}

function parseArgs(argv) {
  const options = {
    itemJson: DEFAULT_ITEM_JSON,
    output: DEFAULT_OUTPUT,
    bundleUrl: DEFAULT_BUNDLE_URL,
  };
  for (const arg of argv) {
    if (arg.startsWith('--itemJson=')) {
      options.itemJson = arg.slice('--itemJson='.length);
    } else if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length);
    } else if (arg.startsWith('--bundleUrl=')) {
      options.bundleUrl = arg.slice('--bundleUrl='.length);
    } else if (arg === '--noBundle') {
      options.bundleUrl = '';
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

async function loadCurrentBundle(bundleUrl) {
  if (!bundleUrl) {
    return new Map();
  }
  const currentResponse = await fetch(bundleUrl);
  if (!currentResponse.ok) {
    throw new Error(`Failed to fetch current version: HTTP ${currentResponse.status}`);
  }
  const current = await currentResponse.json();
  const versionCode = current.versionCode;
  if (!versionCode) {
    throw new Error('Current version response does not contain versionCode');
  }

  const bundleEndpoint = bundleUrl.replace(/\/versions\/current$/, `/versions/${encodeURIComponent(versionCode)}/bundle`);
  const bundleResponse = await fetch(bundleEndpoint);
  if (!bundleResponse.ok) {
    throw new Error(`Failed to fetch bundle ${versionCode}: HTTP ${bundleResponse.status}`);
  }
  const bundle = await bundleResponse.json();
  const items = new Map();
  for (const item of bundle.items ?? []) {
    if (item?.itemId) {
      items.set(String(item.itemId), item);
    }
  }
  return items;
}

function readItemRoot(itemJsonPath) {
  return JSON.parse(fs.readFileSync(itemJsonPath, 'utf8'));
}

function isSummonersRiftItem(item) {
  return item?.maps?.['11'] === true;
}

function isPurchasable(item) {
  return item?.gold?.purchasable === true && item.inStore !== false;
}

function isCompletedItem(item) {
  return Array.isArray(item.from) && item.from.length > 0 && (!Array.isArray(item.into) || item.into.length === 0);
}

function isNormalItemId(itemId) {
  return /^\d{4}$/.test(itemId);
}

function isBootLike(itemId, item) {
  return knownBootIds.has(itemId) || (item.tags ?? []).includes('Boots');
}

function stripTags(input) {
  return String(input ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractStatsLines(description) {
  const match = String(description ?? '').match(/<stats>([\s\S]*?)<\/stats>/i);
  if (!match) {
    return [];
  }
  return match[1]
    .replace(/<br\s*\/?>/gi, '\n')
    .split('\n')
    .map(stripTags)
    .filter(Boolean);
}

function firstNumber(line) {
  const match = line.match(/([+-]?\d+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function setModifier(modifiers, attrKey, value) {
  if (!Number.isFinite(value) || value === 0) {
    modifiers.delete(attrKey);
    return;
  }
  modifiers.set(attrKey, Number(value.toFixed(6)));
}

function addStructuredStats(modifiers, item) {
  for (const [sourceKey, rawValue] of Object.entries(item.stats ?? {})) {
    const attrKey = statKeyToAttrKey.get(sourceKey);
    if (!attrKey) {
      continue;
    }
    const value = Number(rawValue);
    if (Number.isFinite(value) && value !== 0) {
      setModifier(modifiers, attrKey, value);
    }
  }
}

function addDescriptionStats(modifiers, item) {
  for (const line of extractStatsLines(item.description)) {
    const value = firstNumber(line);
    if (value === null) {
      continue;
    }
    const isPercent = line.includes('%');
    const pctValue = value / 100;

    if (line.includes('护甲穿透')) {
      setModifier(modifiers, 'armor_pen_percent', isPercent ? pctValue : value);
    } else if (line.includes('法术穿透') || line.includes('魔法穿透')) {
      setModifier(modifiers, isPercent ? 'magic_pen_percent' : 'magic_pen_flat', isPercent ? pctValue : value);
    } else if (line.includes('穿甲')) {
      setModifier(modifiers, 'armor_pen_flat', value);
    } else if (line.includes('技能急速') || line.includes('技能极速')) {
      setModifier(modifiers, 'ability_haste', value);
    } else if (line.includes('攻击速度')) {
      setModifier(modifiers, 'attack_speed', isPercent ? pctValue : value);
    } else if (line.includes('暴击几率')) {
      setModifier(modifiers, 'crit_chance', isPercent ? pctValue : value);
    } else if (line.includes('暴击伤害')) {
      setModifier(modifiers, 'crit_damage', isPercent ? pctValue : value);
    } else if (line.includes('生命偷取')) {
      setModifier(modifiers, 'life_steal', isPercent ? pctValue : value);
    } else if (line.includes('全能吸血')) {
      setModifier(modifiers, 'omnivamp', isPercent ? pctValue : value);
    } else if (line.includes('治疗和护盾强度')) {
      setModifier(modifiers, 'heal_shield_power', isPercent ? pctValue : value);
    } else if (line.includes('韧性')) {
      setModifier(modifiers, 'tenacity', isPercent ? pctValue : value);
    } else if (line.includes('基础法力回复')) {
      setModifier(modifiers, 'mana_regen', isPercent ? pctValue : value);
    } else if (line.includes('基础生命回复')) {
      setModifier(modifiers, 'hp_regen', isPercent ? pctValue : value);
    } else if (line.includes('移动速度')) {
      setModifier(modifiers, isPercent ? 'ms_pct' : 'ms_f', isPercent ? pctValue : value);
    } else if (line.includes('攻击力')) {
      setModifier(modifiers, 'ad', value);
    } else if (line.includes('法术强度')) {
      setModifier(modifiers, 'ap', value);
    } else if (line.includes('生命值')) {
      setModifier(modifiers, 'hp', value);
    } else if (line.includes('法力')) {
      setModifier(modifiers, 'mana', value);
    } else if (line.includes('魔法抗性')) {
      setModifier(modifiers, 'magic_resist', value);
    } else if (line.includes('护甲')) {
      setModifier(modifiers, 'armor', value);
    }
  }
}

function extractModifiers(item) {
  const modifiers = new Map();
  addStructuredStats(modifiers, item);
  addDescriptionStats(modifiers, item);
  return modifiers;
}

function hasDpsRelevantStat(item, modifiers) {
  if ([...modifiers.keys()].some((attrKey) => adcPrimaryAttrs.has(attrKey))) {
    return true;
  }
  const tags = new Set(item.tags ?? []);
  return tags.has('OnHit') && (modifiers.has('ap') || modifiers.has('magic_pen_flat') || modifiers.has('magic_pen_percent'));
}

function toStatModifiers(modifiers) {
  return [...modifiers.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([attrKey, value]) => ({ attrKey, value }));
}

function normalizeArray(value, fallback = []) {
  return Array.isArray(value) ? value.map(String) : fallback;
}

function buildItemSeed(itemId, item, modifiers, currentItems, sourceVersion) {
  const current = currentItems.get(itemId);
  const recipeIds = current ? normalizeArray(current.recipeIds) : [];
  const skillRefs = current ? normalizeArray(current.skillRefs) : [];
  return {
    itemId,
    name: item.name,
    goldCost: Number(item.gold?.total ?? 0),
    iconUrl: `item_${itemId}`,
    skillRefs,
    recipeIds,
    statModifiers: toStatModifiers(modifiers),
    source: {
      dataSource: '数据参考/item.json',
      sourceVersion,
      sourceItemId: itemId,
      sourceTags: item.tags ?? [],
      sourceGoldTotal: Number(item.gold?.total ?? 0),
    },
  };
}

function buildTypeRelation(itemId, item, modifiers, sourceVersion) {
  return {
    typeId: TYPE_ID_ADC_COMPLETED_ITEM,
    targetCategory: 'equipment',
    targetId: itemId,
    extend: {
      batch: 'V2-Batch-C',
      role: 'adc_completed_item',
      source: '数据参考/item.json',
      sourceVersion,
      sourceTags: item.tags ?? [],
      statKeys: [...modifiers.keys()].sort(),
      selectionRule: 'sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats',
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const itemRoot = readItemRoot(options.itemJson);
  const sourceVersion = String(itemRoot.version ?? '');
  const currentItems = await loadCurrentBundle(options.bundleUrl);

  const selectedItems = [];
  const typeRelations = [];
  const skipped = {
    totalEntries: 0,
    nonNormalId: 0,
    notSummonersRift: 0,
    notPurchasable: 0,
    notCompleted: 0,
    bootLike: 0,
    noDpsRelevantDirectStats: 0,
  };

  for (const [itemId, item] of Object.entries(itemRoot.data ?? {})) {
    skipped.totalEntries += 1;
    if (!isNormalItemId(itemId)) {
      skipped.nonNormalId += 1;
      continue;
    }
    if (!isSummonersRiftItem(item)) {
      skipped.notSummonersRift += 1;
      continue;
    }
    if (!isPurchasable(item)) {
      skipped.notPurchasable += 1;
      continue;
    }
    if (!isCompletedItem(item)) {
      skipped.notCompleted += 1;
      continue;
    }
    if (isBootLike(itemId, item)) {
      skipped.bootLike += 1;
      continue;
    }

    const modifiers = extractModifiers(item);
    if (!hasDpsRelevantStat(item, modifiers)) {
      skipped.noDpsRelevantDirectStats += 1;
      continue;
    }

    selectedItems.push(buildItemSeed(itemId, item, modifiers, currentItems, sourceVersion));
    typeRelations.push(buildTypeRelation(itemId, item, modifiers, sourceVersion));
  }

  selectedItems.sort((left, right) => Number(left.itemId) - Number(right.itemId));
  typeRelations.sort((left, right) => Number(left.targetId) - Number(right.targetId));

  const usedAttrKeys = new Set();
  for (const item of selectedItems) {
    for (const modifier of item.statModifiers) {
      usedAttrKeys.add(modifier.attrKey);
    }
  }

  const seed = {
    gameId: 'lol',
    versionCode: VERSION_CODE,
    source: {
      itemJsonPath: path.resolve(options.itemJson),
      sourceVersion,
      generatedAt: new Date().toISOString(),
      rule: 'V2 Batch C ADC completed item pool; components and boots excluded.',
      skipped,
      selectedItemCount: selectedItems.length,
    },
    ownerCategories: [
      { ownerType: 'hero', name: '英雄' },
      { ownerType: 'item', name: '装备' },
    ],
    attributeDefinitions: attrDefinitions.filter((definition) => usedAttrKeys.has(definition.attrKey)),
    types: [
      {
        typeId: TYPE_ID_ADC_COMPLETED_ITEM,
        name: 'adc_completed_item',
        description: 'V2 Batch C ADC-related completed item pool; excludes components, boots, arena and special copied items.',
      },
    ],
    heroes: [],
    skills: [],
    items: selectedItems,
    typeRelations,
    scenarios: [],
  };

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({
    output: path.resolve(options.output),
    sourceVersion,
    selectedItemCount: selectedItems.length,
    usedAttrKeys: [...usedAttrKeys].sort(),
    skipped,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
