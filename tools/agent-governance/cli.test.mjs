#!/usr/bin/env node
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkoutDirectoryName,
  filterWorktreesForAudit,
  loadManifest,
} from "./cli.mjs";

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const manifest = loadManifest(join(TOOL_DIR, "shared-files.json"));

assert.deepEqual(manifest.canonicalCheckoutDirectoryNames, [
  "damage_viewer_project_planning",
  "damage_backend_dev",
  "damage_web_dev",
  "damage_wasm_dev",
]);
assert.ok(manifest.files.includes("AGENTS.md"));

assert.equal(
  checkoutDirectoryName("C:\\project\\damage_wasm_dev"),
  "damage_wasm_dev",
);

const base = "C:\\project\\damage_viewer_project_planning";
const canonical = manifest.canonicalCheckoutDirectoryNames;
const worktrees = [
  { path: base, bare: false, detached: false, branch: "refs/heads/master" },
  {
    path: "C:\\project\\damage_backend_dev",
    bare: false,
    detached: false,
    branch: "refs/heads/backend/dev",
  },
  {
    path: "C:\\project\\damage_web_dev",
    bare: false,
    detached: false,
    branch: "refs/heads/web/dev",
  },
  {
    path: "C:\\project\\damage_wasm_dev",
    bare: false,
    detached: false,
    branch: "refs/heads/wasm/dev",
  },
  // Extra long-lived-looking branches whose checkout dirs are NOT canonical.
  {
    path: "C:\\project\\damage_wasm_feature",
    bare: false,
    detached: false,
    branch: "refs/heads/wasm/feature",
  },
  {
    path: "C:\\project\\damage_web_test",
    bare: false,
    detached: false,
    branch: "refs/heads/web/test",
  },
  {
    path: "C:\\Users\\x\\.codex\\worktrees\\04c2\\damage_viewer_project_planning",
    bare: false,
    detached: true,
    branch: null,
  },
  {
    path: "C:\\Users\\x\\.codex\\worktrees\\tmp-1",
    bare: false,
    detached: true,
    branch: null,
  },
  {
    path: "C:\\Users\\x\\.codex\\worktrees\\tmp-2",
    bare: false,
    detached: false,
    branch: "refs/heads/codex/scratch",
  },
];

const filtered = filterWorktreesForAudit(worktrees, base, {
  allWorktrees: false,
  canonicalCheckoutDirectoryNames: canonical,
});
assert.equal(filtered.length, 4);
assert.deepEqual(
  filtered.map((item) => checkoutDirectoryName(item.path)).sort(),
  [
    "damage_backend_dev",
    "damage_viewer_project_planning",
    "damage_wasm_dev",
    "damage_web_dev",
  ],
);
assert.equal(
  filtered.some((item) => checkoutDirectoryName(item.path) === "damage_wasm_feature"),
  false,
);
assert.equal(
  filtered.some((item) => checkoutDirectoryName(item.path) === "damage_web_test"),
  false,
);
assert.equal(
  filtered.some((item) => String(item.path).includes(".codex")),
  false,
);

const all = filterWorktreesForAudit(worktrees, base, {
  allWorktrees: true,
  canonicalCheckoutDirectoryNames: canonical,
});
assert.equal(all.length, 9);

console.log("tools/agent-governance/cli.test.mjs: PASS");
