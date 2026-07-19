# Roadmap

Task2Tool starts with a deliberately small contract: safe local discovery plus deterministic lexical retrieval. Roadmap items are ordered by evidence, not dates.

## Now — harden the portable core

- Validate catalogs against the published JSON Schema during linting without adding a runtime dependency.
- Add golden compatibility fixtures from real-world skill, prompt, and MCP configuration layouts.
- Document integration recipes for popular agent runtimes while keeping the CLI runtime-neutral.

## Next — improve retrieval without hiding it

- Optional query aliases and team-owned vocabulary files.
- Explain score contributions by field and term.
- Incremental indexes keyed by content hashes for very large workspaces.
- Opt-in local embedding reranking behind a stable adapter boundary.

## Later — exchange and interoperability

- Export an ARD-compatible catalog once the upstream contract is stable enough to target precisely.
- Signed catalog manifests and provenance metadata.
- Editor integration driven by the JSON output, not a privileged background service.

Want to help choose the next item? Open the **Roadmap proposal** issue template with a concrete workflow, fixture, and success criterion.
