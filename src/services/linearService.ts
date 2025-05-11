import { LinearClient } from "@linear/sdk";

export class LinearService {
  private client: LinearClient;

  constructor(apiToken: string) {
    this.client = new LinearClient({ apiKey: apiToken });
  }

  public async getIssues(filterMine: boolean = false) {
    try {
      const me = await this.client.viewer;
      const issues = await this.client.issues({
        filter: {
          ...(filterMine ? { assignee: { id: { eq: me.id } } } : {}),
        },
      });

      return issues.nodes;
    } catch (error) {
      throw new Error(`Failed to fetch issues: ${error}`);
    }
  }

  public async getIssueDetails(issueId: string) {
    try {
      const issue = await this.client.issue(issueId);
      return issue;
    } catch (error) {
      throw new Error(`Failed to fetch issue details: ${error}`);
    }
  }

  public async getIssueComments(issueId: string) {
    try {
      const comments = await this.client.comments({
        filter: {
          issue: { id: { eq: issueId } },
        },
      });
      return comments.nodes;
    } catch (error) {
      throw new Error(`Failed to fetch comments: ${error}`);
    }
  }

  public async addComment(issueId: string, content: string) {
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
