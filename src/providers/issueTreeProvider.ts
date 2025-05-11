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
  [key: string]: any; // インデックスシグネチャを追加
}

// カスタムツリーアイテムの型定義
interface CustomTreeItem {
  type: "loading" | "noResults" | "pageInfo";
  label: string;
  description?: string;
  tooltip?: string;
  iconName: string;
  accessibilityLabel: string;
  accessibilityRole: string;
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
      const issues = await this._linearService.getIssues(
        this.filterCriteria.assignedToMe || false,
        this.filterCriteria.includeCompleted || false
      );
      this.issueCache = issues;
      this.lastFetchTime = now;
      return issues;
    } catch (error) {
      vscode.window.showErrorMessage(`Error fetching issues: ${error}`);
      return [];
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

    return [];
  }

  private async filterIssues(issues: Issue[]): Promise<Issue[]> {
    return issues.filter(async (issue) => {
      if (this.filterCriteria.status?.length) {
        const state = await issue.state;
        if (!state || !this.filterCriteria.status.includes(state.id)) {
          return false;
        }
      }

      if (this.filterCriteria.priority?.length) {
        if (!this.filterCriteria.priority.includes(issue.priority)) {
          return false;
        }
      }

      if (this.filterCriteria.project?.length) {
        const project = await issue.project;
        if (!project || !this.filterCriteria.project.includes(project.id)) {
          return false;
        }
      }

      return true;
    });
  }

  async getTreeItem(
    item: Issue | IssueGroup | FilterIndicator | CustomTreeItem
  ): Promise<vscode.TreeItem> {
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
      treeItem.accessibilityInformation = {
        label: item.accessibilityLabel,
        role: item.accessibilityRole,
      };
      return treeItem;
    }

    if (this.isFilterIndicator(item)) {
      return this.getFilterIndicatorTreeItem(item);
    }

    if (this.isIssueGroup(item)) {
      const isExpanded = this.expandedGroups.has(item.label);
      const treeItem = new vscode.TreeItem(
        item.label,
        isExpanded
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
      );
      treeItem.description = `${item.issues.length} issues`;
      treeItem.iconPath = item.iconPath;
      treeItem.contextValue = "issueGroup";
      treeItem.command = {
        command: "linear.toggleGroupExpansion",
        title: "Toggle Group Expansion",
        arguments: [item.label],
      };
      return treeItem;
    }

    return this.getIssueTreeItem(item);
  }

  private async getIssueTreeItem(issue: Issue): Promise<vscode.TreeItem> {
    const state = await issue.state;
    const assignee = await issue.assignee;
    const team = await issue.team;
    const project = await issue.project;

    const treeItem = new vscode.TreeItem(
      `${issue.identifier} ${issue.title}`,
      vscode.TreeItemCollapsibleState.None
    );

    // メタ情報の表示を改善
    const metaInfo = [];
    if (state?.name) {
      const stateIcon = "$(circle-filled)";
      metaInfo.push(`${stateIcon} ${state.name}`);
    }
    if (assignee?.name) {
      const assigneeIcon = "$(person)";
      metaInfo.push(`${assigneeIcon} ${assignee.name}`);
    }
    if (team?.name) {
      const teamIcon = "$(organization)";
      metaInfo.push(`${teamIcon} ${team.name}`);
    }
    if (project?.name) {
      const projectIcon = "$(folder)";
      metaInfo.push(`${projectIcon} ${project.name}`);
    }
    treeItem.description = metaInfo.join(" │ ");

    // アクセシビリティ対応のツールチップ
    const priorityLabel = this.ARIA_LABELS.priority[issue.priority];
    const createdAt = new Date(issue.createdAt).toLocaleDateString();
    const updatedAt = new Date(issue.updatedAt).toLocaleDateString();

    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`## ${issue.identifier} ${issue.title}\n\n`);
    tooltip.appendMarkdown(
      `**Priority:** $(${this.getPriorityIcon(
        issue.priority
      )}) ${priorityLabel}\n\n`
    );
    tooltip.appendMarkdown(
      `**Status:** $(circle-filled) ${state?.name || "No Status"}\n\n`
    );
    tooltip.appendMarkdown(
      `**Assignee:** $(person) ${assignee?.name || "Unassigned"}\n\n`
    );
    tooltip.appendMarkdown(
      `**Team:** $(organization) ${team?.name || "No Team"}\n\n`
    );
    if (project) {
      tooltip.appendMarkdown(`**Project:** $(folder) ${project.name}\n\n`);
    }
    tooltip.appendMarkdown(`**Created:** $(calendar) ${createdAt}\n\n`);
    tooltip.appendMarkdown(`**Updated:** $(history) ${updatedAt}\n\n`);
    if (issue.description) {
      tooltip.appendMarkdown(`---\n\n${issue.description}`);
    }
    tooltip.isTrusted = true;
    treeItem.tooltip = tooltip;

    // アイコンの表示を改善（アクセシビリティ対応）
    const icon = this.getItemIcon(state?.color, issue.priority);
    treeItem.iconPath = icon;

    // キーボードナビゲーション用のコマンド
    treeItem.command = {
      command: "linear.showIssueDetail",
      title: "Show Issue Detail",
      arguments: [issue],
    };

    // アクセシビリティ用の追加情報
    treeItem.accessibilityInformation = {
      label: `Issue ${issue.identifier}: ${
        issue.title
      }, ${priorityLabel}, Status: ${state?.name || "No Status"}`,
      role: "treeitem",
    };

    return treeItem;
  }

  // アイコン生成を統一化するメソッドを追加
  private getItemIcon(
    stateColor?: string,
    priority?: number
  ): vscode.ThemeIcon {
    if (stateColor) {
      return new vscode.ThemeIcon(
        "circle-filled",
        this.getStateThemeColor(stateColor)
      );
    }
    return new vscode.ThemeIcon(this.getPriorityIcon(priority || 0));
  }

  private getPriorityIcon(priority: number): string {
    switch (priority) {
      case 0:
        return "circle-outline"; // No priority
      case 1:
        return "arrow-down"; // Low
      case 2:
        return "circle-small"; // Medium
      case 3:
        return "arrow-up"; // High
      case 4:
        return "zap"; // Urgent
      default:
        return "circle-outline";
    }
  }

  private getStateThemeColor(color: string): vscode.ThemeColor {
    // LinearのカラーコードをVSCodeのテーマカラーにマッピング（拡張）
    const colorMap: { [key: string]: string } = {
      "#95a5a6": "charts.gray", // Gray
      "#2ecc71": "charts.green", // Green
      "#e74c3c": "charts.red", // Red
      "#f1c40f": "charts.yellow", // Yellow
      "#3498db": "charts.blue", // Blue
      "#9b59b6": "charts.purple", // Purple
      "#1abc9c": "charts.foreground", // Turquoise
      "#e67e22": "charts.orange", // Orange
      "#34495e": "charts.lines", // Navy
    };

    return new vscode.ThemeColor(colorMap[color] || "charts.foreground");
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
      "type" in item &&
      (item.type === "loading" ||
        item.type === "noResults" ||
        item.type === "pageInfo") &&
      "label" in item &&
      "iconName" in item &&
      "accessibilityLabel" in item &&
      "accessibilityRole" in item
    );
  }

  public isIssue(item: any): item is Issue {
    return (
      item &&
      "identifier" in item &&
      "title" in item &&
      "priority" in item &&
      "createdAt" in item &&
      "updatedAt" in item
    );
  }

  private async groupIssues(issues: Issue[]): Promise<IssueGroup[]> {
    if (this.groupBy === "status") {
      const groups = new Map<string, IssueGroup>();
      const stateOrder = new Map<string, { index: number; name: string }>();

      // 最初にすべてのステータスを取得して順序を決定
      const teams = await this._linearService.getTeams();
      for (const team of teams) {
        const states = await this._linearService.getWorkflowStates(team.id);
        states.forEach((state, index) => {
          if (!stateOrder.has(state.id)) {
            stateOrder.set(state.id, { index, name: state.name });
          }
        });
      }

      for (const issue of issues) {
        const state = await issue.state;
        if (!state) continue;

        if (!groups.has(state.id)) {
          groups.set(state.id, {
            type: "group",
            label: state.name,
            issues: [],
            iconPath: this.getItemIcon(state.color),
          });
        }
        groups.get(state.id)!.issues.push(issue);
      }

      // ステータスの順序に基づいてソート
      const groupArray = Array.from(groups.values());
      return groupArray.sort((a, b) => {
        const aStateInfo = Array.from(stateOrder.values()).find(
          (info) => info.name === a.label
        );
        const bStateInfo = Array.from(stateOrder.values()).find(
          (info) => info.name === b.label
        );
        const aIndex = aStateInfo ? aStateInfo.index : Number.MAX_SAFE_INTEGER;
        const bIndex = bStateInfo ? bStateInfo.index : Number.MAX_SAFE_INTEGER;
        return aIndex - bIndex;
      });
    }

    if (this.groupBy === "project") {
      const groups = new Map<string, IssueGroup>();
      groups.set("no-project", {
        type: "group",
        label: "No Project",
        issues: [],
        iconPath: new vscode.ThemeIcon("folder"),
      });

      for (const issue of issues) {
        const projectId = await issue.projectId;
        if (!projectId) {
          groups.get("no-project")!.issues.push(issue);
          continue;
        }

        const project = await this.getProjectWithCache(projectId);
        if (!project) {
          groups.get("no-project")!.issues.push(issue);
          continue;
        }

        if (!groups.has(project.id)) {
          groups.set(project.id, {
            type: "group",
            label: project.name,
            issues: [],
            iconPath: new vscode.ThemeIcon("folder"),
          });
        }
        groups.get(project.id)!.issues.push(issue);
      }

      return Array.from(groups.values())
        .filter((group) => group.issues.length > 0)
        .sort((a, b) => {
          if (a.label === "No Project") return 1;
          if (b.label === "No Project") return -1;
          return a.label.localeCompare(b.label);
        });
    }

    return [];
  }

  async getAvailableStates(teamId: string): Promise<WorkflowState[]> {
    if (!this.stateCache.has(teamId)) {
      const states = await this._linearService.getWorkflowStates(teamId);
      this.stateCache.set(teamId, states);
    }
    return this.stateCache.get(teamId) || [];
  }

  // フィルターインジケーターの生成
  private updateFilterIndicators() {
    this.filterIndicators = [];

    // アクティブなフィルターに基づいてインジケーターを生成
    if (this.filterCriteria.assignedToMe) {
      this.filterIndicators.push({
        type: "filter",
        label: "Assigned to me",
        icon: "person",
        removable: true,
        filterKey: "assignedToMe",
      });
    }

    if (this.filterCriteria.status?.length) {
      this.filterIndicators.push({
        type: "filter",
        label: `${this.filterCriteria.status.length} status filters`,
        icon: "symbol-enum",
        removable: true,
        filterKey: "status",
      });
    }

    if (this.filterCriteria.priority?.length) {
      this.filterIndicators.push({
        type: "filter",
        label: `${this.filterCriteria.priority.length} priority filters`,
        icon: "arrow-both",
        removable: true,
        filterKey: "priority",
      });
    }

    if (this.filterCriteria.project?.length) {
      this.filterIndicators.push({
        type: "filter",
        label: `${this.filterCriteria.project.length} project filters`,
        icon: "project",
        removable: true,
        filterKey: "project",
      });
    }

    if (this.filterCriteria.labels?.length) {
      this.filterIndicators.push({
        type: "filter",
        label: `${this.filterCriteria.labels.length} labels`,
        icon: "tag",
        removable: true,
        filterKey: "labels",
      });
    }

    if (this.filterCriteria.query) {
      this.filterIndicators.push({
        type: "filter",
        label: `Search: ${this.filterCriteria.query}`,
        icon: "search",
        removable: true,
        filterKey: "query",
      });
    }

    // クイックフィルターの追加
    this.filterIndicators.push({
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
          key: this.QUICK_FILTERS.DUE_SOON,
          label: "Due Soon",
          icon: "calendar",
        },
        {
          key: this.QUICK_FILTERS.RECENTLY_UPDATED,
          label: "Recently Updated",
          icon: "history",
        },
      ],
    });
  }

  private getFilterIndicatorTreeItem(
    indicator: FilterIndicator
  ): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(
      indicator.label,
      indicator.type === "quickFilter"
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    treeItem.iconPath = new vscode.ThemeIcon(indicator.icon);
    treeItem.contextValue = indicator.type;
    treeItem.tooltip = new vscode.MarkdownString();

    if (indicator.type === "filter") {
      treeItem.description = "Click ✕ to remove";
      if (indicator.removable) {
        treeItem.command = {
          command: "linear.removeFilter",
          title: "Remove Filter",
          arguments: [indicator.filterKey],
        };
      }
      // フィルターの詳細情報をツールチップに追加
      treeItem.tooltip.appendMarkdown(`**Active Filter**\n\n`);
      treeItem.tooltip.appendMarkdown(`Type: ${indicator.label}\n\n`);
      treeItem.tooltip.appendMarkdown(`Click ✕ to remove this filter`);
    } else {
      treeItem.description = "Click to expand";
      // クイックフィルターの説明をツールチップに追加
      treeItem.tooltip.appendMarkdown(`**Quick Filters**\n\n`);
      treeItem.tooltip.appendMarkdown(`Click to show available quick filters`);
    }

    treeItem.tooltip.isTrusted = true;
    return treeItem;
  }

  // クイックフィルターの適用
  async applyQuickFilter(filterKey: string) {
    switch (filterKey) {
      case this.QUICK_FILTERS.MY_ISSUES:
        this.setFilter({ assignedToMe: true });
        break;
      case this.QUICK_FILTERS.HIGH_PRIORITY:
        this.setFilter({ priority: [3, 4] }); // High & Urgent
        break;
      case this.QUICK_FILTERS.DUE_SOON:
        const nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 7);
        this.setFilter({
          dueDate: { before: nextWeek },
        });
        break;
      case this.QUICK_FILTERS.RECENTLY_UPDATED:
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        this.setFilter({ updatedAfter: yesterday });
        break;
    }
  }

  // 個別のフィルターを削除
  removeFilter(filterKey: string) {
    const newCriteria = { ...this.filterCriteria };
    delete newCriteria[filterKey];
    this.setFilter(newCriteria);
  }

  // フィルターインジケーターの表示/非表示を切り替え
  toggleFilterIndicators() {
    this.showFilterIndicators = !this.showFilterIndicators;
    this._onDidChangeTreeData.fire();
  }

  // ローディング表示用のアイテム
  private createLoadingItem(): CustomTreeItem {
    return {
      type: "loading",
      label: this.loadingMessage,
      iconName: "loading~spin",
      accessibilityLabel: this.ARIA_LABELS.loading,
      accessibilityRole: "progressbar",
    };
  }

  // 結果なしの表示用のアイテム
  private createNoResultsItem(): CustomTreeItem {
    return {
      type: "noResults",
      label: "No issues found",
      iconName: "info",
      accessibilityLabel: this.ARIA_LABELS.noIssues,
      accessibilityRole: "status",
    };
  }

  // ページ情報表示用のアイテム
  private createPageInfoItem(totalPages: number): CustomTreeItem {
    const label = this.ARIA_LABELS.pageInfo(this.currentPage, totalPages);
    return {
      type: "pageInfo",
      label,
      iconName: "book",
      accessibilityLabel: label,
      accessibilityRole: "status",
    };
  }

  // キーボードナビゲーション用のメソッド
  async navigateToNextItem() {
    // TreeViewの選択を次のアイテムに移動
    await vscode.commands.executeCommand("list.focusDown");
  }

  async navigateToPreviousItem() {
    // TreeViewの選択を前のアイテムに移動
    await vscode.commands.executeCommand("list.focusUp");
  }

  async expandCurrentItem() {
    // 現在選択されているアイテムを展開
    await vscode.commands.executeCommand("list.expand");
  }

  async collapseCurrentItem() {
    // 現在選択されているアイテムを折りたたむ
    await vscode.commands.executeCommand("list.collapse");
  }
}
