// Runs the questions in evals/questions.json through brainhound's tools and checks each answer.
//   node scripts/run-evals.mjs          offline, against the recorded answers (skips live_only ones)
//   node scripts/run-evals.mjs --live   against the real archives, about 30 small requests
import { readFileSync } from "node:fs";
import { handle } from "../src/mcp.js";
import { Hound } from "../src/tools.js";
import { Net } from "../src/net.js";

export async function runEvals({ net, live = false } = {}) {
  const { questions } = JSON.parse(readFileSync(new URL("../evals/questions.json", import.meta.url), "utf8"));
  const hound = new Hound({ net });
  const results = [];
  for (const q of questions) {
    if (q.live_only && !live) continue;
    const reply = await handle(hound, { jsonrpc: "2.0", id: q.id, method: "tools/call", params: { name: q.tool, arguments: q.arguments } });
    const text = reply.result?.content?.[0]?.text ?? reply.error?.message ?? "";
    const missing = q.expect.filter((p) => !new RegExp(p).test(text));
    results.push({ id: q.id, ok: !reply.result?.isError && missing.length === 0, missing, text });
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const live = process.argv.includes("--live");
  const net = live ? new Net({ gap: 300 }) : new Net({ gap: 0, fetch: (await import("../test/helpers.mjs")).fakeFetch() });
  const results = await runEvals({ net, live });
  for (const r of results) console.log(`${r.ok ? "pass" : "FAIL"}  ${r.id}${r.ok ? "" : `\n  missing: ${r.missing.join(" | ")}\n  ${r.text.split("\n").slice(0, 8).join("\n  ")}`}`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`${passed} of ${results.length} passed${live ? " (live)" : " (recorded answers)"}`);
  process.exitCode = passed === results.length ? 0 : 1;
}
