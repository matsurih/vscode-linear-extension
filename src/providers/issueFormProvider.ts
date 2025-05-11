import * as vscode from "vscode";
import { LinearService } from "../services/linearService";
import { Issue } from "@linear/sdk";

interface IssueFormData {
  teamId: string;
  title: string;
  description?: string;
  stateId: string;
}

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

    webviewView.webview.html = this._getHtmlForWebview();

    // WebViewからのメッセージを処理
    webviewView.webview.onDidReceiveMessage(async (data) => {
      try {
        switch (data.type) {
          case "createIssue":
            await this.handleCreateIssue(data);
            break;

          case "updateIssue":
            await this.handleUpdateIssue(data);
            break;

          case "getTeams":
            await this.handleGetTeams();
            break;

          case "getStates":
            await this.handleGetStates(data.teamId);
            break;

          case "cancel":
            this.handleCancel();
            break;
        }
      } catch (error) {
        this.handleError(error);
      }
    });
  }

  private async handleCreateIssue(data: IssueFormData) {
    try {
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

      // 作成成功後にフォームをリセット
      this.showCreateForm();

      // イベントを発行してツリービューを更新
      vscode.commands.executeCommand("linear.refreshIssues");
    } catch (error) {
      throw new Error(`Failed to create issue: ${error}`);
    }
  }

  private async handleUpdateIssue(data: IssueFormData & { issueId: string }) {
    try {
      const updatedIssue = await this._linearService.updateIssue(data.issueId, {
        title: data.title,
        description: data.description,
        stateId: data.stateId,
      });

      vscode.window.showInformationMessage(
        `Issue "${data.title}" has been updated`
      );

      this._view?.webview.postMessage({
        type: "issueUpdated",
        issue: updatedIssue,
      });

      // 更新成功後にフォームをリセット
      this.showCreateForm();

      // イベントを発行してツリービューを更新
      vscode.commands.executeCommand("linear.refreshIssues");
    } catch (error) {
      throw new Error(`Failed to update issue: ${error}`);
    }
  }

  private async handleGetTeams() {
    try {
      const teams = await this._linearService.getTeams();
      this._view?.webview.postMessage({ type: "teamsLoaded", teams });
    } catch (error) {
      throw new Error(`Failed to load teams: ${error}`);
    }
  }

  private async handleGetStates(teamId: string) {
    try {
      const states = await this._linearService.getWorkflowStates(teamId);
      this._view?.webview.postMessage({ type: "statesLoaded", states });
    } catch (error) {
      throw new Error(`Failed to load states: ${error}`);
    }
  }

  private handleCancel() {
    this.showCreateForm();
  }

  private handleError(error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(errorMessage);
    this._view?.webview.postMessage({
      type: "error",
      message: errorMessage,
    });
  }

  public showCreateForm() {
    if (this._view) {
      this._view.show(true);
      this._view.webview.postMessage({ type: "showCreateForm" });
    }
  }

  public showEditForm(issue: Issue) {
    if (this._view) {
      this._view.show(true);
      this._view.webview.postMessage({ type: "showEditForm", issue });
    }
  }

  private _getHtmlForWebview(): string {
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
          font-weight: 500;
        }
        input, textarea, select {
          width: 100%;
          padding: 8px;
          background: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
          border-radius: 3px;
        }
        input:focus, textarea:focus, select:focus {
          outline: 2px solid var(--vscode-focusBorder);
          border-color: transparent;
        }
        textarea {
          min-height: 120px;
          resize: vertical;
        }
        button {
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          padding: 8px 16px;
          cursor: pointer;
          border-radius: 3px;
          font-weight: 500;
          transition: background-color 0.2s;
        }
        button:hover {
          background: var(--vscode-button-hoverBackground);
        }
        button:focus {
          outline: 2px solid var(--vscode-focusBorder);
          outline-offset: 2px;
        }
        .error {
          color: var(--vscode-errorForeground);
          font-size: 12px;
          margin-top: 4px;
        }
        .hidden {
          display: none;
        }
        .loading {
          position: relative;
          opacity: 0.7;
          pointer-events: none;
        }
        .loading::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.1);
        }
        .form-header {
          margin-bottom: 20px;
          padding-bottom: 10px;
          border-bottom: 1px solid var(--vscode-input-border);
        }
        .form-footer {
          margin-top: 20px;
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }
        .cancel-button {
          background: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
        }
        .cancel-button:hover {
          background: var(--vscode-button-secondaryHoverBackground);
        }
      </style>
    </head>
    <body>
      <div id="create-form">
        <div class="form-header">
          <h2 aria-live="polite">Create New Issue</h2>
        </div>
        <form id="issue-form" novalidate>
          <div class="form-group">
            <label for="team">Team</label>
            <select id="team" required aria-required="true">
              <option value="">Select a team</option>
            </select>
            <div id="team-error" class="error hidden" role="alert"></div>
          </div>
          <div class="form-group">
            <label for="state">Status</label>
            <select id="state" required aria-required="true">
              <option value="">Select a status</option>
            </select>
            <div id="state-error" class="error hidden" role="alert"></div>
          </div>
          <div class="form-group">
            <label for="title">Title</label>
            <input type="text" id="title" required aria-required="true" 
                   minlength="3" maxlength="255"
                   aria-describedby="title-error">
            <div id="title-error" class="error hidden" role="alert"></div>
          </div>
          <div class="form-group">
            <label for="description">Description</label>
            <textarea id="description" aria-describedby="description-error"></textarea>
            <div id="description-error" class="error hidden" role="alert"></div>
          </div>
          <div class="form-footer">
            <button type="button" class="cancel-button" id="cancel-button">Cancel</button>
            <button type="submit">Create</button>
          </div>
        </form>
      </div>

      <script>
        const vscode = acquireVsCodeApi();
        let currentIssue = null;
        let teams = [];
        let states = [];
        let isSubmitting = false;

        // フォームの状態管理
        const formState = {
          isValid: false,
          errors: new Map(),
          setError(field, message) {
            const errorElement = document.getElementById(\`\${field}-error\`);
            if (errorElement) {
              errorElement.textContent = message;
              errorElement.classList.remove('hidden');
              this.errors.set(field, message);
            }
          },
          clearError(field) {
            const errorElement = document.getElementById(\`\${field}-error\`);
            if (errorElement) {
              errorElement.classList.add('hidden');
              this.errors.delete(field);
            }
          },
          validateField(field) {
            const element = document.getElementById(field);
            if (!element) return;

            this.clearError(field);

            if (element.required && !element.value) {
              this.setError(field, \`\${field.charAt(0).toUpperCase() + field.slice(1)} is required\`);
              return false;
            }

            if (field === 'title') {
              if (element.value.length < 3) {
                this.setError(field, 'Title must be at least 3 characters long');
                return false;
              }
              if (element.value.length > 255) {
                this.setError(field, 'Title must be less than 255 characters');
                return false;
              }
            }

            return true;
          },
          validateForm() {
            const fields = ['team', 'state', 'title'];
            const isValid = fields.every(field => this.validateField(field));
            this.isValid = isValid;
            return isValid;
          }
        };

        // Get teams on initialization
        vscode.postMessage({ type: 'getTeams' });

        // Form submission handler
        document.getElementById('issue-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          if (isSubmitting) return;

          if (!formState.validateForm()) {
            return;
          }

          const form = e.target;
          form.classList.add('loading');
          isSubmitting = true;

          try {
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
          } catch (error) {
            formState.setError('form', 'An error occurred. Please try again.');
          } finally {
            form.classList.remove('loading');
            isSubmitting = false;
          }
        });

        // Input validation handlers
        ['team', 'state', 'title'].forEach(field => {
          const element = document.getElementById(field);
          element.addEventListener('input', () => {
            formState.validateField(field);
          });
          element.addEventListener('blur', () => {
            formState.validateField(field);
          });
        });

        // Team selection handler
        document.getElementById('team').addEventListener('change', (e) => {
          const teamId = e.target.value;
          const stateSelect = document.getElementById('state');
          stateSelect.innerHTML = '<option value="">Loading states...</option>';
          stateSelect.disabled = true;

          if (teamId) {
            vscode.postMessage({ type: 'getStates', teamId });
          }
        });

        // Cancel button handler
        document.getElementById('cancel-button').addEventListener('click', () => {
          vscode.postMessage({ type: 'cancel' });
        });

        // WebView message handler
        window.addEventListener('message', event => {
          const message = event.data;

          switch (message.type) {
            case 'teamsLoaded':
              teams = message.teams;
              const teamSelect = document.getElementById('team');
              teamSelect.innerHTML = [
                '<option value="">Select a team</option>',
                ...teams.map(team =>
                  \`<option value="\${team.id}">\${team.name}</option>\`
                )
              ].join('');
              if (teams.length > 0 && currentIssue?.team) {
                teamSelect.value = currentIssue.team.id;
                vscode.postMessage({ type: 'getStates', teamId: currentIssue.team.id });
              }
              break;

            case 'statesLoaded':
              states = message.states;
              const stateSelect = document.getElementById('state');
              stateSelect.innerHTML = [
                '<option value="">Select a status</option>',
                ...states.map(state =>
                  \`<option value="\${state.id}">\${state.name}</option>\`
                )
              ].join('');
              stateSelect.disabled = false;
              if (currentIssue?.state) {
                stateSelect.value = currentIssue.state.id;
              }
              break;

            case 'showCreateForm':
              currentIssue = null;
              document.getElementById('issue-form').reset();
              document.querySelector('h2').textContent = 'Create New Issue';
              document.querySelector('button[type="submit"]').textContent = 'Create';
              // Clear all error messages
              document.querySelectorAll('.error').forEach(el => el.classList.add('hidden'));
              break;

            case 'showEditForm':
              currentIssue = message.issue;
              document.querySelector('h2').textContent = 'Edit Issue';
              document.querySelector('button[type="submit"]').textContent = 'Update';
              
              // Set form values
              document.getElementById('title').value = currentIssue.title;
              document.getElementById('description').value = currentIssue.description || '';
              
              // Clear all error messages
              document.querySelectorAll('.error').forEach(el => el.classList.add('hidden'));
              
              // Set team and trigger state load
              if (currentIssue.team) {
                document.getElementById('team').value = currentIssue.team.id;
                vscode.postMessage({ type: 'getStates', teamId: currentIssue.team.id });
              }
              break;

            case 'error':
              formState.setError('form', message.message);
              break;
          }
        });
      </script>
    </body>
    </html>`;
  }
}
