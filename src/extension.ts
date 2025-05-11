import * as vscode from "vscode";
import { LinearService } from "./services/linearService";
import { IssueTreeProvider } from "./providers/issueTreeProvider";

export async function activate(context: vscode.ExtensionContext) {
  const apiToken = vscode.workspace
    .getConfiguration("linear")
    .get<string>("apiToken");

  if (!apiToken) {
    vscode.window.showErrorMessage(
      "Linear API トークンが設定されていません。設定から追加してください。"
    );
    return;
  }

  const linearService = new LinearService(apiToken);
  const issueTreeProvider = new IssueTreeProvider(linearService);

  // TreeViewの登録
  const treeView = vscode.window.createTreeView("linearIssues", {
    treeDataProvider: issueTreeProvider,
    showCollapseAll: true,
  });

  // コマンドの登録
  context.subscriptions.push(
    vscode.commands.registerCommand("linear.refreshIssues", () => {
      issueTreeProvider.refresh();
    }),
    vscode.commands.registerCommand("linear.filterMyIssues", () => {
      issueTreeProvider.toggleFilter();
    }),
    vscode.commands.registerCommand("linear.openIssue", async (issue) => {
      const url = issue.url;
      if (url) {
        await vscode.env.openExternal(vscode.Uri.parse(url));
      }
    }),
    treeView
  );
}

export function deactivate() {}
