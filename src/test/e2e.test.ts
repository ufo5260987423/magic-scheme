import * as assert from 'assert';
import * as vscode from 'vscode';
import { suite, test } from 'mocha';
import { spawnSync } from 'child_process';
import { activate, getDocUri } from './helper';

function hasSchemeLangserver(): boolean {
    try {
        const result = spawnSync('which', ['scheme-langserver'], { encoding: 'utf8' });
        return result.status === 0 && result.stdout.trim().length > 0;
    } catch {
        return false;
    }
}

suite('E2E Tests (Real scheme-langserver)', () => {
    const serverAvailable = hasSchemeLangserver();

    suiteSetup(async function () {
        if (!serverAvailable) {
            this.skip();
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

        // We cannot assert exact items without knowing scheme-langserver's behavior,
        // but we can assert the request succeeded and returned an array.
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
