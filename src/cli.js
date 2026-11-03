#!/usr/bin/env node
// brainhound: find and read public neuroscience data. `brainhound serve` is the MCP server; the
// other commands print the same answers in a terminal.
import { serve } from "./mcp.js";
import { Hound, ToolError } from "./tools.js";
import { NetError, VERSION } from "./net.js";
import { Hdf5Error } from "./hdf5/hdf5.js";

const USAGE = `brainhound ${VERSION}: search and read public neuroscience data, for you or your coding agent

  brainhound serve [--files DIR]            run the MCP server on stdin and stdout
  brainhound search QUERY [--sources dandi,openneuro,neuromorpho] [--species S] [--limit N]
  brainhound info ID                        description, license and citation of a dataset
  brainhound files ID [PATH] [--limit N] [--offset N]
  brainhound summary FILE                   what's in an NWB file, read remotely
  brainhound tree FILE [PATH] [--depth N]   its groups and datasets
  brainhound read FILE PATH [--start 0,0] [--count 100,4] [--max N]
  brainhound table FILE PATH [--columns a,b] [--start N] [--count N]
  brainhound region QUERY [--species mouse|human]
  brainhound atlases [QUERY]
  brainhound neuron NAME

IDs look like dandi:000003, openneuro:ds000001 or neuromorpho:n419. FILE is dandi:<dandiset>/<path>
from \`brainhound files\`, or a local .nwb file inside the folder given with --files.`;

const args = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; ) {
  if (args[i].startsWith("--") && args[i] !== "--version" && args[i] !== "--help") {
    flags[args[i].slice(2)] = args[i + 1];
    args.splice(i, 2);
  } else i++;
}
const list = (s) => (s === undefined ? undefined : String(s).split(",").map((x) => x.trim()).filter(Boolean));
const numbers = (s) => list(s)?.map(Number);
const [command, a, b] = args;

async function main() {
  if (command === "serve") return serve({ files: flags.files });
  if (command === "--version" || command === "-v") return console.log(VERSION);
  const hound = new Hound({ files: flags.files ?? (["summary", "tree", "read", "table"].includes(command) ? process.cwd() : undefined) });
  const run = {
    search: () => hound.search({ query: args.slice(1).join(" "), sources: list(flags.sources), species: flags.species, limit: flags.limit }),
    info: () => hound.datasetInfo({ id: a }),
    files: () => hound.listFiles({ id: a, path: b ?? "", limit: flags.limit, offset: flags.offset }),
    summary: () => hound.nwbSummary({ asset: a }),
    tree: () => hound.nwbTree({ asset: a, path: b ?? "/", depth: flags.depth }),
    read: () => hound.nwbRead({ asset: a, path: b, start: numbers(flags.start), count: numbers(flags.count), max_values: flags.max }),
    table: () => hound.nwbTable({ asset: a, path: b, columns: list(flags.columns), start: flags.start, count: flags.count }),
    region: () => hound.region({ query: args.slice(1).join(" "), species: flags.species }),
    atlases: () => hound.atlases({ query: args.slice(1).join(" "), limit: flags.limit }),
    neuron: () => hound.neuron({ id: a }),
  }[command];
  if (!run) {
    console.log(USAGE);
    process.exitCode = command && !["help", "-h", "--help"].includes(command) ? 2 : 0;
    return;
  }
  try {
    console.log(await run());
  } catch (e) {
    const known = e instanceof ToolError || e instanceof NetError || e instanceof Hdf5Error || e instanceof RangeError;
    console.error(known ? e.message : `brainhound: ${e.message}`);
    process.exitCode = 1;
  }
}

main();
