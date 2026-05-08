import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

const DOWNLOAD_URL =
  'https://github.com/ufo5260987423/scheme-langserver/releases/latest/download/scheme-langserver-x86_64-linux-glibc';

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

export function findLangserverInPath(): string | undefined {
  try {
    const result = spawnSync('which', ['scheme-langserver'], { encoding: 'utf8' });
    if (result.status === 0) {
      const p = result.stdout.trim();
      if (p && isExecutable(p)) {
        return p;
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function findLocalRun(): string | undefined {
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    const runPath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'run');
    if (fs.existsSync(runPath) && isExecutable(runPath)) {
      return runPath;
    }
  }
  return undefined;
}

export function findPreviouslyDownloaded(globalStoragePath: string): string | undefined {
  const downloadedPath = path.join(globalStoragePath, 'scheme-langserver');
  if (isExecutable(downloadedPath)) {
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
  progress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<void> {
  const response = await fetch(DOWNLOAD_URL, {
    redirect: 'follow',
    headers: { 'User-Agent': 'magic-scheme-vscode-extension' },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}`);
  }

  const totalSize = parseInt(response.headers.get('content-length') || '0', 10);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let downloaded = 0;
  let lastPct = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (token?.isCancellationRequested) {
      await reader.cancel();
      throw new Error('Download cancelled');
    }
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      chunks.push(value);
      downloaded += value.length;
      if (progress && totalSize > 0) {
        const pct = Math.round((downloaded / totalSize) * 100);
        progress.report({ message: `${pct}%`, increment: pct - lastPct });
        lastPct = pct;
      }
    }
  }

  const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  fs.writeFileSync(destPath, buffer);
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
    if (isExecutable(resolved)) {
      return resolved;
    }
  }

  // 2. PATH
  const pathServer = findLangserverInPath();
  if (pathServer) {
    return pathServer;
  }

  // 3. Local ./run
  const localRun = findLocalRun();
  if (localRun) {
    return localRun;
  }

  // 4. Previously downloaded binary in global storage
  const globalStoragePath = context.globalStorageUri.fsPath;
  const downloaded = findPreviouslyDownloaded(globalStoragePath);
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
      if (!isExecutable(destPath)) {
        vscode.window.showWarningMessage(
          'scheme-langserver was downloaded but appears to be corrupt. Please try again or install manually.'
        );
        return undefined;
      }
      vscode.window.showInformationMessage('scheme-langserver installed successfully.');
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
