// tools/editImage.mjs — the optional edit_image tool handler.
//
// Produces an edit / variation of an EXISTING local image using OpenAI's Images
// API and writes the result as a PNG directly into the workspace. Like the
// generate_image handler, it orchestrates the pure core modules (validation,
// path safety, filename derivation) and the effectful boundaries (OpenAI
// client, base64 decode, atomic file writer), ALWAYS returns a Tool_Result, and
// NEVER throws to the protocol layer (Req 8.7) so the server keeps running.
//
// Effects are injected through a `deps` object so the handler is fully testable
// in-memory (no real network or disk):
//
//   deps = {
//     config,          // object from config.loadConfig(env, cwd)
//     env,             // environment map for the lazy readApiKey (Req 2.2)
//     fetchImpl,       // fetch used by openaiClient (injected)
//     fs,              // node:fs/promises-like surface (readFile + fileWriter)
//     realpath,        // SYNC realpath(p) -> string for pathSafety
//     readdir,         // SYNC readdir(dir) -> string[] for existing-name lookup
//     readStyleGuide,  // async (path, timeoutMs) -> StyleGuideResult (unused here)
//     now,             // () => number, for filename timestamp + client clock
//   }
//
// Source bytes are read through `deps.fs.readFile`. Any field omitted from
// `deps` falls back to a real implementation so the handler also works when
// wired with production effects by index.mjs.

import { realpathSync, readdirSync } from "node:fs";
import * as realFsPromises from "node:fs/promises";
import path from "node:path";

import { loadConfig, readApiKey } from "../config.mjs";
import { validateEditInput } from "../validation.mjs";
import {
  resolveOutputDir,
  resolveSavePath,
  isWithinWorkspace,
} from "../pathSafety.mjs";
import { deriveUniqueFilename } from "../filenames.mjs";
import { edit } from "../openaiClient.mjs";
import { writeImageAtomic } from "../fileWriter.mjs";
import { decodeBase64 } from "../base64.mjs";

/**
 * The `edit_image` tool definition advertised to the MCP_Host. The description
 * states that invoking the tool performs a PAID OpenAI Images API call
 * (consistent with generate_image, Req 7.1).
 */
export const EDIT_IMAGE_TOOL = {
  name: "edit_image",
  description:
    "Edit or create a variation of an EXISTING image in the workspace using " +
    "OpenAI's Images API, saving the result as a new PNG file in the " +
    "workspace. The source image must resolve to an existing file inside the " +
    "workspace. WARNING: invoking this tool performs a PAID OpenAI Images API " +
    "call that will be billed to the configured OpenAI account.",
  inputSchema: {
    type: "object",
    properties: {
      sourcePath: {
        type: "string",
        minLength: 1,
        description:
          "Workspace-relative (or absolute, within the workspace) path to the " +
          "existing source image to edit.",
      },
      prompt: {
        type: "string",
        minLength: 1,
        maxLength: 4000,
        description: "The text prompt describing the requested edit.",
      },
      outputDir: {
        type: "string",
        description:
          "Optional workspace-relative output directory. Defaults to public/images/.",
      },
      filename: {
        type: "string",
        minLength: 1,
        maxLength: 200,
        description:
          "Optional file name (no path separators or '..'). A unique name is " +
          "generated when omitted.",
      },
    },
    required: ["sourcePath", "prompt"],
  },
};

/**
 * Build a structured error Tool_Result. Never throws.
 * @param {string} errorKind
 * @param {string} message
 * @param {{ parameter?: string, attemptedPath?: string }} [extra]
 * @returns {object} Tool_Result (error)
 */
function errorResult(errorKind, message, extra = {}) {
  const structuredContent = { errorKind };
  if (extra.parameter !== undefined) structuredContent.parameter = extra.parameter;
  if (extra.attemptedPath !== undefined) {
    structuredContent.attemptedPath = extra.attemptedPath;
  }
  return {
    isError: true,
    content: [{ type: "text", text: message }],
    structuredContent,
  };
}

/**
 * Build a successful Tool_Result naming the saved path, the model used, and
 * stating that a paid OpenAI call was performed (Req 9.7, 7.2, 7.3, 7.4).
 * @param {{ savedFilePath: string, model: string, size: string, warnings: string[] }} data
 * @returns {object} Tool_Result (success)
 */
function successResult({ savedFilePath, model, size, warnings }) {
  const warningSuffix =
    warnings.length > 0 ? ` Warnings: ${warnings.join(" ")}` : "";
  const text =
    `Edited image saved to "${savedFilePath}" using model "${model}" ` +
    `(requested size ${size}). This performed a paid OpenAI Images API call.` +
    warningSuffix;
  return {
    isError: false,
    content: [{ type: "text", text }],
    structuredContent: { savedFilePath, model, size, warnings },
  };
}

/**
 * Compute the workspace-relative save path using forward slashes.
 * @param {string} workspaceRoot
 * @param {string} canonicalPath
 * @returns {string}
 */
function toWorkspaceRelative(workspaceRoot, canonicalPath) {
  const rel = path.relative(workspaceRoot, canonicalPath);
  return rel.split(path.sep).join("/");
}

/**
 * Canonicalize the workspace root via the injected realpath, tolerating a
 * root that cannot be resolved (fall back to the normalized absolute path).
 * @param {string} workspaceRoot
 * @param {(p: string) => string} realpath
 * @returns {string}
 */
function canonicalRootOf(workspaceRoot, realpath) {
  const abs = path.resolve(workspaceRoot);
  try {
    return realpath(abs);
  } catch {
    return abs;
  }
}

/**
 * Handle an edit_image tool call. Always returns a Tool_Result; never throws.
 * @param {unknown} args
 * @param {object} [deps]
 * @returns {Promise<object>} Tool_Result
 */
export async function handleEditImage(args, deps = {}) {
  try {
    const env = deps.env ?? process.env;
    const config = deps.config ?? loadConfig(env, process.cwd());
    const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
    const fs = deps.fs ?? realFsPromises;
    const realpath = deps.realpath ?? realpathSync;
    const readdir = deps.readdir ?? readdirSync;
    const now = deps.now ?? Date.now;

    const workspaceRoot = config.workspaceRoot;
    const warnings = [];

    // 1. Validate & normalize the input. Invalid input (missing/empty
    //    sourcePath, invalid prompt, malformed filename) is rejected here with
    //    no fetch and no output (Req 9.2, 9.5).
    const validation = validateEditInput(args, config);
    if (!validation.ok) {
      const err = validation.error;
      return errorResult(err.kind, err.message, { parameter: err.parameter });
    }
    const input = validation.value;

    // 2. Resolve the source image path and confirm it is an EXISTING file
    //    inside the workspace (Req 9.3, 9.4). The source is canonicalized via
    //    the injected realpath, which throws when the path does not exist.
    const canonicalRoot = canonicalRootOf(workspaceRoot, realpath);
    const requestedSourceAbs = path.resolve(canonicalRoot, input.sourcePath);

    let canonicalSource;
    try {
      canonicalSource = realpath(requestedSourceAbs);
    } catch {
      // The source does not resolve to an existing filesystem entry (Req 9.3).
      return errorResult(
        "path_safety",
        `The source image "${input.sourcePath}" does not resolve to an existing file in the workspace.`,
        { parameter: "sourcePath", attemptedPath: requestedSourceAbs },
      );
    }

    // The source exists — reject it if it resolves outside the workspace (Req 9.4).
    if (!isWithinWorkspace(canonicalSource, canonicalRoot)) {
      return errorResult(
        "path_safety",
        `The source image "${input.sourcePath}" resolves to a location outside the workspace.`,
        { parameter: "sourcePath", attemptedPath: canonicalSource },
      );
    }

    // Read the source bytes. A directory or otherwise-unreadable entry means the
    // source is not a usable image file (Req 9.3).
    let sourceBytes;
    try {
      sourceBytes = await fs.readFile(canonicalSource);
    } catch {
      return errorResult(
        "path_safety",
        `The source image "${input.sourcePath}" does not resolve to an existing readable file in the workspace.`,
        { parameter: "sourcePath", attemptedPath: canonicalSource },
      );
    }

    // 3. Lazily read the API key. A missing/empty/whitespace key returns an
    //    error and SKIPS the fetch entirely (Req 2.2, 2.3).
    const keyResult = readApiKey(env);
    if (!keyResult.ok) {
      return errorResult(
        "auth",
        "The OPENAI_API_KEY environment variable is required to edit images.",
      );
    }
    const apiKey = keyResult.key;

    // 4. Resolve the Output_Directory to a canonical path within the workspace
    //    (Req 3.11, 6.1, 6.2).
    const dirResult = resolveOutputDir(input.outputDir, workspaceRoot, realpath);
    if (!dirResult.ok) {
      return errorResult("path_safety", dirResult.error.message, {
        parameter: dirResult.error.parameter,
        attemptedPath: dirResult.error.path,
      });
    }
    const canonicalDir = dirResult.canonicalDir;

    // 5. Derive a non-colliding filename and resolve the canonical save path
    //    (Req 3.12, 3.13, 6.3).
    let existingNames = [];
    try {
      existingNames = readdir(canonicalDir) ?? [];
    } catch {
      existingNames = [];
    }
    const finalName = deriveUniqueFilename(input.filename, existingNames, now());
    const pathResult = resolveSavePath(canonicalDir, finalName, workspaceRoot);
    if (!pathResult.ok) {
      return errorResult("path_safety", pathResult.error.message, {
        parameter: pathResult.error.parameter,
        attemptedPath: pathResult.error.path,
      });
    }
    const canonicalPath = pathResult.canonicalPath;

    // 6. Call the OpenAI Images API edit endpoint. Any failure maps to a
    //    specific errorKind and writes no file (Req 9.6, 8.1, 8.3, 8.6).
    const size = config.defaults?.size;
    const model = config.defaults?.model;
    const apiResult = await edit({
      apiKey,
      model,
      sourceBytes,
      prompt: input.prompt,
      size,
      fetchImpl,
      now,
    });
    if (!apiResult.ok) {
      return errorResult(apiResult.kind, apiResult.message);
    }

    // 7. Decode the base64 payload into binary PNG bytes (Req 3.9).
    let bytes;
    try {
      bytes = decodeBase64(apiResult.b64);
    } catch (err) {
      return errorResult(
        "other",
        `Failed to decode the image data returned by the OpenAI Images API: ${err.message}`,
      );
    }

    // 8. Atomically write the file; a failure leaves no partial file and carries
    //    the attempted path (Req 8.5, 9.6).
    const writeResult = await writeImageAtomic(canonicalPath, bytes, fs);
    if (!writeResult.ok) {
      return errorResult("file_write", writeResult.error.message, {
        attemptedPath: writeResult.error.attemptedPath,
      });
    }

    // 9. Success: report the saved path, the model used, the requested size, any
    //    warnings, and the paid-call notice (Req 9.7, 7.2, 7.3, 7.4).
    const savedFilePath = toWorkspaceRelative(workspaceRoot, canonicalPath);
    return successResult({
      savedFilePath,
      model: apiResult.model,
      size,
      warnings,
    });
  } catch (err) {
    // Absolute backstop: the handler must never throw to the protocol layer.
    return errorResult(
      "other",
      `The edit_image tool failed unexpectedly: ${err && err.message ? err.message : String(err)}`,
    );
  }
}
