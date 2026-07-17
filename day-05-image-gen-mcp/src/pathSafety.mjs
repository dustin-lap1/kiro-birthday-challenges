// pathSafety.mjs — pure filesystem write security boundary over an injected realpath.
//
// This is the security boundary for every filesystem write (Req 6). All paths are
// canonicalized (symlinks and `.`/`..` resolved) before a write is allowed, and a
// resolved path is accepted only when it equals or is a descendant of Workspace_Root
// (Req 6.1, 6.2, 6.3, 9.4). `realpath` is injected so the module is deterministic and
// testable fully in-memory; it is expected to throw for a path that does not exist
// (mirroring `fs.realpathSync`).

import path from "node:path";

/**
 * Build a structured PathSafetyError identifying the rejected path.
 * @param {string} rejectedPath
 * @param {string} parameter
 * @param {string} [message]
 * @returns {{ kind: "path_safety", parameter: string, path: string, message: string }}
 */
function pathSafetyError(rejectedPath, parameter, message) {
  return {
    kind: "path_safety",
    parameter,
    path: rejectedPath,
    message: message || `Path is outside the workspace: ${rejectedPath}`,
  };
}

/**
 * Canonicalize an absolute path, resolving symlinks and `.`/`..` via the injected
 * `realpath`. For a path that does not yet exist, canonicalize the nearest existing
 * ancestor and append the remaining (not-yet-created) segments so a not-yet-created
 * Output_Directory can still be safety-checked.
 * @param {string} absPath — an already-absolute path
 * @param {(p: string) => string} realpath
 * @returns {string} the canonical absolute path
 */
function canonicalizeExisting(absPath, realpath) {
  let current = path.resolve(absPath);
  const trailing = [];
  // Walk up until `realpath` succeeds on an existing ancestor (or we hit the root).
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const real = realpath(current);
      if (trailing.length === 0) return real;
      // trailing collected deepest-first while walking up; append in top-down order.
      return path.join(real, ...trailing.slice().reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        // Reached the filesystem root without any existing ancestor resolving;
        // fall back to the normalized absolute path plus collected segments.
        if (trailing.length === 0) return current;
        return path.join(current, ...trailing.slice().reverse());
      }
      trailing.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Determine whether a candidate path equals or is a descendant of the workspace root.
 * Uses `path.relative` and rejects results that are empty-with-a-different-root,
 * start with a `..` segment, or are absolute.
 * @param {string} candidate
 * @param {string} workspaceRoot
 * @returns {boolean}
 */
export function isWithinWorkspace(candidate, workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(candidate);
  const rel = path.relative(root, target);
  // Equal to the workspace root.
  if (rel === "") return root === target;
  // A different filesystem root (e.g. different drive on Windows) yields an
  // absolute relative path — reject it.
  if (path.isAbsolute(rel)) return false;
  // Escapes upward out of the workspace.
  const firstSegment = rel.split(/[\\/]/)[0];
  if (firstSegment === "..") return false;
  return true;
}

/**
 * Resolve and canonicalize the requested output directory, then confirm it is within
 * the workspace. A relative `requestedDir` is resolved against the (canonicalized)
 * workspace root.
 * @param {string} requestedDir
 * @param {string} workspaceRoot
 * @param {(p: string) => string} realpath
 * @returns {{ ok: true, canonicalDir: string } | { ok: false, error: object }}
 */
export function resolveOutputDir(requestedDir, workspaceRoot, realpath) {
  const canonicalRoot = canonicalizeExisting(path.resolve(workspaceRoot), realpath);
  const requestedAbs = path.resolve(canonicalRoot, requestedDir);
  const canonicalDir = canonicalizeExisting(requestedAbs, realpath);
  if (!isWithinWorkspace(canonicalDir, canonicalRoot)) {
    return { ok: false, error: pathSafetyError(canonicalDir, "outputDir") };
  }
  return { ok: true, canonicalDir };
}

/**
 * Resolve the canonical save path for a file within an already-canonical directory,
 * and confirm the result stays within the workspace. `filename` is expected to have
 * been validated (no separators or `..`) by `filenames.mjs` beforehand.
 * @param {string} canonicalDir — a canonical directory, already within the workspace
 * @param {string} filename
 * @param {string} workspaceRoot
 * @returns {{ ok: true, canonicalPath: string } | { ok: false, error: object }}
 */
export function resolveSavePath(canonicalDir, filename, workspaceRoot) {
  const canonicalPath = path.join(canonicalDir, filename);
  if (!isWithinWorkspace(canonicalPath, workspaceRoot)) {
    return { ok: false, error: pathSafetyError(canonicalPath, "filename") };
  }
  return { ok: true, canonicalPath };
}
