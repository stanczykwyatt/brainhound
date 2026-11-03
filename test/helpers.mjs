// A stand-in for fetch that replays recorded archive answers and serves the local test files as if
// they were on DANDI's S3 bucket, honoring range requests. Nothing here touches the network.
import { readFileSync } from "node:fs";
import { Net } from "../src/net.js";

export const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url).pathname;
const api = JSON.parse(readFileSync(fixture("api.json"), "utf8"));

// The real 8 GB file's S3 address is answered with the small made-up NWB file.
export const BLOB = "https://dandiarchive.s3.amazonaws.com/blobs/58c/537/58c53789-eec4-4080-ad3b-207cf2a1cac9";

export function fakeFetch({ blobs = { [BLOB]: fixture("earliest.nwb") }, log = [], ignoreRange = false } = {}) {
  return async (url, init = {}) => {
    log.push({ url, range: init.headers?.range, headers: init.headers });
    if (blobs[url]) {
      const bytes = readFileSync(blobs[url]);
      const m = /bytes=(\d+)-(\d+)/.exec(init.headers?.range ?? "");
      if (!m || ignoreRange) return new Response(bytes, { status: 200, headers: { "content-length": String(ignoreRange === "huge" ? 8e9 : bytes.length) } });
      const start = Number(m[1]);
      if (start >= bytes.length) return new Response("", { status: 416 });
      const end = Math.min(Number(m[2]), bytes.length - 1);
      return new Response(bytes.subarray(start, end + 1), { status: 206, headers: { "content-range": `bytes ${start}-${end}/${bytes.length}` } });
    }
    const key = `${init.method ?? "GET"} ${url}${init.body ? ` ${init.body}` : ""}`;
    const hit = api[key];
    if (!hit) throw new Error(`No recorded answer for ${key}. Run scripts/record-fixtures.mjs if the calls changed.`);
    return new Response(hit.body, { status: hit.status, headers: hit.location ? { location: hit.location } : {} });
  };
}

export const testNet = (options) => new Net({ fetch: fakeFetch(options), gap: 0 });
