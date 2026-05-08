#!/usr/bin/env node
import * as process from 'process';

let buffer = Buffer.alloc(0);

process.stdin.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    processMessages();
});

function processMessages(): void {
    for (;;) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) { return; }

        const headerStr = buffer.subarray(0, headerEnd).toString('utf8');
        const match = /Content-Length:\s*(\d+)/i.exec(headerStr);
        if (!match) { return; }

        const contentLength = parseInt(match[1], 10);
        const messageStart = headerEnd + 4;

        if (buffer.length < messageStart + contentLength) { return; }

        const content = buffer.subarray(messageStart, messageStart + contentLength).toString('utf8');
        buffer = buffer.subarray(messageStart + contentLength);

        try {
            const msg = JSON.parse(content);
            handleMessage(msg);
        } catch (e) {
            console.error('MockLSP: Failed to parse message', e);
        }
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleMessage(msg: any): void {
    if (msg.method === 'initialize') {
        sendResponse(msg.id, {
            capabilities: {
                textDocumentSync: 1,
                completionProvider: { triggerCharacters: ['('], resolveProvider: false },
                definitionProvider: true,
                hoverProvider: true,
                documentSymbolProvider: true,
                referencesProvider: true
            }
        });
    } else if (msg.method === 'initialized') {
        // no response required
    } else if (msg.method === 'shutdown') {
        sendResponse(msg.id, null);
    } else if (msg.method === 'exit') {
        process.exit(0);
    } else if (msg.method === 'textDocument/completion') {
        sendResponse(msg.id, [
            { label: 'define', kind: 3, detail: 'Define a variable or procedure' },
            { label: 'lambda', kind: 3, detail: 'Create an anonymous procedure' },
            { label: 'let', kind: 3, detail: 'Bind variables locally' },
            { label: 'if', kind: 3, detail: 'Conditional expression' }
        ]);
    } else if (msg.method === 'textDocument/hover') {
        sendResponse(msg.id, {
            contents: { kind: 'markdown', value: '**Scheme Symbol**\n\nA built-in Scheme identifier.' }
        });
    } else if (msg.method === 'textDocument/definition') {
        sendResponse(msg.id, null);
    } else if (msg.method === 'textDocument/references') {
        sendResponse(msg.id, []);
    } else if (msg.id !== undefined) {
        sendResponse(msg.id, null);
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sendResponse(id: number | string, result: any): void {
    const msg = { jsonrpc: '2.0', id, result };
    const json = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n`;
    process.stdout.write(header + json);
}
