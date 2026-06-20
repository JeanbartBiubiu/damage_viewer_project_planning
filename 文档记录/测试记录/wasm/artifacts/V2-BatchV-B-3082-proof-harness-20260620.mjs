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
const versionCode = 'v2_batch_v_b_3082_wardens_mail_001';
const itemId = '3082';
const itemName = '守望者铠甲';
const skillId = 'item_3082_wardens_mail_rock_solid_batch_v_b';
const formulaId = 'formula_3082_rock_solid_final_damage';
const bucketKey = 'wardens_mail_post_mitigation_final';
const artifactDir = join(projectRoot, '\u6587\u6863\u8bb0\u5f55', '\u6d4b\u8bd5\u8bb0\u5f55', 'wasm', 'artifacts');
const bundleProofPath = join(artifactDir, 'V2-BatchV-B-3082-published-bundle-proof-20260620.json');
const dpsProofPath = join(artifactDir, 'V2-BatchV-B-3082-wasm-dps-proof-20260620.json');

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

function attrValue(value) {
  return { base: value, current: value, max: value, resolved: value, hasCurrent: true, hasMax: true };
}

function toActorTemplateAttrs(attrs) {
  return Object.fromEntries(Object.entries(attrs).map(([key, value]) => [key, attrValue(value)]));
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

function buildEngineBundle(publicBundle, formulaProfile, bucket) {
  const attrKeys = new Set((publicBundle.attributeDefinitions ?? []).map((definition) => definition.attrKey).filter(Boolean));
  for (const key of [
    'attack_damage',
    'ad',
    'attack_speed',
    'crit_chance',
    'crit_damage',
    'hp',
    'armor',
    'magic_resist',
    'armor_pen_percent',
    'armor_pen_flat',
    'magic_pen_percent',
    'magic_pen_flat'
  ]) {
    attrKeys.add(key);
  }
  const formulas = [
    { id: 'as_floor', op: 'const', value: 0.01 },
    { id: 'as_cap', op: 'const', value: 3 },
    { id: 'thousand', op: 'const', value: 1000 },
    { id: 'attack_damage', op: 'attr', attr: 'attack_damage' },
    { id: 'attack_speed', op: 'attr', attr: 'attack_speed' },
    { id: 'as_capped_low', op: 'max', left: 'attack_speed', right: 'as_floor' },
    { id: 'as_capped', op: 'min', left: 'as_capped_low', right: 'as_cap' },
    { id: 'aa_cooldown_ms', op: 'div', left: 'thousand', right: 'as_capped' },
    ...(formulaProfile.params?.engineDefinitions ?? [])
  ];
  return {
    schemaVersion: 1,
    attributes: Array.from(attrKeys).map((id) => (id === 'crit_damage' ? { id, defaultBase: 1 } : { id })),
    actors: [
      {
        id: 'dps_attacker',
        maxHp: 10000,
        initialHp: 10000,
        attributes: toActorTemplateAttrs({
          attack_damage: 100,
          ad: 100,
          attack_speed: 1,
          crit_chance: 0,
          crit_damage: 1
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
          magic_resist: 0
        }),
        actions: []
      }
    ],
    actions: [
      {
        id: 'basic_attack',
        label: 'Batch V B 3082 proof basic attack',
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
    formulas,
    coefficientBuckets: [bucket],
    settings: { maxEvents: 10000, maxCommandsPerEvent: 64 }
  };
}

function actorSnapshot(role, attrs, hp = 10000) {
  const isTarget = role === 'target';
  return {
    actorId: isTarget ? 'target_dummy_fighter' : 'dps_attacker',
    templateId: isTarget ? 'target_dummy_fighter' : 'dps_attacker',
    name: isTarget ? 'Target Dummy Fighter' : 'Batch V B 3082 Attacker',
    level: 1,
    types: isTarget ? ['target_dummy'] : ['champion'],
    currentHp: hp,
    maxHp: hp,
    attributes: attrs
  };
}

function buildCurve({ curveId, label, ad, targetAttrs, targetEquipmentStats, passive }) {
  const attackerAttrs = { attack_damage: ad, ad, attack_speed: 1, crit_chance: 0, crit_damage: 1 };
  return {
    curveId,
    label,
    selection: {
      heroId: 'dps_attacker',
      heroLevel: 1,
      targetId: 'target_dummy_fighter',
      targetType: 'target_dummy',
      skillLevels: {},
      equipmentSet: [],
      enabledPassiveEffects: [],
      targetEquipmentSet: passive ? [itemId] : [],
      targetEnabledPassiveEffects: passive ? [skillId] : [],
      scenarioStates: [],
      critPolicy: 'expected'
    },
    resolvedSnapshot: {
      basicAttackActions: [
        { actionId: 'basic_attack', skillId: 'skill_lol_basic_attack_default', classifier: { types: ['action/basic_attack'] } }
      ],
      attackerSnapshot: actorSnapshot('attacker', attackerAttrs),
      targetSnapshot: actorSnapshot('target', targetAttrs),
      equipmentSet: [],
      equipmentStats: {},
      enabledPassiveEffects: [],
      targetEquipmentSet: passive ? [itemId] : [],
      targetEquipmentStats: targetEquipmentStats ?? {},
      targetEnabledPassiveEffects: passive ? [skillId] : [],
      passiveEffects: passive ? [passive] : [],
      externalPassiveEffects: [],
      scenarioStates: [],
      runeStatAdjustments: {}
    }
  };
}

function summarizeBuckets(result) {
  return (result.effectBreakdown ?? [])
    .filter((entry) => entry.coefficientBucket)
    .map((entry) => ({
      timeMs: entry.timeMs,
      source: entry.source,
      kind: entry.kind,
      amount: round(entry.amount),
      ...entry.coefficientBucket
    }));
}

function round(value) {
  return typeof value === 'number' ? Number(value.toFixed(6)) : value;
}

function summarizeCurve(result) {
  const firstDamage = result.damageTimeline?.[0];
  return {
    curveId: result.curveId,
    status: result.status,
    blockedReasons: result.blockedReasons ?? [],
    totalDamage: round(result.totalDamage),
    firstDamage: firstDamage
      ? {
          rawDamage: round(firstDamage.rawDamage),
          finalDamage: round(firstDamage.finalDamage),
          targetHpBefore: round(firstDamage.targetHpBefore),
          targetHpAfter: round(firstDamage.targetHpAfter)
        }
      : null,
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
if (current.versionCode !== versionCode) {
  throw new Error(`current versionCode=${current.versionCode}, expected ${versionCode}`);
}
const publicBundle = await getJson(`${apiBase}/api/games/lol/versions/${versionCode}/bundle`);
mkdirSync(artifactDir, { recursive: true });

const item = publicBundle.items.find((candidate) => candidate.itemId === itemId);
const skill = publicBundle.skills.find((candidate) => candidate.skillId === skillId);
const formulaProfile = publicBundle.formulaProfiles.find((candidate) => candidate.formulaId === formulaId);
const bucket = publicBundle.coefficientBuckets.find((candidate) => candidate.bucketKey === bucketKey);
const passive = JSON.parse(JSON.stringify(skill?.mechanicsConfig?.dpsPassiveEffects?.[0] ?? null));
const itemStats = mapItemStats(item);

const bundleProof = {
  generatedAt: new Date().toISOString(),
  apiBase,
  current,
  item: {
    found: Boolean(item),
    itemId: item?.itemId,
    name: item?.name,
    skillRefs: item?.skillRefs ?? [],
    statModifiers: item?.statModifiers ?? []
  },
  skill: {
    found: Boolean(skill),
    skillId: skill?.skillId,
    name: skill?.name,
    ownerType: skill?.ownerType,
    ownerId: skill?.ownerId,
    passive
  },
  formulaProfile: {
    found: Boolean(formulaProfile),
    formulaId: formulaProfile?.formulaId,
    formulaKind: formulaProfile?.formulaKind,
    formulaText: formulaProfile?.params?.formulaText,
    engineDefinitions: formulaProfile?.params?.engineDefinitions ?? []
  },
  bucket: {
    found: Boolean(bucket),
    bucketKey: bucket?.bucketKey,
    resolutionDomain: bucket?.resolutionDomain,
    stageKey: bucket?.stageKey,
    aggregationMode: bucket?.aggregationMode,
    bucketConfig: bucket?.bucketConfig
  }
};
writeFileSync(bundleProofPath, `${JSON.stringify(bundleProof, null, 2)}\n`, 'utf8');

if (!item || item.name !== itemName || !item.skillRefs?.includes(skillId)) throw new Error('3082 item proof failed');
if (!skill || !passive || passive.ownerRole !== 'target') throw new Error('3082 skill/passive proof failed');
if (passive.operations?.[0]?.bucketKey !== bucketKey || passive.operations?.[0]?.valueSpec?.formulaId !== formulaId) {
  throw new Error('3082 passive operation proof failed');
}
if (!formulaProfile || formulaProfile.params?.formulaText !== 'max(x - 15, x * 0.8)') throw new Error('3082 formula proof failed');
if (!bucket || bucket.stageKey !== 'hp_change/final/post_mitigation' || bucket.aggregationMode !== 'set_final') {
  throw new Error('3082 bucket proof failed');
}

const curves = [
  buildCurve({
    curveId: 'baseline_no_3082',
    label: 'Baseline no 3082',
    ad: 100,
    targetAttrs: { hp: 10000, armor: 0, magic_resist: 0 }
  }),
  buildCurve({
    curveId: 'target_3082_formula_input_100',
    label: '守望者铠甲 formula input 100',
    ad: 100,
    targetAttrs: { hp: 10000, armor: 0, magic_resist: 0 },
    passive
  }),
  buildCurve({
    curveId: 'target_3082_formula_input_40',
    label: '守望者铠甲 formula input 40',
    ad: 40,
    targetAttrs: { hp: 10000, armor: 0, magic_resist: 0 },
    passive
  }),
  buildCurve({
    curveId: 'target_3082_formula_input_10',
    label: '守望者铠甲 formula input 10',
    ad: 10,
    targetAttrs: { hp: 10000, armor: 0, magic_resist: 0 },
    passive
  }),
  buildCurve({
    curveId: 'target_3082_with_40_armor_stat',
    label: '守望者铠甲 with 40 armor stat',
    ad: 100,
    targetAttrs: { hp: 10000, armor: itemStats.armor, magic_resist: 0 },
    targetEquipmentStats: itemStats,
    passive
  })
];

const wasmSha256 = createHash('sha256').update(readFileSync(wasmPath)).digest('hex').toUpperCase();
const runInput = {
  caseId: 'V2-BatchV-B-3082-published-wasm-dps-proof-20260620',
  versionCode,
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
  targetSnapshot: actorSnapshot('target', { hp: 10000, armor: 0, magic_resist: 0 }),
  curves
};

const engineBundle = buildEngineBundle(publicBundle, formulaProfile, bucket);
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
assertClose(results.baseline_no_3082.totalDamage, 100, 'baseline totalDamage');
assertClose(results.target_3082_formula_input_100.totalDamage, 85, 'input100 totalDamage');
assertClose(results.target_3082_formula_input_40.totalDamage, 32, 'input40 totalDamage');
assertClose(results.target_3082_formula_input_10.totalDamage, 8, 'input10 totalDamage');
assertClose(results.target_3082_with_40_armor_stat.totalDamage, 400 / 7, '3082 with armor totalDamage');

for (const curveId of [
  'target_3082_formula_input_100',
  'target_3082_formula_input_40',
  'target_3082_formula_input_10',
  'target_3082_with_40_armor_stat'
]) {
  const found = summarizeBuckets(results[curveId]).some((entry) => entry.bucketKey === bucketKey);
  if (!found) throw new Error(`${curveId} missing coefficient bucket evidence`);
}

const dpsProof = {
  generatedAt: new Date().toISOString(),
  caseId: runInput.caseId,
  versionCode,
  wasmPath,
  wasmBytes: bytes.length,
  wasmSha256,
  expectations: {
    baseline_no_3082: 100,
    target_3082_formula_input_100: 85,
    target_3082_formula_input_40: 32,
    target_3082_formula_input_10: 8,
    target_3082_with_40_armor_stat: round(400 / 7)
  },
  curves: done.curveResults.map(summarizeCurve)
};
writeFileSync(dpsProofPath, `${JSON.stringify(dpsProof, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  ok: true,
  versionCode,
  bundleProofPath,
  dpsProofPath,
  wasmSha256,
  totals: Object.fromEntries(Object.entries(results).map(([key, result]) => [key, round(result.totalDamage)]))
}, null, 2));
