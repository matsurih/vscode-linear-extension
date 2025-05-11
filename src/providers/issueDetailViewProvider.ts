import * as vscode from "vscode";
import { LinearService } from "../services/linearService";

export class IssueDetailViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "linearIssueDetail";
  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _linearService: LinearService
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // WebViewからのメッセージを処理
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case "addComment":
          await this._linearService.addComment(data.issueId, data.content);
          await this.updateIssueDetail(data.issueId);
          break;
      }
    });
  }

  public async updateIssueDetail(issueId: string) {
    if (!this._view) {
      return;
    }

    try {
      const issue = await this._linearService.getIssueDetails(issueId);
      const comments = await this._linearService.getIssueComments(issueId);

      // WebViewにデータを送信
      await this._view.webview.postMessage({
        type: "updateIssue",
        issue,
        comments,
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Issue詳細の取得に失敗しました: ${error}`);
    }
  }

  private _getHtmlForWebview(_webview: vscode.Webview): string {
    const html = `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Issue Detail</title>
      <style>
        body {
          padding: 10px;
          color: var(--vscode-foreground);
          font-family: var(--vscode-font-family);
        }
        .issue-title {
          font-size: 1.2em;
          font-weight: bold;
          margin-bottom: 10px;
        }
        .issue-description {
          margin-bottom: 20px;
          white-space: pre-wrap;
        }
        .comments-section {
          margin-top: 20px;
        }
        .comment {
          margin-bottom: 15px;
          padding: 10px;
          background: var(--vscode-editor-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 4px;
        }
        .comment-form {
          margin-top: 20px;
        }
        textarea {
          width: 100%;
          min-height: 60px;
          margin-bottom: 10px;
          background: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
        }
        button {
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          padding: 6px 12px;
          cursor: pointer;
        }
        button:hover {
          background: var(--vscode-button-hoverBackground);
        }
      </style>
    </head>
    <body>
      <div id="issue-container">
        <div class="issue-title"></div>
        <div class="issue-description"></div>
        <div class="comments-section">
          <h3>Comments</h3>
          <div id="comments-container"></div>
          <div class="comment-form">
            <textarea id="new-comment" placeholder="Write a comment..."></textarea>
            <button onclick="addComment()">Add Comment</button>
          </div>
        </div>
      </div>
      <script>
        let currentIssueId = '';

        window.addEventListener('message', event => {
          const message = event.data;
          switch (message.type) {
            case 'updateIssue':
              updateIssueView(message.issue, message.comments);
              break;
          }
        });

        function updateIssueView(issue, comments) {
          currentIssueId = issue.id;
          document.querySelector('.issue-title').textContent = issue.title;
          document.querySelector('.issue-description').textContent = issue.description || '';

          const commentsContainer = document.getElementById('comments-container');
          commentsContainer.innerHTML = comments.map(comment => \`
            <div class="comment">
              <div>\${comment.body}</div>
              <small>\${new Date(comment.createdAt).toLocaleString()}</small>
            </div>
          \`).join('');
        }

        function addComment() {
          const content = document.getElementById('new-comment').value;
          if (!content) return;

          vscode.postMessage({
            type: 'addComment',
            issueId: currentIssueId,
            content
          });

          document.getElementById('new-comment').value = '';
        }

        const vscode = acquireVsCodeApi();
      </script>
    </body>
    </html>`;
    return html;
  }
}
