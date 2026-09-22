// 第6项：同次使用额度、固定时间窗、前序伤害供值与普通攻击原生事件的真实 Wasm compile/run/release。
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

const fixturePath = resolve(moduleRoot, "internal/testkit/fixtures/generic_p6.json");
const freshFixture = () => JSON.parse(readFileSync(fixturePath, "utf8"));

function sourceBag(done) {
  const source = done.finalSnapshot.combatants.find((c) => c.key === "source");
  return source.providerState["item:p6_shared"];
}

function emitted(done, ref) {
  return (done.evidence?.items ?? []).filter((item) => item.kind === "emitted_event" && item.ref === ref);
}

async function main() {
  const wasmPath = resolve(moduleRoot, "dist", "tinygo_engine_v2.wasm");
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
    const bag = sourceBag(done);
    assert.equal(bag.state.procs, 1, "same-use two skill hits share oncePerUse");
    assert.equal((done.finalSnapshot.useTriggerLedger ?? []).length, 1, "ledger has one committed use");
    assert.equal(emitted(done, "event/skill_hit").length, 2);
    assert.equal(emitted(done, "event/basic_attack_start").length, 1);
    assert.equal(emitted(done, "event/basic_attack_hit").length, 1);
    assert.equal(emitted(done, "event/skill_hit").length, 2);
    console.log("p6-smoke: same-use oncePerUse, native basic_attack start/hit, ledger committed");
  });

  const forged = freshFixture();
  forged.compileRequest.sharedProviders[0].abilities.push({
    abilityKey: "forge",
    kind: "active",
    operations: [{ operation: "emit_event", target: "target", eventType: "event/basic_attack_hit" }],
  });
  assert.throws(() => invokeFrame(host.exports, "engine_compile", FRAME_GENERIC_COMPILE, forged.compileRequest), (error) => {
    assert.match(error.message, /engine_compile returned -1/);
    return true;
  });

  const missing = freshFixture();
  missing.runRequest.skillHitFacts[0].useRef = "";
  const compiled = compileCanonicalSession(host.exports, missing);
  try {
    assert.throws(() => invokeFrame(host.exports, "engine_run", FRAME_GENERIC_RUN, {
      ...missing.runRequest, sessionId: compiled.sessionId, expectedRulesHash: compiled.rulesHash,
    }), (error) => {
      assert.match(error.message, /engine_run returned -1/);
      return true;
    });
  } finally {
    releaseCanonicalSession(host.exports, compiled.sessionId, compiled.rulesHash);
  }

  console.log("p6-smoke: compile/run/release, forge reject, missing use passed");
}

try {
  await main();
} catch (error) {
  console.error(`p6-smoke: FAILED: ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
}
