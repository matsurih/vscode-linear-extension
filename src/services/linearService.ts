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

export interface FilterCriteria {
  assignedToMe?: boolean; // この変数は内部的には使用しないが、型の互換性のために残す
  status?: string[];
  priority?: number[];
  project?: string[];
  includeCompleted?: boolean;
  query?: string;
  labels?: string[];
  dueDate?: {
    before?: Date;
    after?: Date;
  };
  updatedAfter?: Date;
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

  /**
   * 課題一覧を取得する
   * キャッシュがある場合は差分更新を行い、なければ全件取得する
   * 常に自分にアサインされたIssueのみを取得し、完了・キャンセル状態は除外
   * @param includeCompleted 完了状態のIssueも含める場合はtrue
   * @param additionalFilters その他のフィルター条件
   */
  public async getIssues(
    includeCompleted: boolean = false,
    additionalFilters: FilterCriteria = {}
  ) {
    // フィルター条件をキャッシュキーの一部に含める
    const filterKey = JSON.stringify({
      completed: includeCompleted,
      ...additionalFilters,
    });
    const cacheKey = `issues:${filterKey}`;
    console.log("Attempting to get issues from cache:", cacheKey);
    const cached = this.cacheService.get<LocalIssue[]>(cacheKey);

    // キャッシュデータの有効性をチェック
    const isValidCache = cached && Array.isArray(cached) && cached.length > 0;
    if (isValidCache) {
      console.log("Cache hit! Found", cached.length, "issues in cache");

      // バックグラウンドでAPIデータを非同期更新
      const existingInfo = this.cacheService.getLastUpdateId(cacheKey);
      const lastSyncTime =
        existingInfo || this.lastSyncTime || new Date().toISOString();

      // 非同期で更新
      setTimeout(() => {
        this.updateIssuesInBackground(
          cacheKey,
          lastSyncTime,
          cached,
          includeCompleted,
          additionalFilters
        ).catch((err) => console.error("Background update failed:", err));
      }, 100);

      return cached;
    }

    console.log("Cache miss, fetching from API");
    try {
      // 初回またはキャッシュ無効時の全件取得
      const result = await this.withRetry(async () => {
        const filter: any = {};

        // 常に自分のIssueのみを取得
        const me = await this.client.viewer;
        filter.assignee = { id: { eq: me.id } };

        // 完了・キャンセル状態の除外設定
        if (!includeCompleted) {
          // TypeをArrayで指定して複数条件で除外
          filter.state = {
            type: {
              nin: ["completed", "canceled"],
            },
          };
        }

        // 追加フィルターの適用
        if (additionalFilters.status?.length) {
          // 既存のstate条件がある場合は維持しつつ、IDの条件を追加
          filter.state = {
            ...filter.state,
            id: { in: additionalFilters.status },
          };
        }

        if (additionalFilters.priority?.length) {
          filter.priority = { in: additionalFilters.priority };
        }

        if (additionalFilters.project?.length) {
          filter.project = { id: { in: additionalFilters.project } };
        }

        if (additionalFilters.labels?.length) {
          filter.labels = {
            some: {
              id: { in: additionalFilters.labels },
            },
          };
        }

        if (additionalFilters.updatedAfter) {
          filter.updatedAt = {
            gt: additionalFilters.updatedAfter.toISOString(),
          };
        }

        // クエリによる検索
        if (additionalFilters.query) {
          filter.or = [
            { title: { contains: additionalFilters.query } },
            { description: { contains: additionalFilters.query } },
          ];
        }

        console.log("Applying filter:", JSON.stringify(filter));

        // LinearのAPIクエリ
        // 重要: issue.state などの呼び出しで個別APIリクエストが発生しないよう関連データを一度に取得
        const issues = await this.client.issues({
          filter,
          first: 100,
          // includeパラメータを使用して関連データを一括取得
          include: ["state", "assignee", "project", "team", "labels"],
        } as any);

        console.log(
          `Fetched ${issues.nodes.length} issues from API with related data`
        );

        // 取得したデータに関連情報が正しく含まれているか確認
        const sampleIssue = issues.nodes[0];
        if (sampleIssue) {
          this.logSampleIssueData(sampleIssue);
        }

        // 検索用のインデックスを生成してキャッシュに保存
        const localIssues = issues.nodes.map((issue) =>
          this.createSearchIndex(issue)
        );
        this.cacheService.set(cacheKey, localIssues, new Date().toISOString());
        this.lastSyncTime = new Date().toISOString();
        return localIssues;
      });

      return result;
    } catch (error) {
      console.error("Failed to fetch issues:", error);
      // キャッシュが無ければエラーを投げる、あれば古いデータを返す
      if (!isValidCache) {
        throw new Error(`Failed to fetch issues: ${error}`);
      }
      return cached!;
    }
  }

  // サンプルイシューのデータをログに出力して確認用
  private logSampleIssueData(issue: Issue) {
    try {
      console.log("Sample issue data validation:");

      // 安全に値を取り出す関数
      const safeExtract = (
        obj: any,
        path: string,
        defaultValue: any = "not available"
      ) => {
        try {
          const paths = path.split(".");
          let current = obj;
          for (const key of paths) {
            if (current === null || current === undefined) return defaultValue;
            current = current[key];
          }
          if (typeof current === "object" && current !== null) {
            return JSON.stringify(current).substring(0, 50) + "...";
          }
          return current || defaultValue;
        } catch (e) {
          return defaultValue;
        }
      };

      console.log(`Issue ID: ${issue.id}`);
      console.log(`Title: ${issue.title}`);
      console.log(`Identifier: ${issue.identifier}`);
      console.log(`State: ${safeExtract(issue, "state.name")}`);
      console.log(`State type: ${safeExtract(issue, "state.type")}`);
      console.log(`Assignee: ${safeExtract(issue, "assignee.name")}`);
      console.log(`Team: ${safeExtract(issue, "team.name")}`);
      console.log(`Project: ${safeExtract(issue, "project.name")}`);

      if (issue.state === undefined) {
        console.warn(`Issue ${issue.identifier} has no state information!`);
      }
    } catch (e) {
      console.error("Error logging sample issue data:", e);
    }
  }

  /**
   * バックグラウンドで課題の差分更新を行う
   * 自分にアサインされたIssueのみを取得し、オプションで完了状態を含める
   */
  private async updateIssuesInBackground(
    cacheKey: string,
    lastSyncTime: string,
    cachedIssues: LocalIssue[],
    includeCompleted: boolean = false,
    additionalFilters: FilterCriteria = {}
  ): Promise<void> {
    try {
      console.log(`Background update started for ${cacheKey}`);
      // 更新時にも同じフィルター条件を適用
      const filter: any = {
        updatedAt: { gt: lastSyncTime },
      };

      // 常に自分のIssueのみを取得
      const me = await this.client.viewer;
      filter.assignee = { id: { eq: me.id } };

      // 完了・キャンセル状態の除外設定
      if (!includeCompleted) {
        // TypeをArrayで指定して複数条件で除外
        filter.state = {
          type: {
            nin: ["completed", "canceled"],
          },
        };
      }

      // 追加フィルターの適用
      if (additionalFilters.status?.length) {
        filter.state = {
          ...filter.state,
          id: { in: additionalFilters.status },
        };
      }

      if (additionalFilters.priority?.length) {
        filter.priority = { in: additionalFilters.priority };
      }

      if (additionalFilters.project?.length) {
        filter.project = { id: { in: additionalFilters.project } };
      }

      // 差分更新用のAPIコール
      const issues = await this.client.issues({
        filter,
        first: 100,
        // 関連データを一度に取得
        include: ["state", "assignee", "project", "team"],
      } as any);

      const updatedIssues = issues.nodes;
      console.log(
        `Found ${updatedIssues.length} updated issues since ${lastSyncTime}`
      );

      if (updatedIssues.length > 0) {
        // 更新されたイシューのIDを記録
        const updatedIds = new Set(updatedIssues.map((i) => i.id));

        // 更新されていないイシューはそのまま保持
        const filteredCache = cachedIssues.filter((i) => !updatedIds.has(i.id));

        // 新しいイシューリストを作成（関連データはすでに含まれている）
        const processedIssues = updatedIssues.map((issue) => {
          console.log(`Processing updated issue ${issue.identifier}`);
          return this.createSearchIndex(issue);
        });

        const newIssues = [...filteredCache, ...processedIssues];

        // キャッシュを更新
        this.cacheService.set(cacheKey, newIssues, new Date().toISOString());
        this.lastSyncTime = new Date().toISOString();
        console.log(
          `Updated cache for ${cacheKey} with ${newIssues.length} issues`
        );
      } else {
        console.log(`No updates needed for ${cacheKey}`);
      }
    } catch (error) {
      console.error("Background update failed:", error);
    }
  }

  public async searchIssues(criteria: SearchCriteria): Promise<Issue[]> {
    try {
      // キャッシュからすべてのissueを取得
      const allIssues = await this.getIssues(false);

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

  /**
   * Issue詳細を取得する
   * キャッシュがある場合はそれを返し、バックグラウンドで更新する
   * @param issueId IssueのID
   */
  public async getIssueDetails(issueId: string) {
    if (!issueId || typeof issueId !== "string") {
      console.error(`Invalid issueId provided: ${issueId}`);
      throw new Error("無効なイシューIDが提供されました");
    }

    // 改善: キャッシュキーをissueIdベースに変更
    const cacheKey = `issueDetail:${issueId}`;
    console.log(`Attempting to get issue details from cache: ${cacheKey}`);

    // キャッシュ確認
    const cached = this.cacheService.get<Issue>(cacheKey);

    if (cached) {
      console.log(`Cache hit for issue details: ${issueId}`);

      // 必須情報が存在するか確認
      if (cached.state) {
        console.log(`Issue ${issueId} has state information in cache`);
        // @ts-ignore - stateはオブジェクトかPromiseになりうる
        const stateName = cached.state.name || "unknown";
        if (!stateName || stateName === "unknown") {
          console.warn(
            `Issue ${issueId} has no state name, might be an API issue`
          );
        }
      } else {
        console.warn(`Issue ${issueId} has no state information in cache`);
      }

      // バックグラウンドで最新データを取得
      setTimeout(() => {
        this.fetchIssueDetailsInBackground(issueId, cacheKey).catch((err) =>
          console.error(`Background fetch failed for ${issueId}:`, err)
        );
      }, 100);

      return cached;
    }

    console.log(`Cache miss for issue details: ${issueId}, fetching from API`);
    try {
      // APIから取得
      return await this.withRetry(async () => {
        // 注: LinearSDKのバージョンによって使用方法が異なる場合があります
        const issue = await this.client.issue(issueId);

        if (!issue) {
          throw new Error(`Issue ${issueId} not found`);
        }

        // stateを明示的に事前ロード
        try {
          const state = await issue.state;
          console.log(
            `Preloaded state for issue ${issueId}: ${state?.name || "unknown"}`
          );
        } catch (stateError) {
          console.warn(
            `Failed to preload state for issue ${issueId}:`,
            stateError
          );
        }

        // キャッシュに保存
        this.cacheService.set(cacheKey, issue);
        return issue;
      });
    } catch (error) {
      console.error(`Failed to fetch issue details for ${issueId}:`, error);

      // キャッシュが完全に無い場合はエラーを投げる
      if (!cached) {
        throw error;
      }

      // キャッシュが古くても返す（ユーザー体験改善）
      console.log(`Returning stale cache for ${issueId} due to API error`);
      return cached;
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

      // 状態情報を明示的に事前ロード
      try {
        const state = await issue.state;
        console.log(
          `Background: Preloaded state for issue ${issue.identifier}: ${
            state?.name || "unknown"
          }`
        );
      } catch (stateError) {
        console.warn(
          `Background: Failed to preload state for issue ${issue.identifier}:`,
          stateError
        );
      }

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
