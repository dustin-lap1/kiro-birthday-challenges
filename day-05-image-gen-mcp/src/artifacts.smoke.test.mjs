// artifacts.smoke.test.mjs — smoke / artifact checks for the Day 5 challenge
// folder. Single-execution assertions (NOT property tests). Pure filesystem
// reads only: no spawned processes, no network. Every test carries a
// { timeout: 10000 } safety net so a stuck read can never hang the suite.
//
// Validates:
//   - Folder layout is present (Req 11.1, 11.2)
//   - package.json is ESM (Req 11.2)
//   - README documents service, setup, env var, and a worked example (Req 11.3)
//   - .kiro/settings/mcp.json registers a named server with a startup command
//     and an env block naming OPENAI_API_KEY (Req 1.5, 11.4)
//   - .env.example lists OPENAI_API_KEY (Req 2.4, 11.5)
//   - .gitignore ignores .env (Req 2.5)
//   - No committed file exposes a real OpenAI API key (Req 11.6)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The challenge folder root is one level up from src/.
const ROOT = path.resolve(__dirname, "..");

const TIMEOUT = { timeout: 10000 };

function read(rel) {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

// ---------------------------------------------------------------------------
// Folder layout — Req 11.1, 11.2
// ---------------------------------------------------------------------------

test("required files and folders are present", TIMEOUT, () => {
  const requiredFiles = [
    "package.json",
    "README.md",
    ".env.example",
    ".gitignore",
    path.join(".kiro", "settings", "mcp.json"),
    path.join("src", "index.mjs"),
  ];

  for (const rel of requiredFiles) {
    const abs = path.join(ROOT, rel);
    assert.ok(existsSync(abs), `expected file to exist: ${rel}`);
    assert.ok(statSync(abs).isFile(), `expected ${rel} to be a file`);
  }

  const srcDir = path.join(ROOT, "src");
  assert.ok(existsSync(srcDir) && statSync(srcDir).isDirectory(), "src/ should be a directory");

  const toolsDir = path.join(srcDir, "tools");
  assert.ok(
    existsSync(toolsDir) && statSync(toolsDir).isDirectory(),
    "src/tools/ should be a directory"
  );
});

// ---------------------------------------------------------------------------
// package.json is ESM — Req 11.2
// ---------------------------------------------------------------------------

test("package.json declares ESM (\"type\":\"module\")", TIMEOUT, () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.type, "module", 'package.json "type" should be "module"');
  assert.ok(pkg.main, "package.json should declare a main entry");
});

// ---------------------------------------------------------------------------
// README content — Req 11.3
// Must include: the external service, setup steps, the required env var, and a
// worked example of generating an image.
// ---------------------------------------------------------------------------

test("README documents service, setup, env var, and a worked example", TIMEOUT, () => {
  const readme = read("README.md");

  // External service the server connects to.
  assert.match(readme, /OpenAI Images API/i, "README should name the OpenAI Images API");

  // Setup steps.
  assert.match(readme, /npm install/i, "README should include a setup step (npm install)");

  // Required environment variable.
  assert.match(readme, /OPENAI_API_KEY/, "README should mention the OPENAI_API_KEY env var");

  // A worked example of generating an image: references the generate_image tool
  // and shows a JSON prompt example.
  assert.match(readme, /generate_image/, "README should show a generate_image example");
  assert.match(readme, /"prompt"\s*:/, "README worked example should include a JSON prompt");
});

// ---------------------------------------------------------------------------
// mcp.json — Req 1.5, 11.4
// Parses as JSON, has a named server entry with a startup command and an env
// block naming OPENAI_API_KEY.
// ---------------------------------------------------------------------------

test("mcp.json registers a named server with a startup command and OPENAI_API_KEY env", TIMEOUT, () => {
  const raw = read(path.join(".kiro", "settings", "mcp.json"));
  let cfg;
  assert.doesNotThrow(() => {
    cfg = JSON.parse(raw);
  }, "mcp.json should parse as JSON");

  assert.ok(cfg.mcpServers && typeof cfg.mcpServers === "object", "mcp.json should have an mcpServers object");

  const serverNames = Object.keys(cfg.mcpServers);
  assert.ok(serverNames.length >= 1, "mcp.json should register at least one named server");

  // At least one server entry must have a startup command and an env block
  // naming OPENAI_API_KEY.
  const hasWellFormedEntry = serverNames.some((name) => {
    const entry = cfg.mcpServers[name];
    if (!entry || typeof entry !== "object") return false;
    const hasCommand = typeof entry.command === "string" && entry.command.length > 0;
    const hasEnvKey =
      entry.env && typeof entry.env === "object" && "OPENAI_API_KEY" in entry.env;
    return hasCommand && hasEnvKey;
  });

  assert.ok(
    hasWellFormedEntry,
    "mcp.json should have a server entry with a startup command and an env block naming OPENAI_API_KEY"
  );
});

// ---------------------------------------------------------------------------
// .env.example — Req 2.4, 11.5
// ---------------------------------------------------------------------------

test(".env.example lists OPENAI_API_KEY", TIMEOUT, () => {
  const env = read(".env.example");
  assert.match(env, /^\s*OPENAI_API_KEY\s*=/m, ".env.example should list OPENAI_API_KEY");
});

// ---------------------------------------------------------------------------
// .gitignore — Req 2.5
// ---------------------------------------------------------------------------

test(".gitignore ignores .env", TIMEOUT, () => {
  const gitignore = read(".gitignore");
  const ignoresEnv = gitignore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line === ".env" || line === "/.env");
  assert.ok(ignoresEnv, ".gitignore should contain a .env entry");
});

// ---------------------------------------------------------------------------
// No committed file exposes a real API key — Req 11.6
// Scan committed text files for a plausible real OpenAI secret-key pattern,
// allowing only the known non-secret placeholders. Never scans node_modules.
// ---------------------------------------------------------------------------

test("no committed file contains a real-looking API key", TIMEOUT, () => {
  // A plausible real OpenAI secret key: "sk-" followed by 20+ url-safe chars.
  const REAL_KEY = /sk-[A-Za-z0-9]{20,}/g;

  // Known non-secret placeholders that are allowed to appear.
  const ALLOWED = new Set([
    "sk-your-openai-api-key-here",
    "sk-test",
    "sk-...",
    "sk-proj-ABCdef...",
  ]);

  const isAllowed = (match) => {
    if (ALLOWED.has(match)) return true;
    // Also treat a match that is a prefix of an allowed placeholder as allowed
    // (defensive — the placeholders above don't trip the 20+ char pattern).
    for (const placeholder of ALLOWED) {
      if (placeholder.startsWith(match) || match.startsWith(placeholder)) return true;
    }
    return false;
  };

  // Collect the committed text files to scan.
  const filesToScan = [
    "README.md",
    ".env.example",
    path.join(".kiro", "settings", "mcp.json"),
    "package.json",
  ];

  // Recursively add every file under src/ (no node_modules lives there).
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const abs = path.join(dir, name);
      const st = statSync(abs);
      if (st.isDirectory()) {
        if (name === "node_modules") continue;
        walk(abs);
      } else if (st.isFile()) {
        filesToScan.push(path.relative(ROOT, abs));
      }
    }
  };
  walk(path.join(ROOT, "src"));

  const offenders = [];
  for (const rel of filesToScan) {
    const content = read(rel);
    const matches = content.match(REAL_KEY) || [];
    for (const m of matches) {
      if (!isAllowed(m)) {
        offenders.push({ file: rel, match: m });
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `no committed file should contain a real-looking API key; found: ${JSON.stringify(offenders)}`
  );
});
