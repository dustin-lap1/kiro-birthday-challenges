// integration.startup.test.mjs — lifecycle/integration test over stdio.
//
// Spawns the MCP server as a real child process (`node src/index.mjs`) and
// performs a full MCP handshake using the SDK's Client + StdioClientTransport,
// then calls listTools() and asserts that `generate_image` is advertised.
//
// Requirements: 1.1 (stdio transport), 1.3 (registers/advertises generate_image
// within the startup budget).
//
// SAFETY: this test spawns a child process. Everything is wrapped so the client,
// transport, and child are ALWAYS torn down in a `finally` block, and the test
// carries a hard timeout so it fails fast instead of hanging forever.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Resolve the project root (folder containing src/) and the server entry.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const serverEntry = path.join("src", "index.mjs");

test(
  "server starts over stdio and advertises generate_image (Req 1.1, 1.3)",
  { timeout: 15_000 },
  async () => {
    // StdioClientTransport spawns the child process itself with the given
    // command/args/cwd/env. Listing tools performs no OpenAI API call, but we
    // provide a dummy key so startup is clean and nothing warns.
    const transport = new StdioClientTransport({
      command: process.execPath, // the `node` binary running this test
      args: [serverEntry],
      cwd: projectRoot,
      env: { ...process.env, OPENAI_API_KEY: "sk-test" },
      stderr: "ignore",
    });

    const client = new Client(
      { name: "integration-test-client", version: "1.0.0" },
      { capabilities: {} },
    );

    try {
      // connect() launches the child and performs the MCP handshake.
      await client.connect(transport);

      const result = await client.listTools();
      const toolNames = (result.tools ?? []).map((t) => t.name);

      assert.ok(
        toolNames.includes("generate_image"),
        `expected advertised tools to include "generate_image", got: ${JSON.stringify(
          toolNames,
        )}`,
      );
    } finally {
      // ALWAYS tear down so the test can never hang: closing the client closes
      // the transport, which terminates the spawned child process. Guard each
      // step so a failure in one still runs the next.
      try {
        await client.close();
      } catch {
        /* ignore */
      }
      try {
        await transport.close();
      } catch {
        /* ignore */
      }
    }
  },
);
