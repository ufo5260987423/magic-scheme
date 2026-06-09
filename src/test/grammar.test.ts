import * as assert from 'assert';
import { suite, test } from 'mocha';
import * as fs from 'fs';
import * as path from 'path';
import { Registry, IGrammar } from 'vscode-textmate';
import { loadWASM, createOnigScanner, createOnigString } from 'vscode-oniguruma';



let grammarLoaded = false;
let grammar: IGrammar;

async function ensureGrammar() {
    if (grammarLoaded) {
        return;
    }
    const wasmPath = path.join(__dirname, '../../node_modules/vscode-oniguruma/release/onig.wasm');
    const wasmBin = fs.readFileSync(wasmPath).buffer;
    await loadWASM(wasmBin);

    const registry = new Registry({
        onigLib: Promise.resolve({
            createOnigScanner(patterns: string[]) { return createOnigScanner(patterns); },
            createOnigString(s: string) { return createOnigString(s); }
        }),
        loadGrammar: async () => undefined
    });

    const xml = fs.readFileSync(path.join(__dirname, '../../package_files/scheme.tmLanguage'), 'utf8');
    // plist is ESM-only; use dynamic import
    const plistModule = await import('plist');
    const grammarJson = plistModule.parse(xml) as any;
    grammar = await registry.addGrammar(grammarJson);
    grammarLoaded = true;
}

function findToken(line: string, target: string, ruleStack: any): { token: { startIndex: number; endIndex: number; scopes: string[] } | null; ruleStack: any } {
    const result = grammar.tokenizeLine(line, ruleStack);
    for (const token of result.tokens) {
        const text = line.substring(token.startIndex, token.endIndex);
        if (text === target) {
            return { token: { startIndex: token.startIndex, endIndex: token.endIndex, scopes: token.scopes }, ruleStack: result.ruleStack };
        }
    }
    return { token: null, ruleStack: result.ruleStack };
}

suite('Grammar Tokenization', () => {
    suiteSetup(async () => {
        await ensureGrammar();
    });

    test('character literal #\\( inside square brackets is tokenized', () => {
        let state: any = null;

        // First enter an outer sexp so that [#\\( is inside a scheme context
        const outer = grammar.tokenizeLine('(case (string-ref s position)', state);
        state = outer.ruleStack;

        const code = '[#\\( position]';
        const { token } = findToken(code, '#\\(', state);
        assert.ok(token, 'Token #\\( should be found');
        assert.ok(
            token!.scopes.includes('constant.character.escape.scheme'),
            `Expected #\\( to have scope constant.character.escape.scheme, got: ${token!.scopes.join(' ')}`
        );
    });

    test('character literal #\\) inside square brackets is tokenized', () => {
        let state: any = null;
        const outer = grammar.tokenizeLine('(case (string-ref s position)', state);
        state = outer.ruleStack;

        const code = '[#\\) position]';
        const { token } = findToken(code, '#\\)', state);
        assert.ok(token, 'Token #\\) should be found');
        assert.ok(
            token!.scopes.includes('constant.character.escape.scheme'),
            `Expected #\\) to have scope constant.character.escape.scheme, got: ${token!.scopes.join(' ')}`
        );
    });

    test('character literal #\\[ inside square brackets is tokenized', () => {
        let state: any = null;
        const outer = grammar.tokenizeLine('(case (string-ref s position)', state);
        state = outer.ruleStack;

        const code = '[#\\[ position]';
        const { token } = findToken(code, '#\\[', state);
        assert.ok(token, 'Token #\\[ should be found');
        assert.ok(
            token!.scopes.includes('constant.character.escape.scheme'),
            `Expected #\\[ to have scope constant.character.escape.scheme, got: ${token!.scopes.join(' ')}`
        );
    });

    test('character literal #\\] inside square brackets is tokenized', () => {
        let state: any = null;
        const outer = grammar.tokenizeLine('(case (string-ref s position)', state);
        state = outer.ruleStack;

        const code = '[#\\] position]';
        const { token } = findToken(code, '#\\]', state);
        assert.ok(token, 'Token #\\] should be found');
        assert.ok(
            token!.scopes.includes('constant.character.escape.scheme'),
            `Expected #\\] to have scope constant.character.escape.scheme, got: ${token!.scopes.join(' ')}`
        );
    });

    test('character literal #\\" inside square brackets is tokenized', () => {
        let state: any = null;
        const outer = grammar.tokenizeLine('(case (string-ref s position)', state);
        state = outer.ruleStack;

        const code = '[#\\" position]';
        const { token } = findToken(code, '#\\"', state);
        assert.ok(token, 'Token #\\" should be found');
        assert.ok(
            token!.scopes.includes('constant.character.escape.scheme'),
            `Expected #\\" to have scope constant.character.escape.scheme, got: ${token!.scopes.join(' ')}`
        );
    });

    test('named character literal #\\space is tokenized', () => {
        let state: any = null;
        const outer = grammar.tokenizeLine('(case (string-ref s position)', state);
        state = outer.ruleStack;

        const code = '[#\\space position]';
        const { token } = findToken(code, '#\\space', state);
        assert.ok(token, 'Token #\\space should be found');
        assert.ok(
            token!.scopes.includes('constant.character.named.scheme'),
            `Expected #\\space to have scope constant.character.named.scheme, got: ${token!.scopes.join(' ')}`
        );
    });

    test('full example: all character literals in string-find-delimiter are tokenized', () => {
        const lines = [
            '(define (string-find-delimiter s position)',
            '  (cond',
            '    [(>= position (string-length s)) (string-length s)]',
            '    [else',
            '      (case (string-ref s position)',
            '        [#\\( position]',
            '        [#\\) position]',
            '        [#\\[ position]',
            '        [#\\] position]',
            '        [#\\" position]',
            '        [#\\; position]',
            '        [#\\# position]',
            '        [#\\space position]',
            '        [#\\newline position]',
            '        [#\\linefeed position]',
            '        [#\\tab position]',
            '        [#\\return position]',
            '        [else (string-find-delimiter s (+ 1 position))])]))',
        ];

        let state: any = null;
        const found: Array<{ text: string; scopes: string[]; line: number }> = [];

        for (let i = 0; i < lines.length; i++) {
            const result = grammar.tokenizeLine(lines[i], state);
            state = result.ruleStack;
            for (const token of result.tokens) {
                const text = lines[i].substring(token.startIndex, token.endIndex);
                if (text.startsWith('#\\')) {
                    found.push({ text, scopes: token.scopes, line: i });
                }
            }
        }

        // Verify each #\-prefixed token gets a character-literal scope
        for (const f of found) {
            const hasCharScope =
                f.scopes.includes('constant.character.escape.scheme') ||
                f.scopes.includes('constant.character.named.scheme') ||
                f.scopes.includes('constant.character.hex-literal.scheme');
            assert.ok(
                hasCharScope,
                `Token ${f.text} on line ${f.line} should have a character-literal scope, got: ${f.scopes.join(' ')}`
            );
        }

        // Verify specific known tokens
        assert.ok(found.some(f => f.text === '#\\(' && f.scopes.includes('constant.character.escape.scheme')), '#\\(');
        assert.ok(found.some(f => f.text === '#\\)' && f.scopes.includes('constant.character.escape.scheme')), '#\\)');
        assert.ok(found.some(f => f.text === '#\\[' && f.scopes.includes('constant.character.escape.scheme')), '#\\[');
        assert.ok(found.some(f => f.text === '#\\]' && f.scopes.includes('constant.character.escape.scheme')), '#\\]');
        assert.ok(found.some(f => f.text === '#\\space' && f.scopes.includes('constant.character.named.scheme')), '#\\space');
        assert.ok(found.some(f => f.text === '#\\newline' && f.scopes.includes('constant.character.named.scheme')), '#\\newline');
        assert.ok(found.some(f => f.text === '#\\tab' && f.scopes.includes('constant.character.named.scheme')), '#\\tab');
    });

    test('vector literal #(a b c) is tokenized', () => {
        let state: any = null;
        const code = '#(a b c)';
        const result = grammar.tokenizeLine(code, state);
        const tokens = result.tokens.map(t => ({
            text: code.substring(t.startIndex, t.endIndex),
            scopes: t.scopes
        }));
        const vectorBegin = tokens.find(t => t.text === '#(');
        assert.ok(vectorBegin, 'Token #( should be found');
        assert.ok(
            vectorBegin!.scopes.includes('punctuation.definition.vector.begin.scheme'),
            `Expected #( to have scope punctuation.definition.vector.begin.scheme, got: ${vectorBegin!.scopes.join(' ')}`
        );
        const vectorEnd = tokens.find(t => t.text === ')');
        assert.ok(vectorEnd, 'Token ) should be found');
        assert.ok(
            vectorEnd!.scopes.includes('punctuation.definition.vector.end.scheme'),
            `Expected ) to have scope punctuation.definition.vector.end.scheme, got: ${vectorEnd!.scopes.join(' ')}`
        );
    });
});
