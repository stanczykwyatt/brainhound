---
name: finding-neuro-datasets
description: Find public neuroscience datasets that fit a research question, across DANDI (electrophysiology, calcium imaging, behavior in NWB), OpenNeuro (MRI, EEG, MEG, iEEG in BIDS) and NeuroMorpho (neuron reconstructions), and report each one with its license and citation. Use when someone asks for open data on a brain region, technique, species or task.
license: MIT
metadata:
  version: "0.1.0"
  author: stanczykwyatt
---

# Finding neuroscience datasets

Use the brainhound MCP tools (or the `brainhound` CLI) to search the public archives, compare a few candidates, and hand back the best ones with their license and a citation.

## Steps

1. **Turn the question into search terms.** Archives match words, not sentences. Pull out one or two of:
   - a brain region (`hippocampus`, `CA1`, `V1`, `prefrontal`)
   - a technique (`neuropixels`, `two-photon`, `calcium imaging`, `fMRI`, `EEG`)
   - a task or behavior (`place cells`, `decision making`, `sleep`)
   - a species, passed as `species` rather than in the query
2. **Search all three archives at once** with `search_datasets`. Each result has an id like `dandi:000003`, `openneuro:ds000001` or `neuromorpho:n419`.
   - NeuroMorpho matches whole field values. Give it one term that's a region (`CA1`), cell type (`pyramidal`) or lab archive name. It tries region first, then cell type, then archive.
   - If a search returns nothing, try a broader or different word (`hippocampal` vs `hippocampus`), or check the region name with `brain_region`.
3. **Check the promising ones** with `dataset_info`. Look at species, subjects, techniques, data types, size and the related paper. Prefer a published version over a draft.
4. **Look inside before recommending.** `list_files` shows what's there. For DANDI NWB files, `nwb_summary` shows what each session holds in a few seconds, without downloading it. See the `reading-remote-nwb` skill.
5. **Report** a short list. For each dataset give:
   - the id and link
   - one line on what it contains and why it fits
   - the license, word for word as brainhound gave it
   - the citation, word for word

## Licenses and credit

Always pass on the license and citation. Don't shorten or drop them.

- DANDI: each dandiset has its own license, usually CC BY 4.0 or CC0. Its citation includes a version DOI; cite the version used.
- OpenNeuro: most datasets are CC0. Cite the dataset DOI, and the paper in its "How to acknowledge" or references when given.
- NeuroMorpho.Org: CC BY 4.0. It asks for three citations: the original paper, NeuroMorpho.Org (RRID:SCR_002145), and its 2024 FASEB BioAdvances paper.
- Allen Institute content (regions from `brain_region`): research and other noncommercial use only, derivative works included. Say so if the user's use might be commercial.

## Good habits

- Don't download whole datasets to answer a question about them. DANDI files are often 1–20 GB; read only what's needed.
- Say when a dataset is a draft (unpublished, may change) or when a file is Zarr, which brainhound can't open yet.
- If an archive can't be reached, say which one, and carry on with the others.
