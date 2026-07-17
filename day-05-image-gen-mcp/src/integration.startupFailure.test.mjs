// integration.startupFailure.test.mjs — lifecycle test for forced startup failure.
//
// Covers Req 1.4: IF the Image_Gen_MCP_Server cannot complete startup or register
// the `generate_image` tool within 10 seconds of process start, THEN it SHALL
// terminate with a non-zero exit code and write an error to standard error
// indicating the startup or registration failure.
//
// This test drives `start(deps)` in-process with injected fakes so nothing waits
// on real time or real stdio: no real 10s watchdog wait, no spawned process. It
// exercises two failure paths:
//   1. transport/registration failure — `server.connect` rejects.
//   2. watchdog timeout — `server.connect` never resolves and the injected
//      timer fires the watchdog callback deterministically.
//
// A `{ timeout: 10000 }` safety net is added to each test so a regression that
// reintroduces real waiting fails fast instead of hanging.

import { test } from "node:test";
import assert from "node:assert/strict";

import { start } from "./index.mjs";

/** A fake server whose `connect` rejects, forcing a startup/registration failure. */
function makeRejectingServer(error) {
  return {
    // The protocol layer registers two request handlers up front; both are no-ops.
    setRequestHandler() {},
    // start() awaits server.connect(transport); rejecting here forces the failure path.
    connect() {
      return Promise.reject(error);
    },
  };
}

/** A fake server whose `connect` never resolves, so only the watchdog can fire. */
function makeHangingServer() {
  return {
    setRequestHandler() {},
    connect() {
      // Never resolves — models a transport that stalls during startup.
      return new Promise(() => {});
    },
  };
}

test(
  "forced connect failure exits non-zero and writes a startup-failure message to stderr (Req 1.4)",
  { timeout: 10000 },
  async () => {
    const exitCodes = [];
    const stderrMessages = [];

    const ctx = await start({
      // No real key needed; keeps the redactor a no-op.
      env: {},
      cwd: process.cwd(),
      server: makeRejectingServer(new Error("forced connect failure")),
      // Inject an inert transport so no real stdio is touched.
      transport: {},
      exit: (code) => exitCodes.push(code),
      logError: (msg) => stderrMessages.push(String(msg)),
      // Prevent any real timer from being scheduled during the test.
      setTimeoutImpl: () => ({ unref() {} }),
      clearTimeoutImpl: () => {},
    });

    // start() returns undefined on the failure path.
    assert.equal(ctx, undefined, "start() should not return a server context on failure");

    // A non-zero exit code was requested.
    assert.equal(exitCodes.length, 1, "exit should be called exactly once");
    assert.notEqual(exitCodes[0], 0, "exit code must be non-zero");

    // A stderr message indicating a startup/registration failure was written.
    assert.equal(stderrMessages.length >= 1, true, "an error should be written to stderr");
    const combined = stderrMessages.join("\n");
    assert.match(
      combined,
      /startup\/registration failure/i,
      "stderr message should indicate a startup/registration failure",
    );
    // The underlying connect error is surfaced.
    assert.match(combined, /forced connect failure/);
  },
);

test(
  "watchdog timeout exits non-zero with a startup-failure message when startup stalls (Req 1.4)",
  { timeout: 10000 },
  async () => {
    const exitCodes = [];
    const stderrMessages = [];

    // Capture the watchdog callback so we can fire it deterministically instead
    // of waiting the real 10 seconds.
    let watchdogCallback = null;

    // Kick off start() with a hanging connect. The returned promise will not
    // resolve (connect never resolves), so we do NOT await it — we grab the
    // watchdog callback synchronously via the injected setTimeout and fire it.
    start({
      env: {},
      cwd: process.cwd(),
      server: makeHangingServer(),
      transport: {},
      exit: (code) => exitCodes.push(code),
      logError: (msg) => stderrMessages.push(String(msg)),
      setTimeoutImpl: (cb) => {
        watchdogCallback = cb;
        return { unref() {} };
      },
      clearTimeoutImpl: () => {},
    });

    // The watchdog was armed synchronously during start().
    assert.equal(typeof watchdogCallback, "function", "watchdog callback should be armed");

    // Server never became ready (connect hangs), so firing the watchdog must
    // report the failure and exit non-zero.
    watchdogCallback();

    assert.equal(exitCodes.length, 1, "exit should be called exactly once by the watchdog");
    assert.notEqual(exitCodes[0], 0, "watchdog exit code must be non-zero");

    const combined = stderrMessages.join("\n");
    assert.match(
      combined,
      /startup\/registration failure/i,
      "watchdog stderr message should indicate a startup/registration failure",
    );
    assert.match(
      combined,
      /did not become ready/i,
      "watchdog message should note the server did not become ready in time",
    );
  },
);
