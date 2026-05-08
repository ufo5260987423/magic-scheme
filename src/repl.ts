import { quote } from "shell-quote";
import * as vscode from "vscode";
import * as path from "path";
import { withWorkspacePath, isCmdExeShell, isPowershellShell, isWindowsOS, quoteWindowsPath } from "./utils";
import { existsSync } from 'fs';

function fileName(filePath: string): string {
  return path.basename(filePath);
}

export function runFileInTerminal(
  command: string[],
  filePath: string,
  terminal: vscode.Terminal,
): void {
  terminal.show();

  if (isWindowsOS()) {
    terminal.sendText(isPowershellShell() || isCmdExeShell() ? `cls` : `clear`);
    const schemeExePath = quoteWindowsPath(command[0], true);
    const quotedFilePath = quoteWindowsPath(filePath, false);
    terminal.sendText(`${schemeExePath} ${command.slice(1).join(' ')} ${quotedFilePath}`);
  } else {
    terminal.sendText(`clear`);
    withWorkspacePath((workspacePath: string) => {
      const akku = vscode.workspace.getConfiguration("magicScheme.akku").get<string>("path");
      if (akku && existsSync(path.join(workspacePath, "AKKU.manifest")) && !existsSync(path.join(workspacePath, ".akku", "akku"))) {
        terminal.sendText(quote([akku, "install"]));
      }
    });
    withWorkspacePath((workspacePath: string) => terminal.sendText(quote(["bash", path.join(workspacePath, ".akku", "env")])));
    terminal.sendText(quote([...command, filePath]));
  }
}

export function loadFileInRepl(filePath: string, repl: vscode.Terminal): void {
  repl.show();
  repl.sendText(quote([filePath]));
}

export function createTerminal(filePath: string | null): vscode.Terminal {
  let terminal;
  if (filePath) {
    const templateSetting: string | undefined = vscode.workspace
      .getConfiguration("magicScheme.scheme.outputTerminal")
      .get("outputTerminalTitle");
    const template = templateSetting && templateSetting !== "" ? templateSetting : "Output ($name)";
    terminal = vscode.window.createTerminal(template.replace("$name", fileName(filePath)));
  } else {
    const templateSetting: string | undefined = vscode.workspace
      .getConfiguration("magicScheme.scheme.outputTerminal")
      .get("sharedOutputTerminalTitle");
    const template = templateSetting && templateSetting !== "" ? templateSetting : "Scheme Output";
    terminal = vscode.window.createTerminal(template);
  }
  terminal.show();
  return terminal;
}

export function createRepl(filePath: string, command: string[]): vscode.Terminal {
  const templateSetting: string | undefined = vscode.workspace
    .getConfiguration("magicScheme.scheme.REPL")
    .get("title");
  const template = templateSetting && templateSetting !== "" ? templateSetting : "REPL ($name)";
  const repl = vscode.window.createTerminal(template.replace("$name", fileName(filePath)));
  repl.show();

  if (isWindowsOS()) {
    const schemeExePath = quoteWindowsPath(command[0], true);
    const quotedFilePath = quoteWindowsPath(filePath, false);
    let fullCommand = `${schemeExePath} ${command.slice(1).join(' ')}`;
    if (isCmdExeShell()) {
      fullCommand += `${quotedFilePath}`;
    } else if (isPowershellShell()) {
      fullCommand += quotedFilePath;
    } else {
      fullCommand += quotedFilePath;
    }
    repl.sendText(fullCommand);
  } else {
    withWorkspacePath((workspacePath: string) => {
      const akku = vscode.workspace.getConfiguration("magicScheme.akku").get<string>("path");
      if (akku && existsSync(path.join(workspacePath, "AKKU.manifest")) && !existsSync(path.join(workspacePath, ".akku", "akku"))) {
        repl.sendText(quote([akku, "install"]));
      }
    });
    withWorkspacePath((workspacePath: string) => repl.sendText(quote(["bash", path.join(workspacePath, ".akku", "env")])));
    repl.sendText(quote([...command]));
  }

  return repl;
}
