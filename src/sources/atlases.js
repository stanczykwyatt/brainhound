// Brain regions and atlases. Region names, acronyms and hierarchy come from the Allen Institute's
// structure ontology (api.brain-map.org); the list of atlases comes from BrainGlobe's public bucket.
import { NetError } from "../net.js";

const ALLEN = "https://api.brain-map.org/api/v2/data/query.json";
const BRAINGLOBE = "https://brainglobe.s3.us-west-2.amazonaws.com/atlas/atlases";

// Structure graphs in the Allen ontology: which atlas a region belongs to.
export const GRAPHS = {
  mouse: { id: 1, name: "Allen Mouse Brain Atlas (adult mouse, the CCFv3 regions)" },
  human: { id: 10, name: "Allen Human Brain Atlas" },
  "developing mouse": { id: 17, name: "Allen Developing Mouse Brain Atlas" },
};

export const ALLEN_LICENSE =
  "Allen Institute terms of use: research and other noncommercial use only, derivative works included. Credit the Allen Institute as its citation policy asks (alleninstitute.org/citation-policy).";
export const ALLEN_CITATION = "Wang Q, Ding SL, Li Y, et al. (2020) The Allen Mouse Brain Common Coordinate Framework: A 3D Reference Atlas. Cell 181(4):936-953. doi:10.1016/j.cell.2020.04.007";

// Allen's query language quotes values in single quotes; keep only characters that can't break out.
const safe = (s) => String(s).replace(/[^\p{L}\p{N} ,.()/-]/gu, "").trim().slice(0, 80);

/** Finds regions by acronym (exact) or name (contains), with each one's chain of parent regions. */
export async function regions(net, query, { species = "mouse", limit = 5 } = {}) {
  const graph = GRAPHS[species];
  if (!graph) throw new NetError(`Species must be one of: ${Object.keys(GRAPHS).join(", ")}.`);
  const term = safe(query);
  if (!term) throw new NetError("Give a region name or acronym, like CA1 or primary visual.");
  const ask = (criteria, n) => net.json(`${ALLEN}?criteria=model::Structure,rma::criteria,[graph_id$eq${graph.id}],${criteria},rma::options[num_rows$eq${n}][order$eq'depth']`);
  let rows = (await ask(`[acronym$il'${term}']`, limit)).msg ?? [];
  if (!rows.length) rows = (await ask(`[name$il'*${term}*']`, limit)).msg ?? [];
  if (!Array.isArray(rows)) throw new NetError("The Allen API sent an unexpected answer.");
  const parentIds = new Set();
  for (const r of rows) for (const id of String(r.structure_id_path ?? "").split("/").filter(Boolean)) parentIds.add(Number(id));
  const parents = new Map();
  if (parentIds.size) {
    const data = await net.json(`${ALLEN}?criteria=model::Structure,rma::criteria,[id$in${[...parentIds].join(",")}],rma::options[num_rows$eq${parentIds.size}]`);
    for (const p of data.msg ?? []) parents.set(p.id, p);
  }
  return {
    atlas: graph.name,
    results: rows.map((r) => ({
      id: r.id,
      acronym: r.acronym,
      name: r.name,
      color: r.color_hex_triplet ? `#${r.color_hex_triplet}` : undefined,
      path: String(r.structure_id_path ?? "")
        .split("/")
        .filter(Boolean)
        .map((id) => parents.get(Number(id)))
        .filter(Boolean)
        .map((p) => p.acronym)
        .join(" > "),
    })),
    license: ALLEN_LICENSE,
    citation: species === "mouse" ? ALLEN_CITATION : "Cite the Allen Institute atlas you use, as its citation policy asks (alleninstitute.org/citation-policy).",
  };
}

/** Lists BrainGlobe atlases, optionally filtered, with species, resolution and citation for a few. */
export async function atlases(net, query = "", { limit = 10 } = {}) {
  const text = await net.text(`${BRAINGLOBE}/last_versions.conf`);
  const all = [];
  for (const line of text.split("\n")) {
    const m = /^\s*([\w.-]+)\s*=\s*([\d.]+)\s*$/.exec(line);
    if (m) all.push({ name: m[1], version: m[2] });
  }
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const matches = all.filter((a) => words.every((w) => a.name.toLowerCase().includes(w)));
  const shown = matches.slice(0, limit);
  // Details cost one request each, so they're only fetched for a short list.
  if (shown.length <= 10) {
    for (const a of shown) {
      try {
        const m = await net.json(`${BRAINGLOBE}/${a.name}/${a.version.replace(/\./g, "_")}/manifest.json`);
        Object.assign(a, { species: m.species, resolution: m.resolution, citation: m.citation, link: m.atlas_link, shape: m.shape });
      } catch (e) {
        if (!(e instanceof NetError)) throw e;
      }
    }
  }
  return { total: matches.length, of: all.length, atlases: shown };
}
