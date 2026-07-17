// fileWriter.mjs — effectful atomic image writer with injectable fs.

import path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Build a file-write error result for the attempted path.
 * @param {string} canonicalPath
 * @param {unknown} cause
 * @returns {{ ok: false, error: object }}
 */
function fileWriteError(canonicalPath, cause) {
  const detail = cause && cause.message ? `: ${cause.message}` : "";
  return {
    ok: false,
    error: {
      kind: "file_write",
      message: `Failed to write image file to ${canonicalPath}${detail}`,
      attemptedPath: canonicalPath,
    },
  };
}

/**
 * Atomically write image bytes to a canonical path.
 *
 * The write is performed by creating the Output_Directory when absent, writing
 * the bytes to a uniquely named temporary file in the same directory, and then
 * renaming that temp file into place. Because the rename is atomic on the same
 * filesystem, a failure never leaves a partial file at the destination. On any
 * failure the temp artifact is removed (best effort) and a file-write error
 * carrying the attempted Saved_File_Path is returned.
 *
 * The injected `fs` is expected to expose the `node:fs/promises` surface used
 * here: `mkdir`, `writeFile`, `rename`, and `rm` (or `unlink`).
 *
 * @param {string} canonicalPath
 * @param {Uint8Array} bytes
 * @param {object} fs
 * @returns {Promise<{ ok: true } | { ok: false, error: object }>}
 */
export async function writeImageAtomic(canonicalPath, bytes, fs) {
  const dir = path.dirname(canonicalPath);
  const base = path.basename(canonicalPath);

  // Ensure the Output_Directory exists before writing (Req 3.14).
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    return fileWriteError(canonicalPath, err);
  }

  // A unique temp name in the same directory keeps the rename atomic and avoids
  // colliding with concurrent writes.
  const suffix = randomBytes(8).toString("hex");
  const tmpPath = path.join(dir, `.${base}.${suffix}.tmp`);

  try {
    await fs.writeFile(tmpPath, bytes);
    await fs.rename(tmpPath, canonicalPath);
    return { ok: true };
  } catch (err) {
    // Remove any partial temp artifact so no partial file is left behind (Req 8.5).
    await removeQuietly(fs, tmpPath);
    return fileWriteError(canonicalPath, err);
  }
}

/**
 * Best-effort removal of a temp artifact; never throws.
 * @param {object} fs
 * @param {string} tmpPath
 * @returns {Promise<void>}
 */
async function removeQuietly(fs, tmpPath) {
  try {
    if (typeof fs.rm === "function") {
      await fs.rm(tmpPath, { force: true });
    } else if (typeof fs.unlink === "function") {
      await fs.unlink(tmpPath);
    }
  } catch {
    // Ignore cleanup failures — the primary error is already being reported.
  }
}
