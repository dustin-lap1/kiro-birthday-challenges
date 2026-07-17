// tools/generateImage.mjs — the generate_image tool handler.
//
// Orchestrates the pure core modules (validation, prompt composition, path
// safety, filename derivation) and the effectful boundaries (OpenAI client,
// base64 decode, atomic file writer) into a single tool call. It ALWAYS returns
// a Tool_Result and NEVER throws to the protocol layer (Req 8.7), so the server
// keeps running and can serve the next call after any error.
//
// Effects are injected through a `deps` object so the handler is fully testable
// in-memory (no real network or disk):
//
//   deps = {
//     config,          // object from config.loadConfig(env, cwd)
//     env,             // environment map for the lazy readApiKey (Req 2.2)
//     fetchImpl,       // fetch used by openaiClient (injected)
//     fs,              // node:fs/promises-like surface for fileWriter
//     realpath,        // SYNC realpath(p) -> string for pathSafety
//     readdir,         // SYNC readdir(dir) -> string[] for existing-name lookup
//     readStyleGuide,  // async (path, timeoutMs) -> StyleGuideResult
//     now,             // () => number, for filename timestamp + client clock
//   }
//
// Any field omitted from `deps` falls back to a real implementation, so the
// handler also works when wired with production effects by index.mjs.

import { realpathSync, readdirSync } from "node:fs";
import * as realFsPromises from "node:fs/promises";
import path from "node:path";

import { loadConfig, readApiKey } from "../config.mjs";
import { validateGenerateInput } from "../validation.mjs";
import {
  composePrompt,
  readStyleGuide as defaultReadStyleGuide,
  STYLE_GUIDE_TIMEOUT_MS,
} from "../promptComposer.mjs";
import { resolveOutputDir, resolveSavePath } from "../pathSafety.mjs";
import { deriveUniqueFilename } from "../filenames.mjs";
import { generate } from "../openaiClient.mjs";
import { writeImageAtomic } from "../fileWriter.mjs";
import { decodeBase64 } from "../base64.mjs";

/**
 * The `generate_image` tool definition advertised to the MCP_Host. The
 * description states that invoking the tool performs a PAID OpenAI Images API
 * call (Req 7.1).
 */
export const GENERATE_IMAGE_TOOL = {
  name: "generate_image",
  description:
    "Generate an image from a text prompt using OpenAI's Images API and save " +
    "it as a PNG file directly into the workspace. WARNING: invoking this tool " +
    "performs a PAID OpenAI Images API call that will be billed to the " +
    "configured OpenAI account.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        minLength: 1,
        maxLength: 4000,
        description: "The text prompt describing the image to generate.",
      },
      size: {
        type: "string",
        enum: [
          "1024x1024",
          "1536x1024",
          "1024x1536",
          "1792x1024",
          "1024x1792",
          "auto",
        ],
        description: "Optional image size. Defaults to 1024x1024.",
      },
      quality: {
        type: "string",
        enum: ["low", "medium", "high", "standard", "hd", "auto"],
        description: "Optional image quality. Defaults to auto.",
      },
      model: {
        type: "string",
        enum: ["gpt-image-1", "dall-e-3"],
        description: "Optional image model. Defaults to gpt-image-1.",
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
    required: ["prompt"],
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
 * stating that a paid OpenAI call was performed (Req 7.2, 7.3, 7.4).
 * @param {{ savedFilePath: string, model: string, size: string, warnings: string[] }} data
 * @returns {object} Tool_Result (success)
 */
function successResult({ savedFilePath, model, size, warnings }) {
  const warningSuffix =
    warnings.length > 0 ? ` Warnings: ${warnings.join(" ")}` : "";
  const text =
    `Generated image saved to "${savedFilePath}" using model "${model}" ` +
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
 * Handle a generate_image tool call. Always returns a Tool_Result; never throws.
 * @param {unknown} args
 * @param {object} [deps]
 * @returns {Promise<object>} Tool_Result
 */
export async function handleGenerateImage(args, deps = {}) {
  try {
    const env = deps.env ?? process.env;
    const config = deps.config ?? loadConfig(env, process.cwd());
    const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
    const fs = deps.fs ?? realFsPromises;
    const realpath = deps.realpath ?? realpathSync;
    const readdir = deps.readdir ?? readdirSync;
    const readStyleGuideImpl = deps.readStyleGuide ?? defaultReadStyleGuide;
    const now = deps.now ?? Date.now;

    const workspaceRoot = config.workspaceRoot;
    const warnings = [];

    // 1. Validate & normalize the input. Invalid input is rejected here with no
    //    fetch and no write (Req 3.3, 3.4, 3.5, 4.4, 6.4, 6.5, 8.4).
    const validation = validateGenerateInput(args, config);
    if (!validation.ok) {
      const err = validation.error;
      return errorResult(err.kind, err.message, { parameter: err.parameter });
    }
    const input = validation.value;

    // 2. Lazily read the API key. A missing/empty/whitespace key returns an
    //    error and SKIPS the fetch entirely (Req 2.2, 2.3).
    const keyResult = readApiKey(env);
    if (!keyResult.ok) {
      return errorResult(
        "auth",
        "The OPENAI_API_KEY environment variable is required to generate images.",
      );
    }
    const apiKey = keyResult.key;

    // 3. Compose the Effective_Prompt, optionally prepending the style guide.
    //    A style guide that cannot be applied yields a warning but keeps the
    //    result successful (Req 5.2–5.6).
    let styleGuideResult = { status: "none" };
    try {
      styleGuideResult = await readStyleGuideImpl(
        config.styleGuidePath ?? null,
        STYLE_GUIDE_TIMEOUT_MS,
      );
    } catch {
      styleGuideResult = { status: "unreadable" };
    }
    const composed = composePrompt(input.prompt, styleGuideResult);
    if (composed.warning) warnings.push(composed.warning);

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
    //    (Req 3.12, 3.13, 6.3). Existing names come from a best-effort readdir;
    //    a not-yet-created directory simply has no existing names.
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

    // 6. Call the OpenAI Images API (with gpt-image-1 -> dall-e-3 fallback).
    //    Any failure maps to a specific errorKind and writes no file
    //    (Req 3.8, 4.3, 4.5, 4.6, 8.1, 8.2, 8.3, 8.6).
    const apiResult = await generate({
      apiKey,
      model: input.model,
      effectivePrompt: composed.effectivePrompt,
      size: input.size,
      quality: input.quality,
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
    //    the attempted path (Req 3.10, 3.14, 8.5).
    const writeResult = await writeImageAtomic(canonicalPath, bytes, fs);
    if (!writeResult.ok) {
      return errorResult("file_write", writeResult.error.message, {
        attemptedPath: writeResult.error.attemptedPath,
      });
    }

    // 9. Success: report the saved path, the model actually used, the requested
    //    size, any warnings, and the paid-call notice (Req 3.15, 7.2, 7.3, 7.4).
    const savedFilePath = toWorkspaceRelative(workspaceRoot, canonicalPath);
    return successResult({
      savedFilePath,
      model: apiResult.model,
      size: input.size,
      warnings,
    });
  } catch (err) {
    // Absolute backstop: the handler must never throw to the protocol layer.
    return errorResult(
      "other",
      `The generate_image tool failed unexpectedly: ${err && err.message ? err.message : String(err)}`,
    );
  }
}
