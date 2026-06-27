# Agent Guide for Magic Scheme

This file contains guidance for coding agents working on the Magic Scheme VS Code extension.

## Project Overview

Magic Scheme is a VS Code extension that provides Scheme (R6RS/Chez) language support via the [scheme-langserver](https://github.com/ufo5260987423/scheme-langserver) LSP implementation.

Key responsibilities:
- Spawn and manage the `scheme-langserver` process
- Provide syntax highlighting, REPL integration, and script execution
- Auto-detect/download/update `scheme-langserver` on Linux x64
- Project-level configuration via `.vscode/magic-scheme.json`

## Tech Stack

- TypeScript 5.4+
- VS Code Extension API
- `vscode-languageclient` for LSP communication
- esbuild for bundling (`dist/extension.js`)
- `tsc` for type-checking and test compilation (`out/`)

## Build & Development

```bash
# Type-check only
npm run compile

# Bundle for development
npm run build

# Bundle for publishing
npm run vscode:prepublish

# Lint
npm run lint
```

The extension entry point in production is `dist/extension.js` (configured in `package.json` as `"main": "./dist/extension.js"`).

## Testing

Three test layers are provided:

```bash
# Unit tests (pure logic, no VS Code instance required beyond the test runner)
npm run test:unit

# Mock LSP lifecycle tests
npm run test:mock

# E2E tests against a real scheme-langserver binary
npm run test:e2e

# Run everything (cleans test settings before and after)
npm test
```

Note: `.vscode/settings.json` may contain `magicScheme.*` test settings. `npm test` runs `clean-test-settings.js` before tests to remove them. If running individual test scripts, run `node scripts/clean-test-settings.js` first if tests fail due to stale settings.

## Code Organization

| File | Responsibility |
|---|---|
| `src/extension.ts` | Extension activation, LSP client lifecycle, status bar, config watchers |
| `src/utils.ts` | Path resolution, project config reading, `withLanguageServer` helper |
| `src/download.ts` | Auto-download, update, and `ensureLangserver` orchestration |
| `src/discovery.ts` | Server discovery: PATH lookup, `./run`, executability checks |
| `src/version.ts` | Version detection, comparison, and update-check bookkeeping |
| `src/commands.ts` | Command registration glue |
| `src/repl.ts` | REPL and output terminal creation |
| `src/tasks.ts` | VS Code TaskProvider |

## Conventions

- Prefer `async/await` over callbacks for new code.
- Avoid synchronous file system operations in the extension host path when async alternatives are practical.
- Use `void somePromise().catch(...)` only when the caller intentionally does not need to await.
- Keep LSP lifecycle state centralized in `extension.ts`.
- Project-level LSP parameters live in `.vscode/magic-scheme.json`; VS Code settings only control extension behavior (`enable`, `serverPath`, `autoDownload`, `autoUpdate`, etc.).

## Important Constants

- `MIN_VERSION_FOR_CACHE_PATH = '2.1.3'` in `src/extension.ts`: the minimum `scheme-langserver` version that supports `--cache-path`/`-c`.

## Common Pitfalls

- `ensureLangserver` runs in the background. Do not assume `currentServerVersion` is available during the initial eager `trySetupAndStartLSP()` call.
- `trySetupAndStartLSP` may be called before cache-path support is known; the `currentEnableCachePath` flag tracks the actual state of the running client.
- `printEnvironmentInfo()` is called before version detection; version info is appended to the channel later.
- Project config file changes trigger an LSP restart via `createFileSystemWatcher`. Writes initiated by the extension itself are skipped by comparing file content.
