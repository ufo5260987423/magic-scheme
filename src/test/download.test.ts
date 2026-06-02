import * as assert from 'assert';
import { suite, test } from 'mocha';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  isExecutable,
  canAutoDownload,
  findPreviouslyDownloaded,
  downloadLangserver,
  readLocalVersion,
  writeLocalVersion,
  shouldCheckForUpdate,
  getLatestRemoteVersion,
} from '../download';

suite('Download Unit Tests', () => {
  suite('canAutoDownload', () => {
    test('returns correct value for current platform', () => {
      const result = canAutoDownload();
      const expected = process.platform === 'linux' && process.arch === 'x64';
      assert.strictEqual(result, expected);
    });
  });

  suite('isExecutable', () => {
    test('returns false for non-existent file', () => {
      assert.strictEqual(isExecutable('/nonexistent/path/to/binary'), false);
    });

    test('returns true for a valid shell script', () => {
      const tmpScript = path.join(os.tmpdir(), 'magic-scheme-test-exec.sh');
      fs.writeFileSync(tmpScript, '#!/bin/sh\necho "help"\n');
      fs.chmodSync(tmpScript, 0o755);
      try {
        assert.strictEqual(isExecutable(tmpScript), true);
      } finally {
        fs.unlinkSync(tmpScript);
      }
    });

    test('returns false for a file that exits with error', () => {
      const tmpScript = path.join(os.tmpdir(), 'magic-scheme-test-fail.sh');
      fs.writeFileSync(tmpScript, '#!/bin/sh\nexit 1\n');
      fs.chmodSync(tmpScript, 0o755);
      try {
        assert.strictEqual(isExecutable(tmpScript), false);
      } finally {
        fs.unlinkSync(tmpScript);
      }
    });
  });

  suite('findPreviouslyDownloaded', () => {
    test('returns undefined when file does not exist', () => {
      const result = findPreviouslyDownloaded('/nonexistent/storage');
      assert.strictEqual(result, undefined);
    });

    test('returns path when valid executable exists', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-scheme-test-'));
      const binaryPath = path.join(tmpDir, 'scheme-langserver');
      fs.writeFileSync(binaryPath, '#!/bin/sh\necho "help"\n');
      fs.chmodSync(binaryPath, 0o755);
      try {
        const result = findPreviouslyDownloaded(tmpDir);
        assert.strictEqual(result, binaryPath);
      } finally {
        fs.unlinkSync(binaryPath);
        fs.rmdirSync(tmpDir);
      }
    });

    test('returns undefined for non-executable file', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-scheme-test-'));
      const binaryPath = path.join(tmpDir, 'scheme-langserver');
      fs.writeFileSync(binaryPath, 'not a script');
      fs.chmodSync(binaryPath, 0o644);
      try {
        const result = findPreviouslyDownloaded(tmpDir);
        assert.strictEqual(result, undefined);
      } finally {
        fs.unlinkSync(binaryPath);
        fs.rmdirSync(tmpDir);
      }
    });
  });

  suite('downloadLangserver', () => {
    test('downloads and writes binary correctly', async () => {
      const tmpFile = path.join(os.tmpdir(), 'magic-scheme-test-download');

      const originalFetch = global.fetch;
      const mockBuffer = Buffer.from('fake-binary-content');
      global.fetch = async () =>
        ({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: {
            get: (name: string) => (name.toLowerCase() === 'content-length' ? String(mockBuffer.length) : null),
          },
          body: {
            getReader: () => {
              let done = false;
              return {
                read: async () => {
                  if (done) {
                    return { done: true, value: undefined };
                  }
                  done = true;
                  return { done: false, value: new Uint8Array(mockBuffer) };
                },
                cancel: () => {
                  /* no-op */
                },
              };
            },
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

      try {
        await downloadLangserver(tmpFile);
        assert.strictEqual(fs.existsSync(tmpFile), true);
        const content = fs.readFileSync(tmpFile);
        assert.deepStrictEqual(content, mockBuffer);
        // Check permissions
        const stats = fs.statSync(tmpFile);
        assert.ok(stats.mode & 0o111, 'should be executable');
      } finally {
        global.fetch = originalFetch;
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      }
    });

    test('throws on HTTP error', async () => {
      const originalFetch = global.fetch;
      global.fetch = async () =>
        ({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          body: null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

      try {
        await assert.rejects(
          async () => downloadLangserver('/tmp/test-download-404'),
          /Download failed: HTTP 404/
        );
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('supports cancellation token', async () => {
      const tmpFile = path.join(os.tmpdir(), 'magic-scheme-test-cancel');

      const originalFetch = global.fetch;
      let readCount = 0;
      global.fetch = async () =>
        ({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: {
            get: (name: string) => (name.toLowerCase() === 'content-length' ? '100' : null),
          },
          body: {
            getReader: () => ({
              read: async () => {
                readCount++;
                if (readCount > 1) {
                  // Simulate slow stream that gets cancelled
                  await new Promise((r) => setTimeout(r, 5000));
                }
                return { done: false, value: new Uint8Array([0x01]) };
              },
              cancel: () => {
                /* no-op */
              },
            }),
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

      const mockToken = {
        isCancellationRequested: true,
        onCancellationRequested: () => ({ dispose: () => {} }),
      };

      try {
        await assert.rejects(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          async () => downloadLangserver(tmpFile, mockToken as any),
          /Download cancelled/
        );
      } finally {
        global.fetch = originalFetch;
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      }
    });
  });

  suite('Version Management', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-scheme-version-test-'));

    suiteTeardown(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('readLocalVersion returns undefined when file does not exist', () => {
      const result = readLocalVersion(tmpDir);
      assert.strictEqual(result, undefined);
    });

    test('writeLocalVersion and readLocalVersion roundtrip', () => {
      writeLocalVersion(tmpDir, '2.1.0');
      const result = readLocalVersion(tmpDir);
      assert.strictEqual(result, '2.1.0');
    });

    test('shouldCheckForUpdate returns true when no lastCheck file', () => {
      const result = shouldCheckForUpdate(tmpDir);
      assert.strictEqual(result, true);
    });

    test('shouldCheckForUpdate returns false within 24h', () => {
      const lastCheckPath = path.join(tmpDir, 'scheme-langserver.lastCheck');
      fs.writeFileSync(lastCheckPath, new Date().toISOString(), 'utf8');
      const result = shouldCheckForUpdate(tmpDir);
      assert.strictEqual(result, false);
    });

    test('shouldCheckForUpdate returns true after 24h', () => {
      const lastCheckPath = path.join(tmpDir, 'scheme-langserver.lastCheck');
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
      fs.writeFileSync(lastCheckPath, oldDate.toISOString(), 'utf8');
      const result = shouldCheckForUpdate(tmpDir);
      assert.strictEqual(result, true);
    });
  });

  suite('getLatestRemoteVersion', () => {
    test('extracts version from redirect URL', async () => {
      const originalFetch = global.fetch;
      global.fetch = async () =>
        ({
          url: 'https://github.com/ufo5260987423/scheme-langserver/releases/tag/2.1.0',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

      try {
        const result = await getLatestRemoteVersion();
        assert.strictEqual(result, '2.1.0');
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('returns undefined when fetch fails', async () => {
      const originalFetch = global.fetch;
      global.fetch = async () => {
        throw new Error('network error');
      };

      try {
        const result = await getLatestRemoteVersion();
        assert.strictEqual(result, undefined);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
