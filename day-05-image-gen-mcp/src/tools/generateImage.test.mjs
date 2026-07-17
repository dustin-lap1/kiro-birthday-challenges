// generateImage.test.mjs — unit/example tests for handleGenerateImage.
//
// Covers default Output_Directory resolution (Req 3.11): when the caller OMITS
// `outputDir`, validation defaults it to config.defaultOutputDir ("public/images")
// and the handler resolves it relative to Workspace_Root, so the reported
// Saved_File_Path is workspace-relative under "public/images/" using forward
// slashes.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { handleGenerateImage } from "./generateImage.mjs";

// A tiny valid base64 PNG-ish payload (content is irrelevant to path resolution).
const B64_IMAGE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");

/**
 * Build a fully in-memory deps object with a SUCCESS fetch, so no real network
 * or disk is touched. `realpath` is an identity stub and `readdir` returns [] so
 * the explicit filename is used verbatim (deterministic assertion).
 * @param {string} workspaceRoot — an absolute directory used as Workspace_Root
 */
function makeDeps(workspaceRoot) {
  return {
    config: {
      workspaceRoot,
      defaultOutputDir: "public/images",
      styleGuidePath: null,
      defaults: { size: "1024x1024", quality: "auto", model: "gpt-image-1" },
    },
    env: { OPENAI_API_KEY: "sk-test-valid-key" },
    // SUCCESS fetch: 2xx with a base64 image payload.
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ b64_json: B64_IMAGE }] }),
    }),
    // In-memory fs stub: every operation resolves without touching disk.
    fs: {
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      rename: async () => undefined,
      rm: async () => undefined,
    },
    // Identity realpath: canonicalization is a no-op in the test.
    realpath: (p) => p,
    // No existing names in the (virtual) directory.
    readdir: () => [],
    // No style guide.
    readStyleGuide: async () => ({ status: "none" }),
    // Constant clock for a deterministic filename derivation.
    now: () => 1_700_000_000_000,
  };
}

// ---------------------------------------------------------------------------
// Default Output_Directory resolution — Req 3.11
// Omitting `outputDir` must resolve under public/images/ relative to
// Workspace_Root; the reported Saved_File_Path is workspace-relative with
// forward slashes.
// ---------------------------------------------------------------------------

test("omitted outputDir resolves under public/images relative to Workspace_Root", async () => {
  const workspaceRoot = path.resolve("/virtual", "workspace");
  const deps = makeDeps(workspaceRoot);

  // Note: no `outputDir` key at all. An explicit filename makes the assertion
  // deterministic.
  const args = { prompt: "a friendly robot", filename: "robot.png" };

  const result = await handleGenerateImage(args, deps);

  assert.equal(result.isError, false, "the call should succeed");
  assert.ok(result.structuredContent, "structuredContent should be present");

  const savedFilePath = result.structuredContent.savedFilePath;
  assert.equal(typeof savedFilePath, "string", "savedFilePath should be a string");
  assert.ok(
    savedFilePath.startsWith("public/images/"),
    `savedFilePath should start with "public/images/" but was "${savedFilePath}"`,
  );
  // Confirm forward slashes (no backslashes even on Windows).
  assert.ok(
    !savedFilePath.includes("\\"),
    `savedFilePath should use forward slashes but was "${savedFilePath}"`,
  );
  assert.equal(
    savedFilePath,
    "public/images/robot.png",
    "savedFilePath should be the workspace-relative default path",
  );
});
