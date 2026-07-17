// integration.generate.test.mjs — end-to-end generate_image integration test.
//
// Exercises the generate_image path END TO END against a STUBBED OpenAI Images
// API endpoint, writing a REAL PNG file into a REAL temporary workspace on disk
// and asserting the confirmation Tool_Result.
//
// Requirements:
//   3.10 — decoded PNG content is written as a PNG file into the Output_Directory.
//   3.15 — the Tool_Result contains the Saved_File_Path.
//   7.2  — a successful Tool_Result includes Saved_File_Path, model, and size,
//          and states a paid OpenAI Images API call was performed.
//
// Approach: rather than spawning the stdio server child process (which would be
// slow, non-deterministic, and could hang), this drives the tool in-process
// through `createDispatch(deps)` from index.mjs. Effects are injected:
//   - config.workspaceRoot points at a real mkdtemp() temp directory,
//   - fetchImpl is a stub returning a SUCCESS Images API response,
//   - fs/realpath/readdir are the REAL implementations so the PNG is genuinely
//     written to disk and path canonicalization works.
//
// SAFETY: no real network call and no spawned process. The temp workspace is
// ALWAYS removed in a `finally` block, and the test carries a hard timeout so it
// can never hang.

import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import * as realFsPromises from "node:fs/promises";
import { realpathSync, readdirSync } from "node:fs";

import { createDispatch } from "./index.mjs";

// A small, REAL 1x1 PNG (valid signature + IHDR + IDAT + IEND), base64-encoded.
// This is the exact payload the stubbed OpenAI endpoint returns as `b64_json`,
// so the bytes written to disk must decode-equal this after a base64 round trip.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// The 8-byte PNG file signature, used to assert the written file is a real PNG.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test(
  "generate_image writes a real PNG into a temp workspace and returns the confirmation (Req 3.10, 3.15, 7.2)",
  { timeout: 15_000 },
  async () => {
    // Create a REAL temporary workspace. mkdtemp gives us a unique existing
    // directory so realpath can canonicalize it; the handler's fileWriter will
    // mkdir the public/images subdirectory under it.
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "imggen-e2e-"));

    // Track whether the injected fetch was actually invoked (a paid call path).
    let fetchCalls = 0;

    try {
      const config = {
        workspaceRoot,
        defaultOutputDir: "public/images",
        styleGuidePath: null,
        enableEditTool: false,
        enableListTool: false,
        defaults: { size: "1024x1024", quality: "auto", model: "gpt-image-1" },
      };

      // Stubbed OpenAI Images API endpoint: a SUCCESS response carrying the PNG
      // as base64. No real network traffic occurs.
      const fetchImpl = async () => {
        fetchCalls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ b64_json: PNG_B64 }] }),
        };
      };

      const deps = {
        config,
        env: { OPENAI_API_KEY: "sk-test-dummy-key" },
        fetchImpl,
        // REAL effects so the file is genuinely written and canonicalization works.
        fs: realFsPromises,
        realpath: realpathSync,
        readdir: readdirSync,
        // No style guide configured -> caller prompt used verbatim, no warning.
        readStyleGuide: async () => ({ status: "none" }),
        now: () => 1_700_000_000_000,
      };

      const dispatch = createDispatch(deps);
      const result = await dispatch("generate_image", {
        prompt: "a red square",
        filename: "e2e.png",
      });

      // --- The call succeeded (Req 3.15, 7.2) ---
      assert.equal(
        result.isError,
        false,
        `expected a successful Tool_Result, got: ${JSON.stringify(result)}`,
      );

      // The stubbed (paid) endpoint was actually exercised.
      assert.equal(fetchCalls, 1, "expected exactly one OpenAI Images API call");

      // --- structuredContent names the saved path under public/images (Req 3.15) ---
      const sc = result.structuredContent;
      assert.ok(sc, "expected structuredContent on the success result");
      assert.equal(typeof sc.savedFilePath, "string");
      assert.equal(
        sc.savedFilePath,
        "public/images/e2e.png",
        `savedFilePath should be under public/images, got: ${sc.savedFilePath}`,
      );
      assert.ok(
        sc.savedFilePath.startsWith("public/images/"),
        "savedFilePath must live under public/images",
      );
      // Success result carries the model used and requested size (Req 7.2).
      assert.equal(sc.model, "gpt-image-1");
      assert.equal(sc.size, "1024x1024");

      // --- The PNG file actually exists on disk in the temp workspace (Req 3.10) ---
      const absSavedPath = path.join(workspaceRoot, "public", "images", "e2e.png");
      const writtenBytes = await readFile(absSavedPath);

      // Its bytes equal the decoded stub base64 (a genuine base64 round trip).
      const expectedBytes = Buffer.from(PNG_B64, "base64");
      assert.deepEqual(
        new Uint8Array(writtenBytes),
        new Uint8Array(expectedBytes),
        "written file bytes must equal the decoded stub base64 (Req 3.10)",
      );
      // Sanity: the written file really is a PNG (correct 8-byte signature).
      assert.deepEqual(
        new Uint8Array(writtenBytes.subarray(0, 8)),
        new Uint8Array(PNG_SIGNATURE),
        "written file must begin with the PNG signature",
      );

      // --- The confirmation text names the path and the paid call (Req 3.15, 7.2) ---
      const text = (result.content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      assert.ok(
        text.includes("public/images/e2e.png"),
        `confirmation text must name the saved path, got: ${text}`,
      );
      assert.ok(
        /paid/i.test(text) && /openai/i.test(text),
        `confirmation text must state a paid OpenAI call was performed, got: ${text}`,
      );
    } finally {
      // ALWAYS remove the temp workspace so the test leaves nothing behind.
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  },
);
