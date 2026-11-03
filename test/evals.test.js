// The eval questions, answered from the recorded archive answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runEvals } from "../scripts/run-evals.mjs";
import { testNet } from "./helpers.mjs";

test("every offline eval question gets its known answer", async () => {
  const results = await runEvals({ net: testNet() });
  assert.ok(results.length >= 9);
  for (const r of results) assert.ok(r.ok, `${r.id} is missing ${r.missing.join(", ")}\n${r.text}`);
});
