// Records the archive answers the tests replay, into test/fixtures/api.json, so CI never touches the
// network. Run it only to refresh them: node scripts/record-fixtures.mjs. It makes about 40 small
// requests, spaced out, to public APIs.
import { writeFileSync } from "node:fs";
import { Net } from "../src/net.js";
import { Hound } from "../src/tools.js";
import { CALLS } from "../test/calls.mjs";

const recorded = {};
const realFetch = globalThis.fetch;
const recordingFetch = async (url, init = {}) => {
  const response = await realFetch(url, init);
  const range = init.headers?.range;
  // NWB bytes come from the local test files instead; only API answers are kept.
  if (range || url.startsWith("https://dandiarchive.s3.amazonaws.com/")) return response;
  let body = await response.text();
  // Contributor emails are public on DANDI, but the tests don't need them.
  if (body.includes('"email"')) body = JSON.stringify(JSON.parse(body, (k, v) => (k === "email" ? undefined : v)));
  const key = `${init.method ?? "GET"} ${url}${init.body ? ` ${init.body}` : ""}`;
  recorded[key] = { status: response.status, location: response.headers.get("location") ?? undefined, body };
  return new Response(body, { status: response.status, headers: response.headers });
};

const hound = new Hound({ net: new Net({ fetch: recordingFetch, gap: 300 }) });
for (const [method, args] of CALLS) {
  try {
    await hound[method](args);
    console.log("ok", method, JSON.stringify(args));
  } catch (e) {
    console.log("error", method, JSON.stringify(args), e.message);
  }
}
writeFileSync(new URL("../test/fixtures/api.json", import.meta.url), JSON.stringify(recorded, null, 1) + "\n");
console.log(`recorded ${Object.keys(recorded).length} answers`);
