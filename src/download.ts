import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';

const DOWNLOAD_URL =
  'https://github.com/ufo5260987423/scheme-langserver/releases/latest/download/scheme-langserver-x86_64-linux-glibc';

const LATEST_RELEASE_URL =
  'https://github.com/ufo5260987423/scheme-langserver/releases/latest';

const VERSION_FILE = 'scheme-langserver.version';
const LAST_CHECK_FILE = 'scheme-langserver.lastCheck';
const UPDATE_INTERVAL_HOURS = 24;
const CHECK_TIMEOUT_MS = 5000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000; // total download timeout
const STALL_TIMEOUT_MS = 30000; // timeout if no data received for this long

export function isExecutable(filePath: string): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  try {
    const result = spawnSync(filePath, ['--help'], { encoding: 'utf8', timeout: 5000 });
    return result.status === 0 && result.error === undefined;
  } catch {
    return false;
  }
}

export async function isExecutableAsync(filePath: string): Promise<boolean> {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  return new Promise((resolve) => {
    let killed = false;
    const child = spawn(filePath, ['--help']);
    const timeoutId = setTimeout(() => {
      killed = true;
      child.kill();
      resolve(false);
    }, 5000);

    child.on('error', () => {
      clearTimeout(timeoutId);
      resolve(false);
    });
    child.on('exit', (code: number | null) => {
      clearTimeout(timeoutId);
      if (!killed) {
        resolve(code === 0);
      }
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timeoutId);
      if (!killed) {
        resolve(code === 0);
      }
    });
  });
}

/**
 * Try to extract the scheme-langserver version string by running common
 * version/help flags. Older binaries may not support --version, so we fall
 * back to -v and then --help.
 */
async function runForVersion(filePath: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    let killed = false;
    const child = spawn(filePath, args);
    const timeoutId = setTimeout(() => {
      killed = true;
      child.kill();
      resolve(undefined);
    }, 5000);

    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });

    child.on('error', () => {
      clearTimeout(timeoutId);
      resolve(undefined);
    });

    const finish = (code: number | null) => {
      clearTimeout(timeoutId);
      if (killed || code !== 0) {
        resolve(undefined);
        return;
      }
      const match = output.match(/scheme-langserver\s+v?(\d+\.\d+\.\d+)/i);
      resolve(match ? match[1] : undefined);
    };

    child.on('exit', finish);
    child.on('close', finish);
  });
}

export async function getLangserverVersion(filePath: string): Promise<string | undefined> {
  for (const args of [['--version'], ['-v'], ['--help']]) {
    const version = await runForVersion(filePath, args);
    if (version) {
      return version;
    }
  }
  return undefined;
}

export function isVersionAtLeast(version: string, target: string): boolean {
  const parse = (v: string) => v.split('.').map((n) => parseInt(n, 10));
  const a = parse(version);
  const b = parse(target);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i] || 0;
    const bi = b[i] || 0;
    if (ai > bi) { return true; }
    if (ai < bi) { return false; }
  }
  return true;
}

export function findLangserverInPathSync(): string | undefined {
  const pathEnv = process.env.PATH || process.env.Path || process.env.path || '';
  const dirs = pathEnv.split(process.platform === 'win32' ? ';' : ':');
  const exeName = process.platform === 'win32' ? 'scheme-langserver.exe' : 'scheme-langserver';
  for (const dir of dirs) {
    if (!dir) {
      continue;
    }
    const fullPath = path.join(dir, exeName);
    if (isExecutable(fullPath)) {
      return fullPath;
    }
  }
  return undefined;
}

export async function findLangserverInPath(): Promise<string | undefined> {
  const pathEnv = process.env.PATH || process.env.Path || process.env.path || '';
  const dirs = pathEnv.split(process.platform === 'win32' ? ';' : ':');
  const exeName = process.platform === 'win32' ? 'scheme-langserver.exe' : 'scheme-langserver';
  for (const dir of dirs) {
    if (!dir) {
      continue;
    }
    const fullPath = path.join(dir, exeName);
    if (await isExecutableAsync(fullPath)) {
      return fullPath;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Version management for auto-downloaded binaries
// ---------------------------------------------------------------------------

export function readLocalVersion(globalStoragePath: string): string | undefined {
  const versionPath = path.join(globalStoragePath, VERSION_FILE);
  if (!fs.existsSync(versionPath)) {
    return undefined;
  }
  try {
    return fs.readFileSync(versionPath, 'utf8').trim();
  } catch {
    return undefined;
  }
}

export function writeLocalVersion(globalStoragePath: string, version: string): void {
  const versionPath = path.join(globalStoragePath, VERSION_FILE);
  try {
    fs.writeFileSync(versionPath, version, 'utf8');
  } catch {
    // ignore
  }
}

function readLastCheck(globalStoragePath: string): Date | undefined {
  const checkPath = path.join(globalStoragePath, LAST_CHECK_FILE);
  if (!fs.existsSync(checkPath)) {
    return undefined;
  }
  try {
    const content = fs.readFileSync(checkPath, 'utf8').trim();
    return new Date(content);
  } catch {
    return undefined;
  }
}

function writeLastCheck(globalStoragePath: string, isoString: string): void {
  const checkPath = path.join(globalStoragePath, LAST_CHECK_FILE);
  try {
    fs.writeFileSync(checkPath, isoString, 'utf8');
  } catch {
    // ignore
  }
}

export function shouldCheckForUpdate(globalStoragePath: string): boolean {
  const lastCheck = readLastCheck(globalStoragePath);
  if (!lastCheck) {
    return true;
  }
  const hoursSince = (Date.now() - lastCheck.getTime()) / (1000 * 60 * 60);
  return hoursSince >= UPDATE_INTERVAL_HOURS;
}

/**
 * Query the latest release version from GitHub using the release redirect URL.
 * This avoids GitHub API rate limits (api.github.com is NOT used).
 */
export async function getLatestRemoteVersion(): Promise<string | undefined> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(LATEST_RELEASE_URL, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': 'magic-scheme-vscode-extension' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const finalUrl = response.url;
    const match = finalUrl.match(/\/tag\/([^/]+)$/);
    return match ? match[1] : undefined;
  } catch {
    clearTimeout(timeoutId);
    return undefined;
  }
}

/**
 * Download the latest binary and replace the old one.
 */
export async function updateLangserver(
  context: vscode.ExtensionContext,
  statusBarItem: vscode.StatusBarItem,
  restartLsp: () => void,
  newVersion: string
): Promise<void> {
  const globalStoragePath = context.globalStorageUri.fsPath;
  const destPath = path.join(globalStoragePath, 'scheme-langserver');
  const tmpPath = destPath + '.new';

  try {
    statusBarItem.text = `$(sync~spin) Updating scheme-langserver to ${newVersion}...`;
    statusBarItem.tooltip = 'Downloading latest scheme-langserver...';
    statusBarItem.show();

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Updating scheme-langserver to ${newVersion}...`,
        cancellable: true,
      },
      async (progress, token) => {
        await downloadLangserver(tmpPath, token, progress);
      }
    );

    if (!(await isExecutableAsync(tmpPath))) {
      throw new Error('Downloaded file appears to be corrupt');
    }

    // Atomically replace old binary
    if (fs.existsSync(destPath)) {
      fs.unlinkSync(destPath);
    }
    fs.renameSync(tmpPath, destPath);
    fs.chmodSync(destPath, 0o755);

    writeLocalVersion(globalStoragePath, newVersion);

    statusBarItem.text = `$(check) scheme-langserver ${newVersion} Ready`;
    statusBarItem.tooltip = 'Language Server is ready';
    statusBarItem.show();

    restartLsp();
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch {
      // ignore cleanup errors
    }
    statusBarItem.text = '$(error) scheme-langserver Update Failed';
    statusBarItem.tooltip = err instanceof Error ? err.message : String(err);
    statusBarItem.show();
  }
}

/**
 * Check for updates and either auto-update or notify the user.
 * Only applies to binaries managed by Magic Scheme (auto-downloaded).
 */
export async function checkForUpdate(
  context: vscode.ExtensionContext,
  statusBarItem: vscode.StatusBarItem,
  restartLsp: () => void
): Promise<void> {
  const globalStoragePath = context.globalStorageUri.fsPath;
  const config = vscode.workspace.getConfiguration('magicScheme.scheme-langserver');
  const autoUpdate = config.get<string>('autoUpdate', 'notify');

  if (autoUpdate === 'off') {
    return;
  }

  if (!shouldCheckForUpdate(globalStoragePath)) {
    return;
  }

  // Mark as checked immediately to prevent duplicate checks during slow network
  writeLastCheck(globalStoragePath, new Date().toISOString());

  const localVersion = readLocalVersion(globalStoragePath);
  let remoteVersion: string | undefined;
  try {
    remoteVersion = await getLatestRemoteVersion();
  } catch {
    // Silent fail on network issues
    return;
  }

  if (!remoteVersion) {
    return;
  }

  // If no local version recorded (downloaded by old magic-scheme), treat as unknown → prompt update
  if (localVersion && localVersion === remoteVersion) {
    return;
  }

  if (autoUpdate === 'auto') {
    await updateLangserver(context, statusBarItem, restartLsp, remoteVersion);
  } else {
    // notify mode
    statusBarItem.text = `$(cloud-download) scheme-langserver ${remoteVersion} available`;
    statusBarItem.tooltip = 'Click to update scheme-langserver';
    statusBarItem.command = 'magic-scheme.updateLangserver';
    statusBarItem.show();

    const choice = await vscode.window.showInformationMessage(
      `scheme-langserver ${remoteVersion} is available. Current: ${localVersion || 'unknown'}.`,
      'Update Now',
      'Later'
    );
    if (choice === 'Update Now') {
      await updateLangserver(context, statusBarItem, restartLsp, remoteVersion);
    }
  }
}

export async function findLocalRun(): Promise<string | undefined> {
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    const runPath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'run');
    if (fs.existsSync(runPath) && (await isExecutableAsync(runPath))) {
      return runPath;
    }
  }
  return undefined;
}

export async function findPreviouslyDownloaded(globalStoragePath: string): Promise<string | undefined> {
  const downloadedPath = path.join(globalStoragePath, 'scheme-langserver');
  if (await isExecutableAsync(downloadedPath)) {
    return downloadedPath;
  }
  return undefined;
}

export function isNixOS(): boolean {
  return fs.existsSync('/etc/NIXOS');
}

export function canAutoDownload(): boolean {
  return process.platform === 'linux' && process.arch === 'x64';
}

export async function downloadLangserver(
  destPath: string,
  token?: vscode.CancellationToken,
  progress?: vscode.Progress<{ message?: string; increment?: number }>,
  options?: { totalTimeoutMs?: number; stallTimeoutMs?: number }
): Promise<void> {
  const controller = new AbortController();
  let abortedByUser = false;
  if (token) {
    token.onCancellationRequested(() => {
      abortedByUser = true;
      controller.abort();
    });
  }

  const totalTimeoutMs = options?.totalTimeoutMs ?? DOWNLOAD_TIMEOUT_MS;
  const stallTimeoutMs = options?.stallTimeoutMs ?? STALL_TIMEOUT_MS;

  // Total timeout for the whole download (headers + body).
  const totalTimeoutId = setTimeout(() => controller.abort(), totalTimeoutMs);

  let response: Response;
  try {
    response = await fetch(DOWNLOAD_URL, {
      redirect: 'follow',
      headers: { 'User-Agent': 'magic-scheme-vscode-extension' },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(totalTimeoutId);
    if (abortedByUser) {
      throw new Error('Download cancelled');
    }
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Download timed out');
    }
    throw err;
  }

  if (!response.ok || !response.body) {
    clearTimeout(totalTimeoutId);
    throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}`);
  }

  const totalSize = parseInt(response.headers.get('content-length') || '0', 10);
  const reader = response.body.getReader();
  controller.signal.addEventListener('abort', () => {
    void reader.cancel();
  });
  const fileStream = fs.createWriteStream(destPath);
  let downloaded = 0;
  let lastPct = 0;
  let lastChunkTime = Date.now();

  // Stall watchdog: abort if no chunk arrives within stallTimeoutMs.
  const stallCheckId = setInterval(() => {
    if (Date.now() - lastChunkTime > stallTimeoutMs) {
      controller.abort();
    }
  }, 1000);

  function reportProgress() {
    if (!progress) {
      return;
    }
    if (totalSize > 0) {
      const pct = Math.round((downloaded / totalSize) * 100);
      progress.report({ message: `${pct}%`, increment: pct - lastPct });
      lastPct = pct;
    } else {
      progress.report({ message: `${(downloaded / 1024).toFixed(1)} KB downloaded` });
    }
  }

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (token?.isCancellationRequested) {
        await reader.cancel();
        fileStream.destroy();
        throw new Error('Download cancelled');
      }

      let done: boolean;
      let value: Uint8Array | undefined;
      try {
        ({ done, value } = await reader.read());
      } catch (err) {
        if (abortedByUser) {
          throw new Error('Download cancelled');
        }
        if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
          throw new Error('Download timed out');
        }
        throw err;
      }

      if (done) {
        break;
      }
      if (value) {
        fileStream.write(Buffer.from(value));
        downloaded += value.length;
        lastChunkTime = Date.now();
        reportProgress();
      }
    }
  } finally {
    clearTimeout(totalTimeoutId);
    clearInterval(stallCheckId);
  }

  fileStream.end();
  await new Promise<void>((resolve, reject) => {
    fileStream.on('finish', resolve);
    fileStream.on('error', reject);
  });
  fs.chmodSync(destPath, 0o755);
}

export async function ensureLangserver(context: vscode.ExtensionContext): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration('magicScheme.scheme-langserver');
  const autoDownload = config.get<boolean>('autoDownload', true);
  const configuredPath = config.get<string>('serverPath');

  // 1. Configured path (absolute or relative)
  if (configuredPath) {
    // If relative, resolve against workspace root
    let resolved = configuredPath;
    if (!path.isAbsolute(configuredPath) && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      resolved = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, configuredPath);
    }
    if (await isExecutableAsync(resolved)) {
      return resolved;
    }
  }

  // 2. PATH
  const pathServer = await findLangserverInPath();
  if (pathServer) {
    return pathServer;
  }

  // 3. Local ./run
  const localRun = await findLocalRun();
  if (localRun) {
    return localRun;
  }

  // 4. Previously downloaded binary in global storage
  const globalStoragePath = context.globalStorageUri.fsPath;
  const downloaded = await findPreviouslyDownloaded(globalStoragePath);
  if (downloaded) {
    return downloaded;
  }

  // 5. Auto-download (Linux x64 only)
  if (autoDownload && canAutoDownload()) {
    const destPath = path.join(globalStoragePath, 'scheme-langserver');
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Downloading scheme-langserver...',
          cancellable: true,
        },
        async (progress, token) => {
          await downloadLangserver(destPath, token, progress);
        }
      );
      if (!(await isExecutableAsync(destPath))) {
        vscode.window.showWarningMessage(
          'scheme-langserver was downloaded but appears to be corrupt. Please try again or install manually.'
        );
        return undefined;
      }
      vscode.window.showInformationMessage('scheme-langserver installed successfully.');
      // Best-effort: fetch and record the exact version we just downloaded
      void getLatestRemoteVersion().then((version) => {
        if (version) {
          writeLocalVersion(globalStoragePath, version);
        }
      });
      const configuredExecutable = configuredPath ? await isExecutableAsync(configuredPath) : false;
      const needsConfigUpdate = !configuredPath || !configuredExecutable;
      if (needsConfigUpdate) {
        try {
          await config.update('serverPath', destPath, false);
        } catch {
          // ignore: settings may be read-only
        }
      }
      return destPath;
    } catch (err) {
      // Clean up partial download so it doesn't look like a valid binary next time
      try {
        if (fs.existsSync(destPath)) {
          fs.unlinkSync(destPath);
        }
      } catch {
        // ignore cleanup errors
      }
      vscode.window.showWarningMessage(
        `Failed to download scheme-langserver: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // 6. Platform-specific guidance
  if (!autoDownload) {
    vscode.window.showWarningMessage(
      'scheme-langserver not found. Enable "magicScheme.scheme-langserver.autoDownload" to auto-install, or set "serverPath" manually.'
    );
  } else if (isNixOS()) {
    vscode.window.showWarningMessage(
      'scheme-langserver not found. NixOS users may install it via nixpkgs (nix-shell -p akkuPackages.scheme-langserver) or set "serverPath" manually.'
    );
  } else if (process.platform === 'darwin') {
    vscode.window.showWarningMessage(
      'No prebuilt scheme-langserver binary for macOS. Please install via Nix or build from source.'
    );
  } else if (process.platform === 'win32') {
    vscode.window.showWarningMessage(
      'No prebuilt scheme-langserver binary for Windows. Please use WSL2, or build from source.'
    );
  } else {
    vscode.window.showWarningMessage(
      'scheme-langserver not found. Please install it manually or set "magicScheme.scheme-langserver.serverPath".'
    );
  }

  return undefined;
}
