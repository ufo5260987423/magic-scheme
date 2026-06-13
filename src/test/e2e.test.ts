import * as assert from 'assert';
import * as vscode from 'vscode';
import { suite, test } from 'mocha';
import * as path from 'path';
import * as fs from 'fs';
import { isExecutable, findLangserverInPathSync } from '../download';
import { activate, getDocUri } from './helper';

function findLangserver(): string | undefined {
    const candidates = [
        path.join(__dirname, '../../.vscode-test/scheme-langserver'),
        path.join(__dirname, '../../run'),
        path.join(__dirname, '../../../run'),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && isExecutable(candidate)) {
            return candidate;
        }
    }
    return findLangserverInPathSync();
}

suite('E2E Tests (Real scheme-langserver)', () => {
    const langserverPath = findLangserver();

    const projectConfigPath = path.join(__dirname, '../../.vscode-test', '.vscode', 'magic-scheme.json');

    suiteSetup(async function () {
        if (!langserverPath) {
            this.skip();
            return;
        }
        const config = vscode.workspace.getConfiguration('magicScheme.scheme-langserver');
        await config.update('serverPath', langserverPath, false);
        await config.update('enable', true, false);

        const vscodeDir = path.dirname(projectConfigPath);
        if (!fs.existsSync(vscodeDir)) {
            fs.mkdirSync(vscodeDir, { recursive: true });
        }
        fs.writeFileSync(projectConfigPath, JSON.stringify({
            topEnvironment: 'R6RS',
            multiThread: 'enable',
            typeInference: 'enable',
            logPath: '/tmp/scheme-langserver-e2e.log',
        }, null, 2) + '\n', 'utf8');
    });

    suiteTeardown(async function () {
        const config = vscode.workspace.getConfiguration('magicScheme.scheme-langserver');
        await config.update('serverPath', undefined, false);
        await config.update('enable', undefined, false);
        if (fs.existsSync(projectConfigPath)) {
            fs.unlinkSync(projectConfigPath);
        }
    });

    test('extension activates with real scheme-langserver', async function () {
        this.timeout(15000);
        const ext = vscode.extensions.getExtension('ufo5260987423.magic-scheme');
        assert.ok(ext);
        if (!ext.isActive) {
            const docUri = getDocUri('hello.scm');
            await activate(docUri);
        }
        assert.strictEqual(ext.isActive, true);
    });

    test('real server provides completions', async function () {
        this.timeout(15000);
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
        assert.ok(result, 'Completion should return a result');
        const items = result instanceof vscode.CompletionList
            ? result.items
            : result;
        assert.ok(Array.isArray(items), 'Should return an array of items');
    });

    test('real server provides hover', async function () {
        this.timeout(15000);
        const docUri = getDocUri('hello.scm');
        await activate(docUri);
        const position = new vscode.Position(0, 2);
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
