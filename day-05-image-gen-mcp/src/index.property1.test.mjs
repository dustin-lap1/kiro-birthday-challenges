// Feature: day-05-image-gen-mcp, Property 1: For any combination of the enableEditTool and enableListTool flags, the advertised tool list contains generate_image and exactly those optional tools whose flag is set, and excludes every optional tool whose flag is not set.
//
// Validates: Requirements 1.6, 9.1, 10.1

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { buildToolList } from "./index.mjs";

const GENERATE = "generate_image";
const EDIT = "edit_image";
const LIST = "list_generated_images";

test("Property 1: tool list reflects the enable flags", () => {
  fc.assert(
    fc.property(fc.boolean(), fc.boolean(), (enableEditTool, enableListTool) => {
      const tools = buildToolList({ enableEditTool, enableListTool });
      const names = tools.map((t) => t.name);

      // generate_image is always advertised.
      assert.ok(
        names.includes(GENERATE),
        "generate_image must always be present",
      );

      // edit_image present iff enableEditTool.
      assert.equal(
        names.includes(EDIT),
        enableEditTool,
        `edit_image presence must match enableEditTool=${enableEditTool}`,
      );

      // list_generated_images present iff enableListTool.
      assert.equal(
        names.includes(LIST),
        enableListTool,
        `list_generated_images presence must match enableListTool=${enableListTool}`,
      );

      // No tools other than the three known names may appear.
      const allowed = new Set([GENERATE, EDIT, LIST]);
      for (const name of names) {
        assert.ok(allowed.has(name), `unexpected tool advertised: ${name}`);
      }

      // Exact expected set, so nothing extra or missing slips through.
      const expected = [
        GENERATE,
        ...(enableEditTool ? [EDIT] : []),
        ...(enableListTool ? [LIST] : []),
      ].sort();
      assert.deepEqual([...names].sort(), expected);
    }),
    { numRuns: 100 },
  );
});
