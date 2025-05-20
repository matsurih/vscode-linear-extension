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

    // ローディング中であることをWebViewに通知
    await this._view.webview.postMessage({
      type: "loading",
    });

    let retryCount = 0;
    const maxRetries = 3;
    const retryDelay = 1000; // 1秒

    const tryFetchIssueDetail = async (): Promise<void> => {
      try {
        console.log(
          `Fetching issue details for ${issueId}, attempt ${retryCount + 1}`
        );
        const issue = await this._linearService.getIssueDetails(issueId);

        // Issueが取得できたか確認
        if (!issue) {
          throw new Error(`Issue ${issueId} not found`);
        }

        // state情報が正しく取得できているか確認
        if (!issue.state) {
          console.warn(`Issue ${issueId} has no state information`);
        }

        // コメントを取得
        const comments = await this._linearService.getIssueComments(issueId);

        // WebViewにデータを送信
        if (this._view) {
          await this._view.webview.postMessage({
            type: "updateIssue",
            issue,
            comments,
          });
        }

        console.log(`Successfully loaded issue ${issueId}`);
      } catch (error) {
        console.error(
          `Issue詳細の取得に失敗しました (${
            retryCount + 1
          }/${maxRetries}): ${error}`
        );

        if (retryCount < maxRetries - 1) {
          retryCount++;
          // 徐々にリトライ間隔を延ばす (指数バックオフ)
          const wait = retryDelay * Math.pow(2, retryCount);
          console.log(`${wait}ms後に再試行します...`);

          setTimeout(() => {
            tryFetchIssueDetail().catch((err) => {
              console.error(`リトライ中にエラー発生: ${err}`);
              // 最終的にエラーを表示
              this._view?.webview.postMessage({
                type: "error",
                message: `データの取得に失敗しました: ${err}`,
              });
            });
          }, wait);
          return;
        }

        // リトライ回数を超えた場合はエラーメッセージを表示
        vscode.window.showErrorMessage(
          `Issue詳細の取得に失敗しました: ${error}`
        );

        // エラーメッセージをWebViewに送信
        if (this._view) {
          await this._view.webview.postMessage({
            type: "error",
            message: `データの取得に失敗しました: ${error}`,
          });
        }
      }
    };

    await tryFetchIssueDetail();
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
        .loading {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          color: var(--vscode-descriptionForeground);
        }
        .loading-spinner {
          border: 4px solid rgba(0, 0, 0, 0.1);
          border-radius: 50%;
          border-top: 4px solid var(--vscode-progressBar-background);
          width: 20px;
          height: 20px;
          margin-right: 10px;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .error-message {
          color: var(--vscode-errorForeground);
          padding: 10px;
          border: 1px solid var(--vscode-inputValidation-errorBorder);
          background: var(--vscode-inputValidation-errorBackground);
          margin-bottom: 15px;
        }
        .hidden {
          display: none;
        }
      </style>
    </head>
    <body>
      <div id="loading" class="loading">
        <div class="loading-spinner"></div>
        <span>読み込み中...</span>
      </div>
      <div id="error-container" class="error-message hidden"></div>
      <div id="issue-container" class="hidden">
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
        const loadingElement = document.getElementById('loading');
        const errorContainer = document.getElementById('error-container');
        const issueContainer = document.getElementById('issue-container');

        // 初期状態は読み込み中
        showLoading();

        window.addEventListener('message', event => {
          const message = event.data;
          switch (message.type) {
            case 'updateIssue':
              updateIssueView(message.issue, message.comments);
              break;
            case 'error':
              showError(message.message);
              break;
          }
        });

        function showLoading() {
          loadingElement.classList.remove('hidden');
          errorContainer.classList.add('hidden');
          issueContainer.classList.add('hidden');
        }

        function showError(message) {
          loadingElement.classList.add('hidden');
          errorContainer.classList.remove('hidden');
          issueContainer.classList.add('hidden');
          
          errorContainer.textContent = \`エラーが発生しました: \${message}\`;
        }

        function updateIssueView(issue, comments) {
          // 読み込み中表示を非表示
          loadingElement.classList.add('hidden');
          errorContainer.classList.add('hidden');
          issueContainer.classList.remove('hidden');

          // データがない場合はエラー表示
          if (!issue) {
            showError('課題データを取得できませんでした');
            return;
          }

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

          // コメント送信中は再度読み込み中表示
          showLoading();
          document.getElementById('new-comment').value = '';
        }

        const vscode = acquireVsCodeApi();
      </script>
    </body>
    </html>`;
    return html;
  }
}
