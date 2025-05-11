import * as vscode from "vscode";
import { FilterCriteria } from "../providers/issueTreeProvider";

export interface SavedFilter {
  name: string;
  criteria: FilterCriteria;
}

export class FilterService {
  private readonly configSection = "linear.filters";

  constructor() {}

  public getDefaultFilter(): FilterCriteria {
    const config = vscode.workspace.getConfiguration(this.configSection);
    return (
      config.get<FilterCriteria>("defaultFilter") || {
        includeCompleted: false,
        assignedToMe: false,
      }
    );
  }

  public async setDefaultFilter(criteria: FilterCriteria): Promise<void> {
    const config = vscode.workspace.getConfiguration(this.configSection);
    await config.update(
      "defaultFilter",
      criteria,
      vscode.ConfigurationTarget.Global
    );
  }

  public getSavedFilters(): SavedFilter[] {
    const config = vscode.workspace.getConfiguration(this.configSection);
    return config.get<SavedFilter[]>("savedFilters") || [];
  }

  public async saveFilter(
    name: string,
    criteria: FilterCriteria
  ): Promise<void> {
    const filters = this.getSavedFilters();
    const existingIndex = filters.findIndex((f) => f.name === name);

    if (existingIndex >= 0) {
      filters[existingIndex].criteria = criteria;
    } else {
      filters.push({ name, criteria });
    }

    const config = vscode.workspace.getConfiguration(this.configSection);
    await config.update(
      "savedFilters",
      filters,
      vscode.ConfigurationTarget.Global
    );
  }

  public async deleteFilter(name: string): Promise<void> {
    const filters = this.getSavedFilters().filter((f) => f.name !== name);
    const config = vscode.workspace.getConfiguration(this.configSection);
    await config.update(
      "savedFilters",
      filters,
      vscode.ConfigurationTarget.Global
    );
  }
}
