import * as vscode from "vscode";
import { LinearService } from "./services/linearService";
import { IssueTreeProvider } from "./providers/issueTreeProvider";
import { Issue } from "@linear/sdk";

export function activate(context: vscode.ExtensionContext) {
  const linearService = new LinearService();
  const issueTreeProvider = new IssueTreeProvider(linearService);

  vscode.window.registerTreeDataProvider("linearIssues", issueTreeProvider);

  // コマンドの登録
  context.subscriptions.push(
    vscode.commands.registerCommand("linear.refreshIssues", () => {
      issueTreeProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("linear.filterMyIssues", () => {
      issueTreeProvider.toggleFilter();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "linear.openIssue",
      async (issue: Issue) => {
        const panel = vscode.window.createWebviewPanel(
          "linearIssue",
          `${issue.identifier}: ${issue.title}`,
          vscode.ViewColumn.One,
          {
            enableScripts: true,
          }
        );

        panel.webview.html = getIssueDetailHtml(issue);

        // コメント追加機能
        panel.webview.onDidReceiveMessage(
          async (message) => {
            if (message.command === "addComment") {
              try {
                await linearService.addComment(issue.id, message.text);
                vscode.window.showInformationMessage(
                  "Comment added successfully"
                );
                // 更新されたissueの詳細を再表示
                panel.webview.html = getIssueDetailHtml(issue);
              } catch (error) {
                vscode.window.showErrorMessage(
                  `Failed to add comment: ${error}`
                );
              }
            }
          },
          undefined,
          context.subscriptions
        );
      }
    )
  );

  // API tokenの設定が変更された時の処理
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("linear.apiToken")) {
        const config = vscode.workspace.getConfiguration("linear");
        const apiToken = config.get<string>("apiToken");
        if (apiToken) {
          linearService.updateApiToken(apiToken);
          issueTreeProvider.refresh();
        }
      }
    })
  );
}

function getIssueDetailHtml(issue: Issue): string {
  return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    padding: 15px;
                }
                .header {
                    margin-bottom: 20px;
                }
                .status {
                    display: inline-block;
                    padding: 4px 8px;
                    border-radius: 4px;
                    background-color: var(--vscode-badge-background);
                    color: var(--vscode-badge-foreground);
                    margin-right: 10px;
                }
                .description {
                    margin: 20px 0;
                    white-space: pre-wrap;
                }
                .comment-form {
                    margin-top: 20px;
                }
                textarea {
                    width: 100%;
                    min-height: 100px;
                    margin-bottom: 10px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                }
                button {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 8px 16px;
                    cursor: pointer;
                }
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>${issue.identifier}: ${issue.title}</h1>
                <span class="status">${issue.state?.name}</span>
                <span>Assignee: ${issue.assignee?.name || "Unassigned"}</span>
            </div>
            <div class="description">${
              issue.description || "No description"
            }</div>
            <div class="comment-form">
                <h3>Add Comment</h3>
                <textarea id="commentText" placeholder="Type your comment here..."></textarea>
                <button onclick="addComment()">Add Comment</button>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                
                function addComment() {
                    const text = document.getElementById('commentText').value;
                    if (text) {
                        vscode.postMessage({
                            command: 'addComment',
                            text: text
                        });
                        document.getElementById('commentText').value = '';
                    }
                }
            </script>
        </body>
        </html>
    `;
}

export function deactivate() {}
