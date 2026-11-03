// DANDI Archive (dandiarchive.org): neurophysiology datasets, mostly NWB. Public REST API, no key
// needed for open dandisets. Every dandiset carries its own license and a ready-made citation.
import { NetError } from "../net.js";

const API = "https://api.dandiarchive.org/api";

export const LICENSES = {
  "spdx:CC0-1.0": "CC0 1.0 (public domain; no conditions)",
  "spdx:CC-BY-4.0": "CC BY 4.0 (reuse allowed, credit the authors)",
  "spdx:CC-BY-NC-4.0": "CC BY-NC 4.0 (noncommercial use only, credit the authors)",
};

/** Turns "dandi:000003", "000003", "DANDI:000003/0.230629.1955" or a dandiarchive.org link into { id, version }. */
export function parseDandiId(text) {
  const s = String(text).trim();
  const link = /dandiarchive\.org\/dandiset\/(\d{6})(?:\/([\w.]+))?/.exec(s);
  if (link) return { id: link[1], version: link[2] };
  const m = /^(?:dandi:)?(\d{6})(?:\/(draft|\d+\.\d+\.\d+))?$/i.exec(s);
  return m ? { id: m[1], version: m[2] } : null;
}

async function pickVersion(net, id, version) {
  if (version) return version;
  const d = await net.json(`${API}/dandisets/${id}/`);
  return d.most_recent_published_version?.version ?? "draft";
}

function license(list) {
  const id = (list ?? [])[0];
  return id ? (LICENSES[id] ?? id.replace(/^spdx:/, "")) : "not stated";
}

const names = (list) => (list ?? []).map((x) => x.name).filter(Boolean);

export async function search(net, query, { limit = 5 } = {}) {
  const url = `${API}/dandisets/?search=${encodeURIComponent(query)}&page_size=${limit}&empty=false&embargoed=false`;
  const page = await net.json(url);
  const results = [];
  for (const d of page.results ?? []) {
    const version = d.most_recent_published_version ?? d.draft_version;
    let meta = {};
    try {
      meta = await net.json(`${API}/dandisets/${d.identifier}/versions/${version.version}/`);
    } catch (e) {
      if (!(e instanceof NetError)) throw e;
    }
    results.push({
      source: "DANDI",
      id: `dandi:${d.identifier}`,
      title: version.name,
      detail: [
        names(meta.assetsSummary?.species).join(", "),
        names(meta.assetsSummary?.approach).join(", "),
        `${version.asset_count} files`,
        formatBytes(version.size),
        version.version === "draft" ? "draft only" : `version ${version.version}`,
      ].filter(Boolean),
      license: license(meta.license),
      url: `https://dandiarchive.org/dandiset/${d.identifier}`,
    });
  }
  return { total: page.count ?? results.length, results };
}

export async function info(net, ref) {
  const version = await pickVersion(net, ref.id, ref.version);
  const m = await net.json(`${API}/dandisets/${ref.id}/versions/${version}/`);
  const authors = (m.contributor ?? []).filter((c) => (c.roleName ?? []).includes("dcite:Author")).map((c) => c.name);
  const summary = m.assetsSummary ?? {};
  const papers = (m.relatedResource ?? []).filter((r) => r.identifier || r.url).map((r) => `${r.relation?.replace(/^dcite:/, "") ?? "related"}: ${r.identifier ?? r.url}`);
  return {
    source: "DANDI",
    id: `dandi:${ref.id}`,
    title: m.name,
    version,
    url: m.url ?? `https://dandiarchive.org/dandiset/${ref.id}/${version}`,
    description: m.description,
    facts: {
      Species: names(summary.species).join(", "),
      Approach: names(summary.approach).join(", "),
      Techniques: names(summary.measurementTechnique).join(", "),
      "Data types": (summary.variableMeasured ?? []).join(", "),
      Subjects: summary.numberOfSubjects,
      Files: summary.numberOfFiles,
      Size: formatBytes(summary.numberOfBytes),
      Keywords: (m.keywords ?? []).join(", "),
      Authors: authors.join("; "),
      Access: (m.access ?? []).map((a) => a.status?.replace(/^dandi:/, "")).join(", "),
    },
    related: papers.slice(0, 8),
    license: license(m.license),
    citation: m.citation ?? (m.doi ? `https://doi.org/${m.doi}` : `${m.name}. DANDI Archive. ${m.url}`),
  };
}

export async function files(net, ref, { prefix = "", limit = 50, offset = 0 } = {}) {
  const version = await pickVersion(net, ref.id, ref.version);
  const page = Math.floor(offset / limit) + 1;
  const url = `${API}/dandisets/${ref.id}/versions/${version}/assets/?page_size=${limit}&page=${page}&order=path${prefix ? `&path=${encodeURIComponent(prefix)}` : ""}`;
  const data = await net.json(url);
  return {
    total: data.count ?? 0,
    version,
    files: (data.results ?? []).map((a) => ({ path: a.path, size: a.size, id: a.asset_id, zarr: Boolean(a.zarr), ref: `dandi:${ref.id}/${a.path}` })),
  };
}

/**
 * Finds the plain S3 address of a DANDI file, which takes range requests directly. Accepts
 * "dandi:000003/sub-x/file.nwb", an asset id, or an api.dandiarchive.org asset link.
 */
export async function assetUrl(net, text) {
  const s = String(text).trim();
  if (/^https:\/\/dandiarchive\.s3\.amazonaws\.com\/blobs\//.test(s)) return { url: s.split("?")[0], name: s.split("?")[0] };
  let assetId = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(s)?.[1];
  let name = s;
  if (!assetId) {
    const m = /^(?:dandi:)?(\d{6})(?:@([\w.]+))?\/(.+)$/i.exec(s);
    if (!m) throw new NetError(`Give a DANDI file as dandi:<dandiset>/<path>, an asset id, or a DANDI link. Got: ${s}`);
    const version = await pickVersion(net, m[1], m[2]);
    const found = await net.json(`${API}/dandisets/${m[1]}/versions/${version}/assets/?path=${encodeURIComponent(m[3])}&page_size=5`);
    const exact = (found.results ?? []).find((a) => a.path === m[3]);
    if (!exact) throw new NetError(`No file ${m[3]} in dandiset ${m[1]} (version ${version}). Use list_files to see the paths.`);
    if (exact.zarr) throw new NetError(`${m[3]} is stored as Zarr, which brainhound doesn't read yet; only HDF5 NWB files.`);
    assetId = exact.asset_id;
    name = `dandi:${m[1]}/${m[3]}`;
  }
  const asset = await net.json(`${API}/assets/${assetId}/`);
  const urls = Array.isArray(asset.contentUrl) ? asset.contentUrl : [asset.contentUrl];
  const s3 = urls.find((u) => typeof u === "string" && u.startsWith("https://dandiarchive.s3.amazonaws.com/blobs/"));
  if (!s3) throw new NetError("That DANDI file has no direct address brainhound can read (it may be Zarr or embargoed).");
  return { url: s3, name, size: asset.contentSize, path: asset.path };
}

export function formatBytes(n) {
  if (n === undefined || n === null || Number.isNaN(n)) return "";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  let v = Number(n);
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
