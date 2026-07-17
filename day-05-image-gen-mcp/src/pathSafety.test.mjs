// pathSafety.test.mjs — property-based tests for the workspace write-containment boundary.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fc from "fast-check";

import {
  resolveOutputDir,
  resolveSavePath,
  isWithinWorkspace,
} from "./pathSafety.mjs";

// A workspace root placed several levels below the filesystem root so that `..`
// escapes have somewhere to climb to. `path.resolve` makes this platform-correct
// (e.g. `C:\home\user\workspace` on Windows, `/home/user/workspace` on POSIX).
const WORKSPACE_ROOT = path.resolve(path.sep, "home", "user", "workspace");

/** Every ancestor path of `dir` (inclusive), used as the set of "existing" paths. */
function ancestorsOf(dir) {
  const set = new Set();
  let cur = path.resolve(dir);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    set.add(cur);
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return set;
}

// In-memory realpath stub: no real disk is touched. It returns the resolved path
// for anything that "exists" (the workspace root and its ancestors) and throws for
// everything else, mirroring fs.realpathSync's ENOENT behavior. There are no
// symlinks, so canonicalization is the identity on existing paths.
const EXISTING = ancestorsOf(WORKSPACE_ROOT);
function realpathStub(p) {
  const resolved = path.resolve(p);
  if (EXISTING.has(resolved)) return resolved;
  throw Object.assign(new Error(`ENOENT: no such file or directory, '${p}'`), {
    code: "ENOENT",
  });
}

// A safe path segment: 1-8 chars from a separator-free, dot-free alphabet.
const SEGMENT_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789_-".split("");
const segment = fc
  .array(fc.constantFrom(...SEGMENT_CHARS), { minLength: 1, maxLength: 8 })
  .map((chars) => chars.join(""));

// A relative subpath that stays inside the workspace (no `..`, no absolute root).
// The empty join ("") denotes the workspace root itself, which is still contained.
const insideDir = fc
  .array(segment, { minLength: 0, maxLength: 4 })
  .map((segs) => segs.join("/"));

// A safe filename (validated-shape: no separators, no `..`).
const safeFilename = segment.map((s) => `${s}.png`);

// A requested directory that escapes the workspace: either `..` traversal that
// climbs above the root, or an absolute path rooted outside the workspace.
const escapingDir = fc.oneof(
  fc
    .record({ depth: fc.integer({ min: 1, max: 5 }), tail: segment })
    .map(({ depth, tail }) => "../".repeat(depth) + tail),
  fc
    .array(segment, { minLength: 1, maxLength: 3 })
    .map((segs) => path.resolve(path.sep, "etc", ...segs))
);

// Feature: day-05-image-gen-mcp, Property 10: For any requested output directory and filename, if the canonical resolved directory and Saved_File_Path are equal to or descendants of Workspace_Root then the write proceeds, and otherwise the request is rejected with a path-safety error and no file is written. The same containment rule holds for the edit tool's source path.
// Validates: Requirements 6.1, 6.2, 6.3, 9.4
test("Property 10: writes stay within the workspace", () => {
  const insideCase = fc.record({
    kind: fc.constant("inside"),
    dir: insideDir,
    filename: safeFilename,
  });
  const escapeCase = fc.record({
    kind: fc.constant("escape"),
    dir: escapingDir,
    filename: safeFilename,
  });

  fc.assert(
    fc.property(fc.oneof(insideCase, escapeCase), ({ kind, dir, filename }) => {
      const dirResult = resolveOutputDir(dir, WORKSPACE_ROOT, realpathStub);

      if (kind === "inside") {
        // A contained directory resolves and is confirmed within the workspace.
        assert.equal(dirResult.ok, true);
        assert.equal(isWithinWorkspace(dirResult.canonicalDir, WORKSPACE_ROOT), true);

        // The derived save path also stays within the workspace, so the write proceeds.
        const saveResult = resolveSavePath(
          dirResult.canonicalDir,
          filename,
          WORKSPACE_ROOT
        );
        assert.equal(saveResult.ok, true);
        assert.equal(isWithinWorkspace(saveResult.canonicalPath, WORKSPACE_ROOT), true);

        // Same containment rule for the edit tool's source path: a contained
        // source resolves as within the workspace.
        const source = path.resolve(WORKSPACE_ROOT, dir, filename);
        assert.equal(isWithinWorkspace(source, WORKSPACE_ROOT), true);
      } else {
        // An escaping directory is rejected with a path-safety error and no write.
        assert.equal(dirResult.ok, false);
        assert.equal(dirResult.error.kind, "path_safety");

        // Same containment rule for the edit tool's source path: an escaping
        // source is rejected as outside the workspace.
        const source = path.resolve(WORKSPACE_ROOT, dir);
        assert.equal(isWithinWorkspace(source, WORKSPACE_ROOT), false);
      }
    }),
    { numRuns: 200 }
  );
});
