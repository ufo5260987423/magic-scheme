import * as vscode from "vscode";

export class TaskProvider implements vscode.TaskProvider {
  static taskType = "scheme";

  static scriptTask = new vscode.Task(
    { type: TaskProvider.taskType },
    vscode.TaskScope.Workspace,
    "Script",
    "scheme",
    // eslint-disable-next-line no-template-curly-in-string
    new vscode.ShellExecution("${config:scheme.path}", ["--script","${file}"]),
  );

  static replTask = new vscode.Task(
    { type: TaskProvider.taskType },
    vscode.TaskScope.Workspace,
    "Repl",
    "scheme",
    // eslint-disable-next-line no-template-curly-in-string
    new vscode.ShellExecution("${config:scheme.path}", ["${file}"]),
  );

  public async provideTasks(): Promise<vscode.Task[]> {
    return this.getTasks();
  }

  public resolveTask(): vscode.Task | undefined {
    return undefined;
  }

  private getTasks(): vscode.Task[] {
    return [TaskProvider.scriptTask, TaskProvider.replTask];
  }
}
