// imageLister.test.mjs — unit/example tests for imageLister.mjs edge cases.
// Covers missing-directory handling (Req 10.5) and unreadable-directory
// handling (Req 10.6).

import { test } from "node:test";
import assert from "node:assert/strict";

import { listImages } from "./imageLister.mjs";

// ---------------------------------------------------------------------------
// Missing directory — Req 10.5
// A readdir that throws ENOENT means the directory does not exist yet; this is
// not an error, it yields an empty successful listing.
// ---------------------------------------------------------------------------

test("missing directory (ENOENT) returns an empty successful listing", () => {
  const readdir = () => {
    const err = new Error("ENOENT: no such file or directory");
    err.code = "ENOENT";
    throw err;
  };

  const result = listImages("/some/missing/dir", readdir);

  assert.deepEqual(result, { ok: true, entries: [] });
});

// ---------------------------------------------------------------------------
// Unreadable directory — Req 10.6
// A readdir that throws a non-ENOENT error (e.g. EACCES) yields an error result
// WITHOUT listImages itself throwing.
// ---------------------------------------------------------------------------

test("unreadable directory (EACCES) returns an error result without throwing", () => {
  const readdir = () => {
    const err = new Error("EACCES: permission denied");
    err.code = "EACCES";
    throw err;
  };

  let result;
  assert.doesNotThrow(() => {
    result = listImages("/locked/dir", readdir);
  });

  assert.equal(result.ok, false);
  assert.ok(result.error, "an error object should be present");
});
