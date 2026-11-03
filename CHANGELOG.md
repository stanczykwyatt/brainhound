# Changelog

## 0.1.0

First release.

- **An MCP server** with ten read-only tools: `search_datasets`, `dataset_info`, `list_files`, `nwb_summary`, `nwb_tree`, `nwb_read`, `nwb_table`, `brain_region`, `brain_atlases` and `neuron_morphology`, for Claude Code, Codex, Cursor, Gemini CLI and any other MCP client.
- **One search across three archives:** DANDI, OpenNeuro and NeuroMorpho.Org.
- **NWB files read where they sit:** summaries, trees, slices and tables of files on DANDI, through range requests, with its own read-only HDF5 reader. Local files too, with `--files`.
- **Brain regions and atlases:** the Allen ontology for mouse, human and developing mouse, and BrainGlobe's atlas list.
- **A license and citation with every dataset,** word for word from the archive.
- **Four agent skills** in the Agent Skills format, and a set of eval questions with known answers.
- **The same answers from the command line.**
- **Read-only, no dependencies,** and only six fixed hosts, over https.
