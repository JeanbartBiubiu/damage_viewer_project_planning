#!/usr/bin/env node
/**
 * Deterministic unit checks for path containment, porcelain parsing, signatures, and audit delta.
 * Run: node .agents/skills/cursor-local-agent/scripts/cursor_local_agent_path_policy.test.mjs
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildPathSignatureMap,
  classifyChanges,
  classifyDeltaPaths,
  contentSignatureForPath,
  diffPathSignatures,
  isPathInside,
  isUnderAllowedPath,
  normalizeAllowedPaths,
  parseGitStatusPorcelainZ,
  parseGitStatusShort,
  resolveContainedPath,
  untrackedFileMetadata,
} from "./cursor_local_agent_path_policy.mjs";

const cwd = "C:\\project\\damage_viewer_project_planning";

function testContainment() {
  assert.equal(isPathInside(cwd, join(cwd, "AGENTS.md")), true);
  assert.equal(isPathInside(cwd, join(cwd, "docs", "a.md")), true);
  assert.equal(isPathInside(cwd, cwd), true);
  assert.equal(isPathInside(cwd, join(cwd, "..", "other")), false);
  assert.equal(isPathInside(cwd, "C:\\Windows\\System32"), false);
}

function testResolve() {
  const ok = resolveContainedPath(cwd, "文档记录");
  assert.equal(ok.relative, "文档记录");
  assert.throws(() => resolveContainedPath(cwd, "..\\damage_web_dev"), /escapes/);
  assert.throws(() => resolveContainedPath(cwd, ""), /non-empty/);
  assert.throws(() => normalizeAllowedPaths(cwd, []), /at least one/);
  const multi = normalizeAllowedPaths(cwd, ["AGENTS.md", "./AGENTS.md", "README.md"]);
  assert.equal(multi.length, 2);
}

function testChinesePathInScope() {
  assert.equal(isUnderAllowedPath("文档记录/详细设计/a.md", ["文档记录"]), true);
  assert.equal(isUnderAllowedPath("文档记录/详细设计/Cursor协同开发流程说明.md", ["文档记录"]), true);

  const entries = parseGitStatusShort("?? 文档记录/新文件.md\n");
  assert.equal(entries[0].relativePath, "文档记录/新文件.md");
  const { inScope, outsideScope } = classifyChanges(entries, ["文档记录"]);
  assert.equal(inScope.length, 1);
  assert.equal(outsideScope.length, 0);

  const z = Buffer.from("?? 文档记录/新文件.md\0", "utf8");
  const zEntries = parseGitStatusPorcelainZ(z);
  assert.equal(zEntries[0].relativePath, "文档记录/新文件.md");
  const classified = classifyChanges(zEntries, ["文档记录"]);
  assert.equal(classified.inScope.length, 1);
}

function testRenameBoundary() {
  const entries = parseGitStatusShort(
    ["R  web/src/a.ts -> 文档记录/a.ts", "R  文档记录/b.ts -> web/src/b.ts"].join("\n"),
  );
  assert.equal(entries[0].fromPath, "web/src/a.ts");
  assert.equal(entries[0].relativePath, "文档记录/a.ts");
  assert.deepEqual(entries[0].paths, ["web/src/a.ts", "文档记录/a.ts"]);

  const { inScope, outsideScope } = classifyChanges(entries, ["文档记录"]);
  assert.equal(inScope.length, 0);
  assert.equal(outsideScope.length, 2);

  // porcelain -z order: destination NUL source NUL
  const zRename = Buffer.concat([
    Buffer.from("R  文档记录/a.ts\0", "utf8"),
    Buffer.from("web/src/a.ts\0", "utf8"),
  ]);
  const zEntries = parseGitStatusPorcelainZ(zRename);
  assert.equal(zEntries.length, 1);
  assert.equal(zEntries[0].fromPath, "web/src/a.ts");
  assert.equal(zEntries[0].relativePath, "文档记录/a.ts");
  const zClassified = classifyChanges(zEntries, ["文档记录"]);
  assert.equal(zClassified.outsideScope.length, 1);
}

function testUntrackedMetadataOnly() {
  const root = mkdtempSync(join(tmpdir(), "cursor-path-policy-"));
  const rel = "文档记录/secret-ish.txt";
  mkdirSync(join(root, "文档记录"), { recursive: true });
  const body = "super-secret-token-do-not-copy";
  writeFileSync(join(root, rel), body, "utf8");
  const meta = untrackedFileMetadata(root, rel);
  assert.equal(meta.path, rel);
  assert.equal(meta.size, Buffer.byteLength(body));
  assert.equal(meta.sha256, createHash("sha256").update(body).digest("hex"));
  assert.equal(JSON.stringify(meta).includes("super-secret"), false);
}

function testSignatureDelta() {
  const root = mkdtempSync(join(tmpdir(), "cursor-path-policy-sig-"));
  mkdirSync(join(root, "文档记录"), { recursive: true });
  mkdirSync(join(root, "web", "src"), { recursive: true });
  writeFileSync(join(root, "web", "src", "preexisting.ts"), "v1", "utf8");
  writeFileSync(join(root, "文档记录", "in-scope.md"), "ok", "utf8");

  const beforeEntries = parseGitStatusShort(
    [" M web/src/preexisting.ts", " M 文档记录/in-scope.md"].join("\n"),
  );
  const beforeMap = buildPathSignatureMap(root, beforeEntries);

  // Unchanged pre-existing outside-scope dirt: same content signature.
  writeFileSync(join(root, "web", "src", "fresh.ts"), "new", "utf8");
  writeFileSync(join(root, "web", "src", "preexisting.ts"), "v2", "utf8");
  writeFileSync(join(root, "文档记录", "in-scope.md"), "ok2", "utf8");

  const afterEntries = parseGitStatusShort(
    [
      " M web/src/preexisting.ts",
      "?? web/src/fresh.ts",
      " M 文档记录/in-scope.md",
    ].join("\n"),
  );
  const afterMap = buildPathSignatureMap(root, afterEntries);
  const delta = diffPathSignatures(beforeMap, afterMap);
  const deltaPaths = delta.map((item) => item.path).sort();
  assert.deepEqual(deltaPaths, [
    "web/src/fresh.ts",
    "web/src/preexisting.ts",
    "文档记录/in-scope.md",
  ]);

  // Simulate unchanged outside dirt by restoring preexisting content and rebuilding after map.
  writeFileSync(join(root, "web", "src", "preexisting.ts"), "v1", "utf8");
  const afterUnchangedOutside = buildPathSignatureMap(
    root,
    parseGitStatusShort(
      [" M web/src/preexisting.ts", "?? web/src/fresh.ts", " M 文档记录/in-scope.md"].join("\n"),
    ),
  );
  // Force before/after status+content equal for preexisting by copying before signature.
  afterUnchangedOutside.set("web/src/preexisting.ts", beforeMap.get("web/src/preexisting.ts"));
  const delta2 = diffPathSignatures(beforeMap, afterUnchangedOutside);
  const outsideDelta = classifyDeltaPaths(delta2, ["文档记录"]).outsideScope.map((item) => item.path);
  assert.deepEqual(outsideDelta, ["web/src/fresh.ts"]);
  assert.equal(outsideDelta.includes("web/src/preexisting.ts"), false);

  // Newly changed outside-scope file fails.
  const failDelta = classifyDeltaPaths(delta, ["文档记录"]);
  assert.ok(failDelta.outsideScope.some((item) => item.path === "web/src/fresh.ts"));
  assert.ok(failDelta.outsideScope.some((item) => item.path === "web/src/preexisting.ts"));

  // Content signature marker for missing path.
  assert.equal(contentSignatureForPath(root, "no-such-file.txt"), "missing");
}

function testUnreadableFailsClosed() {
  const root = mkdtempSync(join(tmpdir(), "cursor-path-policy-unreadable-"));
  const rel = "文档记录/unreadable.bin";
  const io = {
    existsSync: () => true,
    statSync: () => {
      const err = new Error("EACCES: permission denied");
      err.code = "EACCES";
      throw err;
    },
    readFileSync: () => {
      throw new Error("should not read after stat failure");
    },
  };

  assert.throws(
    () => contentSignatureForPath(root, rel, io),
    /audited path unreadable/,
  );
  assert.throws(
    () => buildPathSignatureMap(root, parseGitStatusShort(` M ${rel}\n`), io),
    /audited path unreadable/,
  );

  // Missing remains a valid deletion marker (not an error signature).
  assert.equal(contentSignatureForPath(root, "文档记录/gone.txt"), "missing");
}

function testClassifyBasics() {
  assert.equal(isUnderAllowedPath("文档记录/a.md", ["文档记录"]), true);
  assert.equal(isUnderAllowedPath("web/src/a.ts", ["文档记录"]), false);
  assert.equal(isUnderAllowedPath("AGENTS.md", ["AGENTS.md"]), true);
  assert.equal(isUnderAllowedPath("tools/x.mjs", ["."]), true);

  const entries = parseGitStatusShort(
    [" M AGENTS.md", "?? 文档记录/new.md", " M web/src/a.ts", "R  old.md -> 文档记录/renamed.md"].join(
      "\n",
    ),
  );
  assert.equal(entries.length, 4);
  assert.equal(entries[3].relativePath, "文档记录/renamed.md");
  assert.equal(entries[3].fromPath, "old.md");

  const { inScope, outsideScope } = classifyChanges(entries, ["文档记录", "AGENTS.md"]);
  // rename old.md -> 文档记录/renamed.md crosses boundary because old.md is outside
  assert.equal(inScope.length, 2);
  assert.equal(outsideScope.length, 2);
  assert.ok(outsideScope.some((entry) => entry.relativePath === "web/src/a.ts"));
  assert.ok(outsideScope.some((entry) => entry.relativePath === "文档记录/renamed.md"));
}

testContainment();
testResolve();
testClassifyBasics();
testChinesePathInScope();
testRenameBoundary();
testUntrackedMetadataOnly();
testSignatureDelta();
testUnreadableFailsClosed();
console.log("cursor_local_agent_path_policy.test.mjs: PASS");
