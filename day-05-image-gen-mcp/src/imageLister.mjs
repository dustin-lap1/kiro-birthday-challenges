// imageLister.mjs — pure image listing over an injected readdir.

/**
 * File extensions recognized as image files (lower-cased, leading dot).
 * @type {Set<string>}
 */
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".bmp",
  ".tif",
  ".tiff",
  ".svg",
]);

/**
 * Return the lower-cased extension (including the leading dot) of a file name,
 * or an empty string when the name has no extension. A leading dot with no
 * further dot (e.g. ".env") is treated as having no extension.
 * @param {string} name
 * @returns {string}
 */
function extensionOf(name) {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  return name.slice(dot).toLowerCase();
}

/**
 * List image file names in a canonical directory, sorted ascending lexicographically.
 *
 * The injected `readdir` is expected to return an array of entry names for the
 * directory, or to throw an error carrying a `code` property (matching Node's
 * `fs` semantics). A missing directory (`ENOENT`) yields an empty successful
 * result; any other read failure yields an error result so the caller can
 * surface it without terminating the process.
 *
 * @param {string} canonicalDir
 * @param {(dir: string) => string[]} readdir
 * @returns {{ ok: true, entries: string[] } | { ok: false, error: object }}
 */
export function listImages(canonicalDir, readdir) {
  let names;
  try {
    names = readdir(canonicalDir);
  } catch (err) {
    // A missing directory is not an error: report an empty listing.
    if (err && err.code === "ENOENT") {
      return { ok: true, entries: [] };
    }
    // Any other failure (e.g. EACCES, ENOTDIR) is reported without throwing.
    return {
      ok: false,
      error: {
        kind: "other",
        message: `Output directory could not be read: ${canonicalDir}`,
        attemptedPath: canonicalDir,
      },
    };
  }

  const entries = (names ?? [])
    .filter((name) => IMAGE_EXTENSIONS.has(extensionOf(name)))
    .sort();

  return { ok: true, entries };
}
