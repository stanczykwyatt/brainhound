// NeuroMorpho.Org: digital reconstructions of neurons, with morphometry for each. Public REST API.
// Its content is CC BY 4.0, and it asks for three citations whenever its material is used.
import { NetError } from "../net.js";

const API = "https://neuromorpho.org/api";

export const LICENSE = "CC BY 4.0 (NeuroMorpho.Org; reuse allowed, credit as below)";

/** NeuroMorpho.Org's own terms ask for all three of these. */
export function citation(neuron) {
  const paper = neuron?.reference_doi?.length ? `doi:${neuron.reference_doi.join(", doi:")}` : neuron?.reference_pmid?.length ? `PMID ${neuron.reference_pmid.join(", ")}` : "the original paper listed on the neuron's page";
  return [
    `1. The original paper: ${paper}`,
    "2. NeuroMorpho.Org (RRID:SCR_002145)",
    "3. Tecuatl C, Ljungquist B, Ascoli GA (2024) Accelerating the continuous community sharing of digital neuromorphology data. FASEB Bioadv. 6(7):207-221. doi:10.1096/fba.2024-00048",
  ].join("\n");
}

export function parseNeuronRef(text) {
  const s = String(text).trim().replace(/^neuromorpho:/i, "");
  const link = /neuron_name=([\w.-]+)/.exec(s);
  if (link) return { name: link[1] };
  if (/^\d+$/.test(s)) return { id: Number(s) };
  return s ? { name: s } : null;
}

const list = (v) => (Array.isArray(v) ? v.join(", ") : (v ?? ""));
const pageUrl = (name) => `https://neuromorpho.org/neuron_info.jsp?neuron_name=${encodeURIComponent(name)}`;

/**
 * Searches by brain region, then cell type, then archive name. NeuroMorpho's API matches whole
 * field values, so "CA1" or "pyramidal" work and free sentences don't.
 */
export async function search(net, query, { limit = 5, species } = {}) {
  const term = String(query).trim();
  const filter = species ? `&fq=species:${encodeURIComponent(species.toLowerCase())}` : "";
  for (const field of ["brain_region", "cell_type", "archive"]) {
    let page;
    try {
      page = await net.json(`${API}/neuron/select?q=${field}:${encodeURIComponent(term)}${filter}&size=${limit}&page=0`);
    } catch (e) {
      // NeuroMorpho answers 404 when nothing matches.
      if (e instanceof NetError && /Not found|404/.test(e.message)) continue;
      throw e;
    }
    const neurons = page._embedded?.neuronResources ?? [];
    if (!neurons.length) continue;
    return {
      total: page.page?.totalElements ?? neurons.length,
      matchedOn: field.replace("_", " "),
      results: neurons.map((n) => ({
        source: "NeuroMorpho",
        id: `neuromorpho:${n.neuron_name}`,
        title: `${n.neuron_name}: ${list(n.cell_type)} in ${list(n.brain_region)}`,
        detail: [n.species, n.archive ? `${n.archive} archive` : "", n.stain, n.protocol].filter(Boolean),
        license: LICENSE,
        url: pageUrl(n.neuron_name),
      })),
    };
  }
  return { total: 0, results: [] };
}

export async function neuron(net, ref) {
  const n = ref.id !== undefined ? await net.json(`${API}/neuron/id/${ref.id}`) : await net.json(`${API}/neuron/name/${encodeURIComponent(ref.name)}`);
  let morphometry = {};
  try {
    morphometry = await net.json(`${API}/morphometry/id/${n.neuron_id}`);
  } catch (e) {
    if (!(e instanceof NetError)) throw e;
  }
  const archive = String(n.archive ?? "").toLowerCase();
  const m = morphometry;
  return {
    source: "NeuroMorpho",
    id: `neuromorpho:${n.neuron_name}`,
    title: n.neuron_name,
    url: pageUrl(n.neuron_name),
    facts: {
      Species: [n.species, n.strain].filter(Boolean).join(", "),
      "Brain region": list(n.brain_region),
      "Cell type": list(n.cell_type),
      Archive: n.archive,
      Age: [n.age_classification, n.min_age && `${n.min_age}–${n.max_age} ${n.age_scale ?? ""}`].filter(Boolean).join(", "),
      Sex: n.gender,
      Stain: n.stain,
      Protocol: n.protocol,
      "Reconstructed parts": n.domain,
      Software: n.reconstruction_software,
      Condition: list(n.experiment_condition),
    },
    morphometry: m.neuron_id
      ? {
          "Soma surface (µm²)": n.soma_surface,
          "Total surface (µm²)": m.surface,
          "Total volume (µm³)": m.volume,
          "Total length (µm)": m.length,
          Stems: m.n_stems,
          Bifurcations: m.n_bifs,
          Branches: m.n_branch,
          "Width × height × depth (µm)": [m.width, m.height, m.depth].map((x) => Number(x).toFixed(1)).join(" × "),
          "Max path distance (µm)": m.pathDistance,
          "Max branch order": m.branch_Order,
          "Fractal dimension": m.fractal_Dim,
        }
      : {},
    files: {
      "Standardized SWC": `https://neuromorpho.org/dableFiles/${encodeURIComponent(archive)}/CNG%20version/${encodeURIComponent(n.neuron_name)}.CNG.swc`,
      Image: n.png_url?.replace(/^http:/, "https:"),
    },
    license: LICENSE,
    citation: citation(n),
  };
}
