// filenames.mjs — pure filename validation and unique-name derivation.

const MAX_FILENAME_LENGTH = 255;

/**
 * Split a filename into its base name and extension.
 * A leading dot (e.g. ".gitignore") is treated as part of the base, not an
 * extension, so the suffix is always inserted before a real extension.
 * @param {string} name
 * @returns {{ base: string, ext: string }}
 */
function splitExtension(name) {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex > 0) {
    return { base: name.slice(0, dotIndex), ext: name.slice(dotIndex) };
  }
  return { base: name, ext: "" };
}

/**
 * Normalize the collection of existing names into a Set for membership checks.
 * @param {Set<string> | string[] | null | undefined} existingNames
 * @returns {Set<string>}
 */
function toNameSet(existingNames) {
  if (existingNames instanceof Set) return existingNames;
  if (Array.isArray(existingNames)) return new Set(existingNames);
  return new Set();
}

/**
 * Validate a filename (no separators / "..", non-empty, <= 255 chars).
 *
 * Names containing a path separator ("/" or "\") or a parent-directory
 * segment ("..") are rejected as path-safety errors (Req 6.4). Names that are
 * empty, whitespace-only, or longer than 255 characters are rejected as
 * validation errors (Req 6.5).
 *
 * @param {string} name
 * @returns {{ ok: true } | { ok: false, error: { kind: string, parameter: string, message: string } }}
 */
export function validateFilename(name) {
  if (typeof name !== "string") {
    return {
      ok: false,
      error: {
        kind: "validation",
        parameter: "filename",
        message: "The filename parameter must be a string.",
      },
    };
  }

  // Req 6.4: reject path separators and parent-directory segments.
  if (name.includes("/") || name.includes("\\")) {
    return {
      ok: false,
      error: {
        kind: "path_safety",
        parameter: "filename",
        message: `The filename "${name}" must not contain a path separator ("/" or "\\").`,
      },
    };
  }
  if (name === ".." || name.split(/[/\\]/).includes("..") || /(^|[/\\])\.\.([/\\]|$)/.test(name)) {
    return {
      ok: false,
      error: {
        kind: "path_safety",
        parameter: "filename",
        message: `The filename "${name}" must not contain a parent-directory segment ("..").`,
      },
    };
  }

  // Req 6.5: reject empty, whitespace-only, or overly long names.
  if (name.length === 0 || name.trim().length === 0) {
    return {
      ok: false,
      error: {
        kind: "validation",
        parameter: "filename",
        message: "The filename parameter must not be empty or whitespace-only.",
      },
    };
  }
  if (name.length > MAX_FILENAME_LENGTH) {
    return {
      ok: false,
      error: {
        kind: "validation",
        parameter: "filename",
        message: `The filename parameter must not exceed ${MAX_FILENAME_LENGTH} characters.`,
      },
    };
  }

  return { ok: true };
}

/**
 * Derive a filename that is unique within the given set of existing names.
 *
 * When `desiredName` is supplied and does not collide, it is returned
 * unchanged. On collision, a numeric suffix ("-1", "-2", ...) is appended
 * before the extension until the name is unique (Req 3.13). When no name is
 * supplied, a unique timestamped default of the form
 * `image-<timestamp>-<n>.png` is generated (Req 3.12).
 *
 * @param {string | null | undefined} desiredName
 * @param {Set<string> | string[]} existingNames
 * @param {number} timestamp
 * @returns {string}
 */
export function deriveUniqueFilename(desiredName, existingNames, timestamp) {
  const existing = toNameSet(existingNames);

  const hasDesired =
    typeof desiredName === "string" && desiredName.trim().length > 0;

  if (hasDesired) {
    if (!existing.has(desiredName)) {
      return desiredName;
    }
    const { base, ext } = splitExtension(desiredName);
    let counter = 1;
    let candidate = `${base}-${counter}${ext}`;
    while (existing.has(candidate)) {
      counter += 1;
      candidate = `${base}-${counter}${ext}`;
    }
    return candidate;
  }

  // No name supplied: generate a unique timestamped default.
  let counter = 0;
  let candidate = `image-${timestamp}-${counter}.png`;
  while (existing.has(candidate)) {
    counter += 1;
    candidate = `image-${timestamp}-${counter}.png`;
  }
  return candidate;
}
