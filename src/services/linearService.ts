import { LinearClient } from "@linear/sdk";
import * as vscode from "vscode";

export class LinearService {
  private client: LinearClient | undefined;

  constructor() {
    this.initializeClient();
  }

  private initializeClient() {
    const config = vscode.workspace.getConfiguration("linear");
    const apiToken = config.get<string>("apiToken");

    if (apiToken) {
      this.client = new LinearClient({ apiKey: apiToken });
    }
  }

  public async getIssues(filterMine: boolean = false) {
    if (!this.client) {
      throw new Error(
        "Linear client is not initialized. Please set your API token."
      );
    }

    try {
      const me = await this.client.viewer;
      const issues = await this.client.issues({
        filter: {
          ...(filterMine ? { assignee: { id: { eq: me.id } } } : {}),
        },
        orderBy: "updatedAt",
      });

      return issues.nodes;
    } catch (error) {
      throw new Error(`Failed to fetch issues: ${error}`);
    }
  }

  public async addComment(issueId: string, content: string) {
    if (!this.client) {
      throw new Error(
        "Linear client is not initialized. Please set your API token."
      );
    }

    try {
      await this.client.createComment({
        issueId,
        body: content,
      });
    } catch (error) {
      throw new Error(`Failed to add comment: ${error}`);
    }
  }

  public updateApiToken(apiToken: string) {
    this.client = new LinearClient({ apiKey: apiToken });
  }
}
