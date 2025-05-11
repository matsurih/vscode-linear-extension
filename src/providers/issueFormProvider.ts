import * as vscode from "vscode";
import { LinearService } from "../services/linearService";
import { Issue, Team, IssuePayload } from "@linear/sdk";

export class IssueFormProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "linearIssueForm";
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
      try {
        switch (data.type) {
          case "createIssue":
            const createdIssue = await this._linearService.createIssue({
              teamId: data.teamId,
              title: data.title,
              description: data.description,
              stateId: data.stateId,
            });
            vscode.window.showInformationMessage(
              `Issue "${data.title}" has been created`
            );
            this._view?.webview.postMessage({
              type: "issueCreated",
              issue: createdIssue,
            });
            break;

          case "updateIssue":
            const updatedIssue = await this._linearService.updateIssue(
              data.issueId,
              {
                title: data.title,
                description: data.description,
                stateId: data.stateId,
              }
            );
            vscode.window.showInformationMessage(
              `Issue "${data.title}" has been updated`
            );
            this._view?.webview.postMessage({
              type: "issueUpdated",
              issue: updatedIssue,
            });
            break;

          case "getTeams":
            const teams = await this._linearService.getTeams();
            this._view?.webview.postMessage({ type: "teamsLoaded", teams });
            break;

          case "getStates":
            const states = await this._linearService.getWorkflowStates(
              data.teamId
            );
            this._view?.webview.postMessage({ type: "statesLoaded", states });
            break;
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Operation failed: ${error}`);
      }
    });
  }

  public showCreateForm() {
    if (this._view) {
      this._view.webview.postMessage({ type: "showCreateForm" });
    }
  }

  public showEditForm(issue: Issue) {
    if (this._view) {
      this._view.webview.postMessage({ type: "showEditForm", issue });
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Issue Form</title>
      <style>
        body {
          padding: 10px;
          color: var(--vscode-foreground);
          font-family: var(--vscode-font-family);
        }
        .form-group {
          margin-bottom: 15px;
        }
        label {
          display: block;
          margin-bottom: 5px;
        }
        input, textarea, select {
          width: 100%;
          padding: 5px;
          background: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
        }
        textarea {
          min-height: 100px;
          resize: vertical;
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
        .hidden {
          display: none;
        }
      </style>
    </head>
    <body>
      <div id="create-form">
        <h2>Create New Issue</h2>
        <form id="issue-form">
          <div class="form-group">
            <label for="team">Team</label>
            <select id="team" required></select>
          </div>
          <div class="form-group">
            <label for="state">Status</label>
            <select id="state"></select>
          </div>
          <div class="form-group">
            <label for="title">Title</label>
            <input type="text" id="title" required>
          </div>
          <div class="form-group">
            <label for="description">Description</label>
            <textarea id="description"></textarea>
          </div>
          <button type="submit">Create</button>
        </form>
      </div>

      <script>
        const vscode = acquireVsCodeApi();
        let currentIssue = null;
        let teams = [];
        let states = [];

        // Get teams on initialization
        vscode.postMessage({ type: 'getTeams' });

        // Form submission handler
        document.getElementById('issue-form').addEventListener('submit', (e) => {
          e.preventDefault();
          const teamId = document.getElementById('team').value;
          const stateId = document.getElementById('state').value;
          const title = document.getElementById('title').value;
          const description = document.getElementById('description').value;

          if (currentIssue) {
            vscode.postMessage({
              type: 'updateIssue',
              issueId: currentIssue.id,
              title,
              description,
              stateId
            });
          } else {
            vscode.postMessage({
              type: 'createIssue',
              teamId,
              title,
              description,
              stateId
            });
          }
        });

        // Team selection handler
        document.getElementById('team').addEventListener('change', (e) => {
          const teamId = e.target.value;
          if (teamId) {
            vscode.postMessage({ type: 'getStates', teamId });
          }
        });

        // WebView message handler
        window.addEventListener('message', event => {
          const message = event.data;

          switch (message.type) {
            case 'teamsLoaded':
              teams = message.teams;
              const teamSelect = document.getElementById('team');
              teamSelect.innerHTML = teams.map(team =>
                \`<option value="\${team.id}">\${team.name}</option>\`
              ).join('');
              if (teams.length > 0) {
                vscode.postMessage({ type: 'getStates', teamId: teams[0].id });
              }
              break;

            case 'statesLoaded':
              states = message.states;
              const stateSelect = document.getElementById('state');
              stateSelect.innerHTML = states.map(state =>
                \`<option value="\${state.id}">\${state.name}</option>\`
              ).join('');
              break;

            case 'showCreateForm':
              currentIssue = null;
              document.getElementById('issue-form').reset();
              document.querySelector('h2').textContent = 'Create New Issue';
              document.querySelector('button[type="submit"]').textContent = 'Create';
              break;

            case 'showEditForm':
              currentIssue = message.issue;
              document.querySelector('h2').textContent = 'Edit Issue';
              document.querySelector('button[type="submit"]').textContent = 'Update';
              document.getElementById('title').value = currentIssue.title;
              document.getElementById('description').value = currentIssue.description || '';
              // Set team and status selection
              if (currentIssue.team) {
                document.getElementById('team').value = currentIssue.team.id;
                vscode.postMessage({ type: 'getStates', teamId: currentIssue.team.id });
              }
              break;
          }
        });
      </script>
    </body>
    </html>`;
  }
}
