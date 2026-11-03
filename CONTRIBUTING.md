# Contributing

Thanks for helping out! Bug reports, new archives, skills and pull requests are all welcome.

## Reporting a wrong answer or a file that won't open

Open a [bug report](https://github.com/stanczykwyatt/brainhound/issues/new?template=bug.yml) with the tool or command, its arguments, and what came back. For an NWB or HDF5 file that won't open, a public DANDI path is perfect. If the file is private, the error message and the HDF5 or h5py version that wrote it help most. Please don't share data you can't make public.

## Getting started

You need Node 20 or later. Nothing to install.

```bash
node --test test/*.test.js                 # the tests, offline
node scripts/check-rules.mjs               # read-only, no shell, allowed hosts, no dependencies
node scripts/run-evals.mjs                 # the eval questions, offline
node scripts/run-evals.mjs --live          # the same, against the real archives
node src/cli.js search hippocampus         # try it
```

The tests replay recorded archive answers from `test/fixtures/api.json`, and use two small made-up HDF5 files written by h5py: one with HDF5's default settings and one in the newest format. If you change which calls the tests make, record them again with `node scripts/record-fixtures.mjs` (it makes about 40 small requests). To change the HDF5 files, edit `scripts/make-fixtures.py` and run it with Python and h5py.

## How it's put together

- `src/hdf5/hdf5.js` is a read-only HDF5 reader written from the HDF Group's file format spec: superblocks, object headers, groups old and new, attributes, datatypes, and the chunk indexes HDF5 uses, with gzip, shuffle and fletcher32.
- `src/hdf5/source.js` gives it bytes, from a file or from a URL with range requests and a small block cache.
- `src/net.js` makes every request, and holds the list of allowed hosts.
- `src/sources/` has one file per archive: DANDI, OpenNeuro, NeuroMorpho, and the Allen and BrainGlobe atlases.
- `src/tools.js` is the ten tools and how their answers read.
- `src/mcp.js` is the MCP server, and `src/cli.js` the command line.
- `skills/` holds the agent skills, and `evals/` the questions with known answers.

## Adding an archive

1. Add a file in `src/sources/` that returns the same shapes the others do, including a license and a citation for every dataset.
2. Add its host to `HOSTS` in `src/net.js` and to `SECURITY.md`.
3. Wire it into `src/tools.js`, add its calls to `test/calls.mjs`, record them, and add tests and an eval question.
4. Check its API terms allow this kind of use, and say how in the pull request.

## Ground rules

- **Read-only.** No tool may write a file or change anything anywhere.
- **Only the listed hosts,** over https, through `src/net.js`.
- **Every dataset gets its license and citation,** word for word from the source.
- **No dependencies and no shell.**
- **Short answers.** Agents pay for every token.
- **Made-up data only** in the test files. Recorded API answers are public metadata, with contributor emails removed.
- Run `node --test test/*.test.js` and `node scripts/check-rules.mjs` before opening a pull request, and add a test with your change.
- Keep commits small, with a short message saying what changed and why.

## Security issues

Please don't open public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).
