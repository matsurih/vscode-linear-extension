import * as vscode from "vscode";
import { LinearService } from "./services/linearService";
import { IssueTreeProvider } from "./providers/issueTreeProvider";
import { IssueDetailViewProvider } from "./providers/issueDetailViewProvider";

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
  const issueDetailProvider = new IssueDetailViewProvider(
    context.extensionUri,
    linearService
  );

  // TreeViewの登録
  const treeView = vscode.window.createTreeView("linearIssues", {
    treeDataProvider: issueTreeProvider,
    showCollapseAll: true,
  });

  // Issue詳細WebViewの登録
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      IssueDetailViewProvider.viewType,
      issueDetailProvider
    )
  );

  // コマンドの登録
  context.subscriptions.push(
    vscode.commands.registerCommand("linear.refreshIssues", () => {
      issueTreeProvider.refresh();
    }),
    vscode.commands.registerCommand("linear.filterMyIssues", () => {
      issueTreeProvider.toggleFilter();
    }),
    vscode.commands.registerCommand("linear.showIssueDetail", async (issue) => {
      await issueDetailProvider.updateIssueDetail(issue.id);
    }),
    treeView
  );

  // TreeViewの選択イベントを監視
  treeView.onDidChangeSelection(async (e) => {
    if (e.selection.length > 0) {
      const selectedIssue = e.selection[0];
      await issueDetailProvider.updateIssueDetail(selectedIssue.id);
    }
  });
}

export function deactivate() {}
