import * as vscode from "vscode";
import { quote } from "shell-quote";
import * as path from "path";
import * as os from "os";

export const isWindowsOS: () => boolean = () => process.platform === "win32";
export const isCmdExeShell: () => boolean = () => vscode.env.shell?.endsWith("cmd.exe") ?? false;
export const isPowershellShell: () => boolean =
  () => ["powershell.exe", "pwsh.exe", "pwsh"].some(p => vscode.env.shell?.endsWith(p) ?? false);

export function quoteWindowsPath(filePath: string, isExecutable: boolean): string {
  // Escape cmd.exe special characters: & | < > ^ % and whitespace
  if (isCmdExeShell()) {
    if (/[\s&|<>^%]/.test(filePath)) {
      return `"${filePath.replace(/"/g, '""').replace(/%/g, '%%')}"`;
    }
    return filePath;
  }
  // Escape PowerShell special characters: $ ` " ' and whitespace
  if (isPowershellShell()) {
    if (/[\s$`"']/.test(filePath)) {
      const escaped = filePath.replace(/'/g, "''");
      if (isExecutable) {
        return `& '${escaped}'`;
      }
      return `'${escaped}'`;
    }
    if (isExecutable) {
      return `& '${filePath}'`;
    }
    return filePath;
  }
  // Generic shell (Git Bash, MSYS2, etc.)
  if (/[\s'"]/.test(filePath)) {
    return quote([filePath]);
  }
  return filePath;
}

function resolveTilde(filePath: string): string {
  if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

function normalizeFilePath(filePath: string): string {
  if (isWindowsOS()) {
    return filePath.replace(/\\/g, "/");
  }
  return filePath;
}

export function withLanguageServer(func: (command: string, args: string[]) => void): void {
  const command = vscode.workspace
    .getConfiguration("magicScheme.scheme-langserver")
    .get<string>("serverPath");
  const log = vscode.workspace
    .getConfiguration("magicScheme.scheme-langserver")
    .get<string>("logPath");
  const multiThread = vscode.workspace
    .getConfiguration("magicScheme.scheme-langserver")
    .get<string>("multiThread");
  const typeInference = vscode.workspace
    .getConfiguration("magicScheme.scheme-langserver")
    .get<string>("typeInference");
  const topEnvironment = vscode.workspace
    .getConfiguration("magicScheme.scheme-langserver")
    .get<string>("topEnvironment");

  if (!command) {
    vscode.window.showErrorMessage(
      'scheme-langserver not found. Please install it or set "magicScheme.scheme-langserver.serverPath".'
    );
    return;
  }

  const resolvedLog = resolveTilde(log || "~/scheme-langserver.log");
  const resolvedMultiThread = multiThread || "enable";
  const resolvedTypeInference = typeInference || "disable";
  const resolvedTopEnvironment = topEnvironment || "R6RS";

  const args: string[] = [
    "-l", resolvedLog,
    "-m", resolvedMultiThread,
    "-t", resolvedTypeInference,
    "-e", resolvedTopEnvironment,
  ];
  func(command, args);
}

export function withScheme(func: (command: string[]) => void): void {
  const scheme = vscode.workspace.getConfiguration("magicScheme.scheme").get<string>("path");
  if (scheme !== undefined && scheme !== "") {
    func([scheme]);
  } else {
    vscode.window.showErrorMessage(
      "Please configure the path to the scheme executable in settings.",
    );
  }
}

export function withREPL(func: (command: string[]) => void): void {
  const scheme = vscode.workspace.getConfiguration("magicScheme.scheme").get<string>("path");
  const args = vscode.workspace.getConfiguration("magicScheme.scheme").get<string[]>("arguments");
  if (scheme !== undefined && scheme !== "" && args !== undefined) {
    func([scheme, ...args]);
  } else {
    vscode.window.showErrorMessage(
      "Please configure the path to the scheme executable and the arguments for launching a REPL in settings.",
    );
  }
}

export function withEditor(func: (vscodeEditor: vscode.TextEditor) => void): void {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    func(editor);
  } else {
    vscode.window.showErrorMessage("A file must be opened before you can do that");
  }
}

export function withFilePath(func: (filePath: string) => void): void {
  withEditor((editor: vscode.TextEditor) => func(normalizeFilePath(editor.document.fileName)));
}

export function withWorkspacePath(func: (workspacePath: string) => void): boolean {
  let found = false;
  withFilePath(
    (filePath: string) => {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
      if (workspaceFolder) {
        found = true;
        return func(workspaceFolder.uri.fsPath);
      }
      vscode.window.showErrorMessage("The current file is not inside a workspace folder.");
    });
  return found;
}
