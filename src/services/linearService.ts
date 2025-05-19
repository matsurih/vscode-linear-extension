import {
  LinearClient,
  Team,
  IssuePayload,
  WorkflowState,
  Project,
  Issue,
  LinearError,
} from "@linear/sdk";
import { CacheService } from "./cache/cacheService";
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
  private readonly RETRY_COUNT = 3;
  private readonly RETRY_DELAY = 1000;
  private cacheService: CacheService;
  private lastSyncTime?: string;

  constructor(apiKey: string, cacheService: CacheService) {
    this.initializeClient(apiKey);
    this.cacheService = cacheService;
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

  /**
   * 課題一覧を取得する
   * キャッシュがある場合は差分更新を行い、なければ全件取得する
   */
  public async getIssues(
    filterMine: boolean = false,
    includeCompleted: boolean = false
  ) {
    const cacheKey = `issues:${filterMine}:${includeCompleted}`;
    console.log("Attempting to get issues from cache:", cacheKey);
    const cached = this.cacheService.get<LocalIssue[]>(cacheKey);

    if (cached) {
      console.log("Cache hit! Found", cached.length, "issues in cache");
      // バックグラウンドで非同期更新
      if (this.lastSyncTime) {
        // setTimeoutを使って非同期処理を確実に後回しにする
        setTimeout(() => {
          this.updateIssuesInBackground(
            cacheKey,
            this.lastSyncTime || new Date().toISOString(),
            cached
          ).catch((err) => console.error("Background update failed:", err));
        }, 100);
      }
      return this.filterIssues(cached, filterMine, includeCompleted);
    }

    console.log("Cache miss, fetching from API");
    try {
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
        console.log(`Fetched ${issues.nodes.length} issues from API`);
        return issues.nodes.map((i) => this.createSearchIndex(i));
      });

      this.cacheService.set(cacheKey, result, new Date().toISOString());
      this.lastSyncTime = new Date().toISOString();
      return result;
    } catch (error) {
      console.error("Error fetching issues:", error);
      if (cached) {
        console.log("Using stale cache due to fetch error");
        return this.filterIssues(cached, filterMine, includeCompleted);
      }
      throw new Error(`Failed to fetch issues: ${error}`);
    }
  }

  /**
   * バックグラウンドで課題の差分更新を行う
   */
  private async updateIssuesInBackground(
    cacheKey: string,
    lastSyncTime: string,
    cachedIssues: LocalIssue[]
  ): Promise<void> {
    try {
      const updatedIssues = await this.fetchUpdatedIssues(lastSyncTime);
      if (updatedIssues.length > 0) {
        const updatedIds = new Set(updatedIssues.map((i) => i.id));
        const filteredCache = cachedIssues.filter((i) => !updatedIds.has(i.id));
        const newIssues = [
          ...filteredCache,
          ...updatedIssues.map((i) => this.createSearchIndex(i)),
        ];
        this.cacheService.set(cacheKey, newIssues, new Date().toISOString());
        this.lastSyncTime = new Date().toISOString();
      }
    } catch (error) {
      console.error("Background update failed:", error);
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
    const cacheKey = `issue:${issueId}`;
    const cached = this.cacheService.get<Issue>(cacheKey);

    if (cached) {
      // バックグラウンドで非同期更新
      this.fetchIssueDetailsInBackground(issueId, cacheKey);
      return cached;
    }

    try {
      const issue = await this.client.issue(issueId);
      this.cacheService.set(cacheKey, issue);
      return issue;
    } catch (error) {
      throw new Error(`Failed to fetch issue details: ${error}`);
    }
  }

  /**
   * バックグラウンドで課題詳細を更新する
   */
  private async fetchIssueDetailsInBackground(
    issueId: string,
    cacheKey: string
  ): Promise<void> {
    try {
      const issue = await this.client.issue(issueId);
      this.cacheService.set(cacheKey, issue);
    } catch (error) {
      console.error(`Background fetch failed for issue ${issueId}:`, error);
    }
  }

  public async getIssueComments(issueId: string) {
    const cacheKey = `comments:${issueId}`;
    const cached = this.cacheService.get<any[]>(cacheKey);

    if (cached) {
      // バックグラウンドで更新
      this.fetchCommentsInBackground(issueId, cacheKey);
      return cached;
    }

    try {
      const comments = await this.client.comments({
        filter: {
          issue: { id: { eq: issueId } },
        },
      });
      const result = comments.nodes;
      this.cacheService.set(cacheKey, result);
      return result;
    } catch (error) {
      throw new Error(`Failed to fetch comments: ${error}`);
    }
  }

  /**
   * バックグラウンドでコメントを更新する
   */
  private async fetchCommentsInBackground(
    issueId: string,
    cacheKey: string
  ): Promise<void> {
    try {
      const comments = await this.client.comments({
        filter: {
          issue: { id: { eq: issueId } },
        },
      });
      this.cacheService.set(cacheKey, comments.nodes);
    } catch (error) {
      console.error(
        `Background fetch failed for comments of issue ${issueId}:`,
        error
      );
    }
  }

  public async addComment(issueId: string, content: string) {
    try {
      await this.client.createComment({
        issueId,
        body: content,
      });
      // コメント追加後にキャッシュを無効化
      this.cacheService.delete(`comments:${issueId}`);
    } catch (error) {
      throw new Error(`Failed to add comment: ${error}`);
    }
  }

  public async getTeams(): Promise<Team[]> {
    const cacheKey = "teams";
    const cached = this.cacheService.get<Team[]>(cacheKey);

    if (cached) {
      return cached;
    }

    try {
      const teams = await this.client.teams();
      const result = teams.nodes;
      this.cacheService.set(cacheKey, result);
      return result;
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
      // 課題作成後にキャッシュを無効化
      this.cacheService.invalidateByPrefix("issues:");
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
      // 課題更新後にキャッシュを無効化
      this.cacheService.delete(`issue:${issueId}`);
      this.cacheService.invalidateByPrefix("issues:");
      return result;
    } catch (error) {
      console.error("Failed to update issue:", error);
      throw error;
    }
  }

  public async getWorkflowStates(teamId: string): Promise<WorkflowState[]> {
    const cacheKey = `workflowStates:${teamId}`;
    const cached = this.cacheService.get<WorkflowState[]>(cacheKey);

    if (cached) {
      return cached;
    }

    try {
      const states = await this.client.workflowStates({
        filter: {
          team: { id: { eq: teamId } },
        },
      });
      const result = states.nodes;
      this.cacheService.set(cacheKey, result);
      return result;
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
      // 状態変更後にキャッシュを無効化
      this.cacheService.delete(`issue:${issueId}`);
      this.cacheService.invalidateByPrefix("issues:");
      return result;
    } catch (error) {
      console.error("Failed to update issue state:", error);
      throw error;
    }
  }

  public async getProject(projectId: string): Promise<Project | null> {
    const cacheKey = `project:${projectId}`;
    const cached = this.cacheService.get<Project | null>(cacheKey);

    if (cached !== null) {
      return cached;
    }

    try {
      const project = await this.client.project(projectId);
      this.cacheService.set(cacheKey, project);
      return project;
    } catch (error) {
      if (error instanceof LinearError && error.message.includes("not found")) {
        this.cacheService.set(cacheKey, null);
        return null;
      }
      console.error("Failed to fetch project:", error);
      throw error;
    }
  }

  public async getProjects(): Promise<Project[]> {
    const cacheKey = "projects";
    const cached = this.cacheService.get<Project[]>(cacheKey);

    if (cached) {
      return cached;
    }

    try {
      const projects = await this.client.projects();
      const result = projects.nodes;
      this.cacheService.set(cacheKey, result);
      return result;
    } catch (error) {
      console.error("Failed to fetch projects:", error);
      throw error;
    }
  }

  public updateApiToken(apiToken: string) {
    this.initializeClient(apiToken);
    this.clearCache();
  }

  public async getLabels(): Promise<{ id: string; name: string }[]> {
    const cacheKey = "labels";
    const cached =
      this.cacheService.get<{ id: string; name: string }[]>(cacheKey);

    if (cached) {
      return cached;
    }

    try {
      const labels = await this.client.issueLabels();
      const result = labels.nodes.map((label) => ({
        id: label.id,
        name: label.name,
      }));
      this.cacheService.set(cacheKey, result);
      return result;
    } catch (error) {
      console.error("Failed to fetch labels:", error);
      throw error;
    }
  }

  public async getTeamMembers(
    teamId: string
  ): Promise<{ id: string; name: string }[]> {
    const cacheKey = `teamMembers:${teamId}`;
    const cached =
      this.cacheService.get<{ id: string; name: string }[]>(cacheKey);

    if (cached) {
      return cached;
    }

    try {
      const team = await this.client.team(teamId);
      const members = await team.members();
      const result = members.nodes.map((member) => ({
        id: member.id,
        name: member.name,
      }));
      this.cacheService.set(cacheKey, result);
      return result;
    } catch (error) {
      console.error("Failed to fetch team members:", error);
      throw error;
    }
  }

  public clearCache(): void {
    this.cacheService.clear();
  }

  public async invalidateCache(key?: string): Promise<void> {
    if (key) {
      this.cacheService.invalidateByPrefix(key);
    } else {
      this.cacheService.clear();
    }
  }
}
