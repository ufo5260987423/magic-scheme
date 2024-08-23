import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions } from "vscode-languageclient/node";
import * as os from "os";
import * as com from "./commands";
import { TaskProvider } from "./tasks";
import { withLanguageServer } from "./utils";

let langClient: LanguageClient;
let isLangClientRunning = false;

let taskProvider: vscode.Disposable | undefined;

export function deactivate(): Promise<void> {
  if (taskProvider) {
    taskProvider.dispose();
  }

  if (!langClient) {
    return Promise.reject(new Error("There is no language server client to be deactivated"));
  }
  return langClient.stop();
}

function printEnvironmentInfo() {
  const channel = vscode.window.createOutputChannel("Scheme");
  channel.appendLine("Magic Scheme environment info");
  channel.appendLine("");
  channel.appendLine(`os.arch:            ${os.arch}`);
  channel.appendLine(`os.platform:        ${os.platform}`);
  channel.appendLine(`os.release:         ${os.release}`);
  channel.appendLine(`os.version:         ${os.version}`);
  channel.appendLine(`process.version:    ${process.version}`);
  channel.appendLine(`vscode.env.appHost: ${vscode.env.appHost}`);
  channel.appendLine(`vscode.env.appName: ${vscode.env.appName}`);
  channel.appendLine(`vscode.env.shell:   ${vscode.env.shell}`);
}

function setupLSP() {
  withLanguageServer((command: string, args: string[]) => {
    const executable = {
      command: command,
      args: args,
    };

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    const serverOptions = {
      run: executable,
      debug: executable,
    };

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
      // Register the server for Racket documents
      documentSelector: [{ language: "scheme" }],
      // Fix URI encoding on Windows (#13)
      uriConverters: {
        code2Protocol: (uri) => uri.toString(true),
        protocol2Code: (str) => vscode.Uri.parse(str),
      },
    };

    // Create the language client and start the client.
    langClient = new LanguageClient(
      "Magic Scheme",
      "Scheme Language Client",
      serverOptions,
      clientOptions,
    );
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reg(name: string, func: (...args: any[]) => any) {
  return vscode.commands.registerCommand(`magic-scheme.${name}`, func);
}

function configurationChanged() {
  const enableLSP: boolean = vscode.workspace
    .getConfiguration("scheme-langserver").get("enable", true);

  if (langClient) {
    if (enableLSP && !isLangClientRunning) {
      langClient.start();
      isLangClientRunning = true;
    } else if (!enableLSP && isLangClientRunning) {
      langClient.stop();
      isLangClientRunning = false;
    }
  }
}

export function activate(context: vscode.ExtensionContext) {
  printEnvironmentInfo();
  setupLSP();
  configurationChanged();

  // Each file has one output terminal and one repl
  // Those two are saved in terminals and repls, respectively
  // The file is _ran_ in the terminal and _loaded_ into a repl
  const terminals: Map<string, vscode.Terminal> = new Map();
  const repls: Map<string, vscode.Terminal> = new Map();

  vscode.workspace.onDidChangeConfiguration(configurationChanged);

  const script= vscode.commands.registerCommand('magic-scheme.runSchemeScript', () => com.runInTerminal(terminals));
  const repl= vscode.commands.registerCommand('magic-scheme.runSchemeREPL', () => com.openRepl(repls));
  context.subscriptions.push(repl,script);
}