import * as vscode from "vscode";
import { LinearService } from "../services/linearService";
import { Issue } from "@linear/sdk";

export class IssueTreeProvider implements vscode.TreeDataProvider<Issue> {
  private _onDidChangeTreeData: vscode.EventEmitter<
    Issue | undefined | null | void
  > = new vscode.EventEmitter<Issue | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<Issue | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private filterMine: boolean = false;

  constructor(private linearService: LinearService) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  toggleFilter(): void {
    this.filterMine = !this.filterMine;
    this.refresh();
  }

  getTreeItem(issue: Issue): vscode.TreeItem {
    return {
      label: `${issue.identifier}: ${issue.title}`,
      description: issue.state?.name,
      tooltip: `Assignee: ${issue.assignee?.name || "Unassigned"}\nStatus: ${
        issue.state?.name
      }\nPriority: ${issue.priority}`,
      command: {
        command: "linear.openIssue",
        title: "Open Issue",
        arguments: [issue],
      },
      contextValue: "issue",
    };
  }

  async getChildren(element?: Issue): Promise<Issue[]> {
    if (element) {
      return [];
    }

    try {
      const issues = await this.linearService.getIssues(this.filterMine);
      return issues;
    } catch (error) {
      vscode.window.showErrorMessage(`Error fetching issues: ${error}`);
      return [];
    }
  }
}
