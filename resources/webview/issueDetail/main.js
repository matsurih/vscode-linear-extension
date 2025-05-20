(function () {
  // VSCode APIの取得
  const vscode = acquireVsCodeApi();

  // DOM要素の参照
  const loadingEl = document.getElementById('loading');
  const emptyStateEl = document.getElementById('empty-state');
  const errorEl = document.getElementById('error');
  const issueDetailEl = document.getElementById('issue-detail');
  const issueIdEl = document.getElementById('issue-id');
  const issueTitleEl = document.getElementById('issue-title');
  const issueStatusEl = document.getElementById('issue-status');
  const issuePriorityEl = document.getElementById('issue-priority');
  const issueAssigneeEl = document.getElementById('issue-assignee');
  const issueDescriptionEl = document.getElementById('issue-description');
  const commentsListEl = document.getElementById('comments-list');
  const commentInputEl = document.getElementById('comment-input');
  const commentSubmitEl = document.getElementById('comment-submit');
  const debugInfoEl = document.getElementById('debug-info');

  // 現在表示中のイシューID
  let currentIssueId = null;

  // デバッグログ
  const logs = [];
  function log(message) {
    const time = new Date().toLocaleTimeString();
    const logMessage = '[' + time + '] ' + message;
    logs.push(logMessage);

    if (debugInfoEl) {
      debugInfoEl.textContent = logs.join('\n');
      debugInfoEl.scrollTop = debugInfoEl.scrollHeight;
    }

    console.log('[WebView] ' + message);
  }

  // エラーハンドリング
  window.onerror = function (message, source, lineno, colno, error) {
    log('ERROR: ' + message + ' (' + source + ':' + lineno + ':' + colno + ')');
    vscode.postMessage({
      type: 'debug',
      data: { error: message, source: source, lineno: lineno, colno: colno }
    });
    return false;
  };

  // 表示状態の切り替え
  function showLoading() {
    loadingEl.classList.remove('hidden');
    emptyStateEl.classList.add('hidden');
    errorEl.classList.add('hidden');
    issueDetailEl.classList.add('hidden');
    log('ローディング表示に切り替えました');
  }

  function showEmptyState() {
    loadingEl.classList.add('hidden');
    emptyStateEl.classList.remove('hidden');
    errorEl.classList.add('hidden');
    issueDetailEl.classList.add('hidden');
    log('空の状態表示に切り替えました');
  }

  function showError(message) {
    loadingEl.classList.add('hidden');
    emptyStateEl.classList.add('hidden');
    errorEl.classList.remove('hidden');
    issueDetailEl.classList.add('hidden');

    errorEl.textContent = message;
    log('エラー表示: ' + message);
  }

  function showIssueDetail() {
    loadingEl.classList.add('hidden');
    emptyStateEl.classList.add('hidden');
    errorEl.classList.add('hidden');
    issueDetailEl.classList.remove('hidden');
    log('イシュー詳細表示に切り替えました');
  }

  // イベントハンドラの設定
  commentSubmitEl.addEventListener('click', function () {
    const content = commentInputEl.value.trim();
    if (!content || !currentIssueId) return;

    log('コメント送信: ' + content);
    vscode.postMessage({
      type: 'addComment',
      issueId: currentIssueId,
      content: content
    });

    commentInputEl.value = '';
    showLoading();
  });

  // イシュー詳細を表示
  function displayIssueDetail(issue, comments) {
    if (!issue) {
      showError('イシュー情報が見つかりませんでした');
      return;
    }

    try {
      // イシューIDを保存
      currentIssueId = issue.id;

      // 基本情報の表示
      issueIdEl.textContent = issue.identifier || '';
      issueTitleEl.textContent = issue.title || '';

      // 状態の表示
      const state = issue.state;
      issueStatusEl.textContent = state ? '状態: ' + (state.name || '不明') : '';

      // 優先度の表示
      const priorityMap = {
        0: '優先度なし',
        1: '低',
        2: '中',
        3: '高',
        4: '緊急'
      };
      issuePriorityEl.textContent = '優先度: ' + (priorityMap[issue.priority] || '不明');

      // 担当者の表示
      const assignee = issue.assignee;
      issueAssigneeEl.textContent = assignee ? '担当: ' + (assignee.name || '不明') : '担当なし';

      // 説明の表示
      issueDescriptionEl.textContent = issue.description || '説明なし';

      // コメントの表示
      commentsListEl.innerHTML = '';
      if (comments && comments.length > 0) {
        comments.forEach(comment => {
          const commentEl = document.createElement('div');
          commentEl.className = 'comment';

          // コメント内容
          const commentBodyEl = document.createElement('div');
          commentBodyEl.textContent = comment.body || '';

          // 日時
          const commentDateEl = document.createElement('div');
          commentDateEl.className = 'comment-date';
          const date = comment.createdAt ? new Date(comment.createdAt) : new Date();
          commentDateEl.textContent = date.toLocaleString();

          commentEl.appendChild(commentBodyEl);
          commentEl.appendChild(commentDateEl);
          commentsListEl.appendChild(commentEl);
        });
      } else {
        const noCommentsEl = document.createElement('div');
        noCommentsEl.textContent = 'コメントはありません';
        commentsListEl.appendChild(noCommentsEl);
      }

      // 表示を切り替え
      showIssueDetail();
      log('イシュー詳細を表示しました: ' + issue.identifier);

    } catch (error) {
      log('イシュー表示エラー: ' + error.message);
      showError('イシュー情報の表示中にエラーが発生しました');
    }
  }

  // メッセージハンドラ
  window.addEventListener('message', event => {
    const message = event.data;
    log('メッセージ受信: ' + message.type);

    try {
      switch (message.type) {
        case 'loading':
          showLoading();
          break;

        case 'updateIssue':
          displayIssueDetail(message.issue, message.comments);
          break;

        case 'error':
          showError(message.message || 'エラーが発生しました');
          break;

        case 'diagnostics':
          log('診断情報を受信: ' + JSON.stringify(message.data));
          // 診断情報の表示（コンソールにのみ出力）
          break;

        default:
          log('不明なメッセージタイプ: ' + message.type);
      }
    } catch (error) {
      log('メッセージ処理エラー: ' + error.message);
      showError('内部エラーが発生しました: ' + error.message);
      vscode.postMessage({
        type: 'debug',
        data: { error: error.message, stack: error.stack ? error.stack : 'スタック情報なし' }
      });
    }
  });

  // 初期表示
  showEmptyState();
  log('WebView初期化完了');

  // 準備完了通知
  setTimeout(() => {
    vscode.postMessage({ type: 'ready' });
    log('Ready信号を送信しました');
  }, 300);
})(); 