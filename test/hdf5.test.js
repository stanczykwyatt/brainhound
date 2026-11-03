// The HDF5 reader, against small files written by h5py (scripts/make-fixtures.py): one with HDF5's
// default settings, as pynwb writes, and one in the newest format. Every value is a formula of its
// index, so any slice can be checked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { Hdf5File, Hdf5Error, describeType, reshape, fletcher32, MAX_READ_BYTES } from "../src/hdf5/hdf5.js";
import { FileSource, HttpSource } from "../src/hdf5/source.js";
import { Net } from "../src/net.js";
import { fixture, fakeFetch, BLOB } from "./helpers.mjs";

const FILES = ["earliest.nwb", "latest.nwb"];
const voltage = (row, col) => (((row * 4 + col) * 7) % 2001) - 1000;

async function read(f, p, start, count) {
  const node = await f.resolve(p);
  const info = await f.dataset(node.address);
  return { info, ...(await f.readSlice(info, start, count)) };
}

for (const name of FILES) {
  const open = () => Hdf5File.open(new FileSource(fixture(name)));

  test(`${name}: the root group's links and attributes`, async () => {
    const f = await open();
    assert.deepEqual(
      (await f.links(f.rootAddress)).map((l) => l.name),
      ["acquisition", "extra", "general", "identifier", "intervals", "processing", "session_description", "session_start_time", "units"],
    );
    assert.deepEqual(await f.attributes(f.rootAddress), { namespace: "core", neurodata_type: "NWBFile", nwb_version: "2.8.0" });
  });

  test(`${name}: variable-length strings, scalar and in arrays`, async () => {
    const f = await open();
    assert.deepEqual((await read(f, "/session_description")).values, ["Made-up session for tests"]);
    assert.deepEqual((await read(f, "/general/extracellular_ephys/electrodes/location")).values, ["CA1", "CA1", "DG", "CA3"]);
    assert.deepEqual((await read(f, "/units/quality", [1], [3])).values, ["noise", "good", "mua"]);
  });

  test(`${name}: a chunked, shuffled, gzip-compressed slice matches its formula`, async () => {
    const f = await open();
    const { info, values, shape } = await read(f, "/acquisition/ElectricalSeries/data", [19990, 1], [10, 3]);
    assert.equal(describeType(info.type), "int16");
    assert.deepEqual(info.space.dims, [20000, 4]);
    assert.deepEqual(info.filters.map((x) => x.name), ["shuffle", "gzip"]);
    assert.deepEqual(shape, [10, 3]);
    const expected = [];
    for (let r = 19990; r < 20000; r++) for (let c = 1; c < 4; c++) expected.push(voltage(r, c));
    assert.deepEqual(values, expected);
  });

  test(`${name}: slices that cross chunk edges, in every direction`, async () => {
    const f = await open();
    for (const [start, count] of [
      [[0, 0], [1, 4]],
      [[63, 0], [2, 4]],
      [[127, 3], [130, 1]],
      [[5000, 2], [1, 1]],
    ]) {
      const { values } = await read(f, "/acquisition/ElectricalSeries/data", start, count);
      const expected = [];
      for (let r = start[0]; r < start[0] + count[0]; r++) for (let c = start[1]; c < start[1] + count[1]; c++) expected.push(voltage(r, c));
      assert.deepEqual(values, expected, `start ${start} count ${count}`);
    }
  });

  test(`${name}: a 3-D chunked dataset with partial edge chunks`, async () => {
    const f = await open();
    const { values } = await read(f, "/extra/cube", [1, 2, 3], [3, 3, 3]);
    const expected = [];
    for (let i = 1; i < 4; i++) for (let j = 2; j < 5; j++) for (let k = 3; k < 6; k++) expected.push(i * 30 + j * 6 + k);
    assert.deepEqual(values, expected);
    assert.deepEqual((await read(f, "/extra/cube")).values, Array.from({ length: 120 }, (_, i) => i));
  });

  test(`${name}: contiguous, compact, big-endian, 64-bit and float data`, async () => {
    const f = await open();
    assert.deepEqual((await read(f, "/extra/big_endian")).values, [0, 1, 2, 3, 4, 5]);
    assert.deepEqual((await read(f, "/extra/big_endian", [1, 1], [1, 2])).values, [4, 5]);
    assert.deepEqual((await read(f, "/extra/compact")).values, [0, 1, 2, 3]);
    assert.deepEqual((await read(f, "/extra/scalar_int")).values, [-42]);
    // Numbers past 2^53 stay exact, as text.
    assert.deepEqual((await read(f, "/extra/uint64")).values, [0, "9007199254740993", "18446744073709551615"]);
    assert.deepEqual((await read(f, "/extra/float32")).values, [0, 0.25, 0.5, 0.75, 1]);
    assert.deepEqual((await read(f, "/acquisition/ElectricalSeries/timestamps", [19998], [2])).values, [19998 / 30000, 19999 / 30000]);
  });

  test(`${name}: fixed strings, booleans, compounds and empty datasets`, async () => {
    const f = await open();
    assert.deepEqual((await read(f, "/extra/fixed_strings")).values, ["ab", "cde", "f"]);
    assert.deepEqual((await read(f, "/extra/bools")).values, [true, false, true]);
    const c = await read(f, "/extra/compound");
    assert.deepEqual(c.values, [
      { t: 0.1, label: "go", n: 1 },
      { t: 0.2, label: "stop", n: -2 },
      { t: 0.3, label: "wait", n: 3 },
    ]);
    assert.match(describeType(c.info.type), /^compound\{t: float64, label: str/);
    assert.deepEqual((await read(f, "/extra/empty")).values, []);
  });

  test(`${name}: fletcher32 checksums, extendable datasets and fill values`, async () => {
    const f = await open();
    assert.deepEqual((await read(f, "/extra/checksummed", [95], [5])).values, [95, 96, 97, 98, 99]);
    assert.deepEqual((await read(f, "/extra/partial")).values, Array.from({ length: 10 }, (_, i) => i));
    assert.deepEqual((await read(f, "/extra/unwritten")).values, [9, 9, 9]);
  });

  test(`${name}: UTF-8 text stays UTF-8, in datasets and attributes`, async () => {
    const f = await open();
    assert.deepEqual((await read(f, "/extra/utf8")).values, ["µV", "Buzsáki", "海马"]);
    assert.equal((await f.attributes((await f.resolve("/extra")).address)).unit_text, "µV");
  });

  test(`${name}: a chunked dataset that was never written reads as its fill value`, async () => {
    const f = await open();
    assert.deepEqual((await read(f, "/extra/unwritten_chunked", [1], [4])).values, [7, 7, 7, 7]);
  });

  test(`${name}: object references become paths`, async () => {
    const f = await open();
    const { values } = await read(f, "/general/extracellular_ephys/electrodes/group");
    assert.deepEqual(values, Array(4).fill({ ref: "/general/extracellular_ephys/shank0" }));
  });

  test(`${name}: soft links resolve, and big groups list every child`, async () => {
    const f = await open();
    assert.deepEqual((await read(f, "/extra/soft/quality", [0], [1])).values, ["good"]);
    const extra = await f.links((await f.resolve("/extra")).address);
    assert.deepEqual(extra.find((l) => l.name === "soft"), { name: "soft", soft: "/units" });
    const behavior = await f.links((await f.resolve("/processing/behavior")).address);
    assert.deepEqual(behavior.map((l) => l.name), Array.from({ length: 40 }, (_, i) => `trace_${String(i).padStart(2, "0")}`));
    assert.deepEqual((await read(f, "/processing/behavior/trace_39")).values, [39, 40, 41]);
  });

  test(`${name}: many attributes, sorted, of several types`, async () => {
    const f = await open();
    const attrs = await f.attributes((await f.resolve("/extra/many_attrs")).address);
    assert.deepEqual(Object.keys(attrs), [...Array.from({ length: 12 }, (_, i) => `a${String(i).padStart(2, "0")}`), "text", "vec"]);
    assert.equal(attrs.a11, 11);
    assert.equal(attrs.text, "hello");
    assert.deepEqual(attrs.vec, [1.5, 2.5]);
    const data = await f.attributes((await f.resolve("/acquisition/ElectricalSeries/data")).address);
    assert.equal(data.unit, "volts");
    assert.ok(Math.abs(data.conversion - 1.95e-7) < 1e-12);
  });

  test(`${name}: clear errors for wrong paths and slices`, async () => {
    const f = await open();
    await assert.rejects(f.resolve("/nope"), /Nothing is called "nope" in \//);
    await assert.rejects(f.resolve("/session_description/x"), /is a dataset, not a group/);
    const info = await f.dataset((await f.resolve("/extra/cube")).address);
    await assert.rejects(f.readSlice(info, [0, 0], [1, 1]), /has 3 dimensions/);
    await assert.rejects(f.readSlice(info, [3, 0, 0], [2, 1, 1]), /Dimension 0 has 4 entries/);
    await assert.rejects(f.readSlice(info, [0, 0, -1], [1, 1, 1]), Hdf5Error);
    await assert.rejects(f.dataset((await f.resolve("/units")).address), /isn't a dataset/);
  });
}

test("both files give identical answers for every dataset", async () => {
  const a = await Hdf5File.open(new FileSource(fixture("earliest.nwb")));
  const b = await Hdf5File.open(new FileSource(fixture("latest.nwb")));
  assert.equal(a.superblockVersion, 0);
  assert.equal(b.superblockVersion, 3);
  const walk = async (f, address, prefix, out) => {
    for (const link of await f.links(address)) {
      if (link.address === undefined) continue;
      const p = `${prefix}/${link.name}`;
      if ((await f.kindOf(link.address)) === "group") await walk(f, link.address, p, out);
      else {
        const info = await f.dataset(link.address);
        out[p] = info.space.dims.reduce((x, y) => x * y, 1) <= 1000 ? (await f.readSlice(info)).values : info.space.dims;
      }
    }
    return out;
  };
  const left = await walk(a, a.rootAddress, "", {});
  const right = await walk(b, b.rootAddress, "", {});
  assert.deepEqual(left, right);
  assert.ok(Object.keys(left).length > 70);
});

test("the two files really use different index structures", async () => {
  const kinds = async (name) => {
    const f = await Hdf5File.open(new FileSource(fixture(name)));
    const out = {};
    for (const p of ["/acquisition/ElectricalSeries/data", "/extra/partial", "/extra/cube"]) out[p] = (await f.dataset((await f.resolve(p)).address)).layout.index;
    return out;
  };
  assert.deepEqual(Object.values(await kinds("earliest.nwb")), ["btree1", "btree1", "btree1"]);
  assert.deepEqual(Object.values(await kinds("latest.nwb")), ["fixed", "extensible", "fixed"]);
});

test("files that aren't HDF5 are refused plainly", async () => {
  await assert.rejects(Hdf5File.open(new FileSource(fixture("not-hdf5.bin"))), /isn't an HDF5 file/);
  const dir = mkdtempSync(path.join(tmpdir(), "brainhound-"));
  writeFileSync(path.join(dir, "tiny"), "x");
  await assert.rejects(Hdf5File.open(new FileSource(path.join(dir, "tiny"))), /isn't an HDF5 file/);
});

test("a file behind a 512-byte user block still opens", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "brainhound-"));
  const original = readFileSync(fixture("latest.nwb"));
  // Shift a v2+ file by a user block: its addresses are relative to the superblock, which a
  // proper base address of 512 accounts for. Patch the base address field to 512.
  const shifted = Buffer.concat([Buffer.alloc(512), original]);
  shifted.writeBigUInt64LE(512n, 512 + 12);
  // The superblock checksum isn't checked by this reader, so the patched copy is enough for the test.
  writeFileSync(path.join(dir, "u.nwb"), shifted);
  const f = await Hdf5File.open(new FileSource(path.join(dir, "u.nwb")));
  assert.equal(f.base, 512);
  assert.deepEqual((await read(f, "/extra/compact")).values, [0, 1, 2, 3]);
});

test("damaged bytes give an error, not a crash or a hang", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "brainhound-"));
  const original = readFileSync(fixture("earliest.nwb"));
  let errors = 0;
  // Overwrite a stretch at many places and make sure every read either works or throws an Hdf5Error/RangeError.
  for (let at = 96; at < 20000; at += 997) {
    const broken = Buffer.from(original);
    broken.fill(0xab, at, at + 24);
    const file = path.join(dir, `b${at}.nwb`);
    writeFileSync(file, broken);
    try {
      const f = await Hdf5File.open(new FileSource(file));
      await read(f, "/acquisition/ElectricalSeries/data", [0, 0], [64, 4]);
      await f.attributes((await f.resolve("/extra/many_attrs")).address);
    } catch (e) {
      assert.ok(e instanceof Hdf5Error || e instanceof RangeError, `at ${at}: ${e.stack}`);
      errors++;
    }
  }
  assert.ok(errors > 0);
});

test("over HTTP, a slice costs a few small range requests, not the file", async () => {
  const log = [];
  const net = new Net({ fetch: fakeFetch({ log }), gap: 0 });
  const source = new HttpSource(BLOB, net);
  const f = await Hdf5File.open(source);
  const { values } = await read(f, "/acquisition/ElectricalSeries/data", [10000, 0], [3, 4]);
  assert.deepEqual(values, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => voltage(10000 + Math.floor(i / 4), i % 4)));
  assert.ok(log.every((r) => /^bytes=\d+-\d+$/.test(r.range)), "every request is a range request");
  assert.ok(source.bytes < readFileSync(fixture("earliest.nwb")).length, `read ${source.bytes} bytes`);
  assert.ok(source.requests <= 8, `${source.requests} requests`);
  assert.equal(log[0].headers["user-agent"].split("/")[0], "brainhound");
});

test("over HTTP, a server that ignores ranges is used only for a small file", async () => {
  const net = new Net({ fetch: fakeFetch({ ignoreRange: true }), gap: 0 });
  const f = await Hdf5File.open(new HttpSource(BLOB, net));
  assert.deepEqual((await read(f, "/extra/compact")).values, [0, 1, 2, 3]);
  const big = new Net({ fetch: fakeFetch({ ignoreRange: "huge" }), gap: 0 });
  await assert.rejects(Hdf5File.open(new HttpSource(BLOB, big)), /doesn't answer range requests/);
});

test("huge reads are refused before anything is fetched", async () => {
  const f = await Hdf5File.open(new FileSource(fixture("earliest.nwb")));
  const info = await f.dataset((await f.resolve("/extra/cube")).address);
  const fake = { ...info, space: { ...info.space, dims: [1e6, 1e3, 1e3] } };
  await assert.rejects(f.readSlice(fake, [0, 0, 0], [1e5, 1e3, 1e3]), /ask for at most 10000000/);
  assert.ok(MAX_READ_BYTES >= 64 * 1024 * 1024);
});

test("reshape nests flat values row by row", () => {
  assert.deepEqual(reshape([1, 2, 3, 4, 5, 6], [2, 3]), [
    [1, 2, 3],
    [4, 5, 6],
  ]);
  assert.deepEqual(reshape([1, 2, 3, 4], [2, 1, 2]), [[[1, 2]], [[3, 4]]]);
  assert.deepEqual(reshape([7], [1]), [7]);
});

test("a chunk that inflates past its size is refused, not unpacked", async () => {
  const f = await Hdf5File.open(new FileSource(fixture("earliest.nwb")));
  const bomb = deflateSync(Buffer.alloc(20 * 1024 * 1024));
  assert.throws(() => f.unfilter(bomb, [{ id: 1, name: "gzip", params: [] }], 0, 64, 1), /inflates past its size/);
});

test("fletcher32 matches HDF5, and a damaged checksummed chunk is caught", async () => {
  // Known values: HDF5's checksum of these bytes, as its own test suite computes it.
  assert.equal(fletcher32(Buffer.from([])), 0);
  assert.equal(fletcher32(Buffer.from([0x01, 0x02])), (0x0102 << 16 | 0x0102) >>> 0);
  const f = await Hdf5File.open(new FileSource(fixture("earliest.nwb")));
  const info = await f.dataset((await f.resolve("/extra/checksummed")).address);
  const [chunk] = await f.chunksFor(info, [0], [10]);
  const bytes = Buffer.from(readFileSync(fixture("earliest.nwb")));
  bytes[f.base + chunk.address + 2] ^= 0xff;
  const dir = mkdtempSync(path.join(tmpdir(), "brainhound-"));
  writeFileSync(path.join(dir, "bad.nwb"), bytes);
  const g = await Hdf5File.open(new FileSource(path.join(dir, "bad.nwb")));
  const bad = await g.dataset((await g.resolve("/extra/checksummed")).address);
  await assert.rejects(g.readSlice(bad, [0], [10]), /checksum doesn't match/);
  assert.deepEqual((await g.readSlice(bad, [10], [3])).values, [10, 11, 12], "other chunks still read");
});

test("a damaged length can't make a local read allocate past the file", async () => {
  await assert.rejects(new FileSource(fixture("earliest.nwb")).read(0, 4e9), /file ends before/);
});
