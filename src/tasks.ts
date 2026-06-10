import * as vscode from "vscode";

export class TaskProvider implements vscode.TaskProvider {
  static taskType = "scheme";

  public async provideTasks(): Promise<vscode.Task[]> {
    return this.getTasks();
  }

  public resolveTask(): vscode.Task | undefined {
    return undefined;
  }

  private getTasks(): vscode.Task[] {
    const scriptFlag =
      vscode.workspace.getConfiguration("magicScheme.scheme").get<string>("scriptFlag") || "--script";

    const scriptTask = new vscode.Task(
      { type: TaskProvider.taskType },
      vscode.TaskScope.Workspace,
      "Script",
      "scheme",
      // eslint-disable-next-line no-template-curly-in-string
      new vscode.ShellExecution(
        { value: "${config:magicScheme.scheme.path}", quoting: vscode.ShellQuoting.Strong },
        [scriptFlag, { value: "${file}", quoting: vscode.ShellQuoting.Strong }]
      ),
    );

    const replTask = new vscode.Task(
      { type: TaskProvider.taskType },
      vscode.TaskScope.Workspace,
      "Repl",
      "scheme",
      // eslint-disable-next-line no-template-curly-in-string
      new vscode.ShellExecution(
        { value: "${config:magicScheme.scheme.path}", quoting: vscode.ShellQuoting.Strong },
        [{ value: "${file}", quoting: vscode.ShellQuoting.Strong }]
      ),
    );

    return [scriptTask, replTask];
  }
}
