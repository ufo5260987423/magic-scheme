import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, State } from "vscode-languageclient/node";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import * as com from "./commands";
import { TaskProvider } from "./tasks";
import { withLanguageServer, getEffectiveServerConfig, DEFAULT_SERVER_CONFIG, getCurrentWorkspacePath } from "./utils";
import { ensureLangserver, isExecutableAsync, checkForUpdate, getLatestRemoteVersion, readLocalVersion, updateLangserver, getLangserverVersion, isVersionAtLeast } from "./download";

let langClient: LanguageClient | undefined;
let currentClientState: State | undefined;
let stateListenerDisposable: vscode.Disposable | undefined;
let statusBarItem: vscode.StatusBarItem;
let currentServerVersion: string | undefined;

// Global flag to prevent file-watcher restart when we ourselves write the config file.
let isWritingProjectConfig = false;

export async function deactivate(): Promise<void> {
  process.off('unhandledRejection', uncaughtRejectionHandler);
  await disposeLangClient();
}

function printEnvironmentInfo(): vscode.OutputChannel {
  const channel = vscode.window.createOutputChannel("Scheme");
  channel.appendLine("Magic Scheme environment info");
  channel.appendLine("");
  channel.appendLine(`os.arch:            ${os.arch()}`);
  channel.appendLine(`os.platform:        ${os.platform()}`);
  channel.appendLine(`os.release:         ${os.release()}`);
  channel.appendLine(`os.version:         ${os.version()}`);
  channel.appendLine(`process.version:    ${process.version}`);
  channel.appendLine(`vscode.env.appHost: ${vscode.env.appHost}`);
  channel.appendLine(`vscode.env.appName: ${vscode.env.appName}`);
  channel.appendLine(`vscode.env.shell:   ${vscode.env.shell}`);

  try {
    const serverPath = vscode.workspace.getConfiguration("magicScheme.scheme-langserver").get<string>("serverPath");
    if (serverPath) {
      channel.appendLine(`scheme-langserver path: ${serverPath}`);
    }
  } catch {
    // ignore
  }

  try {
    const schemePath = vscode.workspace.getConfiguration("magicScheme.scheme").get<string>("path");
    if (schemePath) {
      channel.appendLine(`scheme executable:    ${schemePath}`);
    }
  } catch {
    // ignore
  }

  // Print effective LSP config (solely from .vscode/magic-scheme.json)
  try {
    const effective = getEffectiveServerConfig();
    if (effective) {
      channel.appendLine("");
      channel.appendLine("Effective scheme-langserver configuration (from .vscode/magic-scheme.json):");
      channel.appendLine(`  topEnvironment:  ${effective.topEnvironment}`);
      channel.appendLine(`  multiThread:     ${effective.multiThread}`);
      channel.appendLine(`  typeInference:   ${effective.typeInference}`);
      channel.appendLine(`  logPath:         ${effective.log}`);
      channel.appendLine(`  cachePath:       ${effective.cachePath}`);
      if (currentServerVersion) {
        const cacheEnabled = isVersionAtLeast(currentServerVersion, '2.1.3');
        channel.appendLine(`  version:         ${currentServerVersion}`);
        channel.appendLine(`  cache enabled:   ${cacheEnabled}`);
      } else {
        channel.appendLine(`  version:         unknown`);
        channel.appendLine(`  cache enabled:   false (version unknown)`);
      }
      channel.appendLine(`  project config:  ${path.join(effective.workspacePath || '', '.vscode', 'magic-scheme.json')}`);
    }
  } catch {
    // ignore
  }

  return channel;
}

function setupLSP(enableCachePath = false) {
  withLanguageServer((command: string, args: string[]) => {
    const executable = {
      command: command,
      args: args,
    };

    const serverOptions = {
      run: executable,
      debug: executable,
    };

    const clientOptions: LanguageClientOptions = {
      documentSelector: [{ language: "scheme" }],
      uriConverters: {
        code2Protocol: (uri) => uri.toString(true),
        protocol2Code: (str) => vscode.Uri.parse(str),
      },
    };

    langClient = new LanguageClient(
      "Magic Scheme",
      "Scheme Language Client",
      serverOptions,
      clientOptions,
    );
  }, enableCachePath);
}

async function disposeLangClient(): Promise<void> {
  if (stateListenerDisposable) {
    stateListenerDisposable.dispose();
    stateListenerDisposable = undefined;
  }
  if (langClient) {
    const client = langClient;
    langClient = undefined;
    currentClientState = undefined;
    await client.stop().catch((err) => console.error("Magic Scheme: failed to stop LSP client", err));
  }
}

function registerStateListener(): void {
  if (!langClient) {
    return;
  }
  // Dispose any previous listener to avoid duplicates on re-creation.
  if (stateListenerDisposable) {
    stateListenerDisposable.dispose();
    stateListenerDisposable = undefined;
  }
  stateListenerDisposable = langClient.onDidChangeState((event) => {
    currentClientState = event.newState;
    switch (event.newState) {
      case State.Starting:
        statusBarItem.text = "$(sync~spin) Initializing Scheme-langserver...";
        statusBarItem.tooltip = "Language Server is initializing...";
        statusBarItem.show();
        break;
      case State.Running:
        if (currentServerVersion) {
          statusBarItem.text = `$(check) Scheme-langserver ${currentServerVersion} Ready`;
          statusBarItem.tooltip = `Language Server ${currentServerVersion} is ready`;
        } else {
          statusBarItem.text = "$(check) Scheme-langserver Ready";
          statusBarItem.tooltip = "Language Server is ready";
        }
        statusBarItem.show();
        break;
      case State.Stopped:
        statusBarItem.text = "$(error) Scheme-langserver Error";
        statusBarItem.tooltip = "Language Server failed to initialize";
        statusBarItem.show();
        break;
      default:
        break;
    }
  });
}

function isInPath(command: string): boolean {
  const pathEnv = process.env.PATH || process.env.Path || process.env.path || '';
  const dirs = pathEnv.split(process.platform === 'win32' ? ';' : ':');
  const exeName = process.platform === 'win32' ? `${command}.exe` : command;
  for (const dir of dirs) {
    if (!dir) { continue; }
    if (fs.existsSync(path.join(dir, exeName))) {
      return true;
    }
  }
  return false;
}

function trySetupAndStartLSP(enableCachePath = false): void {
  if (langClient) {
    return;
  }

  const command = vscode.workspace.getConfiguration("magicScheme.scheme-langserver").get<string>("serverPath");
  if (command) {
    let resolved = command;
    if (!path.isAbsolute(command) && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      resolved = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, command);
    }
    if (!fs.existsSync(resolved)) {
      if (path.isAbsolute(command) || !isInPath(command)) {
        return;
      }
    }
  }

  setupLSP(enableCachePath);
  if (langClient) {
    currentClientState = State.Stopped;
    registerStateListener();
    void configurationChanged().catch(() => {});
  }
}

async function configurationChanged() {
  const enableLSP: boolean = vscode.workspace.getConfiguration("magicScheme.scheme-langserver").get("enable", true);

  if (!langClient) {
    return;
  }

  try {
    if (enableLSP && currentClientState === State.Stopped) {
      await langClient.start();
    } else if (!enableLSP && currentClientState === State.Running) {
      await langClient.stop();
    }
  } catch (err) {
    console.error("Magic Scheme: LSP operation failed", err);
    statusBarItem.text = "$(error) Scheme-langserver Error";
    statusBarItem.tooltip = "Language Server operation failed";
    statusBarItem.show();
  }
}

const uncaughtRejectionHandler = (reason: unknown) => {
  if (reason instanceof Error && reason.message.includes('spawn') && reason.message.includes('ENOENT')) {
    // vscode-languageclient v7 leaks spawn ENOENT as unhandled rejection.
    // The error is already shown in the status bar via configurationChanged's try-catch.
    return;
  }
  console.error('Unhandled rejection:', reason);
};

const uncaughtExceptionHandler = (err: Error) => {
  if (err.message.includes('spawn') && err.message.includes('ENOENT')) {
    // vscode-languageclient v7 may also leak spawn ENOENT as uncaught exception
    // during extension deactivation or rapid config changes in tests.
    console.error('Magic Scheme: suppressed spawn ENOENT during cleanup:', err.message);
    return;
  }
  // Re-throw anything else so the process still crashes on real bugs.
  throw err;
};

export async function activate(context: vscode.ExtensionContext) {
  process.on('unhandledRejection', uncaughtRejectionHandler);
  process.on('uncaughtException', uncaughtExceptionHandler);

  const infoChannel = printEnvironmentInfo();
  infoChannel.show();
  context.subscriptions.push(infoChannel);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  context.subscriptions.push(statusBarItem);
  statusBarItem.show();

  // Try to start LSP immediately with the current user configuration.
  trySetupAndStartLSP();

  if (!langClient) {
    statusBarItem.text = "$(sync~spin) Looking for scheme-langserver...";
    statusBarItem.tooltip = "Auto-detecting or downloading scheme-langserver";
    statusBarItem.show();
  }

  // Background: auto-detect / download / install.
  // We do NOT await this so that extension activation never blocks on network I/O.
  void ensureLangserver(context).then(async (serverPath) => {
    if (!serverPath) {
      if (!langClient) {
        statusBarItem.text = "$(error) Scheme-langserver Not Found";
        statusBarItem.tooltip = "Install scheme-langserver or set serverPath in settings";
        statusBarItem.show();
      }
      return;
    }

    // Detect server version so we can decide whether to enable 2.1.3+ features.
    currentServerVersion = await getLangserverVersion(serverPath);
    const enableCachePath = currentServerVersion
      ? isVersionAtLeast(currentServerVersion, '2.1.3')
      : false;

    const config = vscode.workspace.getConfiguration('magicScheme.scheme-langserver');
    const configuredPath = config.get<string>('serverPath');

    // Update workspace-level config only when the current value is missing or invalid.
    // Using workspace scope (false) avoids syncing machine-specific paths via Settings Sync.
    const configuredExecutable = configuredPath ? await isExecutableAsync(configuredPath) : false;
    const needsConfigUpdate = !configuredPath || !configuredExecutable;
    if (needsConfigUpdate) {
      await config.update('serverPath', serverPath, false);
    }

    // If LSP was never started, or the old client uses an invalid path, recreate it.
    if (!langClient || currentClientState === State.Stopped) {
      await disposeLangClient();
      trySetupAndStartLSP(enableCachePath);
    }

    // Check for updates if using a Magic Scheme-managed binary.
    const isManagedBinary = serverPath.startsWith(context.globalStorageUri.fsPath);
    if (isManagedBinary) {
      const restartLsp = () => {
        void disposeLangClient().then(() => trySetupAndStartLSP(enableCachePath));
      };
      void checkForUpdate(context, statusBarItem, restartLsp);
    }
  });

  const terminals: Map<string, vscode.Terminal> = new Map();
  const repls: Map<string, vscode.Terminal> = new Map();

  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((terminal) => {
      for (const [key, value] of terminals.entries()) {
        if (value === terminal) {
          terminals.delete(key);
          break;
        }
      }
      for (const [key, value] of repls.entries()) {
        if (value === terminal) {
          repls.delete(key);
          break;
        }
      }
    })
  );

  async function restartLspForServerPath(): Promise<void> {
    const serverPath = vscode.workspace.getConfiguration('magicScheme.scheme-langserver').get<string>('serverPath');
    if (serverPath) {
      let resolved = serverPath;
      if (!path.isAbsolute(serverPath) && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        resolved = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, serverPath);
      }
      if (await isExecutableAsync(resolved)) {
        currentServerVersion = await getLangserverVersion(resolved);
      }
    }
    const enableCachePath = currentServerVersion
      ? isVersionAtLeast(currentServerVersion, '2.1.3')
      : false;
    await disposeLangClient();
    trySetupAndStartLSP(enableCachePath);
  }

  const configChangeDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("magicScheme.scheme-langserver.serverPath")) {
      // The user (or auto-download) changed the server path. Detect the new
      // version and recreate the client so the new path and 2.1.3 features
      // are picked up immediately.
      void restartLspForServerPath().catch(() => {});
    }
    if (e.affectsConfiguration("magicScheme")) {
      void configurationChanged().catch(() => {});
    }
  });
  context.subscriptions.push(configChangeDisposable);

  // Auto-create .vscode/magic-scheme.json if missing.
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const vscodeDir = path.join(workspaceRoot, '.vscode');
    const projectConfigPath = path.join(vscodeDir, 'magic-scheme.json');
    if (!fs.existsSync(projectConfigPath)) {
      const defaultConfig = {
        topEnvironment: 'R6RS',
        multiThread: 'enable',
        typeInference: 'enable',
        logPath: '.vscode/scheme-langserver.log',
        cachePath: '.vscode/scheme-langserver-cache',
      };
      if (!fs.existsSync(vscodeDir)) {
        fs.mkdirSync(vscodeDir, { recursive: true });
      }
      isWritingProjectConfig = true;
      fs.writeFileSync(projectConfigPath, JSON.stringify(defaultConfig, null, 2) + '\n', 'utf8');
      setTimeout(() => { isWritingProjectConfig = false; }, 100);
    }
  }

  // Watch for project-level config file changes and restart LSP accordingly.
  const projectConfigWatcher = vscode.workspace.createFileSystemWatcher('**/.vscode/magic-scheme.json');
  const restartLspOnProjectConfigChange = () => {
    if (isWritingProjectConfig) {
      return;
    }
    void disposeLangClient().then(() => trySetupAndStartLSP());
  };
  projectConfigWatcher.onDidCreate(restartLspOnProjectConfigChange);
  projectConfigWatcher.onDidChange(restartLspOnProjectConfigChange);
  projectConfigWatcher.onDidDelete(restartLspOnProjectConfigChange);
  context.subscriptions.push(projectConfigWatcher);

  const script = vscode.commands.registerCommand('magic-scheme.runSchemeScript', () => com.runInTerminal(terminals));
  const replCmd = vscode.commands.registerCommand('magic-scheme.runSchemeREPL', () => com.openRepl(repls));
  const loadRepl = vscode.commands.registerCommand('magic-scheme.loadInRepl', () => com.loadInRepl(repls));
  const showOutput = vscode.commands.registerCommand('magic-scheme.showOutput', () => com.showOutput(terminals));
  const configureProjectCmd = vscode.commands.registerCommand('magic-scheme.configureProject', async () => {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      vscode.window.showWarningMessage('No workspace folder open.');
      return;
    }

    let workspaceRoot = getCurrentWorkspacePath();
    if (!workspaceRoot) {
      workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    }
    const vscodeDir = path.join(workspaceRoot, '.vscode');
    const projectConfigPath = path.join(vscodeDir, 'magic-scheme.json');

    let currentConfig: Record<string, string> = {};
    try {
      if (fs.existsSync(projectConfigPath)) {
        currentConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
      }
    } catch {
      // ignore parse errors, start fresh
    }

    const defaults = DEFAULT_SERVER_CONFIG;

    // Known enums for friendlier UI
    const enumOptions: Record<string, string[]> = {
      topEnvironment: ['R6RS', 'R7RS'],
      multiThread: ['enable', 'disable'],
      typeInference: ['enable', 'disable'],
    };

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Collect all keys: defaults first, then any extra keys from the file
      const allKeys = Array.from(new Set([...Object.keys(defaults), ...Object.keys(currentConfig)]));

      const items: (vscode.QuickPickItem & { value: string })[] = allKeys.map((key) => {
        const hasCustom = key in currentConfig;
        const val = hasCustom ? currentConfig[key] : (defaults as Record<string, string>)[key];
        return {
          label: `${key}: ${val}`,
          value: key,
          description: hasCustom ? '' : '(default)',
        };
      });

      items.push(
        { label: '$(add) Add new property...', value: '__add__', description: '' },
        { label: '$(check) Done', value: '__done__', description: 'Save and exit' }
      );

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a setting to configure',
        title: 'Magic Scheme Project Configuration',
      });

      if (!picked || picked.value === '__done__') {
        break;
      }

      if (picked.value === '__add__') {
        const newKey = await vscode.window.showInputBox({
          prompt: 'Enter property name (e.g. maxMemory, cacheDir)',
          placeHolder: 'newProperty',
          title: 'New Property',
          validateInput: (v) => v.trim() ? undefined : 'Property name cannot be empty',
        });
        if (!newKey) { continue; }
        const newValue = await vscode.window.showInputBox({
          prompt: `Enter value for "${newKey}"`,
          title: newKey,
        });
        if (newValue !== undefined) {
          currentConfig[newKey.trim()] = newValue;
        }
        continue;
      }

      const key = picked.value;
      const currentVal = currentConfig[key] ?? (defaults as Record<string, string>)[key] ?? '';
      let newValue: string | undefined;

      if (enumOptions[key]) {
        const options = [...enumOptions[key], '$(edit) Custom value...'];
        const picked = await vscode.window.showQuickPick(options, {
          placeHolder: `Select ${key}`,
          title: key,
        });
        if (picked === '$(edit) Custom value...') {
          newValue = await vscode.window.showInputBox({
            prompt: `Enter custom value for ${key}`,
            value: currentVal,
            title: key,
          });
        } else {
          newValue = picked;
        }
      } else {
        newValue = await vscode.window.showInputBox({
          prompt: `Enter ${key}`,
          value: currentVal,
          title: key,
        });
      }

      if (newValue !== undefined) {
        currentConfig[key] = newValue;
      }
    }

    // Build final config: defaults + overrides + extra keys
    const merged: Record<string, string> = {};
    for (const key of Object.keys(defaults)) {
      merged[key] = currentConfig[key] ?? (defaults as Record<string, string>)[key];
    }
    for (const key of Object.keys(currentConfig)) {
      if (!(key in defaults)) {
        merged[key] = currentConfig[key];
      }
    }

    if (!fs.existsSync(vscodeDir)) {
      fs.mkdirSync(vscodeDir, { recursive: true });
    }
    isWritingProjectConfig = true;
    fs.writeFileSync(projectConfigPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
    setTimeout(() => { isWritingProjectConfig = false; }, 100);

    vscode.window.showInformationMessage('Magic Scheme project configuration saved.');
  });

  const updateLangserverCmd = vscode.commands.registerCommand('magic-scheme.updateLangserver', async () => {
    const globalStoragePath = context.globalStorageUri.fsPath;
    const localVersion = readLocalVersion(globalStoragePath);
    const remoteVersion = await getLatestRemoteVersion();
    if (remoteVersion && (!localVersion || localVersion !== remoteVersion)) {
      const restartLsp = () => {
        void disposeLangClient().then(() => trySetupAndStartLSP());
      };
      await updateLangserver(context, statusBarItem, restartLsp, remoteVersion);
    } else if (remoteVersion && localVersion === remoteVersion) {
      vscode.window.showInformationMessage(`scheme-langserver is already up to date (${localVersion}).`);
    } else {
      vscode.window.showWarningMessage('Could not check for scheme-langserver updates. Please try again later.');
    }
  });
  const taskProvider = vscode.tasks.registerTaskProvider(TaskProvider.taskType, new TaskProvider());
  context.subscriptions.push(replCmd, script, loadRepl, showOutput, configureProjectCmd, updateLangserverCmd, taskProvider);

  return {
    getLangClient: () => langClient,
    getClientState: () => currentClientState,
  };
}
