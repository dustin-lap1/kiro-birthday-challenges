// config.test.mjs — unit/example tests for config.mjs.
// Covers API-key reading (Req 2.1), enable flags, and default output dir resolution.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  loadConfig,
  readApiKey,
  Supported_Size,
  Supported_Quality,
  Default_Size,
  Default_Quality,
  Default_Model,
} from "./config.mjs";

// ---------------------------------------------------------------------------
// readApiKey — Req 2.1
// ---------------------------------------------------------------------------

test("readApiKey returns the key when OPENAI_API_KEY is set", () => {
  const result = readApiKey({ OPENAI_API_KEY: "sk-test-123" });
  assert.deepEqual(result, { ok: true, key: "sk-test-123" });
});

test("readApiKey preserves the exact key value (including surrounding-significant content)", () => {
  const key = "sk-proj-ABCdef_0123456789";
  const result = readApiKey({ OPENAI_API_KEY: key });
  assert.equal(result.ok, true);
  assert.equal(result.key, key);
});

test("readApiKey reports missing when OPENAI_API_KEY is absent", () => {
  const result = readApiKey({});
  assert.deepEqual(result, { ok: false, reason: "missing" });
});

test("readApiKey reports missing when called with no argument", () => {
  const result = readApiKey();
  assert.deepEqual(result, { ok: false, reason: "missing" });
});

test("readApiKey reports missing for an empty-string key", () => {
  const result = readApiKey({ OPENAI_API_KEY: "" });
  assert.deepEqual(result, { ok: false, reason: "missing" });
});

test("readApiKey reports missing for a whitespace-only key", () => {
  for (const raw of [" ", "   ", "\t", "\n", " \t\n "]) {
    const result = readApiKey({ OPENAI_API_KEY: raw });
    assert.deepEqual(
      result,
      { ok: false, reason: "missing" },
      `expected whitespace value ${JSON.stringify(raw)} to be reported missing`,
    );
  }
});

test("readApiKey reports missing for a non-string key value", () => {
  // Defensive: undefined-typed env values must not be treated as present.
  const result = readApiKey({ OPENAI_API_KEY: undefined });
  assert.deepEqual(result, { ok: false, reason: "missing" });
});

// ---------------------------------------------------------------------------
// loadConfig — enable flags
// ---------------------------------------------------------------------------

test("loadConfig defaults both enable flags to false when unset", () => {
  const config = loadConfig({}, "/workspace");
  assert.equal(config.enableEditTool, false);
  assert.equal(config.enableListTool, false);
});

test("loadConfig parses truthy enable flag variants (case/whitespace insensitive)", () => {
  for (const raw of ["true", "TRUE", "True", "1", "yes", "YES", "on", "  true  "]) {
    const config = loadConfig({ ENABLE_EDIT_TOOL: raw }, "/workspace");
    assert.equal(
      config.enableEditTool,
      true,
      `expected ${JSON.stringify(raw)} to enable the edit tool`,
    );
  }
});

test("loadConfig treats non-truthy enable flag values as false", () => {
  for (const raw of ["false", "0", "no", "off", "", "  ", "maybe", "2"]) {
    const config = loadConfig({ ENABLE_LIST_TOOL: raw }, "/workspace");
    assert.equal(
      config.enableListTool,
      false,
      `expected ${JSON.stringify(raw)} to leave the list tool disabled`,
    );
  }
});

test("loadConfig parses the two enable flags independently", () => {
  const config = loadConfig(
    { ENABLE_EDIT_TOOL: "true", ENABLE_LIST_TOOL: "false" },
    "/workspace",
  );
  assert.equal(config.enableEditTool, true);
  assert.equal(config.enableListTool, false);
});

// ---------------------------------------------------------------------------
// loadConfig — default output directory & workspace root
// ---------------------------------------------------------------------------

test("loadConfig resolves defaultOutputDir to public/images", () => {
  const config = loadConfig({}, "/workspace");
  assert.equal(config.defaultOutputDir, "public/images");
});

test("loadConfig uses the provided cwd as the workspace root (absolute)", () => {
  const cwd = path.resolve("/some/workspace");
  const config = loadConfig({}, cwd);
  assert.equal(config.workspaceRoot, cwd);
  assert.ok(path.isAbsolute(config.workspaceRoot));
});

test("loadConfig honors an explicit WORKSPACE_ROOT override", () => {
  const override = path.resolve("/override/root");
  const config = loadConfig({ WORKSPACE_ROOT: override }, "/ignored/cwd");
  assert.equal(config.workspaceRoot, override);
});

test("loadConfig resolves a relative WORKSPACE_ROOT to an absolute path", () => {
  const config = loadConfig({ WORKSPACE_ROOT: "relative/dir" }, "/base");
  assert.ok(path.isAbsolute(config.workspaceRoot));
  assert.equal(config.workspaceRoot, path.resolve("relative/dir"));
});

// ---------------------------------------------------------------------------
// loadConfig — style guide path
// ---------------------------------------------------------------------------

test("loadConfig sets styleGuidePath to null when unset", () => {
  const config = loadConfig({}, "/workspace");
  assert.equal(config.styleGuidePath, null);
});

test("loadConfig sets styleGuidePath to null for a blank value", () => {
  const config = loadConfig({ STYLE_GUIDE_PATH: "   " }, "/workspace");
  assert.equal(config.styleGuidePath, null);
});

test("loadConfig keeps a provided styleGuidePath", () => {
  const config = loadConfig({ STYLE_GUIDE_PATH: "style-guide.md" }, "/workspace");
  assert.equal(config.styleGuidePath, "style-guide.md");
});

// ---------------------------------------------------------------------------
// loadConfig — defaults block
// ---------------------------------------------------------------------------

test("loadConfig exposes Default_Size, Default_Quality, and Default_Model in defaults", () => {
  const config = loadConfig({}, "/workspace");
  assert.deepEqual(config.defaults, {
    size: Default_Size,
    quality: Default_Quality,
    model: Default_Model,
  });
});

// ---------------------------------------------------------------------------
// Exported constants and supported value sets
// ---------------------------------------------------------------------------

test("Default constants have the expected values", () => {
  assert.equal(Default_Size, "1024x1024");
  assert.equal(Default_Quality, "auto");
  assert.equal(Default_Model, "gpt-image-1");
});

test("Supported_Size and Supported_Quality contain the documented members", () => {
  for (const size of ["1024x1024", "1536x1024", "1024x1536", "1792x1024", "1024x1792", "auto"]) {
    assert.ok(Supported_Size.has(size), `Supported_Size should include ${size}`);
  }
  for (const quality of ["low", "medium", "high", "standard", "hd", "auto"]) {
    assert.ok(Supported_Quality.has(quality), `Supported_Quality should include ${quality}`);
  }
});
