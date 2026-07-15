#!/usr/bin/env node
/**
 * Read-only normalized shared-file audit across sibling git worktrees.
 * Discovers worktrees via `git worktree list`, compares explicitly listed
 * governance files with EOL normalization, reports drift. Never copies or mutates.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TOOL_DIR, "..", "..");
const MANIFEST_FILE = join(TOOL_DIR, "shared-files.json");

function printUsage() {
  console.log(`Usage:
  node tools/agent-governance/cli.mjs help
  node tools/agent-governance/cli.mjs check [--strict|--no-strict] [--base <worktree>] [--all-worktrees]

Notes:
  - Read-only. Never copies or mutates files.
  - Discovers sibling worktrees via \`git worktree list\`.
  - Default discovery compares only the four canonical checkout directory names
    listed in tools/agent-governance/shared-files.json
    (canonicalCheckoutDirectoryNames): selected base plus registered peers that
    share the base's parent directory and whose directory basename matches those
    names (for example the sibling checkouts under the same project parent).
  - Pass --all-worktrees to compare every registered (non-bare) worktree.
  - Compares only paths listed in tools/agent-governance/shared-files.json.
  - Content comparison normalizes CRLF/LF before hashing equality.
  - --strict (default for check): exit non-zero when any drift or missing peer file.
  - --base defaults to this repository root.
`);
}

function runGit(cwd, args) {
  return execFileSync("git", ["-c", `safe.directory=${cwd}`, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function checkoutDirectoryName(worktreePath) {
  return basename(resolve(worktreePath));
}

/**
 * Default: keep the selected base plus peers that share the base parent directory
 * and whose checkout directory basename is in the canonical set from shared-files.json.
 * --all-worktrees: every registered non-bare worktree.
 */
export function filterWorktreesForAudit(
  worktrees,
  baseRoot,
  { allWorktrees = false, canonicalCheckoutDirectoryNames = [] } = {},
) {
  const baseNorm = resolve(baseRoot);
  if (allWorktrees) {
    return worktrees.filter((item) => !item.bare);
  }
  const canonical = new Set(canonicalCheckoutDirectoryNames);
  const baseParent = dirname(baseNorm);
  return worktrees.filter((item) => {
    if (item.bare) return false;
    const resolved = resolve(item.path);
    if (resolved === baseNorm) return true;
    if (!canonical.has(checkoutDirectoryName(resolved))) return false;
    return dirname(resolved) === baseParent;
  });
}

function listWorktrees(baseRoot) {
  const raw = runGit(baseRoot, ["worktree", "list", "--porcelain"]);
  const worktrees = [];
  let current = null;
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      if (current) worktrees.push(current);
      current = { path: line.slice("worktree ".length).trim(), bare: false, detached: false, branch: null };
    } else if (line === "bare") {
      if (current) current.bare = true;
    } else if (line === "detached") {
      if (current) current.detached = true;
    } else if (line.startsWith("branch ")) {
      if (current) current.branch = line.slice("branch ".length).trim();
    } else if (line === "" && current) {
      worktrees.push(current);
      current = null;
    }
  }
  if (current) worktrees.push(current);
  return worktrees.filter((item) => !item.bare);
}

function normalizeEol(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function loadManifest(manifestPath = MANIFEST_FILE) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("shared-files.json must list at least one file");
  }
  const canonicalCheckoutDirectoryNames = manifest.canonicalCheckoutDirectoryNames;
  if (
    !Array.isArray(canonicalCheckoutDirectoryNames) ||
    canonicalCheckoutDirectoryNames.length === 0
  ) {
    throw new Error(
      "shared-files.json must list canonicalCheckoutDirectoryNames",
    );
  }
  return {
    files: manifest.files.map((item) => item.split("\\").join("/")),
    canonicalCheckoutDirectoryNames: canonicalCheckoutDirectoryNames.map(String),
  };
}

function readNormalized(absolutePath) {
  if (!existsSync(absolutePath)) {
    return null;
  }
  return normalizeEol(readFileSync(absolutePath, "utf8"));
}

function parseArgs(argv) {
  const args = {
    command: argv[0] ?? "help",
    strict: true,
    base: REPO_ROOT,
    allWorktrees: false,
  };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--strict") args.strict = true;
    else if (arg === "--no-strict") args.strict = false;
    else if (arg === "--all-worktrees") args.allWorktrees = true;
    else if (arg === "--base") args.base = resolve(argv[++i]);
    else if (arg === "--help" || arg === "-h") args.command = "help";
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function runCheck(args) {
  const manifest = loadManifest();
  const files = manifest.files;
  const discovered = listWorktrees(args.base);
  const worktrees = filterWorktreesForAudit(discovered, args.base, {
    allWorktrees: args.allWorktrees,
    canonicalCheckoutDirectoryNames: manifest.canonicalCheckoutDirectoryNames,
  });
  const baseNorm = resolve(args.base);
  const peers = worktrees.filter((item) => resolve(item.path) !== baseNorm);

  console.log(`base: ${baseNorm}`);
  console.log(`discovered_worktrees: ${discovered.length}`);
  console.log(`audited_worktrees: ${worktrees.length}`);
  console.log(`peers: ${peers.length}`);
  console.log(`all_worktrees: ${args.allWorktrees}`);
  console.log(
    `canonical_checkout_dirs: ${manifest.canonicalCheckoutDirectoryNames.join(",")}`,
  );
  console.log(`manifest_files: ${files.length}`);

  const drifts = [];
  const missingInBase = [];
  const missingInPeer = [];

  for (const rel of files) {
    const basePath = join(baseNorm, ...rel.split("/"));
    const baseContent = readNormalized(basePath);
    if (baseContent == null) {
      missingInBase.push(rel);
      continue;
    }

    for (const peer of peers) {
      const peerPath = join(peer.path, ...rel.split("/"));
      const peerContent = readNormalized(peerPath);
      if (peerContent == null) {
        missingInPeer.push({ file: rel, worktree: peer.path });
        continue;
      }
      if (peerContent !== baseContent) {
        drifts.push({ file: rel, worktree: peer.path, branch: peer.branch });
      }
    }
  }

  console.log(`missing_in_base: ${missingInBase.length}`);
  for (const item of missingInBase) console.log(`  - ${item}`);
  console.log(`missing_in_peer: ${missingInPeer.length}`);
  for (const item of missingInPeer) console.log(`  - ${item.file} @ ${item.worktree}`);
  console.log(`content_drift: ${drifts.length}`);
  for (const item of drifts) {
    console.log(`  - ${item.file} @ ${item.worktree}${item.branch ? ` (${item.branch})` : ""}`);
  }

  const hasProblems =
    missingInBase.length > 0 || missingInPeer.length > 0 || drifts.length > 0;
  if (args.strict && hasProblems) {
    process.exitCode = 1;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (
    !args.command ||
    args.command === "help" ||
    args.command === "--help" ||
    args.command === "-h"
  ) {
    printUsage();
    return;
  }
  if (args.command === "check") {
    runCheck(args);
    return;
  }
  throw new Error(`unknown command: ${args.command}`);
}

const isMain =
  process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isMain) {
  main();
}
