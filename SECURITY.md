# Security policy

## Supported versions

The latest released minor version receives security fixes. Before a `1.0.0` release, breaking changes may accompany a security fix when needed to make the default behavior safe.

| Version | Supported |
| --- | --- |
| 0.2.x | Yes |
| Older | No |

## Report a vulnerability

Please use GitHub's **Private vulnerability reporting** for this repository instead of opening a public issue. Include:

- the affected command and version;
- a minimal malicious catalog or directory layout;
- the observed impact;
- any suggested mitigation; and
- whether the report may be acknowledged publicly after a fix.

You should receive an initial response within seven days. Please allow reasonable time for a coordinated fix before public disclosure.

## Security boundaries

Task2Tool treats filenames, Markdown, JSON, catalog metadata, and MCP configuration as untrusted input. Reports escape these values, per-file and aggregate scan budgets bound retained data, tokenization is capped, and symbolic links are ignored. MCP argument arrays and environment values are not exported.

The CLI still reads text below the root explicitly selected by the user. Do not scan untrusted directories with privileges you would not grant to an ordinary local process. Generated reports can reveal filenames and descriptions; review them before publishing.
