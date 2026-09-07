import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ddragonDir = String.raw`C:\project\damage_viewer_project_planning\数据参考\全量录入-2026-09\英雄\原始资料\zh_CN\champion`;
const API_BASE = 'http://127.0.0.1:8080';
const TOKEN = 'local-entry';
const GAME_ID = 'lol';

const specs = {
  Malphite: {
    url: 'https://raw.communitydragon.org/16.17/game/data/characters/malphite/malphite.bin.json',
    expected: ['SeismicShard', 'Obduracy', 'Landslide', 'UFSlash'],
    slots: { Q: 'SeismicShard', W: 'Obduracy', E: 'Landslide', R: 'UFSlash' },
    passiveTokens: ['MalphitePassive', 'GraniteShield', 'Malphite_GraniteShield']
  },
  MissFortune: {
    url: 'https://raw.communitydragon.org/16.17/game/data/characters/missfortune/missfortune.bin.json',
    expected: ['MissFortuneRicochetShot', 'MissFortuneViciousStrikes', 'MissFortuneScattershot', 'MissFortuneBulletTime'],
    slots: {
      Q: 'MissFortuneRicochetShot',
      W: 'MissFortuneViciousStrikes',
      E: 'MissFortuneScattershot',
      R: 'MissFortuneBulletTime'
    },
    passiveTokens: ['MissFortunePassive', 'LoveTap', 'MissFortune_Passive']
  },
  Annie: {
    url: 'https://raw.communitydragon.org/16.17/game/data/characters/annie/annie.bin.json',
    expected: ['AnnieQ', 'AnnieW', 'AnnieE', 'AnnieR'],
    slots: { Q: 'AnnieQ', W: 'AnnieW', E: 'AnnieE', R: 'AnnieR' },
    passiveTokens: ['AnniePassive', 'Pyromania', 'Annie_Passive']
  },
  Brand: {
    url: 'https://raw.communitydragon.org/16.17/game/data/characters/brand/brand.bin.json',
    expected: ['BrandQ', 'BrandW', 'BrandE', 'BrandR'],
    slots: { Q: 'BrandQ', W: 'BrandW', E: 'BrandE', R: 'BrandR' },
    passiveTokens: ['BrandPassive', 'Blaze', 'Brand_Passive', 'BrandBlaze']
  }
};

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function allPaths(v, p = [], out = []) {
  if (!v || typeof v !== 'object') return out;
  if (Array.isArray(v)) {
    v.forEach((x, i) => allPaths(x, p.concat(i), out));
    return out;
  }
  out.push({ path: p, value: v });
  for (const [k, x] of Object.entries(v)) allPaths(x, p.concat(k), out);
  return out;
}

function keyText(p) {
  return p.join('/');
}

function findSpellObjects(root) {
  const arr = [];
  for (const e of allPaths(root)) {
    const k = e.path.at(-1);
    if (
      typeof k === 'string' &&
      e.value &&
      typeof e.value === 'object' &&
      !Array.isArray(e.value) &&
      e.value.mSpell
    ) {
      arr.push({ path: e.path, value: e.value });
    }
  }
  return arr;
}

function choose(objects, tokens) {
  const scored = objects
    .map((o) => {
      const s = keyText(o.path);
      const leaf = String(o.path.at(-1));
      const segments = s.split('/');
      let score = 0;
      for (const t of tokens) {
        if (leaf === t || segments.includes(t)) score += 30;
        else if (s.toLowerCase().includes(t.toLowerCase())) score += 3;
      }
      if (/Missile|Mis$|Particle|Sound|Cast$|Child/i.test(s) && score < 30) score -= 8;
      return { ...o, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || keyText(a.path).length - keyText(b.path).length);
  return scored[0] || null;
}

function simplifyDataValues(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    return raw.map((item) => {
      if (!item || typeof item !== 'object') return item;
      return {
        name: item.mName || item.name || null,
        values: item.mValues || item.values || null,
        valuesP2: item.mValuesP2 || null,
        valuesP3: item.mValuesP3 || null
      };
    });
  }
  if (typeof raw === 'object') {
    return Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [
        k,
        v && typeof v === 'object'
          ? {
              name: v.mName || v.name || k,
              values: v.mValues || v.values || null
            }
          : v
      ])
    );
  }
  return raw;
}

function simplifyCalcPart(part) {
  if (!part || typeof part !== 'object') return part;
  const t = part.__type || part.mType || null;
  const out = { type: t };
  for (const key of [
    'mDataValue',
    'mCoefficient',
    'mStat',
    'mStatFormula',
    'stat',
    'mPart',
    'mSubparts',
    'mValues',
    'mStyleTag',
    'mStartValue',
    'mEndValue',
    'mBreakpoints'
  ]) {
    if (part[key] !== undefined) out[key] = part[key];
  }
  if (Array.isArray(part.mFormulaParts)) out.mFormulaParts = part.mFormulaParts.map(simplifyCalcPart);
  if (Array.isArray(part.mSubparts)) out.mSubparts = part.mSubparts.map(simplifyCalcPart);
  if (part.mPart) out.mPart = simplifyCalcPart(part.mPart);
  return out;
}

function simplifyCalcs(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!v || typeof v !== 'object') {
      out[k] = v;
      continue;
    }
    out[k] = {
      type: v.__type || null,
      formulaParts: Array.isArray(v.mFormulaParts) ? v.mFormulaParts.map(simplifyCalcPart) : v.mFormulaParts || null,
      multiplier: v.mMultiplier || null,
      result: v.mResult || null
    };
  }
  return out;
}

function pickSpellFields(mSpell) {
  if (!mSpell) return null;
  return {
    dataValues: simplifyDataValues(mSpell.DataValues || mSpell.mDataValues),
    dataValuesModeOverride: mSpell.DataValuesModeOverride || null,
    spellCalculations: simplifyCalcs(mSpell.mSpellCalculations || mSpell.SpellCalculations),
    cooldownTime: mSpell.cooldownTime || mSpell.Cooldown || mSpell.mCooldownTime || null,
    mana: mSpell.mana || mSpell.mMana || mSpell.manaCost || null,
    cost: mSpell.mResourceAmount || mSpell.cost || null,
    spellCastTime: mSpell.spellCastTime ?? mSpell.mSpellCastTime ?? null,
    channelDuration: mSpell.channelDuration ?? null,
    castRange: mSpell.castRange || mSpell.castRangeValues || null,
    castRangeDisplayOverride: mSpell.castRangeDisplayOverride || null,
    missileSpeed: mSpell.missileSpeed || null,
    mLineWidth: mSpell.mLineWidth || null,
    mCoefficient: mSpell.mCoefficient || null,
    mCoefficient2: mSpell.mCoefficient2 || null
  };
}

function extractSlot(objects, tokens) {
  const primary = choose(objects, tokens);
  const alternates = objects
    .filter((o) => tokens.some((t) => keyText(o.path).toLowerCase().includes(t.toLowerCase())))
    .slice(0, 25)
    .map((o) => ({ path: keyText(o.path), score: o === primary ? 'primary' : 'alt', keys: Object.keys(o.value) }));
  return {
    primary: primary
      ? {
          path: keyText(primary.path),
          score: primary.score,
          objectName: primary.value.ObjectName || primary.value.mName || null,
          keys: Object.keys(primary.value),
          mSpell: pickSpellFields(primary.value.mSpell)
        }
      : null,
    alternatePaths: alternates
  };
}

async function request(pathname) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${TOKEN}` }
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { ok: res.ok, status: res.status, data };
}

async function snapshotCatalogs() {
  const [attributes, statuses, zones] = await Promise.all([
    request(`/api/admin/games/${GAME_ID}/attributes`),
    request(`/api/admin/games/${GAME_ID}/statuses`),
    request(`/api/admin/games/${GAME_ID}/modifier-zones`)
  ]);
  const skillKeys = [
    'malphite_p',
    'malphite_q',
    'malphite_w',
    'malphite_e',
    'malphite_r',
    'missfortune_p',
    'missfortune_q',
    'missfortune_w',
    'missfortune_e',
    'missfortune_r',
    'annie_p',
    'annie_q',
    'annie_w',
    'annie_e',
    'annie_r',
    'brand_p',
    'brand_q',
    'brand_w',
    'brand_e',
    'brand_r'
  ];
  const skills = {};
  for (const skillKey of skillKeys) {
    const [skill, parameters, formulas, effects, processes, states, rules] = await Promise.all([
      request(`/api/admin/games/${GAME_ID}/skills/${skillKey}`),
      request(`/api/admin/games/${GAME_ID}/skills/${skillKey}/parameters`),
      request(`/api/admin/games/${GAME_ID}/skills/${skillKey}/formulas`),
      request(`/api/admin/games/${GAME_ID}/skills/${skillKey}/effects`),
      request(`/api/admin/games/${GAME_ID}/skills/${skillKey}/processes`),
      request(`/api/admin/games/${GAME_ID}/skills/${skillKey}/internal-states`),
      request(`/api/admin/games/${GAME_ID}/skills/${skillKey}/trigger-rules`)
    ]);
    skills[skillKey] = {
      skill: { ok: skill.ok, status: skill.status, data: skill.data },
      counts: {
        parameters: Array.isArray(parameters.data) ? parameters.data.length : parameters,
        formulas: Array.isArray(formulas.data) ? formulas.data.length : formulas,
        effects: Array.isArray(effects.data) ? effects.data.length : effects,
        processes: Array.isArray(processes.data) ? processes.data.length : processes,
        internalStates: Array.isArray(states.data) ? states.data.length : states,
        triggerRules: Array.isArray(rules.data) ? rules.data.length : rules
      }
    };
  }
  return {
    attributes: {
      ok: attributes.ok,
      status: attributes.status,
      items: Array.isArray(attributes.data)
        ? attributes.data.map((a) => ({ attributeKey: a.attributeKey, name: a.name, status: a.status }))
        : attributes.data
    },
    statuses: {
      ok: statuses.ok,
      status: statuses.status,
      items: Array.isArray(statuses.data)
        ? statuses.data.map((s) => ({ statusKey: s.statusKey, name: s.name, status: s.status }))
        : statuses.data
    },
    modifierZones: {
      ok: zones.ok,
      status: zones.status,
      items: Array.isArray(zones.data)
        ? zones.data.map((z) => ({ modifierZoneKey: z.modifierZoneKey, name: z.name, status: z.status }))
        : zones.data
    },
    skills
  };
}

async function main() {
  await mkdir(here, { recursive: true });
  const sourceDir = path.join(here, '来源冻结');
  await mkdir(sourceDir, { recursive: true });
  const meta = [];
  const extracts = {};
  for (const [name, spec] of Object.entries(specs)) {
    const localName = `${name.toLowerCase()}.bin.json`;
    const localPath = path.join(sourceDir, localName);
    let buf;
    let method;
    if (existsSync(localPath)) {
      buf = readFileSync(localPath);
      method = 'local_existing';
    } else {
      const res = await fetch(spec.url);
      if (!res.ok) throw new Error(`${name} fetch ${res.status} ${spec.url}`);
      buf = Buffer.from(await res.arrayBuffer());
      method = 'fetched_now';
      await writeFile(localPath, buf);
    }
    const raw = JSON.parse(buf.toString('utf8'));
    const objects = findSpellObjects(raw);
    const ddragon = JSON.parse(readFileSync(path.join(ddragonDir, `${name}.json`), 'utf8'));
    const d = ddragon.data[name];
    const slots = {};
    slots.P = extractSlot(objects, spec.passiveTokens);
    slots.P.ddragon = { id: null, name: d.passive.name, description: d.passive.description };
    for (const [slot, id] of Object.entries(spec.slots)) {
      const spell = d.spells[{ Q: 0, W: 1, E: 2, R: 3 }[slot]];
      slots[slot] = extractSlot(objects, [id]);
      slots[slot].ddragon = {
        id: spell.id,
        name: spell.name,
        maxrank: spell.maxrank,
        cooldown: spell.cooldown,
        cost: spell.cost,
        range: spell.range,
        description: spell.description,
        tooltip: spell.tooltip
      };
    }
    const m = {
      champion: name,
      sourceUrl: spec.url,
      retrievalMethod: method,
      observedAt: new Date().toISOString(),
      byteSize: buf.length,
      sha256: sha256(buf),
      jsonParsed: true,
      note: 'CommunityDragon 16.17 客户端提取（社区提取，不称 Riot 官方 API）；与 DDragon 16.17.1 不混称同一微版本。'
    };
    meta.push(m);
    extracts[name] = {
      champion: name,
      source: m,
      ddragonVersion: ddragon.version,
      objectCount: objects.length,
      slots
    };
    await writeFile(path.join(sourceDir, `${name.toLowerCase()}-来源与哈希.json`), `${JSON.stringify(m, null, 2)}\n`);
    await writeFile(
      path.join(sourceDir, `${name.toLowerCase()}-客户端主技能提取.json`),
      `${JSON.stringify(extracts[name], null, 2)}\n`
    );
  }
  const catalogs = await snapshotCatalogs();
  await writeFile(path.join(sourceDir, '来源与哈希汇总.json'), `${JSON.stringify(meta, null, 2)}\n`);
  await writeFile(path.join(sourceDir, '目录与技能现值.json'), `${JSON.stringify(catalogs, null, 2)}\n`);
  console.log(JSON.stringify({ meta, catalogCounts: {
    attributes: catalogs.attributes.items?.length,
    statuses: catalogs.statuses.items?.length,
    zones: catalogs.modifierZones.items?.length
  } }, null, 2));
}

await main();
