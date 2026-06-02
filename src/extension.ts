import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, State } from "vscode-languageclient/node";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import * as com from "./commands";
import { TaskProvider } from "./tasks";
import { withLanguageServer } from "./utils";
import { ensureLangserver, isExecutable } from "./download";

let langClient: LanguageClient | undefined;
let currentClientState: State | undefined;
let stateListenerDisposable: vscode.Disposable | undefined;
let statusBarItem: vscode.StatusBarItem;

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

  return channel;
}

function setupLSP() {
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
  });
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
        statusBarItem.text = "$(check) Scheme-langserver Ready";
        statusBarItem.tooltip = "Language Server is ready";
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

function trySetupAndStartLSP(): void {
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

  setupLSP();
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

    const config = vscode.workspace.getConfiguration('magicScheme.scheme-langserver');
    const configuredPath = config.get<string>('serverPath');

    // Update workspace-level config only when the current value is missing or invalid.
    // Using workspace scope (false) avoids syncing machine-specific paths via Settings Sync.
    const needsConfigUpdate = !configuredPath || !isExecutable(configuredPath);
    if (needsConfigUpdate) {
      await config.update('serverPath', serverPath, false);
    }

    // If LSP was never started, or the old client uses an invalid path, recreate it.
    if (!langClient || currentClientState === State.Stopped) {
      await disposeLangClient();
      trySetupAndStartLSP();
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

  const configChangeDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("magicScheme.scheme-langserver.serverPath")) {
      // The user (or auto-download) changed the server path. Dispose the old
      // client and recreate so the new path is picked up immediately.
      void disposeLangClient().then(() => trySetupAndStartLSP());
    }
    if (e.affectsConfiguration("magicScheme")) {
      void configurationChanged().catch(() => {});
    }
  });
  context.subscriptions.push(configChangeDisposable);

  // Watch for project-level config file changes and restart LSP accordingly.
  const projectConfigWatcher = vscode.workspace.createFileSystemWatcher('**/.scheme-langserver.json');
  const restartLspOnProjectConfigChange = () => {
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
  const taskProvider = vscode.tasks.registerTaskProvider(TaskProvider.taskType, new TaskProvider());
  context.subscriptions.push(replCmd, script, loadRepl, showOutput, taskProvider);

  return {
    getLangClient: () => langClient,
    getClientState: () => currentClientState,
  };
}
