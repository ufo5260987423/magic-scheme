import { quote } from "shell-quote";
import * as vscode from "vscode";
import * as path from "path";
import { withWorkspacePath, isCmdExeShell, isPowershellShell, isWindowsOS, quoteWindowsPath } from "./utils";
import { existsSync } from 'fs';

function fileName(filePath: string): string {
  return path.basename(filePath);
}

function toSchemeString(filePath: string): string {
  return '"' + filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function sendAkkuSetup(terminal: vscode.Terminal, workspacePath: string): void {
  const akku = vscode.workspace.getConfiguration("magicScheme.akku").get<string>("path");
  const manifestPath = path.join(workspacePath, "AKKU.manifest");
  const akkuBinPath = path.join(workspacePath, ".akku", "akku");
  const envPath = path.join(workspacePath, ".akku", "env");

  if (!existsSync(manifestPath)) {
    return; // No AKKU project, nothing to do
  }

  if (akku && !existsSync(akkuBinPath)) {
    terminal.sendText(quote([akku, "install"]));
  }

  if (existsSync(envPath)) {
    terminal.sendText(quote(["sh", envPath]));
  }
}

function sendSchemeCommand(
  terminal: vscode.Terminal,
  command: string[],
  filePath: string
): void {
  if (isWindowsOS()) {
    terminal.sendText(isPowershellShell() || isCmdExeShell() ? `cls` : `clear`);
    const schemeExePath = quoteWindowsPath(command[0], true);
    const args = command.slice(1).map((a) => quoteWindowsPath(a, false));
    const quotedFilePath = quoteWindowsPath(filePath, false);
    const allParts = [schemeExePath, ...args, quotedFilePath].filter((p) => p !== "");
    terminal.sendText(allParts.join(" "));
  } else {
    terminal.sendText(`clear`);
    withWorkspacePath((workspacePath: string) => {
      sendAkkuSetup(terminal, workspacePath);
    });
    terminal.sendText(quote([...command, filePath]));
  }
}

export function runFileInTerminal(
  command: string[],
  filePath: string,
  terminal: vscode.Terminal,
): void {
  terminal.show();
  sendSchemeCommand(terminal, command, filePath);
}

export function loadFileInRepl(filePath: string, repl: vscode.Terminal): void {
  repl.show();
  repl.sendText(`(load ${toSchemeString(filePath)})`);
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
  sendSchemeCommand(repl, command, filePath);
  return repl;
}
