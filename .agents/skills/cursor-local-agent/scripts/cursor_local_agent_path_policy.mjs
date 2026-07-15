#!/usr/bin/env node
/**
 * Pure helpers for audited write-allowlist path containment and git change classification.
 * Not an OS sandbox — classification only.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";

const defaultFsIo = { existsSync, statSync, readFileSync };

/**
 * Resolve and normalize a user-supplied path under cwd.
 * Rejects empty input, absolute escapes outside cwd, and `..` that leave the repo.
 */
export function resolveContainedPath(cwd, inputPath) {
  if (inputPath == null || String(inputPath).trim() === "") {
    throw new Error("allowed path must be a non-empty path");
  }
  const cwdResolved = resolve(cwd);
  const absolute = resolve(cwdResolved, inputPath);
  if (!isPathInside(cwdResolved, absolute)) {
    throw new Error(
      `allowed path escapes repository root: input=${JSON.stringify(inputPath)} resolved=${absolute}`,
    );
  }
  const rel = relative(cwdResolved, absolute);
  return {
    input: inputPath,
    absolute,
    relative: normalizeRepoRelative(rel === "" ? "." : rel),
    exists: existsSync(absolute),
  };
}

export function normalizeAllowedPaths(cwd, allowedPaths) {
  if (!Array.isArray(allowedPaths) || allowedPaths.length === 0) {
    throw new Error("at least one --allowed-path is required for real runs");
  }
  const seen = new Set();
  const normalized = [];
  for (const inputPath of allowedPaths) {
    const item = resolveContainedPath(cwd, inputPath);
    if (seen.has(item.relative)) {
      continue;
    }
    seen.add(item.relative);
    normalized.push(item);
  }
  return normalized;
}

export function isPathInside(root, candidate) {
  const rootResolved = resolve(root);
  const candidateResolved = resolve(candidate);
  if (rootResolved === candidateResolved) {
    return true;
  }
  const rel = relative(rootResolved, candidateResolved);
  if (!rel || rel === ".") {
    return true;
  }
  if (isAbsolute(rel)) {
    return false;
  }
  const parts = rel.split(/[/\\]/);
  return !parts.includes("..");
}

export function normalizeRepoRelative(relPath) {
  return normalize(relPath).split(sep).join("/");
}

/**
 * True if changedPath (repo-relative, forward slashes) is inside any allowed relative root.
 */
export function isUnderAllowedPath(changedPath, allowedRelatives) {
  const pathNorm = normalizeRepoRelative(changedPath).replace(/^\.\//, "");
  if (pathNorm === "" || pathNorm === ".") {
    return allowedRelatives.some((allowed) => allowed === "." || allowed === "");
  }
  for (const allowed of allowedRelatives) {
    const root = normalizeRepoRelative(allowed).replace(/^\.\//, "");
    if (root === "." || root === "") {
      return true;
    }
    if (pathNorm === root || pathNorm.startsWith(`${root}/`)) {
      return true;
    }
  }
  return false;
}

function unquoteGitPath(pathPart) {
  let value = pathPart;
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1).replace(/\\([\\"ntr])/g, (_, ch) => {
      if (ch === "n") return "\n";
      if (ch === "t") return "\t";
      if (ch === "r") return "\r";
      return ch;
    });
  }
  return value;
}

/**
 * Parse `git status --short` / porcelain text (non -z) into path entries.
 * Rename lines expose both fromPath and relativePath (destination).
 */
export function parseGitStatusShort(statusText) {
  const entries = [];
  const text = statusText ?? "";
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const xy = rawLine.slice(0, 2);
    let pathPart = rawLine.slice(3);
    let fromPath = null;
    if (pathPart.includes(" -> ")) {
      const parts = pathPart.split(" -> ");
      fromPath = normalizeRepoRelative(unquoteGitPath(parts[0]));
      pathPart = parts.slice(1).join(" -> ");
    }
    const relativePath = normalizeRepoRelative(unquoteGitPath(pathPart));
    const untracked = xy === "??";
    entries.push({
      status: xy.trim() || xy,
      xy,
      relativePath,
      fromPath,
      untracked,
      paths: fromPath ? [fromPath, relativePath] : [relativePath],
    });
  }
  return entries;
}

/**
 * Parse `git status --porcelain=v1 -z` buffer/string into path entries.
 * Renames/copies include both source and destination so neither boundary is hidden.
 */
export function parseGitStatusPorcelainZ(payload) {
  const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload ?? ""), "utf8");
  if (buffer.length === 0) {
    return [];
  }
  const parts = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] === 0) {
      parts.push(buffer.slice(start, i).toString("utf8"));
      start = i + 1;
    }
  }
  if (start < buffer.length) {
    parts.push(buffer.slice(start).toString("utf8"));
  }

  const entries = [];
  let i = 0;
  while (i < parts.length) {
    const token = parts[i];
    if (!token) {
      i += 1;
      continue;
    }
    if (token.length < 3) {
      throw new Error(`invalid porcelain -z token: ${JSON.stringify(token)}`);
    }
    const xy = token.slice(0, 2);
    const firstPath = token.slice(3);
    if (!firstPath) {
      throw new Error(`invalid porcelain -z entry missing path: ${JSON.stringify(token)}`);
    }
    const code = xy.trim() || xy;
    const isRenameOrCopy = code.startsWith("R") || code.startsWith("C") || xy.includes("R") || xy.includes("C");
    if (isRenameOrCopy) {
      // porcelain -z rename/copy: "XY <destination>\0<source>\0"
      const secondPath = parts[i + 1];
      if (!secondPath) {
        throw new Error(`rename/copy entry missing source path for ${JSON.stringify(token)}`);
      }
      const relativePath = normalizeRepoRelative(firstPath);
      const fromPath = normalizeRepoRelative(secondPath);
      entries.push({
        status: code,
        xy,
        relativePath,
        fromPath,
        untracked: false,
        paths: [fromPath, relativePath],
      });
      i += 2;
      continue;
    }
    const relativePath = normalizeRepoRelative(firstPath);
    entries.push({
      status: code,
      xy,
      relativePath,
      fromPath: null,
      untracked: xy === "??",
      paths: [relativePath],
    });
    i += 1;
  }
  return entries;
}

/**
 * Classify status entries against the allowlist.
 * Rename/copy entries are outside-scope if either source or destination is outside.
 */
export function classifyChanges(statusEntries, allowedRelatives) {
  const inScope = [];
  const outsideScope = [];
  for (const entry of statusEntries) {
    const paths = entry.paths?.length
      ? entry.paths
      : entry.fromPath
        ? [entry.fromPath, entry.relativePath]
        : [entry.relativePath];
    const allInScope = paths.every((pathItem) => isUnderAllowedPath(pathItem, allowedRelatives));
    (allInScope ? inScope : outsideScope).push(entry);
  }
  return { inScope, outsideScope };
}

/**
 * Content signature for a repo-relative path: sha256, or a safe missing/deleted marker.
 * Missing paths are valid deletion markers. Unreadable existing paths fail closed (throw);
 * never encode an unreadable error as an ordinary comparable signature.
 * Never embeds file contents — hash/metadata only.
 * Optional `io` injects fs primitives for deterministic tests.
 */
export function contentSignatureForPath(cwd, relativePath, io = defaultFsIo) {
  const absolute = resolve(cwd, relativePath);
  if (!io.existsSync(absolute)) {
    return "missing";
  }
  try {
    const st = io.statSync(absolute);
    if (st.isDirectory()) {
      return `dir:${st.ino ?? 0}:${st.mtimeMs}`;
    }
    const hash = createHash("sha256").update(io.readFileSync(absolute)).digest("hex");
    return `sha256:${hash}:size:${st.size}`;
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return "missing";
    }
    throw new Error(
      `audited path unreadable: ${normalizeRepoRelative(relativePath)}: ${error.message}`,
    );
  }
}

/**
 * Deterministic per-path signature map for dirty/untracked entries.
 * Keys are every path touched by an entry (rename source + destination).
 * Optional `io` is forwarded to contentSignatureForPath (tests only).
 */
export function buildPathSignatureMap(cwd, statusEntries, io = defaultFsIo) {
  const map = new Map();
  for (const entry of statusEntries) {
    const paths = entry.paths?.length
      ? entry.paths
      : entry.fromPath
        ? [entry.fromPath, entry.relativePath]
        : [entry.relativePath];
    for (const pathItem of paths) {
      const previous = map.get(pathItem);
      const next = {
        path: pathItem,
        status: entry.xy || entry.status,
        content: contentSignatureForPath(cwd, pathItem, io),
      };
      if (!previous) {
        map.set(pathItem, next);
        continue;
      }
      // Prefer a richer status if the same path appears twice.
      map.set(pathItem, {
        path: pathItem,
        status: `${previous.status}|${next.status}`,
        content: next.content === "missing" ? previous.content : next.content,
      });
    }
  }
  return map;
}

export function signatureMapToObject(signatureMap) {
  const out = {};
  const keys = [...signatureMap.keys()].sort((a, b) => a.localeCompare(b, "en"));
  for (const key of keys) {
    out[key] = signatureMap.get(key);
  }
  return out;
}

/**
 * Paths whose status/content signature changed between before and after snapshots.
 */
export function diffPathSignatures(beforeMap, afterMap) {
  const delta = [];
  const paths = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  for (const pathItem of [...paths].sort((a, b) => a.localeCompare(b, "en"))) {
    const before = beforeMap.get(pathItem) ?? null;
    const after = afterMap.get(pathItem) ?? null;
    if (!before && after) {
      delta.push({ path: pathItem, kind: "added", before: null, after });
      continue;
    }
    if (before && !after) {
      delta.push({ path: pathItem, kind: "removed", before, after: null });
      continue;
    }
    if (before.status !== after.status || before.content !== after.content) {
      delta.push({ path: pathItem, kind: "changed", before, after });
    }
  }
  return delta;
}

/**
 * Classify run-delta paths against the allowlist (path-level, not entry-level).
 */
export function classifyDeltaPaths(delta, allowedRelatives) {
  const inScope = [];
  const outsideScope = [];
  for (const item of delta) {
    const bucket = isUnderAllowedPath(item.path, allowedRelatives) ? inScope : outsideScope;
    bucket.push(item);
  }
  return { inScope, outsideScope };
}

/**
 * Metadata-only record for an untracked file (path, size, sha256). Never raw content.
 */
export function untrackedFileMetadata(cwd, relativePath) {
  const absolute = resolve(cwd, relativePath);
  const st = statSync(absolute);
  if (!st.isFile()) {
    return { path: relativePath, kind: "not-a-file", size: st.size ?? null, sha256: null };
  }
  const sha256 = createHash("sha256").update(readFileSync(absolute)).digest("hex");
  return { path: relativePath, kind: "file", size: st.size, sha256 };
}

export function statusEntriesFromText(statusText) {
  return parseGitStatusShort(statusText);
}
