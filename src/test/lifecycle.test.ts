import * as assert from 'assert';
import * as vscode from 'vscode';
import { suite, test } from 'mocha';
import * as path from 'path';
import * as fs from 'fs';
import { activate, getDocUri } from './helper';

suite('LSP Lifecycle Tests (Mock Server)', () => {
    const mockServerPath = path.join(__dirname, 'mock-server', 'server.js');
    const originalSettings: Record<string, unknown> = {};

    suiteSetup(async function () {
        this.timeout(10000);
        // Ensure the mock server is executable
        if (fs.existsSync(mockServerPath)) {
            fs.chmodSync(mockServerPath, 0o755);
        }

        const config = vscode.workspace.getConfiguration('magicScheme.scheme-langserver');
        originalSettings.serverPath = config.get<string>('serverPath');
        originalSettings.enable = config.get<boolean>('enable');
        originalSettings.logPath = config.get<string>('logPath');
        originalSettings.multiThread = config.get<string>('multiThread');
        originalSettings.typeInference = config.get<string>('typeInference');
        originalSettings.topEnvironment = config.get<string>('topEnvironment');

        await config.update('serverPath', mockServerPath, false);
        await config.update('enable', true, false);
        await config.update('logPath', '/tmp/mock-lsp.log', false);
        await config.update('multiThread', 'enable', false);
        await config.update('typeInference', 'disable', false);
        await config.update('topEnvironment', 'R6RS', false);
    });

    suiteTeardown(async function () {
        this.timeout(10000);
        const config = vscode.workspace.getConfiguration('magicScheme.scheme-langserver');
        // Remove workspace overrides to fall back to package.json defaults
        await config.update('serverPath', undefined, false);
        await config.update('enable', undefined, false);
        await config.update('logPath', undefined, false);
        await config.update('multiThread', undefined, false);
        await config.update('typeInference', undefined, false);
        await config.update('topEnvironment', undefined, false);
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
