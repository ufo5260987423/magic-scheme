import { defineConfig } from '@vscode/test-cli';

// NixOS VS Code path: the actual Electron binary
const localCode = '/nix/store/axz721fxdbw4v2hp2ihd4v17ggvyz2xf-vscode-1.109.5/lib/vscode/code';

export default defineConfig([
    {
        label: 'unit',
        files: 'out/test/utils.test.js',
        workspaceFolder: '.',
        useInstallation: { fromPath: localCode }
    },
    {
        label: 'mock-lifecycle',
        files: 'out/test/lifecycle.test.js',
        workspaceFolder: '.',
        useInstallation: { fromPath: localCode }
    },
    {
        label: 'e2e',
        files: 'out/test/e2e.test.js',
        workspaceFolder: '.',
        useInstallation: { fromPath: localCode }
    }
]);
