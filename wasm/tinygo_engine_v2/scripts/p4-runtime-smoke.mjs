// 第4项真实 Wasm 编译、运行、恢复与释放；场景均为明确合成输入。
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { compileCanonicalSession, instantiateGenericHost, moduleRoot, releaseCanonicalSession, runCanonicalSession, withTimeout } from "./generic-abi-host.mjs";

const expr = (value) => ({ op: "const", value });
const slot = (value) => ({ base: value, current: value, max: value, resolved: value });
const moment = (momentType, stepKey = null, failureReason = null) => ({ momentType, stepKey, failureReason });
const ref = (ability, owner = "source", mount = "process") => `${owner}.provider[${mount}].ability[${ability}]`;

function fixture(kind = "CHARGE", releaseAtMaximum = true) {
  const control = (abilityKey, action, extra = {}) => ({ abilityKey, kind: "active", types: ["ability/spell"], skillKey: "synthetic:q", processControl: { processKey: "p", action, ...extra } });
  const step = kind === "CHARGE"
    ? { stepKey: "step", stepType: kind, minimumChargeMs: expr(200), maximumChargeMs: expr(500), releaseAtMaximum }
    : { stepKey: "step", stepType: kind, windowMs: expr(500) };
  const definition = {
    providerKey: "process", kind: "champion", stableId: "synthetic",
    abilities: [control("start", "INITIAL"), control("advance", kind === "CHARGE" ? "CHARGE_RELEASE" : "RECAST", { stepKey: "step" }), control("cancel", "CANCEL", { failureReason: "ACTIVE_CANCELLED" })],
    processes: [{ processKey: "p", skillKey: "synthetic:q", steps: [step], costs: [{ resourceKey: "mana", amount: expr(60) }], cooldown: null, momentOperations: [{ moment: moment("STEP_EXECUTION", "step"), operations: [{ operation: "damage", target: "target", damageType: "damage/physical", amount: expr(100) }] }] }],
  };
  const combatants = ["source", "target"].map((key) => ({ key, attributes: { hp: slot(1000), attack_damage: { ...slot(60), max: 500 } }, resources: { mana: { current: 200, max: 500 }, energy: { current: 20, max: 100 } }, providers: key === "source" ? [{ providerRef: "process", definitionRef: "process" }] : [] }));
  const compileRequest = { schemaVersion: "generic-p0", schemaHash: "schema.p4.r2", rulesHash: "rules.p4.r2", typeCatalog: { types: [{ key: "ability/basic_attack", domain: "ability" }, { key: "ability/spell", domain: "ability" }, { key: "damage/physical", domain: "damage" }, { key: "event/ability_started", domain: "event" }], relations: [] }, combatants, sharedProviders: [definition], rules: {}, formulas: [] };
  const runRequest = { sessionId: "pending", initialSnapshot: { schemaHash: compileRequest.schemaHash, rulesHash: compileRequest.rulesHash, timeMs: 0, processInstances: [], combatants: combatants.map((c) => ({ ...structuredClone(c), cooldowns: {}, providers: c.providers.map((p) => ({ ...p, owner: c.key, source: c.key, stacks: 1, expireAt: null, state: {} })), shields: [], abilityState: {}, providerState: {}, vars: {} })) }, driverPlan: { entries: [] }, skillUses: [{ useKey: "u1", source: "source", skillKey: "synthetic:q", historyState: "complete" }], processCommandFacts: [], stopPolicy: { durationMs: 600 } };
  const f = { compileRequest, runRequest }; entry(f, "start", "start", 0); return f;
}
function entry(f, entryKey, ability, firstAtMs, useRef = "u1", owner = "source", target = "target", mount = "process") {
  f.runRequest.driverPlan.entries.push({ entryKey, abilityRef: ref(ability, owner, mount), source: owner, target, firstAtMs });
  f.runRequest.processCommandFacts.push({ driverEntryKey: entryKey, useRef });
}
const source = (done) => done.finalSnapshot.combatants.find((c) => c.key === "source");
const count = (done, kind, value) => done.evidence.items.filter((e) => e.kind === kind && (value === undefined || e.data?.moment === value)).length;

async function main() {
  const host = await withTimeout(instantiateGenericHost(process.env.P4_WASM_PATH ?? resolve(moduleRoot, "dist/tinygo_engine_v2.wasm")), 30000, "instantiate");
  let checks = 0;
  const session = (f, check) => {
    const compiled = compileCanonicalSession(host.exports, f);
    try { check((r = f.runRequest) => runCanonicalSession(host.exports, { ...f, runRequest: r }, compiled.sessionId, compiled.rulesHash)); checks++; }
    finally { releaseCanonicalSession(host.exports, compiled.sessionId, compiled.rulesHash); }
  };
  for (const [kind, at, auto, damage, rejected] of [["CHARGE", 199, false, 0, 1], ["CHARGE", 200, false, 100, 0], ["CHARGE", 500, false, 0, 1], ["CHARGE", 500, true, 100, 1], ["RECAST", 200, false, 100, 0], ["RECAST", 500, false, 0, 1]]) {
    const f = fixture(kind, auto); entry(f, "advance", "advance", at);
    session(f, (run) => { const done = run(); assert.equal(done.summary.sourceDamageDealt, damage); assert.equal(source(done).resources.mana.current, 140); assert.equal(count(done, "process_rejected"), rejected); assert.equal(count(done, "process_moment", "PROCESS_COMPLETE"), 1); assert.equal(done.evidence.items.filter((e) => e.ref === "event/ability_started").length, 1); });
  }
  const insufficient = fixture(); insufficient.compileRequest.sharedProviders[0].processes[0].costs.push({ resourceKey: "energy", amount: expr(30) });
  session(insufficient, (run) => { const done = run(); assert.equal(source(done).resources.mana.current, 200); assert.equal(source(done).resources.energy.current, 20); assert.equal(done.finalSnapshot.processInstances.length, 0); });

  const refund = fixture(); const p = refund.compileRequest.sharedProviders[0].processes[0];
  p.costs[0].amount = { op: "read", path: "source.attr.attack_damage" };
  p.cooldown = { durationMs: expr(1000), startMoment: moment("PROCESS_FAILURE") };
  p.momentOperations.push({ moment: moment("PROCESS_START"), operations: [{ operation: "attribute_change", target: "self", attributeKey: "attack_damage", valuePolicy: "set", amount: expr(160) }] }, { moment: moment("PROCESS_FAILURE", null, "ACTIVE_CANCELLED"), operations: [{ operation: "resource_change", target: "self", resourceKey: "mana", amount: { op: "read", path: "process.actual_cost.mana" } }, { operation: "cooldown_change", target: "self", abilityRef: "self.provider[process].ability[start]", valuePolicy: "set_remaining", amount: expr(250) }] });
  entry(refund, "cancel", "cancel", 100); entry(refund, "duplicate", "cancel", 200); refund.runRequest.stopPolicy.durationMs = 200;
  session(refund, (run) => { const done = run(); assert.equal(source(done).resources.mana.current, 200); assert.equal(source(done).attributes.attack_damage.base, 160); assert.equal(done.finalSnapshot.processInstances[0].actualCosts.mana, 60); assert.equal(source(done).cooldowns[ref("start")].readyAtMs, 350); assert.equal(count(done, "process_moment", "PROCESS_FAILURE"), 1); });

  const restored = fixture(); restored.runRequest.stopPolicy.durationMs = 100;
  session(restored, (run) => {
    const partial = run(); const r = structuredClone(restored.runRequest); r.initialSnapshot = partial.finalSnapshot; r.driverPlan.entries = []; r.processCommandFacts = []; r.stopPolicy.durationMs = 600;
    const f = { runRequest: r }; entry(f, "advance", "advance", 200); const done = run(r);
    assert.equal(source(done).resources.mana.current, 140); assert.equal(done.summary.sourceDamageDealt, 100); assert.equal(count(done, "process_moment", "PROCESS_START"), 0);
    const terminal = structuredClone(r); terminal.initialSnapshot = done.finalSnapshot; terminal.driverPlan.entries = []; terminal.processCommandFacts = []; terminal.skillUses = [];
    assert.equal(count(run(terminal), "process_moment"), 0);
    const exact = structuredClone(r); exact.initialSnapshot.timeMs = 500; exact.driverPlan.entries[0].firstAtMs = 500;
    const timed = run(exact); assert.equal(count(timed, "process_moment", "STEP_TIMEOUT"), 1); assert.equal(count(timed, "process_rejected"), 1);
    const bad = structuredClone(exact); bad.initialSnapshot.timeMs = 501; bad.driverPlan.entries[0].firstAtMs = 501; assert.throws(() => run(bad), /expiresAtMs/);
    const unknown = structuredClone(r); unknown.initialSnapshot.processInstances[0].unexpected = true; assert.throws(() => run(unknown), /unexpected/);
  });

  const additive = fixture(); additive.compileRequest.sharedProviders[0].processes[0].costs.push({ resourceKey: "mana", amount: expr(10) });
  session(additive, (run) => { const done = run(); assert.equal(source(done).resources.mana.current, 130); assert.equal(done.finalSnapshot.processInstances[0].actualCosts.mana, 70); });
  const negative = fixture(); negative.compileRequest.sharedProviders[0].abilities[0].params = { bad: -10 }; negative.compileRequest.sharedProviders[0].processes[0].costs.push({ resourceKey: "mana", amount: { op: "read", path: "ability.param.bad" } });
  session(negative, (run) => assert.throws(() => run(), /cost must be finite and non-negative/));
  const unknown = fixture(); unknown.compileRequest.sharedProviders[0].processes[0].steps[0].unknown = 1; assert.throws(() => compileCanonicalSession(host.exports, unknown), /unknown/);
  console.log(`p4-runtime-smoke: ${checks} sessions passed; timing, atomic costs, frozen refund, cancellation cooldown, active/terminal/exact-expiry recovery, strict JSON; compile/run/release verified`);
}

try { await main(); } catch (error) { console.error(error.stack ?? error); process.exitCode = 1; }
