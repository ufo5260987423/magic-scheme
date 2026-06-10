/* eslint-disable @typescript-eslint/no-explicit-any */
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
        const state: any = null;
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


    test('octal character literal #\\000 is tokenized', () => {
        const state: any = null;
        const code = '(#\\000)';
        const { token } = findToken(code, '#\\000', state);
        assert.ok(token, 'Token #\\000 should be found');
        assert.ok(
            token!.scopes.includes('constant.character.octal.scheme'),
            `Expected #\\000 to have scope constant.character.octal.scheme, got: ${token!.scopes.join(' ')}`
        );
    });

    test('hex character literal #\\x41; with semicolon is tokenized', () => {
        const state: any = null;
        const code = '(#\\x41;)';
        const { token } = findToken(code, '#\\x41;', state);
        assert.ok(token, 'Token #\\x41; should be found');
        assert.ok(
            token!.scopes.includes('constant.character.hex-literal.scheme'),
            `Expected #\\x41; to have scope constant.character.hex-literal.scheme, got: ${token!.scopes.join(' ')}`
        );
    });

    test('fixnum vector #vfx(1 2 3) is tokenized', () => {
        const state: any = null;
        const code = '#vfx(1 2 3)';
        const result = grammar.tokenizeLine(code, state);
        const tokens = result.tokens.map(t => ({
            text: code.substring(t.startIndex, t.endIndex),
            scopes: t.scopes
        }));
        const vectorBegin = tokens.find(t => t.text === '#vfx(');
        assert.ok(vectorBegin, 'Token #vfx( should be found');
        assert.ok(
            vectorBegin!.scopes.includes('punctuation.definition.fixnum-vector.begin.scheme'),
            `Expected #vfx( to have scope punctuation.definition.fixnum-vector.begin.scheme, got: ${vectorBegin!.scopes.join(' ')}`
        );
    });

    test('flonum vector #vfl(1.0 2.0) is tokenized', () => {
        const state: any = null;
        const code = '#vfl(1.0 2.0)';
        const result = grammar.tokenizeLine(code, state);
        const tokens = result.tokens.map(t => ({
            text: code.substring(t.startIndex, t.endIndex),
            scopes: t.scopes
        }));
        const vectorBegin = tokens.find(t => t.text === '#vfl(');
        assert.ok(vectorBegin, 'Token #vfl( should be found');
        assert.ok(
            vectorBegin!.scopes.includes('punctuation.definition.flonum-vector.begin.scheme'),
            `Expected #vfl( to have scope punctuation.definition.flonum-vector.begin.scheme, got: ${vectorBegin!.scopes.join(' ')}`
        );
    });

    test('box #& is tokenized', () => {
        const state: any = null;
        const code = '(#&1)';
        const { token } = findToken(code, '#&', state);
        assert.ok(token, 'Token #& should be found');
        assert.ok(
            token!.scopes.includes('constant.other.box.scheme'),
            `Expected #& to have scope constant.other.box.scheme, got: ${token!.scopes.join(' ')}`
        );
    });

    test('gensym #{g0} is tokenized', () => {
        const state: any = null;
        const code = '#{g0}';
        const result = grammar.tokenizeLine(code, state);
        const tokens = result.tokens.map(t => ({
            text: code.substring(t.startIndex, t.endIndex),
            scopes: t.scopes
        }));
        const gensymBegin = tokens.find(t => t.text === '#{');
        assert.ok(gensymBegin, 'Token #{ should be found');
        assert.ok(
            gensymBegin!.scopes.includes('punctuation.definition.gensym.begin.scheme'),
            `Expected #{ to have scope punctuation.definition.gensym.begin.scheme, got: ${gensymBegin!.scopes.join(' ')}`
        );
    });

    test('record #[rtd] is tokenized', () => {
        const state: any = null;
        const code = '#[rtd]';
        const result = grammar.tokenizeLine(code, state);
        const tokens = result.tokens.map(t => ({
            text: code.substring(t.startIndex, t.endIndex),
            scopes: t.scopes
        }));
        const recordBegin = tokens.find(t => t.text === '#[');
        assert.ok(recordBegin, 'Token #[ should be found');
        assert.ok(
            recordBegin!.scopes.includes('punctuation.definition.record.begin.scheme'),
            `Expected #[ to have scope punctuation.definition.record.begin.scheme, got: ${recordBegin!.scopes.join(' ')}`
        );
    });

    test('arbitrary radix float #36rZZ.5 is tokenized', () => {
        const state: any = null;
        const code = '(#36rZZ.5)';
        const { token } = findToken(code, '#36rZZ.5', state);
        assert.ok(token, 'Token #36rZZ.5 should be found');
        assert.ok(
            token!.scopes.includes('constant.numeric.scheme'),
            `Expected #36rZZ.5 to have scope constant.numeric.scheme, got: ${token!.scopes.join(' ')}`
        );
    });

    test('quoted fixnum vector \'#vfx(1 2) tokenizes quote and vector separately', () => {
        const state: any = null;
        const code = "'#vfx(1 2)";
        const result = grammar.tokenizeLine(code, state);
        const tokens = result.tokens.map(t => ({
            text: code.substring(t.startIndex, t.endIndex),
            scopes: t.scopes
        }));
        // The ' should be quote punctuation
        const quoteTok = tokens.find(t => t.text === "'");
        assert.ok(quoteTok, 'Token \' should be found');
        assert.ok(
            quoteTok!.scopes.some(s => s.includes('quoted') || s.includes('quote')),
            `Expected ' to have a quote scope, got: ${quoteTok!.scopes.join(' ')}`
        );
        // The #vfx( should be vector begin
        const vectorBegin = tokens.find(t => t.text === '#vfx(');
        assert.ok(vectorBegin, 'Token #vfx( should be found');
        assert.ok(
            vectorBegin!.scopes.includes('punctuation.definition.fixnum-vector.begin.scheme'),
            `Expected #vfx( to have scope punctuation.definition.fixnum-vector.begin.scheme, got: ${vectorBegin!.scopes.join(' ')}`
        );
    });
});
