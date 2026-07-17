// tools/listGeneratedImages.mjs — the optional list_generated_images tool handler.
//
// Orchestrates the pure path-safety and listing modules over injected effects
// (realpath, readdir) and always returns a Tool_Result — it never throws to the
// protocol layer (design: "Tool handlers", Req 8.7). It resolves the requested
// Output_Directory (default `public/images` relative to Workspace_Root) through
// pathSafety, then returns the sorted image listing from imageLister. A missing
// directory yields an empty list (Req 10.5); an unreadable directory yields a
// "directory could not be read" error without terminating the process (Req 10.6).

import { resolveOutputDir } from "../pathSafety.mjs";
import { listImages } from "../imageLister.mjs";

/** The advertised tool name. */
export const name = "list_generated_images";

/** The advertised tool description. */
export const description =
  "List previously generated image files in the output directory (default " +
  "public/images/, relative to the workspace root). This is a read-only " +
  "inventory and does not perform any paid OpenAI call. Returns the image file " +
  "names sorted in ascending order; a missing or empty directory returns an " +
  "empty list.";

/** The advertised JSON Schema for the tool input. */
export const inputSchema = {
  type: "object",
  properties: {
    outputDir: {
      type: "string",
      description:
        "Optional workspace-relative directory to list. Defaults to " +
        "public/images/ relative to the workspace root.",
    },
  },
  additionalProperties: false,
};

/**
 * A parameter is "provided" when it is neither absent (undefined) nor null.
 * @param {unknown} value
 * @returns {boolean}
 */
function isProvided(value) {
  return value !== undefined && value !== null;
}

/**
 * Build an error Tool_Result from a structured module error, never throwing.
 * @param {{ kind?: string, message?: string, parameter?: string, attemptedPath?: string, path?: string }} error
 * @returns {object} Tool_Result (error)
 */
function errorResult(error) {
  const err = error ?? {};
  const errorKind = err.kind ?? "other";
  const message = err.message ?? "The generated-images directory could not be listed.";
  const structuredContent = { errorKind };
  if (isProvided(err.parameter)) structuredContent.parameter = err.parameter;
  const attemptedPath = err.attemptedPath ?? err.path;
  if (isProvided(attemptedPath)) structuredContent.attemptedPath = attemptedPath;

  return {
    isError: true,
    content: [{ type: "text", text: message }],
    structuredContent,
  };
}

/**
 * Build a successful listing Tool_Result. Each entry identifies the file by its
 * file name, ordered ascending lexicographically (imageLister guarantees the
 * sort order).
 * @param {string[]} entries
 * @param {string} requestedDir
 * @returns {object} Tool_Result (success)
 */
function successResult(entries, requestedDir) {
  const images = entries.map((fileName) => ({ fileName }));
  const text =
    images.length === 0
      ? `No generated images found in ${requestedDir}.`
      : `Found ${images.length} generated image${
          images.length === 1 ? "" : "s"
        } in ${requestedDir}: ${entries.join(", ")}`;

  return {
    isError: false,
    content: [{ type: "text", text }],
    structuredContent: {
      directory: requestedDir,
      count: images.length,
      images,
    },
  };
}

/**
 * Handle a list_generated_images tool call. Always returns a Tool_Result; never throws.
 *
 * @param {unknown} args — raw tool arguments; `outputDir` is optional.
 * @param {{
 *   config?: { workspaceRoot?: string, defaultOutputDir?: string },
 *   realpath?: (p: string) => string,
 *   readdir?: (dir: string) => string[],
 * }} deps — injected config and effects (realpath, readdir) for testability.
 * @returns {Promise<object>} Tool_Result
 */
export async function handleListGeneratedImages(args, deps = {}) {
  try {
    const config = deps.config ?? {};
    const { realpath, readdir } = deps;
    const workspaceRoot = config.workspaceRoot ?? process.cwd();
    const defaultOutputDir = config.defaultOutputDir ?? "public/images";

    const input = args && typeof args === "object" ? args : {};
    const requestedDir = isProvided(input.outputDir)
      ? input.outputDir
      : defaultOutputDir;

    // Resolve and canonicalize the Output_Directory within the workspace (Req 6.1).
    const resolved = resolveOutputDir(requestedDir, workspaceRoot, realpath);
    if (!resolved.ok) {
      return errorResult(resolved.error);
    }

    // Return the sorted image listing; missing dir => empty list (Req 10.5),
    // unreadable dir => error result without throwing (Req 10.6).
    const listing = listImages(resolved.canonicalDir, readdir);
    if (!listing.ok) {
      return errorResult(listing.error);
    }

    return successResult(listing.entries, requestedDir);
  } catch (err) {
    // Defensive: the handler must never throw to the protocol layer (Req 8.7).
    return errorResult({
      kind: "other",
      message: `The generated-images directory could not be listed: ${
        err && err.message ? err.message : "unknown error"
      }`,
    });
  }
}
