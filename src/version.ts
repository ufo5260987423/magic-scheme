import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

const VERSION_FILE = 'scheme-langserver.version';
const LAST_CHECK_FILE = 'scheme-langserver.lastCheck';
const UPDATE_INTERVAL_HOURS = 24;
const CHECK_TIMEOUT_MS = 5000;

const LATEST_RELEASE_URL =
  'https://github.com/ufo5260987423/scheme-langserver/releases/latest';

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
