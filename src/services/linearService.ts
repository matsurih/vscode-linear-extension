import {
  LinearClient,
  Team,
  IssuePayload,
  WorkflowState,
  Project,
  Issue,
} from "@linear/sdk";

export interface SearchCriteria {
  query?: string;
  labels?: string[];
  teamIds?: string[];
  assigneeIds?: string[];
  createdAfter?: Date;
  createdBefore?: Date;
  updatedAfter?: Date;
  updatedBefore?: Date;
}

export class LinearService {
  private client: LinearClient;

  constructor(apiToken: string) {
    this.client = new LinearClient({ apiKey: apiToken });
  }

  public async getIssues(
    filterMine: boolean = false,
    includeCompleted: boolean = false
  ) {
    try {
      const me = await this.client.viewer;
      const completedStates = includeCompleted
        ? []
        : await this.getCompletedStateIds();

      const issues = await this.client.issues({
        filter: {
          ...(filterMine ? { assignee: { id: { eq: me.id } } } : {}),
          ...(completedStates.length > 0
            ? { state: { id: { nin: completedStates } } }
            : {}),
        },
      });

      return issues.nodes;
    } catch (error) {
      throw new Error(`Failed to fetch issues: ${error}`);
    }
  }

  private async getCompletedStateIds(): Promise<string[]> {
    try {
      const teams = await this.client.teams();
      const completedStateIds: string[] = [];

      for (const team of teams.nodes) {
        const states = await this.client.workflowStates({
          filter: {
            team: { id: { eq: team.id } },
            type: { eq: "completed" },
          },
        });
        completedStateIds.push(...states.nodes.map((state) => state.id));
      }

      return completedStateIds;
    } catch (error) {
      console.error(`Failed to fetch completed states: ${error}`);
      return [];
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

  public async getWorkflowStates(teamId: string): Promise<WorkflowState[]> {
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

  public async updateIssueState(
    issueId: string,
    stateId: string
  ): Promise<IssuePayload> {
    try {
      const issue = await this.client.updateIssue(issueId, { stateId });
      return issue;
    } catch (error) {
      throw new Error(`Failed to update issue state: ${error}`);
    }
  }

  public async getProject(projectId: string): Promise<Project | null> {
    try {
      const project = await this.client.project(projectId);
      return project;
    } catch (error) {
      console.error(`Failed to fetch project: ${error}`);
      return null;
    }
  }

  public async getProjects(): Promise<Project[]> {
    try {
      const projects = await this.client.projects();
      return projects.nodes;
    } catch (error) {
      console.error(`Failed to fetch projects: ${error}`);
      return [];
    }
  }

  public updateApiToken(apiToken: string) {
    this.client = new LinearClient({ apiKey: apiToken });
  }

  public async searchIssues(criteria: SearchCriteria): Promise<Issue[]> {
    try {
      const filter: any = {};

      if (criteria.query) {
        filter.or = [
          { title: { contains: criteria.query } },
          { description: { contains: criteria.query } },
          { number: { eq: parseInt(criteria.query) || undefined } },
        ];
      }

      if (criteria.labels?.length) {
        filter.labels = { some: { name: { in: criteria.labels } } };
      }

      if (criteria.teamIds?.length) {
        filter.team = { id: { in: criteria.teamIds } };
      }

      if (criteria.assigneeIds?.length) {
        filter.assignee = { id: { in: criteria.assigneeIds } };
      }

      if (criteria.createdAfter || criteria.createdBefore) {
        filter.createdAt = {};
        if (criteria.createdAfter) {
          filter.createdAt.gte = criteria.createdAfter;
        }
        if (criteria.createdBefore) {
          filter.createdAt.lte = criteria.createdBefore;
        }
      }

      if (criteria.updatedAfter || criteria.updatedBefore) {
        filter.updatedAt = {};
        if (criteria.updatedAfter) {
          filter.updatedAt.gte = criteria.updatedAfter;
        }
        if (criteria.updatedBefore) {
          filter.updatedAt.lte = criteria.updatedBefore;
        }
      }

      const issues = await this.client.issues({
        filter,
      });

      return issues.nodes;
    } catch (error) {
      throw new Error(`Failed to search issues: ${error}`);
    }
  }

  public async getLabels(): Promise<{ id: string; name: string }[]> {
    try {
      const labels = await this.client.issueLabels();
      return labels.nodes.map((label) => ({
        id: label.id,
        name: label.name,
      }));
    } catch (error) {
      console.error(`Failed to fetch labels: ${error}`);
      return [];
    }
  }

  public async getTeamMembers(
    teamId: string
  ): Promise<{ id: string; name: string }[]> {
    try {
      const team = await this.client.team(teamId);
      const members = await team.members();
      return members.nodes.map((member) => ({
        id: member.id,
        name: member.name,
      }));
    } catch (error) {
      console.error(`Failed to fetch team members: ${error}`);
      return [];
    }
  }
}
