// OpenNeuro (openneuro.org): BIDS datasets, mostly MRI, EEG, MEG and iEEG. Public GraphQL API, no
// key needed for public datasets.
import { formatBytes } from "./dandi.js";

const API = "https://openneuro.org/crn/graphql";

/** Turns "openneuro:ds000001", "ds000001", "ds000001/1.0.0" or an openneuro.org link into { id, tag }. */
export function parseOpenNeuroId(text) {
  const s = String(text).trim();
  const m = /(?:openneuro:|openneuro\.org\/datasets\/)?(ds\d{6})(?:(?:\/versions\/|\/|@)([\w.]+))?/i.exec(s);
  if (!m || (!/^(openneuro:)?ds\d{6}/i.test(s) && !s.includes("openneuro.org"))) return null;
  return { id: m[1].toLowerCase(), tag: m[2] };
}

export function citation(description, created) {
  const d = description ?? {};
  const year = created ? new Date(created).getUTCFullYear() : "n.d.";
  const authors = (d.Authors ?? []).join(", ") || "The dataset authors";
  const doi = d.DatasetDOI ? ` doi:${String(d.DatasetDOI).replace(/^doi:/i, "")}` : "";
  return `${authors} (${year}). ${d.Name ?? "Untitled"}. OpenNeuro. [Dataset]${doi}`;
}

const cleanLicense = (l) => (l ? String(l).replace(/\s+/g, " ").trim().slice(0, 200) : "not stated");

export async function search(net, query, { limit = 5, species } = {}) {
  const input = { keywords: [query] };
  if (species) input.species = species;
  const data = await net.graphql(
    API,
    `query($q: DatasetSearchInput!, $n: Int) { advancedSearch(query: $q, first: $n, datasetType: "All Public") {
      pageInfo { count }
      edges { node { id latestSnapshot { tag created description { Name License Authors DatasetDOI } summary { modalities subjects size totalFiles } } } } } }`,
    { q: input, n: limit },
  );
  const search = data.advancedSearch ?? { edges: [] };
  return {
    total: search.pageInfo?.count ?? search.edges.length,
    results: search.edges.map(({ node }) => {
      const s = node.latestSnapshot ?? {};
      return {
        source: "OpenNeuro",
        id: `openneuro:${node.id}`,
        title: s.description?.Name ?? node.id,
        detail: [(s.summary?.modalities ?? []).join(", "), s.summary?.subjects ? `${s.summary.subjects.length} subjects` : "", formatBytes(s.summary?.size), s.tag ? `version ${s.tag}` : ""].filter(Boolean),
        license: cleanLicense(s.description?.License),
        url: `https://openneuro.org/datasets/${node.id}${s.tag ? `/versions/${s.tag}` : ""}`,
      };
    }),
  };
}

const SNAPSHOT_FIELDS = `tag created description { Name License Authors DatasetDOI HowToAcknowledge ReferencesAndLinks Funding }
  summary { modalities subjects tasks sessions size totalFiles } readme`;

export async function info(net, ref) {
  const data = ref.tag
    ? await net.graphql(API, `query($id: ID!, $tag: String!) { snapshot(datasetId: $id, tag: $tag) { ${SNAPSHOT_FIELDS} } }`, { id: ref.id, tag: ref.tag })
    : await net.graphql(API, `query($id: ID!) { dataset(id: $id) { latestSnapshot { ${SNAPSHOT_FIELDS} } } }`, { id: ref.id });
  const s = ref.tag ? data.snapshot : data.dataset?.latestSnapshot;
  if (!s) throw new Error(`OpenNeuro has no public dataset ${ref.id}${ref.tag ? ` version ${ref.tag}` : ""}.`);
  const d = s.description ?? {};
  return {
    source: "OpenNeuro",
    id: `openneuro:${ref.id}`,
    title: d.Name,
    version: s.tag,
    url: `https://openneuro.org/datasets/${ref.id}/versions/${s.tag}`,
    description: s.readme,
    facts: {
      Modalities: (s.summary?.modalities ?? []).join(", "),
      Tasks: (s.summary?.tasks ?? []).join(", "),
      Subjects: s.summary?.subjects?.length,
      Sessions: s.summary?.sessions?.length || undefined,
      Files: s.summary?.totalFiles,
      Size: formatBytes(s.summary?.size),
      Authors: (d.Authors ?? []).join("; "),
      Funding: (d.Funding ?? []).join("; "),
      "How to acknowledge": d.HowToAcknowledge,
    },
    related: (d.ReferencesAndLinks ?? []).slice(0, 8),
    license: cleanLicense(d.License),
    citation: citation(d, s.created),
  };
}

export async function files(net, ref, { prefix = "", limit = 50, offset = 0 } = {}) {
  let tag = ref.tag;
  if (!tag) {
    const data = await net.graphql(API, `query($id: ID!) { dataset(id: $id) { latestSnapshot { tag } } }`, { id: ref.id });
    tag = data.dataset?.latestSnapshot?.tag;
    if (!tag) throw new Error(`OpenNeuro has no public dataset ${ref.id}.`);
  }
  const list = async (tree) =>
    (await net.graphql(API, `query($id: ID!, $tag: String!, $tree: String) { snapshot(datasetId: $id, tag: $tag) { files(tree: $tree) { id filename directory size } } }`, { id: ref.id, tag, tree })).snapshot?.files ?? [];
  // Walk down one folder at a time to the one asked for.
  let entries = await list(null);
  let here = "";
  for (const part of prefix.split("/").filter(Boolean)) {
    const dir = entries.find((e) => e.directory && e.filename === part);
    if (!dir) throw new Error(`No folder ${here}${part} in ${ref.id} version ${tag}.`);
    here += `${part}/`;
    entries = await list(dir.id);
  }
  entries = entries.filter((e) => !e.filename.startsWith(".")).sort((a, b) => Number(b.directory) - Number(a.directory) || a.filename.localeCompare(b.filename));
  return {
    total: entries.length,
    version: tag,
    files: entries.slice(offset, offset + limit).map((e) => ({ path: `${here}${e.filename}${e.directory ? "/" : ""}`, size: e.directory ? undefined : e.size })),
  };
}
