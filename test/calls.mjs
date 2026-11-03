// The calls whose archive answers are recorded in fixtures/api.json and replayed by the tests.
// Keep this list and the tests in step; scripts/record-fixtures.mjs records exactly these.
export const NWB_ASSET = "dandi:000003/sub-YutaMouse20/sub-YutaMouse20_ses-YutaMouse20-140327_behavior+ecephys.nwb";

export const CALLS = [
  ["search", { query: "hippocampus", limit: 2 }],
  ["search", { query: "CA1", sources: ["neuromorpho"], species: "mouse", limit: 2 }],
  ["search", { query: "zzzznotathing", sources: ["neuromorpho"], limit: 2 }],
  ["datasetInfo", { id: "dandi:000003" }],
  ["datasetInfo", { id: "openneuro:ds000001" }],
  ["datasetInfo", { id: "openneuro:ds000001/1.0.0" }],
  ["listFiles", { id: "dandi:000003", limit: 3 }],
  ["listFiles", { id: "openneuro:ds000001", limit: 5 }],
  ["listFiles", { id: "openneuro:ds000001", path: "sub-01/anat" }],
  ["nwbSummary", { asset: NWB_ASSET }],
  ["region", { query: "CA1" }],
  ["region", { query: "primary visual", limit: 2 }],
  ["region", { query: "hippocampal", species: "human", limit: 2 }],
  ["atlases", { query: "allen mouse 25um" }],
  ["neuron", { id: "n419" }],
  ["neuron", { id: "100" }],
];
