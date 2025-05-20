import * as vscode from "vscode";
import { LinearService } from "./services/linearService";
import { IssueTreeProvider } from "./providers/issueTreeProvider";
import { IssueDetailViewProvider } from "./providers/issueDetailViewProvider";
import { IssueFormProvider } from "./providers/issueFormProvider";
import { FilterService } from "./services/filterService";
import { SearchCriteria } from "./services/linearService";
import { CacheService } from "./services/cache/cacheService";

export async function activate(context: vscode.ExtensionContext) {
  const apiToken = vscode.workspace
    .getConfiguration("linear")
    .get<string>("apiToken");

  if (!apiToken) {
    vscode.window.showErrorMessage(
      "Linear API token is not set. Please add it in the settings."
    );
    return;
  }

  // キャッシュサービスの初期化
  const cacheService = new CacheService(context);

  const linearService = new LinearService(apiToken, cacheService);
  const issueTreeProvider = new IssueTreeProvider(linearService);
  const issueDetailProvider = new IssueDetailViewProvider(
    context.extensionUri,
    linearService
  );
  const issueFormProvider = new IssueFormProvider(
    context.extensionUri,
    linearService
  );

  const filterService = new FilterService();

  // 初期化時にWebViewを表示するためのコマンド登録
  const initializeViewsCommand = vscode.commands.registerCommand(
    "linear.initializeViews",
    async () => {
      try {
        // まずLinearビューコンテナを開く（アクティビティバーのアイコン）
        await vscode.commands.executeCommand("workbench.view.extension.linear");

        // 次に各WebViewを表示しようとする
        // 注：これは内部実装に依存し、動作が保証されないため試行として実装
        const tries = [
          "workbench.view.extension.linearIssueDetail",
          "linearIssueDetail.focus",
        ];

        for (const cmd of tries) {
          try {
            await vscode.commands.executeCommand(cmd);
            console.log(`Successfully executed command: ${cmd}`);
            break; // 成功したらループを抜ける
          } catch (e) {
            console.log(`Failed to execute command: ${cmd}`, e);
          }
        }
      } catch (e) {
        console.log("Failed to initialize views", e);
      }
    }
  );
  context.subscriptions.push(initializeViewsCommand);

  // 拡張機能起動時に自動的にビューを初期化
  setTimeout(async () => {
    try {
      console.log("拡張機能の初期化: ビューの初期化を開始");

      // 手順1: Linearビューコンテナを開く
      await vscode.commands.executeCommand("workbench.view.extension.linear");
      console.log("拡張機能の初期化: Linearコンテナを開きました");

      // 初期化が確実に行われるよう少し待機
      await new Promise((resolve) => setTimeout(resolve, 500));

      // 手順2: Issue Tree（リスト）を表示
      await vscode.commands.executeCommand("linearIssues.focus");
      console.log("拡張機能の初期化: Issue Treeを表示しました");

      // さらに少し待機
      await new Promise((resolve) => setTimeout(resolve, 500));

      // 手順3: Issue Detail表示を試みる
      try {
        // Issue Detailビューを表示
        const detailCommands = [
          "linearIssueDetail.focus",
          "workbench.view.extension.linearIssueDetail",
        ];

        for (const cmd of detailCommands) {
          try {
            await vscode.commands.executeCommand(cmd);
            console.log(
              `拡張機能の初期化: ${cmd} でIssue Detailを表示しました`
            );
            break;
          } catch (err) {
            console.log(`拡張機能の初期化: ${cmd} の実行に失敗:`, err);
          }
        }

        // Issue Detailビューが確実に初期化されるよう、ダミーデータで更新試行
        // 注: ユーザーがイシューを選択するまでは実際のデータを表示する必要はない
        // try {
        //   const dummyIssueId = "initialization-dummy-id";
        //   // updateIssueDetailメソッドは、WebViewが利用できない場合は_pendingIssueIdに保存するだけ
        //   await issueDetailProvider.updateIssueDetail(dummyIssueId);
        //   console.log(
        //     "拡張機能の初期化: Issue Detailパネルの初期化を試みました"
        //   );
        // } catch (initErr) {
        //   console.log("拡張機能の初期化: Issue Detail初期化エラー:", initErr);
        // }

        // Issue FormビューもViewの一部として初期化（必要に応じて）
        try {
          await vscode.commands.executeCommand(
            "workbench.view.extension.linearIssueForm"
          );
          console.log("拡張機能の初期化: Issue Formを表示しました");
        } catch (formErr) {
          // フォームの表示は省略可能なので、エラーは無視
        }

        // 最終的にIssue Treeに戻す
        await vscode.commands.executeCommand("linearIssues.focus");
      } catch (viewErr) {
        console.log("拡張機能の初期化: 詳細ビューの初期化でエラー:", viewErr);
      }
    } catch (error) {
      console.error("拡張機能の初期化: ビューの初期化に失敗:", error);
    }
  }, 1500); // 少し長めの遅延で確実にVSCodeが準備できた状態で実行

  // TreeViewの登録
  const treeView = vscode.window.createTreeView("linearIssues", {
    treeDataProvider: issueTreeProvider,
    showCollapseAll: true,
  });

  // WebViewプロバイダーの登録
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      IssueDetailViewProvider.viewType,
      issueDetailProvider
    ),
    vscode.window.registerWebviewViewProvider(
      IssueFormProvider.viewType,
      issueFormProvider
    )
  );

  // 独自のビュー表示コマンドを登録
  const showIssueDetailViewCommand = vscode.commands.registerCommand(
    "linear.showIssueDetailView",
    async () => {
      // まずLinearビューコンテナを開く（これは通常機能する）
      try {
        await vscode.commands.executeCommand("workbench.view.extension.linear");
        console.log("Linear extension view container activated");
      } catch (error) {
        console.error("Failed to open Linear view container:", error);
      }

      // 注: 特定のビューを直接アクティブにする試みは避ける
      // VSCodeの内部コマンド形式は変更される可能性があるためエラーになりやすい
    }
  );

  context.subscriptions.push(showIssueDetailViewCommand);

  // 初期フィルターの適用
  // すべてのフィルターをクリアし、基本的なフィルターのみ設定（完了は非表示）
  const defaultFilter = {
    includeCompleted: false,
  };
  issueTreeProvider.setFilter(defaultFilter);

  // キャッシュを事前にウォームアップ
  setTimeout(async () => {
    try {
      // 自分にアサインされたIssueのみを取得
      await linearService.getIssues(false);
      console.log("Cache warmed up with assigned issues");
    } catch (e) {
      console.error("Failed to warm up cache", e);
    }
  }, 500);

  // コマンドの登録
  context.subscriptions.push(
    vscode.commands.registerCommand("linear.refreshIssues", () => {
      issueTreeProvider.refresh();
    }),
    vscode.commands.registerCommand("linear.showIssueDetail", async (issue) => {
      if (!issue) {
        vscode.window.showErrorMessage("イシューオブジェクトがありません");
        return;
      }

      // issueがオブジェクトか文字列（ID）かチェック
      const issueId = typeof issue === "string" ? issue : issue.id;

      if (!issueId) {
        vscode.window.showErrorMessage("イシューIDがありません");
        console.error("無効なイシューオブジェクト:", issue);
        return;
      }

      console.log(`イシュー詳細を表示します: ${issueId}`);

      try {
        // ステップ1: まずイシュー詳細の更新を要求
        // これにより、WebViewが後で表示されたときにすぐにデータが表示される
        try {
          console.log("先にイシュー詳細データを更新します");
          await issueDetailProvider.updateIssueDetail(issueId);
          console.log("イシュー詳細データの更新に成功しました");
        } catch (dataErr) {
          console.error("イシュー詳細データの更新に失敗:", dataErr);
          // 継続して表示を試みる
        }

        // ステップ2: Linearビューコンテナを開く
        await vscode.commands.executeCommand("workbench.view.extension.linear");
        console.log("Linearビューコンテナを開きました");

        // ステップ3: 少し待機してからIssueDetail表示を試みる
        await new Promise((resolve) => setTimeout(resolve, 300));

        // ステップ4: IssueDetailビューを確実に表示する
        try {
          // Detail Viewを表示するための複数の方法を試す
          const viewCommands = [
            "linearIssueDetail.focus", // これを先に試す
            "workbench.view.extension.linearIssueDetail",
          ];

          let success = false;
          for (const cmd of viewCommands) {
            try {
              await vscode.commands.executeCommand(cmd);
              console.log(`コマンド ${cmd} でIssue Detailビューを開きました`);
              success = true;
              break;
            } catch (err) {
              console.log(`コマンド ${cmd} の実行に失敗: ${err}`);
            }
          }

          if (!success) {
            console.log(
              "標準コマンドでビューを開けませんでした、別の方法を試みます"
            );

            // VSCodeのビューの状態に関わらず、直接データ更新を再試行
            try {
              await issueDetailProvider.updateIssueDetail(issueId);
              console.log("イシュー詳細の第2回更新に成功");
            } catch (retryErr) {
              console.error("イシュー詳細の第2回更新に失敗:", retryErr);
            }

            // ユーザーに明示的な指示を表示
            vscode.window.showInformationMessage(
              "イシュー詳細を表示するには、Linearパネルの「Issue Detail」タブをクリックしてください",
              "了解"
            );
          }
        } catch (viewError) {
          console.error("Issue Detailビューを開く際にエラーが発生:", viewError);

          // エラー発生時にもデータ更新を試みる
          try {
            await issueDetailProvider.updateIssueDetail(issueId);
            console.log("エラー後のイシュー詳細更新に成功");
          } catch (errAfterErr) {
            console.error("エラー後のイシュー詳細更新に失敗:", errAfterErr);
          }
        }
      } catch (error) {
        console.error("イシュー詳細の表示中にエラー:", error);
        vscode.window.showErrorMessage(
          "イシュー詳細の表示中にエラーが発生しました"
        );
      }
    }),
    vscode.commands.registerCommand("linear.createIssue", () => {
      issueFormProvider.showCreateForm();
    }),
    vscode.commands.registerCommand("linear.editIssue", async (issue) => {
      issueFormProvider.showEditForm(issue);
    }),
    vscode.commands.registerCommand(
      "linear.toggleGroupExpansion",
      (groupId) => {
        issueTreeProvider.toggleGroupExpansion(groupId);
      }
    ),
    vscode.commands.registerCommand(
      "linear.changeIssueStatus",
      async (issue) => {
        const team = await issue.team;
        if (!team) {
          vscode.window.showErrorMessage("Failed to get team information");
          return;
        }

        const states = await issueTreeProvider.getAvailableStates(team.id);
        const currentState = await issue.state;

        const items = states.map((state) => ({
          label: state.name,
          description: state.description || "",
          picked: state.id === currentState?.id,
          state: state,
        }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: "Select new status",
          title: `Change status of ${issue.identifier}`,
        });

        if (selected) {
          try {
            await linearService.updateIssueState(issue.id, selected.state.id);
            issueTreeProvider.refresh();
            vscode.window.showInformationMessage(
              `Status updated to ${selected.label}`
            );
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to update status: ${error}`);
          }
        }
      }
    ),
    vscode.commands.registerCommand("linear.groupByStatus", () => {
      issueTreeProvider.setGroupBy("status");
    }),
    vscode.commands.registerCommand("linear.groupByProject", () => {
      issueTreeProvider.setGroupBy("project");
    }),
    vscode.commands.registerCommand("linear.clearGrouping", () => {
      issueTreeProvider.setGroupBy("none");
    }),
    vscode.commands.registerCommand("linear.filterByStatus", async () => {
      const teams = await linearService.getTeams();
      const teamItems = teams.map((team) => ({
        label: team.name,
        description: team.key,
        team: team,
      }));

      const selectedTeam = await vscode.window.showQuickPick(teamItems, {
        placeHolder: "Select team to filter states",
      });

      if (!selectedTeam) return;

      const states = await linearService.getWorkflowStates(
        selectedTeam.team.id
      );
      const stateItems = states.map((state) => ({
        label: state.name,
        description: state.description || "",
        picked: false,
        state: state,
      }));

      const selectedStates = await vscode.window.showQuickPick(stateItems, {
        placeHolder: "Select states to filter by",
        canPickMany: true,
      });

      if (selectedStates) {
        issueTreeProvider.setFilter({
          status: selectedStates.map((s) => s.state.id),
        });
      }
    }),
    vscode.commands.registerCommand("linear.filterByPriority", async () => {
      const priorities = [
        { label: "No priority", value: 0 },
        { label: "Low", value: 1 },
        { label: "Medium", value: 2 },
        { label: "High", value: 3 },
        { label: "Urgent", value: 4 },
      ];

      const priorityItems = priorities.map((p) => ({
        label: p.label,
        picked: false,
        priority: p.value,
      }));

      const selectedPriorities = await vscode.window.showQuickPick(
        priorityItems,
        {
          placeHolder: "Select priorities to filter by",
          canPickMany: true,
        }
      );

      if (selectedPriorities) {
        issueTreeProvider.setFilter({
          priority: selectedPriorities.map((p) => p.priority),
        });
      }
    }),
    vscode.commands.registerCommand("linear.filterByProject", async () => {
      const projects = await linearService.getProjects();
      const projectItems = projects.map((project) => ({
        label: project.name,
        description: project.description || "",
        picked: false,
        project: project,
      }));

      const selectedProjects = await vscode.window.showQuickPick(projectItems, {
        placeHolder: "Select projects to filter by",
        canPickMany: true,
      });

      if (selectedProjects) {
        issueTreeProvider.setFilter({
          project: selectedProjects.map((p) => p.project.id),
        });
      }
    }),
    vscode.commands.registerCommand("linear.clearFilters", () => {
      issueTreeProvider.clearFilter();
    }),
    vscode.commands.registerCommand(
      "linear.removeFilter",
      (filterKey: string) => {
        issueTreeProvider.removeFilter(filterKey);
      }
    ),
    vscode.commands.registerCommand("linear.toggleCompletedIssues", () => {
      issueTreeProvider.setFilter({
        includeCompleted:
          !issueTreeProvider.getFilterCriteria().includeCompleted,
      });
      vscode.window.showInformationMessage(
        `${
          issueTreeProvider.getFilterCriteria().includeCompleted
            ? "Showing"
            : "Hiding"
        } completed issues`
      );
    }),
    vscode.commands.registerCommand("linear.saveCurrentFilter", async () => {
      const name = await vscode.window.showInputBox({
        placeHolder: "Enter filter name",
        prompt: "Save current filter settings",
      });

      if (name) {
        await filterService.saveFilter(
          name,
          issueTreeProvider.getFilterCriteria()
        );
        vscode.window.showInformationMessage(`Filter "${name}" has been saved`);
      }
    }),
    vscode.commands.registerCommand("linear.loadSavedFilter", async () => {
      const filters = filterService.getSavedFilters();
      if (filters.length === 0) {
        vscode.window.showInformationMessage("No saved filters found");
        return;
      }

      const selected = await vscode.window.showQuickPick(
        filters.map((f) => ({
          label: f.name,
          filter: f,
        })),
        { placeHolder: "Select a filter to load" }
      );

      if (selected) {
        issueTreeProvider.setFilter(selected.filter.criteria);
        vscode.window.showInformationMessage(
          `Filter "${selected.label}" has been loaded`
        );
      }
    }),
    vscode.commands.registerCommand("linear.saveAsDefaultFilter", async () => {
      await filterService.setDefaultFilter(
        issueTreeProvider.getFilterCriteria()
      );
      vscode.window.showInformationMessage(
        "Current filter has been set as default"
      );
    }),
    vscode.commands.registerCommand("linear.manageSavedFilters", async () => {
      const filters = filterService.getSavedFilters();
      if (filters.length === 0) {
        vscode.window.showInformationMessage("No saved filters found");
        return;
      }

      const selected = await vscode.window.showQuickPick(
        filters.map((f) => ({
          label: f.name,
          description: "Delete",
          filter: f,
        })),
        { placeHolder: "Select a filter to delete" }
      );

      if (selected) {
        const confirm = await vscode.window.showWarningMessage(
          `Are you sure you want to delete filter "${selected.label}"?`,
          { modal: true },
          "Delete"
        );

        if (confirm === "Delete") {
          await filterService.deleteFilter(selected.label);
          vscode.window.showInformationMessage(
            `Filter "${selected.label}" has been deleted`
          );
        }
      }
    }),
    vscode.commands.registerCommand("linear.searchIssues", async () => {
      const query = await vscode.window.showInputBox({
        placeHolder: "Search issues by title, description, or number",
        prompt: "Enter search query",
      });

      if (query) {
        try {
          const issues = await linearService.searchIssues({ query });
          if (issues.length === 0) {
            vscode.window.showInformationMessage("No issues found");
            return;
          }

          const items = await Promise.all(
            issues.map(async (issue) => {
              const state = await issue.state;
              return {
                label: `${issue.identifier}: ${issue.title}`,
                description: `Status: ${state?.name || "Unknown"}`,
                detail: issue.description,
                issue: issue,
              };
            })
          );

          const selected = await vscode.window.showQuickPick(items, {
            placeHolder: "Select an issue to view",
          });

          if (selected) {
            await issueDetailProvider.updateIssueDetail(selected.issue.id);
          }
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to search issues: ${error}`);
        }
      }
    }),
    vscode.commands.registerCommand("linear.advancedSearch", async () => {
      const teams = await linearService.getTeams();
      const labels = await linearService.getLabels();

      // チーム選択
      const selectedTeams = await vscode.window.showQuickPick(
        teams.map((team) => ({
          label: team.name,
          picked: false,
          team: team,
        })),
        { placeHolder: "Select teams (optional)", canPickMany: true }
      );

      // ラベル選択
      const selectedLabels = await vscode.window.showQuickPick(
        labels.map((label) => ({
          label: label.name,
          picked: false,
          id: label.id,
        })),
        { placeHolder: "Select labels (optional)", canPickMany: true }
      );

      // 日付範囲選択
      const dateRanges = [
        { label: "Last 7 days", days: 7 },
        { label: "Last 30 days", days: 30 },
        { label: "Last 90 days", days: 90 },
        { label: "All time", days: 0 },
      ];

      const selectedRange = await vscode.window.showQuickPick(dateRanges, {
        placeHolder: "Select date range",
      });

      // 検索条件の構築
      const criteria: SearchCriteria = {};

      if (selectedTeams?.length) {
        criteria.teamIds = selectedTeams.map((t) => t.team.id);
      }

      if (selectedLabels?.length) {
        criteria.labels = selectedLabels.map((l) => l.id);
      }

      if (selectedRange && selectedRange.days > 0) {
        const date = new Date();
        date.setDate(date.getDate() - selectedRange.days);
        criteria.updatedAfter = date;
      }

      try {
        const issues = await linearService.searchIssues(criteria);
        if (issues.length === 0) {
          vscode.window.showInformationMessage("No issues found");
          return;
        }

        const items = await Promise.all(
          issues.map(async (issue) => {
            const state = await issue.state;
            return {
              label: `${issue.identifier}: ${issue.title}`,
              description: `Status: ${state?.name || "Unknown"}`,
              detail: issue.description,
              issue: issue,
            };
          })
        );

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: "Select an issue to view",
        });

        if (selected) {
          await issueDetailProvider.updateIssueDetail(selected.issue.id);
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to search issues: ${error}`);
      }
    }),
    vscode.commands.registerCommand(
      "linear.applyQuickFilter",
      async (filter: { key: string; label: string }) => {
        if (filter && filter.key) {
          await issueTreeProvider.applyQuickFilter(filter.key);
          vscode.window.showInformationMessage(
            `Applied filter: ${filter.label}`
          );
        }
      }
    ),
    treeView
  );

  // TreeViewの選択イベントを監視
  treeView.onDidChangeSelection(async (e) => {
    if (e.selection.length > 0) {
      const selectedItem = e.selection[0];
      if (
        !issueTreeProvider.isIssueGroup(selectedItem) &&
        issueTreeProvider.isIssue(selectedItem)
      ) {
        // Linearコンテナを表示する（アクティビティバーを開く）
        try {
          await vscode.commands.executeCommand(
            "workbench.view.extension.linear"
          );
          console.log("Tree selection: Activated Linear view container");
        } catch (error) {
          console.log("Tree selection: Failed to open Linear container", error);
        }

        // イシュー詳細を直接更新
        console.log("Tree selection: Updating issue detail");
        await issueDetailProvider.updateIssueDetail(selectedItem.id);
      }
    }
  });
}

export function deactivate() {}
