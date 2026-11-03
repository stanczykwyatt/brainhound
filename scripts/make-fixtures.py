# Makes the small HDF5 files in test/fixtures. They're committed, so the tests don't need Python;
# run this only to change them: python3 scripts/make-fixtures.py (needs h5py and numpy).
#
# Every value is a formula of its index, so the tests can check any slice without a copy of the data.
import os
import h5py
import numpy as np

here = os.path.join(os.path.dirname(__file__), "..", "test", "fixtures")
os.makedirs(here, exist_ok=True)
vlen = h5py.string_dtype()


def nwb_like(path, libver):
    """A file shaped like a small NWB recording, written with h5py's defaults or the newest format."""
    with h5py.File(path, "w", libver=libver) as f:
        f.attrs["neurodata_type"] = "NWBFile"
        f.attrs["namespace"] = "core"
        f.attrs["nwb_version"] = "2.8.0"
        f.create_dataset("session_description", data="Made-up session for tests", dtype=vlen)
        f.create_dataset("identifier", data="fixture-0001", dtype=vlen)
        f.create_dataset("session_start_time", data="2026-01-02T03:04:05-06:00", dtype=vlen)

        general = f.create_group("general")
        subject = general.create_group("subject")
        subject.attrs["neurodata_type"] = "Subject"
        subject.create_dataset("species", data="Mus musculus", dtype=vlen)
        subject.create_dataset("subject_id", data="mouse-7", dtype=vlen)
        subject.create_dataset("age", data="P90D", dtype=vlen)
        subject.create_dataset("sex", data="F", dtype=vlen)
        devices = general.create_group("devices")
        probe = devices.create_group("probe0")
        probe.attrs["neurodata_type"] = "Device"
        probe.attrs["description"] = "A made-up four-channel probe"

        ephys = general.create_group("extracellular_ephys")
        shank = ephys.create_group("shank0")
        shank.attrs["neurodata_type"] = "ElectrodeGroup"
        shank.attrs["description"] = "shank zero"
        electrodes = ephys.create_group("electrodes")
        electrodes.attrs["neurodata_type"] = "DynamicTable"
        electrodes.attrs["colnames"] = np.array(["location", "group", "x"], dtype=object)
        electrodes.attrs["description"] = "metadata about extracellular electrodes"
        electrodes.create_dataset("id", data=np.arange(4, dtype=np.int64))
        electrodes.create_dataset("location", data=np.array(["CA1", "CA1", "DG", "CA3"], dtype=object), dtype=vlen)
        electrodes.create_dataset("group", data=[shank.ref] * 4, dtype=h5py.ref_dtype)
        electrodes.create_dataset("x", data=np.array([0.5, 1.5, 2.5, 3.5]))

        acquisition = f.create_group("acquisition")
        series = acquisition.create_group("ElectricalSeries")
        series.attrs["neurodata_type"] = "ElectricalSeries"
        series.attrs["description"] = "raw voltage"
        # Chunked, shuffled and compressed, with more chunks than one B-tree node holds.
        n = 20000
        data = (np.arange(n * 4, dtype=np.int64).reshape(n, 4) * 7 % 2001 - 1000).astype(np.int16)
        d = series.create_dataset("data", data=data, chunks=(64, 4), compression="gzip", shuffle=True)
        d.attrs["unit"] = "volts"
        d.attrs["conversion"] = np.float32(1.95e-7)
        series.create_dataset("starting_time", data=np.float64(1.25)).attrs["rate"] = np.float64(30000.0)
        series.create_dataset("timestamps", data=np.arange(n, dtype=np.float64) / 30000.0)

        units = f.create_group("units")
        units.attrs["neurodata_type"] = "Units"
        units.attrs["colnames"] = np.array(["spike_times", "quality"], dtype=object)
        units.attrs["description"] = "made-up units"
        units.create_dataset("id", data=np.arange(5, dtype=np.int64))
        counts = [3, 0, 5, 1, 4]
        spikes = np.concatenate([np.arange(c) * 0.5 + u for u, c in enumerate(counts)]).astype(np.float64)
        units.create_dataset("spike_times", data=spikes)
        units.create_dataset("spike_times_index", data=np.cumsum(counts).astype(np.uint32))
        units.create_dataset("quality", data=np.array(["good", "noise", "good", "mua", "good"], dtype=object), dtype=vlen)

        trials = f.create_group("intervals/trials")
        trials.attrs["neurodata_type"] = "TimeIntervals"
        trials.attrs["colnames"] = np.array(["start_time", "stop_time", "events"], dtype=object)
        trials.attrs["description"] = "made-up trials"
        trials.create_dataset("id", data=np.arange(3, dtype=np.int64))
        trials.create_dataset("start_time", data=np.array([0.0, 10.0, 20.0]))
        trials.create_dataset("stop_time", data=np.array([9.0, 19.0, 29.0]))
        # One long ragged cell, the way a unit's spike times are long.
        lengths = [2, 30, 1]
        trials.create_dataset("events", data=np.arange(sum(lengths), dtype=np.float64) / 4)
        trials.create_dataset("events_index", data=np.cumsum(lengths).astype(np.uint8))

        # Enough children to split the group's index across several nodes.
        behavior = f.create_group("processing/behavior")
        behavior.attrs["neurodata_type"] = "ProcessingModule"
        for i in range(40):
            behavior.create_dataset(f"trace_{i:02d}", data=np.arange(3, dtype=np.float32) + i)

        extra = f.create_group("extra")
        extra.create_dataset("scalar_int", data=np.int32(-42))
        extra.create_dataset("big_endian", data=np.arange(6, dtype=">i4").reshape(2, 3))
        extra.create_dataset("uint64", data=np.array([0, 2**53 + 1, 2**64 - 1], dtype=np.uint64))
        extra.create_dataset("float32", data=np.linspace(0, 1, 5, dtype=np.float32))
        extra.create_dataset("fixed_strings", data=np.array([b"ab", b"cde", b"f"], dtype="S3"))
        extra.create_dataset("bools", data=np.array([True, False, True]))
        dcpl = h5py.h5p.create(h5py.h5p.DATASET_CREATE)
        dcpl.set_layout(h5py.h5d.COMPACT)
        space = h5py.h5s.create_simple((4,))
        compact = h5py.h5d.create(extra.id, b"compact", h5py.h5t.STD_I16LE, space, dcpl=dcpl)
        compact.write(h5py.h5s.ALL, h5py.h5s.ALL, np.arange(4, dtype=np.int16))
        compound = np.zeros(3, dtype=[("t", "<f8"), ("label", "S4"), ("n", "<i2")])
        compound["t"] = [0.1, 0.2, 0.3]
        compound["label"] = [b"go", b"stop", b"wait"]
        compound["n"] = [1, -2, 3]
        extra.create_dataset("compound", data=compound)
        extra.create_dataset("empty", data=h5py.Empty("f"))
        extra.create_dataset("checksummed", data=np.arange(100, dtype=np.int32), chunks=(10,), fletcher32=True)
        extra.create_dataset("cube", data=np.arange(4 * 5 * 6, dtype=np.float64).reshape(4, 5, 6), chunks=(3, 2, 4), compression="gzip")
        extra.create_dataset("partial", data=np.arange(10, dtype=np.int32), chunks=(4,), maxshape=(None,))
        extra.create_dataset("unwritten", shape=(3,), dtype=np.int32, fillvalue=9)
        extra["soft"] = h5py.SoftLink("/units")
        # Text beyond ASCII, as units and author names often are.
        extra.create_dataset("utf8", data=np.array(["µV", "Buzsáki", "海马"], dtype=object), dtype=vlen)
        extra.attrs["unit_text"] = "µV"
        # Chunked but never written: reads give the fill value.
        extra.create_dataset("unwritten_chunked", shape=(6,), dtype=np.int16, chunks=(2,), fillvalue=7)
        many = extra.create_group("many_attrs")
        for i in range(12):
            many.attrs[f"a{i:02d}"] = i
        many.attrs["text"] = "hello"
        many.attrs["vec"] = np.array([1.5, 2.5])


nwb_like(os.path.join(here, "earliest.nwb"), "earliest")
nwb_like(os.path.join(here, "latest.nwb"), "latest")

with open(os.path.join(here, "not-hdf5.bin"), "wb") as f:
    f.write(b"this is not an HDF5 file" * 10)

print("wrote", sorted(os.listdir(here)))
