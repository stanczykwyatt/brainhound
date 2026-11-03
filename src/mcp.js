// The MCP side: JSON-RPC messages, one per line, over stdin and stdout, as the MCP stdio transport
// specifies. Tools only, all read-only. Nothing is written to disk.
import { Hound, ToolError, SOURCES } from "./tools.js";
import { NetError, VERSION } from "./net.js";
import { Hdf5Error } from "./hdf5/hdf5.js";

export const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

// Every tool only reads, and every one but the local-file case talks to public archives.
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const asset = { type: "string", description: "The NWB file: dandi:<dandiset>/<path> (from list_files), a DANDI asset id or link, or a local path when brainhound was started with --files." };
const object = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });

export const TOOLS = [
  {
    name: "search_datasets",
    description: "Search public neuroscience data across DANDI (neurophysiology, NWB), OpenNeuro (MRI, EEG, MEG, iEEG; BIDS) and NeuroMorpho (neuron reconstructions) at once. Each result has an id and its license.",
    inputSchema: object(
      {
        query: { type: "string", description: "What to look for: a brain region, technique, task or species, like 'hippocampus', 'CA1', 'visual cortex two-photon'. NeuroMorpho matches region, cell type or archive names exactly, so use one term." },
        sources: { type: "array", items: { type: "string", enum: SOURCES }, description: "Which archives to search. Default: all three." },
        species: { type: "string", description: "Narrow OpenNeuro and NeuroMorpho to a species, like human, mouse or rat." },
        limit: { type: "integer", minimum: 1, maximum: 20, description: "Results per archive. Default 5." },
      },
      ["query"],
    ),
    annotations,
  },
  {
    name: "dataset_info",
    description: "Details of one dataset: description, species, techniques, subjects, size, authors, license, and a ready-to-paste citation.",
    inputSchema: object({ id: { type: "string", description: "dandi:000003, openneuro:ds000001 (optionally with /version), neuromorpho:n419, or a link to one of them." } }, ["id"]),
    annotations,
  },
  {
    name: "list_files",
    description: "List the files in a DANDI dandiset or OpenNeuro dataset, with sizes. For DANDI, `path` filters by path prefix; for OpenNeuro it is a folder, like sub-01/anat.",
    inputSchema: object(
      {
        id: { type: "string", description: "dandi:000003 or openneuro:ds000001." },
        path: { type: "string", description: "Only files under this path." },
        limit: { type: "integer", minimum: 1, maximum: 500, description: "Default 50." },
        offset: { type: "integer", minimum: 0, description: "Skip this many, for paging." },
      },
      ["id"],
    ),
    annotations,
  },
  {
    name: "nwb_summary",
    description: "Open an NWB file remotely, without downloading it, and summarize it: session, subject, devices, electrodes, units, and every acquisition, stimulus, interval and processing entry with its type and shape.",
    inputSchema: object({ asset }, ["asset"]),
    annotations,
  },
  {
    name: "nwb_tree",
    description: "Show the groups and datasets inside an NWB or HDF5 file, with NWB types, shapes, dtypes and units. Reads only the file's metadata.",
    inputSchema: object(
      {
        asset,
        path: { type: "string", description: "Start here instead of the top, like /processing/behavior." },
        depth: { type: "integer", minimum: 1, maximum: 6, description: "How many levels down. Default 2." },
      },
      ["asset"],
    ),
    annotations,
  },
  {
    name: "nwb_read",
    description: "Read a slice of a dataset in an NWB or HDF5 file with range requests, so only the needed bytes are fetched. Returns its attributes (unit, rate, conversion), simple stats and the values. Without start and count it reads a small corner.",
    inputSchema: object(
      {
        asset,
        path: { type: "string", description: "The dataset, like /acquisition/ElectricalSeries/data." },
        start: { type: "array", items: { type: "integer", minimum: 0 }, description: "First index in each dimension." },
        count: { type: "array", items: { type: "integer", minimum: 0 }, description: "How many in each dimension." },
        max_values: { type: "integer", minimum: 1, maximum: 100000, description: "Most values to print. Default 200; stats cover the whole slice." },
      },
      ["asset", "path"],
    ),
    annotations,
  },
  {
    name: "nwb_table",
    description: "Read rows of an NWB table (DynamicTable), such as /units, /intervals/trials or /general/extracellular_ephys/electrodes. Follows ragged columns like spike_times, and shows references as paths.",
    inputSchema: object(
      {
        asset,
        path: { type: "string", description: "The table's group." },
        columns: { type: "array", items: { type: "string" }, description: "Only these columns. Default: all." },
        start: { type: "integer", minimum: 0, description: "First row. Default 0." },
        count: { type: "integer", minimum: 1, maximum: 1000, description: "Rows to read. Default 20." },
      },
      ["asset", "path"],
    ),
    annotations,
  },
  {
    name: "brain_region",
    description: "Look up a brain region in the Allen ontology by acronym or name: its id, full name, color and chain of parent regions. Use it to match region names across datasets and atlases.",
    inputSchema: object(
      {
        query: { type: "string", description: "An acronym like CA1 or VISp, or part of a name like 'primary visual'." },
        species: { type: "string", enum: ["mouse", "human", "developing mouse"], description: "Default mouse." },
        limit: { type: "integer", minimum: 1, maximum: 25 },
      },
      ["query"],
    ),
    annotations,
  },
  {
    name: "brain_atlases",
    description: "List BrainGlobe's reference atlases (mouse, rat, human, zebrafish and more), filtered by name, with species, voxel size and citation.",
    inputSchema: object({
      query: { type: "string", description: "Words that must appear in the atlas name, like 'allen mouse' or 'zfish'." },
      limit: { type: "integer", minimum: 1, maximum: 300, description: "Default 10." },
    }),
    annotations,
  },
  {
    name: "neuron_morphology",
    description: "One NeuroMorpho neuron: species, region, cell type, lab archive, stain, morphometry (length, branches, surface, volume), links to its SWC file and image, and the three citations NeuroMorpho asks for.",
    inputSchema: object({ id: { type: "string", description: "A neuron name like n419, a numeric id, or neuromorpho:<name>." } }, ["id"]),
    annotations,
  },
];

const handlers = {
  search_datasets: (h, a) => h.search(a),
  dataset_info: (h, a) => h.datasetInfo(a),
  list_files: (h, a) => h.listFiles(a),
  nwb_summary: (h, a) => h.nwbSummary(a),
  nwb_tree: (h, a) => h.nwbTree(a),
  nwb_read: (h, a) => h.nwbRead(a),
  nwb_table: (h, a) => h.nwbTable(a),
  brain_region: (h, a) => h.region(a),
  brain_atlases: (h, a) => h.atlases(a),
  neuron_morphology: (h, a) => h.neuron(a),
};

/** Handles one request and returns its response, or null for a notification. */
export async function handle(hound, message) {
  const id = message !== null && typeof message === "object" ? message.id : undefined;
  const reply = (result) => ({ jsonrpc: "2.0", id, result });
  const error = (code, text) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message: text } });
  if (!message || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0") return error(-32600, "Not a JSON-RPC 2.0 request.");
  // A reply from the client (brainhound never asks it anything) needs no answer.
  if (message.method === undefined && ("result" in message || "error" in message)) return null;
  if (typeof message.method !== "string") return error(-32600, "Not a JSON-RPC 2.0 request.");
  // Notifications are never answered, whatever they are.
  if (id === undefined) return null;
  switch (message.method) {
    case "initialize": {
      const asked = message.params?.protocolVersion;
      return reply({
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "brainhound", version: VERSION },
        instructions:
          "Find public neuroscience data with search_datasets, then dataset_info for the license and citation. For DANDI NWB files, list_files gives paths; nwb_summary, nwb_tree, nwb_read and nwb_table read them remotely without downloading. Always pass on each dataset's license and citation to the user.",
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call": {
      const name = message.params?.name;
      const args = message.params?.arguments ?? {};
      if (!handlers[name]) return error(-32602, `Unknown tool: ${name}`);
      if (typeof args !== "object" || Array.isArray(args)) return error(-32602, "Arguments must be an object.");
      try {
        const text = await handlers[name](hound, args);
        return reply({ content: [{ type: "text", text }], isError: false });
      } catch (e) {
        // Mistakes, missing data and unreachable archives go back to the agent as tool errors it can act on.
        const known = e instanceof ToolError || e instanceof NetError || e instanceof Hdf5Error || e instanceof RangeError;
        const text = known ? e.message : `Something went wrong: ${e?.message ?? e}`;
        return reply({ content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      return error(-32601, `Unknown method: ${message.method}`);
  }
}

/** Runs the server on stdin and stdout until stdin closes. */
export function serve({ input = process.stdin, output = process.stdout, files, net } = {}) {
  const hound = new Hound({ files, net });
  let buffer = "";
  const pending = new Set();
  const write = (response) => {
    if (response) output.write(JSON.stringify(response) + "\n");
  };
  const run = (line) => {
    if (!line) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Not JSON." } });
      return;
    }
    const job = handle(hound, message)
      .then(write, (e) => write({ jsonrpc: "2.0", id: message?.id ?? null, error: { code: -32603, message: String(e?.message ?? e) } }))
      .catch(() => {})
      .finally(() => pending.delete(job));
    pending.add(job);
  };
  input.setEncoding("utf8");
  input.on("data", (chunk) => {
    buffer += chunk;
    if (buffer.length > 16 * 1024 * 1024) buffer = "";
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      run(line);
    }
  });
  // When the client closes stdin, answer what's still in flight (and a last line with no newline), then stop.
  input.on("end", async () => {
    run(buffer.trim());
    buffer = "";
    while (pending.size) await Promise.allSettled([...pending]);
    output.write("", () => process.exit(0));
  });
  return hound;
}
