import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, State } from "vscode-languageclient/node";
import * as os from "os";
import * as com from "./commands";
import { TaskProvider } from "./tasks";
import { withLanguageServer } from "./utils";
import { ensureLangserver, isExecutable } from "./download";

let langClient: LanguageClient | undefined;
let stateListenerDisposable: vscode.Disposable | undefined;
let statusBarItem: vscode.StatusBarItem;

export function deactivate(): Promise<void> {
  return langClient?.stop().catch(() => {}) ?? Promise.resolve();
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
  channel.show(true);
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

function disposeLangClient(): void {
  if (stateListenerDisposable) {
    stateListenerDisposable.dispose();
    stateListenerDisposable = undefined;
  }
  if (langClient) {
    langClient.stop().catch(() => {});
    langClient = undefined;
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

function trySetupAndStartLSP(): void {
  if (langClient) {
    return;
  }
  setupLSP();
  if (langClient) {
    registerStateListener();
    void configurationChanged();
  }
}

async function configurationChanged() {
  const enableLSP: boolean = vscode.workspace.getConfiguration("magicScheme.scheme-langserver").get("enable", true);

  if (!langClient) {
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentState = (langClient as any).state as State;
    if (enableLSP && currentState === State.Stopped) {
      await langClient.start();
    } else if (!enableLSP && currentState === State.Running) {
      await langClient.stop();
    }
  } catch (err) {
    console.error("Magic Scheme: LSP operation failed", err);
    statusBarItem.text = "$(error) Scheme-langserver Error";
    statusBarItem.tooltip = "Language Server operation failed";
    statusBarItem.show();
  }
}

export async function activate(context: vscode.ExtensionContext) {
  const infoChannel = printEnvironmentInfo();
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentState = langClient ? (langClient as any).state as State : undefined;
    if (!langClient || currentState === State.Stopped) {
      disposeLangClient();
      trySetupAndStartLSP();
    }
  });

  const terminals: Map<string, vscode.Terminal> = new Map();
  const repls: Map<string, vscode.Terminal> = new Map();

  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((terminal) => {
      terminals.forEach((value, key) => {
        if (value === terminal) {
          terminals.delete(key);
        }
      });
      repls.forEach((value, key) => {
        if (value === terminal) {
          repls.delete(key);
        }
      });
    })
  );

  const configChangeDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("magicScheme.scheme-langserver.serverPath")) {
      // The user (or auto-download) changed the server path. Dispose the old
      // client and recreate so the new path is picked up immediately.
      disposeLangClient();
      trySetupAndStartLSP();
    }
    if (e.affectsConfiguration("magicScheme")) {
      void configurationChanged();
    }
  });
  context.subscriptions.push(configChangeDisposable);

  const script = vscode.commands.registerCommand('magic-scheme.runSchemeScript', () => com.runInTerminal(terminals));
  const replCmd = vscode.commands.registerCommand('magic-scheme.runSchemeREPL', () => com.openRepl(repls));
  const loadRepl = vscode.commands.registerCommand('magic-scheme.loadInRepl', () => com.loadInRepl(repls));
  const showOutput = vscode.commands.registerCommand('magic-scheme.showOutput', () => com.showOutput(terminals));
  const taskProvider = vscode.tasks.registerTaskProvider(TaskProvider.taskType, new TaskProvider());
  context.subscriptions.push(replCmd, script, loadRepl, showOutput, taskProvider);
}
