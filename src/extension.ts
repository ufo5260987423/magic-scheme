import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, State } from "vscode-languageclient/node";
import * as os from "os";
import * as com from "./commands";
import { TaskProvider } from "./tasks";
import { withLanguageServer } from "./utils";

let langClient: LanguageClient | undefined;
let statusBarItem: vscode.StatusBarItem;
let isLangClientRunning = false;

export function deactivate(): Promise<void> {
  return langClient?.stop() ?? Promise.resolve();
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

async function configurationChanged() {
  const enableLSP: boolean = vscode.workspace.getConfiguration("magicScheme.scheme-langserver").get("enable", true);

  if (!langClient) {
    return;
  }

  try {
    if (enableLSP && !isLangClientRunning) {
      await langClient.start();
      // isLangClientRunning will be set by onDidChangeState when it reaches Running
    } else if (!enableLSP && isLangClientRunning) {
      await langClient.stop();
      isLangClientRunning = false;
    }
  } catch (err) {
    console.error("Magic Scheme: LSP operation failed", err);
    isLangClientRunning = false;
    statusBarItem.text = "$(error) Scheme-langserver Error";
    statusBarItem.tooltip = "Language Server operation failed";
    statusBarItem.show();
  }
}

export function activate(context: vscode.ExtensionContext) {
  const infoChannel = printEnvironmentInfo();
  context.subscriptions.push(infoChannel);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  context.subscriptions.push(statusBarItem);
  statusBarItem.show();

  setupLSP();

  if (langClient) {
    const stateDisposable = langClient.onDidChangeState((event) => {
      switch (event.newState) {
        case State.Starting:
          statusBarItem.text = "$(sync~spin) Initializing Scheme-langserver...";
          statusBarItem.tooltip = "Language Server is initializing...";
          statusBarItem.show();
          break;
        case State.Running:
          isLangClientRunning = true;
          statusBarItem.text = "$(check) Scheme-langserver Ready";
          statusBarItem.tooltip = "Language Server is ready";
          statusBarItem.show();
          break;
        case State.Stopped:
          isLangClientRunning = false;
          statusBarItem.text = "$(error) Scheme-langserver Error";
          statusBarItem.tooltip = "Language Server failed to initialize";
          statusBarItem.show();
          break;
        default:
          break;
      }
    });
    context.subscriptions.push(stateDisposable);

    void configurationChanged();
  } else {
    statusBarItem.text = "$(error) Scheme-langserver Not Configured";
    statusBarItem.tooltip = "Check Magic Scheme settings";
    statusBarItem.show();
  }

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
