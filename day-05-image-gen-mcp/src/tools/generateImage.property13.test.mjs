// Property test for complete-and-honest successful generate results (Property 13).
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fc from "fast-check";

import { handleGenerateImage } from "./generateImage.mjs";
import {
  Supported_Size,
  Default_Quality,
  Default_Model,
} from "../config.mjs";

// A stable, valid base64 PNG-ish payload the SUCCESS fetch returns as b64_json.
const VALID_B64 = Buffer.from("fake-png-bytes-\u{1F4F7}").toString("base64");

// A SUCCESS fetch impl: any request resolves with a 200 body carrying image data.
function successFetch() {
  return async () => ({
    ok: true,
    status: 200,
    async json() {
      return { data: [{ b64_json: VALID_B64 }] };
    },
  });
}

// An in-memory fs stub: mkdir/writeFile/rename/rm all resolve; bytes are recorded.
function inMemoryFs() {
  const written = new Map();
  return {
    written,
    async mkdir() {},
    async writeFile(p, bytes) {
      written.set(p, bytes);
    },
    async rename(from, to) {
      if (written.has(from)) {
        written.set(to, written.get(from));
        written.delete(from);
      }
    },
    async rm() {},
  };
}

// Feature: day-05-image-gen-mcp, Property 13: For any successful generation or edit, the Tool_Result includes the Saved_File_Path, the Image_Model actually used, and the requested size, and its confirmation message names the Saved_File_Path and Image_Model and states that a paid OpenAI call was performed.
test("Property 13: successful generate results are complete and honest", () => {
  const promptArb = fc.string({ minLength: 1, maxLength: 4000 });
  const sizeArb = fc.constantFrom(...Supported_Size);
  // Optional model: when omitted the handler selects Default_Model. Because the
  // SUCCESS fetch resolves on the first try, no fallback occurs, so the model
  // actually used equals the selected model.
  const modelArb = fc.option(fc.constantFrom("gpt-image-1", "dall-e-3"), {
    nil: undefined,
  });

  fc.assert(
    fc.asyncProperty(
      promptArb,
      sizeArb,
      modelArb,
      async (prompt, size, model) => {
        const workspaceRoot = path.resolve("/ws-property13");
        const config = {
          workspaceRoot,
          defaultOutputDir: "public/images",
          styleGuidePath: null,
          defaults: {
            size: "1024x1024",
            quality: Default_Quality,
            model: Default_Model,
          },
        };

        const args = { prompt, size };
        if (model !== undefined) args.model = model;

        const result = await handleGenerateImage(args, {
          config,
          env: { OPENAI_API_KEY: "sk-test-valid-key" },
          fetchImpl: successFetch(),
          fs: inMemoryFs(),
          realpath: (p) => p, // identity: every path canonicalizes to itself
          readdir: () => [], // no existing files
          readStyleGuide: async () => ({ status: "none" }),
          now: () => 1_700_000_000_000, // constant clock
        });

        // A successful, non-error Tool_Result.
        assert.equal(result.isError, false);

        const sc = result.structuredContent;
        // Includes a non-empty Saved_File_Path.
        assert.equal(typeof sc.savedFilePath, "string");
        assert.ok(sc.savedFilePath.length > 0, "savedFilePath must be non-empty");

        // The model actually used equals the selected model (default when omitted).
        const expectedModel = model !== undefined ? model : Default_Model;
        assert.equal(sc.model, expectedModel);

        // The requested size is echoed back unchanged.
        assert.equal(sc.size, size);

        // The confirmation message names the saved path and model and states that
        // a paid OpenAI call was performed.
        const text = result.content[0].text;
        assert.ok(
          text.includes(sc.savedFilePath),
          "confirmation must name the saved file path",
        );
        assert.ok(text.includes(sc.model), "confirmation must name the model");
        assert.match(text, /paid/i);
      },
    ),
    { numRuns: 100 },
  );
});
