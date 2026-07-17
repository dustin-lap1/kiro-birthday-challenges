// openaiClient.mjs — effectful OpenAI Images API wrapper with injectable fetch.
//
// Wraps POST /v1/images/generations and POST /v1/images/edits with:
//  - a 60-second timeout (AbortController + timer),
//  - base64 output (gpt-image-1 returns b64_json; dall-e-3 needs response_format),
//  - model-specific size/quality mapping,
//  - an exactly-once gpt-image-1 -> dall-e-3 fallback on model-access rejection,
//  - HTTP/network failure mapping to a specific ErrorKind + message (Requirement 8).
//
// All effects (fetch, clock) are injected so this module is testable with no real network.

const GENERATIONS_URL = "https://api.openai.com/v1/images/generations";
const EDITS_URL = "https://api.openai.com/v1/images/edits";
const TIMEOUT_MS = 60_000;

// ErrorKind ∈ {auth, model_access, network, timeout, rate_limit, server, content_policy, other}
const MESSAGES = {
  auth: "OpenAI rejected the request: the OPENAI_API_KEY is invalid or unauthorized.",
  model_access:
    "OpenAI rejected the request: this account does not have access to the requested image model.",
  timeout: "The request to the OpenAI Images API timed out after 60 seconds.",
  network: "The request to the OpenAI Images API failed due to a network error.",
  rate_limit:
    "OpenAI rejected the request: rate limit exceeded. Please retry after a short wait.",
  server: "The OpenAI Images API returned a server-side error. Please retry.",
  content_policy:
    "OpenAI rejected the request because the prompt violated the content policy.",
  other: "The OpenAI Images API request failed.",
};

/**
 * Generate an image via the OpenAI Images API, with gpt-image-1 -> dall-e-3 fallback.
 * @param {{
 *   apiKey: string,
 *   model: string,
 *   effectivePrompt: string,
 *   size: string,
 *   quality: string,
 *   fetchImpl: typeof fetch,
 *   now?: () => number
 * }} args
 * @returns {Promise<{ ok: true, model: string, b64: string } | { ok: false, kind: string, message: string }>}
 */
export async function generate({
  apiKey,
  model,
  effectivePrompt,
  size,
  quality,
  fetchImpl,
  now = Date.now,
}) {
  const first = await requestGeneration({
    apiKey,
    model,
    effectivePrompt,
    size,
    quality,
    fetchImpl,
    now,
  });
  if (first.ok) {
    return { ok: true, model, b64: first.b64 };
  }

  // Retry exactly once with dall-e-3 when a gpt-image-1 request is rejected
  // for lack of account access (Req 4.5).
  if (first.kind === "model_access" && model === "gpt-image-1") {
    const fallbackModel = "dall-e-3";
    const second = await requestGeneration({
      apiKey,
      model: fallbackModel,
      effectivePrompt,
      size,
      quality,
      fetchImpl,
      now,
    });
    if (second.ok) {
      return { ok: true, model: fallbackModel, b64: second.b64 };
    }
    // If the fallback is also access-rejected, return a model_access error (Req 4.6, 8.2).
    // Any other fallback failure is reported as-is.
    return { ok: false, kind: second.kind, message: second.message };
  }

  return { ok: false, kind: first.kind, message: first.message };
}

/**
 * Edit an image via the OpenAI Images API (multipart upload).
 * @param {{
 *   apiKey: string,
 *   model: string,
 *   sourceBytes: Uint8Array,
 *   prompt: string,
 *   size: string,
 *   fetchImpl: typeof fetch,
 *   now?: () => number
 * }} args
 * @returns {Promise<{ ok: true, model: string, b64: string } | { ok: false, kind: string, message: string }>}
 */
export async function edit({
  apiKey,
  model,
  sourceBytes,
  prompt,
  size,
  fetchImpl,
  now = Date.now,
}) {
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", prompt);
  form.append("n", "1");
  form.append("size", mapSize(model, size));
  if (model === "dall-e-3") {
    form.append("response_format", "b64_json");
  }
  form.append(
    "image",
    new Blob([sourceBytes], { type: "image/png" }),
    "image.png"
  );

  const result = await performRequest({
    url: EDITS_URL,
    apiKey,
    body: form,
    // Do not set Content-Type: fetch derives the multipart boundary from FormData.
    headers: { Authorization: `Bearer ${apiKey}` },
    fetchImpl,
    now,
  });

  if (result.ok) {
    return { ok: true, model, b64: result.b64 };
  }
  return { ok: false, kind: result.kind, message: result.message };
}

/**
 * Perform a single JSON generation request (no fallback).
 * @returns {Promise<{ ok: true, b64: string } | { ok: false, kind: string, message: string }>}
 */
async function requestGeneration({
  apiKey,
  model,
  effectivePrompt,
  size,
  quality,
  fetchImpl,
  now,
}) {
  const body = {
    model,
    prompt: effectivePrompt,
    n: 1,
    size: mapSize(model, size),
    quality: mapQuality(model, quality),
  };
  // gpt-image-1 always returns b64_json; dall-e-3 must be asked for it explicitly.
  if (model === "dall-e-3") {
    body.response_format = "b64_json";
  }

  return performRequest({
    url: GENERATIONS_URL,
    apiKey,
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    fetchImpl,
    now,
  });
}

/**
 * Execute an HTTP request against the OpenAI Images API with a 60s timeout,
 * and map the outcome to a success (with b64) or a specific error kind.
 * @returns {Promise<{ ok: true, b64: string } | { ok: false, kind: string, message: string }>}
 */
async function performRequest({ url, body, headers, fetchImpl, now }) {
  const controller = new AbortController();
  let timedOut = false;
  const start = typeof now === "function" ? now() : Date.now();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);

  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (timedOut || isAbortError(err)) {
      return errorResult("timeout");
    }
    return errorResult("network");
  } finally {
    clearTimeout(timer);
  }

  // Guard: if the injected clock indicates the budget elapsed, treat as timeout.
  if (timedOut) {
    return errorResult("timeout");
  }
  void start;

  const payload = await parseJsonSafe(response);

  if (response.ok) {
    const b64 = extractB64(payload);
    if (typeof b64 === "string" && b64.length > 0) {
      return { ok: true, b64 };
    }
    return {
      ok: false,
      kind: "other",
      message: "The OpenAI Images API response did not include image data.",
    };
  }

  return mapErrorResponse(response.status, payload);
}

/**
 * Map a non-2xx HTTP response to a specific ErrorKind (Requirement 8).
 * @param {number} status
 * @param {any} payload
 * @returns {{ ok: false, kind: string, message: string }}
 */
function mapErrorResponse(status, payload) {
  const apiError = (payload && payload.error) || {};

  if (status === 401) return errorResult("auth");
  // Model-access rejections surface as 403/404-class errors.
  if (status === 403 || status === 404) return errorResult("model_access");
  if (status === 429) return errorResult("rate_limit");
  if (status >= 500) return errorResult("server");

  // 400 and other 4xx: distinguish content-policy rejections from generic failures.
  if (isContentPolicy(apiError)) return errorResult("content_policy");

  const detail = typeof apiError.message === "string" ? apiError.message : "";
  return {
    ok: false,
    kind: "other",
    message: detail ? `${MESSAGES.other} ${detail}` : MESSAGES.other,
  };
}

/**
 * Heuristically detect an OpenAI content-policy rejection from the error body.
 * @param {any} apiError
 * @returns {boolean}
 */
function isContentPolicy(apiError) {
  const code = typeof apiError.code === "string" ? apiError.code.toLowerCase() : "";
  const type = typeof apiError.type === "string" ? apiError.type.toLowerCase() : "";
  const message =
    typeof apiError.message === "string" ? apiError.message.toLowerCase() : "";
  return (
    code.includes("content_policy") ||
    type.includes("content_policy") ||
    message.includes("content policy") ||
    message.includes("safety system") ||
    message.includes("content_policy")
  );
}

/**
 * Map the shared Supported_Size value to a value the given model accepts.
 * gpt-image-1: 1024x1024, 1536x1024, 1024x1536, auto
 * dall-e-3:    1024x1024, 1792x1024, 1024x1792
 * @param {string} model
 * @param {string} size
 * @returns {string}
 */
function mapSize(model, size) {
  if (model === "dall-e-3") {
    switch (size) {
      case "auto":
        return "1024x1024";
      case "1536x1024":
        return "1792x1024";
      case "1024x1536":
        return "1024x1792";
      case "1024x1024":
      case "1792x1024":
      case "1024x1792":
        return size;
      default:
        return "1024x1024";
    }
  }
  // gpt-image-1 (default)
  switch (size) {
    case "1792x1024":
      return "1536x1024";
    case "1024x1792":
      return "1024x1536";
    case "1024x1024":
    case "1536x1024":
    case "1024x1536":
    case "auto":
      return size;
    default:
      return "auto";
  }
}

/**
 * Map the shared Supported_Quality value to a value the given model accepts.
 * gpt-image-1: low, medium, high, auto
 * dall-e-3:    standard, hd
 * @param {string} model
 * @param {string} quality
 * @returns {string}
 */
function mapQuality(model, quality) {
  if (model === "dall-e-3") {
    // auto -> standard (per design); high/hd -> hd; everything else -> standard.
    if (quality === "hd" || quality === "high") return "hd";
    return "standard";
  }
  // gpt-image-1
  switch (quality) {
    case "standard":
      return "medium";
    case "hd":
      return "high";
    case "low":
    case "medium":
    case "high":
    case "auto":
      return quality;
    default:
      return "auto";
  }
}

/**
 * @param {keyof typeof MESSAGES} kind
 * @returns {{ ok: false, kind: string, message: string }}
 */
function errorResult(kind) {
  return { ok: false, kind, message: MESSAGES[kind] };
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isAbortError(err) {
  return (
    !!err &&
    typeof err === "object" &&
    "name" in err &&
    /** @type {{ name?: string }} */ (err).name === "AbortError"
  );
}

/**
 * Parse a Response body as JSON, tolerating a missing/invalid body.
 * @param {Response} response
 * @returns {Promise<any>}
 */
async function parseJsonSafe(response) {
  if (!response || typeof response.json !== "function") return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Extract the base64 image payload from a successful Images API response.
 * @param {any} payload
 * @returns {string | undefined}
 */
function extractB64(payload) {
  return payload && payload.data && payload.data[0]
    ? payload.data[0].b64_json
    : undefined;
}
