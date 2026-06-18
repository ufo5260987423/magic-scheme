import * as vscode from "vscode";
import { quote } from "shell-quote";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

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
  if (filePath === '~' || filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return path.join(os.homedir(), filePath.slice(filePath.startsWith('~\\') ? 2 : 1));
  }
  return filePath;
}

function normalizeFilePath(filePath: string): string {
  if (isWindowsOS()) {
    return filePath.replace(/\\/g, "/");
  }
  return filePath;
}

export interface ProjectConfig {
  topEnvironment?: string;
  multiThread?: string;
  typeInference?: string;
  logPath?: string;
  cachePath?: string;
}

export function readProjectConfig(workspacePath: string): ProjectConfig | undefined {
  const configPath = path.join(workspacePath, '.vscode', 'magic-scheme.json');
  if (!fs.existsSync(configPath)) {
    return undefined;
  }
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(content) as ProjectConfig;
  } catch {
    vscode.window.showWarningMessage(
      `Failed to parse .vscode/magic-scheme.json in ${workspacePath}. Using hard-coded defaults.`
    );
    return undefined;
  }
}

export function getCurrentWorkspacePath(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (folder) {
      return folder.uri.fsPath;
    }
  }
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    return vscode.workspace.workspaceFolders[0].uri.fsPath;
  }
  return undefined;
}

export const DEFAULT_SERVER_CONFIG: Required<ProjectConfig> = {
  topEnvironment: 'R6RS',
  multiThread: 'enable',
  typeInference: 'enable',
  logPath: '.vscode/scheme-langserver.log',
  cachePath: '.vscode/scheme-langserver-cache',
};

export interface EffectiveServerConfig {
  command: string | undefined;
  log: string;
  multiThread: string;
  typeInference: string;
  topEnvironment: string;
  cachePath: string;
  workspacePath: string | undefined;
  projectConfigFound: boolean;
}

export function getEffectiveServerConfig(): EffectiveServerConfig | undefined {
  const vscodeConfig = vscode.workspace.getConfiguration("magicScheme.scheme-langserver");
  const command = vscodeConfig.get<string>("serverPath");

  if (!command) {
    return undefined;
  }

  const workspacePath = getCurrentWorkspacePath();
  const projectConfig = workspacePath ? readProjectConfig(workspacePath) : undefined;
  const defaults = DEFAULT_SERVER_CONFIG;

  return {
    command,
    log: projectConfig?.logPath ?? defaults.logPath,
    multiThread: projectConfig?.multiThread ?? defaults.multiThread,
    typeInference: projectConfig?.typeInference ?? defaults.typeInference,
    topEnvironment: projectConfig?.topEnvironment ?? defaults.topEnvironment,
    cachePath: projectConfig?.cachePath ?? defaults.cachePath,
    workspacePath,
    projectConfigFound: !!projectConfig,
  };
}

export function withLanguageServer(
  func: (command: string, args: string[]) => void,
  enableCachePath = false
): void {
  const effective = getEffectiveServerConfig();
  if (!effective) {
    vscode.window.showErrorMessage(
      'scheme-langserver not found. Please install it or set "magicScheme.scheme-langserver.serverPath".'
    );
    return;
  }

  const command = effective.command;
  if (!command) {
    return;
  }
  const log = effective.log;
  const multiThread = effective.multiThread;
  const typeInference = effective.typeInference;
  const topEnvironment = effective.topEnvironment;
  const cachePath = effective.cachePath;

  // Resolve relative paths against the workspace root so that LanguageClient
  // spawns the binary from the correct CWD.
  let resolvedCommand = command;
  if (!path.isAbsolute(command) && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    resolvedCommand = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, command);
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

  if (enableCachePath && cachePath) {
    const resolvedCachePath = resolveTilde(cachePath);
    const absoluteCachePath = path.isAbsolute(resolvedCachePath)
      ? resolvedCachePath
      : path.join(effective.workspacePath || '', resolvedCachePath);
    try {
      fs.mkdirSync(absoluteCachePath, { recursive: true });
    } catch {
      // ignore: scheme-langserver will report if it cannot use the path
    }
    args.push("-c", absoluteCachePath);
  }

  func(resolvedCommand, args);
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
  if (scheme !== undefined && scheme !== "") {
    func(args !== undefined ? [scheme, ...args] : [scheme]);
  } else {
    vscode.window.showErrorMessage(
      "Please configure the path to the scheme executable in settings.",
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
