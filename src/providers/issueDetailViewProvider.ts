import * as vscode from "vscode";
import * as fs from "fs";
import { LinearService } from "../services/linearService";

export class IssueDetailViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "linearIssueDetail";

  // WebViewインスタンスを保持
  private _view?: vscode.WebviewView;

  // 遅延ロード用のキャッシュ
  private _pendingIssueId?: string = undefined;

  // WebViewがレンダリング済みかどうか
  private _isReady = false;

  // 診断情報
  private _diagnostics = {
    initAttempts: 0,
    lastError: null as Error | null,
    pendingUpdates: 0,
    successfulUpdates: 0,
  };

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _linearService: LinearService
  ) {
    console.log("IssueDetailViewProvider: コンストラクタ実行");
  }

  /**
   * VSCodeからの呼び出しでWebViewを初期化する
   */
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    console.log("IssueDetailViewProvider: resolveWebviewView呼び出し開始");
    this._diagnostics.initAttempts++;

    try {
      // WebViewインスタンスとビューを保存
      this._view = webviewView;
      console.log("IssueDetailViewProvider: ビューインスタンスを保存しました");

      // WebViewの基本設定
      webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [this._extensionUri],
      };
      console.log("IssueDetailViewProvider: WebViewオプションを設定しました");

      // 初期HTMLの設定
      webviewView.webview.html = this._getWebviewHtml(webviewView.webview);
      console.log("IssueDetailViewProvider: 初期HTMLを設定しました");

      // WebViewメッセージハンドラを設定
      webviewView.webview.onDidReceiveMessage(
        this._handleWebViewMessage.bind(this)
      );
      console.log("IssueDetailViewProvider: メッセージハンドラを設定しました");

      // WebViewが破棄されたときのイベント処理
      webviewView.onDidDispose(() => {
        console.log("IssueDetailViewProvider: WebViewが破棄されました");
        this._view = undefined;
        this._isReady = false;
      });

      // WebViewが表示されたときのイベント処理
      webviewView.onDidChangeVisibility(() => {
        console.log(
          "IssueDetailViewProvider: WebViewの可視性が変更されました - 表示状態:",
          webviewView.visible
        );

        if (webviewView.visible) {
          console.log("IssueDetailViewProvider: WebViewが表示されました");

          // 保留中のイシューがあれば表示
          this._processPendingIssue();
        }
      });

      console.log("IssueDetailViewProvider: resolveWebviewView呼び出し完了");
    } catch (error) {
      console.error(
        "IssueDetailViewProvider: WebView初期化中にエラーが発生しました:",
        error
      );
      this._diagnostics.lastError =
        error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * WebViewからのメッセージを処理するハンドラ
   */
  private async _handleWebViewMessage(message: any) {
    console.log(
      `IssueDetailViewProvider: WebViewからメッセージを受信: ${message.type}`
    );

    switch (message.type) {
      case "ready":
        console.log("IssueDetailViewProvider: WebViewの準備完了");
        this._isReady = true;
        this._processPendingIssue();
        break;

      case "addComment":
        try {
          await this._linearService.addComment(
            message.issueId,
            message.content
          );
          console.log(`イシュー ${message.issueId} にコメントを追加しました`);
          await this.updateIssueDetail(message.issueId);
        } catch (error) {
          console.error("コメント追加でエラー:", error);
          this._postErrorMessage("コメントの追加に失敗しました");
        }
        break;

      case "debug":
        console.log("デバッグ情報:", message.data);
        break;
    }
  }

  /**
   * 診断情報をWebViewに送信（非表示、デバッグ用に内部保持のみ）
   */
  private _postDiagnostics() {
    // デバッグ情報は内部的に記録するのみ
    this._diagnostics.pendingUpdates;
    this._diagnostics.successfulUpdates;
    this._diagnostics.lastError;
    this._diagnostics.initAttempts;
    // WebViewへの送信は行わない
  }

  /**
   * 保留中のイシューIDがあれば処理する
   */
  private _processPendingIssue() {
    if (this._pendingIssueId && this._isReady && this._view?.webview) {
      console.log(
        `IssueDetailViewProvider: 保留中のイシュー(${this._pendingIssueId})を表示します`
      );
      const issueId = this._pendingIssueId;
      this._pendingIssueId = undefined;
      this.updateIssueDetail(issueId).catch((err) => {
        console.error("保留中イシューの表示に失敗:", err);
        this._diagnostics.lastError = err;
      });
    }
  }

  /**
   * 外部からの呼び出しでイシュー詳細を更新する
   */
  public async updateIssueDetail(issueId: string) {
    console.log(`IssueDetailViewProvider: イシュー詳細の更新要求: ${issueId}`);
    this._diagnostics.pendingUpdates++;

    // パラメータチェック
    if (!issueId) {
      console.error("updateIssueDetail: 無効なissueId");
      return;
    }

    // 初期化時のダミーIDの場合は処理をスキップ
    if (issueId === "initialization-dummy-id") {
      console.log("初期化用ダミーIDのため処理をスキップします");
      return;
    }

    // WebViewが利用可能かチェック
    if (!this._view?.webview) {
      console.log("WebViewが利用できません。イシューIDを保存します:", issueId);
      this._pendingIssueId = issueId;
      // VSCodeのViewを表示する試み
      try {
        await vscode.commands.executeCommand("workbench.view.extension.linear");
        await vscode.commands.executeCommand("linearIssueDetail.focus");
      } catch (error) {
        console.log("WebViewを表示する試みが失敗:", error);
      }
      return;
    }

    try {
      // ローディング表示
      this._showLoading();

      // イシュー詳細とコメントの取得
      const issue = await this._linearService.getIssueDetails(issueId);

      // イシュー情報が取得できなかった場合
      if (!issue) {
        console.error(`イシュー(${issueId})の情報を取得できませんでした`);
        this._postErrorMessage("イシュー情報を取得できませんでした");
        return;
      }

      const comments = await this._linearService.getIssueComments(issueId);

      // WebViewにデータを送信
      this._postIssueData(issue, comments);
      this._diagnostics.successfulUpdates++;
    } catch (error) {
      console.error("イシュー詳細の取得でエラー:", error);
      this._postErrorMessage(`イシュー詳細の取得に失敗しました: ${error}`);
      this._diagnostics.lastError =
        error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * WebViewにローディング状態を表示
   */
  private _showLoading() {
    if (!this._view?.webview) return;

    this._view.webview
      .postMessage({
        type: "loading",
      })
      .then(
        () => console.log("ローディングメッセージを送信しました"),
        (err: Error) => {
          console.error("ローディングメッセージの送信に失敗:", err);
          // HTMLの再設定を試みる
          this._resetHtml();
        }
      );
  }

  /**
   * WebViewにエラーメッセージを表示
   */
  private _postErrorMessage(message: string) {
    if (!this._view?.webview) return;

    this._view.webview
      .postMessage({
        type: "error",
        message: message,
      })
      .then(
        () => {},
        (err: Error) => {
          console.error("エラーメッセージの送信に失敗:", err);
          this._resetHtml();
        }
      );
  }

  /**
   * WebViewにイシュー詳細データを送信
   */
  private _postIssueData(issue: any, comments: any[]) {
    if (!this._view?.webview) return;

    this._view.webview
      .postMessage({
        type: "updateIssue",
        issue: issue,
        comments: comments,
      })
      .then(
        () => console.log(`イシュー(${issue.id})データを送信しました`),
        (err: Error) => {
          console.error("イシューデータの送信に失敗:", err);
          this._resetHtml();
        }
      );
  }

  /**
   * HTMLをリセットして再初期化する
   */
  private _resetHtml() {
    if (!this._view?.webview) return;

    console.log("WebViewのHTMLをリセットします");
    this._view.webview.html = this._getWebviewHtml(this._view.webview);
    this._isReady = false;
  }

  /**
   * WebView用のHTMLを生成
   * 外部HTMLファイルを読み込み、CSS/JSパスを置換する
   */
  private _getWebviewHtml(webview: vscode.Webview): string {
    // リソースのパスを取得
    const htmlPath = vscode.Uri.joinPath(
      this._extensionUri,
      "resources",
      "webview",
      "issueDetail",
      "index.html"
    );
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        "resources",
        "webview",
        "issueDetail",
        "styles.css"
      )
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        "resources",
        "webview",
        "issueDetail",
        "main.js"
      )
    );

    // CSP (Content Security Policy) を設定
    const cspSource = webview.cspSource;

    try {
      // HTMLファイルを読み込む
      let html = fs.readFileSync(htmlPath.fsPath, "utf8");

      // リソースURIを置換
      html = html
        .replace(/{{stylesUri}}/g, stylesUri.toString())
        .replace(/{{scriptUri}}/g, scriptUri.toString())
        .replace(/{{cspSource}}/g, cspSource);

      return html;
    } catch (error) {
      console.error("HTMLファイルの読み込みに失敗:", error);

      // エラー時はフォールバックの簡易HTMLを返す
      return `<!DOCTYPE html>
      <html lang="ja">
      <head>
        <meta charset="UTF-8">
        <title>Linear Issue Detail</title>
        <style>
          body { font-family: var(--vscode-font-family); padding: 20px; }
          .error { color: var(--vscode-errorForeground); }
        </style>
      </head>
      <body>
        <h3>読み込みエラー</h3>
        <p class="error">WebViewリソースの読み込みに失敗しました。</p>
        <p>しばらく待ってから再試行してください。</p>
        <button onclick="location.reload()">再読み込み</button>
      </body>
      </html>`;
    }
  }
}
