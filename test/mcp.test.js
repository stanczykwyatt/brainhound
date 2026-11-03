// The MCP protocol: messages, tool listing and errors, plus one real run of `brainhound serve` over
// stdin and stdout, reading a local test file so it stays offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { handle, TOOLS, VERSIONS } from "../src/mcp.js";
import { Hound } from "../src/tools.js";
import { testNet, fixture } from "./helpers.mjs";
import { NWB_ASSET } from "./calls.mjs";

const hound = () => new Hound({ net: testNet() });
const call = (h, name, args, id = 1) => handle(h, { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

test("initialize agrees on a protocol version and names the server", async () => {
  const r = await handle(hound(), { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(r.result.protocolVersion, "2025-06-18");
  assert.deepEqual(r.result.serverInfo, { name: "brainhound", version: "0.1.0" });
  assert.deepEqual(r.result.capabilities, { tools: { listChanged: false } });
  assert.match(r.result.instructions, /license and citation/);
  const old = await handle(hound(), { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
  assert.equal(old.result.protocolVersion, VERSIONS[0]);
});

test("ten tools, every one read-only, with a schema that rejects extra arguments", async () => {
  const r = await handle(hound(), { jsonrpc: "2.0", id: 1, method: "tools/list" });
  const names = r.result.tools.map((t) => t.name);
  assert.deepEqual(names, ["search_datasets", "dataset_info", "list_files", "nwb_summary", "nwb_tree", "nwb_read", "nwb_table", "brain_region", "brain_atlases", "neuron_morphology"]);
  for (const t of TOOLS) {
    assert.equal(t.annotations.readOnlyHint, true, t.name);
    assert.equal(t.annotations.destructiveHint, false, t.name);
    assert.equal(t.inputSchema.additionalProperties, false, t.name);
    assert.ok(t.description.length > 40 && t.description.length < 400, t.name);
    for (const req of t.inputSchema.required) assert.ok(t.inputSchema.properties[req], `${t.name} requires a property it defines`);
  }
});

test("tool calls answer with text, and mistakes come back as tool errors", async () => {
  const h = hound();
  const ok = await call(h, "brain_region", { query: "CA1" });
  assert.equal(ok.result.isError, false);
  assert.match(ok.result.content[0].text, /Field CA1/);
  const read = await call(h, "nwb_read", { asset: NWB_ASSET, path: "/extra/compact" });
  assert.match(read.result.content[0].text, /^\[0, 1, 2, 3\]$/m);
  const bad = await call(h, "nwb_read", { asset: NWB_ASSET, path: "/nope" });
  assert.equal(bad.result.isError, true);
  assert.match(bad.result.content[0].text, /Nothing is called "nope"/);
  const offList = await call(h, "dataset_info", { id: "github:x" });
  assert.equal(offList.result.isError, true);
});

test("protocol errors: unknown tools and methods, bad requests, notifications", async () => {
  const h = hound();
  assert.equal((await call(h, "rm_rf", {})).error.code, -32602);
  assert.equal((await handle(h, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "brain_region", arguments: [] } })).error.code, -32602);
  assert.equal((await handle(h, { jsonrpc: "2.0", id: 1, method: "resources/list" })).error.code, -32601);
  assert.equal((await handle(h, { id: 1, method: "ping" })).error.code, -32600);
  assert.equal((await handle(h, null)).error.code, -32600);
  assert.equal((await handle(h, [])).error.code, -32600);
  assert.deepEqual((await handle(h, { jsonrpc: "2.0", id: 9, method: "ping" })).result, {});
  assert.equal(await handle(h, { jsonrpc: "2.0", method: "notifications/initialized" }), null);
  assert.equal(await handle(h, { jsonrpc: "2.0", id: 3, result: {} }), null);
});

test("`brainhound serve` speaks MCP over stdio and reads a local file in --files", async () => {
  const cli = path.resolve("src/cli.js");
  const child = spawn(process.execPath, [cli, "serve", "--files", path.dirname(fixture("latest.nwb"))], { stdio: ["pipe", "pipe", "pipe"] });
  const replies = [];
  let buffer = "";
  const done = new Promise((resolve) => {
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) {
        replies.push(JSON.parse(buffer.slice(0, i)));
        buffer = buffer.slice(i + 1);
        if (replies.length === 4) resolve();
      }
    });
  });
  const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  child.stdin.write("this is not json\n");
  send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "nwb_summary", arguments: { asset: "latest.nwb" } } });
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "nwb_table", arguments: { asset: "../../package.json", path: "/units" } } });
  await done;
  child.stdin.end();
  await new Promise((r) => child.on("exit", r));
  const byId = Object.fromEntries(replies.map((r) => [r.id, r]));
  assert.equal(byId[1].result.serverInfo.name, "brainhound");
  assert.equal(byId.null.error.code, -32700);
  assert.match(byId[2].result.content[0].text, /^Electrodes: 4, in CA1, DG, CA3$/m);
  assert.equal(byId[3].result.isError, true);
  assert.match(byId[3].result.content[0].text, /outside the folder/);
});

test("closing stdin still answers requests in flight, even a last line with no newline", async () => {
  const child = spawn(process.execPath, [path.resolve("src/cli.js"), "serve", "--files", path.dirname(fixture("latest.nwb"))], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (c) => (out += c));
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "nwb_summary", arguments: { asset: "earliest.nwb" } } }) + "\n");
  child.stdin.end(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }));
  await new Promise((r) => child.on("exit", r));
  const ids = out.trim().split("\n").map((l) => JSON.parse(l).id).sort();
  assert.deepEqual(ids, [1, 2]);
});
