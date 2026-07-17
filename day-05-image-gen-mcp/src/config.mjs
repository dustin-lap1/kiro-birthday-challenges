// config.mjs — configuration assembly and API-key reading.

import path from "node:path";

// Supported value sets and defaults (design: "Supported value sets").
export const Supported_Size = new Set([
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "1792x1024",
  "1024x1792",
  "auto",
]);

export const Supported_Quality = new Set([
  "low",
  "medium",
  "high",
  "standard",
  "hd",
  "auto",
]);

export const Default_Size = "1024x1024";
export const Default_Quality = "auto";
export const Default_Model = "gpt-image-1";

/**
 * Assemble configuration from the environment.
 * @param {Record<string, string | undefined>} env
 * @param {string} cwd
 * @returns {{
 *   workspaceRoot: string,
 *   defaultOutputDir: string,
 *   styleGuidePath: string | null,
 *   enableEditTool: boolean,
 *   enableListTool: boolean,
 *   defaults: { size: string, quality: string, model: string }
 * }}
 */
export function loadConfig(env = {}, cwd = process.cwd()) {
  // Workspace_Root: absolute root of the workspace that launched the server.
  // An explicit WORKSPACE_ROOT override wins; otherwise use the launch cwd.
  const workspaceRoot = path.resolve(env.WORKSPACE_ROOT ?? cwd);

  // Output_Directory default is workspace-relative "public/images".
  const defaultOutputDir = "public/images";

  // Optional Style_Guide_File path; absent/blank means no style guide.
  const rawStyleGuide = env.STYLE_GUIDE_PATH;
  const styleGuidePath =
    typeof rawStyleGuide === "string" && rawStyleGuide.trim() !== ""
      ? rawStyleGuide
      : null;

  return {
    workspaceRoot,
    defaultOutputDir,
    styleGuidePath,
    enableEditTool: parseBooleanFlag(env.ENABLE_EDIT_TOOL),
    enableListTool: parseBooleanFlag(env.ENABLE_LIST_TOOL),
    defaults: {
      size: Default_Size,
      quality: Default_Quality,
      model: Default_Model,
    },
  };
}

/**
 * Parse an environment flag into a boolean. Treats "true", "1", "yes", and "on"
 * (case-insensitive, trimmed) as true; everything else (including absent) is false.
 * @param {string | undefined} raw
 * @returns {boolean}
 */
function parseBooleanFlag(raw) {
  if (typeof raw !== "string") return false;
  const normalized = raw.trim().toLowerCase();
  return (
    normalized === "true" ||
    normalized === "1" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

/**
 * Read the OpenAI API key from the environment.
 * Absent, empty, and whitespace-only values are treated as missing.
 * @param {Record<string, string | undefined>} env
 * @returns {{ ok: true, key: string } | { ok: false, reason: "missing" }}
 */
export function readApiKey(env = {}) {
  const raw = env.OPENAI_API_KEY;
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, reason: "missing" };
  }
  return { ok: true, key: raw };
}
