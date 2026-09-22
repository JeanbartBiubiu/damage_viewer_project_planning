// 第5项：命中供值与法术护盾的真实 Wasm compile/run/release。
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

const fixturePath = resolve(moduleRoot, "internal/testkit/fixtures/generic_skill_hit.json");
const freshFixture = () => JSON.parse(readFileSync(fixturePath, "utf8"));
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);

function targetSnapshot(done) {
  return done.finalSnapshot.combatants.find((c) => c.key === "target");
}

function skillHits(done) {
  return (done.evidence?.items ?? []).filter((item) => item.kind === "skill_hit");
}

function emitted(done, ref) {
  return (done.evidence?.items ?? []).filter((item) => item.kind === "emitted_event" && item.ref === ref);
}

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
    const target = targetSnapshot(done);
    close(target.attributes.hp.current, 1040, "blocked + owner heal");
    assert.equal(skillHits(done).length, 1);
    close(skillHits(done)[0].data.blocked, 1, "blocked");
    close(skillHits(done)[0].data.firstContact, 1, "firstContact");
    assert.equal(emitted(done, "event/spell_shield_blocked").length, 1);
    assert.equal((target.providers ?? []).filter((p) => p.definitionRef === "shield:spell").length, 0);
    console.log("skill-hit-smoke: restored spell_shield blocked, consumed exact instance, healed owner");
  });

  const unshielded = freshFixture();
  unshielded.runRequest.initialSnapshot.combatants[1].providers = [];
  run(unshielded, (done) => {
    close(targetSnapshot(done).attributes.hp.current, 900, "unshielded damage");
    close(skillHits(done)[0].data.blocked, 0, "unshielded blocked");
    assert.equal(emitted(done, "event/spell_shield_blocked").length, 0);
  });

  const missing = freshFixture();
  missing.runRequest.skillHitFacts = [];
  const compiled = compileCanonicalSession(host.exports, missing);
  try {
    assert.throws(() => invokeFrame(host.exports, "engine_run", FRAME_GENERIC_RUN, {
      ...missing.runRequest, sessionId: compiled.sessionId, expectedRulesHash: compiled.rulesHash,
    }), (error) => {
      assert.match(error.message, /engine_run returned -1/);
      assert.match(error.message, /fact/i);
      return true;
    });
  } finally {
    releaseCanonicalSession(host.exports, compiled.sessionId, compiled.rulesHash);
  }

  const forged = freshFixture();
  forged.compileRequest.sharedProviders[0].abilities.push({
    abilityKey: "forge",
    kind: "active",
    operations: [{ operation: "emit_event", target: "target", eventType: "event/skill_hit" }],
  });
  assert.throws(() => invokeFrame(host.exports, "engine_compile", FRAME_GENERIC_COMPILE, forged.compileRequest), (error) => {
    assert.match(error.message, /engine_compile returned -1/);
    assert.match(error.message, /forge/);
    return true;
  });

  console.log("skill-hit-smoke: compile/run/release, unshielded, missing fact, emit_event forge passed");
}

try {
  await main();
} catch (error) {
  console.error(`skill-hit-smoke: FAILED: ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
}
