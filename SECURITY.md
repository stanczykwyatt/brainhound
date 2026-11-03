# Security

brainhound is a tool a coding agent calls on its own, so it's built to be safe to hand over: it only reads, only from a fixed list of public archives, and never writes anything.

## Reporting a vulnerability

Please report security problems privately through **Security → Report a vulnerability** on this repository, not in a public issue. You'll get a reply within a few days.

## What it does

- **Reads from six public hosts, over https only:**
  - `api.dandiarchive.org` (DANDI's API: search, metadata, file lists)
  - `dandiarchive.s3.amazonaws.com` (DANDI's files, read with range requests)
  - `openneuro.org` (OpenNeuro's GraphQL API)
  - `neuromorpho.org` (NeuroMorpho.Org's API)
  - `api.brain-map.org` (the Allen Institute's API, for brain regions)
  - `brainglobe.s3.us-west-2.amazonaws.com` (BrainGlobe's list of atlases)

  Any other address is refused before a request is made, and so is a redirect to one. Addresses with a user name or password are refused. Nothing an agent sends can add a host.
- **Sends nothing about you.** Requests carry a plain `brainhound/<version>` user agent and no cookies, keys or tokens. It reads no environment variables. Search terms and ids go to the archive they're for, as they would from its website.
- **Spaces out requests** to each host (100 ms apart), and only calls the archives' documented APIs, one question at a time. It never crawls.
- **Reads NWB and HDF5 files** with its own small reader, which only parses: it follows the file's structure to the bytes asked for, decompresses gzip, and undoes shuffle. Damaged or hostile files make it stop with an error; it never runs anything from a file. One read gathers at most 128 MB.
- **Talks over stdio only:** MCP messages with the agent on stdin and stdout.

## What it doesn't do

- **Write anything.** No files, caches, logs or downloads, anywhere. CI checks the code has no file-writing calls.
- **Run programs** or use a shell. CI checks for that too.
- **Read local files unless you ask.** Opening files on your computer is off unless you start the server with `--files <folder>`. Then only `.nwb`, `.h5`, `.hdf5`, `.hdf`, `.he5` and `.mat` files inside that folder can be opened, checked after following links, and only for reading. The command line opens files in the current folder.

## Limits worth knowing

- **The archives see your questions,** as they would if you searched their websites, and your IP address. Use them under their own terms.
- **Data licenses are the archives'.** brainhound shows each dataset's license as the archive states it. Read them before reusing data, especially the Allen Institute's noncommercial terms.
- **Answers are only as right as the archives.** Metadata comes straight from them, unchecked.

## Dependencies

None at run time. The tests use Node's built-in test runner, recorded archive answers and small made-up HDF5 files, and never touch the network. Making those files again needs Python with h5py, only for maintainers.
