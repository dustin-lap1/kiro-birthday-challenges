// index.mjs — entry / protocol layer.
//
// Bootstraps configuration, constructs the MCP `Server`, registers the
// `ListTools` and `CallTool` request handlers, connects the
// `StdioServerTransport`, and arms the startup watchdog. Owns the `ready` flag
// and the process exit behavior. Contains no business logic — every tool call
// is delegated to the handlers in `./tools/*.mjs`, each of which always returns
// a Tool_Result and never throws (Req 8.7).
//
// The module is structured so it can be imported by tests WITHOUT spawning the
// stdio transport or exiting the process: the pure pieces (`buildToolList`,
// `makeRedactor`/`redact`, `createDispatch`, `makeListToolsHandler`) are exported
// directly, and the actual stdio start (`start`) only runs automatically when
// this file is executed as the main module.
//
// Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.7, 2.6, 9.1, 10.1

import { pathToFileURL } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";

import { loadConfig, readApiKey } from "./config.mjs";
import {
  GENERATE_IMAGE_TOOL,
  handleGenerateImage,
} from "./tools/generateImage.mjs";
import { EDIT_IMAGE_TOOL, handleEditImage } from "./tools/editImage.mjs";
import {
  name as LIST_TOOL_NAME,
  description as LIST_TOOL_DESCRIPTION,
  inputSchema as LIST_TOOL_INPUT_SCHEMA,
  handleListGeneratedImages,
} from "./tools/listGeneratedImages.mjs";

// Re-export the generate/edit tool definitions for convenience.
export { GENERATE_IMAGE_TOOL, EDIT_IMAGE_TOOL };

/**
 * The `list_generated_images` tool definition, assembled from the pieces the
 * list handler advertises (it exports name/description/inputSchema separately).
 */
export const LIST_GENERATED_IMAGES_TOOL = {
  name: LIST_TOOL_NAME,
  description: LIST_TOOL_DESCRIPTION,
  inputSchema: LIST_TOOL_INPUT_SCHEMA,
};

/** Server identity advertised to the MCP_Host. */
export const SERVER_INFO = {
  name: "day-05-image-gen-mcp",
  version: "1.0.0",
};

/** Startup budget: the server must be ready within this many ms (Req 1.3, 1.4). */
export const STARTUP_TIMEOUT_MS = 10_000;

/** Minimum length of a secret substring that the redactor will strip. */
const DEFAULT_MIN_SUBSTRING_LENGTH = 8;

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

/**
 * Build the advertised tool list: always `generate_image`, plus each optional
 * tool whose enable flag is set, and excluding every optional tool whose flag is
 * not set (Req 1.6, 9.1, 10.1).
 *
 * @param {{ enableEditTool?: boolean, enableListTool?: boolean }} [flags]
 * @returns {Array<{ name: string, description: string, inputSchema: object }>}
 */
export function buildToolList(flags = {}) {
  const { enableEditTool = false, enableListTool = false } = flags;
  const tools = [GENERATE_IMAGE_TOOL];
  if (enableEditTool) tools.push(EDIT_IMAGE_TOOL);
  if (enableListTool) tools.push(LIST_GENERATED_IMAGES_TOOL);
  return tools;
}

// ---------------------------------------------------------------------------
// Secret redaction (Req 2.6, Property 3)
// ---------------------------------------------------------------------------

/**
 * Replace every literal occurrence of `needle` in `haystack` with `replacement`.
 * Uses split/join (not RegExp) so no characters in the secret are interpreted.
 * @param {string} haystack
 * @param {string} needle
 * @param {string} replacement
 * @returns {string}
 */
function replaceAllLiteral(haystack, needle, replacement) {
  if (needle === "") return haystack;
  return haystack.split(needle).join(replacement);
}

/**
 * Strip the API-key value — and any sufficiently-long substring of it — from a
 * piece of text before it is logged (Req 2.6). The complete key value is always
 * removed; substrings of length >= `minSubstringLength` are also removed as
 * defense-in-depth so a partially-leaked key never surfaces in output.
 *
 * When `secret` is null/empty, the text is returned unchanged.
 *
 * @param {unknown} text
 * @param {string | null | undefined} secret
 * @param {{ minSubstringLength?: number, placeholder?: string }} [options]
 * @returns {string}
 */
export function redact(text, secret, options = {}) {
  const {
    minSubstringLength = DEFAULT_MIN_SUBSTRING_LENGTH,
    placeholder = "[REDACTED]",
  } = options;

  let out = typeof text === "string" ? text : String(text ?? "");
  if (typeof secret !== "string" || secret.length === 0) return out;

  // 1. Remove the complete key value wherever it appears.
  out = replaceAllLiteral(out, secret, placeholder);

  // 2. Remove any substring of the key of length >= minSubstringLength,
  //    longest-first so redaction is greedy and never leaks a partial key.
  if (secret.length >= minSubstringLength) {
    for (let len = secret.length - 1; len >= minSubstringLength; len--) {
      for (let i = 0; i + len <= secret.length; i++) {
        const sub = secret.slice(i, i + len);
        if (out.includes(sub)) {
          out = replaceAllLiteral(out, sub, placeholder);
        }
      }
    }
  }

  return out;
}

/**
 * Create a redactor function bound to a secret. All stderr/log output is routed
 * through this so the API key can never appear in emitted output (Req 2.6).
 * @param {string | null | undefined} secret
 * @param {{ minSubstringLength?: number, placeholder?: string }} [options]
 * @returns {(text: unknown) => string}
 */
export function makeRedactor(secret, options = {}) {
  return (text) => redact(text, secret, options);
}

// ---------------------------------------------------------------------------
// Request handlers
// ---------------------------------------------------------------------------

/**
 * Create the `ListTools` handler. If the server is not yet ready, it throws a
 * not-ready error (surfaced to the host as an error response) rather than
 * returning a partial tool list (Req 1.7). Once ready, it returns the built
 * tool list (Req 1.6).
 *
 * @param {{ getReady: () => boolean, tools: Array<object> }} args
 * @returns {() => Promise<{ tools: Array<object> }>}
 */
export function makeListToolsHandler({ getReady, tools }) {
  return async () => {
    if (!getReady()) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "The image generation MCP server is not yet ready; please retry after startup completes.",
      );
    }
    return { tools };
  };
}

/**
 * Create a dispatch function that routes a tool call by name to the matching
 * handler. Every handler returns a Tool_Result and never throws, so dispatch
 * never throws to the protocol layer and the server survives every error
 * (Req 8.7). An unknown tool name yields a validation error Tool_Result.
 *
 * @param {object} [deps] — injected effects/config forwarded to each handler.
 * @returns {(name: string, args: unknown) => Promise<object>}
 */
export function createDispatch(deps = {}) {
  return async function dispatch(name, args) {
    switch (name) {
      case GENERATE_IMAGE_TOOL.name:
        return handleGenerateImage(args, deps);
      case EDIT_IMAGE_TOOL.name:
        return handleEditImage(args, deps);
      case LIST_GENERATED_IMAGES_TOOL.name:
        return handleListGeneratedImages(args, deps);
      default:
        return {
          isError: true,
          content: [
            { type: "text", text: `Unknown tool: ${String(name)}` },
          ],
          structuredContent: { errorKind: "validation", parameter: "name" },
        };
    }
  };
}

/**
 * Construct the MCP `Server`, register the ListTools/CallTool handlers, and
 * return the wiring needed to connect a transport and flip the ready flag. This
 * does NOT connect a transport or start the watchdog — `start` does that — so it
 * is safe to call in tests.
 *
 * @param {object} [deps]
 * @returns {{
 *   server: object,
 *   config: object,
 *   tools: Array<object>,
 *   dispatch: (name: string, args: unknown) => Promise<object>,
 *   getReady: () => boolean,
 *   markReady: () => void,
 * }}
 */
export function createServer(deps = {}) {
  const env = deps.env ?? process.env;
  const cwd = deps.cwd ?? process.cwd();
  const config = deps.config ?? loadConfig(env, cwd);

  let ready = false;
  const getReady = () => ready;
  const markReady = () => {
    ready = true;
  };

  const tools = buildToolList(config);
  const dispatch = deps.dispatch ?? createDispatch({ ...deps, config, env });

  const server =
    deps.server ??
    new Server(SERVER_INFO, { capabilities: { tools: {} } });

  // Register handlers up front (Req 1.3). Readiness is only flipped after the
  // transport connects, so a pre-ready ListTools request is rejected (Req 1.7).
  server.setRequestHandler(
    ListToolsRequestSchema,
    makeListToolsHandler({ getReady, tools }),
  );
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const params = request?.params ?? {};
    const name = params.name;
    const args = params.arguments ?? {};
    return dispatch(name, args);
  });

  return { server, config, tools, dispatch, getReady, markReady };
}

// ---------------------------------------------------------------------------
// Startup (stdio transport + watchdog)
// ---------------------------------------------------------------------------

/**
 * Start the MCP server over stdio. Registers handlers, connects the transport,
 * and marks the server ready only AFTER both have completed (Req 1.1, 1.3).
 * Arms a startup watchdog that writes a startup/registration failure to stderr
 * (through the redactor) and exits non-zero if readiness is not reached within
 * `STARTUP_TIMEOUT_MS` (Req 1.4). All stderr output is redacted (Req 2.6).
 *
 * Effects are injectable for testing: `env`, `cwd`, `config`, `server`,
 * `transport`, `exit`, `logError`, `setTimeoutImpl`, `clearTimeoutImpl`.
 *
 * @param {object} [deps]
 * @returns {Promise<object | undefined>} the server context, or undefined on failure.
 */
export async function start(deps = {}) {
  const env = deps.env ?? process.env;

  // Bind the redactor to the current key so nothing we log can leak it (Req 2.6).
  const keyResult = readApiKey(env);
  const secret = keyResult.ok ? keyResult.key : null;
  const redactor = makeRedactor(secret);
  const logError =
    deps.logError ??
    ((msg) => process.stderr.write(redactor(String(msg)) + "\n"));

  const exit = deps.exit ?? ((code) => process.exit(code));
  const setTimeoutImpl = deps.setTimeoutImpl ?? setTimeout;
  const clearTimeoutImpl = deps.clearTimeoutImpl ?? clearTimeout;

  const ctx = createServer({ ...deps, env });

  // Arm the startup watchdog (Req 1.4). If not ready in time, report and exit.
  const watchdog = setTimeoutImpl(() => {
    if (!ctx.getReady()) {
      logError(
        `Startup/registration failure: the image generation MCP server did not become ready within ${STARTUP_TIMEOUT_MS}ms of process start.`,
      );
      exit(1);
    }
  }, STARTUP_TIMEOUT_MS);
  if (watchdog && typeof watchdog.unref === "function") watchdog.unref();

  try {
    const transport = deps.transport ?? new StdioServerTransport();
    await ctx.server.connect(transport);

    // Ready only after handlers are registered AND the transport is connected.
    ctx.markReady();
    clearTimeoutImpl(watchdog);
    return ctx;
  } catch (err) {
    clearTimeoutImpl(watchdog);
    logError(
      `Startup/registration failure: ${err && err.message ? err.message : String(err)}`,
    );
    exit(1);
    return undefined;
  }
}

/**
 * Backwards-compatible alias.
 * @param {object} [deps]
 * @returns {Promise<object | undefined>}
 */
export async function main(deps) {
  return start(deps);
}

// Only start the stdio transport when run as the main module, so importing this
// file in tests never spawns the transport or exits the process.
const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  start().catch((err) => {
    // Last-resort guard: start() already handles failures, but never crash out.
    try {
      process.stderr.write(
        `Fatal startup error: ${err && err.message ? err.message : String(err)}\n`,
      );
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
}
