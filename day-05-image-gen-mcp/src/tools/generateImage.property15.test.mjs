// Property test for failure mapping without writing a file (Property 15).
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fc from "fast-check";

import { handleGenerateImage } from "./generateImage.mjs";

// A fixed absolute workspace root. `realpath` is stubbed as the identity below,
// so canonicalization keeps every resolved path inside this root and the ONLY
// thing under test is failure mapping + the no-file-written guarantee.
const WORKSPACE_ROOT = path.resolve("prop15-workspace-root");

function makeConfig() {
  return {
    workspaceRoot: WORKSPACE_ROOT,
    defaultOutputDir: "public/images",
    styleGuidePath: null,
    enableEditTool: false,
    enableListTool: false,
    defaults: { size: "1024x1024", quality: "auto", model: "gpt-image-1" },
  };
}

// An fs stub that records every durable step. A "durable write" only happens
// when `rename` completes (the atomic writer writes a temp file then renames it
// into place). `writeFile` can be forced to reject to exercise the file_write
// failure path; on that path the writer must remove the temp artifact (rm) and
// must NEVER rename anything into place.
function makeFsStub({ failWrite }) {
  const state = { mkdir: [], written: [], renamed: [], removed: [] };
  const fs = {
    async mkdir(dir) {
      state.mkdir.push(dir);
    },
    async writeFile(p) {
      if (failWrite) {
        throw new Error("simulated disk write failure");
      }
      state.written.push(p);
    },
    async rename(_from, to) {
      state.renamed.push(to);
    },
    async rm(p) {
      state.removed.push(p);
    },
  };
  return { fs, state };
}

// A fetch stub that replays configured behaviors in call order and records the
// number of calls. Behaviors:
//   { type: "http", status, body } -> a non-2xx Response the client maps by status
//   { type: "success", b64 }       -> a 200 Response carrying b64_json image data
//   { type: "throw", errorName }   -> a rejected fetch (network / AbortError)
function makeFetchStub(behaviors) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const index = calls.length;
    calls.push({ url, options });
    const behavior = behaviors[index];
    if (!behavior) {
      throw new Error(
        `unexpected extra fetch call #${index + 1} (only ${behaviors.length} configured)`,
      );
    }
    if (behavior.type === "throw") {
      const err = new Error("fetch failed");
      err.name = behavior.errorName;
      throw err;
    }
    if (behavior.type === "success") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ b64_json: behavior.b64 }] }),
      };
    }
    // "http" error response
    return {
      ok: false,
      status: behavior.status,
      json: async () => behavior.body,
    };
  };
  return { fetchImpl, calls };
}

const SUPPORTED_SIZE = fc.constantFrom(
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "1792x1024",
  "1024x1792",
  "auto",
);
const SUPPORTED_QUALITY = fc.constantFrom(
  "low",
  "medium",
  "high",
  "standard",
  "hd",
  "auto",
);
const VALID_PROMPT = fc.string({ minLength: 1, maxLength: 400 });
const B64 = fc.string({ minLength: 1, maxLength: 64 });
const ACCESS_REJECT_STATUS = fc.constantFrom(403, 404);
const SERVER_STATUS = fc.constantFrom(500, 502, 503, 504);

// Every failing scenario named by Property 15. Each yields the fetch behaviors
// to replay, whether the file write itself should fail, and the errorKind the
// handler must report. The default model is gpt-image-1 (no `model` supplied),
// so a model-access rejection triggers exactly one dall-e-3 fallback — which is
// also access-rejected here, so the mapped kind stays "model_access".
const failingScenario = fc.oneof(
  // Invalid API key -> 401 -> auth
  fc.constant({
    label: "auth",
    expectedKind: "auth",
    failWrite: false,
    behaviors: [
      { type: "http", status: 401, body: { error: { message: "invalid api key" } } },
    ],
  }),
  // No model access -> 403/404 on BOTH gpt-image-1 and the dall-e-3 fallback
  fc.tuple(ACCESS_REJECT_STATUS, ACCESS_REJECT_STATUS).map(([a, b]) => ({
    label: "model_access",
    expectedKind: "model_access",
    failWrite: false,
    behaviors: [
      { type: "http", status: a, body: { error: { message: "no access to model" } } },
      { type: "http", status: b, body: { error: { message: "no access to model" } } },
    ],
  })),
  // Network failure -> fetch rejects with a non-abort error -> network
  fc.constant({
    label: "network",
    expectedKind: "network",
    failWrite: false,
    behaviors: [{ type: "throw", errorName: "TypeError" }],
  }),
  // Timeout -> fetch rejects with an AbortError -> timeout
  fc.constant({
    label: "timeout",
    expectedKind: "timeout",
    failWrite: false,
    behaviors: [{ type: "throw", errorName: "AbortError" }],
  }),
  // Rate limit -> 429 -> rate_limit
  fc.constant({
    label: "rate_limit",
    expectedKind: "rate_limit",
    failWrite: false,
    behaviors: [
      { type: "http", status: 429, body: { error: { message: "rate limited" } } },
    ],
  }),
  // Server-side error -> 5xx -> server
  SERVER_STATUS.map((status) => ({
    label: "server",
    expectedKind: "server",
    failWrite: false,
    behaviors: [{ type: "http", status, body: { error: { message: "boom" } } }],
  })),
  // Content-policy rejection -> 400 with a content_policy error body -> content_policy
  fc.constant({
    label: "content_policy",
    expectedKind: "content_policy",
    failWrite: false,
    behaviors: [
      {
        type: "http",
        status: 400,
        body: {
          error: {
            code: "content_policy_violation",
            message: "Your request was rejected as a result of our safety system.",
          },
        },
      },
    ],
  }),
  // File-write failure -> API succeeds but fs.writeFile rejects -> file_write
  B64.map((b64) => ({
    label: "file_write",
    expectedKind: "file_write",
    failWrite: true,
    behaviors: [{ type: "success", b64 }],
  })),
);

// Feature: day-05-image-gen-mcp, Property 15: For any failing outcome — invalid key, no model access, timeout or network failure, rate-limit, server-side error, content-policy rejection, or a file-write failure — the Tool_Result is marked as an error with the correct errorKind and message, no image file is written, and no partial file is left behind.
test("Property 15: failures map to the correct errorKind and never write a file", async () => {
  await fc.assert(
    fc.asyncProperty(
      failingScenario,
      VALID_PROMPT,
      SUPPORTED_SIZE,
      SUPPORTED_QUALITY,
      async (scenario, prompt, size, quality) => {
        const { fetchImpl, calls } = makeFetchStub(scenario.behaviors);
        const { fs, state } = makeFsStub({ failWrite: scenario.failWrite });

        const result = await handleGenerateImage(
          { prompt, size, quality },
          {
            config: makeConfig(),
            env: { OPENAI_API_KEY: "sk-valid-test-key-1234567890" },
            fetchImpl,
            fs,
            realpath: (p) => p, // identity: canonical path == requested path (in-workspace)
            readdir: () => [], // no pre-existing files
            readStyleGuide: async () => ({ status: "none" }),
            now: () => 1_700_000_000_000,
          },
        );

        // 1. The result is a structured error with the expected kind + a message.
        assert.equal(
          result.isError,
          true,
          `${scenario.label}: expected an error Tool_Result`,
        );
        assert.equal(
          result.structuredContent.errorKind,
          scenario.expectedKind,
          `${scenario.label}: wrong errorKind`,
        );
        assert.ok(
          typeof result.content?.[0]?.text === "string" &&
            result.content[0].text.length > 0,
          `${scenario.label}: an error must carry a message`,
        );

        // 2. No image file was durably written: a rename into place never
        //    completed and no bytes landed at the destination.
        assert.equal(
          state.renamed.length,
          0,
          `${scenario.label}: no file may be renamed into place on failure`,
        );
        assert.equal(
          state.written.length,
          0,
          `${scenario.label}: no image bytes may be durably written on failure`,
        );

        // 3. The fetch stub was consumed exactly as configured (proves the
        //    fallback fired once for model_access and not at all otherwise).
        assert.equal(
          calls.length,
          scenario.behaviors.length,
          `${scenario.label}: unexpected number of API calls`,
        );

        // 4. For the file-write failure, the temp artifact was cleaned up so no
        //    partial file is left behind, and the attempted path is reported.
        if (scenario.label === "file_write") {
          assert.ok(
            state.removed.length >= 1,
            "file_write: the temp artifact must be removed (no partial file)",
          );
          assert.ok(
            typeof result.structuredContent.attemptedPath === "string" &&
              result.structuredContent.attemptedPath.length > 0,
            "file_write: the attempted Saved_File_Path must be reported",
          );
        }
      },
    ),
    { numRuns: 200 },
  );
});
