# Changelog

All notable changes to Task2Tool are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use semantic versioning.

## [Unreleased]

### Fixed

- Disclose the 256-term composition boundary in JSON, Markdown, and HTML, count ignored terms as uncovered, and bound normalized query input so partial evaluation cannot appear as complete coverage.
- Remove complete ANSI/ECMA-48 control sequences and remaining terminal-active C0/C1 characters from human-readable reports and direct CLI status/error lines.
- Keep the Pages composition example synchronized with the catalog and its actual 100% lexical-coverage result.

## [0.3.0] - 2026-07-22

### Added

- Recognize YAML block-list `tags`/`keywords` in Markdown frontmatter (in addition to the inline `[a, b]` form), with no new runtime dependency.
- `task2tool compose` for selecting a compact set of complementary resources by greedy marginal lexical coverage, with per-resource additions, cumulative coverage, and explicit uncovered terms in JSON, Markdown, and HTML.

### Changed

- Upgraded the live Pages lab from top-k search to an interactive complementary-capability composition demo.
- Human-facing matched terms retain readable normalized query words while the ranker keeps its bounded stemming behavior internally.

## [0.2.0] - 2026-07-20

### Added

- A zero-setup `task2tool demo` command that searches bundled, realistic resources so new users can see ranked results immediately.
- A branded README banner and dedicated 1280×640 social-preview artwork in editable SVG and upload-ready PNG formats.

### Changed

- Reworked the README's first-run path, examples, positioning, and contribution entry points around a 60-second successful experience.

## [0.1.0] - 2026-07-19

### Added

- Recursive discovery for skills, agent definitions, prompts, MCP configurations, and portable catalogs.
- Deterministic BM25-inspired natural-language retrieval with CJK bigram support.
- `index`, `find`, and `lint` commands with JSON, Markdown, and self-contained HTML output.
- Secret-aware MCP metadata handling, cumulative scan and token budgets, injection-safe rendering, and atomic report writes.
- Verified npm-style binary symlink execution and packed-install smoke coverage.
- Interactive static demo, versioned catalog schema, examples, automated tests, CI, and Pages deployment.

[Unreleased]: https://github.com/mockingbird777/task2tool/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/mockingbird777/task2tool/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/mockingbird777/task2tool/releases/tag/v0.2.0
[0.1.0]: https://github.com/mockingbird777/task2tool/releases/tag/v0.1.0
