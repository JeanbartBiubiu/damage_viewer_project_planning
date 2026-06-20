/**
 * Convert luaparse AST nodes from Module:ItemData/data into plain JSON values.
 */

const INHERITED_PREFIX = '=>';

export function decodeLuaString(raw) {
  if (!raw || typeof raw !== 'string') {
    return raw;
  }

  if (raw.startsWith('[')) {
    const longMatch = raw.match(/^\[(=*)\[/s);
    if (longMatch) {
      const equals = longMatch[1];
      const close = `]${equals}]`;
      if (raw.endsWith(close)) {
        return raw.slice(longMatch[0].length, raw.length - close.length);
      }
    }
    return raw;
  }

  const quote = raw[0];
  if (quote !== '"' && quote !== "'") {
    return raw;
  }

  let result = '';
  for (let i = 1; i < raw.length - 1; i += 1) {
    const ch = raw[i];
    if (ch !== '\\') {
      result += ch;
      continue;
    }

    const next = raw[++i];
    switch (next) {
      case 'n':
        result += '\n';
        break;
      case 't':
        result += '\t';
        break;
      case 'r':
        result += '\r';
        break;
      case '\\':
        result += '\\';
        break;
      case '"':
        result += '"';
        break;
      case "'":
        result += "'";
        break;
      case 'a':
        result += '\u0007';
        break;
      case 'b':
        result += '\b';
        break;
      case 'f':
        result += '\f';
        break;
      case 'v':
        result += '\v';
        break;
      case 'z':
        while (i + 1 < raw.length - 1 && /\s/.test(raw[i + 1])) {
          i += 1;
        }
        break;
      default:
        if (/[0-9]/.test(next)) {
          let digits = next;
          while (i + 1 < raw.length - 1 && /[0-9]/.test(raw[i + 1])) {
            digits += raw[++i];
          }
          result += String.fromCharCode(Number.parseInt(digits, 10) % 256);
        } else if (next === 'x' && i + 2 < raw.length - 1) {
          const hex = raw.slice(i + 1, i + 3);
          if (/^[0-9a-fA-F]{2}$/.test(hex)) {
            i += 2;
            result += String.fromCharCode(Number.parseInt(hex, 16));
          } else {
            result += next;
          }
        } else {
          result += next;
        }
        break;
    }
  }

  return result;
}

function isInheritedString(value) {
  return typeof value === 'string' && value.startsWith(INHERITED_PREFIX);
}

function collectInherited(value, path, inheritedFields) {
  if (typeof value === 'string') {
    if (isInheritedString(value)) {
      inheritedFields.push({ path, value });
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectInherited(entry, `${path}[${index}]`, inheritedFields);
    });
    return;
  }

  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      const nextPath = path ? `${path}.${key}` : key;
      collectInherited(nested, nextPath, inheritedFields);
    }
  }
}

function convertNode(node, unsupported) {
  if (!node || typeof node !== 'object') {
    unsupported.push({ reason: 'missing-node', node });
    return undefined;
  }

  switch (node.type) {
    case 'BooleanLiteral':
      return node.value;
    case 'NumericLiteral':
      return node.value;
    case 'NilLiteral':
      return null;
    case 'StringLiteral':
      return decodeLuaString(node.raw);
    case 'UnaryExpression':
      if (node.operator === '-' && node.argument?.type === 'NumericLiteral') {
        return -node.argument.value;
      }
      unsupported.push({ reason: 'unsupported-unary', nodeType: node.type });
      return undefined;
    case 'TableConstructorExpression':
      return convertTable(node, unsupported);
    default:
      unsupported.push({ reason: 'unsupported-node', nodeType: node.type });
      return undefined;
  }
}

function convertTable(tableNode, unsupported) {
  const entries = [];
  let maxIndex = 0;

  for (const field of tableNode.fields ?? []) {
    if (field.type === 'TableValue') {
      const index = entries.length + 1;
      entries.push([index, convertNode(field.value, unsupported)]);
      maxIndex = index;
      continue;
    }

    if (field.type === 'TableKey') {
      const keyNode = field.key;
      let key;
      if (keyNode?.type === 'StringLiteral') {
        key = decodeLuaString(keyNode.raw);
      } else if (keyNode?.type === 'NumericLiteral') {
        key = keyNode.value;
      } else {
        unsupported.push({ reason: 'unsupported-table-key', nodeType: keyNode?.type });
        continue;
      }

      entries.push([key, convertNode(field.value, unsupported)]);
      if (typeof key === 'number' && key > maxIndex) {
        maxIndex = key;
      }
    } else {
      unsupported.push({ reason: 'unsupported-table-field', nodeType: field.type });
    }
  }

  const numericKeys = entries
    .map(([key]) => key)
    .filter((key) => typeof key === 'number');
  const isArrayLike =
    entries.length > 0 &&
    numericKeys.length === entries.length &&
    numericKeys.every((key, index) => key === index + 1);

  if (isArrayLike) {
    return entries.map(([, value]) => value);
  }

  const object = {};
  for (const [key, value] of entries) {
    object[String(key)] = value;
  }
  return object;
}

export function parseItemDataModule(luaSource) {
  return import('luaparse').then((luaparse) => {
    const unsupported = [];
    const ast = luaparse.default.parse(luaSource, {
      comments: false,
      scope: false,
      locations: false,
      ranges: false,
      luaVersion: '5.3',
    });

    const returnStatement = ast.body.find((node) => node.type === 'ReturnStatement');
    if (!returnStatement?.arguments?.[0]) {
      throw new Error('Module content does not contain `return { ... }`.');
    }

    const rootTable = returnStatement.arguments[0];
    if (rootTable.type !== 'TableConstructorExpression') {
      throw new Error('Module return value is not a table.');
    }

    const items = [];
    const inheritedFields = [];

    for (const field of rootTable.fields ?? []) {
      if (field.type !== 'TableKey' || field.key?.type !== 'StringLiteral') {
        unsupported.push({ reason: 'unsupported-root-field', nodeType: field.type });
        continue;
      }

      const name = decodeLuaString(field.key.raw);
      const raw = convertNode(field.value, unsupported);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        unsupported.push({ reason: 'invalid-item-record', name });
        continue;
      }

      collectInherited(raw, name, inheritedFields);
      items.push({ name, raw });
    }

    return { items, unsupported, inheritedFields };
  });
}

export const PROMOTED_ITEM_FIELDS = [
  'id',
  'tier',
  'type',
  'modes',
  'menu',
  'stats',
  'effects',
  'recipe',
  'buy',
  'tags',
  'nickname',
];

export function normalizeItem({ name, raw }) {
  const item = { name, raw: { ...raw } };
  for (const field of PROMOTED_ITEM_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(raw, field)) {
      item[field] = raw[field];
    }
  }
  return item;
}

function sortedCountMap(map) {
  return Object.fromEntries(
    Object.entries(map).sort(([left], [right]) => left.localeCompare(right, 'en')),
  );
}

export function buildSummary(items, unsupported, inheritedFields) {
  const statKeys = new Set();
  const effectSlots = new Set();
  const byType = {};
  const byMode = {};
  const byMenu = {};
  const byTag = {};
  const itemsWithInheritedField = new Set();

  for (const entry of inheritedFields) {
    const itemName = entry.path.split('.')[0];
    itemsWithInheritedField.add(itemName);
  }

  for (const item of items) {
    const raw = item.raw ?? item;

    if (Array.isArray(raw.type)) {
      for (const typeValue of raw.type) {
        byType[typeValue] = (byType[typeValue] ?? 0) + 1;
      }
    }

    if (raw.modes && typeof raw.modes === 'object' && !Array.isArray(raw.modes)) {
      for (const [mode, enabled] of Object.entries(raw.modes)) {
        if (enabled) {
          byMode[mode] = (byMode[mode] ?? 0) + 1;
        }
      }
    }

    if (raw.menu && typeof raw.menu === 'object' && !Array.isArray(raw.menu)) {
      for (const [menu, enabled] of Object.entries(raw.menu)) {
        if (enabled) {
          byMenu[menu] = (byMenu[menu] ?? 0) + 1;
        }
      }
    }

    if (Array.isArray(raw.tags)) {
      for (const tag of raw.tags) {
        byTag[tag] = (byTag[tag] ?? 0) + 1;
      }
    }

    if (raw.stats && typeof raw.stats === 'object' && !Array.isArray(raw.stats)) {
      for (const key of Object.keys(raw.stats)) {
        statKeys.add(key);
      }
    }

    if (raw.effects && typeof raw.effects === 'object' && !Array.isArray(raw.effects)) {
      for (const key of Object.keys(raw.effects)) {
        effectSlots.add(key);
      }
    }
  }

  const uniqueInheritedFields = [...new Set(inheritedFields.map((entry) => entry.path))].sort(
    (left, right) => left.localeCompare(right, 'en'),
  );

  return {
    byMenu: sortedCountMap(byMenu),
    byMode: sortedCountMap(byMode),
    byTag: sortedCountMap(byTag),
    byType: sortedCountMap(byType),
    count: items.length,
    effectSlots: [...effectSlots].sort((left, right) => left.localeCompare(right, 'en')),
    inheritedFields: uniqueInheritedFields,
    itemsWithInheritedField: itemsWithInheritedField.size,
    statKeys: [...statKeys].sort((left, right) => left.localeCompare(right, 'en')),
    unsupportedCount: unsupported.length,
  };
}
