// editImage.test.mjs — unit/example tests for handleEditImage source-path handling.
//
// Covers the two source-path failure modes of the edit_image handler, both of
// which must return a structured path_safety error and write NOTHING:
//   - Missing source file: the injected realpath throws for the source path,
//     so it does not resolve to an existing filesystem entry (Req 9.3).
//   - Outside-workspace source: the injected realpath resolves the source to an
//     absolute path OUTSIDE Workspace_Root, so containment fails (Req 9.4).
//
// In both cases a valid prompt and a valid OPENAI_API_KEY are supplied so the
// ONLY reason the call fails is the source path. Spies on fetchImpl and the fs
// surface assert that no network call and no write ever happen.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { handleEditImage } from "./editImage.mjs";

/**
 * Build an in-memory deps object with spies. The caller supplies the `realpath`
 * behavior (that is what these tests vary). fetchImpl and the fs write surface
 * are spies that record whether they were ever invoked, so a passing test
 * proves nothing was fetched and nothing was written.
 *
 * @param {string} workspaceRoot — absolute directory used as Workspace_Root
 * @param {(p: string) => string} realpath — injected realpath under test
 */
function makeDeps(workspaceRoot, realpath) {
  const calls = { fetch: 0, readFile: 0, writeFile: 0, rename: 0, mkdir: 0 };

  const deps = {
    config: {
      workspaceRoot,
      defaultOutputDir: "public/images",
      styleGuidePath: null,
      defaults: { size: "1024x1024", quality: "auto", model: "gpt-image-1" },
    },
    // A valid key so the source path is the ONLY possible failure.
    env: { OPENAI_API_KEY: "sk-test-valid-key" },
    // fetch spy: records the call and would "succeed" — but must never run.
    fetchImpl: async () => {
      calls.fetch += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ b64_json: "" }] }),
      };
    },
    // fs spy: readFile/writeFile/rename all record calls; none should fire.
    fs: {
      readFile: async () => {
        calls.readFile += 1;
        return Buffer.from([137, 80, 78, 71]);
      },
      mkdir: async () => {
        calls.mkdir += 1;
        return undefined;
      },
      writeFile: async () => {
        calls.writeFile += 1;
        return undefined;
      },
      rename: async () => {
        calls.rename += 1;
        return undefined;
      },
      rm: async () => undefined,
    },
    realpath,
    readdir: () => [],
    readStyleGuide: async () => ({ status: "none" }),
    now: () => 1_700_000_000_000,
  };

  return { deps, calls };
}

/** Assert that no network call and no write of any kind happened. */
function assertNothingWritten(calls) {
  assert.equal(calls.fetch, 0, "fetchImpl must not be called");
  assert.equal(calls.writeFile, 0, "fs.writeFile must not be called");
  assert.equal(calls.rename, 0, "fs.rename must not be called");
}

// ---------------------------------------------------------------------------
// Missing source file — Req 9.3
// realpath throws (ENOENT) for the source path → path_safety error, nothing written.
// ---------------------------------------------------------------------------

test("missing source file returns a path_safety error and writes nothing", async () => {
  const workspaceRoot = path.resolve("/virtual", "workspace");
  const rootAbs = path.resolve(workspaceRoot);

  // realpath resolves the Workspace_Root but throws for anything else — i.e. the
  // source path does not resolve to an existing filesystem entry.
  const realpath = (p) => {
    if (p === rootAbs) return rootAbs;
    const err = new Error(`ENOENT: no such file or directory, '${p}'`);
    err.code = "ENOENT";
    throw err;
  };

  const { deps, calls } = makeDeps(workspaceRoot, realpath);
  const args = { sourcePath: "does-not-exist.png", prompt: "make it brighter" };

  const result = await handleEditImage(args, deps);

  assert.equal(result.isError, true, "the call should fail");
  assert.ok(result.structuredContent, "structuredContent should be present");
  assert.equal(
    result.structuredContent.errorKind,
    "path_safety",
    "errorKind should be path_safety",
  );
  assert.equal(
    result.structuredContent.parameter,
    "sourcePath",
    "the offending parameter should be sourcePath",
  );
  assertNothingWritten(calls);
});

// ---------------------------------------------------------------------------
// Outside-workspace source — Req 9.4
// realpath resolves the source to an absolute path OUTSIDE Workspace_Root →
// path_safety error, nothing written.
// ---------------------------------------------------------------------------

test("outside-workspace source returns a path_safety error and writes nothing", async () => {
  const workspaceRoot = path.resolve("/virtual", "workspace");
  const rootAbs = path.resolve(workspaceRoot);
  // A canonical location that sits OUTSIDE the workspace root.
  const outsideAbs = path.resolve("/virtual", "elsewhere", "secret.png");

  // realpath resolves the Workspace_Root to itself, but resolves the source to
  // a path outside the workspace (e.g. following a symlink).
  const realpath = (p) => {
    if (p === rootAbs) return rootAbs;
    return outsideAbs;
  };

  const { deps, calls } = makeDeps(workspaceRoot, realpath);
  const args = { sourcePath: "link-to-outside.png", prompt: "make it brighter" };

  const result = await handleEditImage(args, deps);

  assert.equal(result.isError, true, "the call should fail");
  assert.ok(result.structuredContent, "structuredContent should be present");
  assert.equal(
    result.structuredContent.errorKind,
    "path_safety",
    "errorKind should be path_safety",
  );
  assert.equal(
    result.structuredContent.parameter,
    "sourcePath",
    "the offending parameter should be sourcePath",
  );
  assertNothingWritten(calls);
});
