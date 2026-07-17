// Property test for the base64 decode round-trip (Property 9).
import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { decodeBase64 } from "./base64.mjs";

// Feature: day-05-image-gen-mcp, Property 9: For any byte buffer, base64-decoding its base64 encoding yields the original bytes, so decoded PNG content equals what the API returned.
test("Property 9: base64-decoding the base64 encoding of any byte buffer yields the original bytes", () => {
  fc.assert(
    fc.property(fc.uint8Array(), (bytes) => {
      // Encode the arbitrary byte buffer to base64 exactly as the OpenAI Images
      // API delivers it in `b64_json`, then decode it back through the module
      // under test.
      const b64 = Buffer.from(bytes).toString("base64");
      const decoded = decodeBase64(b64);

      // The decoded bytes must equal the original bytes byte-for-byte, so the
      // PNG content written to disk matches what the API returned.
      assert.deepEqual(new Uint8Array(decoded), bytes);
    }),
    { numRuns: 200 },
  );
});
