// fileWriter.test.mjs — unit/example tests for writeImageAtomic.
// Covers: directory created when absent (Req 3.14), bytes read back equal the
// input (Req 3.10), and a simulated write failure leaving no partial file while
// returning the attempted path (Req 3.14 / 8.5).

import { test } from "node:test";
import assert from "node:assert/strict";

import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import * as realFs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { writeImageAtomic } from "./fileWriter.mjs";

// ---------------------------------------------------------------------------
// Happy path against a real disk — Req 3.10, 3.14
// A canonical path whose Output_Directory does NOT yet exist is written with the
// real fs. The directory must be created, the call succeeds, and the bytes read
// back must equal the input exactly.
// ---------------------------------------------------------------------------

test("creates the directory when absent and writes bytes that read back equal the input", async () => {
  // A base temp dir that DOES exist, then a nested sub-directory that does NOT.
  const baseDir = await mkdtemp(path.join(os.tmpdir(), "filewriter-happy-"));
  try {
    const missingDir = path.join(baseDir, "nested", "output");
    const canonicalPath = path.join(missingDir, "image.png");
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 255]);

    // Precondition: the target directory really does not exist yet (Req 3.14).
    await assert.rejects(stat(missingDir), "the nested directory should not exist before the write");

    const result = await writeImageAtomic(canonicalPath, bytes, realFs);

    assert.deepEqual(result, { ok: true }, "the write should succeed");

    // The Output_Directory was created (Req 3.14).
    const dirStat = await stat(missingDir);
    assert.ok(dirStat.isDirectory(), "the missing directory should have been created");

    // Bytes read back equal the input (Req 3.10).
    const readBack = await readFile(canonicalPath);
    assert.deepEqual(new Uint8Array(readBack), bytes, "bytes read back should equal the input");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Simulated write failure — Req 3.14 (attempted path) / Req 8.5 (no partial file)
// An injected fs whose writeFile rejects must yield a file_write error carrying
// the attempted canonical path, and the temp artifact must be cleaned up so no
// partial destination file remains.
// ---------------------------------------------------------------------------

test("write failure returns a file_write error with the attempted path and leaves no partial file", async () => {
  const canonicalPath = path.join("/virtual", "out", "image.png");
  const bytes = new Uint8Array([1, 2, 3, 4]);

  const removed = [];
  const written = [];
  const renamed = [];

  const stubFs = {
    mkdir: async () => undefined,
    writeFile: async (p) => {
      written.push(p);
      const err = new Error("EIO: simulated disk failure");
      err.code = "EIO";
      throw err;
    },
    rename: async (from, to) => {
      renamed.push([from, to]);
    },
    rm: async (p) => {
      removed.push(p);
    },
  };

  const result = await writeImageAtomic(canonicalPath, bytes, stubFs);

  assert.equal(result.ok, false, "the write should fail");
  assert.equal(result.error.kind, "file_write", "error kind should be file_write");
  assert.equal(
    result.error.attemptedPath,
    canonicalPath,
    "the attempted path should be the canonical destination"
  );

  // The rename never happened, so no destination file could exist.
  assert.equal(renamed.length, 0, "rename should not be attempted after a writeFile failure");

  // The temp artifact was cleaned up so no partial file remains (Req 8.5).
  assert.equal(removed.length, 1, "the temp artifact should be removed exactly once");
  assert.equal(written.length, 1, "writeFile should have been attempted once (to the temp path)");
  assert.equal(
    removed[0],
    written[0],
    "the removed temp path should be the same path writeFile attempted"
  );
  assert.notEqual(
    removed[0],
    canonicalPath,
    "cleanup should target the temp artifact, not the canonical destination"
  );
});
