import * as assert from 'assert';
import { suite, test, suiteTeardown } from 'mocha';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getOrDefault } from '../commands';
import { isWindowsOS, quoteWindowsPath, readProjectConfig, DEFAULT_SERVER_CONFIG, normalizeExtensionPattern, computeUpdatedAssociations } from '../utils';

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
            const value = config.inspect<boolean>('enable')?.defaultValue;
            assert.strictEqual(value, true);
        });

        test('scheme-langserver.serverPath defaults to scheme-langserver', () => {
            const config = vscode.workspace.getConfiguration('magicScheme.scheme-langserver');
            const value = config.inspect<string>('serverPath')?.defaultValue;
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
            assert.strictEqual(defaults.typeInference, 'enable');
            assert.strictEqual(defaults.logPath, '.vscode/scheme-langserver.log');
            assert.strictEqual(defaults.cachePath, '.vscode/scheme-langserver-cache');
        });

        test('scheme.fileExtensions defaults to standard Scheme suffixes', () => {
            const config = vscode.workspace.getConfiguration('magicScheme.scheme');
            const value = config.inspect<string[]>('fileExtensions')?.defaultValue;
            assert.deepStrictEqual(value, ['.ss', '.sps', '.scm', '.sch', '.sls', '.sld']);
        });
    });

    suite('readProjectConfig', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-scheme-test-'));
        const vscodeDir = path.join(tmpDir, '.vscode');
        const configPath = path.join(vscodeDir, 'magic-scheme.json');

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
            if (!fs.existsSync(vscodeDir)) {
                fs.mkdirSync(vscodeDir, { recursive: true });
            }
            fs.writeFileSync(configPath, JSON.stringify({ topEnvironment: 'R7RS', multiThread: 'disable' }));
            const result = readProjectConfig(tmpDir);
            assert.deepStrictEqual(result, { topEnvironment: 'R7RS', multiThread: 'disable' });
            fs.unlinkSync(configPath);
        });

        test('returns undefined for invalid JSON', () => {
            if (!fs.existsSync(vscodeDir)) {
                fs.mkdirSync(vscodeDir, { recursive: true });
            }
            fs.writeFileSync(configPath, 'invalid json {');
            const result = readProjectConfig(tmpDir);
            assert.strictEqual(result, undefined);
            fs.unlinkSync(configPath);
        });

        test('reads fileFilter and packageManager', () => {
            if (!fs.existsSync(vscodeDir)) {
                fs.mkdirSync(vscodeDir, { recursive: true });
            }
            fs.writeFileSync(configPath, JSON.stringify({
                topEnvironment: 'R6RS',
                fileFilter: ['.sls', '.scm', '.ss'],
                packageManager: 'txt',
            }));
            const result = readProjectConfig(tmpDir);
            assert.deepStrictEqual(result?.fileFilter, ['.sls', '.scm', '.ss']);
            assert.strictEqual(result?.packageManager, 'txt');
            fs.unlinkSync(configPath);
        });
    });

    suite('Language Configuration', () => {
        const configPath = path.join(__dirname, '../../package_files/scheme.configuration.json');

        test('brackets do not include curly braces', () => {
            const raw = fs.readFileSync(configPath, 'utf8');
            const config = JSON.parse(raw);
            assert.ok(Array.isArray(config.brackets), 'brackets should be defined');
            const hasBraces = config.brackets.some((pair: string[]) => pair[0] === '{' && pair[1] === '}');
            assert.strictEqual(hasBraces, false, 'brackets should not contain {}');
            const hasParens = config.brackets.some((pair: string[]) => pair[0] === '(' && pair[1] === ')');
            assert.strictEqual(hasParens, true, 'brackets should contain ()');
            const hasSquare = config.brackets.some((pair: string[]) => pair[0] === '[' && pair[1] === ']');
            assert.strictEqual(hasSquare, true, 'brackets should contain []');
        });

        test('colorizedBracketPairs do not include curly braces', () => {
            const raw = fs.readFileSync(configPath, 'utf8');
            const config = JSON.parse(raw);
            assert.ok(Array.isArray(config.colorizedBracketPairs), 'colorizedBracketPairs should be defined');
            const hasBraces = config.colorizedBracketPairs.some((pair: string[]) => pair[0] === '{' && pair[1] === '}');
            assert.strictEqual(hasBraces, false, 'colorizedBracketPairs should not contain {}');
            const hasParens = config.colorizedBracketPairs.some((pair: string[]) => pair[0] === '(' && pair[1] === ')');
            assert.strictEqual(hasParens, true, 'colorizedBracketPairs should contain ()');
            const hasSquare = config.colorizedBracketPairs.some((pair: string[]) => pair[0] === '[' && pair[1] === ']');
            assert.strictEqual(hasSquare, true, 'colorizedBracketPairs should contain []');
        });

        test('autoClosingPairs do not include curly braces', () => {
            const raw = fs.readFileSync(configPath, 'utf8');
            const config = JSON.parse(raw);
            assert.ok(Array.isArray(config.autoClosingPairs), 'autoClosingPairs should be defined');
            const pairs = config.autoClosingPairs as string[][];
            const hasBraces = pairs.some(pair => pair[0] === '{' && pair[1] === '}');
            assert.strictEqual(hasBraces, false, 'autoClosingPairs should not contain {}');
            const hasParens = pairs.some(pair => pair[0] === '(' && pair[1] === ')');
            assert.strictEqual(hasParens, true, 'autoClosingPairs should contain ()');
            const hasSquare = pairs.some(pair => pair[0] === '[' && pair[1] === ']');
            assert.strictEqual(hasSquare, true, 'autoClosingPairs should contain []');
            const hasQuote = pairs.some(pair => pair[0] === '"' && pair[1] === '"');
            assert.strictEqual(hasQuote, true, 'autoClosingPairs should contain ""');
        });
    });

    suite('normalizeExtensionPattern', () => {
        test('returns undefined for empty or whitespace input', () => {
            assert.strictEqual(normalizeExtensionPattern(''), undefined);
            assert.strictEqual(normalizeExtensionPattern('   '), undefined);
        });

        test('returns undefined for path-like input', () => {
            assert.strictEqual(normalizeExtensionPattern('foo/bar.sc'), undefined);
            assert.strictEqual(normalizeExtensionPattern('foo\\bar.sc'), undefined);
        });

        test('returns undefined for unsupported globs', () => {
            assert.strictEqual(normalizeExtensionPattern('**/*.sc'), undefined);
            assert.strictEqual(normalizeExtensionPattern('*.'), undefined);
        });

        test('normalizes extension with leading dot', () => {
            assert.strictEqual(normalizeExtensionPattern('.sc'), '*.sc');
            assert.strictEqual(normalizeExtensionPattern('  .scm  '), '*.scm');
        });

        test('normalizes extension without leading dot', () => {
            assert.strictEqual(normalizeExtensionPattern('sc'), '*.sc');
            assert.strictEqual(normalizeExtensionPattern('rkt'), '*.rkt');
        });

        test('passes through valid glob patterns', () => {
            assert.strictEqual(normalizeExtensionPattern('*.sc'), '*.sc');
        });
    });

    suite('computeUpdatedAssociations', () => {
        test('adds new scheme associations', () => {
            const result = computeUpdatedAssociations({}, [], ['.sc']);
            assert.deepStrictEqual(result.associations, { '*.sc': 'scheme' });
            assert.deepStrictEqual(result.managed, ['*.sc']);
        });

        test('removes previously managed associations that are no longer configured', () => {
            const current = { '*.sc': 'scheme', '*.ss': 'scheme' };
            const result = computeUpdatedAssociations(current, ['*.sc', '*.ss'], ['.ss']);
            assert.deepStrictEqual(result.associations, { '*.ss': 'scheme' });
            assert.deepStrictEqual(result.managed, ['*.ss']);
        });

        test('preserves user-managed associations that point to other languages', () => {
            const current = { '*.sc': 'scheme', '*.txt': 'plaintext' };
            const result = computeUpdatedAssociations(current, ['*.sc'], ['.ss']);
            assert.deepStrictEqual(result.associations, { '*.ss': 'scheme', '*.txt': 'plaintext' });
            assert.deepStrictEqual(result.managed, ['*.ss']);
        });

        test('deduplicates extensions', () => {
            const result = computeUpdatedAssociations({}, [], ['.sc', 'sc', '*.sc']);
            assert.deepStrictEqual(result.associations, { '*.sc': 'scheme' });
            assert.deepStrictEqual(result.managed, ['*.sc']);
        });

        test('does not remove an association that the user changed to a different language', () => {
            const current = { '*.sc': 'plaintext' };
            const result = computeUpdatedAssociations(current, ['*.sc'], []);
            assert.deepStrictEqual(result.associations, { '*.sc': 'plaintext' });
            assert.deepStrictEqual(result.managed, []);
        });
    });
});
