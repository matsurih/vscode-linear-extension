import { LinearClient, Team, IssuePayload } from "@linear/sdk";

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

  public async getTeams(): Promise<Team[]> {
    try {
      const teams = await this.client.teams();
      return teams.nodes;
    } catch (error) {
      throw new Error(`Failed to fetch teams: ${error}`);
    }
  }

  public async createIssue(input: {
    teamId: string;
    title: string;
    description?: string;
    assigneeId?: string;
    stateId?: string;
  }): Promise<IssuePayload> {
    try {
      const issue = await this.client.createIssue(input);
      return issue;
    } catch (error) {
      throw new Error(`Failed to create issue: ${error}`);
    }
  }

  public async updateIssue(
    issueId: string,
    input: {
      title?: string;
      description?: string;
      assigneeId?: string;
      stateId?: string;
    }
  ): Promise<IssuePayload> {
    try {
      const issue = await this.client.updateIssue(issueId, input);
      return issue;
    } catch (error) {
      throw new Error(`Failed to update issue: ${error}`);
    }
  }

  public async getWorkflowStates(teamId: string) {
    try {
      const states = await this.client.workflowStates({
        filter: {
          team: { id: { eq: teamId } },
        },
      });
      return states.nodes;
    } catch (error) {
      throw new Error(`Failed to fetch workflow states: ${error}`);
    }
  }

  public updateApiToken(apiToken: string) {
    this.client = new LinearClient({ apiKey: apiToken });
  }
}
