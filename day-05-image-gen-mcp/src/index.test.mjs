// index.test.mjs — unit tests for the ListTools request handler.
//
// Covers Req 1.7: a tool-list request received before the server is ready must
// return a not-ready error and MUST NOT return a partial tool list. Once the
// server is ready, the handler returns the built tool list.

import { test } from "node:test";
import assert from "node:assert/strict";

import { McpError } from "@modelcontextprotocol/sdk/types.js";

import { makeListToolsHandler } from "./index.mjs";

// A non-empty, representative tool list. The handler treats it opaquely.
const SAMPLE_TOOLS = [
  { name: "generate_image", description: "d1", inputSchema: {} },
  { name: "edit_image", description: "d2", inputSchema: {} },
];

test("pre-ready tool-list request rejects with a not-ready error and no partial list (Req 1.7)", async () => {
  const handler = makeListToolsHandler({
    getReady: () => false,
    tools: SAMPLE_TOOLS,
  });

  // The handler must reject; it must not resolve to any (partial) tool list.
  let resolvedValue;
  let threw = false;
  try {
    resolvedValue = await handler();
  } catch (err) {
    threw = true;
    // Surfaced as an MCP protocol error indicating not-ready.
    assert.ok(err instanceof McpError, "error should be an McpError");
    assert.match(err.message, /not (yet )?ready/i);
  }

  assert.equal(threw, true, "handler should reject when not ready");
  assert.equal(
    resolvedValue,
    undefined,
    "handler must not return a tool list when not ready",
  );

  // Also assert via assert.rejects for an explicit rejection contract.
  await assert.rejects(
    makeListToolsHandler({ getReady: () => false, tools: SAMPLE_TOOLS })(),
    (err) => err instanceof McpError,
  );
});

test("ready tool-list request resolves to the built tool list (Req 1.6)", async () => {
  const handler = makeListToolsHandler({
    getReady: () => true,
    tools: SAMPLE_TOOLS,
  });

  const result = await handler();
  assert.deepEqual(result, { tools: SAMPLE_TOOLS });
  // Same array instance is returned (no copy/partial rebuild).
  assert.equal(result.tools, SAMPLE_TOOLS);
});
