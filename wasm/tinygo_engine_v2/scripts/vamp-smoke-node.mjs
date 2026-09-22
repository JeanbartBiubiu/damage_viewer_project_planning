// 通用吸血专项验证：复用正式通用协议和共享 Node 宿主接线。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  compileCanonicalSession,
  FRAME_GENERIC_COMPILE,
  FRAME_GENERIC_RUN,
  instantiateGenericHost,
  invokeFrame,
  moduleRoot,
  releaseCanonicalSession,
  runCanonicalSession,
  withTimeout,
} from "./generic-abi-host.mjs";

const fixturePath = resolve(moduleRoot, "internal/testkit/fixtures/generic_vamp_damage.json");
const freshFixture = () => JSON.parse(readFileSync(fixturePath, "utf8"));
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);

async function main() {
  const wasmPath = resolve(moduleRoot, "dist/tinygo_engine_v2.wasm");
  const host = await withTimeout(instantiateGenericHost(wasmPath), 30000, "instantiate");
  const run = (fixture, check) => {
    const compiled = compileCanonicalSession(host.exports, fixture);
    try {
      const done = runCanonicalSession(host.exports, fixture, compiled.sessionId, compiled.rulesHash);
      check(done);
    } finally {
      releaseCanonicalSession(host.exports, compiled.sessionId, compiled.rulesHash);
    }
  };

  run(freshFixture(), (done) => {
    const events = done.evidence.items.filter((item) => item.kind === "vamp");
    assert.equal(events.length, 1);
    const data = events[0].data;
    for (const [key, value] of Object.entries({
      postDefenseDamage: 50, shieldAbsorbed: 20, actualHpLoss: 20, overkillDamage: 10,
      healingBeforeModifiers: 15, healingAfterDone: 18, healingAfterModifiers: 10.8,
      actualHealing: 5, overheal: 5.8,
    })) close(data[key], value, key);
    assert.deepEqual(data.contributions.map((x) => x.vampType), ["LIFE_STEAL", "OMNIVAMP"]);
    assert.deepEqual(data.modifiers.map((x) => x.direction), ["DONE", "RECEIVED"]);
    assert.equal(done.evidence.items.find((item) => item.kind === "damage").data.damageId, data.damageId);
    console.log(`vamp-smoke: decomposition and healing passed ${JSON.stringify(data)}`);
  });

  const disabled = freshFixture();
  disabled.compileRequest.sharedProviders[0].abilities[0].operations[0].vampOverrides = [
    { vampType: "OMNIVAMP", mode: "DISABLED" }, { vampType: "LIFE_STEAL", mode: "DISABLED" },
  ];
  disabled.expectedSummarySubset.sourceFinalHp = 95;
  run(disabled, (done) => {
    const data = done.evidence.items.find((item) => item.kind === "vamp").data;
    assert.equal(data.actualHealing, 0);
    assert.equal(data.skippedReason, "no_qualifying_rule");
  });

  const actual = freshFixture();
  actual.compileRequest.sharedProviders[0].modifiers = [];
  actual.compileRequest.sharedProviders[0].abilities[0].operations[0].vampOverrides = [
    { vampType: "LIFE_STEAL", mode: "DISABLED" },
    { vampType: "OMNIVAMP", mode: "OVERRIDE", basisOutputKind: "ACTUAL_HP_LOSS", efficiency: { op: "const", value: 1 } },
  ];
  actual.expectedSummarySubset.sourceFinalHp = 99;
  run(actual, (done) => {
    const data = done.evidence.items.find((item) => item.kind === "vamp").data;
    close(data.contributions[0].basis, 20, "actual HP basis");
    close(data.actualHealing, 4, "actual HP healing");
  });

  const unresolved = freshFixture();
  unresolved.compileRequest.sharedProviders[0].abilities[0].operations[0].vampQualification = "UNRESOLVED";
  assert.throws(() => invokeFrame(host.exports, "engine_compile", FRAME_GENERIC_COMPILE, unresolved.compileRequest), (error) => {
    assert.match(error.message, /engine_compile returned -1/);
    assert.match(error.message, /vampQualification/);
    assert.match(error.message, /UNRESOLVED/);
    return true;
  });

  const missing = freshFixture();
  delete missing.runRequest.initialSnapshot.combatants[0].attributes.omnivamp_percent;
  const compiled = compileCanonicalSession(host.exports, missing);
  try {
    assert.throws(() => invokeFrame(host.exports, "engine_run", FRAME_GENERIC_RUN, {
      ...missing.runRequest, sessionId: compiled.sessionId, expectedRulesHash: compiled.rulesHash,
    }), (error) => {
      assert.match(error.message, /engine_run returned -1/);
      assert.match(error.message, /missing vamp source attribute/);
      assert.match(error.message, /"path":"combatants\[source\].attributes.omnivamp_percent"/);
      return true;
    });
  } finally {
    releaseCanonicalSession(host.exports, compiled.sessionId, compiled.rulesHash);
  }
  console.log("vamp-smoke: inherit, disabled, override, unresolved, missing attribute, compile/run/release passed");
}

try {
  await main();
} catch (error) {
  console.error(`vamp-smoke: FAILED: ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
}
