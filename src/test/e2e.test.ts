import * as assert from 'assert';
import * as vscode from 'vscode';
import { suite, test } from 'mocha';
import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { activate, getDocUri } from './helper';

function isExecutable(filePath: string): boolean {
    try {
        const result = spawnSync(filePath, ['--help'], { encoding: 'utf8', timeout: 5000 });
        // --help may exit with code 0 or 1, but as long as it doesn't crash it's fine
        return result.status !== null && result.error === undefined;
    } catch {
        return false;
    }
}

function findLangserver(): string | undefined {
    const candidates = [
        // 1. Auto-downloaded binary
        path.join(__dirname, '../../.vscode-test/scheme-langserver'),
        // 2. Manually bundled run file in project root
        path.join(__dirname, '../../../run'),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && isExecutable(candidate)) {
            return candidate;
        }
    }
    // 3. Check PATH for scheme-langserver
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

suite('E2E Tests (Real scheme-langserver)', () => {
    const langserverPath = findLangserver();

    suiteSetup(async function () {
        if (!langserverPath) {
            this.skip();
            return;
        }
        // Point config to the local langserver
        const config = vscode.workspace.getConfiguration('magicScheme.scheme-langserver');
        await config.update('serverPath', langserverPath, false);
        await config.update('enable', true, false);
        await config.update('logPath', '/tmp/scheme-langserver-e2e.log', false);
        await config.update('multiThread', 'enable', false);
        await config.update('typeInference', 'disable', false);
        await config.update('topEnvironment', 'R6RS', false);
    });

    suiteTeardown(async function () {
        const config = vscode.workspace.getConfiguration('magicScheme.scheme-langserver');
        await config.update('serverPath', undefined, false);
        await config.update('enable', undefined, false);
        await config.update('logPath', undefined, false);
        await config.update('multiThread', undefined, false);
        await config.update('typeInference', undefined, false);
        await config.update('topEnvironment', undefined, false);
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
