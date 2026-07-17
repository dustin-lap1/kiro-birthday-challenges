// base64.mjs — pure base64 -> binary PNG-bytes decoding used by the handlers.
//
// The OpenAI Images API returns image data as a base64 string in `b64_json`.
// The generate/edit tool handlers decode that string into binary PNG content
// with `decodeBase64` before handing the bytes to the file writer (Req 3.9).
// This is a pure function over its input so it can be property-tested directly
// (the base64 decode round-trip, Property 9).

/**
 * Decode a base64-encoded string into binary bytes.
 *
 * Returns a Node.js `Buffer` (a `Uint8Array` subclass) holding the decoded
 * bytes, so the result is `Uint8Array`-compatible for the file writer while
 * remaining a normal byte buffer. Decoding a string that was produced by
 * base64-encoding a byte buffer yields the original bytes exactly (Req 3.9).
 *
 * @param {string} b64 - The base64-encoded image data (e.g. API `b64_json`).
 * @returns {Buffer} The decoded binary PNG content.
 */
export function decodeBase64(b64) {
  if (typeof b64 !== "string") {
    throw new TypeError("decodeBase64 expects a base64-encoded string.");
  }
  return Buffer.from(b64, "base64");
}
