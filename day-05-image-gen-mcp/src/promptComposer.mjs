// promptComposer.mjs — pure Effective_Prompt composition with injected reader.
//
// `readStyleGuide` is the (injectable) effect that reads the optional
// Style_Guide_File within a bounded time budget and classifies the outcome.
// `composePrompt` is a pure function that folds that classification and the
// caller-supplied prompt into the final Effective_Prompt plus an optional
// warning, per Requirements 5.2–5.6.

import { readFile } from "node:fs/promises";

/** Maximum Style_Guide_File length that will be prepended (Req 5.5). */
export const MAX_STYLE_GUIDE_CHARS = 20000;

/** Default read budget for the Style_Guide_File (Req 5.4). */
export const STYLE_GUIDE_TIMEOUT_MS = 5000;

/** Warning messages surfaced in the Tool_Result when the guide is not applied. */
export const STYLE_GUIDE_WARNINGS = {
  unreadable:
    "Style guide could not be read within the time budget and was not applied.",
  too_long:
    "Style guide exceeded the maximum allowed length and was not applied.",
  empty: "Style guide was empty and was not applied.",
};

/**
 * Read the style-guide file (injected effect) and classify the result.
 *
 * Enforces a read budget (default 5s, Req 5.4): if the read does not resolve in
 * time, or the file is missing/inaccessible/unreadable, the result is
 * `unreadable`. A readable-but-empty file yields `empty` (Req 5.6); contents
 * over the maximum length yield `too_long` (Req 5.5); otherwise `ok` with the
 * contents. A null/absent configured path yields `none` (Req 5.3).
 *
 * @param {string | null | undefined} path Configured Style_Guide_File path.
 * @param {number} [timeoutMs] Read budget in milliseconds.
 * @returns {Promise<{ status: "none" | "ok" | "unreadable" | "too_long" | "empty", contents?: string }>}
 */
export async function readStyleGuide(path, timeoutMs = STYLE_GUIDE_TIMEOUT_MS) {
  if (path === null || path === undefined || path === "") {
    return { status: "none" };
  }

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ __timedOut: true }), timeoutMs);
  });

  let contents;
  try {
    const read = readFile(path, "utf8").then((data) => ({ data }));
    const outcome = await Promise.race([read, timeout]);
    if (outcome && outcome.__timedOut) {
      return { status: "unreadable" };
    }
    contents = outcome.data;
  } catch {
    return { status: "unreadable" };
  } finally {
    clearTimeout(timer);
  }

  if (contents.length === 0) {
    return { status: "empty" };
  }
  if (contents.length > MAX_STYLE_GUIDE_CHARS) {
    return { status: "too_long" };
  }
  return { status: "ok", contents };
}

/**
 * Compose the Effective_Prompt from the caller prompt and a style-guide result.
 *
 * - `ok` with 1–20000 chars: contents, a blank line, then the caller prompt;
 *   no warning (Req 5.2).
 * - `none`: the caller prompt unchanged; no warning (Req 5.3).
 * - `unreadable` / `too_long` / `empty`: the caller prompt unchanged, with the
 *   corresponding warning; the result stays successful (Req 5.4–5.6).
 *
 * @param {string} callerPrompt
 * @param {{ status: string, contents?: string }} styleGuideResult
 * @returns {{ effectivePrompt: string, warning: string | null }}
 */
export function composePrompt(callerPrompt, styleGuideResult) {
  const status = styleGuideResult ? styleGuideResult.status : "none";

  if (status === "ok") {
    const contents = styleGuideResult.contents;
    if (
      typeof contents === "string" &&
      contents.length >= 1 &&
      contents.length <= MAX_STYLE_GUIDE_CHARS
    ) {
      return {
        effectivePrompt: contents + "\n\n" + callerPrompt,
        warning: null,
      };
    }
    // Defensive: an "ok" result outside the valid range is treated as
    // not-applicable rather than prepending malformed guide contents.
    return { effectivePrompt: callerPrompt, warning: null };
  }

  const warning = STYLE_GUIDE_WARNINGS[status] || null;
  return { effectivePrompt: callerPrompt, warning };
}
