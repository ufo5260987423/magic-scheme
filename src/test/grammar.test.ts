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

    test('sexp-comment #; includes vector #(', () => {
        const state: any = null;
        const code = '#;#(1 2)';
        const result = grammar.tokenizeLine(code, state);
        const tokens = result.tokens.map(t => ({
            text: code.substring(t.startIndex, t.endIndex),
            scopes: t.scopes
        }));
        const vectorBegin = tokens.find(t => t.text === '#(');
        assert.ok(vectorBegin, 'Token #( should be found in sexp-comment');
        assert.ok(
            vectorBegin!.scopes.includes('punctuation.definition.vector.begin.scheme'),
            `Expected #( to have vector begin scope in sexp-comment, got: ${vectorBegin!.scopes.join(' ')}`
        );
    });

    test('sexp-comment #; includes bytevector #vu8(', () => {
        const state: any = null;
        const code = '#;#vu8(1 2)';
        const result = grammar.tokenizeLine(code, state);
        const tokens = result.tokens.map(t => ({
            text: code.substring(t.startIndex, t.endIndex),
            scopes: t.scopes
        }));
        const bvBegin = tokens.find(t => t.text === '#vu8(');
        assert.ok(bvBegin, 'Token #vu8( should be found in sexp-comment');
        assert.ok(
            bvBegin!.scopes.includes('punctuation.definition.bytevector.begin.scheme'),
            `Expected #vu8( to have bytevector begin scope in sexp-comment, got: ${bvBegin!.scopes.join(' ')}`
        );
    });

    test('quoted context includes comment', () => {
        const state: any = null;
        const line1 = "'(a ; comment";
        const result1 = grammar.tokenizeLine(line1, state);
        const tokens1 = result1.tokens.map(t => ({
            text: line1.substring(t.startIndex, t.endIndex),
            scopes: t.scopes
        }));
        const hasComment = tokens1.some(t => t.scopes.includes('comment.line.semicolon.scheme'));
        assert.ok(hasComment, 'Comment scope should be found inside quoted context');
    });

    test('directive #!true #!false #!null are tokenized', () => {
        const state: any = null;
        for (const tok of ['#!true', '#!false', '#!null']) {
            const { token } = findToken(tok, tok, state);
            assert.ok(token, `Token ${tok} should be found`);
            assert.ok(
                token!.scopes.includes('constant.language.directive.scheme'),
                `Expected ${tok} to have scope constant.language.directive.scheme, got: ${token!.scopes.join(' ')}`
            );
        }
    });

    test('primitive #n% is tokenized', () => {
        const state: any = null;
        const code = '(#2%car)';
        const { token } = findToken(code, '#2%', state);
        assert.ok(token, 'Token #2% should be found');
        assert.ok(
            token!.scopes.includes('constant.other.primitive.scheme'),
            `Expected #2% to have scope constant.other.primitive.scheme, got: ${token!.scopes.join(' ')}`
        );
    });

    test('string escape \' is tokenized', () => {
        const state: any = null;
        const code = '"it\'s"';
        const result = grammar.tokenizeLine(code, state);
        const tokens = result.tokens.map(t => ({
            text: code.substring(t.startIndex, t.endIndex),
            scopes: t.scopes
        }));
        const esc = tokens.find(t => t.text === "'");
        assert.ok(esc, 'Token \' should be found in string');
        assert.ok(
            esc!.scopes.includes('constant.character.escape.scheme'),
            `Expected ' to have escape scope, got: ${esc!.scopes.join(' ')}`
        );
    });

    test('string escape octal \\000 is tokenized', () => {
        const state: any = null;
        const code = String.raw`"a\000b"`;
        const result = grammar.tokenizeLine(code, state);
        const tokens = result.tokens.map(t => ({
            text: code.substring(t.startIndex, t.endIndex),
            scopes: t.scopes
        }));
        const esc = tokens.find(t => t.text === '\\000');
        assert.ok(esc, 'Token \\000 should be found in string');
        assert.ok(
            esc!.scopes.includes('constant.character.escape.scheme'),
            `Expected \\000 to have escape scope, got: ${esc!.scopes.join(' ')}`
        );
    });

    test('gensym-prefix #: with braces is tokenized', () => {
        const state: any = null;
        const code = '(#:{x})';
        const { token } = findToken(code, '#:{x}', state);
        assert.ok(token, 'Token #:{x} should be found');
        assert.ok(
            token!.scopes.includes('constant.other.gensym.scheme'),
            `Expected #:{x} to have scope constant.other.gensym.scheme, got: ${token!.scopes.join(' ')}`
        );
    });
    test('square brackets [foo bar] are tokenized as expressions', () => {
        const state: any = null;
        const code = '[foo bar]';
        const result = grammar.tokenizeLine(code, state);
        const tokens = result.tokens.map(t => ({
            text: code.substring(t.startIndex, t.endIndex),
            scopes: t.scopes
        }));
        const bracketBegin = tokens.find(t => t.text === '[');
        assert.ok(bracketBegin, 'Token [ should be found');
        assert.ok(
            bracketBegin!.scopes.includes('punctuation.section.expression.begin.scheme'),
            `Expected [ to have expression begin scope, got: ${bracketBegin!.scopes.join(' ')}`
        );
        const bracketEnd = tokens.find(t => t.text === ']');
        assert.ok(bracketEnd, 'Token ] should be found');
        assert.ok(
            bracketEnd!.scopes.includes('punctuation.section.expression.end.scheme'),
            `Expected ] to have expression end scope, got: ${bracketEnd!.scopes.join(' ')}`
        );
    });

    test('complex number 1+2i is tokenized as numeric', () => {
        const state: any = null;
        const code = '(1+2i)';
        const { token } = findToken(code, '1+2i', state);
        assert.ok(token, 'Token 1+2i should be found');
        assert.ok(
            token!.scopes.includes('constant.numeric.scheme'),
            `Expected 1+2i to have scope constant.numeric.scheme, got: ${token!.scopes.join(' ')}`
        );
    });

    test('quasiquote backtick is tokenized as quote', () => {
        const state: any = null;
        const code = '`test';
        const result = grammar.tokenizeLine(code, state);
        const tokens = result.tokens.map(t => ({
            text: code.substring(t.startIndex, t.endIndex),
            scopes: t.scopes
        }));
        const quoteTok = tokens.find(t => t.text === '`');
        assert.ok(quoteTok, 'Token ` should be found');
        assert.ok(
            quoteTok!.scopes.some(s => s.includes('quoted') || s.includes('quote')),
            `Expected \` to have a quote scope, got: ${quoteTok!.scopes.join(' ')}`
        );
    });

    test('unquote-splicing ,@ is tokenized as quote', () => {
        const state: any = null;
        const code = ',@lst';
        const result = grammar.tokenizeLine(code, state);
        const tokens = result.tokens.map(t => ({
            text: code.substring(t.startIndex, t.endIndex),
            scopes: t.scopes
        }));
        const quoteTok = tokens.find(t => t.text === ',@');
        assert.ok(quoteTok, 'Token ,@ should be found');
        assert.ok(
            quoteTok!.scopes.some(s => s.includes('quoted') || s.includes('quote')),
            `Expected ,@ to have a quote scope, got: ${quoteTok!.scopes.join(' ')}`
        );
    });

    test('ellipsis ... is tokenized as keyword.control', () => {
        const state: any = null;
        const code = '(...)';
        const { token } = findToken(code, '...', state);
        assert.ok(token, 'Token ... should be found');
        assert.ok(
            token!.scopes.includes('keyword.control.scheme'),
            `Expected ... to have scope keyword.control.scheme, got: ${token!.scopes.join(' ')}`
        );
    });

    test('arbitrary 3-char identifier is NOT mis-tokenized as keyword.control', () => {
        const state: any = null;
        const code = '(foo)';
        const result = grammar.tokenizeLine(code, state);
        const tokens = result.tokens.map(t => ({
            text: code.substring(t.startIndex, t.endIndex),
            scopes: t.scopes
        }));
        const fooTok = tokens.find(t => t.text === 'foo');
        assert.ok(fooTok, 'Token foo should be found');
        assert.ok(
            !fooTok!.scopes.some(s => s.includes('keyword.control')),
            `Expected foo NOT to have keyword.control scope, got: ${fooTok!.scopes.join(' ')}`
        );
    });

    test('syntax-rules pattern with ... tokenizes correctly', () => {
        const state: any = null;
        const code = '(syntax-rules () ((_ x ...) x))';
        const result = grammar.tokenizeLine(code, state);
        const tokens = result.tokens.map(t => ({
            text: code.substring(t.startIndex, t.endIndex),
            scopes: t.scopes
        }));
        const syntaxRulesTok = tokens.find(t => t.text === 'syntax-rules');
        assert.ok(syntaxRulesTok, 'Token syntax-rules should be found');
        assert.ok(
            syntaxRulesTok!.scopes.includes('keyword.control.scheme'),
            `Expected syntax-rules to have keyword.control.scheme, got: ${syntaxRulesTok!.scopes.join(' ')}`
        );
        const ellipsisTok = tokens.find(t => t.text === '...');
        assert.ok(ellipsisTok, 'Token ... should be found');
        assert.ok(
            ellipsisTok!.scopes.includes('keyword.control.scheme'),
            `Expected ... to have keyword.control.scheme, got: ${ellipsisTok!.scopes.join(' ')}`
        );
        for (const tok of tokens) {
            if (tok.text === 'syntax-rules' || tok.text === '...') {
                continue;
            }
            assert.ok(
                !tok.scopes.some(s => s.includes('keyword.control')),
                `Expected no non-keyword token to have keyword.control scope, but found: ${tok.text} => ${tok.scopes.join(' ')}`
            );
        }
    });

    test('lambda declaration inside square brackets is tokenized', () => {
        const state: any = null;
        const code = '[lambda (x) x]';
        const result = grammar.tokenizeLine(code, state);
        const tokens = result.tokens.map(t => ({
            text: code.substring(t.startIndex, t.endIndex),
            scopes: t.scopes
        }));
        const lambdaTok = tokens.find(t => t.text === 'lambda');
        assert.ok(lambdaTok, 'Token lambda should be found');
        assert.ok(
            lambdaTok!.scopes.includes('meta.declaration.procedure.scheme'),
            `Expected lambda to have meta.declaration.procedure.scheme, got: ${lambdaTok!.scopes.join(' ')}`
        );
        assert.ok(
            lambdaTok!.scopes.includes('keyword.control.scheme'),
            `Expected lambda to have keyword.control.scheme, got: ${lambdaTok!.scopes.join(' ')}`
        );
        const xTok = tokens.find(t => t.text === 'x');
        assert.ok(xTok, 'Token x should be found');
        assert.ok(
            xTok!.scopes.includes('variable.parameter.scheme'),
            `Expected x to have variable.parameter.scheme, got: ${xTok!.scopes.join(' ')}`
        );
    });

    function assertTokenScope(code: string, target: string, expectedScope: string, msg?: string) {
        const state: any = null;
        const result = grammar.tokenizeLine(code, state);
        const tokens = result.tokens.map(t => ({
            text: code.substring(t.startIndex, t.endIndex),
            scopes: t.scopes
        }));
        const tok = tokens.find(t => t.text === target);
        assert.ok(tok, `Token ${target} should be found in "${code}"`);
        assert.ok(
            tok!.scopes.some(s => s.includes(expectedScope)),
            msg || `Expected ${target} to have scope including ${expectedScope}, got: ${tok!.scopes.join(' ')}`
        );
    }

    test('syntax-case keywords are classified as keyword.control', () => {
        assertTokenScope('(quasisyntax x)', 'quasisyntax', 'keyword.control');
        assertTokenScope('(unsyntax x)', 'unsyntax', 'keyword.control');
        assertTokenScope('(unsyntax-splicing x)', 'unsyntax-splicing', 'keyword.control');
    });

    test('Chez-specific procedures are classified as support.function', () => {
        assertTokenScope('(make-list 3 \'a)', 'make-list', 'support.function.general');
        assertTokenScope('(call/1cc f)', 'call/1cc', 'support.function.general');
        assertTokenScope('(make-engine thunk)', 'make-engine', 'support.function.general');
        assertTokenScope('(logand 1 2)', 'logand', 'support.function.general');
        assertTokenScope('(fxlogbit? 0 1)', 'fxlogbit?', 'support.function.general');
        assertTokenScope('(flnonpositive? -1.0)', 'flnonpositive?', 'support.function.general');
        assertTokenScope('(-1+ 5)', '-1+', 'support.function.general');
    });

    test('Chez syntax forms are classified as keyword.control', () => {
        assertTokenScope('(define-syntax foo (syntax-rules ()))', 'define-syntax', 'keyword.control');
        assertTokenScope('(eval-when (compile) x)', 'eval-when', 'keyword.control');
        assertTokenScope('(with-interrupts-disabled x)', 'with-interrupts-disabled', 'keyword.control');
        assertTokenScope('(critical-section x)', 'critical-section', 'keyword.control');
        assertTokenScope('(datum x)', 'datum', 'keyword.control');
        assertTokenScope('(define-property x y z)', 'define-property', 'keyword.control');
        assertTokenScope('(with-implicit (id x) y)', 'with-implicit', 'keyword.control');
        assertTokenScope('(meta-cond (else x))', 'meta-cond', 'keyword.control');
        assertTokenScope('(implicit-exports #t)', 'implicit-exports', 'keyword.control');
        assertTokenScope('(library-group (foo))', 'library-group', 'keyword.control');
        assertTokenScope('(extend-syntax (foo) ...)', 'extend-syntax', 'keyword.control');
        assertTokenScope('(define-condition-type &c (&condition) c?)', 'define-condition-type', 'keyword.control');
    });

    test('Chez system procedures are classified as support.function', () => {
        assertTokenScope('(visit "foo.so")', 'visit', 'support.function.general');
        assertTokenScope('(system "ls")', 'system', 'support.function.general');
        assertTokenScope('(expand/optimize x)', 'expand/optimize', 'support.function.general');
        assertTokenScope('(apropos "foo")', 'apropos', 'support.function.general');
        assertTokenScope('(top-level-value \'x)', 'top-level-value', 'support.function.general');
        assertTokenScope('(fork-thread thunk)', 'fork-thread', 'support.function.general');
        assertTokenScope('(make-fxvector 3)', 'make-fxvector', 'support.function.general');
        assertTokenScope('(enumerate 3)', 'enumerate', 'support.function.general');
        assertTokenScope('(syntax-error x)', 'syntax-error', 'support.function.general');
        assertTokenScope('(annotation? x)', 'annotation?', 'support.function.boolean-test');
        assertTokenScope('(environment? x)', 'environment?', 'support.function.boolean-test');
        assertTokenScope('(syntax->list x)', 'syntax->list', 'support.function.general');
        assertTokenScope('(make-guardian)', 'make-guardian', 'support.function.general');
        assertTokenScope('(library-requirements (foo))', 'library-requirements', 'support.function.general');
        assertTokenScope('(make-hash-table)', 'make-hash-table', 'support.function.general');
        assertTokenScope('(raise-continuable exn)', 'raise-continuable', 'support.function.general');
        assertTokenScope('(assertion-violation \'who "msg")', 'assertion-violation', 'support.function.general');
        assertTokenScope('(syntax-violation \'who "msg" form)', 'syntax-violation', 'support.function.general');
        assertTokenScope('(make-error)', 'make-error', 'support.function.general');
    });

    test('Chez boolean predicates are classified as support.function.boolean-test', () => {
        assertTokenScope('(fixnum? x)', 'fixnum?', 'support.function.boolean-test');
        assertTokenScope('(bignum? x)', 'bignum?', 'support.function.boolean-test');
        assertTokenScope('(box? x)', 'box?', 'support.function.boolean-test');
        assertTokenScope('(port-closed? p)', 'port-closed?', 'support.function.boolean-test');
        assertTokenScope('(thread-condition? x)', 'thread-condition?', 'support.function.boolean-test');
        assertTokenScope('(real-valued? x)', 'real-valued?', 'support.function.boolean-test');
        assertTokenScope('(boolean=? #t #t)', 'boolean=?', 'support.function.boolean-test');
    });

    test('R6RS procedures are classified as support.function', () => {
        assertTokenScope('(filter odd? lst)', 'filter', 'support.function.general');
        assertTokenScope('(string-map char-upcase s)', 'string-map', 'support.function.general');
        assertTokenScope('(vector-sort < v)', 'vector-sort', 'support.function.general');
        assertTokenScope('(for-all positive? lst)', 'for-all', 'support.function.general');
        assertTokenScope('(exists positive? lst)', 'exists', 'support.function.general');
        assertTokenScope('(bitwise-and 1 2)', 'bitwise-and', 'support.function.general');
        assertTokenScope('(bitwise-bit-set? 1 0)', 'bitwise-bit-set?', 'support.function.general');
        assertTokenScope('(div-and-mod 10 3)', 'div-and-mod', 'support.function.general');
        assertTokenScope('(char-foldcase #A)', 'char-foldcase', 'support.function.general');
    });

});
