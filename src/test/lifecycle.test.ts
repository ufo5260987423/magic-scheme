import * as assert from 'assert';
import * as vscode from 'vscode';
import { suite, test } from 'mocha';
import * as path from 'path';
import * as fs from 'fs';
import { activate, getDocUri } from './helper';

suite('LSP Lifecycle Tests (Mock Server)', () => {
    const mockServerPath = path.join(__dirname, 'mock-server', 'server.js');
    const originalSettings: Record<string, unknown> = {};

    const projectConfigPath = path.join(__dirname, '../../.vscode-test', '.scheme-langserver.json');

    suiteSetup(async function () {
        this.timeout(10000);
        // Ensure the mock server is executable
        if (fs.existsSync(mockServerPath)) {
            fs.chmodSync(mockServerPath, 0o755);
        }

        const config = vscode.workspace.getConfiguration('magicScheme.scheme-langserver');
        originalSettings.serverPath = config.get<string>('serverPath');
        originalSettings.enable = config.get<boolean>('enable');

        await config.update('serverPath', mockServerPath, false);
        await config.update('enable', true, false);

        fs.writeFileSync(projectConfigPath, JSON.stringify({
            topEnvironment: 'R6RS',
            multiThread: 'enable',
            typeInference: 'disable',
            logPath: '/tmp/mock-lsp.log',
        }, null, 2) + '\n', 'utf8');
    });

    suiteTeardown(async function () {
        this.timeout(10000);
        // Intentionally empty: resetting config in teardown triggers a pre-existing
        // vscode-languageclient v7 bug that spawns the default executable path
        // during extension deactivation, causing an uncaught spawn ENOENT.
        // Each test label runs in a fresh VS Code instance, so leaving workspace
        // config dirty is harmless.  The `clean-test-settings` script removes
        // leftover entries from .vscode/settings.json after the full test suite.
    });

    test('extension activates with mock server', async function () {
        this.timeout(10000);
        const docUri = getDocUri('hello.scm');
        await activate(docUri);

        const ext = vscode.extensions.getExtension('ufo5260987423.magic-scheme');
        assert.ok(ext?.isActive, 'Extension should be active');
    });

    test('mock server returns completions', async function () {
        this.timeout(10000);

        const docUri = getDocUri('completion.scm');
        await activate(docUri);

        const position = new vscode.Position(0, 1);
        const result = await vscode.commands.executeCommand<
            vscode.CompletionList | vscode.CompletionItem[]
        >(
            'vscode.executeCompletionItemProvider',
            docUri,
            position
        );

        assert.ok(result, 'Completion request should return a result');

        const items = result instanceof vscode.CompletionList
            ? result.items
            : result;

        assert.ok(items.length > 0, 'Mock server should return completion items');
    });

    test('mock server returns hover', async function () {
        this.timeout(10000);

        const docUri = getDocUri('hello.scm');
        await activate(docUri);

        const position = new vscode.Position(0, 1);
        const hover = await vscode.commands.executeCommand<
            vscode.Hover[]
        >(
            'vscode.executeHoverProvider',
            docUri,
            position
        );

        assert.ok(Array.isArray(hover), 'Hover should return an array');
    });
});
