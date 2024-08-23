import * as vscode from "vscode";
import { existsSync } from 'fs';

export const isWindowsOS: () => boolean = () => process.platform === "win32";
export const isCmdExeShell: () => boolean = () => vscode.env.shell.endsWith("cmd.exe");
export const isPowershellShell: () => boolean =
  () => ["powershell.exe", "pwsh.exe", "pwsh"].some(p => vscode.env.shell.endsWith(p));

export function quoteWindowsPath(path: string, isRacketExe: boolean): string {
  if (/\s/.test(path)) { // quote the path only if it contains whitespaces
    if (isCmdExeShell()) {
      path = `"${path}"`;
    } else if (isPowershellShell() && isRacketExe) {
      path = `& '${path}'`;
    } else {
      path = `'${path}'`;
    }
  }
  return path;
}

function normalizeFilePath(filePath: string): string {
  if (isWindowsOS()) {
    return filePath.replace(/\\/g, "/");
  }
  return filePath;
}

export function withLanguageServer(func: (command: string, args: string[]) => void): void {
  const command = vscode.workspace
    .getConfiguration("scheme-langserver")
    .get<string>("serverPath");
  const log= vscode.workspace
    .getConfiguration("scheme-langserver")
    .get<string>("logPath");
  const multiThread= vscode.workspace
    .getConfiguration("scheme-langserver")
    .get<string>("multiThread");
  const typeInference= vscode.workspace
    .getConfiguration("scheme-langserver")
    .get<string>("typeInference");
  const args:string[] = [log, multiThread,typeInference];

  if (command !== undefined && command !== "" && args !== undefined) {
    func(command, args);
  } else {
    vscode.window.showErrorMessage(
      `Invalid command for launching the language server. Please set the command in settings.`,
    );
  }
}

export function withScheme(func: (command: string[]) => void): void {
  const scheme= vscode.workspace.getConfiguration("scheme").get<string>("path");
  if (scheme!== undefined && scheme!== "") {
    func([scheme]);
  } else {
    vscode.window.showErrorMessage(
      "Please configure the path to the scheme executable in settings.",
    );
  }
}

export function withREPL(func: (command: string[]) => void): void {
  const scheme= vscode.workspace.getConfiguration("scheme").get<string>("path");
  const args = vscode.workspace.getConfiguration("scheme").get<string[]>("arguments");
  if (scheme!== undefined && scheme!== "" && args !== undefined) {
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

export function withWorkspacePath(func: (workspacePath: string) => void): void {
  withFilePath(
    (filePath:string) => 
      {
        const workspaceFolder=vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(filePath));
        if (workspaceFolder){
          return func(workspaceFolder.uri.path);
        }
      });
}