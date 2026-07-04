import { defineConfig } from '@vscode/test-cli';
import { existsSync } from 'fs';
import { execSync } from 'child_process';

function findVSCode() {
    // 1. Try NixOS-specific Electron binary path
    try {
        const codePath = execSync('readlink -f $(which code 2>/dev/null)', { encoding: 'utf8' }).trim();
        const nixosPath = codePath.replace('/bin/code', '/lib/vscode/code');
        if (existsSync(nixosPath)) {
            return nixosPath;
        }
    } catch {
        // ignore
    }

    // 2. Try standard VS Code CLI
    try {
        const codePath = execSync('which code 2>/dev/null || which codium 2>/dev/null || which code-oss 2>/dev/null', { encoding: 'utf8' }).trim();
        if (codePath && existsSync(codePath)) {
            return codePath;
        }
    } catch {
        // ignore
    }

    // 3. Let vscode-test download automatically
    return undefined;
}

const localCode = findVSCode();

export default defineConfig([
    {
        label: 'unit',
        files: ['out/test/utils.test.js', 'out/test/download.test.js', 'out/test/grammar.test.js'],
        workspaceFolder: './testFixture',
        useInstallation: localCode ? { fromPath: localCode } : undefined
    },
    {
        label: 'mock-lifecycle',
        files: 'out/test/lifecycle.test.js',
        workspaceFolder: './testFixture',
        useInstallation: localCode ? { fromPath: localCode } : undefined
    },
    {
        label: 'e2e',
        files: 'out/test/e2e.test.js',
        workspaceFolder: './testFixture',
        useInstallation: localCode ? { fromPath: localCode } : undefined
    }
]);
