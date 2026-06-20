import http from 'node:http';
import { createHash, webcrypto } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import vm from 'node:vm';

const projectRoot = 'C:/project/damage_wasm_dev';
const moduleRoot = resolve(projectRoot, 'wasm/tinygo_engine_v2');
const wasmPath = resolve(moduleRoot, 'dist/tinygo_engine_v2.wasm');
const wasmExecPath = resolve(projectRoot, '.tools/tinygo0.40.1/tinygo/targets/wasm_exec.js');
const apiBase = 'http://127.0.0.1:8080';
const batchItemIds = ['2051', '3004', '3036', '6665'];
const batchSkillIds = [
  'item_2051_guardians_horn_undaunted_batch_v_a',
  'item_3004_manamune_awe_batch_v_a',
  'item_3036_lord_dominiks_giant_slayer_batch_v_a',
  'item_6665_jaksho_voidborn_resilience_batch_v_a'
];
const batchBucketKeys = [
  'flat_post_percent',
  'ad_flat_bonus',
  'outgoing_damage_amp',
  'target_armor_flat_bonus',
  'target_magic_resist_flat_bonus'
];
const artifactDir = join(projectRoot, '\u6587\u6863\u8bb0\u5f55', '\u6d4b\u8bd5\u8bb0\u5f55', 'wasm', 'artifacts');
const bundleProofPath = join(artifactDir, 'V2-BatchV-A-published-bundle-proof-20260620.json');
const dpsProofPath = join(artifactDir, 'V2-BatchV-A-wasm-dps-proof-20260620.json');

function getJson(url) {
  return new Promise((resolveValue, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`${url} ${res.statusCode} ${body.slice(0, 300)}`));
          return;
        }
        try {
          resolveValue(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

function loadTinyGo() {
  if (!existsSync(wasmPath)) throw new Error(`wasm artifact not found: ${wasmPath}`);
  if (!existsSync(wasmExecPath)) throw new Error(`wasm_exec.js not found: ${wasmExecPath}`);
  if (!globalThis.crypto) globalThis.crypto = webcrypto;
  vm.runInThisContext(readFileSync(wasmExecPath, 'utf8'), { filename: wasmExecPath });
}

async function instantiateWasm() {
  loadTinyGo();
  const bytes = readFileSync(wasmPath);
  const go = new globalThis.Go();
  const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
  go.run(instance).catch((error) => console.error('go.run error', error));
  return { instance, bytes };
}

function encodeFrame(kind, obj) {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8');
  const out = Buffer.alloc(16 + payload.length);
  out.writeUInt32LE(0x32475644, 0);
  out.writeUInt16LE(1, 4);
  out.writeUInt16LE(kind, 6);
  out.writeUInt32LE(0, 8);
  out.writeUInt32LE(payload.length, 12);
  payload.copy(out, 16);
  return out;
}

function callFrame(exports, fnName, kind, payload) {
  const frame = encodeFrame(kind, payload);
  const ptr = exports.alloc(frame.length);
  new Uint8Array(exports.memory.buffer, ptr, frame.length).set(frame);
  const rc = exports[fnName](ptr, frame.length);
  exports.dealloc(ptr, frame.length);
  return rc;
}

function readFrames(exports) {
  const ptr = exports.engine_outbox_ptr();
  const len = exports.engine_outbox_len();
  const data = Buffer.from(new Uint8Array(exports.memory.buffer, ptr, len));
  const frames = [];
  let offset = 0;
  while (offset + 16 <= data.length) {
    const kind = data.readUInt16LE(offset + 6);
    const payloadLen = data.readUInt32LE(offset + 12);
    const payloadRaw = data.subarray(offset + 16, offset + 16 + payloadLen).toString('utf8');
    frames.push({ kind, payload: JSON.parse(payloadRaw) });
    offset += 16 + payloadLen;
  }
  exports.engine_outbox_clear();
  return frames;
}

function mapItemStats(item) {
  const out = {};
  for (const stat of item?.statModifiers ?? []) {
    const key = String(stat.attrKey ?? '').trim();
    const value = Number(stat.value);
    if (key && Number.isFinite(value)) out[key] = (out[key] ?? 0) + value;
  }
  return out;
}

function addMaps(...maps) {
  const out = {};
  for (const map of maps) {
    for (const [key, value] of Object.entries(map ?? {})) out[key] = (out[key] ?? 0) + value;
  }
  return out;
}

function attrValue(value) {
  return { base: value, current: value, max: value, resolved: value, hasCurrent: true, hasMax: true };
}

function toActorTemplateAttrs(attrs) {
  return Object.fromEntries(Object.entries(attrs).map(([key, value]) => [key, attrValue(value)]));
}

function buildEngineBundle(publicBundle) {
  const attrKeys = new Set((publicBundle.attributeDefinitions ?? []).map((definition) => definition.attrKey).filter(Boolean));
  for (const key of [
    'attack_damage',
    'ad',
    'attack_speed',
    'crit_chance',
    'crit_damage',
    'hp',
    'mana',
    'armor',
    'magic_resist',
    'armor_pen_percent',
    'armor_pen_flat',
    'magic_pen_percent',
    'magic_pen_flat',
    'bonus_armor',
    'bonus_magic_resist',
    'target_bonus_health',
    'ability_haste',
    'hp_regen'
  ]) {
    attrKeys.add(key);
  }
  const attributes = Array.from(attrKeys).map((id) => (id === 'crit_damage' ? { id, defaultBase: 1 } : { id }));
  return {
    schemaVersion: 1,
    attributes,
    actors: [
      {
        id: 'dps_attacker',
        maxHp: 10000,
        initialHp: 10000,
        attributes: toActorTemplateAttrs({
          attack_damage: 100,
          attack_speed: 1,
          crit_chance: 0,
          crit_damage: 1,
          mana: 1000,
          ad: 100
        }),
        actions: ['basic_attack']
      },
      {
        id: 'target_dummy_fighter',
        maxHp: 10000,
        initialHp: 10000,
        attributes: toActorTemplateAttrs({
          hp: 10000,
          armor: 0,
          magic_resist: 0,
          target_bonus_health: 0,
          bonus_armor: 0,
          bonus_magic_resist: 0
        }),
        actions: []
      }
    ],
    actions: [
      {
        id: 'basic_attack',
        label: 'Batch V A proof basic attack',
        classifier: { types: ['action/basic_attack'] },
        cooldownFormulaId: 'aa_cooldown_ms',
        effects: [
          {
            type: 'deal_damage',
            formulaId: 'attack_damage',
            damageType: 'physical',
            sourceRole: 'source',
            targetRole: 'target',
            critPolicy: 'expected',
            critChanceSource: 'attacker_crit_chance',
            critMultiplierSource: 'attacker_crit_damage'
          }
        ]
      }
    ],
    formulas: [
      { id: 'as_floor', op: 'const', value: 0.01 },
      { id: 'as_cap', op: 'const', value: 3 },
      { id: 'thousand', op: 'const', value: 1000 },
      { id: 'attack_damage', op: 'attr', attr: 'attack_damage' },
      { id: 'attack_speed', op: 'attr', attr: 'attack_speed' },
      { id: 'as_capped_low', op: 'max', left: 'attack_speed', right: 'as_floor' },
      { id: 'as_capped', op: 'min', left: 'as_capped_low', right: 'as_cap' },
      { id: 'aa_cooldown_ms', op: 'div', left: 'thousand', right: 'as_capped' }
    ],
    coefficientBuckets: (publicBundle.coefficientBuckets ?? []).filter((bucket) => batchBucketKeys.includes(bucket.bucketKey)),
    settings: { maxEvents: 10000, maxCommandsPerEvent: 64 }
  };
}

function baseTargetAttrs(extra = {}) {
  return {
    hp: 10000,
    armor: 0,
    magic_resist: 0,
    target_bonus_health: 0,
    bonus_armor: 0,
    bonus_magic_resist: 0,
    ...extra
  };
}

function baseAttackerAttrs(extra = {}) {
  return { ad: 100, attack_speed: 1, crit_chance: 0, crit_damage: 1, mana: 1000, ...extra };
}

function actorSnapshot(role, attrs, hp = 10000) {
  const isTarget = role === 'target';
  return {
    actorId: isTarget ? 'target_dummy_fighter' : 'dps_attacker',
    templateId: isTarget ? 'target_dummy_fighter' : 'dps_attacker',
    name: isTarget ? 'Target Dummy Fighter' : 'Batch V A Attacker',
    level: 1,
    types: isTarget ? ['target_dummy'] : ['champion'],
    currentHp: hp,
    maxHp: hp,
    attributes: attrs
  };
}

function buildCurve({
  curveId,
  label,
  attackerAttrs,
  targetAttrs,
  equipmentSet = [],
  equipmentStats = {},
  enabledPassives = [],
  targetEquipmentSet = [],
  targetEquipmentStats = {},
  targetEnabledPassives = [],
  passiveEffects = []
}) {
  return {
    curveId,
    label,
    selection: {
      heroId: 'dps_attacker',
      heroLevel: 1,
      targetId: 'target_dummy_fighter',
      targetType: 'target_dummy',
      skillLevels: {},
      equipmentSet,
      enabledPassiveEffects: enabledPassives,
      targetEquipmentSet,
      targetEnabledPassiveEffects: targetEnabledPassives,
      scenarioStates: [],
      critPolicy: 'expected'
    },
    resolvedSnapshot: {
      basicAttackActions: [
        { actionId: 'basic_attack', skillId: 'skill_lol_basic_attack_default', classifier: { types: ['action/basic_attack'] } }
      ],
      attackerSnapshot: actorSnapshot('attacker', attackerAttrs),
      targetSnapshot: actorSnapshot('target', targetAttrs),
      equipmentSet,
      equipmentStats,
      enabledPassiveEffects: enabledPassives,
      targetEquipmentSet,
      targetEquipmentStats,
      targetEnabledPassiveEffects: targetEnabledPassives,
      passiveEffects,
      externalPassiveEffects: [],
      scenarioStates: [],
      runeStatAdjustments: {}
    }
  };
}

function findPassive(publicBundle, skillId) {
  const skill = publicBundle.skills.find((candidate) => candidate.skillId === skillId);
  const raw = skill?.mechanicsConfig?.dpsPassiveEffects;
  if (!Array.isArray(raw) || raw.length === 0) throw new Error(`missing dpsPassiveEffects for ${skillId}`);
  return JSON.parse(JSON.stringify(raw[0]));
}

function summarizeBuckets(result) {
  return (result.effectBreakdown ?? [])
    .filter((entry) => entry.coefficientBucket)
    .map((entry) => ({
      timeMs: entry.timeMs,
      source: entry.source,
      kind: entry.kind,
      amount: entry.amount,
      ...entry.coefficientBucket
    }));
}

function findBucket(result, key) {
  return summarizeBuckets(result).find((entry) => entry.bucketKey === key);
}

function round(value) {
  return typeof value === 'number' ? Number(value.toFixed(6)) : value;
}

function summarizeCurve(result) {
  const firstDamage = result.damageTimeline?.[0];
  return {
    curveId: result.curveId,
    status: result.status,
    stopReason: result.stopReason,
    blockedReasons: result.blockedReasons ?? [],
    totalDamage: round(result.totalDamage),
    firstDamage: firstDamage
      ? {
          source: firstDamage.source,
          rawDamage: round(firstDamage.rawDamage),
          finalDamage: round(firstDamage.finalDamage),
          targetHpBefore: round(firstDamage.targetHpBefore),
          targetHpAfter: round(firstDamage.targetHpAfter)
        }
      : null,
    resolvedAttackerAttrs: result.resolvedSnapshot?.attackerSnapshot?.attributes ?? {},
    resolvedTargetAttrs: result.resolvedSnapshot?.targetSnapshot?.attributes ?? {},
    itemPassiveTriggers: result.itemPassiveTriggers ?? [],
    coefficientBuckets: summarizeBuckets(result).map((entry) => ({
      bucketKey: entry.bucketKey,
      stageKey: entry.stageKey,
      aggregationMode: entry.aggregationMode,
      valueUnit: entry.valueUnit,
      raw: round(entry.raw),
      result: round(entry.result),
      evidenceKeys: entry.evidenceKeys,
      candidates: (entry.candidates ?? []).map((candidate) => ({
        source: candidate.source,
        passiveId: candidate.passiveId,
        operationKind: candidate.operationKind,
        value: round(candidate.value),
        evidenceKey: candidate.evidenceKey,
        applied: candidate.applied
      }))
    }))
  };
}

function assertClose(actual, expected, label, tolerance = 0.000001) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: got ${actual}, expected ${expected}`);
  }
}

const current = await getJson(`${apiBase}/api/games/lol/versions/current`);
const publicBundle = await getJson(`${apiBase}/api/games/lol/versions/${current.versionCode}/bundle`);
mkdirSync(artifactDir, { recursive: true });

const bundleProof = {
  generatedAt: new Date().toISOString(),
  apiBase,
  current,
  counts: Object.fromEntries(Object.entries(publicBundle).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length])),
  items: batchItemIds.map((itemId) => {
    const item = publicBundle.items.find((candidate) => candidate.itemId === itemId);
    return { itemId, found: Boolean(item), name: item?.name, skillRefs: item?.skillRefs ?? [], statModifiers: item?.statModifiers ?? [] };
  }),
  skills: batchSkillIds.map((skillId) => {
    const skill = publicBundle.skills.find((candidate) => candidate.skillId === skillId);
    return {
      skillId,
      found: Boolean(skill),
      ownerType: skill?.ownerType,
      ownerId: skill?.ownerId,
      passiveCount: Array.isArray(skill?.mechanicsConfig?.dpsPassiveEffects) ? skill.mechanicsConfig.dpsPassiveEffects.length : 0
    };
  }),
  buckets: batchBucketKeys.map((bucketKey) => {
    const bucket = publicBundle.coefficientBuckets.find((candidate) => candidate.bucketKey === bucketKey);
    return {
      bucketKey,
      found: Boolean(bucket),
      stageKey: bucket?.stageKey,
      resolutionDomain: bucket?.resolutionDomain,
      targetAttrKey: bucket?.targetAttrKey,
      aggregationMode: bucket?.aggregationMode,
      bucketConfig: bucket?.bucketConfig
    };
  }),
  attrs: ['target_bonus_health', 'bonus_armor', 'bonus_magic_resist', 'mana', 'ad', 'armor', 'magic_resist'].map((attrKey) => ({
    attrKey,
    found: publicBundle.attributeDefinitions.some((definition) => definition.attrKey === attrKey)
  }))
};
writeFileSync(bundleProofPath, `${JSON.stringify(bundleProof, null, 2)}\n`, 'utf8');

if (
  bundleProof.items.some((entry) => !entry.found) ||
  bundleProof.skills.some((entry) => !entry.found || entry.passiveCount < 1) ||
  bundleProof.buckets.some((entry) => !entry.found) ||
  bundleProof.attrs.some((entry) => !entry.found)
) {
  throw new Error('published bundle proof is incomplete');
}

const itemById = new Map(publicBundle.items.map((item) => [item.itemId, item]));
const passives = Object.fromEntries(batchSkillIds.map((skillId) => [skillId, findPassive(publicBundle, skillId)]));
const stats = Object.fromEntries(batchItemIds.map((itemId) => [itemId, mapItemStats(itemById.get(itemId))]));
const curves = [
  buildCurve({
    curveId: 'baseline_no_batch_v_a_item',
    label: 'Baseline no Batch V A item',
    attackerAttrs: baseAttackerAttrs(),
    targetAttrs: baseTargetAttrs()
  }),
  buildCurve({
    curveId: 'target_2051_guardians_horn',
    label: 'Guardian Horn target passive -15 flat',
    attackerAttrs: baseAttackerAttrs(),
    targetAttrs: baseTargetAttrs(addMaps(stats['2051'])),
    targetEquipmentSet: ['2051'],
    targetEquipmentStats: stats['2051'],
    targetEnabledPassives: ['item_2051_guardians_horn_undaunted_batch_v_a'],
    passiveEffects: [passives['item_2051_guardians_horn_undaunted_batch_v_a']]
  }),
  buildCurve({
    curveId: 'attacker_3004_manamune',
    label: 'Manamune attacker passive +2pct mana AD',
    attackerAttrs: baseAttackerAttrs(),
    targetAttrs: baseTargetAttrs(),
    equipmentSet: ['3004'],
    equipmentStats: stats['3004'],
    enabledPassives: ['item_3004_manamune_awe_batch_v_a'],
    passiveEffects: [passives['item_3004_manamune_awe_batch_v_a']]
  }),
  buildCurve({
    curveId: 'attacker_3036_lord_dominiks',
    label: 'Lord Dominiks target bonus health amp',
    attackerAttrs: baseAttackerAttrs(),
    targetAttrs: baseTargetAttrs({ target_bonus_health: 1500 }),
    equipmentSet: ['3036'],
    equipmentStats: stats['3036'],
    enabledPassives: ['item_3036_lord_dominiks_giant_slayer_batch_v_a'],
    passiveEffects: [passives['item_3036_lord_dominiks_giant_slayer_batch_v_a']]
  }),
  buildCurve({
    curveId: 'target_6665_jaksho',
    label: 'JakSho target full-stack bonus resists',
    attackerAttrs: baseAttackerAttrs(),
    targetAttrs: baseTargetAttrs(addMaps(stats['6665'], { bonus_armor: 100, bonus_magic_resist: 80 })),
    targetEquipmentSet: ['6665'],
    targetEquipmentStats: stats['6665'],
    targetEnabledPassives: ['item_6665_jaksho_voidborn_resilience_batch_v_a'],
    passiveEffects: [passives['item_6665_jaksho_voidborn_resilience_batch_v_a']]
  })
];

const wasmSha256 = createHash('sha256').update(readFileSync(wasmPath)).digest('hex').toUpperCase();
const runInput = {
  caseId: 'V2-BatchV-A-published-wasm-dps-proof-20260620',
  versionCode: current.versionCode,
  wasmSha256,
  simulationRules: {
    durationMs: 1,
    warmupMs: 0,
    sampleBy: 'none',
    attackSpeedCap: 3,
    firstAttackAtMs: 0,
    eventWindowPolicy: 'timeMs < durationMs',
    dotTickIntervalMs: 1000,
    critPolicy: 'expected',
    seed: 0,
    autoAttackPlan: { enabled: true, startAtMs: 0, targetRole: 'target' },
    maxEvents: 10000
  },
  targetSnapshot: actorSnapshot('target', baseTargetAttrs()),
  curves
};

const engineBundle = buildEngineBundle(publicBundle);
const { instance, bytes } = await instantiateWasm();
const exports = instance.exports;
const initRc = callFrame(exports, 'engine_init', 1, engineBundle);
const initFrames = readFrames(exports);
if (initRc !== 0 || !initFrames.some((frame) => frame.kind === 15)) {
  throw new Error(`engine_init failed: rc=${initRc} frames=${JSON.stringify(initFrames)}`);
}
const runRc = callFrame(exports, 'engine_begin_run', 2, runInput);
const runFrames = readFrames(exports);
if (runRc !== 0) throw new Error(`engine_begin_run failed rc=${runRc} frames=${JSON.stringify(runFrames).slice(0, 800)}`);
const done = runFrames.find((frame) => frame.kind === 13)?.payload;
if (!done) throw new Error(`missing done frame: ${JSON.stringify(runFrames).slice(0, 800)}`);

const results = Object.fromEntries(done.curveResults.map((result) => [result.curveId, result]));
for (const [curveId, result] of Object.entries(results)) {
  if (result.status !== 'ok') throw new Error(`${curveId} blocked: ${(result.blockedReasons ?? []).join('; ')}`);
}
assertClose(results.baseline_no_batch_v_a_item.totalDamage, 100, 'baseline totalDamage');
assertClose(results.target_2051_guardians_horn.totalDamage, 85, '2051 totalDamage');
assertClose(results.attacker_3004_manamune.totalDamage, 165, '3004 totalDamage');
assertClose(results.attacker_3036_lord_dominiks.totalDamage, 155.25, '3036 totalDamage');
assertClose(results.target_6665_jaksho.totalDamage, 10000 / 175, '6665 totalDamage');
assertClose(results.attacker_3004_manamune.resolvedSnapshot.attackerSnapshot.attributes.ad, 165, '3004 resolved ad');
assertClose(results.target_6665_jaksho.resolvedSnapshot.targetSnapshot.attributes.armor, 75, '6665 resolved armor');
assertClose(results.target_6665_jaksho.resolvedSnapshot.targetSnapshot.attributes.magic_resist, 69, '6665 resolved mr');
for (const [curveId, bucketKey] of [
  ['target_2051_guardians_horn', 'flat_post_percent'],
  ['attacker_3004_manamune', 'ad_flat_bonus'],
  ['attacker_3036_lord_dominiks', 'outgoing_damage_amp'],
  ['target_6665_jaksho', 'target_armor_flat_bonus'],
  ['target_6665_jaksho', 'target_magic_resist_flat_bonus']
]) {
  if (!findBucket(results[curveId], bucketKey)) throw new Error(`${curveId} missing bucket ${bucketKey}`);
}

const dpsProof = {
  generatedAt: new Date().toISOString(),
  apiBase,
  current,
  wasmPath,
  wasmSizeBytes: bytes.byteLength,
  wasmSha256,
  engineBundleSummary: {
    attributes: engineBundle.attributes.length,
    actions: engineBundle.actions.map((action) => ({ id: action.id, classifier: action.classifier })),
    coefficientBuckets: engineBundle.coefficientBuckets.map((bucket) => ({
      bucketKey: bucket.bucketKey,
      stageKey: bucket.stageKey,
      resolutionDomain: bucket.resolutionDomain,
      targetAttrKey: bucket.targetAttrKey,
      aggregationMode: bucket.aggregationMode,
      bucketConfig: bucket.bucketConfig
    }))
  },
  runInputSummary: {
    caseId: runInput.caseId,
    versionCode: runInput.versionCode,
    simulationRules: runInput.simulationRules,
    curves: runInput.curves.map((curve) => ({
      curveId: curve.curveId,
      equipmentSet: curve.selection.equipmentSet,
      targetEquipmentSet: curve.selection.targetEquipmentSet,
      enabledPassiveEffects: curve.selection.enabledPassiveEffects,
      targetEnabledPassiveEffects: curve.selection.targetEnabledPassiveEffects,
      equipmentStats: curve.resolvedSnapshot.equipmentStats,
      targetEquipmentStats: curve.resolvedSnapshot.targetEquipmentStats,
      attackerAttrs: curve.resolvedSnapshot.attackerSnapshot.attributes,
      targetAttrs: curve.resolvedSnapshot.targetSnapshot.attributes,
      passiveIds: curve.resolvedSnapshot.passiveEffects.map((passive) => passive.passiveId)
    }))
  },
  assertions: {
    baselineTotalDamage: 100,
    guardiansHornTotalDamage: 85,
    manamuneResolvedAdAndDamage: 165,
    lordDominiksDamageAt1500TargetBonusHealth: 155.25,
    jakshoResolvedArmor: 75,
    jakshoResolvedMagicResist: 69,
    jakshoTotalDamageWith75Armor: round(10000 / 175)
  },
  curveResults: done.curveResults.map(summarizeCurve)
};
writeFileSync(dpsProofPath, `${JSON.stringify(dpsProof, null, 2)}\n`, 'utf8');

console.log(JSON.stringify(
  {
    ok: true,
    currentVersion: current.versionCode,
    bundleProofPath,
    dpsProofPath,
    curveTotals: Object.fromEntries(done.curveResults.map((result) => [result.curveId, round(result.totalDamage)])),
    keyBuckets: Object.fromEntries(done.curveResults.map((result) => [result.curveId, summarizeBuckets(result).map((entry) => entry.bucketKey)]))
  },
  null,
  2
));
