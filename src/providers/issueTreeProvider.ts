import * as vscode from "vscode";
import { LinearService } from "../services/linearService";
import { Issue, WorkflowState, Project } from "@linear/sdk";

interface FilterIndicator {
  type: "filter" | "quickFilter";
  label: string;
  icon: string;
  removable?: boolean;
  filterKey?: string;
  filters?: Array<{
    key: string;
    label: string;
    icon: string;
  }>;
}

interface IssueGroup {
  type: "group";
  label: string;
  issues: Issue[];
  iconPath?: vscode.ThemeIcon;
}

interface PriorityLabels {
  [key: number]: string;
}

export type GroupBy = "none" | "status" | "project";
export interface FilterCriteria {
  assignedToMe?: boolean;
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
  [key: string]: any;
}

// カスタムツリーアイテムの型定義
interface CustomTreeItem {
  type: "loading" | "noResults" | "pageInfo" | "quickFilterItem";
  label: string;
  description?: string;
  tooltip?: string;
  iconName: string;
  accessibilityLabel: string;
  accessibilityRole: string;
  command?: {
    command: string;
    title: string;
    arguments: any[];
  };
}

// イシューの表示に必要な基本情報をキャッシュする軽量オブジェクト
interface IssueDisplayInfo {
  id: string;
  identifier: string;
  title: string;
  stateId?: string;
  stateName?: string;
  stateColor?: string;
  stateType?: string;
  priority: number;
  assigneeId?: string;
  assigneeName?: string;
  projectId?: string;
  projectName?: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export class IssueTreeProvider
  implements
    vscode.TreeDataProvider<
      Issue | IssueGroup | FilterIndicator | CustomTreeItem
    >
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    | Issue
    | IssueGroup
    | FilterIndicator
    | CustomTreeItem
    | undefined
    | null
    | void
  > = new vscode.EventEmitter<
    | Issue
    | IssueGroup
    | FilterIndicator
    | CustomTreeItem
    | undefined
    | null
    | void
  >();
  readonly onDidChangeTreeData: vscode.Event<
    | Issue
    | IssueGroup
    | FilterIndicator
    | CustomTreeItem
    | undefined
    | null
    | void
  > = this._onDidChangeTreeData.event;

  private groupBy: GroupBy = "status";
  private filterCriteria: FilterCriteria = {
    includeCompleted: false,
  };

  // キャッシュ
  private stateCache: Map<string, WorkflowState[]> = new Map();
  private projectCache: Map<string, Project> = new Map();
  private issueCache: Issue[] = [];
  private issueDisplayInfoCache: Map<string, IssueDisplayInfo> = new Map();
  private lastFetchTime: number = 0;
  private readonly CACHE_DURATION = 300000; // 5分

  // ページネーション
  private readonly PAGE_SIZE = 50;
  private currentPage = 1;

  // 展開状態の管理
  private expandedGroups: Set<string> = new Set();

  // アクティブフィルターの表示用
  private showFilterIndicators = true;

  // フィルターインジケーター用インターフェース
  private filterIndicators: FilterIndicator[] = [];

  // クイックフィルター用の定数
  private readonly QUICK_FILTERS = {
    MY_ISSUES: "assignedToMe",
    HIGH_PRIORITY: "highPriority",
    DUE_SOON: "dueSoon",
    RECENTLY_UPDATED: "recentlyUpdated",
  };

  // ローディング状態の管理
  private isLoading = false;
  private loadingMessage = "Loading...";

  // アクセシビリティ用のラベル
  private readonly ARIA_LABELS = {
    priority: {
      0: "No priority",
      1: "Low priority",
      2: "Medium priority",
      3: "High priority",
      4: "Urgent priority",
    } as PriorityLabels,
    loading: "Loading issues, please wait",
    noIssues: "No issues found",
    filterActive: "Filters are active",
    pageInfo: (current: number, total: number) => `Page ${current} of ${total}`,
  };

  constructor(private _linearService: LinearService) {
    this.groupBy = "status"; // デフォルトのグルーピングをstatusに設定
  }

  // 展開状態の切り替え
  toggleGroupExpansion(groupId: string) {
    if (this.expandedGroups.has(groupId)) {
      this.expandedGroups.delete(groupId);
    } else {
      this.expandedGroups.add(groupId);
    }
    this._onDidChangeTreeData.fire();
  }

  // ページ制御
  nextPage() {
    this.currentPage++;
    this._onDidChangeTreeData.fire();
  }

  previousPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
      this._onDidChangeTreeData.fire();
    }
  }

  resetPagination() {
    this.currentPage = 1;
  }

  private getPagedIssues(issues: Issue[]): Issue[] {
    const start = (this.currentPage - 1) * this.PAGE_SIZE;
    return issues.slice(start, start + this.PAGE_SIZE);
  }

  refresh(): void {
    this.clearCache();
    this.resetPagination();
    this._onDidChangeTreeData.fire();
  }

  private clearCache(): void {
    this.issueCache = [];
    this.issueDisplayInfoCache.clear();
    this.lastFetchTime = 0;
  }

  setGroupBy(groupBy: GroupBy): void {
    this.groupBy = groupBy;
    this.resetPagination();
    this._onDidChangeTreeData.fire();
  }

  setFilter(criteria: Partial<FilterCriteria>): void {
    this.filterCriteria = { ...this.filterCriteria, ...criteria };
    this.clearCache();
    this.resetPagination();
    this.updateFilterIndicators();
    this._onDidChangeTreeData.fire();
  }

  clearFilter(): void {
    this.filterCriteria = { includeCompleted: false };
    this.clearCache();
    this.resetPagination();
    this.updateFilterIndicators();
    this._onDidChangeTreeData.fire();
  }

  public getFilterCriteria(): FilterCriteria {
    return { ...this.filterCriteria };
  }

  private async getIssuesWithCache(): Promise<Issue[]> {
    const now = Date.now();
    if (
      this.issueCache.length > 0 &&
      now - this.lastFetchTime < this.CACHE_DURATION
    ) {
      return this.issueCache;
    }

    try {
      this.loadingMessage = "Fetching issues...";

      // フィルター条件を渡して、API側でフィルタリングする
      const issues = await this._linearService.getIssues(
        this.filterCriteria.includeCompleted || false,
        {
          status: this.filterCriteria.status,
          priority: this.filterCriteria.priority,
          project: this.filterCriteria.project,
          labels: this.filterCriteria.labels,
          updatedAfter: this.filterCriteria.updatedAfter,
          query: this.filterCriteria.query,
        }
      );

      this.issueCache = issues;
      this.lastFetchTime = now;

      // イシュー表示情報のキャッシュを更新
      await this.updateIssueDisplayInfoCache(issues);

      return issues;
    } catch (error) {
      vscode.window.showErrorMessage(`Error fetching issues: ${error}`);
      return [];
    }
  }

  /**
   * イシュー表示情報のキャッシュを更新する
   * 個別のAPIコールを避けるように最適化
   */
  private async updateIssueDisplayInfoCache(issues: Issue[]): Promise<void> {
    console.log(`更新対象のイシュー件数: ${issues.length}`);

    for (const issue of issues) {
      try {
        // すでにキャッシュされている情報を確認
        const existingInfo = this.issueDisplayInfoCache.get(issue.id);

        // キャッシュされたデータがあり、最近更新されたものは再利用する
        if (
          existingInfo &&
          new Date(issue.updatedAt).getTime() <=
            new Date(existingInfo.updatedAt).getTime()
        ) {
          console.log(`Using cached info for issue ${issue.identifier}`);
          continue;
        }

        // issue情報から安全にデータを抽出する関数
        const safeExtract = (
          obj: any,
          path: string,
          defaultValue: any = undefined
        ) => {
          try {
            return path
              .split(".")
              .reduce(
                (o, key) => (o && o[key] !== undefined ? o[key] : defaultValue),
                obj
              );
          } catch (e) {
            return defaultValue;
          }
        };

        // state、assignee、projectの情報を安全に抽出
        const stateId = safeExtract(issue, "state.id");
        const stateName = safeExtract(issue, "state.name");
        const stateColor = safeExtract(issue, "state.color");
        const stateType = safeExtract(issue, "state.type");

        const assigneeId = safeExtract(issue, "assignee.id");
        const assigneeName = safeExtract(issue, "assignee.name");

        const projectId = safeExtract(issue, "project.id");
        const projectName = safeExtract(issue, "project.name");

        // デバッグログ
        console.log(
          `Processing issue ${issue.identifier}, state: ${
            stateName || "unknown"
          }`
        );

        const displayInfo: IssueDisplayInfo = {
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          stateId: stateId,
          stateName: stateName,
          stateColor: stateColor,
          stateType: stateType,
          priority: issue.priority,
          assigneeId: assigneeId,
          assigneeName: assigneeName,
          projectId: projectId,
          projectName: projectName,
          createdAt: issue.createdAt,
          updatedAt: issue.updatedAt,
        };

        // ステート情報に問題がある場合のデバッグ
        if (!stateName) {
          console.warn(`Issue ${issue.identifier} has no state name`, issue);
        }

        this.issueDisplayInfoCache.set(issue.id, displayInfo);
      } catch (error) {
        console.error(`Failed to cache issue ${issue.identifier} info:`, error);
      }
    }
  }

  private async getProjectWithCache(
    projectId: string
  ): Promise<Project | null> {
    if (this.projectCache.has(projectId)) {
      return this.projectCache.get(projectId)!;
    }

    try {
      const project = await this._linearService.getProject(projectId);
      if (project) {
        this.projectCache.set(projectId, project);
      }
      return project;
    } catch (error) {
      console.error(`Error fetching project: ${error}`);
      return null;
    }
  }

  async getChildren(
    element?: Issue | IssueGroup | FilterIndicator | CustomTreeItem
  ): Promise<(Issue | IssueGroup | FilterIndicator | CustomTreeItem)[]> {
    if (!element) {
      if (this.isLoading) {
        return [this.createLoadingItem()];
      }

      this.isLoading = true;
      try {
        const issues = await this.getIssuesWithCache();
        const filteredIssues = await this.filterIssues(issues);

        const results: (
          | Issue
          | IssueGroup
          | FilterIndicator
          | CustomTreeItem
        )[] = [];

        // フィルターインジケーターを表示
        if (this.showFilterIndicators && this.filterIndicators.length > 0) {
          results.push(...this.filterIndicators);
        }

        // 結果が0件の場合の表示
        if (filteredIssues.length === 0) {
          results.push(this.createNoResultsItem());
          return results;
        }

        if (this.groupBy === "none") {
          const pagedIssues = this.getPagedIssues(filteredIssues);
          results.push(...pagedIssues);

          // ページ情報を追加
          const totalPages = Math.ceil(filteredIssues.length / this.PAGE_SIZE);
          if (totalPages > 1) {
            results.push(this.createPageInfoItem(totalPages));
          }
        } else {
          results.push(...(await this.groupIssues(filteredIssues)));
        }

        return results;
      } finally {
        this.isLoading = false;
      }
    }

    if (this.isIssueGroup(element)) {
      return element.issues;
    }

    // Quick Filterの子要素を返す
    if (
      this.isFilterIndicator(element) &&
      element.type === "quickFilter" &&
      element.filters
    ) {
      return element.filters.map((filter) => ({
        type: "quickFilterItem" as const,
        label: filter.label,
        iconName: filter.icon,
        command: {
          command: "linear.applyQuickFilter",
          title: "Apply Quick Filter",
          arguments: [{ key: filter.key, label: filter.label }],
        },
        accessibilityLabel: `Apply ${filter.label} filter`,
        accessibilityRole: "button",
        description: "",
        tooltip: `Click to filter by ${filter.label}`,
      }));
    }

    return [];
  }

  private async filterIssues(issues: Issue[]): Promise<Issue[]> {
    // API側でフィルタリング済みなので、そのまま返す
    return issues;
  }

  async getTreeItem(
    item: Issue | IssueGroup | FilterIndicator | CustomTreeItem
  ): Promise<vscode.TreeItem> {
    // カスタムツリーアイテム
    if (this.isCustomTreeItem(item)) {
      const treeItem = new vscode.TreeItem(
        item.label,
        vscode.TreeItemCollapsibleState.None
      );
      treeItem.iconPath = new vscode.ThemeIcon(item.iconName);
      treeItem.contextValue = item.type;
      if (item.description) {
        treeItem.description = item.description;
      }
      if (item.tooltip) {
        treeItem.tooltip = item.tooltip;
      }
      if (item.command) {
        treeItem.command = item.command;
      }
      treeItem.accessibilityInformation = {
        label: item.accessibilityLabel,
        role: item.accessibilityRole,
      };
      return treeItem;
    }

    // フィルターインジケーター
    if (this.isFilterIndicator(item)) {
      return this.getFilterIndicatorTreeItem(item);
    }

    // イシューグループ
    if (this.isIssueGroup(item)) {
      const isExpanded = this.expandedGroups.has(item.label);
      const treeItem = new vscode.TreeItem(
        item.label,
        isExpanded
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
      );
      treeItem.description = `(${item.issues.length})`;
      treeItem.tooltip = `${item.label} - ${item.issues.length} issues`;
      if (item.iconPath) {
        treeItem.iconPath = item.iconPath;
      }
      treeItem.contextValue = "issueGroup";
      treeItem.id = `group:${item.label}`;
      treeItem.command = {
        command: "linear.toggleGroupExpansion",
        title: "Toggle Group",
        arguments: [item.label],
      };
      return treeItem;
    }

    // イシュー
    return this.getIssueTreeItem(item);
  }

  private async getIssueTreeItem(issue: Issue): Promise<vscode.TreeItem> {
    // デバッグログ
    console.log(`Getting tree item for issue ${issue.identifier}`);

    // ステータス情報の取得を強化
    let stateColor = undefined;
    let stateName = undefined;

    try {
      // キャッシュから取得を試みる
      const issueInfo = this.issueDisplayInfoCache.get(issue.id);

      if (issueInfo) {
        // キャッシュから取得
        stateColor = issueInfo.stateColor;
        stateName = issueInfo.stateName;
        console.log(
          `Issue ${issue.identifier} using cached state: ${stateName}`
        );
      } else {
        // キャッシュがない場合は取得して更新
        const state = await issue.state;
        stateColor = state ? (state as any).color : undefined;
        stateName = state?.name;
        console.log(
          `Issue ${issue.identifier} using fetched state: ${stateName}`
        );
      }
    } catch (error) {
      console.error(
        `Error getting state for issue ${issue.identifier}:`,
        error
      );
    }

    const treeItem = new vscode.TreeItem(
      `${issue.identifier}: ${issue.title}`,
      vscode.TreeItemCollapsibleState.None
    );

    // ツールチップ設定
    treeItem.tooltip = new vscode.MarkdownString();
    treeItem.tooltip.appendMarkdown(
      `**${issue.identifier}: ${issue.title}**\n\n`
    );
    if (stateName) {
      treeItem.tooltip.appendMarkdown(`**Status**: ${stateName}\n\n`);
    }
    if (issue.description) {
      treeItem.tooltip.appendMarkdown(`${issue.description}`);
    }

    // ステータス表示
    if (stateName) {
      treeItem.description = stateName;
    } else {
      // ステータス名がない場合は取得を試みる
      try {
        const state = await issue.state;
        if (state) {
          treeItem.description = state.name;
        }
      } catch (error) {
        console.error(
          `Failed to get state name for ${issue.identifier}:`,
          error
        );
      }
    }

    // アイコン設定
    treeItem.iconPath = this.getItemIcon(stateColor, issue.priority);

    // コンテキスト情報設定
    treeItem.contextValue = "issue";

    // コマンド設定
    treeItem.command = {
      command: "linear.showIssueDetail",
      title: "Show Issue Detail",
      arguments: [issue],
    };

    return treeItem;
  }

  private getItemIcon(
    stateColor?: string,
    priority?: number
  ): vscode.ThemeIcon {
    if (stateColor) {
      return new vscode.ThemeIcon(
        "issue-opened",
        this.getStateThemeColor(stateColor)
      );
    }

    if (priority && priority > 0) {
      return new vscode.ThemeIcon(this.getPriorityIcon(priority));
    }

    return new vscode.ThemeIcon("issue-opened");
  }

  private getPriorityIcon(priority: number): string {
    switch (priority) {
      case 0:
        return "dash";
      case 1:
        return "arrow-down";
      case 2:
        return "arrow-right";
      case 3:
        return "arrow-up";
      case 4:
        return "warning";
      default:
        return "issue-opened";
    }
  }

  private getStateThemeColor(color: string): vscode.ThemeColor {
    if (color.startsWith("#")) {
      color = color.substring(1);
    }

    switch (color.toLowerCase()) {
      case "6e7780":
        return new vscode.ThemeColor("disabledForeground");
      case "f2c94c":
        return new vscode.ThemeColor("notificationsWarningIcon.foreground");
      case "5e6ad2":
        return new vscode.ThemeColor("symbolIcon.fieldForeground");
      case "9de1a1":
        return new vscode.ThemeColor("terminal.ansiGreen");
      default:
        return new vscode.ThemeColor("symbolIcon.classForeground");
    }
  }

  public isIssueGroup(item: any): item is IssueGroup {
    return item && item.type === "group";
  }

  private isFilterIndicator(item: any): item is FilterIndicator {
    return item && (item.type === "filter" || item.type === "quickFilter");
  }

  private isCustomTreeItem(item: any): item is CustomTreeItem {
    return (
      item &&
      (item.type === "loading" ||
        item.type === "noResults" ||
        item.type === "pageInfo" ||
        item.type === "quickFilterItem")
    );
  }

  public isIssue(item: any): item is Issue {
    return (
      item &&
      item.id !== undefined &&
      item.title !== undefined &&
      item.identifier !== undefined
    );
  }

  // 以下の部分はそのまま維持
  private async groupIssues(issues: Issue[]): Promise<IssueGroup[]> {
    // ... 既存のコード ...
    // (この部分は変更不要なので省略)
    if (this.groupBy === "status") {
      // ステータスでグループ化
      const statusGroups = new Map<string, Issue[]>();

      for (const issue of issues) {
        const displayInfo = this.issueDisplayInfoCache.get(issue.id);
        let stateId;

        if (displayInfo && displayInfo.stateId) {
          stateId = displayInfo.stateId;
        } else {
          const state = await issue.state;
          stateId = state?.id || "unknown";
        }

        if (!statusGroups.has(stateId)) {
          statusGroups.set(stateId, []);
        }

        statusGroups.get(stateId)!.push(issue);
      }

      const result: IssueGroup[] = [];

      for (const [, stateIssues] of statusGroups.entries()) {
        // サンプルイシューからステート情報を取得
        const sampleIssue = stateIssues[0];

        // ステータス情報の取得を強化
        let stateName = "Unknown";
        let stateColor = undefined;

        try {
          // まずキャッシュから取得を試みる
          const displayInfo = this.issueDisplayInfoCache.get(sampleIssue.id);

          if (displayInfo && displayInfo.stateName) {
            stateName = displayInfo.stateName;
            stateColor = displayInfo.stateColor;
            console.log(`Group using cached state: ${stateName}`);
          } else {
            // キャッシュになければAPIから取得
            const state = await sampleIssue.state;
            if (state) {
              stateName = state.name || "Unknown";
              stateColor = (state as any).color;
              console.log(`Group using fetched state: ${stateName}`);
            } else {
              console.warn(
                `No state found for issue ${sampleIssue.identifier}`
              );
            }
          }
        } catch (error) {
          console.error(
            `Error getting state for issue ${sampleIssue.identifier}:`,
            error
          );
        }

        result.push({
          type: "group",
          label: stateName,
          issues: stateIssues,
          iconPath: new vscode.ThemeIcon(
            "list-tree",
            stateColor ? this.getStateThemeColor(stateColor) : undefined
          ),
        });
      }

      return result;
    } else if (this.groupBy === "project") {
      // プロジェクトでグループ化
      const projectGroups = new Map<string, Issue[]>();
      const noProjectGroup: Issue[] = [];

      for (const issue of issues) {
        const displayInfo = this.issueDisplayInfoCache.get(issue.id);
        let projectId;

        if (displayInfo) {
          projectId = displayInfo.projectId;
        } else {
          const project = await issue.project;
          projectId = project?.id;
        }

        if (!projectId) {
          noProjectGroup.push(issue);
          continue;
        }

        if (!projectGroups.has(projectId)) {
          projectGroups.set(projectId, []);
        }

        projectGroups.get(projectId)!.push(issue);
      }

      const result: IssueGroup[] = [];

      for (const [projectId, projectIssues] of projectGroups.entries()) {
        // プロジェクト名を取得
        let projectName = "Unknown Project";
        const sampleIssue = projectIssues[0];
        const displayInfo = this.issueDisplayInfoCache.get(sampleIssue.id);

        if (displayInfo && displayInfo.projectName) {
          projectName = displayInfo.projectName;
        } else {
          const project = await this.getProjectWithCache(projectId);
          if (project) {
            projectName = project.name;
          }
        }

        result.push({
          type: "group",
          label: projectName,
          issues: projectIssues,
          iconPath: new vscode.ThemeIcon("project"),
        });
      }

      if (noProjectGroup.length > 0) {
        result.push({
          type: "group",
          label: "No Project",
          issues: noProjectGroup,
          iconPath: new vscode.ThemeIcon("circle-outline"),
        });
      }

      return result;
    }

    // デフォルトではグループ化なし
    return [];
  }

  async getAvailableStates(teamId: string): Promise<WorkflowState[]> {
    if (this.stateCache.has(teamId)) {
      return this.stateCache.get(teamId)!;
    }
    const states = await this._linearService.getWorkflowStates(teamId);
    this.stateCache.set(teamId, states);
    return states;
  }

  private updateFilterIndicators() {
    // ... 既存のコードをそのまま維持 ...
    const indicators: FilterIndicator[] = [];

    // アサイン済みフィルター
    if (this.filterCriteria.assignedToMe) {
      indicators.push({
        type: "filter",
        label: "Assigned to me",
        icon: "person",
        removable: true,
        filterKey: "assignedToMe",
      });
    }

    // ステータスフィルター
    if (this.filterCriteria.status?.length) {
      indicators.push({
        type: "filter",
        label: `Status: ${this.filterCriteria.status.length} selected`,
        icon: "symbol-enum",
        removable: true,
        filterKey: "status",
      });
    }

    // プライオリティフィルター
    if (this.filterCriteria.priority?.length) {
      indicators.push({
        type: "filter",
        label: `Priority: ${this.filterCriteria.priority.length} selected`,
        icon: "arrow-both",
        removable: true,
        filterKey: "priority",
      });
    }

    // プロジェクトフィルター
    if (this.filterCriteria.project?.length) {
      indicators.push({
        type: "filter",
        label: `Project: ${this.filterCriteria.project.length} selected`,
        icon: "project",
        removable: true,
        filterKey: "project",
      });
    }

    // 完了済み表示フィルター
    if (this.filterCriteria.includeCompleted) {
      indicators.push({
        type: "filter",
        label: "Including completed",
        icon: "check",
        removable: true,
        filterKey: "includeCompleted",
      });
    }

    // クイックフィルターオプション
    indicators.push({
      type: "quickFilter",
      label: "Quick Filters",
      icon: "filter",
      filters: [
        {
          key: this.QUICK_FILTERS.MY_ISSUES,
          label: "My Issues",
          icon: "person",
        },
        {
          key: this.QUICK_FILTERS.HIGH_PRIORITY,
          label: "High Priority",
          icon: "arrow-up",
        },
        {
          key: this.QUICK_FILTERS.RECENTLY_UPDATED,
          label: "Recently Updated",
          icon: "history",
        },
      ],
    });

    this.filterIndicators = indicators;
  }

  private getFilterIndicatorTreeItem(
    indicator: FilterIndicator
  ): vscode.TreeItem {
    const collapsibleState =
      indicator.type === "quickFilter"
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;

    const treeItem = new vscode.TreeItem(indicator.label, collapsibleState);
    treeItem.iconPath = new vscode.ThemeIcon(indicator.icon);
    treeItem.contextValue = indicator.type;

    if (indicator.type === "filter" && indicator.removable) {
      treeItem.command = {
        command: "linear.removeFilter",
        title: "Remove Filter",
        arguments: [indicator.filterKey],
      };
      treeItem.tooltip = `Click to remove ${indicator.label} filter`;
    } else if (indicator.type === "quickFilter") {
      treeItem.tooltip = "Click to expand quick filters";
    }

    treeItem.accessibilityInformation = {
      label: `${indicator.label} filter`,
      role: "filter",
    };

    return treeItem;
  }

  async applyQuickFilter(filterKey: string) {
    switch (filterKey) {
      case this.QUICK_FILTERS.MY_ISSUES:
        this.setFilter({ assignedToMe: true });
        break;
      case this.QUICK_FILTERS.HIGH_PRIORITY:
        this.setFilter({ priority: [3, 4] }); // High & Urgent
        break;
      case this.QUICK_FILTERS.RECENTLY_UPDATED:
        const date = new Date();
        date.setDate(date.getDate() - 7); // 7日以内
        this.setFilter({ updatedAfter: date });
        break;
      default:
        break;
    }
  }

  removeFilter(filterKey: string) {
    if (filterKey in this.filterCriteria) {
      const newCriteria = { ...this.filterCriteria };
      delete newCriteria[filterKey];
      this.setFilter(newCriteria);
    }
  }

  toggleFilterIndicators() {
    this.showFilterIndicators = !this.showFilterIndicators;
    this._onDidChangeTreeData.fire();
  }

  private createLoadingItem(): CustomTreeItem {
    return {
      type: "loading",
      label: this.loadingMessage,
      iconName: "loading~spin",
      accessibilityLabel: this.ARIA_LABELS.loading,
      accessibilityRole: "progressbar",
      tooltip: "Loading issues from Linear...",
    };
  }

  private createNoResultsItem(): CustomTreeItem {
    return {
      type: "noResults",
      label: "No issues found",
      iconName: "info",
      accessibilityLabel: this.ARIA_LABELS.noIssues,
      accessibilityRole: "text",
      tooltip: "Try changing filters to see more issues",
    };
  }

  private createPageInfoItem(totalPages: number): CustomTreeItem {
    return {
      type: "pageInfo",
      label: `Page ${this.currentPage} of ${totalPages}`,
      iconName: "book",
      accessibilityLabel: this.ARIA_LABELS.pageInfo(
        this.currentPage,
        totalPages
      ),
      accessibilityRole: "text",
      tooltip: `Showing page ${this.currentPage} of ${totalPages}`,
    };
  }

  async navigateToNextItem() {
    // キーボードナビゲーション用のスタブメソッド
  }

  async navigateToPreviousItem() {
    // キーボードナビゲーション用のスタブメソッド
  }

  async expandCurrentItem() {
    // キーボードナビゲーション用のスタブメソッド
  }

  async collapseCurrentItem() {
    // キーボードナビゲーション用のスタブメソッド
  }
}
