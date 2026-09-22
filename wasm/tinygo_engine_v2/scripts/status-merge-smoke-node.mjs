// 第7项：普通减速跨来源取强与重伤 ratio_max 的真实 Wasm compile/run/release。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  compileCanonicalSession,
  instantiateGenericHost,
  moduleRoot,
  releaseCanonicalSession,
  runCanonicalSession,
  withTimeout,
} from "./generic-abi-host.mjs";

const slowPath = resolve(moduleRoot, "internal/testkit/fixtures/generic_status_merge_slow.json");
const healPath = resolve(moduleRoot, "internal/testkit/fixtures/generic_heal_ratio_max.json");
const load = (path) => JSON.parse(readFileSync(path, "utf8"));
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);

function targetSnapshot(done) {
  return done.finalSnapshot.combatants.find((c) => c.key === "target");
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

  run(load(slowPath), (done) => {
    const target = targetSnapshot(done);
    assert.ok(Array.isArray(target.effectiveStatuses));
    assert.equal(target.effectiveStatuses.length, 1);
    close(target.effectiveStatuses[0].strength, 0.3, "recovered slow");
    assert.equal(target.effectiveStatuses[0].contributions.length, 1);
    close(target.effectiveStatuses[0].contributions[0].strength, 0.3, "remaining contribution");
    const kinds = done.evidence.items.map((item) => item.kind);
    assert.ok(kinds.includes("provider_apply"));
    assert.ok(kinds.includes("provider_expire"));
    console.log("status-merge-smoke: 30%/70% slow recovered to 30% after 70% expired");
  });

  const weaker = load(slowPath);
  weaker.compileRequest.sharedProviders.splice(2, 1);
  weaker.compileRequest.sharedProviders[1].statusContributions[0].strength = { op: "read", path: "ability.param.strength" };
  weaker.compileRequest.sharedProviders[0].abilities = [
    {
      abilityKey: "strong",
      kind: "active",
      types: ["ability/common"],
      params: { strength: 0.7 },
      operations: [{ operation: "apply_provider", target: "target", providerDefinitionRef: "status:slow30" }],
    },
    {
      abilityKey: "weak",
      kind: "active",
      types: ["ability/common"],
      params: { strength: 0.3 },
      operations: [{ operation: "apply_provider", target: "target", providerDefinitionRef: "status:slow30" }],
    },
  ];
  weaker.compileRequest.sharedProviders[1].lifecycle.durationMs.value = 1000;
  weaker.runRequest.driverPlan.entries = [
    { entryKey: "strong", abilityRef: "source.provider[champion:source_demo].ability[strong]", source: "source", target: "target", firstAtMs: 0 },
    { entryKey: "weak", abilityRef: "source.provider[champion:source_demo].ability[weak]", source: "source", target: "target", firstAtMs: 500 },
  ];
  weaker.runRequest.stopPolicy.durationMs = 1200;
  run(weaker, (done) => {
    const target = targetSnapshot(done);
    close(target.effectiveStatuses[0].strength, 0.3, "weaker reapply");
    assert.equal(target.providers.filter((p) => p.definitionRef === "status:slow30").length, 1);
    assert.equal(target.providers[0].expireAt, 1500);
    assert.ok(done.evidence.items.some((item) => item.kind === "provider_refresh"));
    console.log("status-merge-smoke: same-source weaker reapply replaced instead of keeping max");
  });

  run(load(healPath), (done) => {
    close(done.summary.targetFinalHp, 160, "two 40% wounds on 100 heal");
    const heal = done.evidence.items.find((item) => item.kind === "heal");
    assert.ok(heal);
    close(heal.data.healingAfterModifiers, 60, "heal after ratio_max");
    close(heal.data.actualHealing, 60, "actual healing");
    console.log("status-merge-smoke: two 40% wounds keep 40% reduction (100 -> 60)");
  });

  console.log("status-merge-smoke: compile/run/release output passed");
}

try {
  await main();
} catch (error) {
  console.error(`status-merge-smoke: FAILED: ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
}
