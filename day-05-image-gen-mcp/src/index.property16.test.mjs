// Property test for the server surviving every error path (Property 16).
//
// This drives a SINGLE dispatch instance (from createServer) through an error
// scenario followed by a valid generate_image call, proving the same server
// instance keeps serving after any error — no restart required (Req 8.7).
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fc from "fast-check";

import { createServer } from "./index.mjs";
import { loadConfig } from "./config.mjs";

// A deterministic, non-secret key used for the scenarios that DO reach fetch.
const VALID_KEY = "sk-test-property16-0000000000000000";
// A constant clock so filename derivation is deterministic.
const NOW = 1_700_000_000_000;
// A base64 payload the success fetch returns (decodes to some PNG-ish bytes).
const SUCCESS_B64 = Buffer.from("fake-png-bytes").toString("base64");

const KNOWN_TOOLS = new Set([
  "generate_image",
  "edit_image",
  "list_generated_images",
]);

/** Build a minimal Response-like object for the injected fetch. */
function makeResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body ?? {},
  };
}

/** A fetch that always succeeds with decodable image data. */
function successFetch() {
  return makeResponse(200, { data: [{ b64_json: SUCCESS_B64 }] });
}

// A workspace root that is absolute; realpath is identity so it need not exist
// on disk, and all fs writes are stubbed in-memory.
const WORKSPACE_ROOT = path.resolve("property16-workspace");

// In-memory fs stub: every operation resolves without touching the disk.
const fsStub = {
  mkdir: async () => undefined,
  writeFile: async () => undefined,
  rename: async () => undefined,
  rm: async () => undefined,
};

// Feature: day-05-image-gen-mcp, Property 16: For any error scenario, after the server returns an error Tool_Result a subsequent valid tool call is accepted and processed successfully without a restart.
test("Property 16: the server survives every error", async () => {
  // Mutable controllers shared by ONE long-lived dispatch instance. Behavior is
  // varied per call by mutating these between the error call and the valid call,
  // so the SAME server instance is proven to keep working after every error.
  const env = { OPENAI_API_KEY: VALID_KEY };
  const fetchController = { impl: successFetch, calls: 0 };

  const fetchImpl = (url, options) => {
    fetchController.calls += 1;
    return fetchController.impl(url, options);
  };

  const config = loadConfig({ WORKSPACE_ROOT }, WORKSPACE_ROOT);

  // Construct the server ONCE. All iterations reuse this same instance, so a
  // clean run proves it survives many errors interleaved with valid calls.
  const { dispatch } = createServer({
    config,
    env,
    fetchImpl,
    fs: fsStub,
    realpath: (p) => p, // identity: WORKSPACE_ROOT need not exist on disk
    readdir: () => [], // no existing files => default filename is unique
    readStyleGuide: async () => ({ status: "none" }),
    now: () => NOW,
  });

  // Each error scenario carries the tool name + args to invoke and the setup it
  // needs applied to the shared controllers before the error call.
  const scenarioArb = fc.oneof(
    // Unknown tool name -> validation error Tool_Result (no fetch).
    fc.record({
      kind: fc.constant("unknown_tool"),
      name: fc.string().filter((s) => !KNOWN_TOOLS.has(s)),
    }),
    // Invalid input: empty prompt -> validation error (no fetch).
    fc.constant({ kind: "empty_prompt" }),
    // Missing API key -> auth error before any fetch.
    fc.constant({ kind: "missing_key" }),
    // Injected fetch rejects with 401 -> auth error.
    fc.constant({ kind: "http_401" }),
    // Injected fetch rejects with 500 -> server error.
    fc.constant({ kind: "http_500" }),
    // Injected fetch throws (network failure) -> network error.
    fc.constant({ kind: "network_throw" }),
  );

  await fc.assert(
    fc.asyncProperty(scenarioArb, async (scenario) => {
      // --- Arrange the error scenario on the shared controllers. ---
      let errorCall;
      switch (scenario.kind) {
        case "unknown_tool":
          env.OPENAI_API_KEY = VALID_KEY;
          fetchController.impl = successFetch;
          errorCall = { name: scenario.name, args: {} };
          break;
        case "empty_prompt":
          env.OPENAI_API_KEY = VALID_KEY;
          fetchController.impl = successFetch;
          errorCall = { name: "generate_image", args: { prompt: "" } };
          break;
        case "missing_key":
          delete env.OPENAI_API_KEY;
          fetchController.impl = successFetch;
          errorCall = { name: "generate_image", args: { prompt: "a valid prompt" } };
          break;
        case "http_401":
          env.OPENAI_API_KEY = VALID_KEY;
          fetchController.impl = () => makeResponse(401, { error: { message: "bad key" } });
          errorCall = { name: "generate_image", args: { prompt: "a valid prompt" } };
          break;
        case "http_500":
          env.OPENAI_API_KEY = VALID_KEY;
          fetchController.impl = () => makeResponse(500, { error: { message: "boom" } });
          errorCall = { name: "generate_image", args: { prompt: "a valid prompt" } };
          break;
        case "network_throw":
          env.OPENAI_API_KEY = VALID_KEY;
          fetchController.impl = () => {
            throw new Error("network down");
          };
          errorCall = { name: "generate_image", args: { prompt: "a valid prompt" } };
          break;
        default:
          throw new Error(`unhandled scenario ${scenario.kind}`);
      }

      // --- Act 1: the error call must return an error Tool_Result, not throw. ---
      const errorResult = await dispatch(errorCall.name, errorCall.args);
      assert.equal(
        errorResult.isError,
        true,
        `error scenario "${scenario.kind}" should yield isError:true`,
      );
      assert.ok(
        Array.isArray(errorResult.content) && errorResult.content.length > 0,
        "error Tool_Result must carry content",
      );

      // --- Act 2: the SAME instance must now serve a valid call successfully. ---
      env.OPENAI_API_KEY = VALID_KEY;
      fetchController.impl = successFetch;

      const validResult = await dispatch("generate_image", {
        prompt: "A serene mountain landscape at dawn",
      });

      // The subsequent valid call is accepted and processed successfully — the
      // server did not need a restart after the error (Req 8.7).
      assert.equal(
        validResult.isError,
        false,
        `after "${scenario.kind}", a valid call should succeed`,
      );
      assert.equal(typeof validResult.structuredContent.savedFilePath, "string");
      assert.ok(validResult.structuredContent.savedFilePath.length > 0);
      assert.equal(validResult.structuredContent.model, "gpt-image-1");
    }),
    { numRuns: 100 },
  );
});
