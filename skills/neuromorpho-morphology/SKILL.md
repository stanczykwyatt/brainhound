---
name: neuromorpho-morphology
description: Find and compare digital neuron reconstructions on NeuroMorpho.Org by brain region, cell type, species or lab, read their morphometry (length, branching, surface, volume), and get their SWC files and required citations. Use for questions about dendritic or axonal shape, or when someone needs real neuron morphologies for analysis or modeling.
license: MIT
metadata:
  version: "0.1.0"
  author: stanczykwyatt
---

# Neuron morphology from NeuroMorpho.Org

NeuroMorpho.Org holds hundreds of thousands of traced neurons, each with metadata and standard morphometry.

## Steps

1. **Search** with `search_datasets`, `sources: ["neuromorpho"]`. Give one term: a brain region (`CA1`, `neocortex`), a cell type (`pyramidal`, `Purkinje`) or a lab's archive name. Narrow by `species` (`mouse`, `rat`, `human`). The first line says how many neurons match.
2. **Open a neuron** with `neuron_morphology`, by name (`n419`) or numeric id. It gives:
   - species, strain, region, cell type, age, sex, stain, protocol and which parts were traced
   - morphometry: total length, surface, volume, stems, bifurcations, branches, size, maximum path distance and branch order, fractal dimension
   - links to the standardized SWC file and a picture
3. **Compare fairly.** Check "Reconstructed parts" before comparing lengths: a neuron traced as "Dendrites, Soma, No Axon" can't be compared on axon length. Also check protocol (in vivo vs in vitro), slice thickness and shrinkage correction, which change measured sizes.

## Working with SWC files

SWC is a plain text format: one point per line with `id type x y z radius parent`. Type 1 is soma, 2 axon, 3 basal dendrite, 4 apical dendrite. The "standardized" (CNG) version has its soma at the origin and consistent units (µm).

```python
# Total dendritic length from an SWC file, no libraries needed.
import math, urllib.request

url = "https://neuromorpho.org/dableFiles/turner/CNG%20version/n419.CNG.swc"
points = {}
for line in urllib.request.urlopen(url).read().decode().splitlines():
    if line.strip() and not line.startswith("#"):
        i, t, x, y, z, r, parent = line.split()[:7]
        points[int(i)] = (int(t), float(x), float(y), float(z), int(parent))

length = sum(
    math.dist(p[1:4], points[p[4]][1:4])
    for p in points.values()
    if p[4] in points and p[0] in (3, 4)
)
print(f"dendritic length: {length:.0f} µm")
```

For full analysis, the NeuroM and navis Python packages read SWC files directly.

## Licenses and credit

NeuroMorpho.Org content is CC BY 4.0. Its terms ask for all three of these whenever its material is used:

1. the original paper that describes the reconstructions (brainhound gives its DOI or PubMed id)
2. NeuroMorpho.Org (RRID:SCR_002145)
3. Tecuatl C, Ljungquist B, Ascoli GA (2024) Accelerating the continuous community sharing of digital neuromorphology data. FASEB Bioadv. 6(7):207-221.

`neuron_morphology` prints all three. Pass them on unchanged.
