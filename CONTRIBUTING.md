# Contributing to Task2Tool

Thank you for helping make agent capability discovery smaller, safer, and easier to explain.

## Before opening code

- Search existing issues and discussions.
- For behavior changes or new resource formats, open a feature request first. Include a minimal real-world fixture and the output you expect.
- Security vulnerabilities belong in a private report; see [SECURITY.md](SECURITY.md).

## Local setup

Task2Tool requires Node.js 20 or newer.

```bash
npm install
npm test
npm run build
npm audit
```

There are no runtime dependencies. Please discuss any proposal that adds one before implementing it.

## Design constraints

Changes should preserve these properties:

1. **Local-first:** core commands work without a network, account, telemetry, or model API.
2. **Bounded:** scanning must have explicit size and traversal limits; symbolic links stay out of scope.
3. **Safe by default:** do not export MCP arguments, environment values, or raw content unnecessarily.
4. **Deterministic:** identical inputs and options produce identically ordered results.
5. **Explainable:** retrieval behavior should remain testable without an opaque hosted service.
6. **Portable:** JSON output is the integration boundary; the CLI does not assume one agent runtime.

## Pull requests

- Keep the change focused and explain the user workflow it enables.
- Add or update tests for behavior, boundaries, malicious input, and deterministic ordering.
- Update README examples and the changelog when user-visible behavior changes.
- Do not commit generated dependency directories, credentials, private paths, or real access tokens.
- Use clear commit messages. Conventional Commits are welcome but not required.

The CI matrix runs TypeScript compilation and tests on supported Node lines. A maintainer may ask for a smaller patch or a fixture before accepting a new parser.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
