# Change Log

All notable changes to the "magic-scheme" extension will be documented in this file.

## [Unreleased]

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
