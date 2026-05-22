import * as vscode from 'vscode';
import * as path from 'path';
import { State } from 'vscode-languageclient/node';

export let doc: vscode.TextDocument;
export let editor: vscode.TextEditor;

export async function activate(docUri: vscode.Uri): Promise<void> {
    const ext = vscode.extensions.getExtension('ufo5260987423.magic-scheme')!;
    if (!ext.isActive) {
        await ext.activate();
    }
    doc = await vscode.workspace.openTextDocument(docUri);
    editor = await vscode.window.showTextDocument(doc);

    // Quick check: if LSP is already running, no need to wait
    const extExports = ext.exports as {
        getClientState?: () => State | undefined;
    };
    if (extExports?.getClientState?.() === State.Running) {
        return;
    }
    await sleep(2000);
}

export async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function getDocPath(p: string): string {
    return path.resolve(__dirname, '../../testFixture', p);
}

export function getDocUri(p: string): vscode.Uri {
    return vscode.Uri.file(getDocPath(p));
}
