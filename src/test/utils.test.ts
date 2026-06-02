import * as assert from 'assert';
import { suite, test, suiteTeardown } from 'mocha';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getOrDefault } from '../commands';
import { isWindowsOS, quoteWindowsPath, readProjectConfig, DEFAULT_SERVER_CONFIG } from '../utils';

suite('Unit Tests: Pure Logic', () => {
    suite('getOrDefault', () => {
        test('returns existing value', () => {
            const map = new Map<string, string>();
            map.set('key', 'value');
            const result = getOrDefault(map, 'key', () => 'default');
            assert.strictEqual(result, 'value');
        });

        test('returns default for missing key', () => {
            const map = new Map<string, string>();
            const result = getOrDefault(map, 'key', () => 'default');
            assert.strictEqual(result, 'default');
            assert.strictEqual(map.get('key'), 'default');
        });

        test('handles empty string as valid value', () => {
            const map = new Map<string, string>();
            map.set('key', '');
            const result = getOrDefault(map, 'key', () => 'default');
            assert.strictEqual(result, '');
        });

        test('handles false as valid value', () => {
            const map = new Map<string, boolean>();
            map.set('key', false);
            const result = getOrDefault(map, 'key', () => true);
            assert.strictEqual(result, false);
        });

        test('handles zero as valid value', () => {
            const map = new Map<string, number>();
            map.set('key', 0);
            const result = getOrDefault(map, 'key', () => 42);
            assert.strictEqual(result, 0);
        });
    });

    suite('isWindowsOS', () => {
        test('returns boolean', () => {
            const result = isWindowsOS();
            assert.strictEqual(typeof result, 'boolean');
        });

        test('matches process.platform', () => {
            const result = isWindowsOS();
            assert.strictEqual(result, process.platform === 'win32');
        });
    });

    suite('quoteWindowsPath', () => {
        test('does not quote path without spaces', () => {
            const result = quoteWindowsPath('C:\\scheme.exe', true);
            assert.strictEqual(result, 'C:\\scheme.exe');
        });

        test('quotes path with spaces for generic shell', () => {
            // When not cmd.exe or powershell, generic quoting is used
            const result = quoteWindowsPath('C:\\Program Files\\scheme.exe', true);
            assert.ok(result.includes("'"));
        });
    });

    suite('Extension Configuration Defaults', () => {
        test('scheme-langserver.enable defaults to true', () => {
            const config = vscode.workspace.getConfiguration('magicScheme.scheme-langserver');
            const value = config.get<boolean>('enable');
            assert.strictEqual(value, true);
        });

        test('scheme-langserver.serverPath defaults to scheme-langserver', () => {
            const config = vscode.workspace.getConfiguration('magicScheme.scheme-langserver');
            const value = config.get<string>('serverPath');
            assert.strictEqual(value, 'scheme-langserver');
        });

        test('scheme.path defaults to scheme', () => {
            const config = vscode.workspace.getConfiguration('magicScheme.scheme');
            const value = config.get<string>('path');
            assert.strictEqual(value, 'scheme');
        });

        test('DEFAULT_SERVER_CONFIG has expected defaults', () => {
            const defaults = DEFAULT_SERVER_CONFIG;
            assert.strictEqual(defaults.topEnvironment, 'R6RS');
            assert.strictEqual(defaults.multiThread, 'enable');
            assert.strictEqual(defaults.typeInference, 'disable');
            assert.strictEqual(defaults.logPath, '~/scheme-langserver.log');
        });
    });

    suite('readProjectConfig', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-scheme-test-'));
        const configPath = path.join(tmpDir, '.scheme-langserver.json');

        suiteTeardown(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        test('returns undefined when file does not exist', () => {
            if (fs.existsSync(configPath)) {
                fs.unlinkSync(configPath);
            }
            const result = readProjectConfig(tmpDir);
            assert.strictEqual(result, undefined);
        });

        test('reads valid config file', () => {
            fs.writeFileSync(configPath, JSON.stringify({ topEnvironment: 'R7RS', multiThread: 'disable' }));
            const result = readProjectConfig(tmpDir);
            assert.deepStrictEqual(result, { topEnvironment: 'R7RS', multiThread: 'disable' });
            fs.unlinkSync(configPath);
        });

        test('returns undefined for invalid JSON', () => {
            fs.writeFileSync(configPath, 'invalid json {');
            const result = readProjectConfig(tmpDir);
            assert.strictEqual(result, undefined);
            fs.unlinkSync(configPath);
        });
    });
});
