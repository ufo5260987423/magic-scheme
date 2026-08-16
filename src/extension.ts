import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, State } from "vscode-languageclient/node";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import * as com from "./commands";
import { TaskProvider } from "./tasks";
import { withLanguageServer, getEffectiveServerConfig, DEFAULT_SERVER_CONFIG, getCurrentWorkspacePath, resolveServerPath, resolveTilde, syncSchemeFileAssociations } from "./utils";
import { ensureLangserver, checkForUpdate, updateLangserver } from "./download";
import { isExecutableAsync, isCommandInPath } from "./discovery";
import { getLatestRemoteVersion, readLocalVersion, getLangserverVersion, isVersionAtLeast } from "./version";

let langClient: LanguageClient | undefined;
let currentClientState: State | undefined;
let stateListenerDisposable: vscode.Disposable | undefined;
let statusBarItem: vscode.StatusBarItem;
let currentServerVersion: string | undefined;

// Minimum scheme-langserver version that supports the --cache-path option.
const MIN_VERSION_FOR_CACHE_PATH = '2.1.3';

// Tracks whether the currently running LSP client was started with --cache-path.
// Used to decide if we need to restart the client when version detection reveals
// that the server supports cache-path but the running client was started without it.
let currentEnableCachePath = false;

// Tracks the last content we wrote to .vscode/magic-scheme.json so that the
// file watcher can distinguish our own writes from user edits.
let lastWrittenProjectConfigContent: string | undefined;

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
    appendEffectiveConfig(channel, "Effective scheme-langserver configuration (from .vscode/magic-scheme.json):");
  } catch {
    // ignore
  }

  return channel;
}

function appendEffectiveConfig(
  channel: vscode.OutputChannel,
  title: string,
  version?: string,
  enableCachePath?: boolean,
): void {
  const effective = getEffectiveServerConfig();
  if (!effective) {
    return;
  }

  channel.appendLine("");
  channel.appendLine(title);
  channel.appendLine(`  topEnvironment:  ${effective.topEnvironment}`);
  channel.appendLine(`  multiThread:     ${effective.multiThread}`);
  channel.appendLine(`  typeInference:   ${effective.typeInference}`);
  channel.appendLine(`  logPath:         ${effective.log}`);

  if (effective.cachePath) {
    const resolvedCachePath = resolveTilde(effective.cachePath);
    const absoluteCachePath = path.isAbsolute(resolvedCachePath)
      ? resolvedCachePath
      : path.join(effective.workspacePath || '', resolvedCachePath);
    channel.appendLine(`  cachePath:       ${effective.cachePath} (resolved: ${absoluteCachePath})`);
  } else {
    channel.appendLine(`  cachePath:       (not set)`);
  }

  if (effective.fileFilter) {
    channel.appendLine(`  fileFilter:      ${effective.fileFilter}`);
  } else if (effective.packageManager) {
    channel.appendLine(`  packageManager:  ${effective.packageManager}`);
  }

  if (version) {
    const cacheEnabled = enableCachePath !== undefined
      ? enableCachePath
      : isVersionAtLeast(version, MIN_VERSION_FOR_CACHE_PATH);
    channel.appendLine(`  version:         ${version}`);
    channel.appendLine(`  cache enabled:   ${cacheEnabled}`);
  } else {
    channel.appendLine(`  version:         unknown (detecting...)`);
    channel.appendLine(`  cache enabled:   to be determined after version detection`);
  }
  channel.appendLine(`  project config:  ${path.join(effective.workspacePath || '', '.vscode', 'magic-scheme.json')}`);
}

async function setupLSP(enableCachePath = false): Promise<void> {
  await withLanguageServer((command: string, args: string[]) => {
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

async function trySetupAndStartLSP(enableCachePath = false): Promise<void> {
  if (langClient) {
    return;
  }

  // Remember whether this client instance was started with cache-path support.
  // We need this to restart the client if version detection later reveals that
  // the server supports cache-path but the currently running client was started
  // before that discovery (e.g. when serverPath is already configured).
  currentEnableCachePath = enableCachePath;

  const command = vscode.workspace.getConfiguration("magicScheme.scheme-langserver").get<string>("serverPath");
  if (command) {
    const resolved = resolveServerPath(command);
    if (!fs.existsSync(resolved)) {
      if (path.isAbsolute(command) || !isCommandInPath(command)) {
        return;
      }
    }
  }

  await setupLSP(enableCachePath);
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
  // If a server path is already configured and executable, detect its version
  // first so we can start with the correct cache-path flag and avoid disposing
  // a freshly-created connection (and failing in-flight requests) during a
  // restart shortly after activation.
  const eagerStart = async () => {
    const configuredPath = vscode.workspace.getConfiguration('magicScheme.scheme-langserver').get<string>('serverPath');
    if (configuredPath) {
      const resolved = resolveServerPath(configuredPath);
      if (fs.existsSync(resolved) && await isExecutableAsync(resolved)) {
        currentServerVersion = await getLangserverVersion(resolved);
        const enableCachePath = currentServerVersion
          ? isVersionAtLeast(currentServerVersion, MIN_VERSION_FOR_CACHE_PATH)
          : false;
        await trySetupAndStartLSP(enableCachePath);
        return;
      }
    }
    await trySetupAndStartLSP();
  };
  void eagerStart();

  // Apply user-configured additional Scheme file extensions to files.associations.
  void syncSchemeFileAssociations(context).catch((err) =>
    console.error('Magic Scheme: failed to sync file associations', err)
  );

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

    // Detect server version so we can decide whether to enable cache-path.
    currentServerVersion = await getLangserverVersion(serverPath);
    const enableCachePath = currentServerVersion
      ? isVersionAtLeast(currentServerVersion, MIN_VERSION_FOR_CACHE_PATH)
      : false;

    // Append server version info to the environment channel now that detection
    // is complete. The channel was shown earlier during activation before the
    // version was known.
    if (infoChannel) {
      infoChannel.appendLine('');
      infoChannel.appendLine('Detected scheme-langserver:');
      infoChannel.appendLine(`  version:         ${currentServerVersion || 'unknown'}`);
      infoChannel.appendLine(`  cache-path:      ${enableCachePath ? 'enabled' : 'disabled'}`);
    }

    if (!currentServerVersion) {
      vscode.window.showWarningMessage(
        'Could not detect scheme-langserver version. Cache-path support will be disabled.'
      );
    }

    // Reprint the effective configuration after version detection (and the
    // upcoming restart) so the user can see the actual running state instead of
    // the provisional "unknown" block printed during activation.
    const printRunningConfig = () => {
      if (infoChannel) {
        appendEffectiveConfig(
          infoChannel,
          'Effective scheme-langserver configuration (running):',
          currentServerVersion,
          enableCachePath,
        );
      }
    };

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
    // Also restart if we just discovered cache-path support and the running client
    // was started without it. This commonly happens when serverPath is pre-configured:
    // the initial eager start uses enableCachePath=false, then version detection here
    // finds a cache-path-capable server and we must restart to pass --cache-path.
    const needsRestart =
      !langClient ||
      currentClientState === State.Stopped ||
      (enableCachePath && !currentEnableCachePath);
    if (needsRestart) {
      await disposeLangClient();
      await trySetupAndStartLSP(enableCachePath);
    }
    printRunningConfig();

    // Check for updates if using a Magic Scheme-managed binary.
    const isManagedBinary = serverPath.startsWith(context.globalStorageUri.fsPath);
    if (isManagedBinary) {
      const restartLsp = async () => {
        await disposeLangClient();
        await trySetupAndStartLSP(enableCachePath);
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
      const resolved = resolveServerPath(serverPath);
      if (await isExecutableAsync(resolved)) {
        currentServerVersion = await getLangserverVersion(resolved);
      }
    }
    const enableCachePath = currentServerVersion
      ? isVersionAtLeast(currentServerVersion, MIN_VERSION_FOR_CACHE_PATH)
      : false;
    await disposeLangClient();
    await trySetupAndStartLSP(enableCachePath);
  }

  const configChangeDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("magicScheme.scheme-langserver.serverPath")) {
      // The user (or auto-download) changed the server path. Detect the new
      // version and recreate the client so the new path and cache-path feature
      // are picked up immediately.
      void restartLspForServerPath().catch(() => {});
    }
    if (e.affectsConfiguration("magicScheme.scheme.fileExtensions")) {
      void syncSchemeFileAssociations(context).catch((err) =>
        console.error('Magic Scheme: failed to sync file associations', err)
      );
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
      lastWrittenProjectConfigContent = JSON.stringify(defaultConfig, null, 2) + '\n';
      fs.writeFileSync(projectConfigPath, lastWrittenProjectConfigContent, 'utf8');
    }
  }

  // Watch for project-level config file changes and restart LSP accordingly.
  const projectConfigWatcher = vscode.workspace.createFileSystemWatcher('**/.vscode/magic-scheme.json');
  const restartLspOnProjectConfigChange = async () => {
    // If the file content matches what we just wrote, this is our own write.
    // Skip the restart and clear the marker so subsequent user edits still work.
    if (lastWrittenProjectConfigContent) {
      try {
        const workspaceRoot = getCurrentWorkspacePath() || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const currentProjectConfigPath = workspaceRoot
          ? path.join(workspaceRoot, '.vscode', 'magic-scheme.json')
          : undefined;
        if (currentProjectConfigPath) {
          const currentContent = fs.readFileSync(currentProjectConfigPath, 'utf8');
          if (currentContent === lastWrittenProjectConfigContent) {
            lastWrittenProjectConfigContent = undefined;
            return;
          }
        }
      } catch {
        // ignore read errors: fall through to restart
      }
    }
    // Preserve cache-path support when restarting due to project config changes.
    // If the server version has already been detected, use it; otherwise the
    // next start will pick it up once ensureLangserver finishes.
    const enableCachePath = currentServerVersion
      ? isVersionAtLeast(currentServerVersion, MIN_VERSION_FOR_CACHE_PATH)
      : false;
    await disposeLangClient();
    await trySetupAndStartLSP(enableCachePath);
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
      vscode.window.showWarningMessage(
        `Failed to parse ${projectConfigPath}. Starting fresh with default values.`
      );
    }

    const defaults = DEFAULT_SERVER_CONFIG;

    // Known enums for friendlier UI
    const enumOptions: Record<string, string[]> = {
      topEnvironment: ['R6RS', 'R7RS'],
      multiThread: ['enable', 'disable'],
      typeInference: ['enable', 'disable'],
      packageManager: ['akku', 'txt'],
    };

    // Optional project-level keys that are not in the hard-coded defaults but
    // are still recognized by scheme-langserver.
    const optionalKeys = ['fileFilter', 'packageManager'];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Collect all keys: defaults, optional known keys, then any extra keys from the file
      const allKeys = Array.from(new Set([...Object.keys(defaults), ...optionalKeys, ...Object.keys(currentConfig)]));

      const items: (vscode.QuickPickItem & { value: string })[] = allKeys.map((key) => {
        const hasCustom = key in currentConfig;
        const val = hasCustom ? currentConfig[key] : ((defaults as Record<string, string>)[key] ?? '');
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
    lastWrittenProjectConfigContent = JSON.stringify(merged, null, 2) + '\n';
    fs.writeFileSync(projectConfigPath, lastWrittenProjectConfigContent, 'utf8');

    vscode.window.showInformationMessage('Magic Scheme project configuration saved.');
  });

  const updateLangserverCmd = vscode.commands.registerCommand('magic-scheme.updateLangserver', async () => {
    const globalStoragePath = context.globalStorageUri.fsPath;
    const localVersion = readLocalVersion(globalStoragePath);
    const remoteVersion = await getLatestRemoteVersion();
    if (remoteVersion && (!localVersion || localVersion !== remoteVersion)) {
      const enableCachePath = isVersionAtLeast(remoteVersion, MIN_VERSION_FOR_CACHE_PATH);
      const restartLsp = async () => {
        await disposeLangClient();
        await trySetupAndStartLSP(enableCachePath);
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
