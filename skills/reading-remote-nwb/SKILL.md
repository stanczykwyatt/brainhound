---
name: reading-remote-nwb
description: Explore and read NWB (Neurodata Without Borders) files on the DANDI Archive without downloading them, using range requests. Covers finding a session's data, reading slices of time series in physical units, and reading NWB tables such as units, trials and electrodes, including ragged columns like spike times. Use when someone wants to inspect, sample or analyze an NWB file.
license: MIT
metadata:
  version: "0.1.0"
  author: stanczykwyatt
---

# Reading NWB files remotely

NWB files are HDF5 underneath and often several gigabytes. brainhound reads only the bytes a question needs, so looking inside a 10 GB file costs about a megabyte.

## Steps

1. **Find the file.** `list_files` with a DANDI id gives paths. Refer to a file as `dandi:<dandiset>/<path>`, for example `dandi:000003/sub-YutaMouse20/sub-YutaMouse20_ses-YutaMouse20-140327_behavior+ecephys.nwb`.
2. **Get the overview** with `nwb_summary`: session, subject, devices, electrodes, units, and every acquisition, stimulus, interval and processing entry with its NWB type and shape.
3. **Drill down** with `nwb_tree`, giving a `path` like `/processing/ecephys` and a `depth`. It shows each dataset's shape, dtype and its `unit`, `rate` and `conversion` attributes.
4. **Read numbers** with `nwb_read`: give the dataset `path`, plus `start` and `count` per dimension. Without them it reads a small corner. The stats line covers the whole slice, even when only part of it is printed.
5. **Read tables** with `nwb_table`: `/units`, `/intervals/trials`, `/general/extracellular_ephys/electrodes`, or any DynamicTable. Pick `columns`, and page with `start` and `count`.

## NWB conventions you need

- **Units.** A TimeSeries stores raw numbers. The value in its `unit` is `data * conversion + offset`. For example, int16 data with `conversion=1.95e-7` and `unit=volts` means each step is 0.195 µV.
- **Time.** A TimeSeries has either a `timestamps` dataset (one time per sample, in seconds) or `starting_time` with a `rate` attribute (Hz). Sample `i` is at `starting_time + i / rate`.
- **Axes.** The first dimension of `data` is time. For extracellular recordings the second is channels, in the order of the `electrodes` region (`data/../electrodes`, a list of row numbers into the electrodes table).
- **Ragged columns.** A column `x` with a sibling `x_index` is ragged: row `i` holds `x[x_index[i-1]:x_index[i]]` (from 0 for the first row). `/units/spike_times` works this way. `nwb_table` follows this for you, and summarizes long cells as a count plus the first values.
- **References.** Columns like `electrodes/group` point at other objects. brainhound shows them as paths, such as `</general/extracellular_ephys/shank0>`.
- **Containers.** Types like `LFP`, `Position` and `BehavioralEvents` hold one or more series inside them. Look one level down for the data.

## Sizing reads

- Ask for what the question needs: a few seconds of one channel, not the whole recording. At 30 kHz, one second is 30000 rows.
- One call reads at most 128 MB of raw data. For more, read in pieces or use Python (below).
- Reading a narrow column across many rows of a big uncompressed array touches most of the file between them. Prefer contiguous blocks of rows.

## When you need full analysis in Python

brainhound is for exploring and sampling. For heavy analysis, stream the file with the standard tools. This reads lazily too:

```python
# pip install pynwb remfile h5py dandi
import h5py, remfile, pynwb
from dandi.dandiapi import DandiAPIClient

with DandiAPIClient() as client:
    asset = client.get_dandiset("000003").get_asset_by_path("sub-YutaMouse20/sub-YutaMouse20_ses-YutaMouse20-140327_behavior+ecephys.nwb")
    url = asset.get_content_url(follow_redirects=1, strip_query=True)

io = pynwb.NWBHDF5IO(file=h5py.File(remfile.File(url), "r"), load_namespaces=True)
nwb = io.read()
spikes = nwb.units["spike_times"][0]  # one unit's spike times, in seconds
```

Always give the dandiset's license and citation (from `dataset_info`) with any result built on its data.
