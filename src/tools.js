// What each tool does, shared by the MCP server and the command line. Every answer is short plain
// text an agent can read cheaply, and every dataset comes with its license and how to cite it.
import path from "node:path";
import { realpathSync } from "node:fs";
import { Net, NetError } from "./net.js";
import { Hdf5File, Hdf5Error, describeType, reshape } from "./hdf5/hdf5.js";
import { FileSource, HttpSource } from "./hdf5/source.js";
import * as dandi from "./sources/dandi.js";
import * as openneuro from "./sources/openneuro.js";
import * as neuromorpho from "./sources/neuromorpho.js";
import * as atlas from "./sources/atlases.js";

/** A mistake in what was asked, said plainly so the agent can fix its call. */
export class ToolError extends Error {}

export const SOURCES = ["dandi", "openneuro", "neuromorpho"];
const { formatBytes } = dandi;

function clamp(n, lo, hi, fallback) {
  const v = Number.isFinite(Number(n)) ? Math.trunc(Number(n)) : fallback;
  return Math.min(hi, Math.max(lo, v));
}

function block(lines) {
  return lines.filter((l) => l !== undefined && l !== null && l !== false).join("\n");
}

function facts(obj) {
  return Object.entries(obj ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}: ${v}`);
}

function trimText(text, max = 1200) {
  const s = String(text ?? "").replace(/\s+\n/g, "\n").trim();
  return s.length > max ? `${s.slice(0, max).trimEnd()}…` : s;
}

/** Formats one value for a table or a list: short numbers, quoted text, references as their path. */
export function show(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(7)));
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.map(show).join(", ")}]`;
  if (v.ref) return `<${v.ref}>`;
  return `{${Object.entries(v).map(([k, x]) => `${k}: ${show(x)}`).join(", ")}}`;
}

function stats(values) {
  const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (nums.length < 2 || nums.length !== values.length) return null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of nums) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return `min ${show(min)}, max ${show(max)}, mean ${show(sum / nums.length)}`;
}

export class Hound {
  /**
   * @param {object} options
   * @param {Net} [options.net] the network client (tests pass one with a fake fetch)
   * @param {string} [options.files] a folder whose .nwb/.h5 files may be read; off unless given
   */
  constructor({ net = new Net(), files } = {}) {
    this.net = net;
    this.filesRoot = files ? realpathSync(path.resolve(files)) : null;
    this.open = new Map();
    // Ragged columns with more values than this are sampled cell by cell instead of read whole.
    this.raggedLimit = 4096;
  }

  // ----- finding datasets

  async search({ query, sources = SOURCES, species, limit = 5 }) {
    if (!query || !String(query).trim()) throw new ToolError("Give a search query, like hippocampus place cells or V1 two-photon.");
    const n = clamp(limit, 1, 20, 5);
    const wanted = (Array.isArray(sources) ? sources : String(sources).split(",")).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
    const unknown = wanted.filter((s) => !SOURCES.includes(s));
    if (unknown.length) throw new ToolError(`Unknown source: ${unknown.join(", ")}. Use ${SOURCES.join(", ")}.`);
    const jobs = {
      dandi: () => dandi.search(this.net, query, { limit: n }),
      openneuro: () => openneuro.search(this.net, query, { limit: n, species }),
      neuromorpho: () => neuromorpho.search(this.net, query, { limit: n, species }),
    };
    const settled = await Promise.allSettled(wanted.map((s) => jobs[s]()));
    const out = [];
    settled.forEach((r, i) => {
      const name = { dandi: "DANDI", openneuro: "OpenNeuro", neuromorpho: "NeuroMorpho" }[wanted[i]];
      if (r.status === "rejected") {
        out.push(`## ${name}: couldn't search (${r.reason?.message ?? r.reason})`);
        return;
      }
      const { total, results, matchedOn } = r.value;
      out.push(`## ${name}: ${total} match${total === 1 ? "" : "es"}${matchedOn ? ` by ${matchedOn}` : ""}${total > results.length ? `, showing ${results.length}` : ""}`);
      for (const x of results) {
        out.push(`- ${x.id}  ${x.title}`);
        if (x.detail.length) out.push(`  ${x.detail.join(" · ")}`);
        out.push(`  License: ${x.license}`);
      }
    });
    out.push("", "Use dataset_info on an id for the description and how to cite it.");
    return block(out);
  }

  async datasetInfo({ id }) {
    const ref = this.parseDatasetId(id);
    let d;
    if (ref.source === "dandi") d = await dandi.info(this.net, ref);
    else if (ref.source === "openneuro") d = await openneuro.info(this.net, ref);
    else return this.neuron({ id });
    return block([
      `# ${d.title}`,
      `${d.id}${d.version ? ` (version ${d.version})` : ""}  ${d.url}`,
      "",
      ...facts(d.facts),
      d.description ? `\n${trimText(d.description)}` : "",
      d.related?.length ? `\nRelated:\n${d.related.map((r) => `- ${trimText(r, 300)}`).join("\n")}` : "",
      "",
      `License: ${d.license}`,
      `Cite as: ${d.citation}`,
    ]);
  }

  parseDatasetId(id) {
    const s = String(id ?? "").trim();
    if (!s) throw new ToolError("Give a dataset id, like dandi:000003, openneuro:ds000001 or neuromorpho:n419.");
    const d = dandi.parseDandiId(s);
    if (d) return { source: "dandi", ...d };
    const o = openneuro.parseOpenNeuroId(s);
    if (o) return { source: "openneuro", ...o };
    if (/^neuromorpho:/i.test(s) || /neuromorpho\.org/.test(s)) return { source: "neuromorpho" };
    throw new ToolError(`Not a dataset id brainhound knows: ${s}. Use dandi:000003, openneuro:ds000001 or neuromorpho:n419.`);
  }

  async listFiles({ id, path: prefix = "", limit = 50, offset = 0 }) {
    const ref = this.parseDatasetId(id);
    const n = clamp(limit, 1, 500, 50);
    const from = clamp(offset, 0, 1e9, 0);
    if (ref.source === "neuromorpho") throw new ToolError("NeuroMorpho neurons have one file each; neuron_morphology gives its link.");
    const r = ref.source === "dandi" ? await dandi.files(this.net, ref, { prefix, limit: n, offset: from }) : await openneuro.files(this.net, ref, { prefix, limit: n, offset: from });
    const shown = r.files.length;
    const lines = [`${r.total} ${ref.source === "dandi" ? "files" : "entries"}${prefix ? ` under ${prefix}` : ""} in ${ref.source}:${ref.id} version ${r.version}${r.total > shown ? `; showing ${from + 1}–${from + shown}` : ""}`];
    for (const f of r.files) lines.push(`${f.path}${f.size !== undefined ? `  ${formatBytes(f.size)}` : ""}${f.zarr ? "  (Zarr, not readable yet)" : ""}`);
    if (ref.source === "dandi" && r.files.some((f) => /\.nwb$/i.test(f.path) && !f.zarr)) lines.push("", `Open one with nwb_summary, for example: dandi:${ref.id}/${r.files.find((f) => /\.nwb$/i.test(f.path) && !f.zarr).path}`);
    if (r.total > from + shown) lines.push(`More: call again with offset ${from + shown}.`);
    return block(lines);
  }

  // ----- reading NWB files

  async file(asset) {
    const key = String(asset ?? "").trim();
    if (!key) throw new ToolError("Give a file: dandi:<dandiset>/<path>, a DANDI asset id or link, or a local path if local files are on.");
    if (this.open.has(key)) {
      const hit = this.open.get(key);
      this.open.delete(key);
      this.open.set(key, hit);
      return fresh(await hit);
    }
    let source;
    let name = key;
    if (/^(dandi:|\d{6}\/|https:\/\/)/i.test(key) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(key)) {
      const found = await dandi.assetUrl(this.net, key);
      source = new HttpSource(found.url, this.net);
      name = found.name;
    } else {
      if (!this.filesRoot) throw new ToolError("Reading local files is off. Start brainhound with --files <folder> to allow files in that folder.");
      let real;
      try {
        real = realpathSync(path.resolve(this.filesRoot, key));
      } catch {
        throw new ToolError(`No such file: ${key}`);
      }
      if (real !== this.filesRoot && !real.startsWith(this.filesRoot + path.sep)) throw new ToolError(`${key} is outside the folder brainhound may read.`);
      if (!/\.(nwb|h5|hdf5|hdf|he5|mat)$/i.test(real)) throw new ToolError("Only .nwb, .h5, .hdf5 and MATLAB v7.3 .mat files can be opened.");
      source = new FileSource(real);
    }
    const promise = Hdf5File.open(source).then((f) => Object.assign(f, { label: name }));
    this.open.set(key, promise);
    promise.catch(() => this.open.delete(key));
    while (this.open.size > 4) this.open.delete(this.open.keys().next().value);
    return fresh(await promise);
  }

  footer(f) {
    const s = f.source;
    return s instanceof HttpSource ? `(read ${formatBytes(s.bytes)} in ${s.requests} range request${s.requests === 1 ? "" : "s"} so far; the file was not downloaded)` : null;
  }

  async scalar(f, p, max = 50) {
    try {
      const node = await f.resolve(p);
      if (node.kind !== "dataset") return undefined;
      const info = await f.dataset(node.address);
      if (product(info.space.dims) > max) return undefined;
      const { values } = await f.readSlice(info);
      return values.length === 1 ? values[0] : values;
    } catch (e) {
      if (e instanceof Hdf5Error) return undefined;
      throw e;
    }
  }

  async describeChildren(f, groupPath) {
    let node;
    try {
      node = await f.resolve(groupPath);
    } catch (e) {
      if (e instanceof Hdf5Error) return [];
      throw e;
    }
    const lines = [];
    for (const link of await f.links(node.address)) {
      const child = `${groupPath}/${link.name}`;
      lines.push(`  ${child}${await this.label(f, child)}`);
    }
    return lines;
  }

  async label(f, p) {
    try {
      const node = await f.resolve(p);
      const attrs = await f.attributes(node.address);
      const type = attrs.neurodata_type ? ` (${attrs.neurodata_type})` : "";
      if (node.kind === "dataset") {
        const info = await f.dataset(node.address);
        return `${type}  ${shapeText(info)} ${describeType(info.type)}`;
      }
      for (const name of ["data", "spike_times", "id"]) {
        try {
          const inner = await f.resolve(`${p}/${name}`);
          if (inner.kind !== "dataset") continue;
          const info = await f.dataset(inner.address);
          return `${type}  ${name}: ${shapeText(info)} ${describeType(info.type)}`;
        } catch (e) {
          if (!(e instanceof Hdf5Error)) throw e;
        }
      }
      // A container like LFP or Position holds the series; name them.
      const inside = (await f.links(node.address)).map((l) => l.name);
      return `${type}${inside.length ? `  holds ${inside.slice(0, 6).join(", ")}${inside.length > 6 ? ", …" : ""}` : ""}`;
    } catch (e) {
      if (e instanceof Hdf5Error) return "  (unreadable)";
      throw e;
    }
  }

  async nwbSummary({ asset }) {
    const f = await this.file(asset);
    const root = await f.attributes(f.rootAddress);
    const lines = [`# ${f.label}`];
    if (root.neurodata_type !== "NWBFile") lines.push("This HDF5 file isn't marked as NWB; nwb_tree shows what's in it.");
    lines.push(
      ...facts({
        "NWB version": root.nwb_version,
        Session: await this.scalar(f, "/session_description"),
        Identifier: await this.scalar(f, "/identifier"),
        Started: await this.scalar(f, "/session_start_time"),
        Lab: await this.scalar(f, "/general/lab"),
        Institution: await this.scalar(f, "/general/institution"),
        Experimenter: show(await this.scalar(f, "/general/experimenter")).replace(/^"|"$/g, "") || undefined,
      }),
    );
    const subject = {};
    for (const k of ["species", "subject_id", "age", "sex", "genotype", "strain"]) subject[k] = await this.scalar(f, `/general/subject/${k}`);
    const subjectText = facts(subject).join(", ");
    if (subjectText) lines.push(`Subject: ${subjectText}`);
    const devices = await this.describeChildren(f, "/general/devices");
    if (devices.length) lines.push(`Devices: ${devices.map((d) => d.trim().split(" ")[0].split("/").pop()).join(", ")}`);
    const locations = await this.scalar(f, "/general/extracellular_ephys/electrodes/location", 5000);
    if (locations !== undefined) {
      const list = Array.isArray(locations) ? locations : [locations];
      lines.push(`Electrodes: ${list.length}, in ${[...new Set(list)].join(", ")}`);
    } else {
      const ids = await this.datasetShape(f, "/general/extracellular_ephys/electrodes/id");
      if (ids) lines.push(`Electrodes: ${ids[0]}`);
    }
    const units = await this.datasetShape(f, "/units/id");
    if (units) {
      const cols = (await this.attr(f, "/units", "colnames")) ?? [];
      lines.push(`Units: ${units[0]}${cols.length ? `, columns ${[].concat(cols).join(", ")}` : ""}`);
    }
    for (const [title, group] of [
      ["Acquisition", "/acquisition"],
      ["Stimulus", "/stimulus/presentation"],
      ["Intervals", "/intervals"],
    ]) {
      const children = await this.describeChildren(f, group);
      if (children.length) lines.push(`${title}:`, ...children);
    }
    let modules = [];
    try {
      modules = await f.links((await f.resolve("/processing")).address);
    } catch (e) {
      if (!(e instanceof Hdf5Error)) throw e;
    }
    for (const m of modules) {
      const children = await this.describeChildren(f, `/processing/${m.name}`);
      lines.push(`Processing/${m.name}:`, ...children.slice(0, 30), children.length > 30 ? `  …and ${children.length - 30} more` : undefined);
    }
    lines.push("", "Read a dataset with nwb_read, or a table (units, electrodes, trials) with nwb_table.", this.footer(f));
    return block(lines);
  }

  async datasetShape(f, p) {
    try {
      const node = await f.resolve(p);
      return node.kind === "dataset" ? (await f.dataset(node.address)).space.dims : null;
    } catch (e) {
      if (e instanceof Hdf5Error) return null;
      throw e;
    }
  }

  async attr(f, p, name) {
    try {
      return (await f.attributes((await f.resolve(p)).address))[name];
    } catch (e) {
      if (e instanceof Hdf5Error) return undefined;
      throw e;
    }
  }

  async nwbTree({ asset, path: start = "/", depth = 2 }) {
    const f = await this.file(asset);
    const maxDepth = clamp(depth, 1, 6, 2);
    const lines = [];
    let budget = 400;
    const walk = async (p, level) => {
      if (budget-- <= 0) return;
      const node = await f.resolve(p);
      const attrs = await f.attributes(node.address);
      const name = p === "/" ? "/" : p.split("/").pop();
      const indent = "  ".repeat(level);
      if (node.kind === "dataset") {
        const info = await f.dataset(node.address);
        const extra = ["unit", "rate", "conversion", "neurodata_type"].filter((k) => attrs[k] !== undefined).map((k) => `${k}=${show(attrs[k]).replace(/^"|"$/g, "")}`);
        lines.push(`${indent}${name}  ${shapeText(info)} ${describeType(info.type)}${extra.length ? `  ${extra.join(" ")}` : ""}`);
        return;
      }
      lines.push(`${indent}${p === "/" ? "/" : `${name}/`}${attrs.neurodata_type ? `  (${attrs.neurodata_type})` : ""}${attrs.description && level > 0 ? `  ${trimText(show(attrs.description).replace(/^"|"$/g, ""), 80)}` : ""}`);
      if (level >= maxDepth) return;
      for (const link of await f.links(node.address)) {
        const child = p === "/" ? `/${link.name}` : `${p}/${link.name}`;
        if (link.soft) lines.push(`${indent}  ${link.name} -> ${link.soft}`);
        else if (link.external) lines.push(`${indent}  ${link.name} -> another file`);
        else await walk(child, level + 1);
      }
    };
    try {
      await walk(normalize(start), 0);
    } catch (e) {
      if (e instanceof Hdf5Error) throw new ToolError(e.message);
      throw e;
    }
    if (budget <= 0) lines.push("…stopped at 400 entries; give a path or a smaller depth.");
    lines.push("", this.footer(f));
    return block(lines);
  }

  async nwbRead({ asset, path: p, start, count, max_values: maxValues = 200 }) {
    if (!p) throw new ToolError("Give the path of a dataset inside the file, like /acquisition/ElectricalSeries/data.");
    const f = await this.file(asset);
    try {
      const node = await f.resolve(normalize(p));
      if (node.kind !== "dataset") throw new ToolError(`${node.path} is a group. nwb_tree shows what's inside it.`);
      const info = await f.dataset(node.address);
      const dims = info.space.dims;
      const from = start ?? dims.map(() => 0);
      if (!Array.isArray(from) || from.length !== dims.length) throw new ToolError(`start needs ${dims.length} number${dims.length === 1 ? "" : "s"}, one per dimension.`);
      // Default to a small corner of big datasets rather than all of it.
      const size = count ?? dims.map((d, i) => Math.min(d - from[i], i === 0 ? 100 : 16));
      const { shape, values } = await f.readSlice(info, from, size);
      const attrs = await f.attributes(node.address);
      const cap = clamp(maxValues, 1, 100000, 200);
      const lines = [
        `${node.path}: ${shapeText(info)} ${describeType(info.type)}`,
        ...facts(Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, show(v).replace(/^"|"$/g, "")]))).map((l) => `  ${l}`),
        `Slice: start [${from.join(", ")}], count [${shape.join(", ")}] = ${values.length} value${values.length === 1 ? "" : "s"}`,
      ];
      const s = stats(values);
      if (s) lines.push(`Stats over the slice: ${s}`);
      const shown = values.length > cap ? values.slice(0, cap) : values;
      const nested = values.length > cap || shape.length <= 1 ? shown : reshape(shown, shape);
      lines.push(values.length > cap ? `First ${cap} values (row-major):` : "Values:", show(nested));
      lines.push("", this.footer(f));
      return block(lines);
    } catch (e) {
      if (e instanceof Hdf5Error) throw new ToolError(e.message);
      throw e;
    }
  }

  async nwbTable({ asset, path: p, columns, start = 0, count = 20 }) {
    if (!p) throw new ToolError("Give the path of a table, like /units, /intervals/trials or /general/extracellular_ephys/electrodes.");
    const f = await this.file(asset);
    try {
      const tablePath = normalize(p);
      const node = await f.resolve(tablePath);
      if (node.kind !== "group") throw new ToolError(`${tablePath} is a dataset; nwb_read reads it.`);
      const attrs = await f.attributes(node.address);
      const links = (await f.links(node.address)).map((l) => l.name);
      const all = [].concat(attrs.colnames ?? links.filter((n) => n !== "id" && !n.endsWith("_index")));
      const wanted = columns ? [].concat(columns).map(String) : all;
      const missing = wanted.filter((c) => !links.includes(c));
      if (missing.length) throw new ToolError(`No column ${missing.join(", ")} in ${tablePath}. Columns: ${all.join(", ")}`);
      const rows = links.includes("id") ? (await f.dataset((await f.resolve(`${tablePath}/id`)).address)).space.dims[0] : (await f.dataset((await f.resolve(`${tablePath}/${wanted[0]}`)).address)).space.dims[0];
      const from = clamp(start, 0, Math.max(0, rows - 1), 0);
      const n = Math.min(clamp(count, 1, 1000, 20), rows - from);
      const table = { id: links.includes("id") ? (await f.readSlice(await f.dataset((await f.resolve(`${tablePath}/id`)).address), [from], [n])).values : Array.from({ length: n }, (_, i) => from + i) };
      for (const col of wanted) table[col] = await this.column(f, tablePath, col, links, from, n);
      const lines = [`${tablePath}${attrs.neurodata_type ? ` (${attrs.neurodata_type})` : ""}: ${rows} rows; showing ${from}–${from + n - 1}`];
      if (attrs.description) lines.push(trimText(show(attrs.description).replace(/^"|"$/g, ""), 200));
      lines.push(["id", ...wanted].join("\t"));
      for (let i = 0; i < n; i++) lines.push(["id", ...wanted].map((c) => show(table[c][i])).join("\t"));
      lines.push("", this.footer(f));
      return block(lines);
    } catch (e) {
      if (e instanceof Hdf5Error) throw new ToolError(e.message);
      throw e;
    }
  }

  /** One column for rows from..from+n, following a ragged column's _index dataset when there is one. */
  async column(f, tablePath, col, links, from, n) {
    const data = await f.dataset((await f.resolve(`${tablePath}/${col}`)).address);
    if (!links.includes(`${col}_index`)) {
      const dims = data.space.dims;
      const { values } = await f.readSlice(data, [from, ...dims.slice(1).map(() => 0)], [n, ...dims.slice(1)]);
      const inner = product(dims.slice(1));
      return inner === 1 ? values : Array.from({ length: n }, (_, i) => values.slice(i * inner, (i + 1) * inner));
    }
    const index = await f.dataset((await f.resolve(`${tablePath}/${col}_index`)).address);
    const ends = (await f.readSlice(index, [from], [n])).values.map(Number);
    const first = from === 0 ? 0 : Number((await f.readSlice(index, [from - 1], [1])).values[0]);
    const dims = data.space.dims;
    const inner = product(dims.slice(1));
    const rest = dims.slice(1);
    const zeros = rest.map(() => 0);
    const starts = [first, ...ends.slice(0, -1)];
    const total = (ends[ends.length - 1] - first) * inner;
    // Long ragged cells, like a unit's spike times, are summarized as a count and their first few
    // values. When the cells are long, only those first values are fetched.
    const summarize = (cell, length) => (length > 12 ? `${length} values: ${show(cell.slice(0, 6)).slice(0, -1)}, …]` : cell);
    if (total <= this.raggedLimit) {
      const { values } = await f.readSlice(data, [first, ...zeros], [ends[ends.length - 1] - first, ...rest]);
      return ends.map((end, i) => summarize(values.slice((starts[i] - first) * inner, (end - first) * inner), (end - starts[i]) * inner));
    }
    const out = [];
    for (let i = 0; i < ends.length; i++) {
      const rows = ends[i] - starts[i];
      const take = rows * inner > 12 ? Math.max(1, Math.ceil(6 / inner)) : rows;
      const cell = take ? (await f.readSlice(data, [starts[i], ...zeros], [take, ...rest])).values : [];
      out.push(summarize(cell, rows * inner));
    }
    return out;
  }

  // ----- regions, atlases and neurons

  async region({ query, species = "mouse", limit = 5 }) {
    const r = await atlas.regions(this.net, query, { species, limit: clamp(limit, 1, 25, 5) });
    if (!r.results.length) return `No ${species} region matches "${query}" in the ${r.atlas}.`;
    return block([
      `${r.atlas}:`,
      ...r.results.map((x) => `- ${x.acronym}  ${x.name}  (id ${x.id}${x.color ? `, color ${x.color}` : ""})\n  ${x.path}`),
      "",
      `License: ${r.license}`,
      `Cite as: ${r.citation}`,
    ]);
  }

  async atlases({ query = "", limit = 10 }) {
    const r = await atlas.atlases(this.net, query, { limit: clamp(limit, 1, 300, 10) });
    if (!r.total) return `No BrainGlobe atlas name contains "${query}". There are ${r.of}; try mouse, human, zebrafish or rat.`;
    const lines = [`${r.total} of ${r.of} BrainGlobe atlases${query ? ` match "${query}"` : ""}${r.total > r.atlases.length ? `; showing ${r.atlases.length}` : ""}:`];
    for (const a of r.atlases) {
      lines.push(`- ${a.name} (version ${a.version})${a.species ? `  ${a.species}` : ""}${a.resolution ? `, ${a.resolution.join("×")} µm voxels` : ""}`);
      if (a.citation) lines.push(`  Cite as: ${a.citation}${a.link ? `  (${a.link})` : ""}`);
    }
    lines.push("", "Load one in Python with brainglobe-atlasapi: BrainGlobeAtlas(\"<name>\"). Cite BrainGlobe too: Claudi F, et al. (2020) JOSS 5(54):2668. doi:10.21105/joss.02668");
    return block(lines);
  }

  async neuron({ id }) {
    const ref = neuromorpho.parseNeuronRef(id ?? "");
    if (!ref) throw new ToolError("Give a NeuroMorpho neuron name or id, like n419 or neuromorpho:100.");
    const n = await neuromorpho.neuron(this.net, ref);
    return block([
      `# ${n.title}  ${n.url}`,
      ...facts(n.facts),
      Object.keys(n.morphometry).length ? "\nMorphometry:" : "",
      ...facts(n.morphometry).map((l) => `  ${l}`),
      "",
      ...facts(n.files),
      "",
      `License: ${n.license}`,
      `Cite all three:\n${n.citation}`,
    ]);
  }
}

const product = (a) => a.reduce((x, y) => x * y, 1);

/** Starts a new question's work budget on an open file. */
function fresh(file) {
  file.work = 0;
  return file;
}

function shapeText(info) {
  if (info.space.kind === "null") return "(empty)";
  if (info.space.kind === "scalar") return "scalar";
  return `[${info.space.dims.join(" × ")}]`;
}

function normalize(p) {
  const s = String(p ?? "/").trim();
  return s.startsWith("/") ? s.replace(/\/+$/, "") || "/" : `/${s.replace(/\/+$/, "")}`;
}

export { NetError, Hdf5Error };
