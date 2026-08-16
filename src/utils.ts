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

export function resolveTilde(filePath: string): string {
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
  fileFilter?: string | string[];
  packageManager?: string;
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

export function resolveServerPath(command: string): string {
  if (path.isAbsolute(command)) {
    return command;
  }
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    return path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, command);
  }
  return command;
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

export const DEFAULT_SERVER_CONFIG: {
  topEnvironment: string;
  multiThread: string;
  typeInference: string;
  logPath: string;
  cachePath: string;
} = {
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
  fileFilter?: string;
  packageManager?: string;
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

  const fileFilterRaw = projectConfig?.fileFilter;
  const fileFilter = Array.isArray(fileFilterRaw)
    ? fileFilterRaw.join(',')
    : fileFilterRaw;

  return {
    command,
    log: projectConfig?.logPath ?? defaults.logPath,
    multiThread: projectConfig?.multiThread ?? defaults.multiThread,
    typeInference: projectConfig?.typeInference ?? defaults.typeInference,
    topEnvironment: projectConfig?.topEnvironment ?? defaults.topEnvironment,
    cachePath: projectConfig?.cachePath ?? defaults.cachePath,
    fileFilter,
    packageManager: projectConfig?.packageManager,
    workspacePath,
    projectConfigFound: !!projectConfig,
  };
}

export async function withLanguageServer(
  func: (command: string, args: string[]) => void,
  enableCachePath = false
): Promise<void> {
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
      await fs.promises.mkdir(absoluteCachePath, { recursive: true });
    } catch {
      // ignore: scheme-langserver will report if it cannot use the path
    }
    args.push("-c", absoluteCachePath);
  }

  if (effective.fileFilter) {
    args.push("-f", effective.fileFilter);
  } else if (effective.packageManager) {
    args.push("-p", effective.packageManager);
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

const MANAGED_ASSOCIATIONS_STATE_KEY = 'magicSchemeManagedAssociations';

export function normalizeExtensionPattern(ext: string): string | undefined {
  const trimmed = ext.trim();
  if (!trimmed) {
    return undefined;
  }
  // Reject path-like or complex globs; only simple extension forms are supported.
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return undefined;
  }
  if (trimmed.includes('*')) {
    if (trimmed.startsWith('*.') && trimmed.length > 2) {
      return trimmed;
    }
    return undefined;
  }
  const withoutDot = trimmed.startsWith('.') ? trimmed.slice(1) : trimmed;
  if (!withoutDot) {
    return undefined;
  }
  return `*.${withoutDot}`;
}

export function computeUpdatedAssociations(
  currentAssociations: Record<string, string>,
  oldManaged: string[],
  extensions: string[],
): { associations: Record<string, string>; managed: string[] } {
  const normalized = extensions
    .map(normalizeExtensionPattern)
    .filter((p): p is string => p !== undefined);
  const managed = Array.from(new Set(normalized));
  const associations: Record<string, string> = { ...currentAssociations };

  // Remove entries that were previously managed by us but are no longer wanted.
  for (const pattern of oldManaged) {
    if (!managed.includes(pattern) && associations[pattern] === 'scheme') {
      delete associations[pattern];
    }
  }

  for (const pattern of managed) {
    associations[pattern] = 'scheme';
  }

  return { associations, managed };
}

function associationsEqual(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) {
    return false;
  }
  return keysA.every((key) => a[key] === b[key]);
}

export async function syncSchemeFileAssociations(context: vscode.ExtensionContext): Promise<void> {
  const raw = vscode.workspace.getConfiguration('magicScheme.scheme').get<string[]>('fileExtensions', []);
  const filesConfig = vscode.workspace.getConfiguration('files');
  const inspection = filesConfig.inspect<Record<string, string>>('associations');
  const hasWorkspace = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0;

  const useGlobal = !hasWorkspace;
  const currentAssociations = useGlobal
    ? (inspection?.globalValue ?? {})
    : (inspection?.workspaceValue ?? {});
  const state = useGlobal ? context.globalState : context.workspaceState;
  const oldManaged = state.get<string[]>(MANAGED_ASSOCIATIONS_STATE_KEY, []);

  const { associations, managed } = computeUpdatedAssociations(currentAssociations, oldManaged, raw);
  if (associationsEqual(currentAssociations, associations)) {
    return;
  }

  await state.update(MANAGED_ASSOCIATIONS_STATE_KEY, managed);
  await filesConfig.update('associations', associations, useGlobal);
}
