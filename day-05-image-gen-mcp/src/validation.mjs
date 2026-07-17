// validation.mjs — pure input validation and normalization.
//
// Validates and normalizes tool inputs, returning a discriminated result
// ({ ok:true, value } | { ok:false, error }) rather than throwing. The error
// always names the offending parameter so the host can surface it to the model.

import {
  Supported_Size,
  Supported_Quality,
  Default_Size,
  Default_Quality,
  Default_Model,
} from "./config.mjs";
import { validateFilename } from "./filenames.mjs";

const PROMPT_MIN_LENGTH = 1;
const PROMPT_MAX_LENGTH = 4000;
const SUPPORTED_MODELS = new Set(["gpt-image-1", "dall-e-3"]);

/**
 * Build a validation error result naming the offending parameter.
 * @param {string} parameter
 * @param {string} message
 * @returns {{ ok: false, error: { kind: "validation", parameter: string, message: string } }}
 */
function validationError(parameter, message) {
  return { ok: false, error: { kind: "validation", parameter, message } };
}

/**
 * A parameter is "provided" when it is neither absent (undefined) nor null.
 * Any other value (including the empty string) is treated as provided and is
 * subject to membership/format validation.
 * @param {unknown} value
 * @returns {boolean}
 */
function isProvided(value) {
  return value !== undefined && value !== null;
}

/**
 * Validate the caller-supplied prompt: it must be a string of 1..4000 chars.
 * @param {unknown} prompt
 * @returns {{ ok: true } | { ok: false, error: object }}
 */
function validatePrompt(prompt) {
  if (typeof prompt !== "string" || prompt.length < PROMPT_MIN_LENGTH) {
    return validationError(
      "prompt",
      "The prompt parameter is required and must be a non-empty string.",
    );
  }
  if (prompt.length > PROMPT_MAX_LENGTH) {
    return validationError(
      "prompt",
      `The prompt parameter must not exceed ${PROMPT_MAX_LENGTH} characters.`,
    );
  }
  return { ok: true };
}

/**
 * Validate and normalize generate_image input.
 *
 * Checks, in order: prompt (1–4000 chars); size ∈ Supported_Size if provided;
 * quality ∈ Supported_Quality if provided; model ∈ {gpt-image-1, dall-e-3} if
 * provided; filename well-formed if provided. Applies Default_Size,
 * Default_Quality, and Default_Model when the corresponding parameter is
 * omitted. Never throws.
 *
 * @param {unknown} raw
 * @param {object} [config]
 * @returns {{ ok: true, value: object } | { ok: false, error: object }}
 */
export function validateGenerateInput(raw, config = {}) {
  const input = raw && typeof raw === "object" ? raw : {};
  const defaults = config.defaults ?? {};

  // 1. prompt present and 1–4000 chars (Req 3.3, 5.1).
  const promptCheck = validatePrompt(input.prompt);
  if (!promptCheck.ok) return promptCheck;

  // 2. size ∈ Supported_Size if provided; else Default_Size (Req 3.4, 3.6).
  let size;
  if (isProvided(input.size)) {
    if (!Supported_Size.has(input.size)) {
      return validationError(
        "size",
        `The size parameter must be one of: ${[...Supported_Size].join(", ")}.`,
      );
    }
    size = input.size;
  } else {
    size = defaults.size ?? Default_Size;
  }

  // 3. quality ∈ Supported_Quality if provided; else Default_Quality (Req 3.5, 3.7).
  let quality;
  if (isProvided(input.quality)) {
    if (!Supported_Quality.has(input.quality)) {
      return validationError(
        "quality",
        `The quality parameter must be one of: ${[...Supported_Quality].join(", ")}.`,
      );
    }
    quality = input.quality;
  } else {
    quality = defaults.quality ?? Default_Quality;
  }

  // 4. model ∈ {gpt-image-1, dall-e-3} if provided; else Default_Model (Req 4.2, 4.4).
  let model;
  if (isProvided(input.model)) {
    if (!SUPPORTED_MODELS.has(input.model)) {
      return validationError(
        "model",
        `The model parameter must be one of: ${[...SUPPORTED_MODELS].join(", ")}.`,
      );
    }
    model = input.model;
  } else {
    model = defaults.model ?? Default_Model;
  }

  // 5. filename well-formed if provided; else null => generate unique (Req 6.4, 6.5).
  let filename = null;
  if (isProvided(input.filename)) {
    const filenameCheck = validateFilename(input.filename);
    if (!filenameCheck.ok) {
      return { ok: false, error: filenameCheck.error };
    }
    filename = input.filename;
  }

  // outputDir is requested (pre-canonicalization); default when omitted.
  const outputDir = isProvided(input.outputDir)
    ? input.outputDir
    : config.defaultOutputDir ?? "public/images";

  return {
    ok: true,
    value: { prompt: input.prompt, size, quality, model, outputDir, filename },
  };
}

/**
 * Validate and normalize edit_image input.
 *
 * Performs the analogous prompt/source-path/filename checks for the edit tool:
 * sourcePath present and a non-empty string; prompt 1–4000 chars; filename
 * well-formed if provided. Path-safety (containment / existence) of sourcePath
 * is enforced later in the handler via pathSafety.mjs. Never throws.
 *
 * @param {unknown} raw
 * @param {object} [config]
 * @returns {{ ok: true, value: object } | { ok: false, error: object }}
 */
export function validateEditInput(raw, config = {}) {
  const input = raw && typeof raw === "object" ? raw : {};

  // sourcePath present and a non-empty (non-whitespace) string (Req 9.2).
  if (
    typeof input.sourcePath !== "string" ||
    input.sourcePath.trim().length === 0
  ) {
    return validationError(
      "sourcePath",
      "The sourcePath parameter is required and must be a non-empty string.",
    );
  }

  // prompt present and 1–4000 chars (Req 9.5).
  const promptCheck = validatePrompt(input.prompt);
  if (!promptCheck.ok) return promptCheck;

  // filename well-formed if provided; else null => generate unique (Req 6.4, 6.5).
  let filename = null;
  if (isProvided(input.filename)) {
    const filenameCheck = validateFilename(input.filename);
    if (!filenameCheck.ok) {
      return { ok: false, error: filenameCheck.error };
    }
    filename = input.filename;
  }

  const outputDir = isProvided(input.outputDir)
    ? input.outputDir
    : config.defaultOutputDir ?? "public/images";

  return {
    ok: true,
    value: {
      sourcePath: input.sourcePath,
      prompt: input.prompt,
      outputDir,
      filename,
    },
  };
}
