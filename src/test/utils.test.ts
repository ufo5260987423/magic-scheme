import * as assert from 'assert';
import { suite, test } from 'mocha';
import * as vscode from 'vscode';
import { getOrDefault } from '../commands';
import { isWindowsOS, quoteWindowsPath } from '../utils';

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
    });
});
