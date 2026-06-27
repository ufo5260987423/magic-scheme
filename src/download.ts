import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  isExecutableAsync,
  findLangserverInPath,
  findLocalRun,
  findPreviouslyDownloaded,
  isNixOS,
  canAutoDownload,
} from './discovery';
import {
  getLatestRemoteVersion,
  readLocalVersion,
  writeLocalVersion,
  shouldCheckForUpdate,
} from './version';
import { resolveServerPath } from './utils';

const DOWNLOAD_URL =
  'https://github.com/ufo5260987423/scheme-langserver/releases/latest/download/scheme-langserver-x86_64-linux-glibc';

const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000; // total download timeout
const STALL_TIMEOUT_MS = 30000; // timeout if no data received for this long

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

/**
 * Download the latest binary and replace the old one.
 */
export async function updateLangserver(
  context: vscode.ExtensionContext,
  statusBarItem: vscode.StatusBarItem,
  restartLsp: () => void | Promise<void>,
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

    await restartLsp();
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
  restartLsp: () => void | Promise<void>
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

function writeLastCheck(globalStoragePath: string, isoString: string): void {
  const LAST_CHECK_FILE = 'scheme-langserver.lastCheck';
  const checkPath = path.join(globalStoragePath, LAST_CHECK_FILE);
  try {
    fs.writeFileSync(checkPath, isoString, 'utf8');
  } catch {
    // ignore
  }
}

export async function ensureLangserver(context: vscode.ExtensionContext): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration('magicScheme.scheme-langserver');
  const autoDownload = config.get<boolean>('autoDownload', true);
  const configuredPath = config.get<string>('serverPath');

  // 1. Configured path (absolute or relative)
  if (configuredPath) {
    const resolved = resolveServerPath(configuredPath);
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
          vscode.window.showWarningMessage(
            `Could not save scheme-langserver path to workspace settings. You may need to set "magicScheme.scheme-langserver.serverPath" manually.`
          );
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
      'scheme-scheme-langserver not found. NixOS users may install it via nixpkgs (nix-shell -p akkuPackages.scheme-langserver) or set "serverPath" manually.'
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
