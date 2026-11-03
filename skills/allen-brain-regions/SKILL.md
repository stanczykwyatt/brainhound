---
name: allen-brain-regions
description: Look up and standardize brain region names with the Allen Institute's ontology (the regions of the Allen Mouse Brain Common Coordinate Framework, CCFv3, plus the human and developing mouse atlases), and pick a BrainGlobe reference atlas. Use when matching region names across datasets or papers, finding a region's acronym, id or parent regions, or choosing an atlas for registration.
license: MIT
metadata:
  version: "0.1.0"
  author: stanczykwyatt
---

# Brain regions and atlases

Labs write the same region many ways: "CA1", "field CA1", "hippocampal CA1", "dorsal CA1". The Allen ontology gives each region one acronym, one numeric id and a place in a hierarchy, so data from different sources can be lined up.

## Steps

1. **Look up the region** with `brain_region`. Give an acronym (`CA1`, `VISp`, `MOs`) or part of a name (`primary visual`). It tries an exact acronym first, then names that contain the text. It returns:
   - the acronym, full name and numeric id
   - the color used in Allen's atlas images
   - the chain of parents, such as `root > grey > CH > CTX > CTXpl > HPF > HIP > CA > CA1`
2. **Pick the species** with `species`: `mouse` (default, the CCFv3 regions), `human`, or `developing mouse`. Human atlas names differ from mouse ones; try adjectives like `hippocampal` if a noun finds nothing.
3. **Match broadly when needed.** A dataset labeled `HPF` (hippocampal formation) contains CA1, CA3, DG and more. Use the parent chain to decide whether two labels overlap, and say so rather than treating them as the same region.
4. **Choose an atlas** with `brain_atlases`. It lists BrainGlobe's atlases (mouse, rat, human, zebrafish and others) with species, voxel size and citation. Filter with words, like `allen mouse` or `zfish`.

## Using an atlas in Python

```python
# pip install brainglobe-atlasapi
from brainglobe_atlasapi import BrainGlobeAtlas

atlas = BrainGlobeAtlas("allen_mouse_25um")      # downloads the atlas once
ca1 = atlas.structures["CA1"]                      # same acronym and id as brain_region
mask = atlas.get_structure_mask("CA1")             # a 3D boolean volume
print(atlas.structure_from_coords((264, 160, 228), as_acronym=True))  # voxel coordinates
```

## Licenses and credit

- Allen Institute content may be used for research and other noncommercial purposes only, derivative works included. Flag this if the user's use could be commercial. Cite the CCFv3 paper (Wang et al., 2020, Cell) for mouse regions.
- Each BrainGlobe atlas has its own citation, which `brain_atlases` gives. Cite BrainGlobe too (Claudi et al., 2020, JOSS).
