import {
  LinearClient,
  Team,
  IssuePayload,
  WorkflowState,
  Project,
  Issue,
  LinearError,
} from "@linear/sdk";

interface CacheItem<T> {
  data: T;
  timestamp: number;
  lastUpdate?: string;
}

interface Cache {
  [key: string]: CacheItem<any>;
}

interface LocalIssue extends Issue {
  _searchText?: string;
}

export interface SearchCriteria {
  query?: string;
  labels?: string[];
  teamIds?: string[];
  assigneeIds?: string[];
  createdAfter?: Date;
  updatedAfter?: Date;
  updatedBefore?: Date;
}

export class LinearService {
  private client!: LinearClient;
  private readonly CACHE_TTL = 5 * 60 * 1000;
  private readonly RETRY_COUNT = 3;
  private readonly RETRY_DELAY = 1000;
  private cache: Cache = {};
  private lastSyncTime?: string;

  constructor(apiKey: string) {
    this.initializeClient(apiKey);
  }

  private initializeClient(apiKey: string): void {
    this.client = new LinearClient({ apiKey });
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;
    for (let i = 0; i < this.RETRY_COUNT; i++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        if (
          error instanceof LinearError &&
          error.message.includes("rate limit")
        ) {
          const waitTime = this.RETRY_DELAY * Math.pow(2, i);
          console.log(
            `Rate limit reached. Waiting ${waitTime}ms before retry ${i + 1}/${
              this.RETRY_COUNT
            }`
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  private getCached<T>(key: string): T | null {
    const item = this.cache[key];
    if (!item) return null;
    if (Date.now() - item.timestamp > this.CACHE_TTL) {
      delete this.cache[key];
      return null;
    }
    return item.data;
  }

  private setCache<T>(key: string, data: T): void {
    this.cache[key] = {
      data,
      timestamp: Date.now(),
    };
  }

  private createSearchIndex(issue: Issue): LocalIssue {
    const localIssue = issue as LocalIssue;
    localIssue._searchText = [
      issue.title,
      issue.description,
      issue.identifier,
      issue.assignee ? (issue.assignee as any).name : "",
      issue.team ? (issue.team as any).name : "",
      issue.labels
        ? (issue.labels as any).nodes?.map((l: any) => l.name).join(" ")
        : "",
      issue.state ? (issue.state as any).name : "",
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return localIssue;
  }

  private async fetchUpdatedIssues(since?: string): Promise<Issue[]> {
    try {
      const filter: any = {};
      if (since) {
        filter.updatedAt = { gt: since };
      }

      const issues = await this.client.issues({
        filter,
        first: 100,
      });

      return issues.nodes;
    } catch (error) {
      console.error("Failed to fetch updated issues:", error);
      return [];
    }
  }

  public async getIssues(
    filterMine: boolean = false,
    includeCompleted: boolean = false
  ) {
    const cacheKey = `issues:${filterMine}:${includeCompleted}`;
    const cached = this.getCached<LocalIssue[]>(cacheKey);

    try {
      // 差分更新の実行
      if (cached && this.lastSyncTime) {
        const updatedIssues = await this.fetchUpdatedIssues(this.lastSyncTime);
        if (updatedIssues.length > 0) {
          const updatedIds = new Set(updatedIssues.map((i) => i.id));
          const filteredCache = cached.filter((i) => !updatedIds.has(i.id));
          const newIssues = [
            ...filteredCache,
            ...updatedIssues.map((i) => this.createSearchIndex(i)),
          ];
          this.setCache(cacheKey, newIssues);
          this.lastSyncTime = new Date().toISOString();
          return this.filterIssues(newIssues, filterMine, includeCompleted);
        }
        return this.filterIssues(cached, filterMine, includeCompleted);
      }

      // 初回またはキャッシュ無効時の全件取得
      const result = await this.withRetry(async () => {
        const filter: any = {};
        if (filterMine) {
          const me = await this.client.viewer;
          filter.assignee = { id: { eq: me.id } };
        }
        if (!includeCompleted) {
          filter.state = { type: { neq: "completed" } };
        }
        const issues = await this.client.issues({
          filter,
          first: 100,
        });
        return issues.nodes.map((i) => this.createSearchIndex(i));
      });

      this.setCache(cacheKey, result);
      this.lastSyncTime = new Date().toISOString();
      return result;
    } catch (error) {
      if (cached) {
        return this.filterIssues(cached, filterMine, includeCompleted);
      }
      throw new Error(`Failed to fetch issues: ${error}`);
    }
  }

  private async filterIssues(
    issues: LocalIssue[],
    filterMine: boolean,
    includeCompleted: boolean
  ): Promise<LocalIssue[]> {
    try {
      if (filterMine) {
        const me = await this.client.viewer;
        return issues.filter((issue) => {
          if (
            !issue.assignee ||
            (issue.assignee as any).id !== (me as any).id
          ) {
            return false;
          }
          if (!includeCompleted && (issue.state as any)?.type === "completed") {
            return false;
          }
          return true;
        });
      }
      return issues.filter((issue) => {
        if (!includeCompleted && (issue.state as any)?.type === "completed") {
          return false;
        }
        return true;
      });
    } catch (error) {
      console.error("Failed to filter issues:", error);
      return issues;
    }
  }

  public async searchIssues(criteria: SearchCriteria): Promise<Issue[]> {
    try {
      // キャッシュからすべてのissueを取得
      const allIssues = await this.getIssues(false, true);

      return allIssues.filter((issue) => {
        // クライアントサイドでのフィルタリング
        if (
          criteria.query &&
          !issue._searchText?.includes(criteria.query.toLowerCase())
        ) {
          return false;
        }

        if (
          criteria.labels?.length &&
          !(issue.labels as any)?.nodes?.some((l: any) =>
            criteria.labels?.includes(l.id)
          )
        ) {
          return false;
        }

        if (
          criteria.teamIds?.length &&
          !criteria.teamIds.includes((issue.team as any)?.id)
        ) {
          return false;
        }

        if (
          criteria.assigneeIds?.length &&
          (!issue.assignee ||
            !criteria.assigneeIds.includes((issue.assignee as any).id))
        ) {
          return false;
        }

        if (
          criteria.createdAfter &&
          new Date(issue.createdAt) < criteria.createdAfter
        ) {
          return false;
        }

        if (
          criteria.updatedAfter &&
          new Date(issue.updatedAt) < criteria.updatedAfter
        ) {
          return false;
        }

        if (
          criteria.updatedBefore &&
          new Date(issue.updatedAt) > criteria.updatedBefore
        ) {
          return false;
        }

        return true;
      });
    } catch (error) {
      console.error("Failed to search issues:", error);
      throw error;
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
      console.error("Failed to fetch teams:", error);
      throw error;
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
      const result = await this.client.createIssue({
        teamId: input.teamId,
        title: input.title,
        description: input.description,
        stateId: input.stateId,
        assigneeId: input.assigneeId,
      });
      return result;
    } catch (error) {
      console.error("Failed to create issue:", error);
      throw error;
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
      const result = await this.client.updateIssue(issueId, {
        title: input.title,
        description: input.description,
        assigneeId: input.assigneeId,
        stateId: input.stateId,
      });
      return result;
    } catch (error) {
      console.error("Failed to update issue:", error);
      throw error;
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
      console.error("Failed to fetch workflow states:", error);
      throw error;
    }
  }

  public async updateIssueState(
    issueId: string,
    stateId: string
  ): Promise<IssuePayload> {
    try {
      const result = await this.client.updateIssue(issueId, {
        stateId: stateId,
      });
      return result;
    } catch (error) {
      console.error("Failed to update issue state:", error);
      throw error;
    }
  }

  public async getProject(projectId: string): Promise<Project | null> {
    try {
      const project = await this.client.project(projectId);
      return project;
    } catch (error) {
      if (error instanceof LinearError && error.message.includes("not found")) {
        return null;
      }
      console.error("Failed to fetch project:", error);
      throw error;
    }
  }

  public async getProjects(): Promise<Project[]> {
    try {
      const projects = await this.client.projects();
      return projects.nodes;
    } catch (error) {
      console.error("Failed to fetch projects:", error);
      throw error;
    }
  }

  public updateApiToken(apiToken: string) {
    this.initializeClient(apiToken);
  }

  public async getLabels(): Promise<{ id: string; name: string }[]> {
    try {
      const labels = await this.client.issueLabels();
      return labels.nodes.map((label) => ({
        id: label.id,
        name: label.name,
      }));
    } catch (error) {
      console.error("Failed to fetch labels:", error);
      throw error;
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
      console.error("Failed to fetch team members:", error);
      throw error;
    }
  }

  public clearCache(): void {
    this.cache = {};
  }

  public async invalidateCache(key?: string): Promise<void> {
    if (key) {
      Object.keys(this.cache)
        .filter((k) => k.startsWith(key))
        .forEach((k) => delete this.cache[k]);
    } else {
      this.clearCache();
    }
  }
}
