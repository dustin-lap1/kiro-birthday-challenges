// Property test for API key never appearing in output (Property 3).
//
// Validates: Requirements 2.6
import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { redact, makeRedactor } from "./index.mjs";

// The granularity the redactor guarantees: the FULL key is always removed, and
// any substring of length >= minSubstringLength is removed too. Removing every
// 1-char substring is impossible in practice (a single character matches
// ordinary text), so the property is asserted at this guaranteed granularity.
const MIN_SUBSTRING_LENGTH = 8;

// Character set for realistic API-key bodies: alphanumerics plus the separators
// OpenAI-style keys commonly use.
const KEY_BODY_CHAR = fc.constantFrom(
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".split(""),
);

// Realistic API keys: an "sk-" prefix followed by >= 16 body chars, so the key
// length is comfortably >= MIN_SUBSTRING_LENGTH and every window of length
// MIN_SUBSTRING_LENGTH is well defined.
const apiKey = fc
  .array(KEY_BODY_CHAR, { minLength: 16, maxLength: 60 })
  .map((chars) => "sk-" + chars.join(""));

// Arbitrary surrounding log text. Kept free of the placeholder token so the
// assertion below is unambiguous, and includes newlines/tabs like real logs.
const logText = fc.string({ maxLength: 200 });

/** Every window of length `len` of `s`. */
function windows(s, len) {
  const result = [];
  for (let i = 0; i + len <= s.length; i++) result.push(s.slice(i, i + len));
  return result;
}

// Feature: day-05-image-gen-mcp, Property 3: For any generated API key value and any log or error output the server emits, the output contains neither the complete key value nor any substring of it.
test("Property 3: the API key never appears in redacted output", () => {
  fc.assert(
    fc.property(apiKey, logText, logText, fc.boolean(), (key, before, after, embedFull) => {
      // Build output text that leaks the key: either the FULL key value, or a
      // long substring (>= MIN_SUBSTRING_LENGTH) of it, embedded in log text.
      let leak;
      if (embedFull) {
        leak = key;
      } else {
        // Pick a substring of length >= MIN_SUBSTRING_LENGTH from the key.
        const start = 0;
        const end = Math.max(MIN_SUBSTRING_LENGTH, Math.floor(key.length / 2));
        leak = key.slice(start, end);
      }

      const output = before + leak + after;

      // Run through both the standalone redact() and the bound makeRedactor().
      const viaRedact = redact(output, key, { minSubstringLength: MIN_SUBSTRING_LENGTH });
      const viaRedactor = makeRedactor(key, { minSubstringLength: MIN_SUBSTRING_LENGTH })(output);

      for (const redacted of [viaRedact, viaRedactor]) {
        // The complete key value must be absent.
        assert.ok(
          !redacted.includes(key),
          `redacted output still contains the full key: ${JSON.stringify(redacted)}`,
        );

        // Every window of length MIN_SUBSTRING_LENGTH of the key must be absent
        // — this is the guaranteed granularity of the redactor.
        for (const w of windows(key, MIN_SUBSTRING_LENGTH)) {
          assert.ok(
            !redacted.includes(w),
            `redacted output still contains a >=${MIN_SUBSTRING_LENGTH}-char key substring ${JSON.stringify(
              w,
            )}: ${JSON.stringify(redacted)}`,
          );
        }
      }
    }),
    { numRuns: 200 },
  );
});
