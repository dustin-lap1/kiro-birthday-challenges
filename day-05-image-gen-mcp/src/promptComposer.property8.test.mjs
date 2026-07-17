// Property test for Effective_Prompt composition (Property 8).
import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  composePrompt,
  MAX_STYLE_GUIDE_CHARS,
  STYLE_GUIDE_WARNINGS,
} from "./promptComposer.mjs";

// Feature: day-05-image-gen-mcp, Property 8: For any caller prompt and any style-guide result: when the guide status is `ok` with contents of 1–20000 characters, the Effective_Prompt equals the guide contents, a blank line, then the caller prompt, with no warning; for status `none` the Effective_Prompt equals the caller prompt with no warning; and for status `unreadable`, `too_long`, or `empty` the Effective_Prompt equals the caller prompt and a corresponding warning is present while the result remains successful.
test("Property 8: composePrompt folds the style-guide result per its status", () => {
  // Arbitrary caller prompt spanning the valid 1–4000 char range plus unicode.
  const callerPrompt = fc.string({ minLength: 1, maxLength: 4000 });

  // "ok" contents constrained to the valid 1–20000 range, with extra weight on
  // the 1 and 20000 boundaries so the composition rule is exercised at the edges.
  const okContents = fc.oneof(
    fc.string({ minLength: 1, maxLength: 20000 }),
    fc.constant("a"), // lower boundary (1 char)
    fc.constant("z".repeat(MAX_STYLE_GUIDE_CHARS)), // upper boundary (20000 chars)
    fc.constant("z".repeat(MAX_STYLE_GUIDE_CHARS - 1)), // 19999 chars
  );

  // All five style-guide result variants.
  const styleGuideResult = fc.oneof(
    fc.constant({ status: "none" }),
    okContents.map((contents) => ({ status: "ok", contents })),
    fc.constant({ status: "unreadable" }),
    fc.constant({ status: "too_long" }),
    fc.constant({ status: "empty" }),
  );

  fc.assert(
    fc.property(callerPrompt, styleGuideResult, (prompt, result) => {
      const { effectivePrompt, warning } = composePrompt(prompt, result);

      switch (result.status) {
        case "ok":
          // Guide contents first, a blank line, then the caller prompt; no warning.
          assert.equal(effectivePrompt, result.contents + "\n\n" + prompt);
          assert.equal(warning, null);
          break;
        case "none":
          // Caller prompt unchanged; no warning.
          assert.equal(effectivePrompt, prompt);
          assert.equal(warning, null);
          break;
        case "unreadable":
        case "too_long":
        case "empty":
          // Caller prompt unchanged; the corresponding warning is present, and
          // the result remains successful (warning is non-null, not an error).
          assert.equal(effectivePrompt, prompt);
          assert.equal(warning, STYLE_GUIDE_WARNINGS[result.status]);
          assert.ok(warning, "a not-applied status must carry a warning");
          break;
        default:
          assert.fail(`unexpected status ${result.status}`);
      }
    }),
    { numRuns: 200 },
  );
});
