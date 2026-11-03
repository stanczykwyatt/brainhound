// The tools, end to end, against recorded archive answers (fixtures/api.json) and the local test
// NWB file standing in for a DANDI file. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, symlinkSync, copyFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hound, ToolError, show } from "../src/tools.js";
import { Net, NetError, checkUrl, HOSTS } from "../src/net.js";
import { parseDandiId } from "../src/sources/dandi.js";
import { parseOpenNeuroId } from "../src/sources/openneuro.js";
import { parseNeuronRef } from "../src/sources/neuromorpho.js";
import { testNet, fixture, fakeFetch } from "./helpers.mjs";
import { NWB_ASSET } from "./calls.mjs";

const hound = ({ net, ...options } = {}) => new Hound({ net: testNet(net), ...options });

test("search covers all three archives, each result with an id and a license", async () => {
  const text = await hound().search({ query: "hippocampus", limit: 2 });
  assert.match(text, /^## DANDI: \d+ matches, showing 2$/m);
  assert.match(text, /^## OpenNeuro: \d+ matches, showing 2$/m);
  assert.match(text, /^## NeuroMorpho: \d+ matches by brain region, showing 2$/m);
  assert.match(text, /^- dandi:000003 {2}Physiological Properties/m);
  assert.match(text, /^- openneuro:ds\d{6} /m);
  assert.match(text, /^- neuromorpho:n419 /m);
  const ids = text.match(/^- \S+/gm).length;
  const licenses = text.match(/^ {2}License: /gm).length;
  assert.equal(licenses, ids, "every result has a license line");
});

test("NeuroMorpho search narrows by species, and says so when nothing matches", async () => {
  const text = await hound().search({ query: "CA1", sources: ["neuromorpho"], species: "mouse", limit: 2 });
  assert.match(text, /mouse/);
  assert.doesNotMatch(text, /DANDI|OpenNeuro/);
  assert.match(await hound().search({ query: "zzzznotathing", sources: ["neuromorpho"], limit: 2 }), /NeuroMorpho: 0 matches/);
});

test("search refuses empty queries and unknown archives", async () => {
  await assert.rejects(hound().search({ query: " " }), ToolError);
  await assert.rejects(hound().search({ query: "x", sources: ["dandi", "github"] }), /Unknown source: github/);
});

test("one archive failing doesn't hide the others", async () => {
  const broken = new Net({
    gap: 0,
    fetch: (url, init) => (url.includes("openneuro") ? Promise.reject(new Error("offline")) : fakeFetch()(url, init)),
  });
  const text = await new Hound({ net: broken }).search({ query: "hippocampus", limit: 2 });
  assert.match(text, /## OpenNeuro: couldn't search \(Couldn't reach openneuro\.org/);
  assert.match(text, /## DANDI: \d+ matches/);
});

test("dataset_info gives the description, license and DANDI's own citation", async () => {
  const text = await hound().datasetInfo({ id: "dandi:000003" });
  assert.match(text, /^# Physiological Properties and Behavioral Correlates/m);
  assert.match(text, /^Species: House mouse$/m);
  assert.match(text, /^License: CC BY 4\.0/m);
  assert.match(text, /^Cite as: Senzai, Yuta; .*https:\/\/doi\.org\/10\.48324\/dandi\.000003\//m);
  assert.match(text, /IsDescribedBy: doi:10\.1016\/j\.neuron\.2016\.12\.011/);
});

test("dataset_info builds an OpenNeuro citation with authors, year and DOI", async () => {
  for (const id of ["openneuro:ds000001", "openneuro:ds000001/1.0.0"]) {
    const text = await hound().datasetInfo({ id });
    assert.match(text, /^# Balloon Analog Risk-taking Task/m);
    assert.match(text, /^License: CC0$/m);
    assert.match(text, /^Cite as: Tom Schonberg, Christopher Trepel, Craig Fox, Russell A\. Poldrack \(2020\)\. Balloon Analog Risk-taking Task\. OpenNeuro\. \[Dataset\] doi:10\.18112\/openneuro\.ds000001\.v1\.0\.0$/m);
  }
});

test("dataset_info sends NeuroMorpho ids to the neuron tool, and refuses unknown ids", async () => {
  assert.match(await hound().datasetInfo({ id: "neuromorpho:n419" }), /^# n419/m);
  await assert.rejects(hound().datasetInfo({ id: "github:foo" }), /Not a dataset id/);
  await assert.rejects(hound().datasetInfo({ id: "" }), ToolError);
});

test("list_files pages DANDI assets and walks OpenNeuro folders", async () => {
  const d = await hound().listFiles({ id: "dandi:000003", limit: 3 });
  assert.match(d, /^101 files in dandi:000003 version 0\.260218\.2052; showing 1–3$/m);
  assert.match(d, /^Open one with nwb_summary, for example: dandi:000003\/sub-YutaMouse20\//m);
  assert.match(d, /More: call again with offset 3\./);
  const o = await hound().listFiles({ id: "openneuro:ds000001", limit: 5 });
  assert.match(o, /in openneuro:ds000001 version 1\.0\.0; showing 1–5/);
  assert.match(o, /^sub-01\/$/m, "folders first, with a slash");
  assert.doesNotMatch(o, /\.datalad/, "hidden entries are skipped");
  const anat = await hound().listFiles({ id: "openneuro:ds000001", path: "sub-01/anat" });
  assert.match(anat, /^sub-01\/anat\/sub-01_T1w\.nii\.gz {2}\d/m);
  await assert.rejects(hound().listFiles({ id: "neuromorpho:n419" }), /one file each/);
});

test("nwb_summary reads a DANDI file by range requests and describes it", async () => {
  const log = [];
  const text = await hound({ net: { log } }).nwbSummary({ asset: NWB_ASSET });
  assert.match(text, /^# dandi:000003\/sub-YutaMouse20\//m);
  assert.match(text, /^NWB version: 2\.8\.0$/m);
  assert.match(text, /^Session: Made-up session for tests$/m);
  assert.match(text, /^Subject: species: Mus musculus, subject_id: mouse-7, age: P90D, sex: F$/m);
  assert.match(text, /^Devices: probe0$/m);
  assert.match(text, /^Electrodes: 4, in CA1, DG, CA3$/m);
  assert.match(text, /^Units: 5, columns spike_times, quality$/m);
  assert.match(text, /^ {2}\/acquisition\/ElectricalSeries \(ElectricalSeries\) {2}data: \[20000 × 4\] int16$/m);
  assert.match(text, /^Processing\/behavior:$/m);
  assert.match(text, /\(read .* in \d+ range requests? so far; the file was not downloaded\)/);
  const ranged = log.filter((r) => r.range);
  assert.ok(ranged.length > 0 && ranged.every((r) => r.url.startsWith("https://dandiarchive.s3.amazonaws.com/blobs/")));
});

test("nwb_tree shows types, shapes, units and links, to the depth asked", async () => {
  const h = hound();
  const top = await h.nwbTree({ asset: NWB_ASSET, depth: 1 });
  assert.match(top, /^\/ {2}\(NWBFile\)$/m);
  assert.match(top, /^ {2}session_description {2}scalar str$/m);
  assert.doesNotMatch(top, /ElectricalSeries/);
  const deep = await h.nwbTree({ asset: NWB_ASSET, path: "/acquisition", depth: 3 });
  assert.match(deep, /^ {4}data {2}\[20000 × 4\] int16 {2}unit=volts conversion=1\.95e-7$/m);
  assert.match(deep, /^ {4}starting_time {2}scalar float64 {2}rate=30000$/m);
  const extra = await h.nwbTree({ asset: NWB_ASSET, path: "extra/" });
  assert.match(extra, /^ {2}soft -> \/units$/m);
  await assert.rejects(h.nwbTree({ asset: NWB_ASSET, path: "/missing" }), /Nothing is called "missing"/);
});

test("nwb_read gives attributes, stats and values, and a small corner by default", async () => {
  const h = hound();
  const text = await h.nwbRead({ asset: NWB_ASSET, path: "/acquisition/ElectricalSeries/data", start: [0, 0], count: [2, 4] });
  assert.match(text, /^Slice: start \[0, 0\], count \[2, 4\] = 8 values$/m);
  assert.match(text, /^ {2}unit: volts$/m);
  assert.match(text, /^Stats over the slice: min -1000, max -951, mean -975\.5$/m);
  assert.match(text, /^\[\[-1000, -993, -986, -979\], \[-972, -965, -958, -951\]\]$/m);
  const corner = await h.nwbRead({ asset: NWB_ASSET, path: "/acquisition/ElectricalSeries/data" });
  assert.match(corner, /count \[100, 4\] = 400 values/);
  assert.match(corner, /^First 200 values \(row-major\):$/m);
  const strings = await h.nwbRead({ asset: NWB_ASSET, path: "/units/quality" });
  assert.match(strings, /^\["good", "noise", "good", "mua", "good"\]$/m);
  assert.doesNotMatch(strings, /Stats/);
  await assert.rejects(h.nwbRead({ asset: NWB_ASSET, path: "/units" }), /is a group/);
  await assert.rejects(h.nwbRead({ asset: NWB_ASSET, path: "/extra/cube", start: [0] }), /start needs 3 numbers/);
  await assert.rejects(h.nwbRead({ asset: NWB_ASSET }), /Give the path/);
});

test("nwb_table follows ragged columns and shows references as paths", async () => {
  const h = hound();
  const units = await h.nwbTable({ asset: NWB_ASSET, path: "/units" });
  assert.match(units, /^\/units \(Units\): 5 rows; showing 0–4$/m);
  assert.match(units, /^id\tspike_times\tquality$/m);
  assert.match(units, /^0\t\[0, 0\.5, 1\]\t"good"$/m);
  assert.match(units, /^1\t\[\]\t"noise"$/m);
  assert.match(units, /^2\t\[2, 2\.5, 3, 3\.5, 4\]\t"good"$/m);
  const tail = await h.nwbTable({ asset: NWB_ASSET, path: "units", columns: ["spike_times"], start: 3, count: 10 });
  assert.match(tail, /showing 3–4/);
  assert.match(tail, /^4\t\[4, 4\.5, 5, 5\.5\]$/m);
  const electrodes = await h.nwbTable({ asset: NWB_ASSET, path: "/general/extracellular_ephys/electrodes" });
  assert.match(electrodes, /^2\t"DG"\t<\/general\/extracellular_ephys\/shank0>\t2\.5$/m);
  await assert.rejects(h.nwbTable({ asset: NWB_ASSET, path: "/units", columns: ["nope"] }), /No column nope in \/units\. Columns: spike_times, quality/);
});

test("long ragged cells are summarized, read whole or sampled cell by cell", async () => {
  const whole = hound();
  const sampled = hound();
  sampled.raggedLimit = 0;
  for (const h of [whole, sampled]) {
    const text = await h.nwbTable({ asset: NWB_ASSET, path: "/intervals/trials" });
    assert.match(text, /^\/intervals\/trials \(TimeIntervals\): 3 rows; showing 0–2$/m);
    assert.match(text, /^0\t0\t9\t\[0, 0\.25\]$/m);
    assert.match(text, /^1\t10\t19\t"30 values: \[0\.5, 0\.75, 1, 1\.25, 1\.5, 1\.75, …\]"$/m);
    assert.match(text, /^2\t20\t29\t\[8\]$/m);
  }
});

test("local files are off unless a folder is given, and can't escape it", async () => {
  await assert.rejects(hound().nwbSummary({ asset: "data/session.nwb" }), /Reading local files is off/);
  const root = mkdtempSync(path.join(tmpdir(), "brainhound-root-"));
  const outside = mkdtempSync(path.join(tmpdir(), "brainhound-outside-"));
  mkdirSync(path.join(root, "data"));
  copyFileSync(fixture("latest.nwb"), path.join(root, "data", "session.nwb"));
  copyFileSync(fixture("latest.nwb"), path.join(outside, "secret.nwb"));
  writeFileSync(path.join(root, "notes.txt"), "hello");
  symlinkSync(path.join(outside, "secret.nwb"), path.join(root, "link.nwb"));
  const h = hound({ files: root });
  assert.match(await h.nwbSummary({ asset: "data/session.nwb" }), /^Session: Made-up session for tests$/m);
  assert.doesNotMatch(await h.nwbSummary({ asset: "data/session.nwb" }), /range requests/);
  await assert.rejects(h.nwbSummary({ asset: "../" + path.basename(outside) + "/secret.nwb" }), /outside the folder/);
  await assert.rejects(h.nwbSummary({ asset: "link.nwb" }), /outside the folder/);
  await assert.rejects(h.nwbSummary({ asset: "notes.txt" }), /Only \.nwb, \.h5/);
  await assert.rejects(h.nwbSummary({ asset: "missing.nwb" }), /No such file/);
});

test("brain_region gives acronym, name, parents, license and citation", async () => {
  const text = await hound().region({ query: "CA1" });
  assert.match(text, /^- CA1 {2}Field CA1 {2}\(id 382, color #7ED04B\)$/m);
  assert.match(text, /^ {2}root > grey > CH > CTX > CTXpl > HPF > HIP > CA > CA1$/m);
  assert.match(text, /^License: Allen Institute terms of use: research and other noncommercial use only/m);
  assert.match(text, /^Cite as: Wang Q, .* doi:10\.1016\/j\.cell\.2020\.04\.007$/m);
  const visual = await hound().region({ query: "primary visual", limit: 2 });
  assert.match(visual, /^- VISp {2}Primary visual area /m);
  const human = await hound().region({ query: "hippocampal", species: "human", limit: 2 });
  assert.match(human, /^Allen Human Brain Atlas:$/m);
  await assert.rejects(hound().region({ query: "x", species: "cat" }), /Species must be one of/);
  await assert.rejects(hound().region({ query: "''" }), /Give a region name/);
});

test("brain_atlases filters BrainGlobe's list and adds species, voxels and citation", async () => {
  const text = await hound().atlases({ query: "allen mouse 25um" });
  assert.match(text, /^\d+ of \d+ BrainGlobe atlases match "allen mouse 25um"/m);
  assert.match(text, /^- allen_mouse_25um \(version 3\.1\) {2}Mus musculus, 25×25×25 µm voxels$/m);
  assert.match(text, /Cite as: Wang et al 2020/);
  assert.match(text, /Claudi F, et al\. \(2020\) JOSS/);
});

test("neuron_morphology gives facts, morphometry, file links and all three citations", async () => {
  for (const id of ["n419", "100"]) {
    const text = await hound().neuron({ id });
    assert.match(text, /^# n419 {2}https:\/\/neuromorpho\.org\/neuron_info\.jsp\?neuron_name=n419$/m);
    assert.match(text, /^Brain region: hippocampus, CA1$/m);
    assert.match(text, /^ {2}Bifurcations: 75$/m);
    assert.match(text, /^Standardized SWC: https:\/\/neuromorpho\.org\/dableFiles\/turner\/CNG%20version\/n419\.CNG\.swc$/m);
    assert.match(text, /^License: CC BY 4\.0/m);
    assert.match(text, /^1\. The original paper: doi:/m);
    assert.match(text, /^2\. NeuroMorpho\.Org \(RRID:SCR_002145\)$/m);
    assert.match(text, /^3\. Tecuatl C, Ljungquist B, Ascoli GA \(2024\)/m);
  }
  await assert.rejects(hound().neuron({ id: "" }), /Give a NeuroMorpho neuron/);
});

test("ids and links in every form people paste them", () => {
  assert.deepEqual(parseDandiId("dandi:000003"), { id: "000003", version: undefined });
  assert.deepEqual(parseDandiId("DANDI:000003/0.230629.1955"), { id: "000003", version: "0.230629.1955" });
  assert.deepEqual(parseDandiId("000003/draft"), { id: "000003", version: "draft" });
  assert.deepEqual(parseDandiId("https://dandiarchive.org/dandiset/000003/0.230629.1955"), { id: "000003", version: "0.230629.1955" });
  assert.equal(parseDandiId("ds000001"), null);
  assert.deepEqual(parseOpenNeuroId("ds000001"), { id: "ds000001", tag: undefined });
  assert.deepEqual(parseOpenNeuroId("openneuro:ds000001/1.0.0"), { id: "ds000001", tag: "1.0.0" });
  assert.deepEqual(parseOpenNeuroId("https://openneuro.org/datasets/ds000001/versions/1.0.0"), { id: "ds000001", tag: "1.0.0" });
  assert.equal(parseOpenNeuroId("000003"), null);
  assert.deepEqual(parseNeuronRef("neuromorpho:n419"), { name: "n419" });
  assert.deepEqual(parseNeuronRef("100"), { id: 100 });
  assert.deepEqual(parseNeuronRef("https://neuromorpho.org/neuron_info.jsp?neuron_name=n419"), { name: "n419" });
});

test("values print short and exact", () => {
  assert.equal(show(0.1 + 0.2), "0.3");
  assert.equal(show(1.95e-7), "1.95e-7");
  assert.equal(show("a\"b"), '"a\\"b"');
  assert.equal(show({ ref: "/x" }), "</x>");
  assert.equal(show([1, [2, "x"]]), '[1, [2, "x"]]');
  assert.equal(show({ t: 1, label: "go" }), '{t: 1, label: "go"}');
  assert.equal(show(null), "");
});

test("the network only reaches the archives, over https, without credentials", async () => {
  assert.throws(() => checkUrl("http://api.dandiarchive.org/api/"), /Only https/);
  assert.throws(() => checkUrl("https://example.com/"), /only reads from the archives/);
  assert.throws(() => checkUrl("https://user:pw@api.dandiarchive.org/"), /user name or password/);
  assert.throws(() => checkUrl("not a url"), /Not a web address/);
  assert.throws(() => checkUrl("https://api.dandiarchive.org.evil.com/"), NetError);
  for (const host of HOSTS) assert.ok(checkUrl(`https://${host}/x`));
  // A redirect off the list is refused, even from an allowed host.
  const net = new Net({ gap: 0, fetch: async () => new Response(null, { status: 302, headers: { location: "https://example.com/steal" } }) });
  await assert.rejects(net.json("https://api.dandiarchive.org/api/x"), /not example\.com/);
  // Endless redirects stop.
  const loop = new Net({ gap: 0, fetch: async (u) => new Response(null, { status: 302, headers: { location: u } }) });
  await assert.rejects(loop.json("https://api.dandiarchive.org/api/x"), /Too many redirects/);
});

test("requests to one host are spaced out", async () => {
  const times = [];
  const net = new Net({ gap: 40, fetch: async () => (times.push(Date.now()), new Response("{}", { status: 200 })) });
  await Promise.all([net.json("https://neuromorpho.org/api/a"), net.json("https://neuromorpho.org/api/b"), net.json("https://neuromorpho.org/api/c")]);
  times.sort((a, b) => a - b);
  assert.ok(times[2] - times[0] >= 70, `spread ${times[2] - times[0]} ms`);
});

test("archive errors come back as plain sentences", async () => {
  const net = new Net({ gap: 0, fetch: async () => new Response(JSON.stringify({ errors: [{ message: "bad field" }] }), { status: 400 }) });
  await assert.rejects(net.json("https://openneuro.org/crn/graphql"), /openneuro\.org answered 400: bad field/);
  const notJson = new Net({ gap: 0, fetch: async () => new Response("<html>", { status: 200 }) });
  await assert.rejects(notJson.json("https://openneuro.org/crn/graphql"), /isn't JSON/);
  const missing = new Net({ gap: 0, fetch: async () => new Response("", { status: 404 }) });
  await assert.rejects(missing.json("https://neuromorpho.org/api/neuron/name/x"), /Not found/);
});
