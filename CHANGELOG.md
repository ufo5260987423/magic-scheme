# Change Log

All notable changes to the "magic-scheme" extension will be documented in this file.

## [Unreleased]

## [0.0.11] - 2026-06-13

### Added
- Grammar support for additional R6RS/Chez procedures discovered via TSPL4 scan: `assp`, `cons*`, `char-general-category`, `exact-integer-sqrt`, `equal-hash`, `symbol-hash`, `string-ci-hash`, `fixnum-width`, `greatest-fixnum`, `least-fixnum`, `fldiv` family, `fxbit-set?`/`fxdiv` family, `hashtable-equivalence-function`, `hashtable-hash-function`, `native-endianness`, `sint-list->bytevector`, `uint-list->bytevector`, `number->string`, `real->flonum`, and more.
- Added `char-title-case?` and `hashtable-mutable?` to boolean-test predicates.

### Fixed
- Fixed scheme-langserver download/install progress appearing stuck: added total-download timeout, stalled-stream timeout, and byte-count progress when `content-length` is unavailable.
- Update downloads now show a cancellable progress notification instead of only a status-bar spinner.
- Background langserver discovery now catches failures so the status bar no longer stays stuck on “Looking for scheme-langserver...”.
- Replaced synchronous executable checks during discovery with async checks to avoid blocking the extension host.

## [0.0.10] - 2026-05-30

### Added
- **Custom enum values**: Known fields like `topEnvironment` now offer a "Custom value..." option for values outside the built-in enum (e.g. `S7`, `goldfish`).

### Changed
- **Type inference enabled by default**: `DEFAULT_SERVER_CONFIG.typeInference` changed from `disable` to `enable`. New workspaces automatically get `typeInference: "enable"`.

## [0.0.9] - 2026-05-30

### Added
- **Interactive project config wizard**: New command `Configure Magic Scheme Project` (Ctrl+Shift+P) opens a QuickPick + InputBox wizard for editing `.vscode/magic-scheme.json` without hand-editing JSON.
- **Arbitrary property support**: The wizard supports any property name, not just the four built-in fields. Users can add scheme-langserver-specific parameters via "Add new property...".
- **Known-field enums**: `topEnvironment` shows `[R6RS, R7RS]`; `multiThread`/`typeInference` show `[enable, disable]` as QuickPick options.
- **Multi-root workspace aware**: The wizard targets the workspace folder of the currently active editor, matching the LSP's config resolution behavior.

### Changed
- `getCurrentWorkspacePath()` is now exported from `utils.ts` for reuse by the configuration wizard.

## [0.0.8] - 2026-05-30

### Added
- Added `.sld` (R7RS library) to registered Scheme file extensions, enabling syntax highlighting and LSP for R7RS library files.
- **Project-level configuration**: Magic Scheme now automatically creates `.vscode/magic-scheme.json` on first activation.
- **Unified configuration source**: `.vscode/magic-scheme.json` is now the sole source for scheme-langserver runtime parameters (`topEnvironment`, `multiThread`, `typeInference`, `logPath`).
- **Effective config display**: The Scheme output channel now shows the actual LSP configuration values and their source.
- **Auto-update for scheme-langserver**: Background version checks (via GitHub release redirect, API-rate-limit-free) with `notify`/`auto`/`off` modes.

### Changed
- Declared compatibility with scheme-langserver 2.1.0.
- **BREAKING**: Removed `magicScheme.scheme-langserver.topEnvironment`, `multiThread`, `typeInference`, and `logPath` from VS Code Settings. These parameters are now configured exclusively via `.vscode/magic-scheme.json`.
- `getEffectiveServerConfig()` now reads LSP parameters only from `.vscode/magic-scheme.json` with hard-coded defaults; VS Code Settings are no longer consulted for these values.

## [0.0.7] - 2026-05-22

### Fixed
- **Activation**: Changed `activationEvents` to `["onLanguage:scheme"]` for reliable startup.
- **Stability**: Fixed `langClient` undefined crash and `deactivate()` returning rejected promise.
- **LSP State**: `isLangClientRunning` now only set on `State.Running`, reset on `State.Stopped`.
- **Security**: All `terminal.sendText()` calls now use `shell-quote` or `quoteWindowsPath` with `%` escaping.
- **Task Provider**: Fixed config key (`magicScheme.scheme.path`) and added `ShellQuoting.Strong`.
- **Resource Disposal**: `statusBarItem`, `infoChannel`, event listeners all added to `context.subscriptions`.
- **AKKU setup**: `.akku/env` is now only sourced when `AKKU.manifest` actually exists, preventing "No such file" spam.
- **Windows args quoting**: `command.slice(1)` arguments are now individually quoted instead of naively `join(' ')`.
- **Partial download cleanup**: Failed downloads now delete incomplete files to avoid stale/corrupt binaries.
- **Progress bar**: Download progress notification now updates the actual progress bar (not just text).
- **showOutput "one" mode**: Fixed bug where `showOutput` command could not find the terminal when `numberOfOutputTerminals` is set to `"one"`.
- **Tilde expansion**: `~/scheme-langserver.log` is now correctly expanded to the user's home directory (previously `~` was treated as a literal folder name).
- **Deactivation safety**: `deactivate()` now catches `langClient.stop()` errors gracefully.
- **Environment info visibility**: The Scheme output channel is now shown on activation so users can see environment diagnostics.
- **LSP client recreation**: Changing `serverPath` (manually or via auto-download) now disposes the old `langClient` and recreates it with the new path immediately. Previously the old path was cached forever.
- **Auto-download restart**: After downloading scheme-langserver in the background, the extension now correctly restarts the LSP with the newly downloaded binary instead of leaving a dead client.
- **State-machine safety**: `configurationChanged()` now checks `langClient.state` (instead of a boolean flag) to avoid duplicate `start()` calls during rapid config toggles.
- **Dispose race safety**: `disposeLangClient()` is now async and nulls the reference before awaiting `stop()`, preventing `TypeError` if `configurationChanged()` resumes after disposal.
- **Deactivate cleanup**: `deactivate()` now properly awaits `disposeLangClient()`, ensuring the state listener is disposed on shutdown.
- **Relative path resolution**: `withLanguageServer()` now resolves relative `serverPath` values against the workspace root, matching the behavior of `ensureLangserver()`.
- **Download validation**: After auto-download, `ensureLangserver()` now runs `isExecutable()` on the downloaded file before reporting success.
- **Tilde expansion edge case**: `resolveTilde()` now also handles bare `~` (without trailing slash).
- **CI xvfb**: GitHub Actions test job now runs under `xvfb-run` so E2E tests work on headless Linux.

### Added
- **Auto-install scheme-langserver**: Extension now automatically detects, downloads, and configures `scheme-langserver` on first activation.
  - Linux x64: Downloads latest release to VS Code global storage automatically.
  - macOS / Windows / Linux ARM: Shows platform-specific install guidance instead of a generic error.
  - New setting `magicScheme.scheme-langserver.autoDownload` (default `true`).
  - Fallback chain: configured `serverPath` → `$PATH` → workspace `./run` → previously downloaded binary → auto-download.
  - **Non-blocking activation**: `ensureLangserver()` runs in the background so extension activation is never blocked by slow network.
  - **Workspace-level config updates**: Auto-discovered paths are written to workspace settings (not global), avoiding Settings Sync issues with machine-specific paths.
- **3-layer test suite**:
  - Unit tests (`src/test/utils.test.ts`, `src/test/download.test.ts`): Pure logic tests including download progress, cancellation, and platform detection (22 passing).
  - Mock LSP tests (`src/test/lifecycle.test.ts`): Mock server tests extension activation + LSP lifecycle (3 passing).
  - E2E tests (`src/test/e2e.test.ts`): Auto-detects scheme-langserver binary; tests real completions/hover (3 passing).
- **CI/CD**: GitHub Actions workflow (`.github/workflows/ci.yml`) for lint/build/test automation.
- **Auto-download**: E2E tests can auto-download scheme-langserver to `.vscode-test/scheme-langserver`.
- **Build**: Unified `esbuild.js`; added `watch:esbuild`/`watch:tsc` scripts.

### Known Issues / Limitations
- **`$/setTrace` unsupported by scheme-langserver**: The LSP client sends `$/setTrace` (a standard LSP 3.16+ notification for adjusting trace verbosity). `scheme-langserver` does not implement this notification and returns `invalid request`. This is harmless — the client handles it gracefully and it does not affect normal LSP functionality.
- **NixOS binary compatibility**: The generic Linux glibc build of `scheme-langserver` downloaded from GitHub releases crashes on NixOS (SIGSEGV). E2E tests automatically fall back to a local `./run` file or `scheme-langserver` in `$PATH`. NixOS users should install `scheme-langserver` via `nixpkgs` (e.g., `akkuPackages.scheme-langserver`) instead of using the generic release binary.
- **Test helper uses fixed `sleep(2000)`**: `src/test/helper.ts` waits a hard-coded 2 seconds after opening a document to allow the LSP server to initialize. This could be replaced with waiting for `State.Running` event, but the current approach is stable.
- **Mock server lacks stdin end/error handlers**: The mock LSP server (`src/test/mock-server/server.ts`) does not handle `process.stdin.on('end')` or `process.stdin.on('error')`. This is non-critical for the current test scenarios.

## [0.0.6] - 2025-08-13

### Changed
- Compatible with scheme-langserver <= 2.0.0.

## [0.0.5] - 2025-02-08

### Fixed
- Removed annoying surrounding pair with `"'"`.
- 0.0.4 now works correctly.

## [0.0.4] - 2024-10-14

### Added
- Notify programmers when LSP is initializing.

## [0.0.3] - 2024-10-14

### Changed
- Replaced grammar configuration.

## [0.0.2] - 2024-08-25

### Fixed
- Comment handling.

## [0.0.1] - 2024-08-22

### Added
- Initial release with LSP support, REPL integration, and syntax highlighting.
