import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';

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

export function isCommandInPath(command: string): boolean {
  const pathEnv = process.env.PATH || process.env.Path || process.env.path || '';
  const dirs = pathEnv.split(process.platform === 'win32' ? ';' : ':');
  const exeName = process.platform === 'win32' ? `${command}.exe` : command;
  for (const dir of dirs) {
    if (!dir) { continue; }
    if (fs.existsSync(path.join(dir, exeName))) {
      return true;
    }
  }
  return false;
}
